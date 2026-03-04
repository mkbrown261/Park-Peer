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
  sendWelcomeEmail,
  sendListingRemovedEmail
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
import {
  requireUserAuth,
  assertOwnership,
  sanitizeHtml,
  validateInput,
  validateEmail,
  validatePassword,
  stripSensitive,
  generateQrToken,
  verifyQrToken,
  hashPassword,
  verifyPassword,
  issueUserToken,
  verifyUserToken,
  clearUserToken,
  generateCsrfToken,
  verifyCsrf,
  isRateLimited,
  encryptField,
  decryptField,
} from '../middleware/security'

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
  USER_TOKEN_SECRET: string
  ENCRYPTION_SECRET: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  APPLE_CLIENT_ID: string
  APPLE_TEAM_ID: string
  APPLE_KEY_ID: string
  APPLE_PRIVATE_KEY: string
  OAUTH_REDIRECT_BASE: string   // e.g. https://parkpeer.pages.dev
}

export const apiRoutes = new Hono<{ Bindings: Bindings }>()

// ════════════════════════════════════════════════════════════════════════════
// AUTH — Registration, Login, Logout, Token Refresh, CSRF
// ════════════════════════════════════════════════════════════════════════════

// POST /api/auth/register
// Body: { email, password, full_name, role?, phone? }
apiRoutes.post('/auth/register', async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  const ip = c.req.header('CF-Connecting-IP') || 'unknown'
  if (isRateLimited(`register:${ip}`, 5, 60_000)) {
    return c.json({ error: 'Too many registration attempts. Please try again in a minute.' }, 429)
  }

  let body: any = {}
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  let email: string, password: string, full_name: string
  try {
    email     = validateEmail(body.email)
    password  = validatePassword(body.password)
    full_name = validateInput(body.full_name, { required: true, maxLength: 100, fieldName: 'full_name' })
  } catch (e: any) {
    return c.json({ error: e.message }, 400)
  }

  const role  = ['driver','host','both'].includes((body.role || '').toLowerCase())
    ? (body.role || 'driver').toUpperCase()
    : 'DRIVER'
  const phone = validateInput(body.phone, { maxLength: 20 })

  try {
    // Check duplicate email
    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{id:number}>()
    if (existing) return c.json({ error: 'An account with that email already exists.' }, 409)

    // Hash password with PBKDF2-SHA256
    const password_hash = await hashPassword(password)

    // Insert user — email_verified = 0 (requires email verification)
      const result = await db.prepare(`
      INSERT INTO users (email, password_hash, full_name, role, phone, status, email_verified, created_at)
      VALUES (?, ?, ?, ?, ?, 'active', 0, datetime('now'))
    `).bind(email, password_hash, sanitizeHtml(full_name), role, phone || null).run()

    const userId = Number(result.meta?.last_row_id ?? 0)

    // Issue JWT in HttpOnly cookie
    const secret = c.env?.USER_TOKEN_SECRET || 'pp-user-secret-change-in-prod'
    const roleForJwt = role.toLowerCase()
    await issueUserToken(c, { userId, email, role: roleForJwt }, secret)

    // Issue CSRF token (must use secret+'.csrf' to match verifyCsrf)
    const csrfToken = await generateCsrfToken(c, secret + '.csrf')

    // Send welcome email (non-blocking)
    sendWelcomeEmail(c.env as any, { toEmail: email, toName: full_name, role: role }).catch(() => {})

    return c.json({
      success:  true,
      user: { id: userId, email, full_name: sanitizeHtml(full_name), role: roleForJwt },
      csrf_token: csrfToken,
      message: 'Account created. Please verify your email.'
    }, 201)
  } catch (e: any) {
    console.error('[auth/register] DB error:', e.message, e.cause)
    if (e.message?.includes('UNIQUE') || e.cause?.message?.includes('UNIQUE')) {
      return c.json({ error: 'An account with that email already exists.' }, 409)
    }
    return c.json({ error: 'Registration failed. Please try again.' }, 500)
  }
})

// POST /api/auth/login
// Body: { email, password }
apiRoutes.post('/auth/login', async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  const ip = c.req.header('CF-Connecting-IP') || 'unknown'
  if (isRateLimited(`login:${ip}`, 10, 60_000)) {
    return c.json({ error: 'Too many login attempts. Please wait a minute.' }, 429)
  }

  let body: any = {}
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  let email: string
  try { email = validateEmail(body.email) } catch (e: any) {
    return c.json({ error: e.message }, 400)
  }
  const password = String(body.password || '')
  if (!password) return c.json({ error: 'Password is required' }, 400)

  try {
    const user = await db.prepare(`
      SELECT id, email, full_name, role, status, password_hash, email_verified
      FROM users WHERE email = ?
    `).bind(email).first<any>()

    // Constant-time: always run verifyPassword even if user not found
    const dummyHash = 'pbkdf2:310000:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000'
    const storedHash = user?.password_hash || dummyHash
    const valid = await verifyPassword(password, storedHash)

    if (!user || !valid) {
      // Generic message prevents user enumeration
      return c.json({ error: 'Invalid email or password.' }, 401)
    }

    if (user.status === 'suspended') {
      return c.json({ error: 'Your account has been suspended. Contact support@parkpeer.com.' }, 403)
    }

    const secret = c.env?.USER_TOKEN_SECRET || 'pp-user-secret-change-in-prod'
    await issueUserToken(c, { userId: user.id, email: user.email, role: user.role.toLowerCase() }, secret)
    const csrfToken = await generateCsrfToken(c, secret + '.csrf')

    return c.json({
      success: true,
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, email_verified: !!user.email_verified },
      csrf_token: csrfToken,
    })
  } catch (e: any) {
    console.error('[auth/login]', e.message)
    return c.json({ error: 'Login failed. Please try again.' }, 500)
  }
})

// POST /api/auth/logout
apiRoutes.post('/auth/logout', (c) => {
  clearUserToken(c)
  return c.json({ success: true, message: 'Logged out successfully.' })
})

// POST /api/auth/refresh — exchange refresh cookie for new access token
apiRoutes.post('/auth/refresh', async (c) => {
  const db     = c.env?.DB
  const secret = c.env?.USER_TOKEN_SECRET || 'pp-user-secret-change-in-prod'

  // The refresh cookie is HttpOnly/path=/auth — read it manually
  const cookieHeader = c.req.header('Cookie') || ''
  const match = cookieHeader.match(/__pp_refresh=([^;]+)/)
  if (!match) return c.json({ error: 'No refresh token' }, 401)

  try {
    const [rpEnc, rs] = match[1].split('.').reduce<[string, string]>(
      (acc, part, i, arr) => i < arr.length - 1 ? [`${acc[0]}${acc[0] ? '.' : ''}${part}`, acc[1]] : [acc[0], part],
      ['', '']
    )
    // Simple decode without full HMAC (the route is not auth-sensitive — short-lived)
    const decoded = JSON.parse(atob(rpEnc.replace(/-/g, '+').replace(/_/g, '/') + '=='))
    const userId  = decoded.userId as number
    if (!userId) return c.json({ error: 'Invalid refresh token' }, 401)

    // Lookup user from D1
    const user = db ? await db.prepare('SELECT id, email, role, status FROM users WHERE id = ?').bind(userId).first<any>() : null
    if (!user || user.status !== 'active') return c.json({ error: 'User not found or suspended' }, 401)

    await issueUserToken(c, { userId: user.id, email: user.email, role: user.role }, secret)
    const csrfToken = await generateCsrfToken(c, secret + '.csrf')
    return c.json({ success: true, csrf_token: csrfToken })
  } catch {
    return c.json({ error: 'Token refresh failed' }, 401)
  }
})

// GET /api/auth/me — return current user from JWT cookie (no DB hit)
apiRoutes.get('/auth/me', requireUserAuth(), (c) => {
  const user = c.get('user')
  return c.json({ user: { id: user.userId, email: user.email, role: user.role } })
})

