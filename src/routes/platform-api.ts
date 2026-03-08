// ════════════════════════════════════════════════════════════════════════════
// ParkPeer — Timer · Overstay · Business API Routes
// Handles:
//   POST /api/bookings/:id/arrived
//   GET  /api/bookings/:id/time-remaining
//   POST /api/bookings/:id/arrived-start
//   PATCH /api/bookings/:id/resolve-overstay
//   GET  /api/bookings/active (driver active bookings for dashboard timers)
//   POST /api/timer/check    (cron-style worker — call from scheduled trigger or admin)
//
//   POST /api/business/register
//   GET  /api/business/me
//   PUT  /api/business/me
//   GET  /api/business/dashboard
//   POST /api/business/locations
//   GET  /api/business/locations
//   POST /api/business/locations/:loc_id/spots
//   GET  /api/business/locations/:loc_id/spots
//   GET  /api/business/live-monitor
//   POST /api/business/users/invite
//   GET  /api/business/users
//   DELETE /api/business/users/:user_id
//   GET  /api/admin/business/overview  (admin only)
// ════════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono'
import { verifyUserToken } from '../middleware/security'

type Bindings = {
  DB: D1Database
  USER_TOKEN_SECRET: string
  TWILIO_ACCOUNT_SID?:  string
  TWILIO_AUTH_TOKEN?:   string
  TWILIO_PHONE_NUMBER?: string
  RESEND_API_KEY?:      string
  FROM_EMAIL?:          string
}

export const platformApiRoutes = new Hono<{ Bindings: Bindings }>()

// ── Rate limit store (in-memory, per-isolate) ─────────────────────────────
const rateLimitMap = new Map<string, number[]>()
function rateLimit(key: string, maxPerMin: number): boolean {
  const now   = Date.now()
  const cutoff = now - 60_000
  const hits  = (rateLimitMap.get(key) || []).filter(t => t > cutoff)
  if (hits.length >= maxPerMin) return false
  hits.push(now)
  rateLimitMap.set(key, hits)
  return true
}

// ── Auth helper ────────────────────────────────────────────────────────────
async function requireAuth(c: any) {
  const session = await verifyUserToken(
    c, c.env?.USER_TOKEN_SECRET || 'pp-user-secret-change-in-prod'
  ).catch(() => null)
  if (!session) return null
  return session
}

// ── SMS helper (Twilio REST) ───────────────────────────────────────────────
async function sendSMS(env: Bindings, to: string, body: string): Promise<void> {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_PHONE_NUMBER: from } = env
  if (!sid || !token || !from || !to) return
  try {
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${sid}:${token}`),
        'Content-Type':  'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ To: to, From: from, Body: body })
    })
  } catch {}
}

// ── Email helper (Resend) ──────────────────────────────────────────────────
async function sendEmail(env: Bindings, to: string, subject: string, html: string): Promise<void> {
  const { RESEND_API_KEY: key, FROM_EMAIL: from } = env
  if (!key || !to) return
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: from || 'noreply@parkpeer.com', to: [to], subject, html })
    })
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE 1 — ARRIVAL MODE ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/bookings/:id/arrived
// Driver confirms they have arrived. Records timestamp, notifies host.
platformApiRoutes.post('/bookings/:id/arrived', async (c) => {
  const session = await requireAuth(c)
  if (!session) return c.json({ error: 'Authentication required', code: 'UNAUTHORIZED' }, 401)

  const db = c.env?.DB
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  const bookingId = parseInt(c.req.param('id'))
  const ip        = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
  if (!rateLimit(`arrived:${session.userId}:${ip}`, 5)) {
    return c.json({ error: 'Too many requests', code: 'RATE_LIMITED' }, 429)
  }

  let body: any = {}
  try { body = await c.req.json() } catch {}

  const booking = await db.prepare(`
    SELECT b.*, l.address, l.city, l.title, u.phone AS host_phone, u.full_name AS host_name,
           d.phone AS driver_phone, d.full_name AS driver_name, d.email AS driver_email
    FROM bookings b
    JOIN listings l ON b.listing_id = l.id
    JOIN users    u ON b.host_id    = u.id
    JOIN users    d ON b.driver_id  = d.id
    WHERE b.id = ?
  `).bind(bookingId).first<any>()

  if (!booking) return c.json({ error: 'Booking not found' }, 404)
  if (booking.driver_id !== session.userId) return c.json({ error: 'Access denied', code: 'FORBIDDEN' }, 403)
  if (!['confirmed','active'].includes(booking.status)) {
    return c.json({ error: 'Booking is not active', code: 'INVALID_STATUS' }, 400)
  }
  if (booking.arrival_confirmed_at) {
    return c.json({ success: true, message: 'Arrival already confirmed', already_confirmed: true })
  }

  const now = new Date().toISOString()
  await db.prepare(`
    UPDATE bookings SET arrival_confirmed_at = ?, updated_at = ? WHERE id = ?
  `).bind(now, now, bookingId).run()

  // Also set arrival_started_at if not already set
  if (!booking.arrival_started_at) {
    await db.prepare(`UPDATE bookings SET arrival_started_at = ? WHERE id = ?`).bind(now, bookingId).run()
  }

  // Notify host via SMS + in-app
  const hostMsg = `ParkPeer: ${booking.driver_name} has arrived at ${booking.title}. They're parked. Booking #PP-${bookingId}.`
  await sendSMS(c.env as any, booking.host_phone, hostMsg)

  await db.prepare(`
    INSERT INTO notifications (user_id, user_role, type, title, message, related_entity, delivery_inapp, delivery_sms)
    VALUES (?, 'host', 'booking_confirmed', 'Driver Arrived', ?, '{"type":"booking","id":${bookingId}}', 1, 1)
  `).bind(booking.host_id, `${booking.driver_name} has arrived and parked at ${booking.title}.`).run()

  return c.json({ success: true, arrival_confirmed_at: now, booking_id: bookingId })
})

