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
import {
  smsSendBookingConfirmation,
  smsSendHostAlert,
  smsSendCancellation,
  smsSendOTP,
  smsSendPaymentFailed,
  smsSendDisputeAlert,
  verifyTwilioSignature
} from '../services/twilio'

type Bindings = {
  DB: D1Database
  MEDIA: R2Bucket
  STRIPE_SECRET_KEY: string
  TWILIO_ACCOUNT_SID: string
  TWILIO_AUTH_TOKEN: string
  TWILIO_PHONE_NUMBER: string
  STRIPE_PUBLISHABLE_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  RESEND_API_KEY: string
  FROM_EMAIL: string
  ADMIN_USERNAME: string
  ADMIN_PASSWORD: string
  ADMIN_TOKEN_SECRET: string
  MAPBOX_TOKEN: string
  OPENAI_API_KEY: string
  OPENAI_BASE_URL: string
}

export const apiRoutes = new Hono<{ Bindings: Bindings }>()

// ════════════════════════════════════════════════════════════════════════════
// PLATFORM STATS — real D1 aggregates for homepage
// GET /api/platform/stats
// Returns: total_spots, total_hosts, total_cities, total_earnings
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.get('/platform/stats', async (c) => {
  const db = c.env?.DB
  const zero = { total_spots: 0, total_hosts: 0, total_cities: 0, total_earnings: 0, source: 'fallback' }
  if (!db) return c.json(zero)

  try {
    const [spots, hosts, cities, earnings] = await Promise.all([
      // Active listing count
      db.prepare("SELECT COUNT(*) as n FROM listings WHERE status = 'active'")
        .first<{ n: number }>(),
      // Distinct hosts with active listings
      db.prepare("SELECT COUNT(DISTINCT host_id) as n FROM listings WHERE status = 'active'")
        .first<{ n: number }>(),
      // Distinct cities with active listings
      db.prepare("SELECT COUNT(DISTINCT city) as n FROM listings WHERE status = 'active'")
        .first<{ n: number }>(),
      // Total paid-out host earnings (sum of host_payout on succeeded payments)
      db.prepare("SELECT COALESCE(SUM(host_payout), 0) as n FROM payments WHERE status = 'succeeded'")
        .first<{ n: number }>(),
    ])

    return c.json({
      total_spots:    spots?.n    ?? 0,
      total_hosts:    hosts?.n    ?? 0,
      total_cities:   cities?.n   ?? 0,
      total_earnings: earnings?.n ?? 0,
      source: 'd1'
    })
  } catch (e: any) {
    console.error('[platform/stats]', e.message)
    return c.json(zero)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// FEATURED LISTINGS — top-rated active listings for homepage
// GET /api/platform/featured?limit=4
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.get('/platform/featured', async (c) => {
  const db  = c.env?.DB
  const lim = Math.min(12, parseInt(c.req.query('limit') || '4'))
  if (!db) return c.json({ data: [], source: 'fallback' })

  try {
    const rows = await db.prepare(`
      SELECT l.id, l.title, l.type, l.address, l.city, l.state,
             l.lat, l.lng,
             l.rate_hourly, l.rate_daily,
             l.avg_rating, l.review_count,
             l.instant_book, l.amenities,
             l.max_vehicle_size,
             u.full_name as host_name
      FROM listings l
      LEFT JOIN users u ON l.host_id = u.id
      WHERE l.status = 'active'
      ORDER BY l.avg_rating DESC, l.review_count DESC, l.created_at DESC
      LIMIT ?
    `).bind(lim).all<any>()

    const data = (rows.results || []).map((r: any) => {
      let amenities: string[] = []
      try { amenities = JSON.parse(r.amenities || '[]') } catch {}
      return {
        id:           r.id,
        title:        r.title,
        type:         r.type,
        address:      r.address,
        city:         r.city,
        state:        r.state,
        lat:          r.lat,
        lng:          r.lng,
        price_hourly: r.rate_hourly,
        price_daily:  r.rate_daily,
        rating:       r.avg_rating,
        review_count: r.review_count,
        instant_book: r.instant_book === 1,
        amenities,
        host:         r.host_name,
      }
    })
    return c.json({ data, source: 'd1' })
  } catch (e: any) {
    console.error('[platform/featured]', e.message)
    return c.json({ data: [], source: 'error' })
  }
})

// ════════════════════════════════════════════════════════════════════════════
// CITY BREAKDOWN — active listing counts per city
// GET /api/platform/cities
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.get('/platform/cities', async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ data: [], source: 'fallback' })

  try {
    const rows = await db.prepare(`
      SELECT city, state, COUNT(*) as spot_count
      FROM listings
      WHERE status = 'active'
      GROUP BY city, state
      ORDER BY spot_count DESC
      LIMIT 10
    `).all<any>()

    return c.json({ data: rows.results || [], source: 'd1' })
  } catch (e: any) {
    return c.json({ data: [], source: 'error' })
  }
})

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
      resend:     (env?.RESEND_API_KEY && env.RESEND_API_KEY !== 'PLACEHOLDER_RESEND_KEY') ? 'configured' : 'placeholder',
      twilio:       env?.TWILIO_ACCOUNT_SID ? 'configured' : 'not configured',
      ai_chat:      env?.OPENAI_API_KEY ? 'configured' : 'not configured',
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// MAP CONFIG — returns Mapbox public token safely from env
// GET /api/map/config
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.get('/map/config', (c) => {
  return c.json({
    mapbox_token: c.env?.MAPBOX_TOKEN || '',
    has_token: !!(c.env?.MAPBOX_TOKEN)
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

    // Send confirmation emails + SMS in parallel
    const listingTitle   = 'Parking Space'  // TODO: fetch from D1
    const listingAddress = 'Chicago, IL'
    const startFormatted = new Date(start_datetime).toLocaleString('en-US')
    const endFormatted   = new Date(end_datetime).toLocaleString('en-US')

    await Promise.all([
      sendBookingConfirmation(env as any, {
        driverEmail: driver_email,
        driverName: driver_name || driver_email,
        bookingId,
        listingTitle,
        listingAddress,
        startTime: startFormatted,
        endTime:   endFormatted,
        totalCharged: amountPaid,
        vehiclePlate: vehicle_plate || 'Not provided'
      }),
      sendPaymentReceipt(env as any, {
        toEmail: driver_email,
        toName:  driver_name || driver_email,
        bookingId,
        amount: amountPaid,
        last4:  pi.payment_method_details?.card?.last4,
        listingTitle
      }),
      // SMS confirmation — only if phone provided
      body.driver_phone ? smsSendBookingConfirmation(env as any, {
        toPhone: body.driver_phone,
        driverName: driver_name || 'Driver',
        bookingId,
        listingTitle,
        listingAddress,
        startTime: startFormatted,
        endTime:   endFormatted,
        totalCharged: amountPaid
      }) : Promise.resolve(true)
    ])

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
      await Promise.all([
        sendCancellationEmail(env as any, {
          toEmail: requester_email,
          toName:  requester_name || requester_email,
          bookingId: booking_id || 0,
          listingTitle: 'Your Parking Space',
          refundAmount,
          cancelledBy: 'user'
        }),
        body.requester_phone ? smsSendCancellation(env as any, {
          toPhone: body.requester_phone,
          bookingId: booking_id || 0,
          listingTitle: 'Your Parking Space',
          refundAmount,
          cancelledBy: 'user'
        }) : Promise.resolve(true)
      ])
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
// RESEND — Send welcome email (called after signup)
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
// LISTINGS — Real D1 data with geo-filtering
// GET /api/listings?q=&type=&city=&lat=&lng=&radius_km=&min_price=&max_price=&instant=&limit=&offset=
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.get('/listings', async (c) => {
  const {
    q, type, city, lat, lng,
    radius_km = '50',
    min_price, max_price,
    instant,
    limit = '50', offset = '0'
  } = c.req.query()

  const db = c.env?.DB
  if (!db) {
    // Fallback static data if D1 not bound
    return c.json({ data: [], total: 0, limit: 50, offset: 0, has_more: false, source: 'fallback' })
  }

  try {
    let where: string[] = ["l.status = 'active'"]
    const params: any[] = []

    if (type && type !== 'all') { where.push('l.type = ?'); params.push(type) }
    if (city) { where.push("(l.city LIKE ? OR l.state LIKE ?)"); params.push(`%${city}%`); params.push(`%${city}%`) }
    if (min_price) { where.push('l.rate_hourly >= ?'); params.push(parseFloat(min_price)) }
    if (max_price) { where.push('l.rate_hourly <= ?'); params.push(parseFloat(max_price)) }
    if (instant === '1' || instant === 'true') { where.push('l.instant_book = 1') }
    if (q) {
      where.push("(l.title LIKE ? OR l.address LIKE ? OR l.city LIKE ? OR l.description LIKE ?)")
      const ql = `%${q}%`
      params.push(ql, ql, ql, ql)
    }

    // Geo-radius filter using Haversine approximation (SQLite-friendly)
    if (lat && lng) {
      const latF = parseFloat(lat)
      const lngF = parseFloat(lng)
      const km   = parseFloat(radius_km)
      const latDelta = km / 111.0
      const lngDelta = km / (111.0 * Math.cos(latF * Math.PI / 180))
      where.push('l.lat BETWEEN ? AND ? AND l.lng BETWEEN ? AND ?')
      params.push(latF - latDelta, latF + latDelta, lngF - lngDelta, lngF + lngDelta)
    }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : ''
    const lim  = Math.min(100, parseInt(limit))
    const off  = parseInt(offset)

    const countQ  = await db.prepare(`SELECT COUNT(*) as total FROM listings l ${whereClause}`).bind(...params).first<{total:number}>()
    const total   = countQ?.total ?? 0

    const rows = await db.prepare(`
      SELECT l.id, l.title, l.type, l.address, l.city, l.state, l.zip,
             l.lat, l.lng,
             l.rate_hourly, l.rate_daily, l.rate_monthly,
             l.max_vehicle_size, l.amenities, l.instant_book,
             l.avg_rating, l.review_count, l.status,
             u.full_name as host_name, u.id as host_id
      FROM listings l
      LEFT JOIN users u ON l.host_id = u.id
      ${whereClause}
      ORDER BY l.avg_rating DESC, l.review_count DESC
      LIMIT ? OFFSET ?
    `).bind(...params, lim, off).all()

    const data = (rows.results || []).map((r: any) => {
      let amenities: string[] = []
      try { amenities = JSON.parse(r.amenities || '[]') } catch {}
      return {
        id: r.id,
        title: r.title,
        type: r.type,
        address: r.address,
        city: r.city,
        state: r.state,
        lat: r.lat,
        lng: r.lng,
        price_hourly: r.rate_hourly,
        price_daily: r.rate_daily,
        price_monthly: r.rate_monthly,
        max_vehicle: r.max_vehicle_size,
        amenities,
        instant_book: r.instant_book === 1,
        rating: r.avg_rating,
        review_count: r.review_count,
        host: { id: r.host_id, name: r.host_name },
        available: true
      }
    })

    return c.json({ data, total, limit: lim, offset: off, has_more: off + lim < total, source: 'd1' })
  } catch (e: any) {
    console.error('[API] listings error:', e.message)
    return c.json({ error: 'Failed to fetch listings', detail: e.message }, 500)
  }
})

// GET /api/listings/:id — full listing detail from D1
apiRoutes.get('/listings/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const db = c.env?.DB

  if (!db) {
    return c.json({ error: 'Database not available' }, 503)
  }

  try {
    const row = await db.prepare(`
      SELECT l.*, u.full_name as host_name, u.id as host_id
      FROM listings l
      LEFT JOIN users u ON l.host_id = u.id
      WHERE l.id = ?
    `).bind(id).first<any>()

    if (!row) return c.json({ error: 'Listing not found' }, 404)

    let amenities: string[] = []
    try { amenities = JSON.parse(row.amenities || '[]') } catch {}

    return c.json({
      id: row.id,
      title: row.title,
      type: row.type,
      description: row.description,
      address: row.address,
      city: row.city,
      state: row.state,
      zip: row.zip,
      lat: row.lat,
      lng: row.lng,
      price_hourly: row.rate_hourly,
      price_daily: row.rate_daily,
      price_monthly: row.rate_monthly,
      max_vehicle: row.max_vehicle_size,
      amenities,
      instant_book: row.instant_book === 1,
      rating: row.avg_rating,
      review_count: row.review_count,
      host: {
        id: row.host_id,
        name: row.host_name,
        response_time: '< 1 hour'
      },
      cancellation_policy: 'free_1hr',
      photos: [],
      available: row.status === 'active'
    })
  } catch (e: any) {
    console.error('[API] listing/:id error:', e.message)
    return c.json({ error: 'Failed to fetch listing' }, 500)
  }
})

apiRoutes.get('/listings/:id/availability', async (c) => {
  const id = c.req.param('id')
  const db = c.env?.DB

  // Get blocked dates from availability_blocks
  let unavailable_dates: string[] = []
  if (db) {
    try {
      const blocks = await db.prepare(`
        SELECT date(start_time) as d FROM availability_blocks
        WHERE listing_id = ? AND end_time > datetime('now')
      `).bind(id).all<{d:string}>()
      unavailable_dates = (blocks.results || []).map((b: any) => b.d)
    } catch {}
  }

  // Generate next 7 available dates
  const available_slots = []
  const today = new Date()
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const ds = d.toISOString().split('T')[0]
    if (!unavailable_dates.includes(ds)) {
      available_slots.push({ date: ds, start: '06:00', end: '22:00', available: true })
    }
  }

  return c.json({ listing_id: id, available_slots, unavailable_dates })
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
// ADMIN STATS — real D1 counts
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.get('/admin/stats', async (c) => {
  const db = c.env?.DB
  if (!db) {
    return c.json({ revenue_mtd: 0, bookings_mtd: 0, active_users: 0, platform_fees_mtd: 0, active_listings: 0, pending_listings: 0, open_disputes: 0, fraud_alerts: 0, cities: 0, uptime: 99.99 })
  }
  try {
    const [users, listings, pending, disputes] = await Promise.all([
      db.prepare("SELECT COUNT(*) as n FROM users WHERE status='active'").first<{n:number}>(),
      db.prepare("SELECT COUNT(*) as n FROM listings WHERE status='active'").first<{n:number}>(),
      db.prepare("SELECT COUNT(*) as n FROM listings WHERE status='pending'").first<{n:number}>(),
      db.prepare("SELECT COUNT(*) as n FROM disputes WHERE status='open'").first<{n:number}>(),
    ])
    const cities = await db.prepare("SELECT COUNT(DISTINCT city) as n FROM listings WHERE status='active'").first<{n:number}>()
    return c.json({
      revenue_mtd: 0, bookings_mtd: 0,
      active_users: users?.n ?? 0,
      platform_fees_mtd: 0,
      active_listings: listings?.n ?? 0,
      pending_listings: pending?.n ?? 0,
      open_disputes: disputes?.n ?? 0,
      fraud_alerts: 0,
      cities: cities?.n ?? 0,
      uptime: 99.99
    })
  } catch {
    return c.json({ revenue_mtd: 0, bookings_mtd: 0, active_users: 0, platform_fees_mtd: 0, active_listings: 0, pending_listings: 0, open_disputes: 0, fraud_alerts: 0, cities: 0, uptime: 99.99 })
  }
})

// ════════════════════════════════════════════════════════════════════════════
// TWILIO — Send OTP
// POST /api/sms/otp
// Body: { phone }
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.post('/sms/otp', async (c) => {
  const env = c.env
  if (!env?.TWILIO_ACCOUNT_SID) {
    return c.json({ error: 'SMS not configured' }, 503)
  }

  let body: any = {}
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { phone } = body
  if (!phone) return c.json({ error: 'Missing phone number' }, 400)

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString()

  const ok = await smsSendOTP(env as any, { toPhone: phone, otp })
  if (!ok) return c.json({ error: 'Failed to send OTP' }, 500)

  // In production: store hashed OTP in D1/KV with 10-min TTL
  // For now return success (OTP sent via SMS)
  return c.json({ success: true, message: 'OTP sent' })
})

// ════════════════════════════════════════════════════════════════════════════
// TWILIO WEBHOOK — Incoming SMS
// POST /api/webhooks/twilio/sms
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.post('/webhooks/twilio/sms', async (c) => {
  const env = c.env

  // Parse form body from Twilio
  const text = await c.req.text()
  const params: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(text)) {
    params[k] = v
  }

  const from = params['From'] || ''
  const body = params['Body']?.trim().toUpperCase() || ''

  console.log(`[Twilio SMS] From: ${from} Body: "${body}"`)

  // Simple keyword auto-replies
  let reply = ''
  if (body === 'HELP') {
    reply = 'ParkPeer Help: Reply STOP to unsubscribe. Visit parkpeer.pages.dev/dashboard to manage your bookings. Questions? Email support@parkpeer.pages.dev'
  } else if (body === 'STOP' || body === 'UNSUBSCRIBE') {
    reply = 'You have been unsubscribed from ParkPeer SMS notifications. Reply START to re-subscribe.'
  } else if (body === 'START') {
    reply = 'Welcome back! ParkPeer SMS notifications re-enabled. Visit parkpeer.pages.dev to manage bookings.'
  } else {
    reply = 'Thanks for contacting ParkPeer! Visit parkpeer.pages.dev/dashboard to manage your bookings or reply HELP for assistance.'
  }

  // Respond with TwiML
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${reply}</Message></Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  )
})

// ════════════════════════════════════════════════════════════════════════════
// TWILIO WEBHOOK — SMS Status Callback
// POST /api/webhooks/twilio/status
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.post('/webhooks/twilio/status', async (c) => {
  const text = await c.req.text()
  const params: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(text)) {
    params[k] = v
  }

  const sid    = params['MessageSid'] || ''
  const status = params['MessageStatus'] || ''
  console.log(`[Twilio Status] SID: ${sid} → ${status}`)

  // TODO: update SMS delivery status in D1
  return c.json({ received: true })
})

// ════════════════════════════════════════════════════════════════════════════
// TWILIO WEBHOOK — Voice (fallback)
// POST /api/webhooks/twilio/voice
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.post('/webhooks/twilio/voice', async (c) => {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Welcome to ParkPeer. For support, please visit parkpeer dot pages dot dev or send us a text message.</Say></Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  )
})