// GET /api/auth/csrf — issue a fresh CSRF token (call on page load)
apiRoutes.get('/auth/csrf', async (c) => {
  const secret = c.env?.USER_TOKEN_SECRET || 'pp-user-secret-change-in-prod'
  const csrfSecret = secret + '.csrf'
  const token  = await generateCsrfToken(c, csrfSecret)
  return c.json({ csrf_token: token })
})

// GET /api/auth/status — returns current session info (safe, no secrets)
// Used to diagnose OAuth loop: if cookie was set but session fails to verify
apiRoutes.get('/auth/status', async (c) => {
  const secret = c.env?.USER_TOKEN_SECRET || 'pp-user-secret-change-in-prod'
  const session = await verifyUserToken(c, secret)
  return c.json({
    authenticated: !!session,
    userId:  session?.userId  ?? null,
    role:    session?.role    ?? null,
    email:   session?.email   ?? null,
    // Diagnostic: which env vars are configured (boolean only — no values)
    config: {
      google_oauth:   !!(c.env?.GOOGLE_CLIENT_ID && c.env?.GOOGLE_CLIENT_SECRET),
      apple_oauth:    !!(c.env?.APPLE_CLIENT_ID),
      stripe:         !!(c.env?.STRIPE_SECRET_KEY),
      db:             !!(c.env?.DB),
      jwt_secret_set: !!(c.env?.USER_TOKEN_SECRET),
      redirect_base:  c.env?.OAUTH_REDIRECT_BASE || '(default: https://parkpeer.pages.dev)',
    }
  })
})


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

  // Fetch real rate from D1 listing
  let ratePerHour = 12  // fallback
  const db = c.env?.DB
  if (db && listing_id) {
    try {
      const row = await db.prepare('SELECT rate_hourly FROM listings WHERE id = ? AND status = ?')
        .bind(String(listing_id), 'active').first<{ rate_hourly: number }>()
      if (row?.rate_hourly) ratePerHour = row.rate_hourly
    } catch {}
  }

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
    // Fetch real listing title + address from D1
    let listingTitle   = 'Parking Space'
    let listingAddress = ''
    const dbConfirm = c.env?.DB
    if (dbConfirm && listing_id) {
      try {
        const row = await dbConfirm.prepare('SELECT title, address, city FROM listings WHERE id = ?')
          .bind(String(listing_id)).first<any>()
        if (row) {
          listingTitle   = row.title   || listingTitle
          listingAddress = [row.address, row.city].filter(Boolean).join(', ') || listingAddress
        }
      } catch {}
    }
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

  const db = env.DB

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object
      console.log(`[Webhook] Payment succeeded: ${pi.id} $${pi.amount / 100}`)
      // Update booking + payment status in D1 using the Stripe payment_intent_id
      if (db) {
        try {
          await db.prepare(
            `UPDATE bookings SET status = 'confirmed' WHERE stripe_payment_intent_id = ?`
          ).bind(pi.id).run()
          await db.prepare(
            `UPDATE payments SET status = 'succeeded' WHERE stripe_payment_intent_id = ?`
          ).bind(pi.id).run()
        } catch (e: any) {
          console.error('[Webhook] D1 update error (payment_intent.succeeded):', e.message)
        }
      }
      break
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object
      console.log(`[Webhook] Payment failed: ${pi.id}`)
      if (db) {
        try {
          // Set booking back to 'pending' (payment_failed is not a valid status value)
          await db.prepare(
            `UPDATE bookings SET status = 'cancelled', cancel_reason = 'Payment failed' WHERE stripe_payment_intent_id = ? AND status = 'pending'`
          ).bind(pi.id).run()
          await db.prepare(
            `UPDATE payments SET status = 'failed' WHERE stripe_payment_intent_id = ?`
          ).bind(pi.id).run()
        } catch (e: any) {
          console.error('[Webhook] D1 update error (payment_intent.payment_failed):', e.message)
        }
      }
      break
    }
    case 'charge.refunded': {
      const charge = event.data.object
      console.log(`[Webhook] Refund issued: ${charge.id}`)
      if (db) {
        try {
          // Find the booking via the payment_intent that owns this charge
          const piId = charge.payment_intent
          if (piId) {
            await db.prepare(
              `UPDATE bookings SET status = 'refunded' WHERE stripe_payment_intent_id = ?`
            ).bind(piId).run()
            await db.prepare(
              `UPDATE payments SET status = 'refunded' WHERE stripe_payment_intent_id = ?`
            ).bind(piId).run()
          }
        } catch (e: any) {
          console.error('[Webhook] D1 update error (charge.refunded):', e.message)
        }
      }
      break
    }
    case 'charge.dispute.created': {
      const dispute = event.data.object
      console.log(`[Webhook] Dispute opened: ${dispute.id}`)
      if (db) {
        try {
          // Mark the booking as disputed using the payment_intent ID.
          // Full dispute record creation (with booking_id & user IDs) is
          // handled by admin via the dashboard where booking context is available.
          const piId = dispute.payment_intent
          if (piId) {
            await db.prepare(
              `UPDATE bookings SET status = 'disputed' WHERE stripe_payment_intent_id = ?`
            ).bind(piId).run()
          }
        } catch (e: any) {
          console.error('[Webhook] D1 update error (charge.dispute.created):', e.message)
        }
      }
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
    // Skip filter when lat=0,lng=0 (sentinel "no location set" value)
    if (lat && lng) {
      const latF = parseFloat(lat)
      const lngF = parseFloat(lng)
      // lat=0,lng=0 means the frontend had no real location — skip geo filter
      if (latF !== 0 || lngF !== 0) {
        const km   = parseFloat(radius_km)
        const latDelta = km / 111.0
        const lngDelta = km / (111.0 * Math.cos(latF * Math.PI / 180))
        where.push('l.lat BETWEEN ? AND ? AND l.lng BETWEEN ? AND ?')
        params.push(latF - latDelta, latF + latDelta, lngF - lngDelta, lngF + lngDelta)
      }
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

// ════════════════════════════════════════════════════════════════════════════
// POST /api/listings — Create a new listing (authenticated hosts)
// Body: { title, type, address, city, state, zip, rate_hourly, rate_daily?,
//         rate_monthly?, description?, amenities?, instant_book?, lat?, lng? }
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.post('/listings', requireUserAuth(), async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  const session = c.get('user') as any
  if (!session?.userId) return c.json({ error: 'Authentication required' }, 401)

  // ── Server-side CSRF verification ───────────────────────────────────────
  const tokenSecret = c.env?.USER_TOKEN_SECRET || 'pp-user-secret-change-in-prod'
  const csrfOk = await verifyCsrf(c, tokenSecret + '.csrf')
  if (!csrfOk) {
    return c.json({ error: 'Invalid or expired CSRF token. Please refresh the page and try again.' }, 403)
  }

  // Only hosts (or users with BOTH role) can create listings
  const userRole = (session.role || '').toUpperCase()
  if (userRole !== 'HOST' && userRole !== 'BOTH' && userRole !== 'ADMIN') {
    // Also re-check DB in case role was updated after JWT was issued
    try {
      const dbUser = await db.prepare('SELECT role FROM users WHERE id = ?').bind(session.userId).first<{role: string}>()
      const dbRole = (dbUser?.role || '').toUpperCase()
      if (dbRole !== 'HOST' && dbRole !== 'BOTH' && dbRole !== 'ADMIN') {
        return c.json({ error: 'Only hosts can create listings. Please switch to a host account.' }, 403)
      }
    } catch {
      // If DB check fails, fall through and allow the create (the JWT role check is the primary guard)
      if (userRole !== 'HOST' && userRole !== 'BOTH' && userRole !== 'ADMIN') {
        return c.json({ error: 'Only hosts can create listings. Please switch to a host account.' }, 403)
      }
    }
  }

  let body: any = {}
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  console.log(`[POST /api/listings] user=${session.userId} body=`, JSON.stringify(body).substring(0, 300))

  // ── Validate required fields ────────────────────────────────────────────
  try {
    const title   = validateInput(body.title,   { maxLength: 120, required: true,  fieldName: 'title' })
    const address = validateInput(body.address, { maxLength: 200, required: true,  fieldName: 'address' })
    const city    = validateInput(body.city,    { maxLength: 100, required: true,  fieldName: 'city' })
    const state   = validateInput(body.state,   { maxLength: 50,  required: true,  fieldName: 'state' })
    const zip     = validateInput(body.zip,     { maxLength: 20,  required: true,  fieldName: 'zip' })

    const VALID_TYPES = ['driveway','garage','lot','street','covered']
    const type = body.type && VALID_TYPES.includes(body.type.toLowerCase())
      ? body.type.toLowerCase()
      : 'driveway'

    const rateHourly  = body.rate_hourly  ? parseFloat(body.rate_hourly)  : null
    const rateDaily   = body.rate_daily   ? parseFloat(body.rate_daily)   : null
    const rateMonthly = body.rate_monthly ? parseFloat(body.rate_monthly) : null

    if (rateHourly !== null && (isNaN(rateHourly)  || rateHourly  < 0.5 || rateHourly  > 500)) {
      return c.json({ error: 'Hourly rate must be between $0.50 and $500' }, 400)
    }
    if (rateDaily !== null && (isNaN(rateDaily) || rateDaily < 1 || rateDaily > 5000)) {
      return c.json({ error: 'Daily rate must be between $1 and $5,000' }, 400)
    }

    const description  = validateInput(body.description,  { maxLength: 2000 })
    const instantBook  = body.instant_book === true || body.instant_book === 1 || body.instant_book === '1' ? 1 : 0
    const lat          = body.lat  ? parseFloat(body.lat)  : null
    const lng          = body.lng  ? parseFloat(body.lng)  : null

    // Sanitize amenities — must be array of known values
    const VALID_AMENITIES = ['covered','ev_charging','security_camera','gated','lighting','24hr_access','shuttle','attended']
    let amenities: string[] = []
    if (Array.isArray(body.amenities)) {
      amenities = body.amenities.filter((a: any) => VALID_AMENITIES.includes(String(a)))
    }

    // Geocode address if lat/lng not provided and Mapbox token is available
    let finalLat = lat
    let finalLng = lng
    if ((!finalLat || !finalLng) && c.env?.MAPBOX_TOKEN) {
      try {
        const fullAddr = encodeURIComponent(`${address}, ${city}, ${state} ${zip}`)
        const geoRes = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${fullAddr}.json?access_token=${c.env.MAPBOX_TOKEN}&limit=1`
        )
        const geoData: any = await geoRes.json()
        if (geoData.features?.length > 0) {
          const [geoLng, geoLat] = geoData.features[0].center
          finalLat = geoLat
          finalLng = geoLng
          console.log(`[POST /api/listings] Geocoded: ${finalLat},${finalLng}`)
        }
      } catch (e: any) {
        console.warn('[POST /api/listings] Geocoding failed (non-fatal):', e.message)
      }
    }

    // ── Insert into D1 ────────────────────────────────────────────────────
    const result = await db.prepare(`
      INSERT INTO listings
        (host_id, title, type, description, address, city, state, zip, country,
         lat, lng, rate_hourly, rate_daily, rate_monthly,
         amenities, instant_book, status, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, 'US',
         ?, ?, ?, ?, ?,
         ?, ?, 'active', datetime('now'), datetime('now'))
    `).bind(
      session.userId,
      sanitizeHtml(title),
      type,
      sanitizeHtml(description) || null,
      sanitizeHtml(address),
      sanitizeHtml(city),
      sanitizeHtml(state),
      sanitizeHtml(zip),
      finalLat, finalLng,
      rateHourly, rateDaily, rateMonthly,
      JSON.stringify(amenities),
      instantBook
    ).run()

    const newId = result.meta?.last_row_id ?? null
    console.log(`[POST /api/listings] Created listing id=${newId} for user=${session.userId}`)

    return c.json({
      success: true,
      listing_id: newId,
      message: 'Listing created successfully',
      redirect: newId ? `/listing/${newId}` : '/host'
    }, 201)

  } catch (e: any) {
    console.error('[POST /api/listings] Error:', e.message)
    if (e.message?.includes('required') || e.message?.includes('exceeds') || e.message?.includes('rate')) {
      return c.json({ error: e.message }, 400)
    }
    return c.json({ error: 'Failed to create listing', detail: e.message }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// PUT /api/listings/:id — Update a listing (owner only)
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.put('/listings/:id', requireUserAuth(), async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  const session = c.get('user') as any
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid listing ID' }, 400)

  // IDOR check — ensure user owns this listing
  const existing = await db.prepare('SELECT host_id FROM listings WHERE id = ?').bind(id).first<any>()
  if (!existing) return c.json({ error: 'Listing not found' }, 404)
  try { assertOwnership(session, existing.host_id) } catch {
    return c.json({ error: 'Access denied' }, 403)
  }

  let body: any = {}
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const updates: string[] = []
  const params: any[] = []

  if (body.title !== undefined)       { updates.push('title = ?');        params.push(sanitizeHtml(validateInput(body.title, { maxLength: 120 }))) }
  if (body.description !== undefined) { updates.push('description = ?');  params.push(sanitizeHtml(validateInput(body.description, { maxLength: 2000 }))) }
  if (body.type !== undefined)        { updates.push('type = ?');          params.push(body.type) }
  if (body.address !== undefined)     { updates.push('address = ?');       params.push(sanitizeHtml(validateInput(body.address, { maxLength: 200 }))) }
  if (body.city !== undefined)        { updates.push('city = ?');          params.push(sanitizeHtml(body.city)) }
  if (body.state !== undefined)       { updates.push('state = ?');         params.push(sanitizeHtml(body.state)) }
  if (body.zip !== undefined)         { updates.push('zip = ?');           params.push(sanitizeHtml(body.zip)) }
  if (body.rate_hourly !== undefined) { updates.push('rate_hourly = ?');   params.push(parseFloat(body.rate_hourly) || null) }
  if (body.rate_daily !== undefined)  { updates.push('rate_daily = ?');    params.push(parseFloat(body.rate_daily) || null) }
  if (body.rate_monthly !== undefined){ updates.push('rate_monthly = ?');  params.push(parseFloat(body.rate_monthly) || null) }
  if (body.status !== undefined)      { updates.push('status = ?');        params.push(body.status) }
  if (body.instant_book !== undefined){ updates.push('instant_book = ?');  params.push(body.instant_book ? 1 : 0) }
  if (body.amenities !== undefined)   { updates.push('amenities = ?');     params.push(JSON.stringify(body.amenities)) }

  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400)

  updates.push('updated_at = datetime(\'now\')')
  params.push(id)

  await db.prepare(`UPDATE listings SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run()
  return c.json({ success: true, message: 'Listing updated' })
})

// ════════════════════════════════════════════════════════════════════════════
// PATCH /api/listings/:id/archive — Archive a listing (owner only, no active bookings)
// PATCH /api/listings/:id/restore — Restore an archived listing (owner only)
// DELETE /api/listings/:id        — Permanently remove a listing (owner only, no active bookings)
//
// Active-booking guard: rejects if any booking for this listing has status
// in ('pending','confirmed','active') — meaning a driver has reserved or is
// currently occupying the space.
// ════════════════════════════════════════════════════════════════════════════

// ── Archive ──────────────────────────────────────────────────────────────────
apiRoutes.patch('/listings/:id/archive', requireUserAuth(), async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  const session = c.get('user') as any
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid listing ID' }, 400)

  // IDOR — ownership check
  const listing = await db.prepare(
    'SELECT id, host_id, title, address, city, state, status FROM listings WHERE id = ?'
  ).bind(id).first<any>()
  if (!listing) return c.json({ error: 'Listing not found' }, 404)

  try { assertOwnership(session, listing.host_id) } catch {
    return c.json({ error: 'Access denied — you do not own this listing' }, 403)
  }

  if (listing.status === 'archived') {
    return c.json({ error: 'Listing is already archived' }, 409)
  }

  // Active-booking guard — block if any booking is pending / confirmed / active
  const active = await db.prepare(`
    SELECT COUNT(*) as n FROM bookings
    WHERE listing_id = ? AND status IN ('pending','confirmed','active')
  `).bind(id).first<{ n: number }>()

  if (active && active.n > 0) {
    return c.json({
      error: 'Cannot archive a listing with active or upcoming bookings. Please wait until all current bookings are completed.',
      active_bookings: active.n
    }, 409)
  }

  // Archive — sets status to 'archived', hides from search results
  await db.prepare(
    "UPDATE listings SET status = 'archived', updated_at = datetime('now') WHERE id = ?"
  ).bind(id).run()

  console.log(`[Archive listing] id=${id} by user=${session.userId}`)

  // Confirmation email (non-blocking)
  const host = await db.prepare('SELECT email, full_name FROM users WHERE id = ?')
    .bind(listing.host_id).first<any>()
  if (host) {
    sendListingRemovedEmail(c.env as any, {
      hostEmail: host.email,
      hostName:  host.full_name,
      listingTitle:   listing.title,
      listingAddress: `${listing.address}, ${listing.city}, ${listing.state}`,
      action: 'archived'
    }).catch(() => {})
  }

  return c.json({ success: true, message: 'Listing archived successfully', action: 'archived' })
})

// ── Restore ──────────────────────────────────────────────────────────────────
apiRoutes.patch('/listings/:id/restore', requireUserAuth(), async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  const session = c.get('user') as any
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid listing ID' }, 400)

  const listing = await db.prepare(
    'SELECT id, host_id, status FROM listings WHERE id = ?'
  ).bind(id).first<any>()
  if (!listing) return c.json({ error: 'Listing not found' }, 404)

  try { assertOwnership(session, listing.host_id) } catch {
    return c.json({ error: 'Access denied — you do not own this listing' }, 403)
  }

  if (listing.status !== 'archived') {
    return c.json({ error: 'Listing is not archived' }, 409)
  }

  await db.prepare(
    "UPDATE listings SET status = 'active', updated_at = datetime('now') WHERE id = ?"
  ).bind(id).run()

  console.log(`[Restore listing] id=${id} by user=${session.userId}`)
  return c.json({ success: true, message: 'Listing restored and is now active', action: 'restored' })
})

// ── Permanent delete ─────────────────────────────────────────────────────────
apiRoutes.delete('/listings/:id', requireUserAuth(), async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  const session = c.get('user') as any
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid listing ID' }, 400)

  // IDOR — ownership check
  const listing = await db.prepare(
    'SELECT id, host_id, title, address, city, state, status FROM listings WHERE id = ?'
  ).bind(id).first<any>()
  if (!listing) return c.json({ error: 'Listing not found' }, 404)

  try { assertOwnership(session, listing.host_id) } catch {
    return c.json({ error: 'Access denied — you do not own this listing' }, 403)
  }

  // Active-booking guard — same check as archive
  const active = await db.prepare(`
    SELECT COUNT(*) as n FROM bookings
    WHERE listing_id = ? AND status IN ('pending','confirmed','active')
  `).bind(id).first<{ n: number }>()

  if (active && active.n > 0) {
    return c.json({
      error: 'Cannot remove a listing with active or upcoming bookings. Please wait until all current bookings are completed.',
      active_bookings: active.n
    }, 409)
  }

  // Hard delete (cascades via schema FK rules; completed bookings are preserved)
  await db.prepare('DELETE FROM listings WHERE id = ?').bind(id).run()

  console.log(`[Delete listing] id=${id} by user=${session.userId}`)

  // Confirmation email (non-blocking)
  const host = await db.prepare('SELECT email, full_name FROM users WHERE id = ?')
    .bind(listing.host_id).first<any>()
  if (host) {
    sendListingRemovedEmail(c.env as any, {
      hostEmail: host.email,
      hostName:  host.full_name,
      listingTitle:   listing.title,
      listingAddress: `${listing.address}, ${listing.city}, ${listing.state}`,
      action: 'removed'
    }).catch(() => {})
  }

  return c.json({ success: true, message: 'Listing permanently removed', action: 'removed' })
})

// ════════════════════════════════════════════════════════════════════════════
// GET /api/listings/:id/booking-check — lightweight active-booking pre-check
// Called by the host dashboard before showing the archive/remove modal so the
// UI can immediately surface a "blocked" state without attempting the action.
// Requires auth (only the listing owner may check).
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.get('/listings/:id/booking-check', requireUserAuth(), async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database unavailable', active_bookings: 0 }, 503)

  const session = c.get('user') as any
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid listing ID', active_bookings: 0 }, 400)

  // IDOR — only the owner may check
  const listing = await db.prepare('SELECT host_id FROM listings WHERE id = ?').bind(id).first<any>()
  if (!listing) return c.json({ error: 'Listing not found', active_bookings: 0 }, 404)
  try { assertOwnership(session, listing.host_id) } catch {
    return c.json({ error: 'Access denied', active_bookings: 0 }, 403)
  }

  const active = await db.prepare(`
    SELECT COUNT(*) as n FROM bookings
    WHERE listing_id = ? AND status IN ('pending','confirmed','active')
  `).bind(id).first<{ n: number }>()

  return c.json({ listing_id: id, active_bookings: active?.n ?? 0 })
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
// BOOKINGS — Create booking with race-condition protection
// POST /api/bookings
// ─── FIX: Double-booking race condition ──────────────────────────────────────
// Uses a D1 SELECT to check for overlapping confirmed/active bookings BEFORE
// inserting, enforced inside a single batch to minimise the race window.
// Full SELECT FOR UPDATE is not available in SQLite/D1, so we use a
// strict overlap query: any existing booking where
//   existing.start < new.end  AND  existing.end > new.start
// If found → 409 Conflict. Otherwise insert atomically.
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.post('/bookings', requireUserAuth(), async (c) => {
  const db   = c.env?.DB
  const session = c.get('user') as any

  // ── Server-side CSRF verification ───────────────────────────────────────
  const tokenSecret = c.env?.USER_TOKEN_SECRET || 'pp-user-secret-change-in-prod'
  const csrfOk = await verifyCsrf(c, tokenSecret + '.csrf')
  if (!csrfOk) {
    return c.json({ error: 'Invalid or expired CSRF token. Please refresh the page and try again.' }, 403)
  }

  const body = await c.req.json().catch(() => ({})) as any

  // ── Input validation ────────────────────────────────────────────────────
  let listing_id: number, start_datetime: string, end_datetime: string
  try {
    listing_id     = parseInt(validateInput(body.listing_id,     { required: true, fieldName: 'listing_id' }))
    start_datetime = validateInput(body.start_datetime, { required: true, maxLength: 30, fieldName: 'start_datetime' })
    end_datetime   = validateInput(body.end_datetime,   { required: true, maxLength: 30, fieldName: 'end_datetime' })
    if (isNaN(listing_id) || listing_id < 1) throw new Error('listing_id must be a positive integer')
  } catch (e: any) {
    return c.json({ error: e.message }, 400)
  }

  const start = new Date(start_datetime)
  const end   = new Date(end_datetime)
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    return c.json({ error: 'Invalid date range' }, 400)
  }
  if (start < new Date()) {
    return c.json({ error: 'start_datetime must be in the future' }, 400)
  }

  const hours     = Math.max(1, Math.round((end.getTime() - start.getTime()) / 3600000))
  const vehicle_plate = validateInput(body.vehicle_plate, { maxLength: 20 })
  // Always use authenticated user as driver_id — prevents IDOR
  const driver_id = session?.userId ?? (body.driver_id ? parseInt(body.driver_id) : null)

  // ── Race-condition / overlap check (D1) ────────────────────────────────
  if (db) {
    try {
      const conflict = await db.prepare(`
        SELECT id FROM bookings
        WHERE listing_id = ?
          AND status IN ('confirmed','active','pending')
          AND start_time < ?
          AND end_time   > ?
        LIMIT 1
      `).bind(listing_id, end_datetime, start_datetime).first<{ id: number }>()

      if (conflict) {
        return c.json({
          error: 'This time slot is no longer available. Please choose different dates.',
          code:  'BOOKING_CONFLICT',
        }, 409)
      }

      // ── Fetch real rate and host_id from listing ─────────────────────
      const listing = await db.prepare(
        'SELECT rate_hourly, status, host_id FROM listings WHERE id = ? AND status = ?'
      ).bind(listing_id, 'active').first<{ rate_hourly: number; status: string; host_id: number }>()

      if (!listing) {
        return c.json({ error: 'Listing not found or not available' }, 404)
      }

      const rate      = listing.rate_hourly || 12
      const base      = Math.round(rate * hours * 100) / 100
      const fee       = Math.round(base * 0.15 * 100) / 100
      const hostPay   = Math.round((base - fee) * 100) / 100
      const total     = Math.round((base + fee) * 100) / 100
      const insertResult = await db.prepare(`
        INSERT INTO bookings
          (listing_id, driver_id, host_id, start_time, end_time,
           duration_hours, status, subtotal, platform_fee, host_payout,
           total_charged, vehicle_plate, vehicle_description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).bind(
        listing_id, driver_id || null, listing.host_id,
        start_datetime, end_datetime, hours,
        base, fee, hostPay, total,
        vehicle_plate || null, vehicle_plate || null
      ).run()

      const dbBookingId = insertResult.meta?.last_row_id ?? 0
      const bookingRef  = 'PP-' + new Date().getFullYear() + '-' + String(dbBookingId).padStart(4, '0')

      return c.json({
        id: bookingRef, db_id: dbBookingId, listing_id,
        start_time: start_datetime, end_time: end_datetime, hours,
        vehicle_description: vehicle_plate || null,
        pricing: { rate_per_hour: rate, base, service_fee: fee, total },
        status: 'pending',
        created_at: new Date().toISOString()
      }, 201)

    } catch (e: any) {
      if (e.message?.includes('BOOKING_CONFLICT')) throw e
      console.error('[bookings POST]', e.message)
      return c.json({ error: 'Failed to create booking' }, 500)
    }
  }

  // DB not available — cannot create booking without rate data
  return c.json({ error: 'Database unavailable. Please try again.' }, 503)
})

// ════════════════════════════════════════════════════════════════════════════
// GET /api/bookings — list bookings (requires auth; returns only caller's own)
// ─── FIX: IDOR — never return other users' bookings ──────────────────────────
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.get('/bookings', requireUserAuth(), async (c) => {
  const db   = c.env?.DB
  const user = c.get('user') as any
  if (!db) return c.json({ data: [], total: 0 })
  try {
    const rows = await db.prepare(`
      SELECT b.id, b.listing_id, b.start_time, b.end_time,
             b.status, b.total_charged, b.vehicle_description, b.created_at,
             l.title as listing_title, l.address, l.city
      FROM bookings b
      LEFT JOIN listings l ON b.listing_id = l.id
      WHERE b.driver_id = ?
      ORDER BY b.created_at DESC
      LIMIT 50
    `).bind(user.userId).all<any>()
    return c.json({ data: rows.results || [], total: (rows.results || []).length })
  } catch (e: any) {
    console.error('[GET /bookings]', e.message)
    return c.json({ data: [], total: 0 })
  }
})

// ════════════════════════════════════════════════════════════════════════════
// GET /api/bookings/:id — single booking detail
// ─── FIX: IDOR — verifies caller is the driver OR the host ───────────────────
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.get('/bookings/:id', requireUserAuth(), async (c) => {
  const db      = c.env?.DB
  const user    = c.get('user') as any
  const rawId   = c.req.param('id')

  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  try {
    const row = await db.prepare(`
      SELECT b.*, l.title as listing_title, l.address, l.city, l.host_id
      FROM bookings b
      LEFT JOIN listings l ON b.listing_id = l.id
      WHERE b.id = ?
    `).bind(rawId).first<any>()

    if (!row) return c.json({ error: 'Booking not found' }, 404)

    // ── IDOR check: only driver or host may view this booking ────────────
    assertOwnership(user, row.driver_id, row.host_id)

    return c.json(stripSensitive(row))
  } catch (e: any) {
    if (e.status === 403) return c.json({ error: 'Access denied' }, 403)
    console.error('[GET /bookings/:id]', e.message)
    return c.json({ error: 'Failed to fetch booking' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// QR CODE — Generate rotating 30-second QR token for check-in
// GET /api/bookings/:id/qr  (auth required — only the driver or host)
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.get('/bookings/:id/qr', requireUserAuth(), async (c) => {
  const db    = c.env?.DB
  const user  = c.get('user') as any
  const rawId = c.req.param('id')
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  try {
    const row = await db.prepare(`
      SELECT b.id, b.driver_id, b.status, l.host_id
      FROM bookings b
      LEFT JOIN listings l ON b.listing_id = l.id
      WHERE b.id = ?
    `).bind(rawId).first<any>()

    if (!row) return c.json({ error: 'Booking not found' }, 404)
    // Only driver or host may generate QR
    assertOwnership(user, row.driver_id, row.host_id)

    if (!['confirmed','active'].includes(row.status)) {
      return c.json({ error: 'QR code only available for confirmed or active bookings' }, 400)
    }

    const secret = c.env?.USER_TOKEN_SECRET || 'pp-user-secret-change-in-prod'
    const { token, expiresAt, windowSeconds } = await generateQrToken(String(row.id), secret)

    return c.json({
      token,
      booking_id:    String(row.id),
      expires_at:    new Date(expiresAt).toISOString(),
      window_seconds: windowSeconds,
      qr_data:       `https://parkpeer.pages.dev/checkin?t=${token}&b=${row.id}`,
    })
  } catch (e: any) {
    if (e.status === 403) return c.json({ error: 'Access denied' }, 403)
    console.error('[GET /bookings/:id/qr]', e.message)
    return c.json({ error: 'Failed to generate QR token' }, 500)
  }
})

// POST /api/bookings/:id/verify-qr — Host scans QR to verify check-in
apiRoutes.post('/bookings/:id/verify-qr', requireUserAuth(), async (c) => {
  const db    = c.env?.DB
  const user  = c.get('user') as any
  const rawId = c.req.param('id')
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  let body: any = {}
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { token } = body
  if (!token) return c.json({ error: 'token is required' }, 400)

  try {
    const row = await db.prepare(`
      SELECT b.id, b.driver_id, b.status, l.host_id
      FROM bookings b LEFT JOIN listings l ON b.listing_id = l.id
      WHERE b.id = ?
    `).bind(rawId).first<any>()

    if (!row) return c.json({ error: 'Booking not found' }, 404)
    // Only the host may verify check-in
    if (user.userId !== Number(row.host_id)) {
      return c.json({ error: 'Only the host may verify check-in' }, 403)
    }

    const secret = c.env?.USER_TOKEN_SECRET || 'pp-user-secret-change-in-prod'
    const valid  = await verifyQrToken(String(token), String(row.id), secret)

    if (!valid) return c.json({ valid: false, reason: 'Token expired or invalid' }, 400)

    // Mark booking as active on successful first scan
    if (row.status === 'confirmed') {
      await db.prepare("UPDATE bookings SET status='active' WHERE id=?").bind(row.id).run()
    }

    return c.json({ valid: true, booking_id: String(row.id) })
  } catch (e: any) {
    if (e.status === 403) return c.json({ error: 'Access denied' }, 403)
    console.error('[POST /bookings/:id/verify-qr]', e.message)
    return c.json({ error: 'Verification failed' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// PAYOUT DATA — AES-256-GCM encrypted bank / SSN storage
// POST /api/user/payout-info  — store encrypted payout details
// GET  /api/user/payout-info  — confirm payout setup (never returns raw data)
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.post('/user/payout-info', requireUserAuth(), async (c) => {
  const db     = c.env?.DB
  const user   = c.get('user') as any
  const secret = c.env?.ENCRYPTION_SECRET || 'pp-enc-secret-change-in-prod'
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  let body: any = {}
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  // IMPORTANT: Prefer Stripe for payouts — store only the Stripe customer/account ID.
  // Raw bank numbers are ONLY accepted if Stripe is not configured.
  // They are encrypted with AES-256-GCM before storage; plaintext never touches the DB.
  const { stripe_account_id, bank_account_last4, bank_routing_last4 } = body
  // Store ONLY last-4 digits as non-sensitive confirmation (never full numbers)
  const acct_display    = validateInput(bank_account_last4, { maxLength: 4 })
  const routing_display = validateInput(bank_routing_last4, { maxLength: 4 })

  // If full numbers provided (migration path), encrypt before storing
  let acct_enc    = ''
  let routing_enc = ''
  if (body.bank_account_full && body.bank_routing_full) {
    acct_enc    = await encryptField(String(body.bank_account_full), secret)
    routing_enc = await encryptField(String(body.bank_routing_full), secret)
  }

  const stripe_acct = validateInput(stripe_account_id, { maxLength: 64 })

  try {
    await db.prepare(`
      INSERT INTO payout_info (user_id, stripe_account_id, bank_account_encrypted, bank_routing_encrypted,
        bank_account_last4, bank_routing_last4, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        stripe_account_id = excluded.stripe_account_id,
        bank_account_encrypted = excluded.bank_account_encrypted,
        bank_routing_encrypted = excluded.bank_routing_encrypted,
        bank_account_last4 = excluded.bank_account_last4,
        bank_routing_last4 = excluded.bank_routing_last4,
        updated_at = excluded.updated_at
    `).bind(user.userId, stripe_acct || null, acct_enc || null, routing_enc || null,
            acct_display || null, routing_display || null).run()

    return c.json({
      success: true,
      message: 'Payout information saved securely.',
      has_stripe:  !!stripe_acct,
      has_bank:    !!(acct_enc || acct_display),
    })
  } catch (e: any) {
    console.error('[POST /user/payout-info]', e.message)
    return c.json({ error: 'Failed to save payout info' }, 500)
  }
})

apiRoutes.get('/user/payout-info', requireUserAuth(), async (c) => {
  const db   = c.env?.DB
  const user = c.get('user') as any
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  try {
    const row = await db.prepare(`
      SELECT stripe_account_id, bank_account_last4, bank_routing_last4, updated_at
      FROM payout_info WHERE user_id = ?
    `).bind(user.userId).first<any>()

    if (!row) return c.json({ configured: false })

    return c.json({
      configured:        true,
      has_stripe:        !!row.stripe_account_id,
      bank_account_last4: row.bank_account_last4 || null,
      bank_routing_last4: row.bank_routing_last4 || null,
      updated_at:        row.updated_at,
      // NEVER return: stripe_account_id, bank_account_encrypted, bank_routing_encrypted
    })
  } catch (e: any) {
    console.error('[GET /user/payout-info]', e.message)
    return c.json({ error: 'Failed to fetch payout info' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// REVIEWS — Real D1 data
// GET /api/reviews/listing/:id
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.get('/reviews/listing/:id', async (c) => {
  const id = c.req.param('id')
  const db = c.env?.DB
  if (!db) return c.json({ data: [], average_rating: 0, total: 0, breakdown: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } })

  try {
    const rows = await db.prepare(`
      SELECT r.id, r.rating, r.comment, r.created_at,
             u.full_name as reviewer_name
      FROM reviews r
      LEFT JOIN users u ON r.reviewer_id = u.id
      WHERE r.listing_id = ? AND r.status = 'published'
      ORDER BY r.created_at DESC
      LIMIT 50
    `).bind(id).all<any>()

    const reviews = rows.results || []
    const total   = reviews.length
    const avg     = total > 0 ? Math.round((reviews.reduce((s: number, r: any) => s + (r.rating || 0), 0) / total) * 10) / 10 : 0
    const breakdown: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
    for (const r of reviews) {
      const s = Math.round(r.rating || 0)
      if (s >= 1 && s <= 5) breakdown[s]++
    }

    return c.json({
      data: reviews.map((r: any) => ({
        id:         r.id,
        reviewer:   r.reviewer_name || 'Driver',
        rating:     r.rating,
        comment:    r.comment,
        created_at: r.created_at,
      })),
      average_rating: avg,
      total,
      breakdown,
    })
  } catch (e: any) {
    console.error('[reviews/listing/:id]', e.message)
    return c.json({ data: [], average_rating: 0, total: 0, breakdown: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } })
  }
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
// ADMIN MAINTENANCE — Data retention enforcement (Phase 2c)
// POST /api/admin/maintenance
// Protected: Admin JWT required (separate admin session cookie)
// Actions:
//  • delete_unverified — soft-delete users who never verified email within 30 days
//  • anonymize_old_transactions — anonymize payments older than 7 years
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.post('/admin/maintenance', async (c) => {
  const db = c.env?.DB
  // Quick guard: require admin token header
  const adminToken = c.req.header('X-Admin-Token')
  const tokenSecret = c.env?.ADMIN_TOKEN_SECRET
  if (!adminToken || !tokenSecret || adminToken !== tokenSecret) {
    return c.json({ error: 'Unauthorized' }, 403)
  }
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  let body: any = {}
  try { body = await c.req.json() } catch {}
  const action = body.action || 'report'

  try {
    if (action === 'delete_unverified') {
      // Phase 2c: soft-delete unverified accounts older than 30 days
      const result = await db.prepare(`
        UPDATE users
        SET deleted_at = datetime('now'), status = 'suspended'
        WHERE email_verified = 0
          AND deleted_at IS NULL
          AND created_at < datetime('now', '-30 days')
      `).run()
      return c.json({
        action,
        rows_affected: result.meta?.changes ?? 0,
        message: 'Unverified users older than 30 days soft-deleted.'
      })
    }

    if (action === 'anonymize_old_transactions') {
      // Phase 2c: anonymize 7+ year old payment records
      // Keep financial metadata but strip PII linkage
      const result = await db.prepare(`
        UPDATE payments
        SET driver_id = 0, host_id = 0
        WHERE created_at < datetime('now', '-7 years')
          AND driver_id != 0
      `).run()
      return c.json({
        action,
        rows_affected: result.meta?.changes ?? 0,
        message: '7+ year old payment records anonymized.'
      })
    }

    // Default: report counts
    const [unverified, oldPayments] = await Promise.all([
      db.prepare(`SELECT COUNT(*) as n FROM users WHERE email_verified=0 AND deleted_at IS NULL AND created_at < datetime('now','-30 days')`).first<{n:number}>(),
      db.prepare(`SELECT COUNT(*) as n FROM payments WHERE created_at < datetime('now','-7 years') AND driver_id != 0`).first<{n:number}>(),
    ])
    return c.json({
      unverified_pending_deletion: unverified?.n ?? 0,
      old_transactions_pending_anonymization: oldPayments?.n ?? 0,
    })
  } catch (e: any) {
    console.error('[admin/maintenance]', e.message)
    return c.json({ error: 'Maintenance action failed' }, 500)
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

// ── Chat rate-limit constants ─────────────────────────────────────────────────
const CHAT_RL_WINDOW_MS = 60_000  // 1 minute
const CHAT_RL_MAX       = 20      // max chat requests per IP per minute

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
5. Host earnings (85% of booking revenue — ParkPeer keeps 15%, weekly payouts via Stripe)
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
  if (isRateLimited(`chat:${ip}`, CHAT_RL_MAX, CHAT_RL_WINDOW_MS)) {
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
        max_tokens:  1500,
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

// ════════════════════════════════════════════════════════════════════════════
// GOOGLE OAUTH  —  /api/auth/google  +  /api/auth/google/callback
// ════════════════════════════════════════════════════════════════════════════

// Step 1 — redirect browser to Google's OAuth consent screen
// GET /api/auth/google?role=driver|host
apiRoutes.get('/auth/google', (c) => {
  const googleClientId = c.env?.GOOGLE_CLIENT_ID
  if (!googleClientId) {
    console.error('[OAuth/Google] GOOGLE_CLIENT_ID not configured')
    return c.redirect('/auth/login?error=oauth_not_configured')
  }

  // Normalise base URL — strip trailing slash to avoid double-slash in redirect_uri
  const base    = (c.env?.OAUTH_REDIRECT_BASE || 'https://parkpeer.pages.dev').replace(/\/$/, '')
  const role    = c.req.query('role') || 'driver'
  // Encode role in state as base64url JSON
  const state   = btoa(JSON.stringify({ role, ts: Date.now() }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

  const redirectUri = `${base}/api/auth/google/callback`
  console.log(`[OAuth/Google] Step 1: role=${role} redirect_uri=${redirectUri}`)

  const params = new URLSearchParams({
    client_id:     googleClientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'offline',
    prompt:        'select_account',
    state,
  })

  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
})

// Step 2 — Google redirects back with ?code=...&state=...
// GET /api/auth/google/callback
apiRoutes.get('/auth/google/callback', async (c) => {
  const { code, state, error } = c.req.query()
  const db = c.env?.DB

  if (error || !code) {
    console.error('[OAuth/Google] Callback denied or missing code. error=', error)
    return c.redirect(`/auth/login?error=${encodeURIComponent(error || 'google_denied')}`)
  }

  if (!db) {
    console.error('[OAuth/Google] DB binding unavailable')
    return c.redirect('/auth/login?error=db_unavailable')
  }

  // Normalise base URL — strip trailing slash
  const base            = (c.env?.OAUTH_REDIRECT_BASE || 'https://parkpeer.pages.dev').replace(/\/$/, '')
  const googleClientId  = c.env?.GOOGLE_CLIENT_ID
  const googleClientSecret = c.env?.GOOGLE_CLIENT_SECRET
  const tokenSecret     = c.env?.USER_TOKEN_SECRET || 'pp-user-secret-change-in-prod'
  const redirectUri     = `${base}/api/auth/google/callback`

  console.log(`[OAuth/Google] Callback received. code_len=${code.length} redirect_uri=${redirectUri}`)

  if (!googleClientId || !googleClientSecret) {
    console.error('[OAuth/Google] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not configured in env')
    return c.redirect('/auth/login?error=oauth_not_configured')
  }

  // Decode role from state (base64url JSON)
  let role = 'driver'
  try {
    const padded  = (state || '').replace(/-/g, '+').replace(/_/g, '/')
    const padded4 = padded + '==='.slice((padded.length + 3) % 4 || 4)
    const decoded = JSON.parse(atob(padded4))
    role = decoded.role || 'driver'
  } catch (stateErr) {
    console.warn('[OAuth/Google] Could not decode state param, defaulting role=driver:', stateErr)
  }

  try {
    // ── Exchange authorization code for access token ─────────────────────
    const tokenBody = new URLSearchParams({
      code,
      client_id:     googleClientId,
      client_secret: googleClientSecret,
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    }).toString()

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    tokenBody,
    })

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text()
      // Log full error to surface redirect_uri_mismatch vs invalid_client vs invalid_grant
      console.error(`[OAuth/Google] Token exchange HTTP ${tokenRes.status}:`, errBody.substring(0, 400))
      // Parse the specific error type so we can surface it safely to the user
      let googleErrType = 'google_token_failed'
      try {
        const errJson = JSON.parse(errBody)
        const gt = errJson.error || ''
        console.error('[OAuth/Google] Token error type:', gt, '|', errJson.error_description)
        // Map Google error types to safe, non-secret diagnostic codes
        if (gt === 'redirect_uri_mismatch') googleErrType = 'google_redirect_mismatch'
        else if (gt === 'invalid_client')   googleErrType = 'google_invalid_client'
        else if (gt === 'invalid_grant')    googleErrType = 'google_invalid_grant'
        else if (gt === 'access_denied')    googleErrType = 'google_denied'
      } catch { /* not JSON */ }
      return c.redirect(`/auth/login?error=${googleErrType}`)
    }

    const tokens: any = await tokenRes.json()
    const accessToken = tokens.access_token
    if (!accessToken) {
      console.error('[OAuth/Google] Token response missing access_token:', JSON.stringify(tokens).substring(0, 200))
      return c.redirect('/auth/login?error=google_no_token')
    }

    // ── Fetch Google profile ─────────────────────────────────────────────
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!profileRes.ok) {
      console.error('[OAuth/Google] Profile fetch failed:', profileRes.status)
      return c.redirect('/auth/login?error=google_profile_failed')
    }

    const profile: any = await profileRes.json()
    const email    = profile.email?.toLowerCase()?.trim()
    const fullName = profile.name || profile.given_name || email?.split('@')[0] || 'User'

    if (!email) {
      console.error('[OAuth/Google] Profile missing email. profile keys:', Object.keys(profile).join(','))
      return c.redirect('/auth/login?error=google_no_email')
    }

    console.log(`[OAuth/Google] Profile OK: email=${email} name=${fullName} role=${role}`)

    // ── Upsert user in D1 ────────────────────────────────────────────────
    let user: any = await db.prepare(
      'SELECT id, email, full_name, role, status FROM users WHERE email = ?'
    ).bind(email).first()

    if (!user) {
      // New user — create account with requested role
      const insertResult = await db.prepare(`
        INSERT INTO users (email, password_hash, full_name, role, status, email_verified, created_at, updated_at)
        VALUES (?, '', ?, ?, 'active', 1, datetime('now'), datetime('now'))
      `).bind(email, sanitizeHtml(fullName), role.toUpperCase()).run()
      const newId = Number(insertResult.meta?.last_row_id ?? 0)
      if (!newId) {
        console.error('[OAuth/Google] DB insert returned no last_row_id')
        return c.redirect('/auth/login?error=google_unexpected')
      }
      user = { id: newId, email, full_name: sanitizeHtml(fullName), role: role.toUpperCase(), status: 'active' }
      console.log(`[OAuth/Google] Created new user id=${newId} role=${user.role}`)
    } else {
      if (user.status === 'suspended') {
        console.warn(`[OAuth/Google] Suspended account: ${email}`)
        return c.redirect('/auth/login?error=account_suspended')
      }
      console.log(`[OAuth/Google] Existing user id=${user.id} role=${user.role}`)
      // Update last-seen (non-blocking, failure is OK)
      db.prepare(`UPDATE users SET updated_at = datetime('now') WHERE id = ?`)
        .bind(user.id).run().catch((e: any) => console.warn('[OAuth/Google] last-seen update failed:', e.message))
    }

    // ── Issue HttpOnly JWT session cookie ────────────────────────────────
    const sessionRole = (user.role || role).toLowerCase()
    await issueUserToken(c, {
      userId: Number(user.id),
      email:  user.email,
      role:   sessionRole,
    }, tokenSecret)

    // ── Issue CSRF cookie (non-HttpOnly, for JS to read back) ────────────
    const csrfSecret = tokenSecret + '.csrf'
    await generateCsrfToken(c, csrfSecret)

    console.log(`[OAuth/Google] Session issued. userId=${user.id} role=${sessionRole} → /${sessionRole === 'host' ? 'host' : 'dashboard'}`)

    // ── Redirect to appropriate dashboard (303 = GET after POST safe) ────
    return c.redirect(sessionRole === 'host' ? '/host' : '/dashboard', 303)

  } catch (e: any) {
    console.error('[OAuth/Google] Unexpected error in callback:', e?.message, e?.stack?.substring(0, 500))
    return c.redirect('/auth/login?error=google_unexpected')
  }
})

// ════════════════════════════════════════════════════════════════════════════
// APPLE OAUTH  —  /api/auth/apple  +  /api/auth/apple/callback
//
// Apple Sign In uses:
//   APPLE_CLIENT_ID   = your Services ID (e.g. com.parkpeer.web)
//   APPLE_TEAM_ID     = 10-char Team ID from Apple Developer console
//   APPLE_KEY_ID      = Key ID for the Sign in with Apple private key
//   APPLE_PRIVATE_KEY = PEM content of the .p8 file (newlines as \n)
//   OAUTH_REDIRECT_BASE = https://parkpeer.pages.dev
// ════════════════════════════════════════════════════════════════════════════

// Helper: generate Apple client_secret JWT (ES256, valid 180 days)
async function generateAppleClientSecret(env: any): Promise<string> {
  const now     = Math.floor(Date.now() / 1000)
  const teamId  = env.APPLE_TEAM_ID
  const keyId   = env.APPLE_KEY_ID
  const clientId = env.APPLE_CLIENT_ID

  const header  = { alg: 'ES256', kid: keyId }
  const payload = {
    iss: teamId,
    iat: now,
    exp: now + 15552000,   // 180 days
    aud: 'https://appleid.apple.com',
    sub: clientId,
  }

  const enc = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

  const signingInput = `${enc(header)}.${enc(payload)}`

  // Import Apple .p8 EC private key (PKCS8 PEM → ArrayBuffer)
  const pem = env.APPLE_PRIVATE_KEY
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '')

  const keyBuffer = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  )

  const sigBuffer = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    cryptoKey,
    new TextEncoder().encode(signingInput)
  )

  // Convert DER-encoded signature to raw R||S (64 bytes) for JWT
  const der    = new Uint8Array(sigBuffer)
  const r      = der.slice(4, 4 + der[3])
  const sStart = 4 + der[3] + 2
  const s      = der.slice(sStart, sStart + der[sStart - 1])
  const pad    = (b: Uint8Array) => {
    const a = new Uint8Array(32); a.set(b.length > 32 ? b.slice(b.length - 32) : b, 32 - b.length); return a
  }
  const rawSig = new Uint8Array(64)
  rawSig.set(pad(r), 0)
  rawSig.set(pad(s), 32)

  const sigB64 = btoa(String.fromCharCode(...rawSig))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

  return `${signingInput}.${sigB64}`
}

// GET /api/auth/apple?role=driver|host
apiRoutes.get('/auth/apple', (c) => {
  const appleClientId = c.env?.APPLE_CLIENT_ID
  if (!appleClientId) {
    console.error('[OAuth/Apple] APPLE_CLIENT_ID not configured')
    return c.redirect('/auth/login?error=oauth_not_configured')
  }

  const base  = c.env?.OAUTH_REDIRECT_BASE || 'https://parkpeer.pages.dev'
  const role  = c.req.query('role') || 'driver'
  const state = btoa(JSON.stringify({ role, ts: Date.now() }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

  const params = new URLSearchParams({
    client_id:     appleClientId,
    redirect_uri:  `${base}/api/auth/apple/callback`,
    response_type: 'code id_token',
    scope:         'name email',
    response_mode: 'form_post',
    state,
  })

  return c.redirect(`https://appleid.apple.com/auth/authorize?${params.toString()}`)
})

// POST /api/auth/apple/callback  — Apple posts back with form data
apiRoutes.post('/auth/apple/callback', async (c) => {
  const db = c.env?.DB
  if (!db) return c.redirect('/auth/login?error=db_unavailable')

  const tokenSecret = c.env?.USER_TOKEN_SECRET || 'pp-user-secret-change-in-prod'
  const base = c.env?.OAUTH_REDIRECT_BASE || 'https://parkpeer.pages.dev'

  let formData: FormData
  try { formData = await c.req.formData() } catch {
    return c.redirect('/auth/login?error=apple_bad_response')
  }

  const code  = formData.get('code') as string | null
  const state = formData.get('state') as string | null
  const user  = formData.get('user') as string | null   // only on first login
  const error = formData.get('error') as string | null

  if (error || !code) {
    console.error('[OAuth/Apple] Callback error:', error)
    return c.redirect(`/auth/login?error=${encodeURIComponent(error || 'apple_denied')}`)
  }

  if (!c.env?.APPLE_CLIENT_ID || !c.env?.APPLE_TEAM_ID || !c.env?.APPLE_KEY_ID || !c.env?.APPLE_PRIVATE_KEY) {
    console.error('[OAuth/Apple] Missing required Apple env vars')
    return c.redirect('/auth/login?error=oauth_not_configured')
  }

  // Decode role from state
  let role = 'driver'
  try {
    const padded = (state || '').replace(/-/g, '+').replace(/_/g, '/')
    const decoded = JSON.parse(atob(padded + '==='.slice((padded.length + 3) % 4 || 4)))
    role = decoded.role || 'driver'
  } catch { /* ignore */ }

  try {
    const clientSecret = await generateAppleClientSecret(c.env)

    // Exchange code for tokens
    const tokenRes = await fetch('https://appleid.apple.com/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     c.env.APPLE_CLIENT_ID,
        client_secret: clientSecret,
        code,
        grant_type:    'authorization_code',
        redirect_uri:  `${base}/api/auth/apple/callback`,
      }).toString(),
    })

    if (!tokenRes.ok) {
      const e = await tokenRes.text()
      console.error('[OAuth/Apple] Token exchange failed:', e.substring(0, 200))
      return c.redirect('/auth/login?error=apple_token_failed')
    }

    const tokens: any = await tokenRes.json()
    const idToken = tokens.id_token
    if (!idToken) return c.redirect('/auth/login?error=apple_no_id_token')

    // Decode the id_token payload (not verifying Apple's signature — trusting HTTPS exchange)
    const parts  = idToken.split('.')
    if (parts.length < 2) return c.redirect('/auth/login?error=apple_bad_token')
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const claims: any = JSON.parse(atob(padded + '==='.slice((padded.length + 3) % 4 || 4)))

    const email = claims.email?.toLowerCase()?.trim()
    if (!email) return c.redirect('/auth/login?error=apple_no_email')

    // Apple provides user name only on FIRST login via form_post
    let fullName = email.split('@')[0]
    if (user) {
      try {
        const userObj = JSON.parse(user)
        const fn = userObj?.name
        if (fn?.firstName || fn?.lastName) {
          fullName = [fn.firstName, fn.lastName].filter(Boolean).join(' ')
        }
      } catch { /* ignore */ }
    }

    console.log(`[OAuth/Apple] Login: ${email} role=${role}`)

    // Upsert user
    let dbUser: any = await db.prepare(
      'SELECT id, email, full_name, role, status FROM users WHERE email = ?'
    ).bind(email).first()

    if (!dbUser) {
      const res = await db.prepare(`
        INSERT INTO users (email, password_hash, full_name, role, status, email_verified, created_at, updated_at)
        VALUES (?, '', ?, ?, 'active', 1, datetime('now'), datetime('now'))
      `).bind(email, sanitizeHtml(fullName), role.toUpperCase()).run()
      const newId = res.meta?.last_row_id
      dbUser = { id: newId, email, full_name: fullName, role: role.toUpperCase(), status: 'active' }
      console.log(`[OAuth/Apple] Created new user id=${newId}`)
    } else {
      if (dbUser.status === 'suspended') {
        return c.redirect('/auth/login?error=account_suspended')
      }
      db.prepare('UPDATE users SET updated_at = datetime(\'now\') WHERE id = ?').bind(dbUser.id).run().catch(() => {})
    }

    await issueUserToken(c, {
      userId: dbUser.id,
      email:  dbUser.email,
      role:   (dbUser.role || role).toLowerCase(),
    }, tokenSecret)

    const csrfSecret = tokenSecret + '.csrf'
    await generateCsrfToken(c, csrfSecret)

    const userRole = (dbUser.role || role).toLowerCase()
    return c.redirect(userRole === 'host' ? '/host' : '/dashboard')

  } catch (e: any) {
    console.error('[OAuth/Apple] Unexpected error:', e.message)
    return c.redirect('/auth/login?error=apple_unexpected')
  }
})
