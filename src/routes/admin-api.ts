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
import { verifyPassword } from '../middleware/security'

type Bindings = {
  DB: D1Database
  STRIPE_SECRET_KEY: string
  RESEND_API_KEY: string
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
  const token = getCookie(c, '__pp_admin')
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
    return c.json({ error: 'Failed to fetch users', detail: e.message }, 500)
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
    return c.json({ error: 'Failed to fetch user detail', detail: e.message }, 500)
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
  const reason = (body.reason ?? '').toString().trim()
  const force  = body.force === true

  if (!reason) return c.json({ error: 'A deletion reason is required' }, 400)

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
    return c.json({ error: 'Deletion failed', detail: e.message }, 500)
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
    return c.json({ error: 'Failed to update user status', detail: e.message }, 500)
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
    return c.json({ error: 'Refund failed', detail: e.message }, 500)
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
    return c.json({ error: 'Failed to fetch audit log', detail: e.message }, 500)
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
    return c.json({ error: 'Failed to fetch refund log', detail: e.message }, 500)
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
    return c.json({ error: 'Failed to fetch stats', detail: e.message }, 500)
  }
})