// ════════════════════════════════════════════════════════════════════════════
// AI SUPPORT CHAT
// POST /api/chat
//
// Body:  { messages: [{role:'user'|'assistant', content:string}], sessionId?:string }
// Returns: { reply: string }
//
// Security:
//   • API key stored only in env — never exposed to frontend
//   • Rate limit: 20 requests / IP / minute (in-memory sliding window)
//   • Prompt injection guard: strips control characters, limits input length
//   • Response max tokens: 400 (keeps answers concise)
//   • Error logging omits all PII
//
// Future-ready hooks (marked TODO):
//   • Live listing lookup from D1
//   • Booking status lookup
//   • Admin monitoring / chat-log storage in D1
// ════════════════════════════════════════════════════════════════════════════

// ── In-memory rate-limit store (resets on Worker restart, good enough for CF) ─
const RL_WINDOW_MS = 60_000   // 1 minute window
const RL_MAX       = 20       // max requests per IP per window

interface RLEntry { count: number; windowStart: number }
const rateLimitStore = new Map<string, RLEntry>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitStore.get(ip)
  if (!entry || now - entry.windowStart > RL_WINDOW_MS) {
    rateLimitStore.set(ip, { count: 1, windowStart: now })
    return false
  }
  if (entry.count >= RL_MAX) return true
  entry.count++
  return false
}