// POST /api/bookings/:id/arrival-start
// Records when driver opens Arrival Mode (soft signal, no notification)
platformApiRoutes.post('/bookings/:id/arrival-start', async (c) => {
  const session = await requireAuth(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const db = c.env?.DB
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  const bookingId = parseInt(c.req.param('id'))
  const booking = await db.prepare('SELECT driver_id, arrival_started_at FROM bookings WHERE id = ?')
    .bind(bookingId).first<any>()
  if (!booking) return c.json({ error: 'Not found' }, 404)
  if (booking.driver_id !== session.userId) return c.json({ error: 'Forbidden' }, 403)
  if (!booking.arrival_started_at) {
    const now = new Date().toISOString()
    await db.prepare('UPDATE bookings SET arrival_started_at = ? WHERE id = ?').bind(now, bookingId).run()
  }
  return c.json({ success: true })
})

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE 2 — RESERVATION TIMER
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/bookings/:id/time-remaining
platformApiRoutes.get('/bookings/:id/time-remaining', async (c) => {
  const session = await requireAuth(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const db = c.env?.DB
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  const bookingId = parseInt(c.req.param('id'))
  const booking = await db.prepare(`
    SELECT id, driver_id, host_id, start_time, end_time, status FROM bookings WHERE id = ?
  `).bind(bookingId).first<any>()

  if (!booking) return c.json({ error: 'Booking not found' }, 404)
  if (booking.driver_id !== session.userId && booking.host_id !== session.userId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  const now       = Date.now()
  const endMs     = new Date(booking.end_time).getTime()
  const startMs   = new Date(booking.start_time).getTime()
  const remainS   = Math.max(0, Math.floor((endMs - now) / 1000))
  const isActive  = now >= startMs && now <= endMs && ['confirmed','active'].includes(booking.status)
  const isExpired = now > endMs

  return c.json({
    booking_id:        bookingId,
    remaining_seconds: remainS,
    status:            isExpired ? 'expired' : (isActive ? 'active' : booking.status),
    end_time:          booking.end_time,
    start_time:        booking.start_time,
    percent_used:      Math.min(100, Math.round((now - startMs) / (endMs - startMs) * 100))
  })
})

// POST /api/timer/check
// Worker endpoint — call this every minute from a cron/scheduled trigger.
// Checks all active bookings for 15-min, 5-min, and expired states.
// Protected by a shared secret to prevent public access.
platformApiRoutes.post('/timer/check', async (c) => {
  const authHeader = c.req.header('Authorization') || ''
  const secret     = c.env?.USER_TOKEN_SECRET || 'pp-user-secret-change-in-prod'
  // Simple HMAC-free shared secret gate for internal cron
  if (!authHeader.includes('Bearer ') || authHeader.replace('Bearer ','') !== `cron-${secret}`) {
    // Also allow admin JWT
    const session = await requireAuth(c)
    if (!session || session.role !== 'ADMIN') {
      return c.json({ error: 'Unauthorized' }, 401)
    }
  }

  const db = c.env?.DB
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  const now       = new Date().toISOString()
  const in15Min   = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  const in5Min    = new Date(Date.now() +  5 * 60 * 1000).toISOString()

  // ── Fetch active bookings ending within 16 min ──────────────────────────
  const { results: upcoming } = await db.prepare(`
    SELECT b.id, b.driver_id, b.host_id, b.end_time, b.status,
           l.title, d.phone AS driver_phone, d.email AS driver_email, d.full_name AS driver_name,
           h.phone AS host_phone, h.full_name AS host_name, h.email AS host_email
    FROM bookings b
    JOIN listings l ON b.listing_id = l.id
    JOIN users    d ON b.driver_id  = d.id
    JOIN users    h ON b.host_id    = h.id
    WHERE b.status IN ('confirmed','active')
      AND b.end_time <= ?
      AND b.end_time >  ?
  `).bind(in15Min, now).all<any>()

  // ── Fetch expired (overstay candidates) ─────────────────────────────────
  const { results: expired } = await db.prepare(`
    SELECT b.id, b.driver_id, b.host_id, b.end_time,
           l.title, d.phone AS driver_phone, d.email AS driver_email, d.full_name AS driver_name,
           h.phone AS host_phone, h.full_name AS host_name, h.email AS host_email
    FROM bookings b
    JOIN listings l ON b.listing_id = l.id
    JOIN users    d ON b.driver_id  = d.id
    JOIN users    h ON b.host_id    = h.id
    WHERE b.status IN ('confirmed','active')
      AND b.end_time <= ?
      AND b.overstay_flagged_at IS NULL
  `).bind(now).all<any>()

  const alerts = { sent_15min: 0, sent_5min: 0, expired: 0, errors: 0 }

  // Process upcoming expiry alerts
  for (const b of upcoming) {
    const endMs  = new Date(b.end_time).getTime()
    const diffS  = Math.floor((endMs - Date.now()) / 1000)
    const diff15 = diffS <= 900 && diffS > 300
    const diff5  = diffS <= 300 && diffS > 0

    if (diff15) {
      // Check if 15min alert already sent
      const existing = await db.prepare(
        'SELECT id FROM booking_timer_alerts WHERE booking_id=? AND alert_type="15min"'
      ).bind(b.id).first()
      if (!existing) {
        try {
          const mins = Math.round(diffS / 60)
          await sendSMS(c.env as any, b.driver_phone,
            `ParkPeer ⏰ Reminder: Your parking at ${b.title} expires in ~${mins} min. Please wrap up.`)
          await sendEmail(c.env as any, b.driver_email,
            `Your ParkPeer reservation expires in 15 minutes`,
            `<p>Hi ${b.driver_name},</p><p>Your reservation at <strong>${b.title}</strong> expires in approximately <strong>15 minutes</strong>.</p><p>Please ensure you've left the spot or extend your booking.</p>`)
          await db.prepare(
            'INSERT OR IGNORE INTO booking_timer_alerts (booking_id, alert_type) VALUES (?,?)'
          ).bind(b.id, '15min').run()
          alerts.sent_15min++
        } catch { alerts.errors++ }
      }
    }

    if (diff5) {
      const existing = await db.prepare(
        'SELECT id FROM booking_timer_alerts WHERE booking_id=? AND alert_type="5min"'
      ).bind(b.id).first()
      if (!existing) {
        try {
          await sendSMS(c.env as any, b.driver_phone,
            `ParkPeer 🚨 URGENT: Your parking at ${b.title} expires in 5 minutes!`)
          await db.prepare(
            'INSERT OR IGNORE INTO booking_timer_alerts (booking_id, alert_type) VALUES (?,?)'
          ).bind(b.id, '5min').run()
          alerts.sent_5min++
        } catch { alerts.errors++ }
      }
    }
  }

  // Process expired bookings → overstay
  for (const b of expired) {
    try {
      const nowTs = new Date().toISOString()
      const overMinutes = Math.floor((Date.now() - new Date(b.end_time).getTime()) / 60000)

      await db.prepare(`
        UPDATE bookings SET status='overstayed', overstay_flagged_at=?, updated_at=? WHERE id=?
      `).bind(nowTs, nowTs, b.id).run()

      // Notify host
      await sendSMS(c.env as any, b.host_phone,
        `ParkPeer: ${b.driver_name} has overstayed at ${b.title} by ${overMinutes}+ min. Please check your spot.`)
      await sendEmail(c.env as any, b.host_email,
        `Driver overstayed at ${b.title}`,
        `<p>Hi ${b.host_name},</p><p><strong>${b.driver_name}</strong> has overstayed their reservation at <strong>${b.title}</strong> by ${overMinutes} minutes.</p><p>You can resolve this in your <a href="https://parkpeer.pages.dev/host">Host Dashboard</a>.</p>`)

      // Notify driver
      await sendSMS(c.env as any, b.driver_phone,
        `ParkPeer: Your parking reservation at ${b.title} has expired. Please vacate the spot to avoid fees.`)

      await db.prepare(
        'INSERT OR IGNORE INTO booking_timer_alerts (booking_id, alert_type) VALUES (?,?)'
      ).bind(b.id, 'expired').run()

      // In-app notifications
      await db.prepare(`
        INSERT INTO notifications (user_id, user_role, type, title, message, related_entity, delivery_inapp)
        VALUES (?, 'host', 'booking_cancelled', 'Driver Overstayed', ?, '{"type":"booking","id":${b.id}}', 1)
      `).bind(b.host_id, `${b.driver_name} has overstayed at ${b.title} by ${overMinutes} min.`).run()

      alerts.expired++
    } catch { alerts.errors++ }
  }

  return c.json({ success: true, checked_at: now, ...alerts, upcoming_count: upcoming.length, expired_count: expired.length })
})

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE 3 — OVERSTAY PROTECTION
// ─────────────────────────────────────────────────────────────────────────────

// PATCH /api/bookings/:id/resolve-overstay
// Host marks "driver has left" → resolves overstay
platformApiRoutes.patch('/bookings/:id/resolve-overstay', async (c) => {
  const session = await requireAuth(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const db = c.env?.DB
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  const bookingId = parseInt(c.req.param('id'))
  const booking = await db.prepare(
    'SELECT id, host_id, driver_id, status, end_time, overstay_flagged_at FROM bookings WHERE id = ?'
  ).bind(bookingId).first<any>()

  if (!booking) return c.json({ error: 'Booking not found' }, 404)
  // Only host or admin can resolve
  if (booking.host_id !== session.userId && session.role !== 'ADMIN') {
    return c.json({ error: 'Access denied — only the host can resolve overstays' }, 403)
  }
  if (booking.status !== 'overstayed') {
    return c.json({ error: 'Booking is not in overstayed status' }, 400)
  }

  const nowTs    = new Date().toISOString()
  const overMs   = booking.overstay_flagged_at
    ? Date.now() - new Date(booking.overstay_flagged_at).getTime()
    : 0
  const overMin  = Math.floor(overMs / 60000)

  await db.prepare(`
    UPDATE bookings SET
      status = 'completed',
      overstay_resolved_at = ?,
      overstay_resolved_by = ?,
      updated_at = ?
    WHERE id = ?
  `).bind(nowTs, session.role === 'ADMIN' ? 'admin' : 'host', nowTs, bookingId).run()

  // Log to admin audit
  await db.prepare(`
    INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details, created_at)
    VALUES (?, 'resolve_overstay', 'booking', ?, ?, ?)
  `).bind(session.userId, bookingId, JSON.stringify({ overstay_minutes: overMin }), nowTs).run().catch(() => {})

  return c.json({ success: true, resolved_at: nowTs, overstay_minutes: overMin, new_status: 'completed' })
})

// GET /api/bookings/overstays — Host dashboard: list their overstayed bookings
platformApiRoutes.get('/bookings/overstays', async (c) => {
  const session = await requireAuth(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const db = c.env?.DB
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  const { results } = await db.prepare(`
    SELECT b.id, b.status, b.end_time, b.overstay_flagged_at, b.overstay_resolved_at,
           l.title AS listing_title, l.address,
           d.full_name AS driver_name, d.phone AS driver_phone
    FROM bookings b
    JOIN listings l ON b.listing_id = l.id
    JOIN users    d ON b.driver_id  = d.id
    WHERE b.host_id = ?
      AND b.status IN ('overstayed','completed')
      AND b.overstay_flagged_at IS NOT NULL
    ORDER BY b.overstay_flagged_at DESC
    LIMIT 50
  `).bind(session.userId).all<any>()

  const enriched = results.map(r => ({
    ...r,
    overstay_minutes: r.overstay_flagged_at
      ? Math.floor((new Date(r.overstay_resolved_at || new Date()).getTime() - new Date(r.overstay_flagged_at).getTime()) / 60000)
      : 0
  }))

  return c.json({ overstays: enriched, total: enriched.length })
})

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE 4 — PARKPEER FOR BUSINESS
// ─────────────────────────────────────────────────────────────────────────────

// ── Business auth middleware helper ──────────────────────────────────────────
async function requireBusiness(c: any, roles: string[] = ['admin','manager','staff']) {
  const session = await requireAuth(c)
  if (!session) return { error: 'Authentication required', status: 401, session: null, biz: null, bizUser: null }

  const db = c.env?.DB

  // Look up business the user belongs to (as owner or team member)
  const biz = await db.prepare(`
    SELECT ba.*, bu.role AS user_role
    FROM business_accounts ba
    LEFT JOIN business_users bu ON ba.id = bu.business_id AND bu.user_id = ?
    WHERE ba.owner_user_id = ? OR bu.user_id = ?
    LIMIT 1
  `).bind(session.userId, session.userId, session.userId).first<any>()

  if (!biz) return { error: 'No business account found', status: 404, session, biz: null, bizUser: null }

  // Determine effective role
  const effectiveRole = biz.owner_user_id === session.userId ? 'admin' : biz.user_role
  if (!roles.includes(effectiveRole)) {
    return { error: 'Insufficient permissions', status: 403, session, biz: null, bizUser: null }
  }

  return { error: null, status: 200, session, biz, bizUser: { role: effectiveRole } }
}

// POST /api/business/register
platformApiRoutes.post('/business/register', async (c) => {
  const session = await requireAuth(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)

  const db  = c.env?.DB
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  const ip = c.req.header('CF-Connecting-IP') || 'unknown'
  if (!rateLimit(`biz-register:${ip}`, 3)) {
    return c.json({ error: 'Too many registration attempts. Please try later.' }, 429)
  }

  let body: any = {}
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { company_name, ein, business_email, business_phone, business_address,
          business_city, business_state, business_zip, website, industry } = body

  // Input validation
  if (!company_name?.trim()) return c.json({ error: 'Company name is required' }, 400)
  if (!ein?.trim())           return c.json({ error: 'EIN is required' }, 400)
  if (!business_email?.trim()) return c.json({ error: 'Business email is required' }, 400)

  // EIN format: XX-XXXXXXX
  const einClean = ein.replace(/\D/g,'')
  if (einClean.length !== 9) return c.json({ error: 'EIN must be 9 digits (XX-XXXXXXX)' }, 400)

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(business_email)) return c.json({ error: 'Invalid business email' }, 400)

  // Check duplicate EIN
  const existing = await db.prepare('SELECT id FROM business_accounts WHERE ein = ?').bind(einClean).first()
  if (existing) return c.json({ error: 'An account with this EIN already exists', code: 'DUPLICATE_EIN' }, 409)

  // Check if user already has a business
  const ownerExisting = await db.prepare(
    'SELECT id FROM business_accounts WHERE owner_user_id = ?'
  ).bind(session.userId).first()
  if (ownerExisting) return c.json({ error: 'You already have a business account', code: 'DUPLICATE_OWNER' }, 409)

  // EIN "validation" — in production, integrate with IRS e-Verify or a third-party service.
  // For now we do basic format check + mark as pending_verification.
  // The verification_status will be set to 'verified' by admin review or automated EIN lookup.
  const verificationStatus = 'pending'

  const nowTs = new Date().toISOString()
  const result = await db.prepare(`
    INSERT INTO business_accounts
      (owner_user_id, company_name, ein, business_email, business_phone,
       business_address, business_city, business_state, business_zip,
       website, industry, verification_status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    session.userId, company_name.trim(), einClean, business_email.trim(),
    business_phone || null, business_address || null, business_city || null,
    business_state || null, business_zip || null, website || null, industry || null,
    verificationStatus, nowTs, nowTs
  ).run()

  const bizId = result.meta.last_row_id

  // Auto-add owner as admin in business_users
  await db.prepare(`
    INSERT OR IGNORE INTO business_users (business_id, user_id, role, created_at)
    VALUES (?, ?, 'admin', ?)
  `).bind(bizId, session.userId, nowTs).run()

  // Welcome email
  await sendEmail(c.env as any, business_email,
    'Welcome to ParkPeer for Business',
    `<h2>Welcome, ${company_name}!</h2>
     <p>Your business account has been created and is <strong>pending verification</strong>.</p>
     <p>Our team will verify your EIN (${ein}) within 1-2 business days.</p>
     <p>Once verified, you'll have access to your full business dashboard at
     <a href="https://parkpeer.pages.dev/business/dashboard">parkpeer.pages.dev/business/dashboard</a>.</p>`)

  return c.json({ success: true, business_id: bizId, verification_status: verificationStatus, company_name }, 201)
})

// GET /api/business/me
platformApiRoutes.get('/business/me', async (c) => {
  const { error, status, session, biz } = await requireBusiness(c, ['admin','manager','staff'])
  if (error) return c.json({ error }, status)
  return c.json({ business: biz })
})

// PUT /api/business/me
platformApiRoutes.put('/business/me', async (c) => {
  const { error, status, biz, bizUser } = await requireBusiness(c, ['admin'])
  if (error) return c.json({ error }, status)

  const db = c.env?.DB!
  let body: any = {}
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const allowed = ['company_name','business_email','business_phone','business_address',
                   'business_city','business_state','business_zip','website','industry']
  const updates = Object.entries(body).filter(([k]) => allowed.includes(k))
  if (!updates.length) return c.json({ error: 'No valid fields to update' }, 400)

  const setClauses = updates.map(([k]) => `${k} = ?`).join(', ')
  const values     = updates.map(([,v]) => v)
  values.push(new Date().toISOString(), biz.id)

  await db.prepare(`UPDATE business_accounts SET ${setClauses}, updated_at = ? WHERE id = ?`).bind(...values).run()
  return c.json({ success: true })
})

// GET /api/business/dashboard
// Returns aggregate KPIs for business dashboard
platformApiRoutes.get('/business/dashboard', async (c) => {
  const { error, status, biz } = await requireBusiness(c, ['admin','manager'])
  if (error) return c.json({ error }, status)

  const db = c.env?.DB!
  const bizId = biz.id

  // Get all listing IDs belonging to this business's spots
  const { results: spots } = await db.prepare(`
    SELECT bs.listing_id FROM business_spots bs WHERE bs.business_id = ? AND bs.listing_id IS NOT NULL
  `).bind(bizId).all<any>()
  const listingIds = spots.map((s: any) => s.listing_id)

  let totalBookings = 0, activeBookings = 0, monthRevCents = 0

  if (listingIds.length > 0) {
    const ids = listingIds.join(',')
    const now  = new Date().toISOString()
    const m30  = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()

    const counts = await db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN status IN ('confirmed','active') AND end_time > ? THEN 1 ELSE 0 END) AS active,
             SUM(CASE WHEN status = 'completed' AND created_at > ? THEN CAST(total_charged * 100 AS INTEGER) ELSE 0 END) AS rev_cents
      FROM bookings WHERE listing_id IN (${ids})
    `).bind(now, m30).first<any>()

    totalBookings  = counts?.total   || 0
    activeBookings = counts?.active  || 0
    monthRevCents  = counts?.rev_cents || 0
  }

  // Spot utilization
  const { results: locStats } = await db.prepare(`
    SELECT COUNT(*) AS total_spots,
           SUM(CASE WHEN status='available' THEN 1 ELSE 0 END) AS available_spots,
           SUM(CASE WHEN status='occupied'  THEN 1 ELSE 0 END) AS occupied_spots
    FROM business_spots WHERE business_id = ?
  `).bind(bizId).all<any>()

  const spotStats       = locStats[0] || { total_spots: 0, available_spots: 0, occupied_spots: 0 }
  const utilizationRate = spotStats.total_spots > 0
    ? Math.round((spotStats.occupied_spots / spotStats.total_spots) * 100)
    : 0

  // Revenue by day (last 14 days)
  const revenueByDay: any[] = []
  if (listingIds.length > 0) {
    const ids = listingIds.join(',')
    const { results: rev } = await db.prepare(`
      SELECT DATE(created_at) AS day, SUM(total_charged) AS revenue
      FROM bookings
      WHERE listing_id IN (${ids})
        AND status = 'completed'
        AND created_at >= datetime('now', '-14 days')
      GROUP BY DATE(created_at)
      ORDER BY day ASC
    `).all<any>()
    revenueByDay.push(...rev)
  }

  // Location count
  const locCount = await db.prepare('SELECT COUNT(*) AS c FROM business_locations WHERE business_id = ?')
    .bind(bizId).first<any>()
  const totalLocations = locCount?.c || 0

  return c.json({
    business:        biz,
    kpis: {
      total_bookings:   totalBookings,
      active_bookings:  activeBookings,
      monthly_revenue:  (monthRevCents / 100).toFixed(2),
      utilization_rate: utilizationRate,
      total_spots:      spotStats.total_spots,
      total_locations:  totalLocations
    },
    charts: {
      revenue_by_day: revenueByDay
    }
  })
})

// ── Business Locations ────────────────────────────────────────────────────────

// POST /api/business/locations
platformApiRoutes.post('/business/locations', async (c) => {
  const { error, status, biz } = await requireBusiness(c, ['admin','manager'])
  if (error) return c.json({ error }, status)
  const db = c.env?.DB!
  let body: any = {}
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const { name, address, city, state, zip, lat, lng } = body
  if (!name || !address || !city || !state) {
    return c.json({ error: 'name, address, city, state are required' }, 400)
  }

  const result = await db.prepare(`
    INSERT INTO business_locations (business_id, name, address, city, state, zip, lat, lng, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).bind(biz.id, name, address, city, state, zip||null, lat||null, lng||null, new Date().toISOString()).run()

  return c.json({ success: true, location_id: result.meta.last_row_id }, 201)
})

// GET /api/business/locations
platformApiRoutes.get('/business/locations', async (c) => {
  const { error, status, biz } = await requireBusiness(c, ['admin','manager','staff'])
  if (error) return c.json({ error }, status)
  const db = c.env?.DB!

  const { results } = await db.prepare(`
    SELECT bl.*, COUNT(bs.id) AS spot_count
    FROM business_locations bl
    LEFT JOIN business_spots bs ON bl.id = bs.location_id
    WHERE bl.business_id = ?
    GROUP BY bl.id
    ORDER BY bl.created_at DESC
  `).bind(biz.id).all<any>()

  return c.json({ locations: results })
})

// PUT /api/business/locations/:loc_id
platformApiRoutes.put('/business/locations/:loc_id', async (c) => {
  const { error, status, biz } = await requireBusiness(c, ['admin','manager'])
  if (error) return c.json({ error }, status)
  const db     = c.env?.DB!
  const locId  = parseInt(c.req.param('loc_id'))
  let body: any = {}
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const loc = await db.prepare('SELECT id FROM business_locations WHERE id=? AND business_id=?')
    .bind(locId, biz.id).first()
  if (!loc) return c.json({ error: 'Location not found' }, 404)

  const allowed = ['name','address','city','state','zip','lat','lng','active']
  const updates = Object.entries(body).filter(([k]) => allowed.includes(k))
  if (!updates.length) return c.json({ error: 'No valid fields' }, 400)

  const sets = updates.map(([k]) => `${k} = ?`).join(', ')
  const vals = [...updates.map(([,v]) => v), locId]
  await db.prepare(`UPDATE business_locations SET ${sets} WHERE id = ?`).bind(...vals).run()
  return c.json({ success: true })
})

// ── Business Spots ────────────────────────────────────────────────────────────

// POST /api/business/locations/:loc_id/spots
platformApiRoutes.post('/business/locations/:loc_id/spots', async (c) => {
  const { error, status, biz } = await requireBusiness(c, ['admin','manager'])
  if (error) return c.json({ error }, status)
  const db    = c.env?.DB!
  const locId = parseInt(c.req.param('loc_id'))

  const loc = await db.prepare('SELECT id FROM business_locations WHERE id=? AND business_id=?')
    .bind(locId, biz.id).first()
  if (!loc) return c.json({ error: 'Location not found' }, 404)

  let body: any = {}
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const { spot_number, spot_type, price_hourly, price_daily, price_monthly, availability_rules, listing_id } = body
  if (!spot_number) return c.json({ error: 'spot_number is required' }, 400)

  const result = await db.prepare(`
    INSERT INTO business_spots
      (location_id, business_id, listing_id, spot_number, spot_type, price_hourly, price_daily, price_monthly, availability_rules, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    locId, biz.id, listing_id||null, spot_number,
    spot_type||'standard', price_hourly||null, price_daily||null, price_monthly||null,
    availability_rules ? JSON.stringify(availability_rules) : null,
    new Date().toISOString(), new Date().toISOString()
  ).run()

  // Update location total_spots
  await db.prepare('UPDATE business_locations SET total_spots = total_spots + 1 WHERE id = ?').bind(locId).run()

  return c.json({ success: true, spot_id: result.meta.last_row_id }, 201)
})

// GET /api/business/locations/:loc_id/spots
platformApiRoutes.get('/business/locations/:loc_id/spots', async (c) => {
  const { error, status, biz } = await requireBusiness(c, ['admin','manager','staff'])
  if (error) return c.json({ error }, status)
  const db    = c.env?.DB!
  const locId = parseInt(c.req.param('loc_id'))

  const loc = await db.prepare('SELECT id FROM business_locations WHERE id=? AND business_id=?')
    .bind(locId, biz.id).first()
  if (!loc) return c.json({ error: 'Location not found' }, 404)

  const { results } = await db.prepare(`
    SELECT bs.*, l.title AS listing_title, l.avg_rating
    FROM business_spots bs
    LEFT JOIN listings l ON bs.listing_id = l.id
    WHERE bs.location_id = ?
    ORDER BY bs.spot_number ASC
  `).bind(locId).all<any>()

  return c.json({ spots: results })
})

// PATCH /api/business/spots/:spot_id/status
platformApiRoutes.patch('/business/spots/:spot_id/status', async (c) => {
  const { error, status, biz } = await requireBusiness(c, ['admin','manager'])
  if (error) return c.json({ error }, status)
  const db     = c.env?.DB!
  const spotId = parseInt(c.req.param('spot_id'))

  let body: any = {}
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const validStatuses = ['available','occupied','maintenance','reserved']
  if (!validStatuses.includes(body.status)) {
    return c.json({ error: `status must be one of: ${validStatuses.join(', ')}` }, 400)
  }

  const spot = await db.prepare('SELECT id FROM business_spots WHERE id=? AND business_id=?')
    .bind(spotId, biz.id).first()
  if (!spot) return c.json({ error: 'Spot not found' }, 404)

  await db.prepare('UPDATE business_spots SET status=?, updated_at=? WHERE id=?')
    .bind(body.status, new Date().toISOString(), spotId).run()
  return c.json({ success: true, new_status: body.status })
})

// ── Live Booking Monitor ──────────────────────────────────────────────────────

// GET /api/business/live-monitor
// Real-time view of all active bookings across all business locations
platformApiRoutes.get('/business/live-monitor', async (c) => {
  const { error, status, biz } = await requireBusiness(c, ['admin','manager','staff'])
  if (error) return c.json({ error }, status)
  const db = c.env?.DB!

  const { results: spots } = await db.prepare(`
    SELECT listing_id FROM business_spots WHERE business_id = ? AND listing_id IS NOT NULL
  `).bind(biz.id).all<any>()

  if (!spots.length) return c.json({ active_bookings: [], total: 0 })

  const ids = spots.map((s: any) => s.listing_id).join(',')
  const now = new Date().toISOString()

  const { results } = await db.prepare(`
    SELECT
      b.id, b.status, b.start_time, b.end_time, b.total_charged, b.vehicle_plate,
      b.arrival_confirmed_at, b.overstay_flagged_at,
      l.title AS spot_name, l.address,
      d.full_name AS driver_name, d.phone AS driver_phone,
      bs.spot_number, bs.spot_type
    FROM bookings b
    JOIN listings l ON b.listing_id = l.id
    JOIN users    d ON b.driver_id  = d.id
    LEFT JOIN business_spots bs ON bs.listing_id = b.listing_id
    WHERE b.listing_id IN (${ids})
      AND b.status IN ('confirmed','active','overstayed')
      AND b.end_time > datetime('now', '-2 hours')
    ORDER BY b.start_time ASC
  `).all<any>()

  const enriched = results.map(r => {
    const endMs    = new Date(r.end_time).getTime()
    const remainS  = Math.max(0, Math.floor((endMs - Date.now()) / 1000))
    return { ...r, remaining_seconds: remainS, is_overstayed: r.status === 'overstayed' }
  })

  return c.json({ active_bookings: enriched, total: enriched.length, checked_at: now })
})

// ── Business User Management ──────────────────────────────────────────────────

// POST /api/business/users/invite
platformApiRoutes.post('/business/users/invite', async (c) => {
  const { error, status, session, biz } = await requireBusiness(c, ['admin'])
  if (error) return c.json({ error }, status)
  const db = c.env?.DB!

  let body: any = {}
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const { email, role } = body
  if (!email) return c.json({ error: 'Email required' }, 400)
  if (!['admin','manager','staff'].includes(role)) {
    return c.json({ error: 'role must be admin, manager, or staff' }, 400)
  }

  // Find user by email
  const user = await db.prepare('SELECT id, full_name, email FROM users WHERE email = ? AND status = "active"')
    .bind(email.toLowerCase().trim()).first<any>()
  if (!user) return c.json({ error: 'No active user found with that email', code: 'USER_NOT_FOUND' }, 404)

  // Check not already member
  const existing = await db.prepare('SELECT id FROM business_users WHERE business_id=? AND user_id=?')
    .bind(biz.id, user.id).first()
  if (existing) return c.json({ error: 'User is already a team member', code: 'ALREADY_MEMBER' }, 409)

  await db.prepare(`
    INSERT INTO business_users (business_id, user_id, role, invited_by, created_at)
    VALUES (?,?,?,?,?)
  `).bind(biz.id, user.id, role, session!.userId, new Date().toISOString()).run()

  // Email invite
  await sendEmail(c.env as any, user.email,
    `You've been added to ${biz.company_name} on ParkPeer`,
    `<p>Hi ${user.full_name},</p>
     <p>You've been added as a <strong>${role}</strong> to <strong>${biz.company_name}</strong> on ParkPeer for Business.</p>
     <p><a href="https://parkpeer.pages.dev/business/dashboard">Go to Business Dashboard</a></p>`)

  return c.json({ success: true, user_id: user.id, role, company: biz.company_name }, 201)
})

// GET /api/business/users
platformApiRoutes.get('/business/users', async (c) => {
  const { error, status, biz } = await requireBusiness(c, ['admin','manager'])
  if (error) return c.json({ error }, status)
  const db = c.env?.DB!

  const { results } = await db.prepare(`
    SELECT bu.id, bu.role, bu.created_at,
           u.id AS user_id, u.full_name, u.email, u.avatar_url, u.status
    FROM business_users bu
    JOIN users u ON bu.user_id = u.id
    WHERE bu.business_id = ?
    ORDER BY bu.created_at ASC
  `).bind(biz.id).all<any>()

  return c.json({ team: results, total: results.length })
})

// DELETE /api/business/users/:user_id
platformApiRoutes.delete('/business/users/:user_id', async (c) => {
  const { error, status, session, biz } = await requireBusiness(c, ['admin'])
  if (error) return c.json({ error }, status)
  const db      = c.env?.DB!
  const userId  = parseInt(c.req.param('user_id'))

  // Cannot remove self
  if (userId === session!.userId) {
    return c.json({ error: 'Cannot remove yourself from the business' }, 400)
  }
  // Cannot remove owner
  if (userId === biz.owner_user_id) {
    return c.json({ error: 'Cannot remove the business owner' }, 400)
  }

  const member = await db.prepare('SELECT id FROM business_users WHERE business_id=? AND user_id=?')
    .bind(biz.id, userId).first()
  if (!member) return c.json({ error: 'User is not a team member' }, 404)

  await db.prepare('DELETE FROM business_users WHERE business_id=? AND user_id=?')
    .bind(biz.id, userId).run()
  return c.json({ success: true })
})

// PATCH /api/business/users/:user_id/role
platformApiRoutes.patch('/business/users/:user_id/role', async (c) => {
  const { error, status, biz } = await requireBusiness(c, ['admin'])
  if (error) return c.json({ error }, status)
  const db     = c.env?.DB!
  const userId = parseInt(c.req.param('user_id'))
  let body: any = {}
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  if (!['admin','manager','staff'].includes(body.role)) {
    return c.json({ error: 'Invalid role' }, 400)
  }
  if (userId === biz.owner_user_id) return c.json({ error: "Cannot change the owner's role" }, 400)

  await db.prepare('UPDATE business_users SET role=? WHERE business_id=? AND user_id=?')
    .bind(body.role, biz.id, userId).run()
  return c.json({ success: true, new_role: body.role })
})

// ── Admin: Business Overview ──────────────────────────────────────────────────

// GET /api/admin/business/overview
platformApiRoutes.get('/admin/business/overview', async (c) => {
  const session = await requireAuth(c)
  if (!session || session.role !== 'ADMIN') {
    return c.json({ error: 'Admin access required' }, 403)
  }
  const db = c.env?.DB!

  const totals = await db.prepare(`
    SELECT
      COUNT(*) AS total_businesses,
      SUM(CASE WHEN verification_status='verified'  THEN 1 ELSE 0 END) AS verified,
      SUM(CASE WHEN verification_status='pending'   THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN verification_status='rejected'  THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN verification_status='suspended' THEN 1 ELSE 0 END) AS suspended
    FROM business_accounts
  `).first<any>()

  // Business revenue: sum of completed bookings linked to business spots
  const revRow = await db.prepare(`
    SELECT SUM(b.total_charged) AS total_revenue
    FROM bookings b
    JOIN business_spots bs ON bs.listing_id = b.listing_id
    WHERE b.status = 'completed'
  `).first<any>()

  const { results: recentBiz } = await db.prepare(`
    SELECT ba.id, ba.company_name, ba.verification_status, ba.business_email,
           ba.created_at, u.full_name AS owner_name,
           COUNT(bs.id) AS spot_count
    FROM business_accounts ba
    JOIN users u ON ba.owner_user_id = u.id
    LEFT JOIN business_spots bs ON bs.business_id = ba.id
    GROUP BY ba.id
    ORDER BY ba.created_at DESC
    LIMIT 20
  `).all<any>()

  return c.json({
    stats: {
      ...totals,
      total_business_revenue: (revRow?.total_revenue || 0).toFixed(2)
    },
    recent_businesses: recentBiz
  })
})

// PATCH /api/admin/business/:biz_id/verify
platformApiRoutes.patch('/admin/business/:biz_id/verify', async (c) => {
  const session = await requireAuth(c)
  if (!session || session.role !== 'ADMIN') return c.json({ error: 'Admin access required' }, 403)
  const db    = c.env?.DB!
  const bizId = parseInt(c.req.param('biz_id'))

  let body: any = {}
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const validStatuses = ['verified','rejected','suspended','pending']
  if (!validStatuses.includes(body.verification_status)) {
    return c.json({ error: `verification_status must be one of: ${validStatuses.join(', ')}` }, 400)
  }

  const nowTs = new Date().toISOString()
  await db.prepare(`
    UPDATE business_accounts SET verification_status=?, verified_at=?, updated_at=? WHERE id=?
  `).bind(
    body.verification_status,
    body.verification_status === 'verified' ? nowTs : null,
    nowTs, bizId
  ).run()

  // Notify business owner
  const biz = await db.prepare('SELECT business_email, company_name FROM business_accounts WHERE id=?')
    .bind(bizId).first<any>()
  if (biz) {
    const statusMsg = body.verification_status === 'verified'
      ? 'has been verified! You now have full access to ParkPeer for Business.'
      : `status has been updated to: ${body.verification_status}.`
    await sendEmail(c.env as any, biz.business_email,
      `ParkPeer Business Account Update — ${biz.company_name}`,
      `<p>Your business account for <strong>${biz.company_name}</strong> ${statusMsg}</p>
       <p><a href="https://parkpeer.pages.dev/business/dashboard">Open Business Dashboard</a></p>`)
  }

  return c.json({ success: true, business_id: bizId, new_status: body.verification_status })
})
