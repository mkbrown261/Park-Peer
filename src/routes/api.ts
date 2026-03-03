import { Hono } from 'hono'
import {
  createPaymentIntent,
  createCustomer,
  getPaymentIntent,
  createRefund,
  verifyWebhookSignature
} from '../services/stripe'
import {
  sendBookingConfirmation,
  sendHostBookingAlert,
  sendCancellationEmail,
  sendPaymentReceipt,
  sendWelcomeEmail
} from '../services/sendgrid'

type Bindings = {
  DB: D1Database
  MEDIA: R2Bucket
  STRIPE_SECRET_KEY: string
  STRIPE_PUBLISHABLE_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  SENDGRID_API_KEY: string
  FROM_EMAIL: string
  ADMIN_USERNAME: string
  ADMIN_PASSWORD: string
  ADMIN_TOKEN_SECRET: string
}

export const apiRoutes = new Hono<{ Bindings: Bindings }>()

// ════════════════════════════════════════════════════════════════════════════
// HEALTH
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.get('/health', (c) => {
  const env = c.env
  return c.json({
    status: 'ok',
    service: 'ParkPeer API',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    services: {
      d1_database:  env?.DB ? 'connected' : 'not configured',
      r2_storage:   env?.MEDIA ? 'connected' : 'not configured',
      stripe:       env?.STRIPE_SECRET_KEY ? 'configured' : 'not configured',
      sendgrid:     (env?.SENDGRID_API_KEY && env.SENDGRID_API_KEY !== 'PLACEHOLDER_SENDGRID_KEY') ? 'configured' : 'placeholder',
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// STRIPE CONFIG (publishable key for frontend)
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.get('/stripe/config', (c) => {
  return c.json({
    publishableKey: c.env?.STRIPE_PUBLISHABLE_KEY || ''
  })
})

// ════════════════════════════════════════════════════════════════════════════
// STRIPE — Create Payment Intent
// POST /api/payments/create-intent
// Body: { listing_id, start_datetime, end_datetime, driver_email, driver_name, vehicle_plate }
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.post('/payments/create-intent', async (c) => {
  const env = c.env
  if (!env?.STRIPE_SECRET_KEY) {
    return c.json({ error: 'Stripe not configured' }, 503)
  }

  let body: any = {}
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { listing_id, start_datetime, end_datetime, driver_email, driver_name, vehicle_plate } = body

  if (!listing_id || !start_datetime || !end_datetime || !driver_email) {
    return c.json({ error: 'Missing required fields: listing_id, start_datetime, end_datetime, driver_email' }, 400)
  }

  // Calculate pricing
  const start = new Date(start_datetime)
  const end   = new Date(end_datetime)
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    return c.json({ error: 'Invalid date range' }, 400)
  }

  const hours       = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 3600000))
  const ratePerHour = 12  // TODO: fetch from D1 listing
  const subtotal    = ratePerHour * hours
  const platformFee = Math.round(subtotal * 0.15 * 100) / 100
  const total       = subtotal + platformFee
  const totalCents  = Math.round(total * 100)

  try {
    const { clientSecret, paymentIntentId } = await createPaymentIntent(
      env as any,
      totalCents,
      'usd',
      {
        listing_id: String(listing_id),
        driver_email,
        vehicle_plate: vehicle_plate || '',
        start_datetime,
        end_datetime,
        platform: 'parkpeer'
      }
    )

    return c.json({
      clientSecret,
      paymentIntentId,
      pricing: {
        hours,
        rate_per_hour: ratePerHour,
        subtotal,
        platform_fee: platformFee,
        total,
        total_cents: totalCents,
        currency: 'usd'
      }
    })
  } catch (e: any) {
    console.error('[Stripe] create-intent error:', e.message)
    return c.json({ error: e.message || 'Failed to create payment intent' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// STRIPE — Confirm Booking after successful payment
// POST /api/payments/confirm
// Body: { payment_intent_id, listing_id, driver_email, driver_name, start_datetime, end_datetime, vehicle_plate }
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.post('/payments/confirm', async (c) => {
  const env = c.env
  if (!env?.STRIPE_SECRET_KEY) {
    return c.json({ error: 'Stripe not configured' }, 503)
  }

  let body: any = {}
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const {
    payment_intent_id, listing_id, driver_email, driver_name,
    start_datetime, end_datetime, vehicle_plate
  } = body

  if (!payment_intent_id) {
    return c.json({ error: 'Missing payment_intent_id' }, 400)
  }

  try {
    // Verify payment succeeded with Stripe
    const pi = await getPaymentIntent(env as any, payment_intent_id)
    if (pi.status !== 'succeeded') {
      return c.json({ error: `Payment not completed. Status: ${pi.status}` }, 402)
    }

    const amountPaid   = pi.amount / 100
    const platformFee  = Math.round(amountPaid * 0.15 * 100) / 100
    const hostPayout   = amountPaid - platformFee
    const bookingId    = Math.floor(100000 + Math.random() * 900000)

    // Send confirmation emails
    const listingTitle   = 'Parking Space'  // TODO: fetch from D1
    const listingAddress = 'Chicago, IL'

    await sendBookingConfirmation(env as any, {
      driverEmail: driver_email,
      driverName: driver_name || driver_email,
      bookingId,
      listingTitle,
      listingAddress,
      startTime: new Date(start_datetime).toLocaleString('en-US'),
      endTime:   new Date(end_datetime).toLocaleString('en-US'),
      totalCharged: amountPaid,
      vehiclePlate: vehicle_plate || 'Not provided'
    })

    await sendPaymentReceipt(env as any, {
      toEmail: driver_email,
      toName:  driver_name || driver_email,
      bookingId,
      amount: amountPaid,
      last4:  pi.payment_method_details?.card?.last4,
      listingTitle
    })

    return c.json({
      success: true,
      booking_id: `PP-${bookingId}`,
      status: 'confirmed',
      amount_paid: amountPaid,
      host_payout: hostPayout,
      platform_fee: platformFee,
      confirmation_email_sent: true
    }, 201)
  } catch (e: any) {
    console.error('[Stripe] confirm error:', e.message)
    return c.json({ error: e.message || 'Confirmation failed' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// STRIPE — Refund
// POST /api/payments/refund
// Body: { payment_intent_id, booking_id, amount_cents?, reason, requester_email }
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.post('/payments/refund', async (c) => {
  const env = c.env
  if (!env?.STRIPE_SECRET_KEY) {
    return c.json({ error: 'Stripe not configured' }, 503)
  }

  let body: any = {}
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { payment_intent_id, booking_id, amount_cents, requester_email, requester_name } = body
  if (!payment_intent_id) {
    return c.json({ error: 'Missing payment_intent_id' }, 400)
  }

  try {
    const refund = await createRefund(env as any, payment_intent_id, amount_cents)
    const refundAmount = refund.amount / 100

    if (requester_email) {
      await sendCancellationEmail(env as any, {
        toEmail: requester_email,
        toName:  requester_name || requester_email,
        bookingId: booking_id || 0,
        listingTitle: 'Your Parking Space',
        refundAmount,
        cancelledBy: 'user'
      })
    }

    return c.json({
      success: true,
      refund_id: refund.id,
      amount_refunded: refundAmount,
      status: refund.status
    })
  } catch (e: any) {
    console.error('[Stripe] refund error:', e.message)
    return c.json({ error: e.message || 'Refund failed' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// STRIPE WEBHOOK
// POST /api/webhooks/stripe
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.post('/webhooks/stripe', async (c) => {
  const env = c.env
  if (!env?.STRIPE_WEBHOOK_SECRET) {
    return c.json({ error: 'Webhook not configured' }, 503)
  }

  const sig    = c.req.header('stripe-signature') || ''
  const body   = await c.req.text()

  const valid = await verifyWebhookSignature(body, sig, env.STRIPE_WEBHOOK_SECRET)
  if (!valid) {
    console.error('[Webhook] Invalid signature')
    return c.json({ error: 'Invalid signature' }, 400)
  }

  let event: any
  try { event = JSON.parse(body) } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  console.log(`[Webhook] Event: ${event.type}`)

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object
      console.log(`[Webhook] Payment succeeded: ${pi.id} $${pi.amount / 100}`)
      // TODO: update booking status in D1
      break
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object
      console.log(`[Webhook] Payment failed: ${pi.id}`)
      // TODO: notify driver of payment failure
      break
    }
    case 'charge.refunded': {
      const charge = event.data.object
      console.log(`[Webhook] Refund issued: ${charge.id}`)
      // TODO: update booking status in D1
      break
    }
    case 'charge.dispute.created': {
      const dispute = event.data.object
      console.log(`[Webhook] Dispute opened: ${dispute.id}`)
      // TODO: create dispute record in D1, alert admin
      break
    }
    default:
      console.log(`[Webhook] Unhandled event: ${event.type}`)
  }

  return c.json({ received: true })
})

// ════════════════════════════════════════════════════════════════════════════
// SENDGRID — Send welcome email (called after signup)
// POST /api/emails/welcome
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.post('/emails/welcome', async (c) => {
  let body: any = {}
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }
  const { email, name, role = 'DRIVER' } = body
  if (!email || !name) return c.json({ error: 'Missing email or name' }, 400)

  const ok = await sendWelcomeEmail(c.env as any, { toEmail: email, toName: name, role })
  return c.json({ success: ok })
})

// ════════════════════════════════════════════════════════════════════════════
// LISTINGS (mock — will migrate to D1 in next phase)
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.get('/listings', (c) => {
  const { q, type, min_price, max_price, limit = '20', offset = '0' } = c.req.query()

  const listings = [
    { id: 1, title: 'Secure Covered Garage', type: 'garage', address: '120 S Michigan Ave, Chicago', lat: 41.8819, lon: -87.6278, price_hourly: 12, price_daily: 55, price_monthly: 320, rating: 4.9, review_count: 142, instant_book: true, features: ['cctv', 'covered', 'ev_charging', 'gated'], max_vehicle: 'suv', available: true },
    { id: 2, title: 'Private Driveway — Wrigley', type: 'driveway', address: '3614 N Clark St, Chicago', lat: 41.9484, lon: -87.6553, price_hourly: 8, price_daily: 35, price_monthly: 180, rating: 4.8, review_count: 89, instant_book: false, features: ['gated', 'lighting'], max_vehicle: 'sedan', available: true },
    { id: 3, title: "O'Hare Airport Long-Term", type: 'lot', address: 'Near ORD Terminal 1, Chicago', lat: 41.9742, lon: -87.9073, price_hourly: 14, price_daily: 45, price_monthly: 280, rating: 4.7, review_count: 311, instant_book: true, features: ['shuttle', 'cctv', '24hr'], max_vehicle: 'suv', available: true },
    { id: 4, title: 'Loop District Open Lot', type: 'lot', address: '55 W Monroe St, Chicago', lat: 41.8806, lon: -87.6298, price_hourly: 6, price_daily: 28, price_monthly: 150, rating: 4.5, review_count: 67, instant_book: true, features: ['lighting'], max_vehicle: 'compact', available: true },
    { id: 5, title: 'Navy Pier Gated Spot', type: 'covered', address: '600 E Grand Ave, Chicago', lat: 41.8917, lon: -87.6054, price_hourly: 10, price_daily: 42, price_monthly: 240, rating: 4.9, review_count: 203, instant_book: false, features: ['gated', 'covered', 'lighting'], max_vehicle: 'suv', available: true },
  ]

  let filtered = listings
  if (type && type !== 'all') filtered = filtered.filter(l => l.type === type)
  if (min_price) filtered = filtered.filter(l => l.price_hourly >= parseInt(min_price))
  if (max_price) filtered = filtered.filter(l => l.price_hourly <= parseInt(max_price))
  if (q) filtered = filtered.filter(l => l.title.toLowerCase().includes(q.toLowerCase()) || l.address.toLowerCase().includes(q.toLowerCase()))

  const start = parseInt(offset)
  const end   = start + parseInt(limit)
  return c.json({ data: filtered.slice(start, end), total: filtered.length, limit: parseInt(limit), offset: start, has_more: end < filtered.length })
})

apiRoutes.get('/listings/:id', (c) => {
  const id = parseInt(c.req.param('id'))
  return c.json({
    id,
    title: 'Secure Covered Garage',
    type: 'garage',
    address: '120 S Michigan Ave, Chicago, IL 60603',
    lat: 41.8819, lon: -87.6278,
    price_hourly: 12, price_daily: 55, price_monthly: 320,
    rating: 4.9, review_count: 142,
    instant_book: true,
    host: { id: 'h1', name: 'Jennifer K.', rating: 4.95, response_time: '< 1 hour', joined: '2023-01-15' },
    features: ['cctv', 'covered', 'ev_charging', 'gated', '24hr', 'lighting'],
    max_vehicle: 'suv',
    cancellation_policy: 'free_1hr',
    description: 'Premium covered garage space in the heart of downtown Chicago.',
    photos: [],
    available: true
  })
})

apiRoutes.get('/listings/:id/availability', (c) => {
  const id = c.req.param('id')
  return c.json({
    listing_id: id,
    available_slots: [
      { date: '2026-03-10', start: '08:00', end: '18:00', available: true },
      { date: '2026-03-11', start: '06:00', end: '22:00', available: true },
      { date: '2026-03-12', start: '09:00', end: '17:00', available: true },
    ],
    unavailable_dates: ['2026-03-07', '2026-03-08', '2026-03-14']
  })
})

// ════════════════════════════════════════════════════════════════════════════
// BOOKINGS (mock until D1 fully wired)
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.post('/bookings', async (c) => {
  const body = await c.req.json().catch(() => ({})) as any
  const { listing_id, start_datetime, end_datetime, vehicle_plate } = body

  if (!listing_id || !start_datetime || !end_datetime) {
    return c.json({ error: 'Missing required fields' }, 400)
  }

  const start     = new Date(start_datetime)
  const end       = new Date(end_datetime)
  const hours     = Math.max(1, Math.round((end.getTime() - start.getTime()) / 3600000))
  const base      = 12 * hours
  const fee       = Math.round(base * 0.15 * 100) / 100
  const total     = Math.round((base + fee) * 100) / 100
  const bookingId = 'PP-' + new Date().getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000)

  return c.json({
    id: bookingId, listing_id, start_datetime, end_datetime, hours,
    vehicle_plate: vehicle_plate || null,
    pricing: { base, service_fee: fee, total },
    status: 'pending_payment',
    created_at: new Date().toISOString()
  }, 201)
})

apiRoutes.get('/bookings', (c) => {
  return c.json({
    data: [
      { id: 'PP-2026-8741', listing_title: 'Secure Covered Garage', start_datetime: new Date().toISOString(), end_datetime: new Date(Date.now() + 4*3600000).toISOString(), status: 'active', total: 58.08 },
      { id: 'PP-2026-8740', listing_title: 'Wrigley Driveway', start_datetime: new Date(Date.now() - 86400000).toISOString(), end_datetime: new Date(Date.now() - 82800000).toISOString(), status: 'completed', total: 32 },
    ],
    total: 2
  })
})

// ════════════════════════════════════════════════════════════════════════════
// REVIEWS
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.get('/reviews/listing/:id', (c) => {
  return c.json({
    data: [
      { id: 'r1', reviewer: 'David L.', rating: 5, comment: 'Exactly as described. Clean, safe, easy to find.', created_at: '2026-02-28T10:00:00Z' },
      { id: 'r2', reviewer: 'Priya S.', rating: 5, comment: 'Best parking in the area for the price.', created_at: '2026-02-20T14:00:00Z' },
      { id: 'r3', reviewer: 'Carlos M.', rating: 4, comment: 'Great spot, easy access.', created_at: '2026-02-15T09:00:00Z' },
    ],
    average_rating: 4.9, total: 3,
    breakdown: { 5: 72, 4: 45, 3: 18, 2: 5, 1: 2 }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// EARNINGS ESTIMATE
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.get('/estimate-earnings', (c) => {
  const { type = 'driveway', hours_per_day = '8', days_per_week = '5' } = c.req.query()
  const rates: Record<string, number> = { driveway: 6, garage: 12, lot: 8, airport: 14 }
  const rate   = rates[type] || 6
  const h      = parseInt(hours_per_day)
  const d      = parseInt(days_per_week)
  const weekly = rate * h * d * 0.65 * 0.85
  const monthly= weekly * 4.33
  return c.json({ type, rate_per_hour: rate, hours_per_day: h, days_per_week: d,
    weekly_estimate: Math.round(weekly), monthly_estimate: Math.round(monthly), yearly_estimate: Math.round(monthly * 12) })
})

// ════════════════════════════════════════════════════════════════════════════
// ADMIN STATS
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.get('/admin/stats', (c) => {
  return c.json({
    revenue_mtd: 0, bookings_mtd: 0, active_users: 0,
    platform_fees_mtd: 0, active_listings: 0, pending_listings: 0,
    open_disputes: 0, fraud_alerts: 0, cities: 0, uptime: 99.99
  })
})
