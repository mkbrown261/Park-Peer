/**
 * ParkPeer Admin Control API  v2.0
 * ─────────────────────────────────────────────────────────────────────────────
 * All routes are under /api/admin/* and require a valid admin session cookie
 * (__pp_admin) verified by adminAuthMiddleware.
 *
 * Endpoints:
 *   GET  /api/admin/users              — paginated user list with balances
 *   GET  /api/admin/users/:id          — full user detail + balance breakdown
 *   POST /api/admin/users/:id/delete   — full deletion pipeline
 *   POST /api/admin/users/:id/suspend  — suspend/unsuspend user
 *   POST /api/admin/users/:id/refund   — standalone manual refund
 *   GET  /api/admin/audit-log          — paginated audit log
 *   GET  /api/admin/refund-log         — paginated refund log
 *   POST /api/admin/verify-password    — re-confirm admin credentials
 *
 * Schema column facts (confirmed from PRAGMA table_info):
 *   payments: stripe_payment_intent_id  (NOT stripe_payment_intent)
 *   payments: NO updated_at column
 *   bookings: cancel_reason             (NOT cancellation_reason)
 *   bookings: cancelled_by              (NOT cancellation_by)
 *   users:    stripe_account_id on users table directly (no payout_info join needed)
 *   users:    deleted_at column exists
 *   users:    updated_at column exists
 */

import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { adminApiAuthMiddleware } from './admin-auth'
import { verifyPassword, hashPassword } from '../middleware/security'

type Bindings = {
  DB: D1Database
  STRIPE_SECRET_KEY: string
  RESEND_API_KEY: string
  FROM_EMAIL: string
  TWILIO_ACCOUNT_SID: string
  TWILIO_AUTH_TOKEN: string
  TWILIO_PHONE_NUMBER: string
  ADMIN_USERNAME: string
  ADMIN_PASSWORD: string
}

export const adminApiRoutes = new Hono<{ Bindings: Bindings }>()

// ── All admin API routes require admin session ────────────────────────────────
adminApiRoutes.use('/*', adminApiAuthMiddleware)

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Get admin identity from cookie session.
 * If no DB admin record found (env-var based auth), returns synthetic id=0 record.
 */
async function getAdminUser(c: any): Promise<{ id: number; email: string; username: string } | null> {
  // Accept token from cookie OR Authorization: Bearer header
  let token = getCookie(c, '__pp_admin')
  if (!token) {
    const authHeader = c.req.header('Authorization') || ''
    if (authHeader.startsWith('Bearer ')) token = authHeader.slice(7)
  }
  if (!token) return null

  // Token format: <username>.<issuedAt>.<hmac>  (from admin-auth.ts signToken)
  const parts = token.split('.')
  if (parts.length < 3) return null
  const username = decodeURIComponent(parts[0])

  const db: D1Database | undefined = c.env?.DB

  // Try to find an ADMIN-role user in the DB
  if (db && username) {
    try {
      const row = await db.prepare(
        `SELECT id, email FROM users WHERE (email=? OR username=?) AND role='ADMIN' AND status='active' LIMIT 1`
      ).bind(username, username).first<any>()
      if (row) return { id: row.id, email: row.email, username }
    } catch { /* ignore */ }
  }

  // Env-var super-admin: use id=0 sentinel + synthetic email
  const expectedUsername = c.env?.ADMIN_USERNAME || 'adminpanama'
  if (username === expectedUsername || username) {
    return { id: 0, email: `${username}@admin.parkpeer`, username }
  }

  return null
}

/**
 * Calculate user's refundable balance from the payments table.
 * Uses correct column name: stripe_payment_intent_id
 */
async function calcUserBalance(db: D1Database, userId: number): Promise<{
  driverCredits: number
  hostEarnings: number
  pendingPayments: number
  total: number
  breakdown: Array<{ label: string; amount: number; type: string }>
}> {
  try {
    // Driver credits: payments they made for future/active bookings
    const driverFuture = await db.prepare(`
      SELECT COALESCE(SUM(p.amount), 0) as total
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
      WHERE p.driver_id = ? AND p.status = 'succeeded'
        AND b.status IN ('pending','confirmed')
        AND b.start_time > datetime('now')
    `).bind(userId).first<any>()

    // Host earnings: earned but payout not completed
    // payments table has no payout_status column; use stripe_transfer_id as payout proxy
    const hostPending = await db.prepare(`
      SELECT COALESCE(SUM(p.host_payout), 0) as total
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
      WHERE p.host_id = ? AND p.status = 'succeeded'
        AND b.status = 'completed'
        AND (p.stripe_transfer_id IS NULL OR p.stripe_transfer_id = '')
    `).bind(userId).first<any>()

    // Pending held payments (auth'd but not captured)
    const pending = await db.prepare(`
      SELECT COALESCE(SUM(p.amount), 0) as total
      FROM payments p
      WHERE (p.driver_id = ? OR p.host_id = ?) AND p.status = 'pending'
    `).bind(userId, userId).first<any>()

    const driverCredits   = Math.round((driverFuture?.total ?? 0) * 100) / 100
    const hostEarnings    = Math.round((hostPending?.total   ?? 0) * 100) / 100
    const pendingPayments = Math.round((pending?.total       ?? 0) * 100) / 100
    const total           = Math.round((driverCredits + hostEarnings + pendingPayments) * 100) / 100

    const breakdown = [
      { label: 'Future booking credits (driver)', amount: driverCredits,   type: 'driver_credits' },
      { label: 'Unpaid host earnings',            amount: hostEarnings,    type: 'host_earnings'  },
      { label: 'Pending held payments',           amount: pendingPayments, type: 'pending_payments' },
    ].filter(b => b.amount > 0)

    return { driverCredits, hostEarnings, pendingPayments, total, breakdown }
  } catch {
    return { driverCredits: 0, hostEarnings: 0, pendingPayments: 0, total: 0, breakdown: [] }
  }
}

/** Check deletion blockers — open disputes and active bookings */
async function checkDeletionBlockers(db: D1Database, userId: number): Promise<{
  blocked: boolean
  reasons: string[]
  openDisputes: number
  activeBookings: number
}> {
  const reasons: string[] = []

  const disputes = await db.prepare(`
    SELECT COUNT(*) as n FROM disputes
    WHERE (raised_by = ? OR against = ?) AND status = 'open'
  `).bind(userId, userId).first<any>()
  const openDisputes = disputes?.n ?? 0
  if (openDisputes > 0) reasons.push(`${openDisputes} unresolved dispute(s) require review`)

  const bookings = await db.prepare(`
    SELECT COUNT(*) as n FROM bookings
    WHERE (driver_id = ? OR host_id = ?) AND status IN ('confirmed','active')
      AND end_time > datetime('now')
  `).bind(userId, userId).first<any>()
  const activeBookings = bookings?.n ?? 0
  if (activeBookings > 0) reasons.push(`${activeBookings} active/confirmed booking(s) in progress`)

  return { blocked: reasons.length > 0, reasons, openDisputes, activeBookings }
}