// ── Prompt injection / safety guard ───────────────────────────────────────
const BLOCKED_PATTERNS = [
  /ignore (previous|above|all) instructions/i,
  /you are now/i,
  /pretend (you are|to be)/i,
  /act as (a|an)\s+\w/i,
  /\bsystem\s*:/i,
  /\bDAN\b/i,
  /jailbreak/i,
]

function sanitizeInput(text: string): string | null {
  // Strip null bytes & Unicode control chars, collapse whitespace
  const clean = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim()
  if (clean.length === 0 || clean.length > 800) return null
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(clean)) return null
  }
  return clean
}

// ── ParkPeer system prompt ─────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the ParkPeer Support Assistant — a friendly, helpful, concise, and professional AI assistant built exclusively for the ParkPeer peer-to-peer parking marketplace.

PERSONALITY
• Warm, approachable, and encouraging — use short sentences and a conversational tone.
• Professional: no slang, no emojis, no exclamation-point spam.
• Concise: keep answers under 120 words unless a step-by-step guide is necessary.

SCOPE — ONLY answer questions about:
1. Finding & booking parking on ParkPeer (search, filters, map, booking flow)
2. Listing a parking space as a host (how to list, pricing tips, availability settings)
3. Payments & pricing (how billing works, platform fee of ~15%, payout timeline)
4. Cancellation policy (drivers: free cancel ≥1 hr before; hosts: free cancel ≥24 hr before)
5. Host earnings (65 % of booking revenue after platform fee, weekly payouts via Stripe)
6. Account & onboarding for both drivers and hosts
7. Safety & trust features (verified profiles, secure payments via Stripe, host protection)
8. General platform FAQs

HARD RULES — NEVER:
• Mention or compare any competitor (SpotHero, ParkWhiz, ParkingPanda, Airbnb, etc.)
• Give legal, tax, insurance, or financial advice
• Access, guess at, or fabricate specific user data, bookings, or account details
• Claim to be a human
• Respond to requests outside ParkPeer's scope — politely redirect instead
• Use placeholder or made-up statistics

DRIVER SIGN-UP CTA: When a user asks about finding parking, mention they can sign up free at /auth/register.
HOST SIGN-UP CTA: When a user asks about listing a space, mention they can start hosting at /host.

STEP-BY-STEP GUIDES (use numbered lists):
• Booking a spot: 1) Search by address or landmark → 2) Pick dates & times → 3) Choose a listing → 4) Pay securely via Stripe → 5) Get confirmation with directions.
• Listing a space: 1) Go to /host → 2) Add your address & photos → 3) Set your rate & availability → 4) Publish — you're live!

FALLBACK: If you are unsure, say "I'm not sure about that — please email support@parkpeer.com for help."

Remember: You represent ParkPeer and must always be helpful, honest, and on-brand.`

// ── Route handler ──────────────────────────────────────────────────────────
apiRoutes.post('/chat', async (c) => {
  // 1. Rate limiting
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
  if (isRateLimited(ip)) {
    return c.json({ error: 'Too many requests — please wait a moment and try again.' }, 429)
  }

  // 2. Parse & validate body
  let body: { messages?: Array<{ role: string; content: string }>; sessionId?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid request body.' }, 400)
  }

  const rawMessages = body.messages
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return c.json({ error: 'messages array is required.' }, 400)
  }

  // 3. Sanitize and validate each message (keep last 10 for context window)
  const recent = rawMessages.slice(-10)
  const safeMessages: Array<{ role: string; content: string }> = []

  for (const msg of recent) {
    if (!msg || typeof msg.content !== 'string') continue
    const role = msg.role === 'assistant' ? 'assistant' : 'user'

    if (role === 'user') {
      const safe = sanitizeInput(msg.content)
      if (!safe) {
        // Blocked message — return a polite refusal immediately
        return c.json({
          reply: "I'm sorry, I can only help with ParkPeer-related questions. Is there something about finding or listing parking I can assist with?"
        })
      }
      safeMessages.push({ role: 'user', content: safe })
    } else {
      // Assistant history — truncate only, no injection risk
      safeMessages.push({ role: 'assistant', content: msg.content.slice(0, 800) })
    }
  }

  if (safeMessages.length === 0) {
    return c.json({ error: 'No valid messages.' }, 400)
  }

  // 4. Check OpenAI key — try c.env first, then globalThis (CF Pages fallback)
  const apiKey  = c.env?.OPENAI_API_KEY || (globalThis as Record<string, string>)['OPENAI_API_KEY'] || ''
  const baseURL = c.env?.OPENAI_BASE_URL || (globalThis as Record<string, string>)['OPENAI_BASE_URL'] || 'https://www.genspark.ai/api/llm_proxy/v1'

  if (!apiKey) {
    console.error('[Chat] OPENAI_API_KEY not configured')
    return c.json({
      reply: "I'm temporarily unavailable. Please email support@parkpeer.com for help."
    })
  }

  // 5. TODO: Live listing lookup hook
  //    const lastUserMsg = safeMessages.filter(m => m.role === 'user').at(-1)?.content ?? ''
  //    if (/available|listing|spot|price/i.test(lastUserMsg) && c.env?.DB) {
  //      const rows = await c.env.DB.prepare("SELECT title, city, rate_hourly FROM listings WHERE status='active' LIMIT 5").all()
  //      — inject rows as additional context message
  //    }

  // 5. TODO: Booking lookup hook
  //    if (/my booking|booking id|PP-\d/i.test(lastUserMsg)) {
  //      — lookup booking from D1 by user session (once auth is implemented)
  //    }

  // 5. TODO: Chat-log storage (admin monitoring)
  //    await c.env?.DB?.prepare("INSERT INTO chat_logs (session_id, messages_json, created_at) VALUES (?,?,?)")
  //      .bind(body.sessionId || 'anon', JSON.stringify(safeMessages), new Date().toISOString()).run()

  // 6. Call OpenAI-compatible endpoint
  try {
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model:       'gpt-5-mini',
        messages:    [{ role: 'system', content: SYSTEM_PROMPT }, ...safeMessages],
        max_tokens:  400,
        temperature: 0.55,
        top_p:       0.9,
      }),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      // Log without PII
      console.error('[Chat] OpenAI error ' + response.status + ': ' + errText.slice(0, 200))
      return c.json({
        reply: "I'm having trouble connecting right now. Please try again in a moment or email support@parkpeer.com."
      })
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }

    const reply = data?.choices?.[0]?.message?.content?.trim() || ''
    if (!reply) {
      return c.json({ reply: "I couldn't generate a response. Please try rephrasing your question." })
    }

    // Enforce max length on our side too (belt-and-suspenders)
    const truncated = reply.length > 1200 ? reply.slice(0, 1200) + '…' : reply

    return c.json({ reply: truncated })

  } catch (err) {
    console.error('[Chat] Fetch error:', (err as Error).message?.slice(0, 100))
    return c.json({
      reply: "I'm temporarily unavailable. Please email support@parkpeer.com for help."
    })
  }
})