/** Write to admin_audit_log, return inserted row ID */
async function writeAuditLog(db: D1Database, params: {
  adminId: number
  adminEmail: string
  action: string
  targetType: string
  targetId: number
  targetEmail?: string
  targetRole?: string
  details?: any
  reason?: string
  ip?: string
}): Promise<number> {
  try {
    const r = await db.prepare(`
      INSERT INTO admin_audit_log
        (admin_id, admin_email, action, target_type, target_id, target_email, target_role, details, reason, ip_address)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).bind(
      params.adminId, params.adminEmail, params.action,
      params.targetType, params.targetId,
      params.targetEmail ?? null, params.targetRole ?? null,
      params.details ? JSON.stringify(params.details) : null,
      params.reason ?? null, params.ip ?? null
    ).run()
    return (r.meta?.last_row_id as number) ?? 0
  } catch (e: any) {
    console.error('[writeAuditLog]', e.message)
    return 0
  }
}

/** Issue a Stripe refund for a payment intent or charge */
async function stripeRefund(stripeKey: string, params: {
  paymentIntentId?: string
  chargeId?: string
  amount: number
}): Promise<{ success: boolean; refundId?: string; error?: string }> {
  if (!stripeKey || !stripeKey.startsWith('sk_')) {
    return { success: false, error: 'Stripe not configured — use manual refund' }
  }
  if (params.amount <= 0) {
    return { success: false, error: 'Refund amount must be positive' }
  }
  try {
    const body = new URLSearchParams()
    body.set('amount', String(Math.round(params.amount * 100))) // convert to cents
    if (params.paymentIntentId) body.set('payment_intent', params.paymentIntentId)
    else if (params.chargeId)   body.set('charge', params.chargeId)
    else return { success: false, error: 'No payment identifier provided' }

    const r = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': '2023-10-16',
      },
      body: body.toString()
    })
    const data: any = await r.json()
    if (data.id && data.object === 'refund') {
      return { success: true, refundId: data.id }
    }
    return { success: false, error: data.error?.message ?? `Stripe error: ${JSON.stringify(data)}` }
  } catch (e: any) {
    return { success: false, error: `Network error: ${e.message}` }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// GET /api/admin/users  — Paginated user list with balance summary
// ════════════════════════════════════════════════════════════════════════════
adminApiRoutes.get('/users', async (c: any) => {
  const db: D1Database | undefined = c.env?.DB
  if (!db) return c.json({ error: 'DB not available' }, 500)

  const q      = c.req.query('q')      ?? ''
  const role   = c.req.query('role')   ?? ''
  const status = c.req.query('status') ?? ''
  const limit  = Math.min(parseInt(c.req.query('limit')  ?? '50'), 200)
  const offset = parseInt(c.req.query('offset') ?? '0')

  try {
    const where: string[] = ["u.status != 'deleted'"]
    const params: any[]   = []

    if (q) {
      where.push("(u.email LIKE ? OR u.full_name LIKE ? OR u.username LIKE ?)")
      params.push(`%${q}%`, `%${q}%`, `%${q}%`)
    }
    if (role)   { where.push("u.role = ?");   params.push(role.toUpperCase()) }
    if (status) { where.push("u.status = ?"); params.push(status) }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : ''

    const total = await db.prepare(`SELECT COUNT(*) as n FROM users u ${whereClause}`)
      .bind(...params).first<any>()

    const rows = await db.prepare(`
      SELECT
        u.id, u.full_name, u.email, u.role, u.status, u.created_at,
        u.id_verified, u.stripe_customer_id, u.phone,
        (SELECT COUNT(*) FROM listings   WHERE host_id=u.id AND status='active')          AS active_listings,
        (SELECT COUNT(*) FROM bookings   WHERE (driver_id=u.id OR host_id=u.id)
                                           AND status IN ('confirmed','active'))           AS active_bookings,
        (SELECT COUNT(*) FROM disputes   WHERE (raised_by=u.id OR against=u.id)
                                           AND status='open')                             AS open_disputes,
        (SELECT COALESCE(SUM(amount),0)     FROM payments WHERE driver_id=u.id
                                           AND status='succeeded')                        AS total_paid,
        (SELECT COALESCE(SUM(host_payout),0) FROM payments WHERE host_id=u.id
                                           AND status='succeeded')                        AS total_earned
      FROM users u
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all<any>()

    const users = (rows.results || []).map((u: any) => ({
      id:               u.id,
      full_name:        u.full_name,
      email:            u.email,
      role:             u.role,
      status:           u.status,
      created_at:       u.created_at,
      id_verified:      u.id_verified === 1,
      stripe_customer_id: u.stripe_customer_id,
      active_listings:  u.active_listings  ?? 0,
      active_bookings:  u.active_bookings  ?? 0,
      open_disputes:    u.open_disputes    ?? 0,
      total_paid:       Math.round((u.total_paid   ?? 0) * 100) / 100,
      total_earned:     Math.round((u.total_earned ?? 0) * 100) / 100,
      can_delete:       (u.open_disputes ?? 0) === 0 && (u.active_bookings ?? 0) === 0,
    }))

    return c.json({ users, total: total?.n ?? 0, limit, offset })
  } catch (e: any) {
    console.error('[admin/users]', e.message)
    return c.json({ error: 'Failed to fetch users'}, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// GET /api/admin/users/:id  — Full user detail + balance + blockers
// ════════════════════════════════════════════════════════════════════════════
adminApiRoutes.get('/users/:id', async (c: any) => {
  const db: D1Database | undefined = c.env?.DB
  if (!db) return c.json({ error: 'DB not available' }, 500)

  const userId = parseInt(c.req.param('id'))
  if (isNaN(userId)) return c.json({ error: 'Invalid user ID' }, 400)

  try {
    // users table has stripe_account_id directly; payout_info has bank details
    const user = await db.prepare(`
      SELECT u.id, u.full_name, u.email, u.role, u.status, u.created_at,
             u.phone, u.id_verified, u.stripe_customer_id, u.stripe_account_id,
             u.updated_at, u.deleted_at,
             pi.bank_account_last4, pi.bank_routing_last4
      FROM users u
      LEFT JOIN payout_info pi ON pi.user_id = u.id
      WHERE u.id = ?
    `).bind(userId).first<any>()

    if (!user) return c.json({ error: 'User not found' }, 404)

    const balance  = await calcUserBalance(db, userId)
    const blockers = await checkDeletionBlockers(db, userId)

    // Recent payments — using correct column name stripe_payment_intent_id
    const payments = await db.prepare(`
      SELECT p.id, p.booking_id, p.amount, p.host_payout, p.platform_fee,
             p.status, p.stripe_payment_intent_id, p.stripe_charge_id,
             p.created_at, b.status AS booking_status, b.start_time
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
      WHERE (p.driver_id = ? OR p.host_id = ?)
        AND p.status IN ('succeeded','pending')
      ORDER BY p.created_at DESC
      LIMIT 20
    `).bind(userId, userId).all<any>()

    // Listings
    const listings = await db.prepare(`
      SELECT id, title, status, city, state FROM listings
      WHERE host_id = ? ORDER BY created_at DESC LIMIT 20
    `).bind(userId).all<any>()

    // Bookings (using correct column: total_charged not total_amount)
    const bookings = await db.prepare(`
      SELECT id, status, start_time, end_time, total_charged FROM bookings
      WHERE driver_id = ? OR host_id = ?
      ORDER BY start_time DESC LIMIT 20
    `).bind(userId, userId).all<any>()

    return c.json({
      user: {
        id:                 user.id,
        full_name:          user.full_name,
        email:              user.email,
        role:               user.role,
        status:             user.status,
        created_at:         user.created_at,
        updated_at:         user.updated_at,
        deleted_at:         user.deleted_at,
        phone:              user.phone,
        id_verified:        user.id_verified === 1,
        stripe_customer_id: user.stripe_customer_id,
        stripe_account_id:  user.stripe_account_id,
        bank_last4:         user.bank_account_last4,
      },
      balance,
      blockers,
      payments:  payments.results  || [],
      listings:  listings.results  || [],
      bookings:  bookings.results  || [],
    })
  } catch (e: any) {
    console.error('[admin/users/:id]', e.message)
    return c.json({ error: 'Failed to fetch user detail'}, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// POST /api/admin/verify-password  — Re-confirm admin before destructive actions
// Body: { password: string }
// ════════════════════════════════════════════════════════════════════════════
adminApiRoutes.post('/verify-password', async (c: any) => {
  const admin = await getAdminUser(c)
  if (!admin) return c.json({ verified: false, error: 'Not authenticated' }, 401)

  let body: any = {}
  try { body = await c.req.json() } catch {}
  const { password } = body
  if (!password) return c.json({ verified: false, error: 'Password required' }, 400)

  const expectedUsername = c.env?.ADMIN_USERNAME || 'adminpanama'
  const expectedPassword = c.env?.ADMIN_PASSWORD || '999000kK!'

  // If this is the env-var super-admin, compare against env-var password directly
  if (admin.username === expectedUsername || admin.id === 0) {
    const ok = password === expectedPassword
    return c.json({ verified: ok, error: ok ? undefined : 'Incorrect password' })
  }

  // DB admin: verify hashed password
  const db: D1Database | undefined = c.env?.DB
  if (db && admin.id > 0) {
    try {
      const row = await db.prepare(`SELECT password_hash FROM users WHERE id = ?`)
        .bind(admin.id).first<any>()
      if (row?.password_hash && row.password_hash !== 'DELETED') {
        const ok = await verifyPassword(password, row.password_hash)
        return c.json({ verified: ok, error: ok ? undefined : 'Incorrect password' })
      }
    } catch (e: any) {
      console.error('[verify-password]', e.message)
    }
  }

  return c.json({ verified: false, error: 'Admin record not found' }, 404)
})

// ════════════════════════════════════════════════════════════════════════════
// POST /api/admin/users/:id/delete  — Full deletion pipeline
// Body: { reason: string, force?: boolean }
//
// Pipeline:
//  1. Verify admin identity
//  2. Load target user
//  3. Check blockers (disputes, active bookings) — block unless force=true
//  4. Cancel future bookings
//  5. Deactivate all listings
//  6. Calculate balance & issue Stripe refunds
//  7. Write admin_audit_log
//  8. Write admin_refund_log entries
//  9. Write user_deletions compliance record
// 10. Soft-delete user (status='deleted', scrub PII)
// 11. Return summary
// ════════════════════════════════════════════════════════════════════════════
adminApiRoutes.post('/users/:id/delete', async (c: any) => {
  const db: D1Database | undefined = c.env?.DB
  const stripeKey: string          = c.env?.STRIPE_SECRET_KEY ?? ''
  if (!db) return c.json({ error: 'DB not available' }, 500)

  const admin = await getAdminUser(c)
  if (!admin) return c.json({ error: 'Not authenticated' }, 401)

  const userId = parseInt(c.req.param('id'))
  if (isNaN(userId)) return c.json({ error: 'Invalid user ID' }, 400)
  if (userId === admin.id && admin.id !== 0) {
    return c.json({ error: 'Cannot delete your own admin account' }, 403)
  }

  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? 'unknown'

  let body: any = {}
  try { body = await c.req.json() } catch {}
  const reason   = (body.reason ?? '').toString().trim()
  const force    = body.force === true
  const password = (body.password ?? '').toString()

  if (!reason) return c.json({ error: 'A deletion reason is required' }, 400)

  // Verify admin password inline (so UI only needs one request)
  if (password) {
    const expectedPassword = c.env?.ADMIN_PASSWORD || '999000kK!'
    const expectedUsername = c.env?.ADMIN_USERNAME || 'adminpanama'
    if (admin.username === expectedUsername || admin.id === 0) {
      if (password !== expectedPassword) {
        return c.json({ error: 'Incorrect admin password', code: 'wrong_password' }, 403)
      }
    }
  }

  try {
    // ── 1. Load target user ────────────────────────────────────────────────
    const user = await db.prepare(`
      SELECT id, full_name, email, role, status, stripe_customer_id
      FROM users WHERE id = ?
    `).bind(userId).first<any>()

    if (!user) return c.json({ error: 'User not found' }, 404)
    if (user.status === 'deleted') return c.json({ error: 'User already deleted' }, 409)
    if (user.role === 'ADMIN') return c.json({ error: 'Cannot delete admin accounts via this flow' }, 403)

    // ── 2. Check blockers ──────────────────────────────────────────────────
    const blockers = await checkDeletionBlockers(db, userId)
    if (blockers.blocked && !force) {
      return c.json({
        error:    'Deletion blocked',
        reasons:  blockers.reasons,
        blockers,
        canForce: true,
      }, 422)
    }

    // ── 3. Cancel future / active bookings ─────────────────────────────────
    // bookings uses cancel_reason (not cancellation_reason) and cancelled_by
    const cancelledBookings = await db.prepare(`
      UPDATE bookings
      SET status = 'cancelled',
          updated_at = datetime('now'),
          cancel_reason = 'Account deleted by admin',
          cancelled_by = 'admin'
      WHERE (driver_id = ? OR host_id = ?)
        AND status IN ('pending','confirmed','active')
        AND end_time > datetime('now')
    `).bind(userId, userId).run()
    const cancelledCount = cancelledBookings.meta?.changes ?? 0

    // ── 4. Deactivate all listings ──────────────────────────────────────────
    const deactivated = await db.prepare(`
      UPDATE listings SET status = 'archived', updated_at = datetime('now')
      WHERE host_id = ? AND status IN ('active','pending')
    `).bind(userId).run()
    const deactivatedCount = deactivated.meta?.changes ?? 0

    // ── 5. Calculate balance & issue refunds ───────────────────────────────
    const balance       = await calcUserBalance(db, userId)
    const refundResults: any[] = []
    let totalRefunded   = 0
    let refundStatus    = 'none'

    if (balance.total > 0) {
      // Find refundable payments for driver credits
      // Using correct column: stripe_payment_intent_id
      const refundablePayments = await db.prepare(`
        SELECT p.id, p.booking_id, p.amount,
               p.stripe_payment_intent_id, p.stripe_charge_id
        FROM payments p
        JOIN bookings b ON b.id = p.booking_id
        WHERE p.driver_id = ? AND p.status = 'succeeded'
          AND b.status IN ('pending','confirmed','cancelled')
        ORDER BY p.created_at DESC
        LIMIT 50
      `).bind(userId).all<any>()

      const toRefund = refundablePayments.results || []

      // Handle host earnings separately — require manual bank payout
      if (balance.hostEarnings > 0) {
        refundResults.push({
          type: 'manual', amount: balance.hostEarnings,
          status: 'manual_required',
          note: 'Host earnings require manual bank payout via Stripe Connect'
        })
        refundStatus = 'manual_required'
      }

      for (const pmt of toRefund) {
        if (!pmt.stripe_payment_intent_id && !pmt.stripe_charge_id) {
          refundResults.push({
            type: 'manual', amount: pmt.amount, status: 'manual_required',
            payment_id: pmt.id, note: 'No Stripe payment identifier found'
          })
          refundStatus = 'manual_required'
          continue
        }

        const result = await stripeRefund(stripeKey, {
          paymentIntentId: pmt.stripe_payment_intent_id,
          chargeId:        pmt.stripe_charge_id,
          amount:          pmt.amount
        })

        if (result.success) {
          totalRefunded += pmt.amount
          refundResults.push({
            type:       'stripe',
            amount:     pmt.amount,
            status:     'succeeded',
            refund_id:  result.refundId,
            payment_id: pmt.id
          })
          // Mark payment as refunded — payments table has no updated_at
          await db.prepare(`UPDATE payments SET status='refunded', stripe_refund_id=? WHERE id=?`)
            .bind(result.refundId ?? null, pmt.id).run()
        } else {
          refundResults.push({
            type:       'stripe',
            amount:     pmt.amount,
            status:     'failed',
            error:      result.error,
            payment_id: pmt.id
          })
          if (refundStatus !== 'manual_required') refundStatus = 'partial'
        }
      }

      if (balance.total === 0)          refundStatus = 'none'
      else if (totalRefunded >= balance.driverCredits && balance.hostEarnings === 0) refundStatus = 'full'
      else if (totalRefunded > 0)       refundStatus = 'partial'
      else if (refundStatus !== 'manual_required') refundStatus = 'failed'
    }

    // ── 6. Write audit log ─────────────────────────────────────────────────
    const auditId = await writeAuditLog(db, {
      adminId:     admin.id,
      adminEmail:  admin.email,
      action:      'delete_user',
      targetType:  'user',
      targetId:    userId,
      targetEmail: user.email,
      targetRole:  user.role,
      reason,
      ip,
      details: {
        user_name:              user.full_name,
        cancelled_bookings:     cancelledCount,
        deactivated_listings:   deactivatedCount,
        balance_at_deletion:    balance,
        refund_results:         refundResults,
        total_refunded:         totalRefunded,
        refund_status:          refundStatus,
        forced_override:        force,
        blockers_at_deletion:   blockers,
      }
    })

    // ── 7. Write refund log entries ────────────────────────────────────────
    for (const ref of refundResults) {
      try {
        await db.prepare(`
          INSERT INTO admin_refund_log
            (audit_log_id, user_id, user_email, refund_type, amount,
             stripe_refund_id, stripe_payment_intent, status, failure_reason, manual_note)
          VALUES (?,?,?,?,?,?,?,?,?,?)
        `).bind(
          auditId, userId, user.email,
          ref.type === 'stripe' ? 'stripe_payment_intent' : 'manual',
          ref.amount ?? 0,
          ref.refund_id ?? null,
          ref.payment_id ? null : null,
          ref.status ?? 'unknown',
          ref.error  ?? null,
          ref.note   ?? null
        ).run()
      } catch (e: any) {
        console.error('[refund_log insert]', e.message)
      }
    }

    // ── 8. Write compliance / GDPR record ─────────────────────────────────
    const emailBytes = new TextEncoder().encode(user.email.toLowerCase())
    const hashBuf    = await crypto.subtle.digest('SHA-256', emailBytes)
    const emailHash  = Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0')).join('')

    try {
      await db.prepare(`
        INSERT OR REPLACE INTO user_deletions
          (original_user_id, email_hash, role_snapshot, deletion_reason,
           deleted_by_admin_id, deleted_by_email, had_active_listings,
           had_active_bookings, total_refunded, refund_status, audit_log_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        userId, emailHash, user.role, reason,
        admin.id, admin.email,
        deactivatedCount > 0 ? 1 : 0,
        cancelledCount   > 0 ? 1 : 0,
        totalRefunded, refundStatus, auditId
      ).run()
    } catch (e: any) {
      console.error('[user_deletions insert]', e.message)
    }

    // ── 9. Soft-delete & scrub PII ─────────────────────────────────────────
    const scrubEmail    = `deleted_${userId}_${Date.now()}@deleted.parkpeer`
    const scrubName     = `[Deleted User ${userId}]`
    const scrubUsername = `deleted_${userId}`

    await db.prepare(`
      UPDATE users SET
        status            = 'deleted',
        email             = ?,
        full_name         = ?,
        username          = ?,
        phone             = NULL,
        password_hash     = 'DELETED',
        stripe_customer_id = NULL,
        stripe_account_id  = NULL,
        id_verified       = 0,
        deleted_at        = datetime('now'),
        updated_at        = datetime('now')
      WHERE id = ?
    `).bind(scrubEmail, scrubName, scrubUsername, userId).run()

    // Invalidate any active sessions
    try {
      await db.prepare(`DELETE FROM user_sessions WHERE user_id = ?`).bind(userId).run()
    } catch { /* table may not exist */ }

    // ── 10. Return result ──────────────────────────────────────────────────
    return c.json({
      success:              true,
      audit_log_id:         auditId,
      user_id:              userId,
      cancelled_bookings:   cancelledCount,
      deactivated_listings: deactivatedCount,
      balance_refunded:     totalRefunded,
      refund_status:        refundStatus,
      refund_details:       refundResults,
      message: totalRefunded > 0
        ? `User deleted. $${totalRefunded.toFixed(2)} refunded to original payment method.`
        : refundStatus === 'manual_required'
        ? 'User deleted. Manual refund/payout required — see refund details.'
        : 'User deleted successfully. No balance to refund.',
    })

  } catch (e: any) {
    console.error('[admin/delete]', e.message, e.stack)
    return c.json({ error: 'Deletion failed'}, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// POST /api/admin/users/:id/suspend  — Suspend or reactivate user
// Body: { action: 'suspend'|'unsuspend', reason: string }
// ════════════════════════════════════════════════════════════════════════════
adminApiRoutes.post('/users/:id/suspend', async (c: any) => {
  const db: D1Database | undefined = c.env?.DB
  if (!db) return c.json({ error: 'DB not available' }, 500)

  const admin = await getAdminUser(c)
  if (!admin) return c.json({ error: 'Not authenticated' }, 401)

  const userId = parseInt(c.req.param('id'))
  if (isNaN(userId)) return c.json({ error: 'Invalid user ID' }, 400)

  let body: any = {}
  try { body = await c.req.json() } catch {}
  const action = body.action ?? 'suspend'   // 'suspend' | 'unsuspend'
  const reason = (body.reason ?? '').toString().trim()
  if (!reason) return c.json({ error: 'Reason required' }, 400)

  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'

  try {
    const user = await db.prepare(`SELECT id, email, role, status FROM users WHERE id = ?`)
      .bind(userId).first<any>()
    if (!user) return c.json({ error: 'User not found' }, 404)
    if (user.role === 'ADMIN') return c.json({ error: 'Cannot suspend admin accounts' }, 403)

    const newStatus = action === 'unsuspend' ? 'active' : 'suspended'
    await db.prepare(`UPDATE users SET status=?, updated_at=datetime('now') WHERE id=?`)
      .bind(newStatus, userId).run()

    const auditId = await writeAuditLog(db, {
      adminId: admin.id, adminEmail: admin.email,
      action: action === 'unsuspend' ? 'unsuspend_user' : 'suspend_user',
      targetType: 'user', targetId: userId,
      targetEmail: user.email, targetRole: user.role,
      reason, ip,
      details: { previous_status: user.status, new_status: newStatus }
    })

    return c.json({ success: true, new_status: newStatus, audit_log_id: auditId })
  } catch (e: any) {
    return c.json({ error: 'Failed to update user status'}, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// POST /api/admin/users/:id/reset-password
// Body: { new_password: string }
// Resets a user's password to a new value (admin only).
// ════════════════════════════════════════════════════════════════════════════
adminApiRoutes.post('/users/:id/reset-password', async (c: any) => {
  const db: D1Database | undefined = c.env?.DB
  if (!db) return c.json({ error: 'DB not available' }, 500)

  const userId = parseInt(c.req.param('id'), 10)
  if (isNaN(userId)) return c.json({ error: 'Invalid user ID' }, 400)

  let body: any = {}
  try { body = await c.req.json() } catch {}

  const newPassword = String(body.new_password || '').trim()
  if (!newPassword || newPassword.length < 8) {
    return c.json({ error: 'new_password must be at least 8 characters' }, 400)
  }

  try {
    const user = await db.prepare('SELECT id, email, full_name FROM users WHERE id = ?')
      .bind(userId).first<any>()
    if (!user) return c.json({ error: 'User not found' }, 404)

    const newHash = await hashPassword(newPassword)
    await db.prepare(
      'UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).bind(newHash, userId).run()

    return c.json({
      success: true,
      message: `Password reset for ${user.full_name} (${user.email})`,
      user_id: userId,
    })
  } catch (e: any) {
    console.error('[admin/reset-password]', e.message)
    return c.json({ error: 'Failed to reset password' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// POST /api/admin/users/:id/refund  — Standalone manual refund
// Body: { amount: number, reason: string, note?: string }
// ════════════════════════════════════════════════════════════════════════════
adminApiRoutes.post('/users/:id/refund', async (c: any) => {
  const db: D1Database | undefined = c.env?.DB
  const stripeKey: string          = c.env?.STRIPE_SECRET_KEY ?? ''
  if (!db) return c.json({ error: 'DB not available' }, 500)

  const admin = await getAdminUser(c)
  if (!admin) return c.json({ error: 'Not authenticated' }, 401)

  const userId = parseInt(c.req.param('id'))
  if (isNaN(userId)) return c.json({ error: 'Invalid user ID' }, 400)

  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'
  let body: any = {}
  try { body = await c.req.json() } catch {}

  const amount = parseFloat(body.amount ?? 0)
  const reason = (body.reason ?? '').toString().trim()
  const note   = (body.note   ?? '').toString().trim()

  if (!reason)     return c.json({ error: 'Reason required' }, 400)
  if (amount <= 0) return c.json({ error: 'Amount must be positive' }, 400)

  try {
    const user = await db.prepare(`SELECT id, email, role, stripe_customer_id FROM users WHERE id = ?`)
      .bind(userId).first<any>()
    if (!user) return c.json({ error: 'User not found' }, 404)

    // Find most recent refundable payment — using correct column name
    const pmt = await db.prepare(`
      SELECT id, stripe_payment_intent_id, stripe_charge_id, amount
      FROM payments WHERE driver_id = ? AND status = 'succeeded'
      ORDER BY created_at DESC LIMIT 1
    `).bind(userId).first<any>()

    let refundResult: any = { status: 'manual_required', note: 'No Stripe payment found — manual refund required' }

    if (pmt?.stripe_payment_intent_id || pmt?.stripe_charge_id) {
      const r = await stripeRefund(stripeKey, {
        paymentIntentId: pmt.stripe_payment_intent_id,
        chargeId:        pmt.stripe_charge_id,
        amount
      })
      refundResult = r.success
        ? { status: 'succeeded', refund_id: r.refundId }
        : { status: 'failed', error: r.error }
    }

    const auditId = await writeAuditLog(db, {
      adminId: admin.id, adminEmail: admin.email,
      action: 'issue_refund', targetType: 'user', targetId: userId,
      targetEmail: user.email, targetRole: user.role,
      reason, ip, details: { amount, refundResult, note }
    })

    await db.prepare(`
      INSERT INTO admin_refund_log
        (audit_log_id, user_id, user_email, refund_type, amount, stripe_refund_id, status, manual_note)
      VALUES (?,?,?,?,?,?,?,?)
    `).bind(
      auditId, userId, user.email, 'manual', amount,
      refundResult.refund_id ?? null, refundResult.status, note || null
    ).run()

    return c.json({ success: true, refund: refundResult, audit_log_id: auditId })
  } catch (e: any) {
    return c.json({ error: 'Refund failed'}, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// GET /api/admin/audit-log  — Paginated audit log with filters
// ════════════════════════════════════════════════════════════════════════════
adminApiRoutes.get('/audit-log', async (c: any) => {
  const db: D1Database | undefined = c.env?.DB
  if (!db) return c.json({ error: 'DB not available' }, 500)

  const action     = c.req.query('action')     ?? ''
  const targetType = c.req.query('targetType') ?? ''
  const adminId    = c.req.query('adminId')    ?? ''
  const limit      = Math.min(parseInt(c.req.query('limit')  ?? '50'), 200)
  const offset     = parseInt(c.req.query('offset') ?? '0')

  try {
    const where: string[] = []
    const params: any[]   = []

    if (action)     { where.push('action = ?');       params.push(action)     }
    if (targetType) { where.push('target_type = ?');  params.push(targetType) }
    if (adminId)    { where.push('admin_id = ?');     params.push(parseInt(adminId)) }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : ''

    const total = await db.prepare(`SELECT COUNT(*) as n FROM admin_audit_log ${whereClause}`)
      .bind(...params).first<any>()

    const rows = await db.prepare(`
      SELECT id, admin_id, admin_email, action, target_type, target_id,
             target_email, target_role, reason, details, ip_address, created_at
      FROM admin_audit_log ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all<any>()

    const entries = (rows.results || []).map((r: any) => ({
      ...r,
      details: r.details
        ? (() => { try { return JSON.parse(r.details) } catch { return r.details } })()
        : null
    }))

    return c.json({ entries, total: total?.n ?? 0, limit, offset })
  } catch (e: any) {
    return c.json({ error: 'Failed to fetch audit log'}, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// GET /api/admin/refund-log  — Paginated refund log
// ════════════════════════════════════════════════════════════════════════════
adminApiRoutes.get('/refund-log', async (c: any) => {
  const db: D1Database | undefined = c.env?.DB
  if (!db) return c.json({ error: 'DB not available' }, 500)

  const status = c.req.query('status') ?? ''
  const limit  = Math.min(parseInt(c.req.query('limit')  ?? '50'), 200)
  const offset = parseInt(c.req.query('offset') ?? '0')

  try {
    const where: string[] = []
    const params: any[] = []
    if (status) { where.push('status = ?'); params.push(status) }
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : ''

    const total = await db.prepare(`SELECT COUNT(*) as n FROM admin_refund_log ${whereClause}`)
      .bind(...params).first<any>()

    const rows = await db.prepare(`
      SELECT id, audit_log_id, user_id, user_email, refund_type, amount, currency,
             stripe_refund_id, status, failure_reason, manual_note, refunded_at
      FROM admin_refund_log ${whereClause}
      ORDER BY refunded_at DESC LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all<any>()

    return c.json({ entries: rows.results || [], total: total?.n ?? 0, limit, offset })
  } catch (e: any) {
    return c.json({ error: 'Failed to fetch refund log'}, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// GET /api/admin/stats  — Dashboard stats for user control page
// ════════════════════════════════════════════════════════════════════════════
adminApiRoutes.get('/stats', async (c: any) => {
  const db: D1Database | undefined = c.env?.DB
  if (!db) return c.json({ error: 'DB not available' }, 500)

  try {
    const [totalUsers, activeUsers, suspendedUsers, deletedUsers,
           auditCount, refundCount, manualRefunds] = await Promise.all([
      db.prepare(`SELECT COUNT(*) as n FROM users`).first<any>(),
      db.prepare(`SELECT COUNT(*) as n FROM users WHERE status='active'`).first<any>(),
      db.prepare(`SELECT COUNT(*) as n FROM users WHERE status='suspended'`).first<any>(),
      db.prepare(`SELECT COUNT(*) as n FROM users WHERE status='deleted'`).first<any>(),
      db.prepare(`SELECT COUNT(*) as n FROM admin_audit_log`).first<any>(),
      db.prepare(`SELECT COUNT(*) as n FROM admin_refund_log`).first<any>(),
      db.prepare(`SELECT COUNT(*) as n FROM admin_refund_log WHERE status='manual_required'`).first<any>(),
    ])

    return c.json({
      total_users:     totalUsers?.n     ?? 0,
      active_users:    activeUsers?.n    ?? 0,
      suspended_users: suspendedUsers?.n ?? 0,
      deleted_users:   deletedUsers?.n   ?? 0,
      audit_entries:   auditCount?.n     ?? 0,
      refund_entries:  refundCount?.n    ?? 0,
      manual_refunds_pending: manualRefunds?.n ?? 0,
    })
  } catch (e: any) {
    return c.json({ error: 'Failed to fetch stats'}, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// ADMIN NOTIFICATION ENDPOINTS  (auth: __pp_admin cookie / Bearer token)
// ════════════════════════════════════════════════════════════════════════════

// GET /api/admin/notifications
adminApiRoutes.get('/notifications', async (c: any) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  const limit  = Math.min(parseInt(c.req.query('limit')  || '30'), 100)
  const offset = parseInt(c.req.query('offset') || '0')

  try {
    const rows = await db.prepare(`
      SELECT id, type, title, message, related_entity, read_status, created_at
      FROM   notifications
      WHERE  user_role = 'admin' AND delivery_inapp = 1
      ORDER  BY created_at DESC
      LIMIT  ? OFFSET ?
    `).bind(limit, offset).all<any>()

    const unread = await db.prepare(
      `SELECT COUNT(*) AS n FROM notifications WHERE user_role = 'admin' AND read_status = 0 AND delivery_inapp = 1`
    ).first<{ n: number }>()

    const total = await db.prepare(
      `SELECT COUNT(*) AS n FROM notifications WHERE user_role = 'admin' AND delivery_inapp = 1`
    ).first<{ n: number }>()

    return c.json({
      notifications: (rows.results || []).map((r: any) => ({
        ...r,
        related_entity: r.related_entity ? (() => { try { return JSON.parse(r.related_entity) } catch { return null } })() : null,
      })),
      unread_count: unread?.n ?? 0,
      total:        total?.n  ?? 0,
    })
  } catch (e: any) {
    return c.json({ error: 'Failed to fetch notifications'}, 500)
  }
})

// PATCH /api/admin/notifications/read  — mark one (body:{id}) or all as read
adminApiRoutes.patch('/notifications/read', async (c: any) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  let body: any = {}
  try { body = await c.req.json() } catch {}

  try {
    if (body.id) {
      await db.prepare(
        `UPDATE notifications SET read_status = 1 WHERE id = ? AND user_role = 'admin'`
      ).bind(body.id).run()
    } else {
      await db.prepare(
        `UPDATE notifications SET read_status = 1 WHERE user_role = 'admin' AND read_status = 0`
      ).run()
    }
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Failed to update'}, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// GET /api/admin/payout-audit
// Full payment distribution audit with anomaly detection.
// Protected by adminApiAuthMiddleware (admin session cookie).
// Query params: ?days=30&page=1&per_page=50&status=all|ok|warning|error
// ════════════════════════════════════════════════════════════════════════════
adminApiRoutes.get('/payout-audit', async (c: any) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  const days    = Math.min(365, parseInt(c.req.query('days')     || '30'))
  const page    = Math.max(1,   parseInt(c.req.query('page')     || '1'))
  const perPage = Math.min(200, parseInt(c.req.query('per_page') || '50'))
  const filter  = c.req.query('status') || 'all'
  const offset  = (page - 1) * perPage

  try {
    // ── Summary stats ────────────────────────────────────────────────────
    const summary = await db.prepare(`
      SELECT
        COUNT(*)                                                      AS total_payments,
        COALESCE(SUM(amount),       0)                               AS total_charged,
        COALESCE(SUM(platform_fee), 0)                               AS total_platform_fees,
        COALESCE(SUM(host_payout),  0)                               AS total_host_payouts,
        COUNT(CASE WHEN stripe_transfer_id IS NOT NULL THEN 1 END)   AS transferred_count,
        COUNT(CASE WHEN stripe_transfer_id IS     NULL THEN 1 END)   AS pending_transfer_count,
        COUNT(CASE WHEN ABS(amount - (platform_fee + host_payout)) > 0.02 THEN 1 END) AS fee_mismatch_count,
        COUNT(CASE WHEN platform_fee < 0 OR host_payout < 0 THEN 1 END)               AS negative_value_count,
        COUNT(CASE
          WHEN amount > 0 AND ABS(platform_fee / (amount / 1.15) - 0.15) > 0.01 THEN 1
        END) AS fee_rate_mismatch_count
      FROM payments
      WHERE type = 'charge'
        AND status = 'succeeded'
        AND datetime(created_at) >= datetime('now', ? || ' days')
    `).bind(String(-days)).first<any>()

    const statusCondition = filter === 'ok'
      ? `AND ABS(p.amount - (p.platform_fee + p.host_payout)) <= 0.02 AND p.stripe_transfer_id IS NOT NULL`
      : filter === 'warning'
      ? `AND p.stripe_transfer_id IS NULL AND ABS(p.amount - (p.platform_fee + p.host_payout)) <= 0.02`
      : filter === 'error'
      ? `AND ABS(p.amount - (p.platform_fee + p.host_payout)) > 0.02`
      : ''

    const rows = await db.prepare(`
      SELECT
        p.id                       AS payment_id,
        p.booking_id,
        p.driver_id,
        p.host_id,
        p.amount                   AS total_charged,
        p.platform_fee,
        p.host_payout,
        ROUND(p.amount / 1.15, 2)  AS expected_subtotal,
        ROUND((p.amount / 1.15) * 0.15, 2) AS expected_platform_fee,
        ROUND((p.amount / 1.15) * 0.85, 2) AS expected_host_payout,
        ROUND(ABS(p.platform_fee - ROUND((p.amount / 1.15) * 0.15, 2)), 4) AS fee_delta,
        ROUND(ABS(p.amount - (p.platform_fee + p.host_payout)), 4)          AS split_delta,
        p.stripe_payment_intent_id AS payment_intent_id,
        p.stripe_charge_id         AS charge_id,
        p.stripe_transfer_id       AS transfer_id,
        p.status                   AS payment_status,
        pi2.stripe_account_id      AS host_stripe_account,
        pr.recovery_status         AS recovery_status,
        CASE
          WHEN ABS(p.amount - (p.platform_fee + p.host_payout)) > 0.02 THEN 'error'
          WHEN p.stripe_transfer_id IS NULL AND pr.recovery_status = 'payout_failed' THEN 'error'
          WHEN p.stripe_transfer_id IS NULL THEN 'warning'
          ELSE 'ok'
        END AS audit_status,
        p.created_at,
        p.updated_at
      FROM payments p
      LEFT JOIN payout_info pi2 ON pi2.user_id = p.host_id
      LEFT JOIN payment_recovery_log pr ON pr.stripe_pi_id = p.stripe_payment_intent_id
      WHERE p.type = 'charge'
        AND p.status = 'succeeded'
        AND datetime(p.created_at) >= datetime('now', ? || ' days')
        ${statusCondition}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(String(-days), perPage, offset).all<any>()

    // ── Recovery/payout backlog ───────────────────────────────────────────
    const recoveryRows = await db.prepare(`
      SELECT id, stripe_pi_id, amount_cents, recovery_status, error_detail, created_at
      FROM payment_recovery_log
      WHERE recovery_status IN ('payout_pending','payout_failed','pending')
        AND datetime(created_at) >= datetime('now', ? || ' days')
      ORDER BY created_at DESC
      LIMIT 100
    `).bind(String(-days)).all<any>()

    const s = summary || {}
    return c.json({
      period_days: days,
      page,
      per_page: perPage,
      summary: {
        total_payments:          s.total_payments          ?? 0,
        total_charged:           Number((s.total_charged          ?? 0).toFixed(2)),
        total_platform_fees:     Number((s.total_platform_fees    ?? 0).toFixed(2)),
        total_host_payouts:      Number((s.total_host_payouts     ?? 0).toFixed(2)),
        transferred_count:       s.transferred_count       ?? 0,
        pending_transfer_count:  s.pending_transfer_count  ?? 0,
        fee_mismatch_count:      s.fee_mismatch_count      ?? 0,
        negative_value_count:    s.negative_value_count    ?? 0,
        fee_rate_mismatch_count: s.fee_rate_mismatch_count ?? 0,
        health: (
          (s.fee_mismatch_count     ?? 0) === 0 &&
          (s.negative_value_count   ?? 0) === 0 &&
          (s.fee_rate_mismatch_count ?? 0) === 0
        ) ? 'healthy' : 'anomalies_detected',
      },
      payments:       rows?.results      ?? [],
      recovery_items: recoveryRows?.results ?? [],
    })
  } catch (e: any) {
    console.error('[payout-audit]', e.message)
    return c.json({ error: 'Audit query failed: ' + e.message }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// POST /api/admin/messaging-test
// Live diagnostic: validates Resend + Twilio credentials and fires a real
// test message to the provided email/phone.
// Body: { email?: string, phone?: string, services?: ('resend'|'twilio')[] }
// Returns per-service status with latency and error details.
// ════════════════════════════════════════════════════════════════════════════
adminApiRoutes.post('/messaging-test', async (c: any) => {
  const env = c.env as any
  const db  = env.DB

  let body: any = {}
  try { body = await c.req.json() } catch {}

  const targetEmail = String(body.email || '').trim()
  const targetPhone = String(body.phone || '').trim()
  const services: string[] = body.services || ['resend', 'twilio']

  const results: Record<string, any> = {}

  // ── 1. Resend Email Test ───────────────────────────────────────────────────
  if (services.includes('resend')) {
    const apiKey  = env.RESEND_API_KEY
    const fromRaw = env.FROM_EMAIL || ''

    if (!apiKey) {
      results.resend = { ok: false, error: 'RESEND_API_KEY environment variable is not set', fix: 'Add RESEND_API_KEY secret in Cloudflare Pages → Settings → Environment Variables' }
    } else if (apiKey === 'PLACEHOLDER_RESEND_KEY') {
      results.resend = { ok: false, error: 'RESEND_API_KEY is still the placeholder value', fix: 'Replace with a real key from resend.com/api-keys' }
    } else {
      // Step A: validate key against Resend API
      const t0 = Date.now()
      try {
        const authCheck = await fetch('https://api.resend.com/domains', {
          headers: { Authorization: `Bearer ${apiKey}` }
        })
        const authData = await authCheck.json() as any
        const latencyMs = Date.now() - t0

        if (!authCheck.ok) {
          results.resend = {
            ok: false,
            http_status: authCheck.status,
            error: authData?.message || authData?.name || 'API key rejected',
            latency_ms: latencyMs,
            fix: authCheck.status === 403 ? 'API key does not have domain:read permission — regenerate at resend.com/api-keys' : 'Check API key validity at resend.com/api-keys',
          }
        } else {
          // Key is valid — extract verified domains
          const domains: any[] = authData.data || []
          const verifiedDomains = domains.filter((d: any) => d.status === 'verified').map((d: any) => d.name)
          const allDomains = domains.map((d: any) => `${d.name} (${d.status})`)

          // Determine effective FROM address
          const fromEmail = fromRaw || 'onboarding@resend.dev'
          const isSandbox = fromEmail.endsWith('@resend.dev')

          // Step B: send test email if target provided
          let sendResult: any = null
          if (targetEmail) {
            const t1 = Date.now()
            const sendRes = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from:    `ParkPeer <${fromEmail}>`,
                to:      [targetEmail],
                subject: '✅ ParkPeer Messaging System — Live Test',
                html: `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#f4f4f7;padding:40px 20px;margin:0">
                  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:40px;border:1px solid #e5e7eb">
                    <div style="text-align:center;margin-bottom:28px">
                      <span style="font-size:32px">🅿️</span>
                      <h1 style="color:#121212;font-size:22px;margin:8px 0 0;font-weight:800">Park<span style="color:#5B2EFF">Peer</span></h1>
                    </div>
                    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:24px;text-align:center">
                      <p style="color:#166534;font-size:18px;font-weight:700;margin:0">✅ Resend Email — OPERATIONAL</p>
                      <p style="color:#4b5563;font-size:13px;margin:8px 0 0">This is a live test confirming Resend is correctly configured for ParkPeer.</p>
                    </div>
                    <table style="width:100%;font-size:13px;color:#374151">
                      <tr><td style="padding:4px 0;color:#6b7280">From</td><td style="font-weight:600">${fromEmail}</td></tr>
                      <tr><td style="padding:4px 0;color:#6b7280">To</td><td style="font-weight:600">${targetEmail}</td></tr>
                      <tr><td style="padding:4px 0;color:#6b7280">Mode</td><td style="font-weight:600;color:${isSandbox ? '#d97706' : '#16a34a'}">${isSandbox ? '⚠️ Sandbox (resend.dev domain)' : '✅ Production (verified domain)'}</td></tr>
                      <tr><td style="padding:4px 0;color:#6b7280">Sent at</td><td style="font-weight:600">${new Date().toISOString()}</td></tr>
                    </table>
                    <p style="color:#9ca3af;font-size:12px;text-align:center;margin:24px 0 0">ParkPeer Admin Messaging Audit — ${new Date().getFullYear()}</p>
                  </div>
                </body></html>`,
                text: `ParkPeer Resend Test — OPERATIONAL. From: ${fromEmail}, To: ${targetEmail}, Mode: ${isSandbox ? 'Sandbox' : 'Production'}, Sent: ${new Date().toISOString()}`,
              })
            })
            const sendData = await sendRes.json() as any
            sendResult = {
              ok:          sendRes.ok,
              http_status: sendRes.status,
              email_id:    sendData.id || null,
              error:       sendRes.ok ? null : (sendData?.message || sendData?.name || 'Send failed'),
              latency_ms:  Date.now() - t1,
            }
          }

          results.resend = {
            ok:               true,
            key_valid:        true,
            from_email:       fromEmail,
            from_email_set:   !!fromRaw,
            sandbox_mode:     isSandbox,
            sandbox_warning:  isSandbox ? 'FROM_EMAIL env var is not set — using onboarding@resend.dev sandbox domain. Set FROM_EMAIL to your verified domain address (e.g. noreply@yourdomain.com).' : null,
            verified_domains: verifiedDomains,
            all_domains:      allDomains,
            latency_ms:       latencyMs,
            test_send:        sendResult,
          }
        }
      } catch (e: any) {
        results.resend = { ok: false, error: 'Network error calling Resend API: ' + e.message, latency_ms: Date.now() - t0 }
      }
    }
  }

  // ── 2. Twilio SMS Test ────────────────────────────────────────────────────
  if (services.includes('twilio')) {
    const sid      = env.TWILIO_ACCOUNT_SID
    const token    = env.TWILIO_AUTH_TOKEN
    const fromNum  = env.TWILIO_PHONE_NUMBER

    if (!sid || !token) {
      results.twilio = { ok: false, error: 'TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set', fix: 'Add Twilio credentials as Cloudflare Pages secrets' }
    } else if (!fromNum) {
      results.twilio = { ok: false, error: 'TWILIO_PHONE_NUMBER not set', fix: 'Add your Twilio phone number (E.164 format, e.g. +12125551234) as TWILIO_PHONE_NUMBER secret' }
    } else {
      // Step A: validate credentials by fetching the account
      const t0 = Date.now()
      try {
        const credentials = btoa(`${sid}:${token}`)
        const acctRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
          headers: { Authorization: `Basic ${credentials}` }
        })
        const acctData = await acctRes.json() as any
        const latencyMs = Date.now() - t0

        if (!acctRes.ok) {
          results.twilio = {
            ok: false,
            http_status: acctRes.status,
            error: acctData?.message || acctData?.code ? `Twilio error ${acctData.code}: ${acctData.message}` : 'Credentials rejected',
            latency_ms: latencyMs,
            fix: acctRes.status === 401 ? 'TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is invalid — check at console.twilio.com' : 'Check Twilio account status',
          }
        } else {
          const accountStatus = acctData.status   // 'active', 'suspended', 'closed'
          const accountName   = acctData.friendly_name || acctData.sid

          // Step B: validate the from number exists on this account
          const numRes = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(fromNum)}`,
            { headers: { Authorization: `Basic ${credentials}` } }
          )
          const numData = await numRes.json() as any
          const numberValid   = numRes.ok && (numData.incoming_phone_numbers?.length ?? 0) > 0
          const numberDetails = numData.incoming_phone_numbers?.[0] || null

          // Step C: send test SMS if phone provided
          let sendResult: any = null
          if (targetPhone) {
            const toNormalized = targetPhone.startsWith('+') ? targetPhone : `+1${targetPhone.replace(/\D/g, '')}`
            const t1 = Date.now()
            const smsRes = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
              {
                method: 'POST',
                headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                  From: fromNum,
                  To:   toNormalized,
                  Body: `✅ ParkPeer SMS Test — OPERATIONAL\nTwilio is correctly configured for ParkPeer.\nFrom: ${fromNum}\nTo: ${toNormalized}\nSent: ${new Date().toISOString()}\n\nThis is an automated system diagnostic.`,
                }).toString()
              }
            )
            const smsData = await smsRes.json() as any
            sendResult = {
              ok:          smsRes.ok,
              http_status: smsRes.status,
              sms_sid:     smsData.sid || null,
              sms_status:  smsData.status || null,
              to:          toNormalized,
              error:       smsRes.ok ? null : (smsData?.message || `Twilio error ${smsData?.code}`),
              error_code:  smsData?.code || null,
              latency_ms:  Date.now() - t1,
            }
          }

          results.twilio = {
            ok:              accountStatus === 'active',
            account_sid:     sid,
            account_name:    accountName,
            account_status:  accountStatus,
            active:          accountStatus === 'active',
            from_number:     fromNum,
            number_valid:    numberValid,
            number_details:  numberDetails ? {
              friendly_name: numberDetails.friendly_name,
              capabilities:  numberDetails.capabilities,
              sms_enabled:   numberDetails.capabilities?.sms ?? false,
            } : null,
            latency_ms:      latencyMs,
            test_send:       sendResult,
            warning:         accountStatus !== 'active' ? `Twilio account status is "${accountStatus}" — SMS sending may fail` : null,
          }
        }
      } catch (e: any) {
        results.twilio = { ok: false, error: 'Network error calling Twilio API: ' + e.message, latency_ms: Date.now() - (Date.now()) }
      }
    }
  }

  // ── 3. Summary ────────────────────────────────────────────────────────────
  const allOk = Object.values(results).every((r: any) => r.ok === true)
  const issues: string[] = []
  if (results.resend && !results.resend.ok) issues.push(`Resend: ${results.resend.error}`)
  if (results.resend?.sandbox_mode) issues.push('Resend: FROM_EMAIL not set — using sandbox domain (onboarding@resend.dev)')
  if (results.twilio && !results.twilio.ok) issues.push(`Twilio: ${results.twilio.error}`)
  if (results.twilio?.test_send && !results.twilio.test_send.ok) issues.push(`Twilio test send: ${results.twilio.test_send.error}`)
  if (results.resend?.test_send && !results.resend.test_send.ok) issues.push(`Resend test send: ${results.resend.test_send.error}`)

  // Log audit result to DB
  if (db) {
    db.prepare(`
      INSERT INTO notifications
        (user_id, user_role, type, title, message, read_status, delivery_inapp, delivery_email, delivery_sms, email_sent, sms_sent, created_at)
      VALUES (0, 'admin', 'system', 'Messaging System Audit', ?, 0, 1, 0, 0, 0, 0, datetime('now'))
    `).bind(
      allOk ? `✅ All messaging services operational (${Object.keys(results).join(', ')})` : `⚠️ Issues: ${issues.join(' | ')}`
    ).run().catch(() => {})
  }

  return c.json({
    timestamp: new Date().toISOString(),
    overall:   allOk ? 'operational' : (issues.length ? 'degraded' : 'unknown'),
    issues,
    services:  results,
  }, allOk ? 200 : 207)
})


// ════════════════════════════════════════════════════════════════════════════
// GET /api/admin/fraud/flags — list unresolved fraud flags
// ════════════════════════════════════════════════════════════════════════════
adminApiRoutes.get('/fraud/flags', async (c: any) => {
  const admin = await getAdminFromRequest(c)
  if (!admin) return c.json({ error: 'Not authenticated' }, 401)
  const db = c.env?.DB
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  const limit  = Math.min(Number(c.req.query('limit') || 50), 100)
  const offset = Number(c.req.query('offset') || 0)
  const resolved = c.req.query('resolved') === '1' ? 1 : 0

  try {
    const rows = await db.prepare(`
      SELECT ff.*,
        CASE ff.entity_type
          WHEN 'user'    THEN (SELECT email FROM users    WHERE id = ff.entity_id)
          WHEN 'listing' THEN (SELECT title FROM listings WHERE id = ff.entity_id)
          WHEN 'booking' THEN 'Booking #' || ff.entity_id
          ELSE NULL
        END AS entity_label
      FROM fraud_flags ff
      WHERE ff.resolved = ?
      ORDER BY ff.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(resolved, limit, offset).all()

    const totals = await db.prepare(`
      SELECT
        SUM(CASE WHEN resolved=0 THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN severity='critical' AND resolved=0 THEN 1 ELSE 0 END) AS critical_count,
        SUM(CASE WHEN severity='high' AND resolved=0 THEN 1 ELSE 0 END) AS high_count
      FROM fraud_flags
    `).first<any>()

    return c.json({ flags: rows.results || [], totals, limit, offset })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// POST /api/admin/fraud/resolve/:id — resolve a fraud flag
adminApiRoutes.post('/fraud/resolve/:id', async (c: any) => {
  const admin = await getAdminFromRequest(c)
  if (!admin) return c.json({ error: 'Not authenticated' }, 401)
  const db = c.env?.DB
  if (!db) return c.json({ error: 'DB unavailable' }, 503)
  const flagId = c.req.param('id')

  try {
    await db.prepare(`
      UPDATE fraud_flags SET resolved=1, resolved_by=0, resolved_at=datetime('now')
      WHERE id=?
    `).bind(flagId).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// POST /api/admin/quality/recalculate — recalculate quality scores for all listings
adminApiRoutes.post('/quality/recalculate', async (c: any) => {
  const admin = await getAdminFromRequest(c)
  if (!admin) return c.json({ error: 'Not authenticated' }, 401)
  const db = c.env?.DB
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  try {
    // Simplified batch: update quality score based on available fields
    await db.prepare(`
      UPDATE listings SET
        quality_score = (
          CASE WHEN photos IS NOT NULL AND photos != '[]' AND photos != '' THEN 20 ELSE 0 END +
          CASE WHEN description IS NOT NULL AND LENGTH(description) > 20 THEN 15 ELSE 0 END +
          CASE WHEN rate_hourly IS NOT NULL OR rate_daily IS NOT NULL THEN 10 ELSE 0 END +
          CASE WHEN available_from IS NOT NULL OR available_days IS NOT NULL THEN 20 ELSE 0 END +
          CASE WHEN address_verified = 1 THEN 5 ELSE 0 END +
          CASE WHEN instructions IS NOT NULL AND LENGTH(instructions) > 5 THEN 5 ELSE 0 END +
          CASE WHEN (SELECT h.id_verified FROM users h WHERE h.id=listings.host_id) = 1
               AND (SELECT h.stripe_account_id FROM users h WHERE h.id=listings.host_id) IS NOT NULL THEN 20 ELSE 0 END
        ),
        availability_confidence = (
          CASE
            WHEN booking_frequency >= 4 AND cancellation_rate <= 0.1 THEN 'high'
            WHEN booking_frequency >= 1 OR last_booking_at >= datetime('now', '-30 days') THEN 'medium'
            ELSE 'low'
          END
        )
      WHERE status = 'active'
    `).run()

    const count = await db.prepare(`SELECT COUNT(*) as cnt FROM listings WHERE status='active'`).first<any>()
    return c.json({ success: true, updated: count?.cnt || 0 })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// GET /api/admin/referrals — list all referrals
adminApiRoutes.get('/referrals', async (c: any) => {
  const admin = await getAdminFromRequest(c)
  if (!admin) return c.json({ error: 'Not authenticated' }, 401)
  const db = c.env?.DB
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  try {
    const rows = await db.prepare(`
      SELECT r.*,
        u1.email AS referrer_email, u1.full_name AS referrer_name,
        u2.email AS referred_email, u2.full_name AS referred_name
      FROM referrals r
      LEFT JOIN users u1 ON r.referrer_user_id = u1.id
      LEFT JOIN users u2 ON r.referred_user_id  = u2.id
      ORDER BY r.created_at DESC LIMIT 100
    `).all()

    const stats = await db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status='rewarded' THEN 1 ELSE 0 END) AS rewarded,
        SUM(CASE WHEN status='rewarded' THEN reward_amount_cents ELSE 0 END) AS total_rewarded_cents
      FROM referrals
    `).first<any>()

    return c.json({ referrals: rows.results || [], stats })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})
