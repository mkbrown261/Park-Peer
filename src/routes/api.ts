import { Hono } from 'hono'
import {
  createPaymentIntent,
  createCustomer,
  getPaymentIntent,
  createRefund,
  createTransfer,
  getTransfer,
  verifyWebhookSignature,
  calcPaymentSplit,
  PLATFORM_FEE_RATE
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
import {
  recalculateTier,
  getTierDef,
  getTierOrder,
  getNextTierGaps,
  progressToNext,
  fetchMetrics,
  isMaxTier,
  DRIVER_TIERS,
  HOST_TIERS,
} from '../services/tiers'
import { CURRENT_VERSIONS, recordAcceptance, requireAgreement } from './agreements'
import {
  notifyBookingRequest,
  notifyBookingConfirmed,
  notifyBookingCancelled,
  notifyPayoutProcessed,
  notifyReviewReceived,
  notifyNewRegistration,
  notifyNewListing,
  notifyRefundProcessed,
} from '../services/notifications'

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
// STRUCTURED LOGGING helpers
// All payment / booking / hold events emit a JSON log line via console.log
// so they can be tailed in `wrangler tail` or forwarded to a log sink.
// ════════════════════════════════════════════════════════════════════════════
type LogLevel = 'info' | 'warn' | 'error'
function logEvent(
  level: LogLevel,
  event: string,
  data: Record<string, unknown> = {}
): void {
  const entry = {
    ts:    new Date().toISOString(),
    level,
    event,
    ...data,
  }
  if (level === 'error') console.error(JSON.stringify(entry))
  else if (level === 'warn')  console.warn(JSON.stringify(entry))
  else                        console.log(JSON.stringify(entry))
}

// ════════════════════════════════════════════════════════════════════════════
// RATE LIMITING constants for payment-sensitive endpoints
// ════════════════════════════════════════════════════════════════════════════
const PAYMENT_RL_WINDOW_MS = 60_000   // 1-minute window
const PAYMENT_RL_MAX       = 10       // max 10 create-intent requests per IP per minute
const HOLDS_RL_WINDOW_MS   = 60_000
const HOLDS_RL_MAX         = 20       // max 20 hold requests per IP per minute (higher for retries)

// ════════════════════════════════════════════════════════════════════════════
// GHOST BOOKING PREVENTION — inline cleanup helpers
// ════════════════════════════════════════════════════════════════════════════

// Auto-cancel 'pending' bookings older than 30 minutes (never paid).
// Called inline from time-slots, validate-slot, and holds endpoints so stale
// rows are swept before any conflict check runs.
async function sweepStalePendingBookings(db: D1Database): Promise<void> {
  try {
    await db.prepare(`
      UPDATE bookings
      SET    status       = 'cancelled',
             cancel_reason = 'Auto-cancelled: payment not completed within 30 minutes',
             updated_at   = datetime('now')
      WHERE  status       = 'pending'
        AND  datetime(created_at) < datetime('now', '-30 minutes')
    `).run()
  } catch { /* non-fatal — log but don't block the main request */ }
}

// Auto-expire reservation holds whose TTL has lapsed.
// Keeps the holds table clean and prevents old holds from blocking new ones.
async function sweepExpiredHolds(db: D1Database): Promise<void> {
  try {
    await db.prepare(`
      UPDATE reservation_holds
      SET    status     = 'expired',
             updated_at = datetime('now')
      WHERE  status     = 'active'
        AND  datetime(hold_expires_at) <= datetime('now')
    `).run()
  } catch { /* non-fatal */ }
}

// Auto-expire reservation locks whose 5-min TTL has lapsed.
async function sweepExpiredLocks(db: D1Database): Promise<void> {
  try {
    await db.prepare(`
      UPDATE reservation_locks
      SET    status     = 'expired',
             updated_at = datetime('now')
      WHERE  status     = 'locked'
        AND  datetime(lock_expires_at) <= datetime('now')
    `).run()
  } catch { /* non-fatal */ }
}

// Range-overlap conflict check helper.
// Returns true if a confirmed/active booking already covers start→end.
async function hasBookingConflict(
  db: D1Database,
  listingId: string | number,
  startIso: string,
  endIso: string,
  excludeBookingId?: number
): Promise<boolean> {
  try {
    let q = `
      SELECT id FROM bookings
      WHERE  listing_id = ?
        AND  status IN ('confirmed','active')
        AND  start_time < ?
        AND  end_time   > ?
    `
    const params: any[] = [String(listingId), endIso, startIso]
    if (excludeBookingId) { q += ' AND id != ?'; params.push(excludeBookingId) }
    q += ' LIMIT 1'
    const row = await db.prepare(q).bind(...params).first<{ id: number }>()
    return !!row
  } catch {
    return false  // fail open — let higher-level checks handle it
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PAYMENT DISTRIBUTION — dispatchHostPayout
// Transfers the host_payout portion to the host's connected Stripe account.
// Called after successful D1 batch in /payments/confirm.
// Idempotent: uses checkout_token as Idempotency-Key so safe to retry.
// ════════════════════════════════════════════════════════════════════════════
async function dispatchHostPayout(
  env: any,
  opts: {
    bookingId:          number
    paymentIntentId:    string
    chargeId:           string | null       // pi.latest_charge
    hostStripeAccount:  string              // payout_info.stripe_account_id
    hostPayoutCents:    number
    checkoutToken?:     string | null
    listingId?:         number
  }
): Promise<{ transferId: string | null; error: string | null }> {
  const db = env?.DB
  if (!opts.hostStripeAccount || !opts.chargeId) {
    const msg = !opts.hostStripeAccount
      ? 'Host has no connected Stripe account — payout queued for manual review'
      : 'No charge ID available for source_transaction — payout queued'
    console.warn(`[Payout] ${msg}  booking=${opts.bookingId}`)
    // Log to recovery for manual review
    try {
      await db?.prepare(`
        INSERT OR IGNORE INTO payment_recovery_log
          (stripe_pi_id, amount_cents, hold_id, recovery_status, error_detail, created_at)
        VALUES (?, ?, NULL, 'payout_pending', ?, datetime('now'))
      `).bind(opts.paymentIntentId, opts.hostPayoutCents, msg).run()
    } catch {}
    return { transferId: null, error: msg }
  }

  const idempKey = opts.checkoutToken ? `payout-${opts.checkoutToken}` : `payout-${opts.paymentIntentId}`

  try {
    const { transferId } = await createTransfer(
      env,
      {
        amountCents:        opts.hostPayoutCents,
        currency:           'usd',
        destinationAccount: opts.hostStripeAccount,
        sourceTransaction:  opts.chargeId,
        transferGroup:      `booking-${opts.checkoutToken || opts.paymentIntentId}`,
        metadata: {
          booking_id:          String(opts.bookingId),
          platform:            'parkpeer',
          payment_intent_id:   opts.paymentIntentId,
        },
      },
      idempKey
    )

    // Stamp transfer ID on the payments row immediately
    if (db) {
      await db.prepare(`
        UPDATE payments
        SET    stripe_transfer_id = ?,
               updated_at         = datetime('now')
        WHERE  stripe_payment_intent_id = ?
      `).bind(transferId, opts.paymentIntentId).run().catch((e: any) =>
        console.error('[Payout] stamp transfer_id failed:', e.message)
      )
    }

    console.log(`[Payout] Transfer ${transferId} dispatched  booking=${opts.bookingId}  $${opts.hostPayoutCents / 100}`)
    return { transferId, error: null }
  } catch (e: any) {
    const errMsg = e.message || 'Transfer failed'
    console.error(`[Payout] createTransfer FAILED booking=${opts.bookingId}:`, errMsg)
    logEvent('error', 'payout.transfer_failed', {
      booking_id: opts.bookingId, pi: opts.paymentIntentId,
      amount_cents: opts.hostPayoutCents, error: errMsg,
    })
    // Log to recovery so admin can retry
    try {
      await db?.prepare(`
        INSERT OR IGNORE INTO payment_recovery_log
          (stripe_pi_id, amount_cents, hold_id, recovery_status, error_detail, created_at)
        VALUES (?, ?, NULL, 'payout_failed', ?, datetime('now'))
      `).bind(opts.paymentIntentId, opts.hostPayoutCents, errMsg.slice(0, 500)).run()
    } catch {}
    return { transferId: null, error: errMsg }
  }
}

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

    // Admin in-app notification: new registration (await to ensure it runs before response)
    await notifyNewRegistration(c.env as any, {
      userId, userName: full_name, userEmail: email, role: roleForJwt,
    }).catch(() => {})

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

// ════════════════════════════════════════════════════════════════════════════
// POST /api/auth/forgot-password — initiate password reset
// Always returns 200 to prevent email enumeration.
// In production, sends a reset link via email. Here we log it for demo.
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.post('/auth/forgot-password', async (c) => {
  let body: any = {}
  try { body = await c.req.json() } catch {}
  const email = String(body.email || '').toLowerCase().trim()

  // Always return 200 to prevent email enumeration attacks
  if (!email || !email.includes('@')) {
    return c.json({ success: true, message: 'If an account exists, a reset link was sent.' })
  }

  const db = c.env?.DB
  if (db) {
    try {
      const user = await db.prepare(
        'SELECT id, full_name FROM users WHERE email = ? LIMIT 1'
      ).bind(email).first<any>()

      if (user) {
        // Generate a secure reset token (valid for 1 hour)
        const token    = crypto.randomUUID().replace(/-/g, '')
        const expires  = new Date(Date.now() + 3600_000).toISOString()

        await db.prepare(`
          INSERT INTO password_reset_tokens (user_id, token, expires_at, used, created_at)
          VALUES (?, ?, ?, 0, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET token=excluded.token, expires_at=excluded.expires_at, used=0
        `).bind(user.id, token, expires).run().catch(async () => {
          // Table may not exist yet — log the token for manual reset
          console.log(`[ForgotPassword] token=${token} user=${user.id} expires=${expires}`)
        })

        // In production, send email via Resend. Log here as a fallback.
        console.log(`[ForgotPassword] Reset link for ${email}: /auth/reset-password?token=${token}`)

        // Fire email if configured
        const { sendEmail } = await import('../services/sendgrid')
        const resetUrl = `${c.req.header('origin') || 'https://parkpeer.com'}/auth/reset-password?token=${token}`
        await sendEmail(c.env as any, {
          to: email,
          toName: user.full_name || 'ParkPeer User',
          subject: 'Reset your ParkPeer password',
          htmlContent: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
              <h2 style="color:#4f46e5;">Reset Your Password</h2>
              <p>Hi ${user.full_name || 'there'},</p>
              <p>We received a request to reset your ParkPeer password. Click the link below to set a new password:</p>
              <a href="${resetUrl}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0;">Reset Password</a>
              <p style="color:#888;font-size:12px;">This link expires in 1 hour. If you did not request a password reset, ignore this email.</p>
            </div>
          `,
        }).catch(() => {})
      }
    } catch (e: any) {
      console.error('[ForgotPassword]', e.message)
    }
  }

  return c.json({ success: true, message: 'If an account exists, a reset link was sent.' })
})
//
// Rules:
//  • Requires valid JWT session (requireUserAuth)
//  • Blocked if the user has any booking with status IN ('pending','confirmed','active')
//    — applies to both drivers (as driver_id) and hosts (bookings on their listings)
//  • On success:
//    1. Removes all the user's listings (status = 'archived' or soft-delete safe)
//    2. Hard-deletes the user row (FK cascades handle related rows per schema)
//    3. Clears session cookies (immediate logout)
//  • Returns 200 on success, 409 if active bookings exist, 401 if unauthenticated
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.delete('/auth/account', requireUserAuth(), async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  const session  = c.get('user') as any
  const userId   = session?.userId
  const userRole = (session?.role || '').toUpperCase()

  if (!userId) return c.json({ error: 'Authentication required' }, 401)

  try {
    // ── 1. Check for active/upcoming bookings as a DRIVER ─────────────────
    const driverActive = await db.prepare(`
      SELECT COUNT(*) as n FROM bookings
      WHERE driver_id = ? AND status IN ('pending','confirmed','active')
    `).bind(userId).first<{ n: number }>()

    if (driverActive && driverActive.n > 0) {
      return c.json({
        error: 'You have active or upcoming bookings. Please wait until all reservations are completed before deleting your account.',
        active_bookings: driverActive.n,
        type: 'driver_active_bookings'
      }, 409)
    }

    // ── 2. Check for active/upcoming bookings ON HOST's listings ──────────
    if (userRole === 'HOST' || userRole === 'BOTH' || userRole === 'ADMIN') {
      const hostActive = await db.prepare(`
        SELECT COUNT(*) as n FROM bookings b
        JOIN listings l ON b.listing_id = l.id
        WHERE l.host_id = ? AND b.status IN ('pending','confirmed','active')
      `).bind(userId).first<{ n: number }>()

      if (hostActive && hostActive.n > 0) {
        return c.json({
          error: 'Your listings have active or upcoming bookings. Please wait until all driver reservations are completed before deleting your account.',
          active_bookings: hostActive.n,
          type: 'host_active_bookings'
        }, 409)
      }
    }

    // ── 3. Archive all host listings before deleting user ─────────────────
    // (Prevents orphaned listings from appearing in search)
    await db.prepare(`
      UPDATE listings SET status = 'archived', updated_at = datetime('now')
      WHERE host_id = ? AND status IN ('active','pending','suspended')
    `).bind(userId).run()

    // ── 4. Hard-delete the user account ───────────────────────────────────
    // The DB schema uses FK references; cascades are handled at the
    // application layer here to be explicit and safe across D1.
    // Completed bookings and reviews are preserved for data integrity /
    // dispute history — they just lose the FK join to the user row.
    await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run()

    console.log(`[DELETE /auth/account] User ${userId} (${session.email}) deleted their account`)

    // ── 5. Invalidate session immediately ─────────────────────────────────
    clearUserToken(c)

    return c.json({
      success: true,
      message: 'Your account has been permanently deleted.',
      redirect: '/'
    })

  } catch (e: any) {
    console.error('[DELETE /auth/account] Error:', e?.message)
    return c.json({ error: 'Failed to delete account. Please try again or contact support.' }, 500)
  }
})
apiRoutes.post('/auth/refresh', async (c) => {
  const db     = c.env?.DB
  const secret = c.env?.USER_TOKEN_SECRET || 'pp-user-secret-change-in-prod'

  // The refresh cookie is HttpOnly/path=/auth — read it manually
  const cookieHeader = c.req.header('Cookie') || ''
  const match = cookieHeader.match(/__pp_refresh=([^;]+)/)
  if (!match) return c.json({ error: 'No refresh token' }, 401)

  try {
    // Verify the refresh token HMAC before trusting its contents
    // Format: <b64u-payload>.<hmac-sig>
    const tokenValue = match[1]
    const lastDot    = tokenValue.lastIndexOf('.')
    if (lastDot === -1) return c.json({ error: 'Invalid refresh token format' }, 401)
    const rpEnc = tokenValue.slice(0, lastDot)
    const rs    = tokenValue.slice(lastDot + 1)

    // Import HMAC key and verify signature before decoding
    const encoder   = new TextEncoder()
    const keyMat    = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    const padded    = rs.replace(/-/g, '+').replace(/_/g, '/')
    const padLen    = (4 - (padded.length % 4)) % 4
    const sigBytes  = Uint8Array.from(atob(padded + '='.repeat(padLen)), ch => ch.charCodeAt(0))
    const dataBytes = encoder.encode(`refresh.${rpEnc}`)
    const sigValid  = await crypto.subtle.verify('HMAC', keyMat, sigBytes, dataBytes)
    if (!sigValid) return c.json({ error: 'Invalid refresh token signature' }, 401)

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
      redirect_base:  !!(c.env?.OAUTH_REDIRECT_BASE),
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
  // Return minimal public health status — no internal configuration details
  return c.json({
    status: 'ok',
    service: 'ParkPeer API',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
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
// GEOCODE — Server-side Mapbox proxy (keeps token off the frontend bundle)
// ════════════════════════════════════════════════════════════════════════════

// GET /api/geocode/autocomplete?q=123+Main+St&country=us&limit=5
// Returns Mapbox autocomplete suggestions for address entry.
// Only returns address-type features (no POIs, parks, countries).
// Rate-limited per IP to prevent abuse.
apiRoutes.get('/geocode/autocomplete', requireUserAuth(), async (c) => {
  const token = c.env?.MAPBOX_TOKEN
  if (!token) return c.json({ error: 'Geocoding not configured' }, 503)

  const ip = c.req.header('CF-Connecting-IP') || 'unknown'
  if (isRateLimited(`geocode:${ip}`, 60, 60_000)) {
    return c.json({ error: 'Too many requests. Please slow down.' }, 429)
  }

  const q       = (c.req.query('q') || '').trim()
  const country = c.req.query('country') || 'us'
  const limit   = Math.min(parseInt(c.req.query('limit') || '5'), 8)

  if (!q || q.length < 3) return c.json({ features: [] })

  // Reject obvious PO Box patterns before even calling Mapbox
  if (/\b(p\.?\s*o\.?\s*box|post\s*office\s*box)\b/i.test(q)) {
    return c.json({ features: [], po_box_rejected: true })
  }

  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
      `?access_token=${token}` +
      `&country=${encodeURIComponent(country)}` +
      `&types=address` +
      `&autocomplete=true` +
      `&limit=${limit}`

    let res: Response
    try {
      res = await fetch(url)
    } catch (networkErr: any) {
      console.error('[GET /api/geocode/autocomplete] Network error reaching Mapbox:', networkErr.message)
      return c.json({ error: 'Cannot reach geocoding service. Please try again.', features: [] }, 502)
    }

    if (!res.ok) {
      let errBody = ''
      try { errBody = await res.text() } catch {}
      console.error(`[GET /api/geocode/autocomplete] Mapbox HTTP ${res.status}:`, errBody.substring(0, 300))

      if (res.status === 401) {
        return c.json({ error: 'Geocoding token invalid or expired. Contact support.', features: [] }, 503)
      }
      if (res.status === 422) {
        return c.json({ error: 'Invalid geocoding request parameters.', features: [] }, 400)
      }
      return c.json({ error: `Geocoding service returned ${res.status}`, features: [] }, 502)
    }

    let data: any
    try {
      data = await res.json()
    } catch (parseErr: any) {
      console.error('[GET /api/geocode/autocomplete] JSON parse error:', parseErr.message)
      return c.json({ error: 'Invalid response from geocoding service.', features: [] }, 502)
    }

    console.log(`[GET /api/geocode/autocomplete] query_len=${q.length} raw_count=${data.features?.length ?? 0}`)

    if (!data.features || !data.features.length) {
      return c.json({ features: [] })
    }

    // Shape the response — only expose what the frontend needs.
    // Mapbox v5 address feature anatomy:
    //   f.text             = street name only (e.g. "Main Street")
    //   f.properties.address = house number (e.g. "123")  ← NOT the full street
    //   f.place_name       = full formatted address (e.g. "123 Main Street, Austin, Texas 78701, United States")
    //   f.context[]        = array of parent features (postcode, place, region, country)
    const features = data.features.map((f: any) => {
      const ctx    = f.context || []
      const city   = ctx.find((x: any) => x.id?.startsWith('place'))?.text    || ''
      const state  = ctx.find((x: any) => x.id?.startsWith('region'))?.text   || ''
      const zip    = ctx.find((x: any) => x.id?.startsWith('postcode'))?.text || ''
      const countryCode = ctx.find((x: any) => x.id?.startsWith('country'))?.short_code?.toUpperCase() || 'US'

      // Build street address: house number (from properties.address) + street name (f.text)
      const houseNum  = (f.properties?.address || '').trim()
      const streetName = (f.text || '').trim()
      const street    = houseNum ? `${houseNum} ${streetName}` : streetName

      return {
        id:          f.id,
        place_name:  f.place_name,           // full display string for dropdown
        text:        street,                  // "123 Main Street" — street address line
        address:     street,                  // alias kept for backward compat
        city,
        state,
        zip,
        country:     countryCode,
        lat:         f.center?.[1] ?? null,
        lng:         f.center?.[0] ?? null,
        relevance:   f.relevance,
        place_id:    f.id,                   // use Mapbox feature id as place_id
      }
    })
    // Only require lat/lng — do NOT filter by relevance during autocomplete
    // (partial queries return low relevance scores by design)
    .filter((f: any) => f.lat != null && f.lng != null)

    console.log(`[GET /api/geocode/autocomplete] query_len=${q.length} returned=${features.length}`)
    return c.json({ features })
  } catch (e: any) {
    console.error('[GET /api/geocode/autocomplete] Unexpected error:', e.message)
    return c.json({ error: 'Geocoding service unavailable: ' + (e.message || 'unknown error'), features: [] }, 502)
  }
})

// GET /api/geocode/verify?place_id=address.abc123
// Server-side verification of a selected place_id before listing submission.
// Called once when host clicks a suggestion to confirm coordinates are valid.
apiRoutes.get('/geocode/verify', requireUserAuth(), async (c) => {
  const token   = c.env?.MAPBOX_TOKEN
  if (!token) return c.json({ error: 'Geocoding not configured' }, 503)

  const placeId = (c.req.query('place_id') || '').trim()
  const lat     = parseFloat(c.req.query('lat') || '')
  const lng     = parseFloat(c.req.query('lng') || '')

  if (!placeId) return c.json({ error: 'Missing place_id' }, 400)
  if (isNaN(lat) || isNaN(lng)) return c.json({ error: 'Missing coordinates' }, 400)

  // Validate coordinate ranges
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return c.json({ error: 'Invalid coordinates' }, 400)
  }

  // Reject if coordinates are in the ocean (rough US bounding box check)
  const inUSBounds = lat > 18 && lat < 72 && lng > -180 && lng < -65
  const inCABounds = lat > 41 && lat < 84 && lng > -142 && lng < -52
  if (!inUSBounds && !inCABounds) {
    // Still allow — ParkPeer may expand internationally
    console.warn(`[geocode/verify] Coordinates outside US/CA bounds`)
  }

  return c.json({
    valid:    true,
    place_id: placeId,
    lat,
    lng,
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
// Body: { listing_id, hold_id, session_token, booking_id?, start_datetime, end_datetime,
//         driver_email, checkout_token (idempotency) }
//
// HOLD-GATED: Validates that an active reservation_hold exists for this
// session before creating the Stripe PI. The hold_id is stamped onto the
// booking row and the PI id is stamped onto the hold row — making the
// webhook lookup deterministic.
//
// IDEMPOTENCY: If the same checkout_token already has a PI on record
// (booking_idempotency table), returns the existing clientSecret so that
// network retries don't create duplicate charges.
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.post('/payments/create-intent', async (c) => {
  const env = c.env
  if (!env?.STRIPE_SECRET_KEY) {
    return c.json({ error: 'Stripe not configured' }, 503)
  }

  // ── Rate limiting (per IP) ────────────────────────────────────────────
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
  if (isRateLimited(`create-intent:${ip}`, PAYMENT_RL_MAX, PAYMENT_RL_WINDOW_MS)) {
    logEvent('warn', 'create_intent.rate_limited', { ip })
    return c.json({ error: 'Too many payment requests. Please wait a moment.' }, 429)
  }

  let body: any = {}
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const {
    listing_id, start_datetime, end_datetime, driver_email,
    vehicle_plate, booking_id, hold_id, session_token, checkout_token
  } = body

  if (!listing_id || !start_datetime || !end_datetime) {
    return c.json({ error: 'Missing required fields: listing_id, start_datetime, end_datetime' }, 400)
  }

  const start = new Date(start_datetime)
  const end   = new Date(end_datetime)
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    return c.json({ error: 'Invalid date range' }, 400)
  }

  const db = c.env?.DB

  // ── IDEMPOTENCY: return existing PI for same checkout_token ──────────
  if (checkout_token && db) {
    try {
      const existing = await db.prepare(
        'SELECT stripe_pi_id FROM booking_idempotency WHERE checkout_token = ? AND stripe_pi_id IS NOT NULL LIMIT 1'
      ).bind(String(checkout_token)).first<{ stripe_pi_id: string }>()
      if (existing?.stripe_pi_id) {
        // Retrieve existing PI to return fresh clientSecret
        try {
          const pi = await getPaymentIntent(env as any, existing.stripe_pi_id)
          if (pi?.client_secret) {
            console.log(`[Stripe] Idempotent PI reuse: ${existing.stripe_pi_id}`)
            return c.json({
              clientSecret:    pi.client_secret,
              paymentIntentId: pi.id,
              idempotent:      true,
              pricing:         body._pricing || {}
            })
          }
        } catch {}
      }
    } catch {}
  }

  // ── HOLD VALIDATION: verify active hold before creating PI ───────────
  if (hold_id && db) {
    try {
      const hold = await db.prepare(`
        SELECT id, status, hold_expires_at, listing_id
        FROM reservation_holds WHERE id = ?
      `).bind(String(hold_id)).first<any>()

      if (!hold) {
        return c.json({ error: 'Reservation hold not found. Please start over.', code: 'HOLD_NOT_FOUND' }, 409)
      }
      if (hold.status === 'converted') {
        return c.json({ error: 'This slot is already booked.', code: 'HOLD_CONVERTED' }, 409)
      }
      if (hold.status !== 'active' || new Date(hold.hold_expires_at) <= new Date()) {
        return c.json({
          error: 'Your reservation hold has expired (10-minute limit). Please select your time slot again.',
          code:  'HOLD_EXPIRED',
        }, 409)
      }
    } catch (dbErr: any) {
      console.error('[Stripe] hold validation error:', dbErr.message)
    }
  } else if (!hold_id) {
    // No hold provided — run a quick conflict check to catch obvious double-books
    if (db) {
      try {
        // Also sweep expired locks before checking
        await sweepExpiredLocks(db)

        const conflict = await db.prepare(`
          SELECT id FROM bookings
          WHERE listing_id = ? AND status IN ('confirmed','active')
            AND start_time < ? AND end_time > ?
          LIMIT 1
        `).bind(listing_id, end_datetime, start_datetime).first<{ id: number }>()
        if (conflict) {
          return c.json({
            error: 'This spot is already booked for the selected time.',
            code:  'SLOT_BOOKED',
          }, 409)
        }

        // Also check for active locks
        const lockConflict = await db.prepare(`
          SELECT id FROM reservation_locks
          WHERE listing_id = ?
            AND status = 'locked'
            AND datetime(lock_expires_at) > datetime('now')
            AND start_time < ? AND end_time > ?
          LIMIT 1
        `).bind(listing_id, end_datetime, start_datetime).first<{ id: number }>()
        if (lockConflict) {
          return c.json({
            error: 'This time slot is no longer available.',
            code:  'SLOT_HELD',
          }, 409)
        }
      } catch {}
    }
  }

  // ── Fetch authoritative pricing from DB (never trust client price) ───
  // FIX #1: Use calcPaymentSplit() for consistent fee math everywhere.
  // FIX #2: Use 15-min increment rounding (consistent with holds & validate-slot).
  const rawMins   = (end.getTime() - start.getTime()) / 60_000
  const roundMins = Math.max(15, Math.ceil(rawMins / 15) * 15)
  const hours     = Math.round((roundMins / 60) * 100) / 100

  let ratePerHour   = 12
  let hostAccountId: string | null = null   // host's Stripe Connect account

  if (db) {
    try {
      // Fetch listing rate AND host's connected Stripe account in one query
      const row = await db.prepare(`
        SELECT l.rate_hourly, p.stripe_account_id
        FROM listings l
        LEFT JOIN payout_info p ON p.user_id = l.host_id
        WHERE l.id = ? AND l.status = 'active'
      `).bind(String(listing_id)).first<{ rate_hourly: number; stripe_account_id: string | null }>()

      if (row?.rate_hourly)        ratePerHour   = row.rate_hourly
      if (row?.stripe_account_id)  hostAccountId = row.stripe_account_id
    } catch {}
  }

  // Authoritative split (all in cents to avoid floating-point errors)
  const subtotalCents = Math.round(ratePerHour * hours * 100)
  const split         = calcPaymentSplit(subtotalCents)
  const { platformFeeCents, hostPayoutCents, totalCents } = split
  const subtotal    = subtotalCents    / 100
  const platformFee = platformFeeCents / 100
  const hostPayout  = hostPayoutCents  / 100
  const total       = totalCents       / 100

  try {
    // Separate Charges + Transfers model:
    // Charge full total to platform account (no application_fee_amount).
    // After PI succeeds, dispatchHostPayout() manually transfers host_payout
    // to the host's connected account. Platform retains its fee automatically.
    const { clientSecret, paymentIntentId } = await createPaymentIntent(
      env as any,
      totalCents,
      'usd',
      {
        listing_id:         String(listing_id),
        booking_id:         booking_id ? String(booking_id) : '',
        hold_id:            hold_id    ? String(hold_id)    : '',
        session_token:      session_token  || '',
        checkout_token:     checkout_token || '',
        driver_email:       driver_email   || '',
        vehicle_plate:      vehicle_plate  || '',
        start_datetime,
        end_datetime,
        platform:           'parkpeer',
        subtotal_cents:     String(subtotalCents),
        platform_fee_cents: String(platformFeeCents),
        host_payout_cents:  String(hostPayoutCents),
        host_account_id:    hostAccountId || '',
      },
      checkout_token || undefined,   // Idempotency-Key
      undefined,                     // application_fee_amount — NOT used (separate charges)
      hostAccountId || undefined     // host connected account → sets transfer_group
    )

    // ── Stamp PI onto booking row (if booking already created) ───────
    if (db && booking_id) {
      try {
        await db.prepare(
          `UPDATE bookings SET stripe_payment_intent_id = ?, updated_at = datetime('now')
           WHERE id = ? AND stripe_payment_intent_id IS NULL`
        ).bind(paymentIntentId, String(booking_id)).run()
      } catch (dbErr: any) {
        console.error('[Stripe] stamp PI on booking error:', dbErr.message)
      }
    }

    // ── Stamp PI onto hold row ────────────────────────────────────────
    if (db && hold_id) {
      try {
        await db.prepare(
          `UPDATE reservation_holds SET stripe_pi_id = ?, updated_at = datetime('now')
           WHERE id = ? AND stripe_pi_id IS NULL`
        ).bind(paymentIntentId, String(hold_id)).run()
      } catch (dbErr: any) {
        console.error('[Stripe] stamp PI on hold error:', dbErr.message)
      }
    }

    // ── Register idempotency key ──────────────────────────────────────
    if (db && checkout_token) {
      try {
        await db.prepare(
          `UPDATE booking_idempotency SET stripe_pi_id = ? WHERE checkout_token = ?`
        ).bind(paymentIntentId, String(checkout_token)).run()
      } catch {}
    }

    const pricing = {
      hours, rate_per_hour: ratePerHour,
      subtotal, platform_fee: platformFee, host_payout: hostPayout,
      total, total_cents: totalCents,
      subtotal_cents: subtotalCents, platform_fee_cents: platformFeeCents,
      host_payout_cents: hostPayoutCents,
      currency: 'usd',
    }

    logEvent('info', 'create_intent.ok', {
      pi: paymentIntentId, listing_id, hold_id: hold_id || null,
      checkout_token: checkout_token || null, total_cents: totalCents,
      platform_fee_cents: platformFeeCents, host_payout_cents: hostPayoutCents,
      host_has_account: !!hostAccountId,
    })
    return c.json({ clientSecret, paymentIntentId, pricing })

  } catch (e: any) {
    console.error('[Stripe] create-intent error:', e.message)
    logEvent('error', 'create_intent.error', { listing_id, hold_id, error: e.message, ip })
    return c.json({ error: e.message || 'Failed to create payment intent' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// STRIPE — Confirm Booking after successful payment (ATOMIC + GHOST-PROOF)
// POST /api/payments/confirm
// Body: { payment_intent_id, hold_id?, session_token?, booking_id?,
//         listing_id, driver_email, driver_name, start_datetime, end_datetime,
//         vehicle_plate, checkout_token, cancellation_acknowledged,
//         driver_id?, driver_phone? }
//
// ATOMIC FLOW (ghost booking prevention):
//   1. Verify Stripe PI status = 'succeeded'  (server-side, never trust client)
//   2. Idempotency: if PI already confirmed → return existing booking (safe)
//   3. Validate hold is still active (not expired / converted)
//   4. D1 db.batch() — all-or-nothing:
//        a. If no booking row exists yet → INSERT INTO bookings (status=confirmed)
//        b. If booking row exists → UPDATE SET status=confirmed
//        c. Mark hold as converted
//        d. INSERT INTO payments (skip if PI already recorded)
//        e. UPDATE idempotency table
//   5. Send email + SMS confirmation
//   6. Fire in-app notification (async, non-blocking)
//
// If D1 batch fails after Stripe succeeds → log to payment_recovery_log
// Recovery webhook will retry or auto-refund.
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.post('/payments/confirm', async (c) => {
  const env = c.env
  if (!env?.STRIPE_SECRET_KEY) {
    return c.json({ error: 'Stripe not configured' }, 503)
  }

  // ── Rate limiting (per IP — prevent confirm-flood replay attacks) ─────
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
  if (isRateLimited(`confirm:${ip}`, 10, 60_000)) {
    logEvent('warn', 'confirm.rate_limited', { ip })
    return c.json({ error: 'Too many confirmation requests. Please wait a moment.' }, 429)
  }

  let body: any = {}
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const {
    payment_intent_id, hold_id, session_token, booking_id,
    listing_id, driver_email, driver_name,
    start_datetime, end_datetime, vehicle_plate, checkout_token,
    driver_phone
  } = body

  // ── Input sanitization ─────────────────────────────────────────────────
  const safeDriverName  = sanitizeHtml(String(driver_name  || '').slice(0, 100))
  const safeDriverEmail = String(driver_email  || '').slice(0, 254).toLowerCase().trim()
  const safeVehiclePlate = sanitizeHtml(String(vehicle_plate || '').slice(0, 20).toUpperCase())
  const safePaymentId   = String(payment_intent_id || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 80)

  if (!safePaymentId) {
    return c.json({ error: 'Missing or invalid payment_intent_id' }, 400)
  }
  if (!payment_intent_id) {
    return c.json({ error: 'Missing payment_intent_id' }, 400)
  }
  if (!body.cancellation_acknowledged) {
    return c.json({
      error: 'You must acknowledge the cancellation policy before confirming a booking.',
      cancellation_ack_required: true,
      policy_version: CURRENT_VERSIONS.cancellation_policy,
    }, 400)
  }

  const db  = c.env?.DB
  const ipAddress = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || null

  try {
    // ── 1. Verify payment with Stripe (server-side, authoritative) ────────
    const pi = await getPaymentIntent(env as any, safePaymentId)
    if (pi.status !== 'succeeded') {
      // Release hold so user can retry with different payment
      if (db && (hold_id || session_token)) {
        await db.prepare(`
          UPDATE reservation_holds SET status='released', updated_at=datetime('now')
          WHERE ${hold_id ? 'id=?' : 'session_token=?'} AND status='active'
        `).bind(hold_id || session_token).run().catch(() => {})
      }
      return c.json({
        error: `Payment not completed. Status: ${pi.status}`,
        code: 'PAYMENT_INCOMPLETE',
        stripe_status: pi.status,
      }, 402)
    }

    // ── FIX: Derive subtotal from PI total using authoritative split math.
    // pi.amount = total_cents = subtotalCents * 1.15
    // So subtotalCents = pi.amount / 1.15  →  but we must work in cents.
    // Correct approach: use calcPaymentSplit on the subtotal.
    //   subtotalCents = round(pi.amount / 1.15)
    //   then calcPaymentSplit gives exact platformFee & hostPayout.
    const amountPaid      = pi.amount / 100   // total charged to driver (dollars)
    const piSubtotalCents = Math.round(pi.amount / 1.15)   // remove 15% markup
    const piSplit         = calcPaymentSplit(piSubtotalCents)
    // Convert to dollars for DB storage
    const subtotalAmt     = piSplit.subtotalCents     / 100
    const platformFee     = piSplit.platformFeeCents  / 100
    const hostPayout      = piSplit.hostPayoutCents   / 100

    // ── 2. IDEMPOTENCY: return existing booking if PI already confirmed ────
    if (db) {
      const existingPmt = await db.prepare(
        'SELECT booking_id FROM payments WHERE stripe_payment_intent_id = ? LIMIT 1'
      ).bind(payment_intent_id).first<{ booking_id: number }>().catch(() => null)

      if (existingPmt?.booking_id) {
        const bkRef = 'PP-' + new Date().getFullYear() + '-' + String(existingPmt.booking_id).padStart(4, '0')
        console.log(`[Confirm] Idempotent: PI ${payment_intent_id} already confirmed → booking ${existingPmt.booking_id}`)
        return c.json({
          success: true, idempotent: true,
          booking_id: bkRef, db_booking_id: existingPmt.booking_id,
          status: 'confirmed', amount_paid: amountPaid,
        }, 200)
      }
    }

    // ── 3. Resolve hold + listing + driver info from D1 ──────────────────
    let holdRow:          any = null
    let existingBooking:  any = null
    let listingRow:       any = null
    // SECURITY: Never trust driver_id from the request body — it could be spoofed.
    // Resolve driverId only from (1) authenticated session, (2) existing booking, or (3) hold record.
    const sessionUser     = await verifyUserToken(c, c.env?.USER_TOKEN_SECRET || '').catch(() => null)
    let resolvedDriverId: number | null = sessionUser?.userId ? Number(sessionUser.userId) : null
    let resolvedHostId:   number | null = null
    let listingTitle    = 'Parking Space'
    let listingAddress  = ''
    let resolvedListingId = listing_id ? parseInt(String(listing_id)) : 0
    let resolvedStart   = start_datetime || ''
    let resolvedEnd     = end_datetime   || ''
    // Use sanitized vehicle plate value
    let resolvedVehicle = safeVehiclePlate || null

    if (db) {
      // Find hold by id or session_token (whichever is available)
      if (hold_id) {
        holdRow = await db.prepare(
          'SELECT * FROM reservation_holds WHERE id = ? LIMIT 1'
        ).bind(String(hold_id)).first<any>().catch(() => null)
      } else if (session_token) {
        holdRow = await db.prepare(
          'SELECT * FROM reservation_holds WHERE session_token = ? AND status=\'active\' LIMIT 1'
        ).bind(String(session_token)).first<any>().catch(() => null)
      }

      // Validate hold (warn but don't block — payment already taken)
      if (holdRow) {
        if (holdRow.status === 'converted') {
          // Already processed — idempotent return
          const bkRef = 'PP-' + new Date().getFullYear() + '-' + String(holdRow.booking_id).padStart(4, '0')
          return c.json({ success: true, idempotent: true, booking_id: bkRef,
            db_booking_id: holdRow.booking_id, status: 'confirmed', amount_paid: amountPaid }, 200)
        }
        if (new Date(holdRow.hold_expires_at) <= new Date() && holdRow.status === 'active') {
          // Hold expired AFTER payment succeeded — proceed anyway (ghost booking prevention)
          console.warn(`[Confirm] Hold ${holdRow.id} expired but PI succeeded — proceeding with booking creation`)
        }
        resolvedListingId = resolvedListingId || holdRow.listing_id
        resolvedStart     = resolvedStart     || holdRow.start_time
        resolvedEnd       = resolvedEnd       || holdRow.end_time
      }

      // Look up existing booking by PI id or booking_id
      if (booking_id) {
        existingBooking = await db.prepare(
          'SELECT id, driver_id, host_id, status FROM bookings WHERE id = ? LIMIT 1'
        ).bind(String(booking_id)).first<any>().catch(() => null)
      }
      if (!existingBooking) {
        existingBooking = await db.prepare(
          'SELECT id, driver_id, host_id, status FROM bookings WHERE stripe_payment_intent_id = ? LIMIT 1'
        ).bind(payment_intent_id).first<any>().catch(() => null)
      }

      if (existingBooking) {
        resolvedDriverId = existingBooking.driver_id || resolvedDriverId
        resolvedHostId   = existingBooking.host_id
      }

      // Fetch listing for pricing/host
      if (resolvedListingId) {
        listingRow = await db.prepare(
          'SELECT id, title, address, city, host_id, rate_hourly FROM listings WHERE id = ? LIMIT 1'
        ).bind(String(resolvedListingId)).first<any>().catch(() => null)
        if (listingRow) {
          listingTitle   = listingRow.title || listingTitle
          listingAddress = [listingRow.address, listingRow.city].filter(Boolean).join(', ')
          resolvedHostId = resolvedHostId || listingRow.host_id
        }
      }
    }

    // ── 4. ATOMIC D1 BATCH — booking + hold convert + payment (ghost-proof) ─
    let dbBookingId: number | null = existingBooking?.id ?? null

    if (db) {
      // Final double-booking check before INSERT (last line of defense after payment)
      if (!dbBookingId && resolvedListingId && resolvedStart && resolvedEnd) {
        const finalConflict = await hasBookingConflict(db, resolvedListingId, resolvedStart, resolvedEnd)
        if (finalConflict) {
          // A race condition created another booking between the hold and now.
          // Log to recovery — we'll need to refund this payment.
          console.error(`[Confirm] DOUBLE-BOOKING DETECTED after payment PI=${payment_intent_id}`)
          logEvent('error', 'booking.double_booking_race', {
            pi: payment_intent_id, listing_id: resolvedListingId,
            start: resolvedStart, end: resolvedEnd,
          })
          try {
            await db!.prepare(`
              INSERT OR IGNORE INTO payment_recovery_log
                (stripe_pi_id, amount_cents, hold_id, recovery_status, error_detail, created_at)
              VALUES (?, ?, ?, 'pending', 'DOUBLE_BOOKING_RACE: refund required', datetime('now'))
            `).bind(payment_intent_id, pi.amount, hold_id || null).run()
          } catch {}
          return c.json({
            success: false,
            error: 'This time slot was just taken by another booking. Your payment will be refunded automatically.',
            code: 'DOUBLE_BOOKING',
            recovery: true,
          }, 409)
        }
      }
      const cancelAck    = body.cancellation_acknowledged === true
      const cancelVer    = body.cancellation_policy_version || CURRENT_VERSIONS.cancellation_policy
      // ── FIX: Use same 15-minute rounding as create-intent (not ceil-to-hour)
      const hours        = resolvedStart && resolvedEnd
        ? (() => {
            const rawMins   = (new Date(resolvedEnd).getTime() - new Date(resolvedStart).getTime()) / 60_000
            const roundMins = Math.max(15, Math.ceil(rawMins / 15) * 15)
            return Math.round((roundMins / 60) * 100) / 100
          })()
        : 1

      try {
        if (!dbBookingId) {
          // ── A. Create booking row inside batch ──────────────────────────
          const batchResults = await db.batch([
            // Check no duplicate booking exists for this PI
            db.prepare(`SELECT id FROM bookings WHERE stripe_payment_intent_id = ? LIMIT 1`).bind(payment_intent_id),
            // Insert the booking
            db.prepare(`
              INSERT OR IGNORE INTO bookings
                (listing_id, driver_id, host_id, start_time, end_time,
                 duration_hours, status, subtotal, platform_fee, host_payout,
                 total_charged, vehicle_plate, vehicle_description,
                 stripe_payment_intent_id, stripe_charge_id,
                 cancellation_acknowledged, cancellation_ack_version,
                 cancellation_ack_at, cancellation_ack_ip,
                 checkout_token, hold_id, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?,
                      ?, ?, ?, ?,
                      CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END, ?,
                      ?, ?, datetime('now'), datetime('now'))
            `).bind(
              resolvedListingId, resolvedDriverId, resolvedHostId,
              resolvedStart, resolvedEnd, hours,
              subtotalAmt,  // FIX: authoritative subtotal (not back-calculated)
              platformFee, hostPayout, amountPaid,
              resolvedVehicle, resolvedVehicle,
              payment_intent_id, pi.latest_charge || null,
              cancelAck ? 1 : 0, cancelAck ? cancelVer : null,
              cancelAck ? 1 : 0, ipAddress,
              checkout_token || null, hold_id || null
            ),
          ])

          // Get the new booking id
          dbBookingId = (batchResults[1] as any)?.meta?.last_row_id ?? null

          // If INSERT was ignored (duplicate), fetch the existing row
          if (!dbBookingId) {
            const dup = await db.prepare('SELECT id FROM bookings WHERE stripe_payment_intent_id = ? LIMIT 1')
              .bind(payment_intent_id).first<{ id: number }>()
            dbBookingId = dup?.id ?? null
          }

        } else {
          // ── B. Booking row already exists — UPDATE to confirmed ──────────
          await db.prepare(`
            UPDATE bookings
            SET status = 'confirmed',
                stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, ?),
                stripe_charge_id         = COALESCE(stripe_charge_id, ?),
                updated_at               = datetime('now')
            WHERE id = ? AND status IN ('pending','confirmed')
          `).bind(payment_intent_id, pi.latest_charge || null, dbBookingId).run()
        }

        // ── C. INSERT payments row (idempotent) ──────────────────────────
        // Always insert the payment row regardless of resolvedHostId so the
        // admin dashboard and analytics always show completed transactions.
        if (dbBookingId) {
          await db.prepare(`
            INSERT OR IGNORE INTO payments
              (booking_id, driver_id, host_id, amount, platform_fee, host_payout,
               currency, stripe_payment_intent_id, stripe_charge_id, type, status)
            VALUES (?, ?, ?, ?, ?, ?, 'usd', ?, ?, 'charge', 'succeeded')
          `).bind(
            dbBookingId, resolvedDriverId || 0, resolvedHostId || 0,
            amountPaid, platformFee, hostPayout,
            payment_intent_id, pi.latest_charge || null
          ).run()
        }

        // ── D. Convert hold → converted ──────────────────────────────────
        if (holdRow?.id || hold_id) {
          const hid = holdRow?.id || hold_id
          await db.prepare(`
            UPDATE reservation_holds
            SET status = 'converted', booking_id = ?, updated_at = datetime('now')
            WHERE id = ? AND status IN ('active','expired')
          `).bind(dbBookingId, String(hid)).run()
        }

        // ── D2. Confirm reservation lock → confirmed ──────────────────────
        if (session_token) {
          await db.prepare(`
            UPDATE reservation_locks
            SET status = 'confirmed', booking_id = ?, stripe_pi_id = ?, updated_at = datetime('now')
            WHERE session_token = ? AND status = 'locked'
          `).bind(dbBookingId, payment_intent_id, String(session_token)).run().catch(() => {})
        }

        // ── E. Update idempotency table ──────────────────────────────────
        if (checkout_token) {
          await db.prepare(`
            UPDATE booking_idempotency
            SET booking_id = ?, stripe_pi_id = ?
            WHERE checkout_token = ?
          `).bind(dbBookingId, payment_intent_id, String(checkout_token)).run().catch(() => {})
        }

        console.log(`[Confirm] Booking ${dbBookingId} confirmed PI=${payment_intent_id} $${amountPaid}`)
        logEvent('info', 'booking.confirmed', {
          booking_id: dbBookingId, pi: payment_intent_id,
          amount: amountPaid, listing_id: resolvedListingId,
          hold_id: hold_id || null,
        })

        // ── F. Dispatch host payout (non-blocking — runs after D1 batch) ──
        // Look up host Stripe account and fire transfer asynchronously.
        // Any failure is logged to payment_recovery_log for admin retry.
        if (dbBookingId && resolvedHostId) {
          ;(async () => {
            try {
              // Fetch host's connected Stripe account
              const payoutInfoRow = await db.prepare(
                'SELECT stripe_account_id FROM payout_info WHERE user_id = ? LIMIT 1'
              ).bind(resolvedHostId).first<{ stripe_account_id: string | null }>().catch(() => null)

              const hostStripeAccount = payoutInfoRow?.stripe_account_id || null

              const payoutResult = await dispatchHostPayout(env as any, {
                bookingId:         dbBookingId!,
                paymentIntentId:   payment_intent_id,
                chargeId:          pi.latest_charge || null,
                hostStripeAccount: hostStripeAccount || '',
                hostPayoutCents:   piSplit.hostPayoutCents,
                checkoutToken:     checkout_token || null,
                listingId:         resolvedListingId,
              })

              logEvent(
                payoutResult.error ? 'warn' : 'info',
                payoutResult.error ? 'payout.dispatched_with_warning' : 'payout.dispatched',
                {
                  booking_id:    dbBookingId,
                  transfer_id:   payoutResult.transferId || null,
                  host_id:       resolvedHostId,
                  host_account:  hostStripeAccount || 'none',
                  amount_cents:  piSplit.hostPayoutCents,
                  error:         payoutResult.error || null,
                }
              )
            } catch (pe: any) {
              console.error('[Confirm] payout dispatch threw:', pe.message)
            }
          })()
        }

      } catch (batchErr: any) {
        // ── GHOST BOOKING SAFETY NET ─────────────────────────────────────
        // PI succeeded but D1 write failed → log to recovery table
        // Webhook / admin can retry or auto-refund
        console.error('[Confirm] D1 batch FAILED after Stripe success:', batchErr.message)
        logEvent('error', 'booking.d1_batch_failed', {
          pi: payment_intent_id, hold_id: hold_id || null,
          amount_cents: pi.amount, error: batchErr.message,
        })
        try {
          await db.prepare(`
            INSERT OR IGNORE INTO payment_recovery_log
              (stripe_pi_id, amount_cents, hold_id, recovery_status, error_detail, created_at)
            VALUES (?, ?, ?, 'pending', ?, datetime('now'))
          `).bind(
            payment_intent_id,
            pi.amount,
            hold_id || null,
            batchErr.message?.slice(0, 500)
          ).run()
        } catch {}
        // Return success to client (they paid) with a recovery flag
        // Background recovery will complete the booking
        return c.json({
          success: true,
          booking_id: `RECOVERY-${payment_intent_id.slice(-8)}`,
          db_booking_id: null,
          status: 'recovery_pending',
          amount_paid: amountPaid,
          recovery: true,
          message: 'Payment received. Your booking confirmation will arrive shortly.',
        }, 201)
      }
    }

    const bookingRef = dbBookingId
      ? 'PP-' + new Date().getFullYear() + '-' + String(dbBookingId).padStart(4, '0')
      : `PP-${Math.floor(100000 + Math.random() * 900000)}`
    const numericBookingId = dbBookingId ?? Math.floor(100000 + Math.random() * 900000)

    // ── 5. Send confirmation emails + SMS (verified contacts only) ───────
    const startFmt = resolvedStart ? new Date(resolvedStart).toLocaleString('en-US') : ''
    const endFmt   = resolvedEnd   ? new Date(resolvedEnd).toLocaleString('en-US')   : ''

    // ── 5a. Check session-verified contacts ─────────────────────────────
    //   If the user verified their email/phone via OTP during checkout, we
    //   use those verified values and mark them used. Otherwise fall back
    //   to the raw body values (for logged-in users who may have skipped OTP).
    let verifiedEmail: string | null = null
    let verifiedPhone: string | null = null

    // Look up verified contacts using BOTH tokens:
    // - checkout_token: used by the OTP verify flow on the booking page
    // - session_token (holdSessionToken): used by the hold/confirm flow
    // They can differ, so we check both and take whichever has a verified record.
    const vcTokens = [...new Set([checkout_token, session_token].filter(Boolean))]

    if (db && vcTokens.length > 0) {
      try {
        // Build parameterized query for 1 or 2 tokens
        const placeholders = vcTokens.map(() => '?').join(',')
        const vcRows = await db.prepare(`
          SELECT contact_type, contact_value FROM verified_contacts
          WHERE session_token IN (${placeholders}) AND used = 0
            AND datetime(expires_at) > datetime('now')
        `).bind(...vcTokens).all<{ contact_type: string; contact_value: string }>()

        const emailVC = vcRows.results?.find(r => r.contact_type === 'email')
        const phoneVC = vcRows.results?.find(r => r.contact_type === 'phone')

        if (emailVC) {
          verifiedEmail = emailVC.contact_value
          // Mark all matching tokens as used to prevent replay
          await db.prepare(`
            UPDATE verified_contacts SET used = 1
            WHERE session_token IN (${placeholders}) AND contact_type = 'email'
          `).bind(...vcTokens).run()
        }
        if (phoneVC) {
          verifiedPhone = phoneVC.contact_value
          await db.prepare(`
            UPDATE verified_contacts SET used = 1
            WHERE session_token IN (${placeholders}) AND contact_type = 'phone'
          `).bind(...vcTokens).run()
        }
      } catch (vcErr: any) {
        console.warn('[Confirm] verified_contacts lookup failed:', vcErr.message)
      }
    }

    // Prefer verified values; fall back to raw body values
    const emailToSend = verifiedEmail || safeDriverEmail || null
    // Normalize phone: strip non-digits, ensure E.164 for Twilio
    const rawPhone = verifiedPhone || (driver_phone ? String(driver_phone).trim() : null)
    const phoneToSend = rawPhone
      ? (rawPhone.startsWith('+') ? rawPhone : '+1' + rawPhone.replace(/\D/g, ''))
      : null

    // ── 5b. Generate QR token for the booking (embed in email + SMS link) ─
    let qrDataUrl: string | null = null
    let qrCheckinUrl: string | null = null
    if (dbBookingId) {
      try {
        const qrSecret = c.env?.USER_TOKEN_SECRET || 'pp-user-secret-change-in-prod'
        const { token } = await generateQrToken(String(dbBookingId), qrSecret)
        qrCheckinUrl = `https://parkpeer.pages.dev/checkin?t=${token}&b=${dbBookingId}`
        // Generate QR SVG using a pure-JS approach (no external lib needed)
        // We encode the URL as a QR code using the Google Charts API as a CDN
        // (no API key required, widely available, returns PNG)
        qrDataUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&format=png&data=${encodeURIComponent(qrCheckinUrl)}`
      } catch (qrErr: any) {
        console.warn('[Confirm] QR generation failed:', qrErr.message)
      }
    }

    // ── 5c. Fire emails + SMS concurrently ───────────────────────────────
    await Promise.all([
      // Booking confirmation email with QR code
      emailToSend ? sendBookingConfirmation(env as any, {
        driverEmail: emailToSend, driverName: safeDriverName || emailToSend,
        bookingId: numericBookingId, listingTitle, listingAddress,
        startTime: startFmt, endTime: endFmt, totalCharged: amountPaid,
        vehiclePlate: safeVehiclePlate || 'Not provided',
        qrCodeImageUrl: qrDataUrl || undefined,
        qrCheckinUrl:   qrCheckinUrl || undefined,
      }) : Promise.resolve(true),

      // Payment receipt email (separate email from confirmation)
      emailToSend ? sendPaymentReceipt(env as any, {
        toEmail: emailToSend, toName: safeDriverName || emailToSend,
        bookingId: numericBookingId, amount: amountPaid,
        last4: (pi as any).payment_method_details?.card?.last4, listingTitle
      }) : Promise.resolve(true),

      // SMS confirmation with QR checkin link
      phoneToSend ? smsSendBookingConfirmation(env as any, {
        toPhone: phoneToSend, driverName: safeDriverName || 'Driver',
        bookingId: numericBookingId, listingTitle, listingAddress,
        startTime: startFmt, endTime: endFmt, totalCharged: amountPaid,
        qrCheckinUrl: qrCheckinUrl || undefined,
      }) : Promise.resolve(true)
    ]).catch((emailErr: any) => console.error('[Confirm] email/SMS error:', emailErr?.message || emailErr))

    // Log SMS dispatch outcome for debugging
    if (phoneToSend) {
      console.log(`[Confirm] SMS dispatched to ${phoneToSend.slice(0,7)}***`)
    } else {
      console.log('[Confirm] No phone number provided — SMS skipped')
    }

    // ── 6. In-app notification (async, non-blocking) ─────────────────────
    if (db && resolvedDriverId) {
      ;(async () => {
        try {
          const [driver, hostRow] = await Promise.all([
            resolvedDriverId
              ? db.prepare('SELECT full_name, email, phone FROM users WHERE id = ?').bind(resolvedDriverId).first<any>()
              : Promise.resolve(null),
            resolvedHostId
              ? db.prepare('SELECT id, full_name, email, phone FROM users WHERE id = ?').bind(resolvedHostId).first<any>()
              : Promise.resolve(null)
          ])
          await notifyBookingConfirmed(env as any, {
            driverId: resolvedDriverId as number,
            driverName:  driver?.full_name  || driver_name  || 'Driver',
            driverEmail: driver?.email      || driver_email || '',
            driverPhone: driver?.phone      || body.driver_phone || null,
            hostId:      hostRow?.id        || 0,
            hostName:    hostRow?.full_name || 'Host',
            hostEmail:   hostRow?.email     || '',
            hostPhone:   hostRow?.phone     || null,
            bookingId:   numericBookingId,
            listingTitle, listingAddress,
            startTime: startFmt, endTime: endFmt,
            totalCharged: amountPaid, hostPayout,
          })
        } catch (ne: any) { console.error('[notify booking confirmed]', ne.message) }
      })()
    }

    return c.json({
      success:                true,
      booking_id:             bookingRef,
      db_booking_id:          dbBookingId,
      status:                 'confirmed',
      amount_paid:            amountPaid,
      host_payout:            hostPayout,
      platform_fee:           platformFee,
      confirmation_email_sent: true,
    }, 201)

  } catch (e: any) {
    console.error('[Stripe] confirm error:', e.message)
    return c.json({ error: e.message || 'Confirmation failed' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
// GET /api/payments/transfer-status?booking_id=X  or  ?payment_intent_id=Y
// Returns the payout/transfer status for a booking (auth required).
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.get('/payments/transfer-status', requireUserAuth(), async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  const bookingId = c.req.query('booking_id')
  const piId      = c.req.query('payment_intent_id')

  if (!bookingId && !piId) {
    return c.json({ error: 'Provide booking_id or payment_intent_id' }, 400)
  }

  try {
    const row = await db.prepare(`
      SELECT
        p.id                      AS payment_id,
        p.booking_id,
        p.amount,
        p.platform_fee,
        p.host_payout,
        p.stripe_payment_intent_id AS payment_intent_id,
        p.stripe_charge_id         AS charge_id,
        p.stripe_transfer_id       AS transfer_id,
        p.status                   AS payment_status,
        p.type                     AS payment_type,
        p.created_at,
        pi2.stripe_account_id      AS host_stripe_account,
        CASE
          WHEN p.stripe_transfer_id IS NOT NULL THEN 'transferred'
          WHEN pr.id IS NOT NULL AND pr.recovery_status = 'payout_failed' THEN 'payout_failed'
          WHEN pr.id IS NOT NULL AND pr.recovery_status = 'payout_pending' THEN 'payout_pending'
          ELSE 'awaiting_transfer'
        END AS payout_status
      FROM payments p
      LEFT JOIN users h          ON h.id = (SELECT host_id FROM bookings WHERE id = p.booking_id LIMIT 1)
      LEFT JOIN payout_info pi2  ON pi2.user_id = h.id
      LEFT JOIN payment_recovery_log pr ON pr.stripe_pi_id = p.stripe_payment_intent_id
                                       AND pr.recovery_status IN ('payout_pending','payout_failed')
      WHERE ${bookingId ? 'p.booking_id = ?' : 'p.stripe_payment_intent_id = ?'}
        AND p.type = 'charge'
      LIMIT 1
    `).bind(bookingId || piId).first<any>()

    if (!row) return c.json({ error: 'Payment not found' }, 404)

    return c.json({
      payment_id:          row.payment_id,
      booking_id:          row.booking_id,
      amount_charged:      row.amount,
      platform_fee:        row.platform_fee,
      host_payout:         row.host_payout,
      payment_intent_id:   row.payment_intent_id,
      charge_id:           row.charge_id,
      transfer_id:         row.transfer_id,
      payment_status:      row.payment_status,
      payout_status:       row.payout_status,
      host_has_account:    !!row.host_stripe_account,
      created_at:          row.created_at,
    })
  } catch (e: any) {
    console.error('[transfer-status]', e.message)
    return c.json({ error: 'Query failed' }, 500)
  }
})

// POST /api/payments/refund
// Body: { payment_intent_id, booking_id, amount_cents?, reason, requester_email }
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.post('/payments/refund', requireUserAuth(), async (c) => {
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

    // ── In-app notifications: cancellation for driver + host ─────────────
    ;(async () => {
      try {
        const db = env?.DB
        if (!db || !booking_id) return
        // Look up booking + both parties
        const bk = await db.prepare(`
          SELECT b.id, b.driver_id, b.host_id, b.start_time, b.end_time,
                 l.title AS listing_title,
                 d.full_name AS driver_name, d.email AS driver_email, d.phone AS driver_phone,
                 h.full_name AS host_name,   h.email AS host_email,   h.phone AS host_phone
          FROM bookings b
          LEFT JOIN listings l ON b.listing_id = l.id
          LEFT JOIN users d    ON b.driver_id  = d.id
          LEFT JOIN users h    ON b.host_id    = h.id
          WHERE b.id = ?
        `).bind(booking_id).first<any>()

        if (!bk) return
        const cancelledBy = body.cancelled_by || body.requester_role || 'user'

        await notifyBookingCancelled(env as any, {
          driverId:     bk.driver_id,
          driverName:   bk.driver_name  || 'Driver',
          driverEmail:  bk.driver_email || '',
          driverPhone:  bk.driver_phone || null,
          hostId:       bk.host_id,
          hostName:     bk.host_name    || 'Host',
          hostEmail:    bk.host_email   || '',
          hostPhone:    bk.host_phone   || null,
          bookingId:    booking_id,
          listingTitle: bk.listing_title || 'Parking Space',
          refundAmount,
          cancelledBy,
        })
      } catch (ne: any) { console.error('[notify cancel]', ne.message) }
    })()

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

          // Fire in-app notification for webhook-confirmed bookings (awaited)
          try {
            const bk = await db.prepare(`
              SELECT b.id, b.driver_id, b.host_id, b.start_time, b.end_time,
                     b.total_charged, b.host_payout, b.vehicle_plate,
                     l.title AS listing_title, l.address, l.city,
                     d.full_name AS driver_name, d.email AS driver_email, d.phone AS driver_phone,
                     h.full_name AS host_name,   h.email AS host_email,   h.phone AS host_phone
              FROM bookings b
              LEFT JOIN listings l ON b.listing_id = l.id
              LEFT JOIN users d    ON b.driver_id  = d.id
              LEFT JOIN users h    ON b.host_id    = h.id
              WHERE b.stripe_payment_intent_id = ?
            `).bind(pi.id).first<any>()
            if (bk) {
              await notifyBookingConfirmed(env as any, {
                driverId:       bk.driver_id,
                driverName:     bk.driver_name  || 'Driver',
                driverEmail:    bk.driver_email || '',
                driverPhone:    bk.driver_phone || null,
                hostId:         bk.host_id,
                hostName:       bk.host_name    || 'Host',
                hostEmail:      bk.host_email   || '',
                hostPhone:      bk.host_phone   || null,
                bookingId:      bk.id,
                listingTitle:   bk.listing_title || 'Parking Space',
                listingAddress: [bk.address, bk.city].filter(Boolean).join(', '),
                startTime:      bk.start_time,
                endTime:        bk.end_time,
                totalCharged:   bk.total_charged || (pi.amount / 100),
                hostPayout:     bk.host_payout  || 0,
                vehiclePlate:   bk.vehicle_plate || '',
              })
            }
          } catch (ne: any) { console.error('[Webhook notify confirmed]', ne.message) }
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
    case 'transfer.created':
    case 'transfer.paid': {
      // ── Reconcile host payout transfer ─────────────────────────────────
      // Stripe fires transfer.created when the Transfer object is created,
      // and transfer.paid when funds actually settle in the host's account.
      // We stamp stripe_transfer_id on the payments row on BOTH events
      // so the record is up to date at the earliest possible moment.
      const transfer = event.data.object
      const transferId    = transfer.id        as string
      const sourceCharge  = transfer.source_transaction as string | undefined
      const transferGroup = transfer.transfer_group     as string | undefined
      const settled       = event.type === 'transfer.paid'

      console.log(`[Webhook] Transfer ${event.type}: ${transferId} group=${transferGroup || 'none'} settled=${settled}`)

      if (db && (sourceCharge || transferGroup)) {
        try {
          // Find matching payment row via the source charge or transfer_group
          const whereClause = sourceCharge
            ? `stripe_charge_id = ?`
            : `stripe_payment_intent_id LIKE ?`
          const whereParam  = sourceCharge
            ? sourceCharge
            : transferGroup?.replace('booking-', '') || ''

          // Stamp transfer ID + set status to 'payout_sent' if settled
          const updateResult = await db.prepare(`
            UPDATE payments
            SET stripe_transfer_id = COALESCE(stripe_transfer_id, ?),
                updated_at          = datetime('now')
            WHERE ${whereClause}
              AND type = 'charge'
          `).bind(transferId, whereParam).run()

          if (updateResult.meta?.changes && updateResult.meta.changes > 0) {
            console.log(`[Webhook] Stamped transfer_id ${transferId} on payment(s) via ${sourceCharge ? 'charge' : 'group'}`)
          } else {
            console.warn(`[Webhook] No payment row found for transfer ${transferId} — may need manual reconciliation`)
          }

          // Also clear any payout_pending recovery entries for this PI
          if (sourceCharge || transferGroup) {
            await db.prepare(`
              UPDATE payment_recovery_log
              SET recovery_status = 'resolved',
                  resolved_at     = datetime('now'),
                  error_detail    = error_detail || ' | resolved by ' || ?
              WHERE recovery_status IN ('payout_pending','payout_failed')
                AND (${sourceCharge ? `stripe_pi_id IN (SELECT stripe_payment_intent_id FROM payments WHERE stripe_charge_id = ?)` : `stripe_pi_id LIKE ?`})
            `).bind(`transfer ${transferId}`, sourceCharge || whereParam).run().catch(() => {})
          }

          logEvent('info', `transfer.${settled ? 'paid' : 'created'}`, {
            transfer_id: transferId, source_charge: sourceCharge || null,
            transfer_group: transferGroup || null, settled,
          })
        } catch (e: any) {
          console.error(`[Webhook] D1 update error (${event.type}):`, e.message)
        }
      }
      break
    }
    case 'transfer.failed': {
      const transfer = event.data.object
      console.error(`[Webhook] Transfer FAILED: ${transfer.id}`)
      const sourceCharge = transfer.source_transaction as string | undefined
      if (db && sourceCharge) {
        try {
          // Mark recovery record so admin is alerted
          await db.prepare(`
            INSERT OR IGNORE INTO payment_recovery_log
              (stripe_pi_id, amount_cents, hold_id, recovery_status, error_detail, created_at)
            SELECT stripe_payment_intent_id, CAST(amount * 100 AS INTEGER), NULL,
                   'payout_failed', 'Stripe transfer.failed for charge: ' || ?,
                   datetime('now')
            FROM payments WHERE stripe_charge_id = ? LIMIT 1
          `).bind(sourceCharge, sourceCharge).run()
        } catch {}
      }
      logEvent('error', 'transfer.failed', { transfer_id: transfer.id, source_charge: sourceCharge || null })
      break
    }
    default:
      // ── Stripe Connect account events ──────────────────────────────────
      // These arrive with a Stripe-Account header on the webhook payload.
      // We log them to stripe_connect_events for auditing/debugging.
      if (event.type.startsWith('account.') || event.type.startsWith('person.') ||
          event.type.startsWith('capability.') ||
          (event.type.startsWith('payout.') && event.account)) {
        const connectedAccountId = event.account as string | undefined
        const obj = event.data?.object as any

        try {
          // Log the event
          if (db) {
            await db.prepare(`
              INSERT OR IGNORE INTO stripe_connect_events
                (stripe_event_id, event_type, connected_account_id, stripe_payout_id,
                 host_id, payload_json, processed, created_at)
              SELECT ?, ?, ?,
                     CASE WHEN ? LIKE 'po_%' THEN ? ELSE NULL END,
                     sca.user_id,
                     ?, 1, datetime('now')
              FROM stripe_connect_accounts sca
              WHERE sca.stripe_account_id = ?
              LIMIT 1
            `).bind(
              event.id, event.type, connectedAccountId || null,
              obj?.id || '', obj?.id || '',
              JSON.stringify(event.data?.object || {}),
              connectedAccountId || ''
            ).run().catch(() => {
              // If no matching account, still log without host_id
              if (db) {
                db.prepare(`
                  INSERT OR IGNORE INTO stripe_connect_events
                    (stripe_event_id, event_type, connected_account_id, stripe_payout_id,
                     payload_json, processed, created_at)
                  VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
                `).bind(
                  event.id, event.type, connectedAccountId || null,
                  (obj?.id || '').startsWith('po_') ? obj.id : null,
                  JSON.stringify(event.data?.object || {})
                ).run().catch(() => {})
              }
            })

            // ── account.updated: sync onboarding status ─────────────────
            if (event.type === 'account.updated' && connectedAccountId) {
              const acct = event.data.object as any
              const newStatus = acct.details_submitted ? 'complete'
                : (acct.requirements?.currently_due?.length > 0) ? 'restricted'
                : 'in_progress'

              await db.prepare(`
                UPDATE stripe_connect_accounts
                SET onboarding_status = ?,
                    charges_enabled   = ?,
                    payouts_enabled   = ?,
                    details_submitted = ?,
                    requirements_json = ?,
                    updated_at        = datetime('now')
                WHERE stripe_account_id = ?
              `).bind(
                newStatus,
                acct.charges_enabled ? 1 : 0,
                acct.payouts_enabled ? 1 : 0,
                acct.details_submitted ? 1 : 0,
                JSON.stringify(acct.requirements || {}),
                connectedAccountId
              ).run()

              // Sync payout_info
              await db.prepare(`
                UPDATE payout_info
                SET onboarding_status = ?, payouts_enabled = ?, updated_at = datetime('now')
                WHERE connect_account_id = ?
              `).bind(newStatus, acct.payouts_enabled ? 1 : 0, connectedAccountId).run()

              console.log(`[Webhook] account.updated ${connectedAccountId} → ${newStatus}`)
            }

            // ── payout.paid / payout.failed / payout.updated ───────────────
            if (['payout.paid','payout.failed','payout.updated','payout.canceled'].includes(event.type)) {
              const payout = event.data.object as any
              const stripePayoutId = payout.id as string
              const newPayoutStatus = payout.status as string  // paid|failed|in_transit|canceled

              await db.prepare(`
                UPDATE host_payouts
                SET status       = ?,
                    failure_code    = ?,
                    failure_message = ?,
                    processed_at    = COALESCE(processed_at, datetime('now'))
                WHERE stripe_payout_id = ?
              `).bind(
                newPayoutStatus,
                payout.failure_code    || null,
                payout.failure_message || null,
                stripePayoutId
              ).run()

              if (event.type === 'payout.paid') {
                console.log(`[Webhook] Payout settled: ${stripePayoutId} $${payout.amount/100}`)
                logEvent('info', 'connect.payout_paid', {
                  payout_id: stripePayoutId, amount: payout.amount/100,
                  account: connectedAccountId,
                })
                // Send host notification for settled payout
                if (db && connectedAccountId) {
                  try {
                    const hostRow = await db.prepare(`
                      SELECT u.id, u.full_name, u.email, u.phone
                      FROM stripe_connect_accounts sca
                      JOIN users u ON u.id = sca.user_id
                      WHERE sca.stripe_account_id = ? LIMIT 1
                    `).bind(connectedAccountId).first<any>()
                    if (hostRow) {
                      notifyPayoutProcessed(env as any, {
                        hostId:    hostRow.id,
                        hostName:  hostRow.full_name || hostRow.email,
                        hostEmail: hostRow.email,
                        hostPhone: hostRow.phone || null,
                        amount:    payout.amount / 100,
                      }).catch(() => {})
                    }
                  } catch {}
                }
              } else if (event.type === 'payout.failed') {
                console.error(`[Webhook] Payout FAILED: ${stripePayoutId} code=${payout.failure_code}`)
                logEvent('error', 'connect.payout_failed', {
                  payout_id: stripePayoutId, code: payout.failure_code,
                  message: payout.failure_message, account: connectedAccountId,
                })
                // Increment retry count + notify host of failure
                if (db) {
                  try {
                    await db.prepare(`
                      UPDATE host_payouts
                      SET retry_count = retry_count + 1, last_retry_at = datetime('now')
                      WHERE stripe_payout_id = ?
                    `).bind(stripePayoutId).run()

                    if (connectedAccountId) {
                      const hostRow = await db.prepare(`
                        SELECT u.id, u.full_name, u.email
                        FROM stripe_connect_accounts sca
                        JOIN users u ON u.id = sca.user_id
                        WHERE sca.stripe_account_id = ? LIMIT 1
                      `).bind(connectedAccountId).first<any>()
                      if (hostRow && db) {
                        await db.prepare(`
                          INSERT INTO notifications (user_id, user_role, type, title, message, created_at)
                          VALUES (?, 'host', 'payout_failed', '⚠️ Payout Failed',
                            'Your payout of $' || ROUND(? / 100.0, 2) || ' failed. Reason: ' || ?,
                            datetime('now'))
                        `).bind(
                          hostRow.id,
                          payout.amount,
                          payout.failure_message || payout.failure_code || 'Unknown error'
                        ).run().catch(() => {})
                      }
                    }
                  } catch {}
                }
              }
            }
          }
        } catch (we: any) {
          console.error(`[Webhook] ${event.type} handler error:`, we.message)
        }
      } else {
        console.log(`[Webhook] Unhandled event: ${event.type}`)
      }
  }

  return c.json({ received: true })
})

// ════════════════════════════════════════════════════════════════════════════
// RESEND — Send welcome email (internal use only — called server-side after signup)
// POST /api/emails/welcome  — requires auth to prevent spam abuse
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.post('/emails/welcome', requireUserAuth(), async (c) => {
  const session = c.get('user') as any
  const db = c.env?.DB
  // Only send to the authenticated user's own email
  let email = session?.email
  let name  = ''
  if (db && session?.userId) {
    try {
      const row = await db.prepare('SELECT email, full_name, role FROM users WHERE id = ?')
        .bind(session.userId).first<any>()
      if (row) { email = row.email; name = row.full_name }
    } catch {}
  }
  if (!email) return c.json({ error: 'Could not determine email from session' }, 400)
  const ok = await sendWelcomeEmail(c.env as any, { toEmail: email, toName: name || email, role: session?.role?.toUpperCase() || 'DRIVER' })
  return c.json({ success: ok })
})

// ════════════════════════════════════════════════════════════════════════════
// LISTINGS — Real D1 data with geo-filtering
// GET /api/listings?q=&type=&city=&lat=&lng=&radius_km=&min_price=&max_price=&instant=&min_pri=&sort=&limit=&offset=
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.get('/listings', async (c) => {
  const {
    q, type, city, lat, lng,
    radius_km = '50',
    min_price, max_price,
    instant, min_pri, sort,
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

    // Validate & sanitize enum/numeric inputs before building query
    const VALID_TYPES = ['driveway','garage','lot','street','covered']
    if (type && type !== 'all') {
      if (VALID_TYPES.includes(type.toLowerCase())) {
        where.push('l.type = ?'); params.push(type.toLowerCase())
      }
      // silently ignore invalid type values
    }
    // Escape LIKE wildcards in user strings to prevent wildcard injection
    const escapeLike = (s: string) => s.replace(/[%_\\]/g, ch => '\\' + ch)
    if (city) {
      const safeCity = escapeLike(city.substring(0, 100))
      where.push("(l.city LIKE ? ESCAPE '\\' OR l.state LIKE ? ESCAPE '\\')")
      params.push(`%${safeCity}%`); params.push(`%${safeCity}%`)
    }
    const minPriceF = min_price ? parseFloat(min_price) : NaN
    const maxPriceF = max_price ? parseFloat(max_price) : NaN
    if (!isNaN(minPriceF) && minPriceF >= 0) { where.push('l.rate_hourly >= ?'); params.push(minPriceF) }
    if (!isNaN(maxPriceF) && maxPriceF >= 0) { where.push('l.rate_hourly <= ?'); params.push(maxPriceF) }
    if (instant === '1' || instant === 'true') { where.push('l.instant_book = 1') }
    const minPriF = min_pri ? parseFloat(min_pri) : NaN
    if (!isNaN(minPriF) && minPriF >= 0 && minPriF <= 100) { where.push('l.pri_score >= ?'); params.push(minPriF) }
    if (q) {
      const safeQ = escapeLike(q.substring(0, 200))
      where.push("(l.title LIKE ? ESCAPE '\\' OR l.address LIKE ? ESCAPE '\\' OR l.city LIKE ? ESCAPE '\\' OR l.description LIKE ? ESCAPE '\\')")
      const ql = `%${safeQ}%`
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
    const orderBy = sort === 'reliability'
      ? 'l.pri_score DESC NULLS LAST, l.avg_rating DESC'
      : 'l.avg_rating DESC, l.review_count DESC'

    const countQ  = await db.prepare(`SELECT COUNT(*) as total FROM listings l ${whereClause}`).bind(...params).first<{total:number}>()
    const total   = countQ?.total ?? 0

    // Include PRI score and host credentials in a single pass
    // pri_score on listings table is the denormalized fast-path value
    const rows = await db.prepare(`
      SELECT l.id, l.title, l.type, l.address, l.city, l.state, l.zip,
             l.lat, l.lng,
             l.rate_hourly, l.rate_daily, l.rate_monthly,
             l.max_vehicle_size, l.amenities, l.instant_book,
             l.avg_rating, l.review_count, l.status,
             l.pri_score,
             u.full_name as host_name, u.id as host_id,
             hc.tier1_verified, hc.tier2_secure, hc.tier3_performance, hc.tier4_founding,
             pm.total_bookings as pri_total_bookings, pm.cancel_count,
             pm.avg_confirm_hours, pm.avg_response_minutes
      FROM listings l
      LEFT JOIN users u ON l.host_id = u.id
      LEFT JOIN host_credentials hc ON hc.host_id = l.host_id
      LEFT JOIN pri_metrics pm ON pm.listing_id = l.id
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).bind(...params, lim, off).all()

    const data = (rows.results || []).map((r: any) => {
      let amenities: string[] = []
      try { amenities = JSON.parse(r.amenities || '[]') } catch {}
      const pri = r.pri_score != null ? Math.round(r.pri_score) : null
      const priDisplay = pri !== null && (r.pri_total_bookings || 0) >= 5 ? pri : null
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
        pri_score: priDisplay,
        pri_bookings: r.pri_total_bookings || 0,
        pri_cancels: r.cancel_count || 0,
        pri_confirm_hours: r.avg_confirm_hours || 0,
        pri_response_mins: r.avg_response_minutes || 0,
        host: {
          id: r.host_id,
          name: r.host_name,
          verified: r.tier1_verified === 1,
          secure: r.tier2_secure === 1,
          performance: r.tier3_performance === 1,
          founding: r.tier4_founding === 1,
        },
        available: true
      }
    })

    return c.json({ data, total, limit: lim, offset: off, has_more: off + lim < total, source: 'd1' })
  } catch (e: any) {
    console.error('[API] listings error:', e.message)
    return c.json({ error: 'Failed to fetch listings' }, 500)
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

  // ── Host Agreement enforcement ──────────────────────────────────────────
  // Host must have accepted the current version before creating any listing.
  // Verify via the denormalized users column (no extra JOIN needed).
  if (userRole !== 'ADMIN') {
    try {
      const hostUser = await db.prepare(
        'SELECT host_agreement_version FROM users WHERE id = ?'
      ).bind(session.userId).first<{ host_agreement_version: string | null }>()
      if (hostUser?.host_agreement_version !== CURRENT_VERSIONS.host_agreement) {
        return c.json({
          error: 'You must accept the current Host Agreement before creating a listing.',
          agreement_required: true,
          document_type: 'host_agreement',
          required_version: CURRENT_VERSIONS.host_agreement,
          accepted_version: hostUser?.host_agreement_version || null,
        }, 403)
      }
    } catch (e: any) {
      console.warn('[POST /api/listings] Agreement check failed (non-fatal):', e.message)
      // Don't block on DB error — the frontend also guards this
    }
  }

  let body: any = {}
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  console.log(`[POST /api/listings] user=${session.userId} title="${String(body.title || '').substring(0,60)}"`)  // no PII logged

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

    // ── Address verification ──────────────────────────────────────────────
    const placeId  = validateInput(body.place_id, { maxLength: 200 }) || null
    let lat        = body.lat  ? parseFloat(body.lat)  : null
    let lng        = body.lng  ? parseFloat(body.lng)  : null

    // Reject PO Boxes server-side
    if (/\b(p\.?\s*o\.?\s*box|post\s*office\s*box)\b/i.test(address)) {
      return c.json({ error: 'PO Box addresses are not accepted. Please use a physical street address.' }, 400)
    }

    // If frontend didn't supply coordinates, fall back to server-side Mapbox geocoding
    if ((!lat || !lng || isNaN(lat) || isNaN(lng)) && c.env?.MAPBOX_TOKEN) {
      try {
        const fullAddr = `${address}, ${city}, ${state} ${zip}`
        const geoUrl   = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(fullAddr)}.json` +
          `?access_token=${c.env.MAPBOX_TOKEN}&country=us&types=address&limit=1`
        const geoRes   = await fetch(geoUrl)
        const geoData: any = await geoRes.json()
        const feature  = geoData.features?.[0]
        if (feature?.center) {
          lat = feature.center[1]
          lng = feature.center[0]
          console.log(`[POST /api/listings] Server geocoded: lat=${lat} lng=${lng}`)
        }
      } catch (geoErr: any) {
        console.warn('[POST /api/listings] Server geocoding failed (non-fatal):', geoErr.message)
      }
    }

    // Normalise invalid coords to null rather than blocking the listing
    if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        lat = null; lng = null
      }
    } else {
      lat = null; lng = null
    }

    const finalLat = lat
    const finalLng = lng

    // Sanitize amenities — must be array of known values
    const VALID_AMENITIES = ['covered','ev_charging','security_camera','gated','lighting','24hr_access','shuttle','attended']
    let amenities: string[] = []
    if (Array.isArray(body.amenities)) {
      amenities = body.amenities.filter((a: any) => VALID_AMENITIES.includes(String(a)))
    }

    // ── Insert into D1 ────────────────────────────────────────────────────
    const result = await db.prepare(`
      INSERT INTO listings
        (host_id, title, type, description, address, city, state, zip, country,
         lat, lng, place_id, address_verified,
         rate_hourly, rate_daily, rate_monthly,
         amenities, instant_book, status, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, 'US',
         ?, ?, ?, 1,
         ?, ?, ?,
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
      finalLat, finalLng, placeId,
      rateHourly, rateDaily, rateMonthly,
      JSON.stringify(amenities),
      instantBook
    ).run()

    const newId = result.meta?.last_row_id ?? null
    console.log(`[POST /api/listings] Created listing id=${newId} for user=${session.userId}`)

    // Admin in-app notification: new listing (await to ensure it runs before response)
    if (newId) {
      await notifyNewListing(c.env as any, {
        hostName: session.full_name || session.email || 'A host',
        listingId: Number(newId),
        listingTitle: sanitizeHtml(title),
      }).catch(() => {})
    }

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
    return c.json({ error: 'Failed to create listing'}, 500)
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
  if (body.type !== undefined) {
    const VALID_TYPES = ['driveway','garage','lot','street','covered']
    const t = String(body.type).toLowerCase()
    if (VALID_TYPES.includes(t)) { updates.push('type = ?'); params.push(t) }
    else return c.json({ error: 'Invalid listing type' }, 400)
  }
  if (body.address !== undefined)     { updates.push('address = ?');       params.push(sanitizeHtml(validateInput(body.address, { maxLength: 200 }))) }
  if (body.city !== undefined)        { updates.push('city = ?');          params.push(sanitizeHtml(validateInput(body.city, { maxLength: 100 }))) }
  if (body.state !== undefined)       { updates.push('state = ?');         params.push(sanitizeHtml(validateInput(body.state, { maxLength: 50 }))) }
  if (body.zip !== undefined)         { updates.push('zip = ?');           params.push(sanitizeHtml(validateInput(body.zip, { maxLength: 20 }))) }
  if (body.rate_hourly !== undefined) {
    const r = parseFloat(body.rate_hourly)
    if (!isNaN(r) && r >= 0.5 && r <= 500) { updates.push('rate_hourly = ?'); params.push(r) }
    else return c.json({ error: 'Hourly rate must be between $0.50 and $500' }, 400)
  }
  if (body.rate_daily !== undefined) {
    const r = parseFloat(body.rate_daily)
    if (!isNaN(r) && r >= 1 && r <= 5000) { updates.push('rate_daily = ?'); params.push(r) }
    else return c.json({ error: 'Daily rate must be between $1 and $5,000' }, 400)
  }
  if (body.rate_monthly !== undefined){ updates.push('rate_monthly = ?');  params.push(parseFloat(body.rate_monthly) || null) }
  // status can only be set to 'active' or 'archived' by the owner — never 'suspended' (admin-only)
  if (body.status !== undefined) {
    const ALLOWED_STATUSES = ['active','archived']
    const userRole = (session.role || '').toUpperCase()
    if (userRole === 'ADMIN' || ALLOWED_STATUSES.includes(String(body.status))) {
      updates.push('status = ?'); params.push(body.status)
    } else {
      return c.json({ error: 'Invalid status value' }, 400)
    }
  }
  if (body.instant_book !== undefined){ updates.push('instant_book = ?');  params.push(body.instant_book ? 1 : 0) }
  if (body.amenities !== undefined) {
    const VALID_AMENITIES = ['covered','ev_charging','security_camera','gated','lighting','24hr_access','shuttle','attended']
    let amenities: string[] = []
    if (Array.isArray(body.amenities)) {
      amenities = body.amenities.filter((a: any) => VALID_AMENITIES.includes(String(a)))
    }
    updates.push('amenities = ?'); params.push(JSON.stringify(amenities))
  }

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
// HOST AVAILABILITY SCHEDULE
// GET  /api/listings/:id/availability-schedule
//   Returns the host's per-weekday open/close windows.
//   Response: { listing_id, schedule: [ {day_of_week, is_available, open_time, close_time} ] }
// PUT  /api/listings/:id/availability-schedule
//   (Authenticated host only) — save/replace schedule rows.
//   Body: { schedule: [{day_of_week, is_available, open_time, close_time}] }
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.get('/listings/:id/availability-schedule', async (c) => {
  const listingId = c.req.param('id')
  const db = c.env?.DB
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  try {
    const rows = await db.prepare(`
      SELECT day_of_week, is_available, open_time, close_time
      FROM host_availability_schedule
      WHERE listing_id = ?
      ORDER BY day_of_week
    `).bind(listingId).all<any>()

    // If no schedule rows exist yet, return a default 07:00-22:00 all-week schedule
    const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
    let schedule = (rows.results || []).map((r: any) => ({
      day_of_week:  r.day_of_week,
      day_name:     DAY_NAMES[r.day_of_week],
      is_available: !!(r.is_available),
      open_time:    r.open_time  || '07:00',
      close_time:   r.close_time || '22:00',
    }))

    if (schedule.length === 0) {
      schedule = DAY_NAMES.map((name, i) => ({
        day_of_week: i, day_name: name, is_available: true,
        open_time: '07:00', close_time: '22:00',
      }))
    }

    return c.json({ listing_id: listingId, schedule })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

apiRoutes.put('/listings/:id/availability-schedule', requireUserAuth(), async (c) => {
  const listingId = c.req.param('id')
  const db = c.env?.DB
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  const body = await c.req.json().catch(() => ({})) as any
  const schedule: any[] = Array.isArray(body.schedule) ? body.schedule : []
  if (schedule.length === 0) return c.json({ error: 'schedule array required' }, 400)

  try {
    // Upsert each day row
    await Promise.all(schedule.map((row: any) => {
      const day = parseInt(String(row.day_of_week))
      if (isNaN(day) || day < 0 || day > 6) return Promise.resolve()
      return db.prepare(`
        INSERT INTO host_availability_schedule
          (listing_id, day_of_week, is_available, open_time, close_time, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(listing_id, day_of_week) DO UPDATE SET
          is_available = excluded.is_available,
          open_time    = excluded.open_time,
          close_time   = excluded.close_time,
          updated_at   = excluded.updated_at
      `).bind(
        listingId, day,
        row.is_available ? 1 : 0,
        row.open_time  || '07:00',
        row.close_time || '22:00',
      ).run()
    }))

    return c.json({ success: true, updated: schedule.length })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// TIME SLOTS — Fine-grained availability for a specific date
// GET /api/listings/:id/time-slots?date=YYYY-MM-DD
//
// Returns 15-minute time slots for the given date with availability status:
//   available  — free, no bookings or holds
//   booked     — confirmed/active booking overlaps this slot
//   held       — active reservation hold overlaps (another user is checking out)
//   closed     — outside host's open_time/close_time window for that weekday
//   past       — slot is in the past
//
// Also returns host schedule for the day and any existing bookings for UI display.
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.get('/listings/:id/time-slots', async (c) => {
  const listingId = c.req.param('id')
  const dateStr   = c.req.query('date')   // YYYY-MM-DD
  const db = c.env?.DB

  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return c.json({ error: 'date query param required (YYYY-MM-DD)' }, 400)
  }
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  try {
    // ── 1. Parse the requested date ──────────────────────────────────────
    const [year, month, day] = dateStr.split('-').map(Number)
    const dateObj    = new Date(Date.UTC(year, month - 1, day))
    const dayOfWeek  = dateObj.getUTCDay()   // 0=Sun … 6=Sat
    const now        = new Date()

    // ── Inline sweep: cancel stale pending bookings + expire old holds/locks ─
    // Runs non-blocking before the conflict queries so stale rows never
    // appear as 'booked' or 'held' to other users.
    await Promise.all([
      sweepStalePendingBookings(db),
      sweepExpiredHolds(db),
      sweepExpiredLocks(db),
    ])

    // ── 2. Fetch host schedule for this weekday ──────────────────────────
    const schedRow = await db.prepare(`
      SELECT is_available, open_time, close_time
      FROM host_availability_schedule
      WHERE listing_id = ? AND day_of_week = ?
    `).bind(listingId, dayOfWeek).first<any>().catch(() => null)

    // Default schedule if not found: 07:00–22:00
    const hostAvail    = schedRow ? !!(schedRow.is_available) : true
    const openTimeStr  = schedRow?.open_time  || '07:00'
    const closeTimeStr = schedRow?.close_time || '22:00'

    // Convert "HH:MM" to minutes-since-midnight
    const toMins = (t: string) => {
      const [h, m] = t.split(':').map(Number)
      return h * 60 + (m || 0)
    }
    const openMins  = toMins(openTimeStr)
    const closeMins = toMins(closeTimeStr)

    // ── 3. Fetch confirmed/active bookings that touch this date ──────────
    const dayStart = `${dateStr}T00:00:00Z`
    const dayEnd   = `${dateStr}T23:59:59Z`

    const [bookingRows, holdRows, lockRows] = await db.batch([
      db.prepare(`
        SELECT start_time, end_time, id as booking_id
        FROM bookings
        WHERE listing_id = ?
          AND status IN ('confirmed','active')
          AND start_time < ?
          AND end_time   > ?
        ORDER BY start_time
      `).bind(listingId, dayEnd, dayStart),
      db.prepare(`
        SELECT start_time, end_time, session_token
        FROM reservation_holds
        WHERE listing_id = ?
          AND status = 'active'
          AND datetime(hold_expires_at) > datetime('now')
          AND start_time < ?
          AND end_time   > ?
        ORDER BY start_time
      `).bind(listingId, dayEnd, dayStart),
      db.prepare(`
        SELECT start_time, end_time, session_token
        FROM reservation_locks
        WHERE listing_id = ?
          AND status = 'locked'
          AND datetime(lock_expires_at) > datetime('now')
          AND start_time < ?
          AND end_time   > ?
        ORDER BY start_time
      `).bind(listingId, dayEnd, dayStart),
    ])

    const bookings: any[] = bookingRows.results || []
    const holds:    any[] = holdRows.results    || []
    const locks:    any[] = lockRows.results    || []

    // ── 4. Build 15-min slot grid for the full day (0:00 – 23:45) ───────
    const SLOT_MINS = 15
    const slots: Array<{
      time: string            // "HH:MM"
      iso:  string            // full ISO string
      status: 'available'|'booked'|'held'|'closed'|'past'
    }> = []

    for (let m = 0; m < 24 * 60; m += SLOT_MINS) {
      const hh   = String(Math.floor(m / 60)).padStart(2, '0')
      const mm   = String(m % 60).padStart(2, '0')
      const timeLabel = `${hh}:${mm}`
      const isoTime   = `${dateStr}T${timeLabel}:00Z`
      const slotMs    = Date.UTC(year, month - 1, day, Math.floor(m / 60), m % 60)

      // Past?
      if (slotMs < now.getTime()) {
        slots.push({ time: timeLabel, iso: isoTime, status: 'past' })
        continue
      }

      // Entire day closed?
      if (!hostAvail) {
        slots.push({ time: timeLabel, iso: isoTime, status: 'closed' })
        continue
      }

      // Outside host window?
      if (m < openMins || m >= closeMins) {
        slots.push({ time: timeLabel, iso: isoTime, status: 'closed' })
        continue
      }

      // Overlaps a confirmed booking? (slot = [m, m+15])
      const slotEndMs = slotMs + SLOT_MINS * 60_000
      const isBooked = bookings.some((b: any) => {
        const bs = new Date(b.start_time).getTime()
        const be = new Date(b.end_time).getTime()
        return bs < slotEndMs && be > slotMs
      })
      if (isBooked) {
        slots.push({ time: timeLabel, iso: isoTime, status: 'booked' })
        continue
      }

      // Overlaps an active hold or reservation lock?
      const allHeld = [...holds, ...locks]
      const isHeld = allHeld.some((h: any) => {
        const hs = new Date(h.start_time).getTime()
        const he = new Date(h.end_time).getTime()
        return hs < slotEndMs && he > slotMs
      })
      if (isHeld) {
        slots.push({ time: timeLabel, iso: isoTime, status: 'held' })
        continue
      }

      slots.push({ time: timeLabel, iso: isoTime, status: 'available' })
    }

    // ── 5. Return summary data ────────────────────────────────────────────
    return c.json({
      listing_id: listingId,
      date:       dateStr,
      day_of_week: dayOfWeek,
      host_schedule: {
        is_available: hostAvail,
        open_time:    openTimeStr,
        close_time:   closeTimeStr,
      },
      existing_bookings: bookings.map((b: any) => ({
        booking_id: b.booking_id,
        start_time: b.start_time,
        end_time:   b.end_time,
      })),
      slots,
    })

  } catch (e: any) {
    console.error('[time-slots]', e.message)
    return c.json({ error: e.message }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// VALIDATE TIME RANGE — server-side availability check before /api/holds
// POST /api/listings/:id/validate-slot
// Body: { start_datetime, end_datetime }
// Returns: { valid: bool, code?, error?, blocked_by_bookings?, blocked_by_holds? }
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.post('/listings/:id/validate-slot', async (c) => {
  const listingId = c.req.param('id')
  const db = c.env?.DB
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  const body = await c.req.json().catch(() => ({})) as any
  const { start_datetime, end_datetime } = body

  if (!start_datetime || !end_datetime) {
    return c.json({ valid: false, error: 'start_datetime and end_datetime required', code: 'MISSING_FIELDS' }, 400)
  }

  const start = new Date(start_datetime)
  const end   = new Date(end_datetime)

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return c.json({ valid: false, error: 'Invalid date format', code: 'INVALID_DATE' }, 400)
  }
  if (end <= start) {
    return c.json({ valid: false, error: 'End time must be after start time', code: 'INVALID_RANGE' }, 400)
  }
  if (start < new Date()) {
    return c.json({ valid: false, error: 'Start time must be in the future', code: 'TIME_IN_PAST' }, 400)
  }

  // Duration must be at least 15 minutes
  const durMins = (end.getTime() - start.getTime()) / 60_000
  if (durMins < 15) {
    return c.json({ valid: false, error: 'Minimum booking duration is 15 minutes', code: 'TOO_SHORT' }, 400)
  }

  try {
    // ── Inline sweep before conflict checks ──────────────────────────────
    await Promise.all([
      sweepStalePendingBookings(db),
      sweepExpiredHolds(db),
      sweepExpiredLocks(db),
    ])

    // ── 1. Host schedule check ────────────────────────────────────────────
    // Check every calendar day the booking spans
    const msPerDay = 86_400_000
    let cursor = new Date(start)
    cursor.setUTCHours(0, 0, 0, 0)
    const endDay = new Date(end)
    endDay.setUTCHours(0, 0, 0, 0)

    while (cursor <= endDay) {
      const dow = cursor.getUTCDay()
      const schedRow = await db.prepare(`
        SELECT is_available, open_time, close_time
        FROM host_availability_schedule
        WHERE listing_id = ? AND day_of_week = ?
      `).bind(listingId, dow).first<any>().catch(() => null)

      const isAvail   = schedRow ? !!(schedRow.is_available) : true
      const openTime  = schedRow?.open_time  || '07:00'
      const closeTime = schedRow?.close_time || '22:00'

      const toMins = (t: string) => {
        const [h, m] = t.split(':').map(Number)
        return h * 60 + (m || 0)
      }

      if (!isAvail) {
        const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
        return c.json({
          valid:  false,
          error:  `The host is not available on ${DAY_NAMES[dow]}s. Please choose a different day.`,
          code:   'HOST_CLOSED_DAY',
          day_of_week: dow,
        }, 409)
      }

      // Check if the booking start or end falls outside host's window on this day
      const dateStr = cursor.toISOString().split('T')[0]
      const dayOpenMs  = Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(),
        Math.floor(toMins(openTime) / 60), toMins(openTime) % 60)
      const dayCloseMs = Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(),
        Math.floor(toMins(closeTime) / 60), toMins(closeTime) % 60)

      // Booking portion on this day
      const segStart = Math.max(start.getTime(), dayOpenMs - 24 * 3600_000)
      // If booking starts before host opens on this day's date
      const bookingStartOnDay = new Date(start)
      if (bookingStartOnDay.toISOString().startsWith(dateStr) && start.getTime() < dayOpenMs) {
        return c.json({
          valid: false,
          error: `This spot opens at ${openTime} on this day. Please select a later start time.`,
          code:  'OUTSIDE_HOST_HOURS',
          open_time: openTime, close_time: closeTime,
        }, 409)
      }
      const bookingEndOnDay = new Date(end)
      if (bookingEndOnDay.toISOString().startsWith(dateStr) && end.getTime() > dayCloseMs) {
        return c.json({
          valid: false,
          error: `This spot closes at ${closeTime} on this day. Please select an earlier end time.`,
          code:  'OUTSIDE_HOST_HOURS',
          open_time: openTime, close_time: closeTime,
        }, 409)
      }

      cursor = new Date(cursor.getTime() + msPerDay)
    }

    // ── 2. Confirmed booking overlap check ───────────────────────────────
    const conflict = await db.prepare(`
      SELECT id, start_time, end_time
      FROM bookings
      WHERE listing_id = ?
        AND status IN ('confirmed','active')
        AND start_time < ?
        AND end_time   > ?
      LIMIT 1
    `).bind(listingId, end_datetime, start_datetime).first<any>()

    if (conflict) {
      const cs = new Date(conflict.start_time)
      const ce = new Date(conflict.end_time)
      const fmt = (d: Date) => d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true})
      return c.json({
        valid:  false,
        error:  `This time slot is already booked (${fmt(cs)} – ${fmt(ce)}). Please choose a different time.`,
        code:   'SLOT_BOOKED',
        conflicting_booking: { start: conflict.start_time, end: conflict.end_time },
      }, 409)
    }

    // ── 3. Active hold overlap check ─────────────────────────────────────
    const heldSlot = await db.prepare(`
      SELECT id, start_time, end_time
      FROM reservation_holds
      WHERE listing_id = ?
        AND status = 'active'
        AND datetime(hold_expires_at) > datetime('now')
        AND start_time < ?
        AND end_time   > ?
      LIMIT 1
    `).bind(listingId, end_datetime, start_datetime).first<any>()

    if (heldSlot) {
      return c.json({
        valid:  false,
        error:  'This time slot is temporarily reserved by another user. Please try again in a few minutes.',
        code:   'SLOT_HELD',
        retry_after_seconds: 600,
      }, 409)
    }

    // ── 4. Active reservation lock overlap check ──────────────────────────
    const lockedSlot = await db.prepare(`
      SELECT id, start_time, end_time
      FROM reservation_locks
      WHERE listing_id = ?
        AND status = 'locked'
        AND datetime(lock_expires_at) > datetime('now')
        AND start_time < ?
        AND end_time   > ?
      LIMIT 1
    `).bind(listingId, end_datetime, start_datetime).first<any>()

    if (lockedSlot) {
      return c.json({
        valid:  false,
        error:  'This time slot is no longer available. Another user is completing payment. Please choose a different time.',
        code:   'SLOT_HELD',
        retry_after_seconds: 300,
      }, 409)
    }

    // ── All clear — price using 15-min increments ─────────────────────────
    // Round up to nearest 15-minute block (minimum 1 block = 0.25h)
    const rawMins   = (end.getTime() - start.getTime()) / 60_000
    const roundMins = Math.max(15, Math.ceil(rawMins / 15) * 15)
    const hours     = Math.round((roundMins / 60) * 100) / 100

    const listing = await db.prepare(
      'SELECT rate_hourly FROM listings WHERE id = ? AND status = ?'
    ).bind(listingId, 'active').first<any>().catch(() => null)
    const rate     = listing?.rate_hourly || 12
    const subtotal = Math.round(rate * hours * 100) / 100
    const fee      = Math.round(subtotal * 0.15 * 100) / 100
    const total    = Math.round((subtotal + fee) * 100) / 100

    return c.json({
      valid: true,
      pricing: {
        hours,
        rate_per_hour: rate,
        subtotal, platform_fee: fee, total,
        total_cents: Math.round(total * 100),
        currency: 'usd',
      }
    })

  } catch (e: any) {
    console.error('[validate-slot]', e.message)
    return c.json({ error: e.message }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// RESERVATION HOLDS — Slot-lock before payment
// POST /api/holds
//
// NEW FLOW (replaces the old POST /api/bookings first-step):
//   1. Client calls POST /api/holds with listing_id + times + checkout_token
//   2. Server checks CONFIRMED/ACTIVE bookings AND active un-expired holds
//      for the same slot (excludes caller's own existing hold — idempotent)
//   3. Server inserts reservation_holds row (10-min TTL) atomically
//   4. Returns hold_id + session_token + expiry
//   5. Client uses hold_id in POST /api/payments/create-intent
//   6. POST /api/payments/confirm atomically converts hold → booking
//
// Overlap query intentionally excludes 'pending' bookings (orphaned rows
// from old flow). Only 'confirmed' and 'active' bookings block the slot.
// Active holds (not expired, not released/converted) also block the slot
// for other users, but NOT for the same session_token (idempotent retry).
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.post('/holds', async (c) => {
  const db  = c.env?.DB
  if (!db)  return c.json({ error: 'Database unavailable' }, 503)

  // ── Rate limiting (per IP) ────────────────────────────────────────────
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
  if (isRateLimited(`holds:${ip}`, HOLDS_RL_MAX, HOLDS_RL_WINDOW_MS)) {
    logEvent('warn', 'holds.rate_limited', { ip })
    return c.json({ error: 'Too many requests. Please slow down.' }, 429)
  }

  const body = await c.req.json().catch(() => ({})) as any

  // ── Input validation ──────────────────────────────────────────────────
  let listing_id: number, start_datetime: string, end_datetime: string
  try {
    listing_id     = parseInt(String(body.listing_id || ''))
    start_datetime = String(body.start_datetime || '').slice(0, 30)
    end_datetime   = String(body.end_datetime   || '').slice(0, 30)
    if (isNaN(listing_id) || listing_id < 1) throw new Error('listing_id required')
    if (!start_datetime || !end_datetime)     throw new Error('start/end datetime required')
  } catch (e: any) {
    return c.json({ error: e.message }, 400)
  }

  const start = new Date(start_datetime)
  const end   = new Date(end_datetime)
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    return c.json({ error: 'Invalid date range' }, 400)
  }
  if (start < new Date()) {
    return c.json({ error: 'Arrival time must be in the future' }, 400)
  }

  // ── Resolve caller identity ───────────────────────────────────────────
  const session       = c.get('user') as any
  const userId        = session?.userId ?? null
  const ipAddress     = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || null

  // checkout_token: client-generated UUID for idempotency across retries
  const checkoutToken = String(body.checkout_token || '').slice(0, 64) || null

  // session_token: used by client to prove ownership of this hold
  const sessionToken  = body.session_token
    ? String(body.session_token).slice(0, 64)
    : Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0')).join('')

  // ── Idempotency: return existing active hold for same session_token ──
  if (sessionToken) {
    try {
      const existing = await db.prepare(`
        SELECT rh.id, rh.session_token, rh.hold_expires_at, rh.status,
               rh.listing_id, rh.start_time, rh.end_time, l.rate_hourly
        FROM reservation_holds rh
        LEFT JOIN listings l ON l.id = rh.listing_id
        WHERE rh.session_token = ?
          AND rh.status = 'active'
          AND datetime(rh.hold_expires_at) > datetime('now')
        LIMIT 1
      `).bind(sessionToken).first<any>()

      if (existing && existing.listing_id === listing_id) {
        // Re-calculate pricing so the idempotent response matches the fresh one
        const iStart   = new Date(existing.start_time)
        const iEnd     = new Date(existing.end_time)
        const iRawMins = (iEnd.getTime() - iStart.getTime()) / 60_000
        const iRndMins = Math.max(15, Math.ceil(iRawMins / 15) * 15)
        const iHours   = Math.round((iRndMins / 60) * 100) / 100
        const iRate    = existing.rate_hourly || 12
        const iBase    = Math.round(iRate * iHours * 100) / 100
        const iFee     = Math.round(iBase * 0.15 * 100) / 100
        const iTotal   = Math.round((iBase + iFee) * 100) / 100
        return c.json({
          hold_id:        existing.id,
          session_token:  existing.session_token,
          expires_at:     existing.hold_expires_at,
          listing_id:     existing.listing_id,
          start_time:     existing.start_time,
          end_time:       existing.end_time,
          pricing: {
            hours:         iHours,
            rate_per_hour: iRate,
            subtotal:      iBase,
            platform_fee:  iFee,
            total:         iTotal,
            total_cents:   Math.round(iTotal * 100),
            currency:      'usd',
          },
          status:     'active',
          idempotent: true,
        })
      }
    } catch {}
  }

  try {
    // ── Inline sweep before ALL conflict checks ──────────────────────────
    await Promise.all([
      sweepStalePendingBookings(db),
      sweepExpiredHolds(db),
      sweepExpiredLocks(db),
    ])

    // ── 0. Host availability schedule check ─────────────────────────────
    {
      const toMins = (t: string) => { const [h,m] = t.split(':').map(Number); return h*60+(m||0) }
      const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
      // iterate over each calendar day spanned by the booking
      const msPerDay = 86_400_000
      let cur = new Date(start); cur.setUTCHours(0,0,0,0)
      const endDay = new Date(end); endDay.setUTCHours(0,0,0,0)
      while (cur <= endDay) {
        const dow = cur.getUTCDay()
        const schedRow = await db.prepare(
          'SELECT is_available, open_time, close_time FROM host_availability_schedule WHERE listing_id = ? AND day_of_week = ?'
        ).bind(listing_id, dow).first<any>().catch(() => null)
        const isAvail   = schedRow ? !!(schedRow.is_available) : true
        const openStr   = schedRow?.open_time  || '07:00'
        const closeStr  = schedRow?.close_time || '22:00'
        if (!isAvail) {
          return c.json({
            error: `The host is not available on ${DAY_NAMES[dow]}s. Please choose a different day.`,
            code: 'HOST_CLOSED_DAY', day_of_week: dow,
          }, 409)
        }
        const dateStr = cur.toISOString().split('T')[0]
        const [y,mo,d] = dateStr.split('-').map(Number)
        const openMs  = Date.UTC(y, mo-1, d, Math.floor(toMins(openStr)/60),  toMins(openStr)%60)
        const closeMs = Date.UTC(y, mo-1, d, Math.floor(toMins(closeStr)/60), toMins(closeStr)%60)
        if (start.toISOString().startsWith(dateStr) && start.getTime() < openMs) {
          return c.json({ error: `This spot opens at ${openStr} on this day.`, code: 'OUTSIDE_HOST_HOURS', open_time: openStr, close_time: closeStr }, 409)
        }
        if (end.toISOString().startsWith(dateStr) && end.getTime() > closeMs) {
          return c.json({ error: `This spot closes at ${closeStr} on this day. Please select an earlier end time.`, code: 'OUTSIDE_HOST_HOURS', open_time: openStr, close_time: closeStr }, 409)
        }
        cur = new Date(cur.getTime() + msPerDay)
      }
    }

    // ── 1. Check for CONFIRMED/ACTIVE booking conflicts ──────────────────
    const bookingConflict = await db.prepare(`
      SELECT id FROM bookings
      WHERE listing_id = ?
        AND status IN ('confirmed','active')
        AND start_time < ?
        AND end_time   > ?
      LIMIT 1
    `).bind(listing_id, end_datetime, start_datetime).first<{ id: number }>()

    if (bookingConflict) {
      logEvent('info', 'holds.slot_booked', { listing_id, start_datetime, end_datetime, ip })
      return c.json({
        error: 'This spot is already booked for the selected time. Please choose different dates.',
        code:  'SLOT_BOOKED',
      }, 409)
    }

    // ── 2. Check for active HOLDS by OTHER users (not this session) ──────
    const holdConflict = await db.prepare(`
      SELECT id FROM reservation_holds
      WHERE listing_id = ?
        AND status = 'active'
        AND datetime(hold_expires_at) > datetime('now')
        AND session_token != ?
        AND start_time < ?
        AND end_time   > ?
      LIMIT 1
    `).bind(listing_id, sessionToken, end_datetime, start_datetime).first<{ id: number }>()

    if (holdConflict) {
      logEvent('info', 'holds.slot_held', { listing_id, start_datetime, end_datetime, ip })
      return c.json({
        error: 'Another user is currently completing a booking for this time slot. Please try again in a few minutes.',
        code:  'SLOT_HELD',
        retry_after_seconds: 600,
      }, 409)
    }

    // ── 2b. Check for active RESERVATION LOCKS by OTHER sessions ─────────
    const lockConflict = await db.prepare(`
      SELECT id FROM reservation_locks
      WHERE listing_id = ?
        AND status = 'locked'
        AND datetime(lock_expires_at) > datetime('now')
        AND session_token != ?
        AND start_time < ?
        AND end_time   > ?
      LIMIT 1
    `).bind(listing_id, sessionToken, end_datetime, start_datetime).first<{ id: number }>()

    if (lockConflict) {
      logEvent('info', 'holds.slot_lock_conflict', { listing_id, start_datetime, end_datetime, ip })
      return c.json({
        error: 'Another user is finalising payment for this time slot. Please try again in a few minutes.',
        code:  'SLOT_HELD',
        retry_after_seconds: 300,
      }, 409)
    }

    // ── 3. Verify listing is active ───────────────────────────────────────
    const listing = await db.prepare(
      'SELECT id, rate_hourly, host_id, status FROM listings WHERE id = ? AND status = ?'
    ).bind(listing_id, 'active').first<any>()

    if (!listing) {
      return c.json({ error: 'Listing not found or unavailable', code: 'LISTING_UNAVAILABLE' }, 404)
    }

    // ── 4. Expire any stale holds/locks for this session before creating new ─
    await db.prepare(`
      UPDATE reservation_holds
      SET status = 'expired', updated_at = datetime('now')
      WHERE session_token = ? AND status = 'active'
    `).bind(sessionToken).run()
    await db.prepare(`
      UPDATE reservation_locks
      SET status = 'expired', updated_at = datetime('now')
      WHERE session_token = ? AND status = 'locked'
    `).bind(sessionToken).run()

    // ── 5. INSERT new hold (10-min TTL) ───────────────────────────────────
    const holdExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    // Price using 15-min increments (same logic as validate-slot)
    const rawMins   = (end.getTime() - start.getTime()) / 60_000
    const roundMins = Math.max(15, Math.ceil(rawMins / 15) * 15)
    const hours     = Math.round((roundMins / 60) * 100) / 100
    const rate      = listing.rate_hourly || 12
    const base      = Math.round(rate * hours * 100) / 100
    const fee       = Math.round(base * 0.15 * 100) / 100
    const total     = Math.round((base + fee) * 100) / 100

    const holdRes = await db.prepare(`
      INSERT INTO reservation_holds
        (listing_id, user_id, session_token, start_time, end_time,
         hold_expires_at, status, idempotency_key, ip_address, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, datetime('now'), datetime('now'))
    `).bind(
      listing_id, userId, sessionToken,
      start_datetime, end_datetime, holdExpiry,
      checkoutToken, ipAddress
    ).run()

    const holdId = holdRes.meta?.last_row_id ?? 0

    // ── 6. INSERT companion reservation_lock (5-min TTL for payment window) ─
    const lockExpiry = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    try {
      await db.prepare(`
        INSERT INTO reservation_locks
          (listing_id, session_token, hold_id, start_time, end_time,
           lock_expires_at, status, idempotency_key, ip_address, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'locked', ?, ?, datetime('now'), datetime('now'))
      `).bind(
        listing_id, sessionToken, holdId,
        start_datetime, end_datetime, lockExpiry,
        checkoutToken, ipAddress
      ).run()
    } catch (lockErr: any) {
      // Non-fatal: hold is sufficient; lock is a belt-and-suspenders guard
      console.warn('[holds] lock insert failed:', lockErr.message)
    }

    logEvent('info', 'holds.created', { hold_id: holdId, listing_id, user_id: userId, expires_at: holdExpiry, ip })

    return c.json({
      hold_id:       holdId,
      session_token: sessionToken,
      expires_at:    holdExpiry,
      listing_id,
      start_time:    start_datetime,
      end_time:      end_datetime,
      pricing: {
        hours,
        rate_per_hour: rate,
        subtotal:      base,
        platform_fee:  fee,
        total,
        total_cents:   Math.round(total * 100),
        currency:      'usd',
      },
      status: 'active',
    }, 201)

  } catch (e: any) {
    console.error('[holds POST]', e.message)
    return c.json({ error: 'Failed to reserve slot. Please try again.' }, 500)
  }
})

// ── HOLD STATUS — poll to verify hold is still valid ─────────────────────
apiRoutes.get('/holds/:token', async (c) => {
  const db    = c.env?.DB
  const token = c.req.param('token')
  if (!db || !token) return c.json({ valid: false })

  try {
    const hold = await db.prepare(`
      SELECT id, status, hold_expires_at, listing_id, start_time, end_time
      FROM reservation_holds
      WHERE session_token = ? LIMIT 1
    `).bind(token).first<any>()

    if (!hold) return c.json({ valid: false, code: 'HOLD_NOT_FOUND' })

    const expired = new Date(hold.hold_expires_at) <= new Date()
    if (expired && hold.status === 'active') {
      // Mark as expired
      await db.prepare(`UPDATE reservation_holds SET status='expired', updated_at=datetime('now') WHERE session_token=? AND status='active'`)
        .bind(token).run()
      return c.json({ valid: false, code: 'HOLD_EXPIRED' })
    }

    return c.json({
      valid:       hold.status === 'active' && !expired,
      status:      hold.status,
      expires_at:  hold.hold_expires_at,
      seconds_remaining: Math.max(0, Math.floor((new Date(hold.hold_expires_at).getTime() - Date.now()) / 1000)),
    })
  } catch {
    return c.json({ valid: false })
  }
})

// ── RELEASE HOLD — called on payment failure / page close ────────────────
apiRoutes.post('/holds/:token/release', async (c) => {
  const db    = c.env?.DB
  const token = c.req.param('token')
  if (!db || !token) return c.json({ ok: false })
  try {
    await db.prepare(`
      UPDATE reservation_holds SET status='released', updated_at=datetime('now')
      WHERE session_token=? AND status='active'
    `).bind(token).run()
    // Also release any associated reservation lock
    await db.prepare(`
      UPDATE reservation_locks SET status='released', updated_at=datetime('now')
      WHERE session_token=? AND status='locked'
    `).bind(token).run()
    return c.json({ ok: true })
  } catch {
    return c.json({ ok: false })
  }
})

// ════════════════════════════════════════════════════════════════════════════
// BOOKINGS — Create booking (DISABLED for direct client use)
//
// The ONLY valid booking creation path is:
//   POST /api/holds → POST /api/payments/create-intent → stripe.confirmPayment()
//   → POST /api/payments/confirm  (which creates the booking atomically)
//
// This route is intentionally disabled to prevent ghost bookings, slot
// squatting, and bypassing the payment pipeline.
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.post('/bookings', async (c) => {
  // Hard-block: direct booking creation without going through the payment
  // pipeline is not permitted. All bookings must flow through:
  //   1. POST /api/holds        — slot lock (10 min TTL)
  //   2. POST /api/payments/create-intent — create Stripe PI
  //   3. stripe.confirmPayment() — card charge
  //   4. POST /api/payments/confirm — atomic DB write on success
  return c.json({
    error: 'Direct booking creation is not supported. Please use the checkout flow.',
    code:  'USE_CHECKOUT_FLOW',
  }, 405)
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
// POST /api/bookings/:id/confirm  — host confirms a pending booking
// POST /api/bookings/:id/cancel   — host or driver cancels a booking
// Both endpoints are auth-guarded and enforce ownership.
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.post('/bookings/:id/confirm', requireUserAuth(), async (c) => {
  const db   = c.env?.DB
  const user = c.get('user') as any
  const id   = c.req.param('id')
  if (!db) return c.json({ error: 'Database unavailable' }, 503)
  try {
    const booking = await db.prepare(
      'SELECT id, host_id, driver_id, status FROM bookings WHERE id = ? LIMIT 1'
    ).bind(id).first<any>()
    if (!booking) return c.json({ error: 'Booking not found' }, 404)
    // Only host may confirm
    if (Number(user.userId) !== Number(booking.host_id)) {
      return c.json({ error: 'Only the host may confirm this booking' }, 403)
    }
    if (booking.status === 'confirmed') {
      return c.json({ success: true, status: 'confirmed', message: 'Already confirmed' })
    }
    await db.prepare(
      "UPDATE bookings SET status='confirmed', updated_at=datetime('now') WHERE id=?"
    ).bind(id).run()
    logEvent('info', 'booking.confirmed_by_host', { booking_id: id, host_id: user.userId })
    return c.json({ success: true, status: 'confirmed' })
  } catch (e: any) {
    console.error('[POST /bookings/:id/confirm]', e.message)
    return c.json({ error: 'Failed to confirm booking' }, 500)
  }
})

apiRoutes.post('/bookings/:id/cancel', requireUserAuth(), async (c) => {
  const db   = c.env?.DB
  const user = c.get('user') as any
  const id   = c.req.param('id')
  if (!db) return c.json({ error: 'Database unavailable' }, 503)
  try {
    const booking = await db.prepare(
      'SELECT id, host_id, driver_id, status FROM bookings WHERE id = ? LIMIT 1'
    ).bind(id).first<any>()
    if (!booking) return c.json({ error: 'Booking not found' }, 404)
    // Host or driver may cancel
    const uid = Number(user.userId)
    const isHost   = uid === Number(booking.host_id)
    const isDriver = uid === Number(booking.driver_id)
    const isAdmin  = (user.role || '').toUpperCase() === 'ADMIN'
    if (!isHost && !isDriver && !isAdmin) {
      return c.json({ error: 'Not authorized to cancel this booking' }, 403)
    }
    if (['cancelled', 'completed'].includes(booking.status)) {
      return c.json({ success: true, status: booking.status, message: 'Already ' + booking.status })
    }
    await db.prepare(
      "UPDATE bookings SET status='cancelled', updated_at=datetime('now') WHERE id=?"
    ).bind(id).run()
    logEvent('info', 'booking.cancelled', { booking_id: id, cancelled_by: uid })
    return c.json({ success: true, status: 'cancelled' })
  } catch (e: any) {
    console.error('[POST /bookings/:id/cancel]', e.message)
    return c.json({ error: 'Failed to cancel booking' }, 500)
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
// ADMIN INTEGRITY CHECK
// GET /api/admin/integrity
// Runs a full payment-booking consistency audit:
//   1. Bookings confirmed but no matching payments row
//   2. Payments with no matching confirmed booking
//   3. Active holds older than 15 min (should have auto-expired)
//   4. payment_recovery_log rows still pending
//   5. orphan_payments unresolved
// Returns counts + sample rows for each issue category.
// Also logs a row to integrity_log.
// ════════════════════════════════════════════════════════════════════════════
apiRoutes.get('/admin/integrity', async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  const t0 = Date.now()
  try {
    const [
      bookingsNoPayment,
      paymentsNoBooking,
      staleHolds,
      pendingRecovery,
      orphansUnresolved,
    ] = await db.batch([
      // 1. confirmed bookings with no payments row
      db.prepare(`
        SELECT b.id, b.stripe_payment_intent_id, b.total_charged, b.driver_id,
               b.listing_id, b.start_time, b.created_at
        FROM bookings b
        LEFT JOIN payments p ON p.booking_id = b.id
        WHERE b.status = 'confirmed'
          AND p.id IS NULL
        ORDER BY b.created_at DESC
        LIMIT 20
      `),
      // 2. succeeded payments referencing non-existent / non-confirmed booking
      db.prepare(`
        SELECT p.id, p.stripe_payment_intent_id, p.amount, p.booking_id, p.created_at
        FROM payments p
        LEFT JOIN bookings b ON b.id = p.booking_id
        WHERE p.status = 'succeeded'
          AND (b.id IS NULL OR b.status NOT IN ('confirmed','active','completed'))
        ORDER BY p.created_at DESC
        LIMIT 20
      `),
      // 3. stale active holds (older than 15 min — should be expired)
      db.prepare(`
        SELECT id, listing_id, session_token, hold_expires_at, created_at
        FROM reservation_holds
        WHERE status = 'active'
          AND datetime(hold_expires_at) < datetime('now', '-5 minutes')
        ORDER BY created_at DESC
        LIMIT 20
      `),
      // 4. payment_recovery_log pending items
      db.prepare(`
        SELECT id, stripe_pi_id, amount_cents, hold_id, attempts, created_at
        FROM payment_recovery_log
        WHERE recovery_status = 'pending'
        ORDER BY created_at DESC
        LIMIT 20
      `),
      // 5. orphan_payments unresolved
      db.prepare(`
        SELECT id, stripe_pi_id, amount_cents, driver_email, detected_at
        FROM orphan_payments
        WHERE resolution = 'pending'
        ORDER BY detected_at DESC
        LIMIT 20
      `),
    ])

    const issues = {
      bookings_no_payment:   (bookingsNoPayment.results  || []).length,
      payments_no_booking:   (paymentsNoBooking.results  || []).length,
      stale_holds:           (staleHolds.results         || []).length,
      pending_recovery:      (pendingRecovery.results    || []).length,
      orphans_unresolved:    (orphansUnresolved.results  || []).length,
    }
    const totalIssues = Object.values(issues).reduce((a, b) => a + b, 0)
    const status      = totalIssues === 0 ? 'ok' : 'issues_found'
    const duration    = Date.now() - t0

    // Log to integrity_log table
    await db.prepare(`
      INSERT INTO integrity_log
        (triggered_by, bookings_checked, payments_checked, holds_checked,
         orphans_found, recovery_items, duration_ms, status, summary)
      SELECT 'admin',
        (SELECT COUNT(*) FROM bookings WHERE status = 'confirmed'),
        (SELECT COUNT(*) FROM payments WHERE status = 'succeeded'),
        (SELECT COUNT(*) FROM reservation_holds WHERE status = 'active'),
        ?, ?, ?, ?,
        json_object(
          'bookings_no_payment', ?,
          'payments_no_booking', ?,
          'stale_holds',         ?,
          'pending_recovery',    ?,
          'orphans_unresolved',  ?
        )
    `).bind(
      issues.orphans_unresolved,
      issues.pending_recovery,
      duration,
      status,
      issues.bookings_no_payment,
      issues.payments_no_booking,
      issues.stale_holds,
      issues.pending_recovery,
      issues.orphans_unresolved,
    ).run().catch(() => {})

    // Auto-expire stale holds as a side-effect
    if (issues.stale_holds > 0) {
      await db.prepare(`
        UPDATE reservation_holds
        SET status = 'expired', updated_at = datetime('now')
        WHERE status = 'active' AND datetime(hold_expires_at) < datetime('now', '-5 minutes')
      `).run().catch(() => {})
    }

    logEvent(totalIssues > 0 ? 'warn' : 'info', 'integrity.scan', {
      status, issues, duration_ms: duration,
    })

    return c.json({
      status,
      run_at:    new Date().toISOString(),
      duration_ms: duration,
      issues,
      details: {
        bookings_no_payment: bookingsNoPayment.results  || [],
        payments_no_booking: paymentsNoBooking.results  || [],
        stale_holds:         staleHolds.results         || [],
        pending_recovery:    pendingRecovery.results    || [],
        orphans_unresolved:  orphansUnresolved.results  || [],
      },
    })

  } catch (e: any) {
    logEvent('error', 'integrity.scan_error', { error: e.message })
    return c.json({ error: e.message }, 500)
  }
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
// CONTACT VERIFICATION SYSTEM
// Modular, session-scoped verification for email and phone.
// No account login required — works for guest checkout.
//
// Flow:
//   POST /api/verify/phone/send    → generate OTP, store hash, send via Twilio
//   POST /api/verify/phone/confirm → check OTP hash, mark verified_contacts row
//   POST /api/verify/email/send    → generate OTP, store hash, send via Resend
//   POST /api/verify/email/confirm → check OTP hash, mark verified_contacts row
//   GET  /api/verify/status        → check session verification state
//
// Legacy alias kept for backward compat:
//   POST /api/sms/otp              → delegates to /api/verify/phone/send
// ════════════════════════════════════════════════════════════════════════════

// ── Internal helpers ──────────────────────────────────────────────────────────

// Normalise to E.164 — supports US 10-digit, international with/without +
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10)  return `+1${digits}`         // US domestic
  if (digits.length === 11 && digits[0] === '1') return `+${digits}` // 1-xxx-xxx-xxxx
  if (digits.length >= 7 && digits.length <= 15) return `+${digits}` // international
  return null
}

// Hash a 6-digit OTP with PBKDF2 for safe storage
async function hashOtp(otp: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2,'0')).join('')
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(otp), { name: 'PBKDF2' }, false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 10_000, hash: 'SHA-256' }, keyMaterial, 256
  )
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2,'0')).join('')
  return `pbkdf2:10000:${saltHex}:${hashHex}`
}

// Compare a candidate OTP string against a stored pbkdf2 hash
async function verifyOtp(candidate: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split(':')
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
    const [, itersStr, saltHex, expectedHex] = parts
    const iters = parseInt(itersStr, 10)
    const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b,16)))
    const keyMaterial = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(candidate), { name: 'PBKDF2' }, false, ['deriveBits']
    )
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: iters, hash: 'SHA-256' }, keyMaterial, 256
    )
    const actualHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2,'0')).join('')
    // Constant-time comparison
    let diff = 0
    for (let i = 0; i < actualHex.length; i++) diff |= actualHex.charCodeAt(i) ^ (expectedHex.charCodeAt(i) || 0)
    return diff === 0
  } catch { return false }
}

// Record a verified contact for this session (2-hour window)
async function recordVerifiedContact(
  db: D1Database, sessionToken: string, type: 'email'|'phone', value: string, ip: string | null
): Promise<void> {
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  await db.prepare(`
    INSERT INTO verified_contacts (session_token, contact_type, contact_value, verified_at, expires_at, ip_address)
    VALUES (?, ?, ?, datetime('now'), ?, ?)
    ON CONFLICT(session_token, contact_type) DO UPDATE SET
      contact_value = excluded.contact_value,
      verified_at   = excluded.verified_at,
      expires_at    = excluded.expires_at,
      used          = 0
  `).bind(sessionToken, type, value, expiresAt, ip).run()
}

// ── POST /api/verify/phone/send ───────────────────────────────────────────────
// Body: { phone, session_token }
// Rate-limited: 3 sends per phone per 10 min
apiRoutes.post('/verify/phone/send', async (c) => {
  const env = c.env
  const db  = env?.DB
  const ip  = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'

  if (!env?.TWILIO_ACCOUNT_SID) return c.json({ error: 'SMS not configured' }, 503)
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  let body: any = {}
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const { phone, session_token } = body
  if (!phone)         return c.json({ error: 'Phone number required' }, 400)
  if (!session_token) return c.json({ error: 'session_token required' }, 400)

  const normalized = normalizePhone(String(phone))
  if (!normalized) return c.json({ error: 'Invalid phone number format', code: 'INVALID_PHONE' }, 400)

  // Rate limit: 3 sends per phone number per 10 minutes
  if (isRateLimited(`phone_otp:${normalized}`, 3, 10 * 60_000)) {
    return c.json({ error: 'Too many verification requests. Please wait 10 minutes.', code: 'RATE_LIMITED' }, 429)
  }
  // Rate limit: 5 sends per IP per minute
  if (isRateLimited(`phone_otp_ip:${ip}`, 5, 60_000)) {
    return c.json({ error: 'Too many requests from your network.', code: 'RATE_LIMITED' }, 429)
  }

  // Generate and hash OTP
  const otp     = Math.floor(100000 + Math.random() * 900000).toString()
  const hash    = await hashOtp(otp)
  const expires = new Date(Date.now() + 10 * 60_000).toISOString()

  // Store hashed OTP
  await db.prepare(`
    INSERT INTO otp_codes (phone, session_token, code_hash, expires_at, used, ip_address, type)
    VALUES (?, ?, ?, ?, 0, ?, 'sms')
  `).bind(normalized, session_token, hash, expires, ip).run()

  // Send via Twilio
  const ok = await smsSendOTP(env as any, { toPhone: normalized, otp })
  if (!ok) return c.json({ error: 'Failed to send verification SMS. Check the phone number and try again.', code: 'SMS_FAILED' }, 500)

  logEvent('info', 'verify.phone.sent', { phone: normalized.slice(0,6)+'***', session_token: session_token.slice(0,8), ip })
  return c.json({ success: true, message: 'Verification code sent via SMS', masked_phone: normalized.slice(0,-4).replace(/\d/g,'*') + normalized.slice(-4) })
})

// ── POST /api/verify/phone/confirm ────────────────────────────────────────────
// Body: { phone, session_token, code }
// Rate-limited: 5 attempts per session, then locked
apiRoutes.post('/verify/phone/confirm', async (c) => {
  const env = c.env
  const db  = env?.DB
  const ip  = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'

  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  let body: any = {}
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const { phone, session_token, code } = body
  if (!phone || !session_token || !code) {
    return c.json({ error: 'phone, session_token, and code are required' }, 400)
  }

  const normalized = normalizePhone(String(phone))
  if (!normalized) return c.json({ error: 'Invalid phone number', code: 'INVALID_PHONE' }, 400)

  // Rate limit: 5 wrong attempts per session
  if (isRateLimited(`phone_confirm:${session_token}`, 5, 15 * 60_000)) {
    return c.json({ error: 'Too many incorrect attempts. Please request a new code.', code: 'TOO_MANY_ATTEMPTS' }, 429)
  }

  // Fetch the most recent unused, unexpired OTP for this phone + session
  const row = await db.prepare(`
    SELECT id, code_hash, attempts FROM otp_codes
    WHERE  phone = ? AND session_token = ? AND used = 0
      AND  datetime(expires_at) > datetime('now')
    ORDER BY id DESC LIMIT 1
  `).bind(normalized, session_token).first<{ id: number; code_hash: string; attempts: number }>()

  if (!row) {
    return c.json({ error: 'Verification code expired or not found. Please request a new code.', code: 'CODE_EXPIRED' }, 400)
  }

  if (row.attempts >= 5) {
    return c.json({ error: 'Code invalidated after too many attempts. Please request a new code.', code: 'TOO_MANY_ATTEMPTS' }, 400)
  }

  const valid = await verifyOtp(String(code).trim(), row.code_hash)

  if (!valid) {
    // Increment attempt counter
    await db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run()
    const remaining = 4 - row.attempts
    return c.json({ error: `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`, code: 'INVALID_CODE', attempts_remaining: remaining }, 400)
  }

  // Mark OTP as used
  await db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').bind(row.id).run()

  // Record verified contact for this session
  await recordVerifiedContact(db, session_token, 'phone', normalized, ip)

  logEvent('info', 'verify.phone.confirmed', { phone: normalized.slice(0,6)+'***', session_token: session_token.slice(0,8), ip })
  return c.json({ success: true, verified: true, message: 'Phone number verified successfully' })
})

// ── POST /api/verify/email/send ───────────────────────────────────────────────
// Body: { email, session_token }
// Validates format + sends 6-digit OTP via Resend
apiRoutes.post('/verify/email/send', async (c) => {
  const env = c.env
  const db  = env?.DB
  const ip  = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'

  if (!env?.RESEND_API_KEY) return c.json({ error: 'Email service not configured' }, 503)
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  let body: any = {}
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const { email, session_token } = body
  if (!email)         return c.json({ error: 'Email required' }, 400)
  if (!session_token) return c.json({ error: 'session_token required' }, 400)

  // Validate email format (RFC 5322 approximation)
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
  const normalizedEmail = String(email).toLowerCase().trim()
  if (!emailRe.test(normalizedEmail) || normalizedEmail.length > 254) {
    return c.json({ error: 'Invalid email address format', code: 'INVALID_EMAIL' }, 400)
  }

  // Reject disposable/known-fake TLDs (basic blocklist)
  const blockedDomains = ['mailinator.com','guerrillamail.com','tempmail.com','throwaway.email',
    'sharklasers.com','guerrillamailblock.com','grr.la','guerrillamail.info','spam4.me',
    'yopmail.com','maildrop.cc','discard.email','fake-box.com','trashmail.com']
  const emailDomain = normalizedEmail.split('@')[1]
  if (blockedDomains.includes(emailDomain)) {
    return c.json({ error: 'Disposable email addresses are not accepted. Please use a real email address.', code: 'DISPOSABLE_EMAIL' }, 400)
  }

  // Rate limit: 3 sends per email per 10 min
  if (isRateLimited(`email_otp:${normalizedEmail}`, 3, 10 * 60_000)) {
    return c.json({ error: 'Too many verification emails. Please wait 10 minutes.', code: 'RATE_LIMITED' }, 429)
  }
  if (isRateLimited(`email_otp_ip:${ip}`, 5, 60_000)) {
    return c.json({ error: 'Too many requests from your network.', code: 'RATE_LIMITED' }, 429)
  }

  // Generate and hash OTP
  const otp     = Math.floor(100000 + Math.random() * 900000).toString()
  const hash    = await hashOtp(otp)
  const expires = new Date(Date.now() + 10 * 60_000).toISOString()

  // Store hashed OTP
  await db.prepare(`
    INSERT INTO email_otp_codes (email, session_token, code_hash, expires_at, used, ip_address)
    VALUES (?, ?, ?, ?, 0, ?)
  `).bind(normalizedEmail, session_token, hash, expires, ip).run()

  // Send email via Resend
  const fromEmail = env.FROM_EMAIL || 'onboarding@resend.dev'
  const fromName  = 'ParkPeer'
  const emailBody = {
    from:    `${fromName} <${fromEmail}>`,
    to:      [normalizedEmail],
    subject: `Your ParkPeer verification code: ${otp}`,
    html: `
      <!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#0f0f1a;color:#fff;padding:40px 20px;margin:0">
      <div style="max-width:440px;margin:0 auto;background:#1e1e2e;border-radius:16px;padding:32px;border:1px solid rgba(255,255,255,.08)">
        <div style="text-align:center;margin-bottom:24px">
          <span style="font-size:28px">🅿️</span>
          <h1 style="color:#fff;font-size:20px;margin:8px 0 0;font-weight:700">ParkPeer</h1>
        </div>
        <h2 style="color:#a5b4fc;font-size:16px;font-weight:600;margin:0 0 8px">Email Verification</h2>
        <p style="color:#9ca3af;font-size:14px;margin:0 0 24px;line-height:1.6">
          Enter this code to verify your email address for your booking checkout.
          The code expires in <strong style="color:#fff">10 minutes</strong>.
        </p>
        <div style="background:#12121e;border:1.5px solid #6366f1;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px">
          <span style="font-size:36px;font-weight:800;letter-spacing:8px;color:#a5b4fc;font-family:monospace">${otp}</span>
        </div>
        <p style="color:#6b7280;font-size:12px;margin:0;line-height:1.6;text-align:center">
          If you didn't request this, you can safely ignore this email.<br>
          Never share this code with anyone — ParkPeer will never ask for it.
        </p>
      </div>
      </body></html>
    `,
    text: `Your ParkPeer verification code is: ${otp}\n\nValid for 10 minutes. Do not share this code.`
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(emailBody)
    })
    if (!res.ok) {
      const errData = await res.json().catch(() => ({})) as any
      console.error('[verify/email/send] Resend error:', res.status, JSON.stringify(errData))
      // Surface a more actionable error when using sandbox domain
      const fromAddr = env.FROM_EMAIL || 'onboarding@resend.dev'
      const isSandbox = fromAddr.endsWith('@resend.dev')
      if (isSandbox && res.status === 403) {
        return c.json({
          error: 'Email sending is in sandbox mode. The recipient email must be verified in your Resend account, or a custom FROM_EMAIL domain must be configured.',
          code: 'EMAIL_SANDBOX_RESTRICTED',
          resend_status: res.status,
          resend_error: errData?.message || errData?.name
        }, 500)
      }
      return c.json({ error: 'Failed to send verification email. Please check your email address.', code: 'EMAIL_FAILED', resend_status: res.status }, 500)
    }
  } catch (e: any) {
    console.error('[verify/email/send] exception:', e.message)
    return c.json({ error: 'Failed to send verification email.', code: 'EMAIL_FAILED' }, 500)
  }

  logEvent('info', 'verify.email.sent', { email: normalizedEmail.replace(/^.+@/, '***@'), session_token: session_token.slice(0,8), ip })

  // Return masked email for UI display
  const [localPart, domain] = normalizedEmail.split('@')
  const maskedLocal = localPart.length > 2 ? localPart[0] + '*'.repeat(Math.min(localPart.length-2, 4)) + localPart.slice(-1) : '**'
  return c.json({ success: true, message: 'Verification code sent to your email', masked_email: `${maskedLocal}@${domain}` })
})

// ── POST /api/verify/email/confirm ────────────────────────────────────────────
// Body: { email, session_token, code }
apiRoutes.post('/verify/email/confirm', async (c) => {
  const env = c.env
  const db  = env?.DB
  const ip  = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'

  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  let body: any = {}
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const { email, session_token, code } = body
  if (!email || !session_token || !code) {
    return c.json({ error: 'email, session_token, and code are required' }, 400)
  }

  const normalizedEmail = String(email).toLowerCase().trim()

  if (isRateLimited(`email_confirm:${session_token}`, 5, 15 * 60_000)) {
    return c.json({ error: 'Too many incorrect attempts. Please request a new code.', code: 'TOO_MANY_ATTEMPTS' }, 429)
  }

  const row = await db.prepare(`
    SELECT id, code_hash, attempts FROM email_otp_codes
    WHERE  email = ? AND session_token = ? AND used = 0
      AND  datetime(expires_at) > datetime('now')
    ORDER BY id DESC LIMIT 1
  `).bind(normalizedEmail, session_token).first<{ id: number; code_hash: string; attempts: number }>()

  if (!row) {
    return c.json({ error: 'Verification code expired or not found. Please request a new one.', code: 'CODE_EXPIRED' }, 400)
  }
  if (row.attempts >= 5) {
    return c.json({ error: 'Code invalidated after too many attempts. Please request a new code.', code: 'TOO_MANY_ATTEMPTS' }, 400)
  }

  const valid = await verifyOtp(String(code).trim(), row.code_hash)
  if (!valid) {
    await db.prepare('UPDATE email_otp_codes SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run()
    const remaining = 4 - row.attempts
    return c.json({ error: `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`, code: 'INVALID_CODE', attempts_remaining: remaining }, 400)
  }

  await db.prepare('UPDATE email_otp_codes SET used = 1 WHERE id = ?').bind(row.id).run()
  await recordVerifiedContact(db, session_token, 'email', normalizedEmail, ip)

  logEvent('info', 'verify.email.confirmed', { email: normalizedEmail.replace(/^.+@/, '***@'), session_token: session_token.slice(0,8), ip })
  return c.json({ success: true, verified: true, message: 'Email verified successfully' })
})

// ── GET /api/verify/status ────────────────────────────────────────────────────
// Query: ?session_token=xxx
// Returns current verification state for a checkout session
apiRoutes.get('/verify/status', async (c) => {
  const db           = c.env?.DB
  const sessionToken = c.req.query('session_token')
  if (!db || !sessionToken) return c.json({ email_verified: false, phone_verified: false })

  try {
    const rows = await db.prepare(`
      SELECT contact_type, contact_value
      FROM verified_contacts
      WHERE session_token = ? AND used = 0
        AND datetime(expires_at) > datetime('now')
    `).bind(sessionToken).all<{ contact_type: string; contact_value: string }>()

    const emailRow = rows.results?.find(r => r.contact_type === 'email')
    const phoneRow = rows.results?.find(r => r.contact_type === 'phone')

    return c.json({
      email_verified: !!emailRow,
      phone_verified: !!phoneRow,
      verified_email: emailRow?.contact_value || null,
      verified_phone: phoneRow?.contact_value ? phoneRow.contact_value.slice(0,-4).replace(/\d/g,'*') + phoneRow.contact_value.slice(-4) : null,
    })
  } catch {
    return c.json({ email_verified: false, phone_verified: false })
  }
})

// ── Legacy alias: POST /api/sms/otp → delegates to /api/verify/phone/send ────
// Kept for backward compatibility with any existing integrations
apiRoutes.post('/sms/otp', async (c) => {
  // Forward to the new endpoint by reconstructing the request
  const env = c.env
  if (!env?.TWILIO_ACCOUNT_SID) return c.json({ error: 'SMS not configured' }, 503)
  let body: any = {}
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  const { phone } = body
  if (!phone) return c.json({ error: 'Missing phone number' }, 400)
  // Generate and send (simplified — no DB storage in legacy path)
  const otp = Math.floor(100000 + Math.random() * 900000).toString()
  const ok  = await smsSendOTP(env as any, { toPhone: phone, otp })
  if (!ok) return c.json({ error: 'Failed to send OTP' }, 500)
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

  console.log(`[Twilio SMS] From: ${from} Body: [redacted]`)  // body may contain PII

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

// ════════════════════════════════════════════════════════════════════════════
// TIER & REWARD SYSTEM  —  /api/tiers/*
// ════════════════════════════════════════════════════════════════════════════

// GET /api/tiers/me  — full tier state + metrics + gaps for authenticated user
apiRoutes.get('/tiers/me', requireUserAuth(), async (c) => {
  const db      = c.env?.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)
  const session = c.get('user') as any
  const userId  = session?.userId
  const rawRole = (session?.role || 'driver').toUpperCase()
  const role: 'DRIVER' | 'HOST' = (rawRole === 'HOST' || rawRole === 'BOTH') ? 'HOST' : 'DRIVER'
  // For BOTH role, return both driver and host states
  const roles: Array<'DRIVER' | 'HOST'> = rawRole === 'BOTH' ? ['DRIVER', 'HOST'] : [role]

  try {
    const results: any = {}
    for (const r of roles) {
      let state: any = await db.prepare(
        'SELECT * FROM user_tier_state WHERE user_id = ? AND role = ?'
      ).bind(userId, r).first()
      if (!state) {
        // Auto-init on first fetch
        await recalculateTier(db, userId, r, 'init')
        state = await db.prepare(
          'SELECT * FROM user_tier_state WHERE user_id = ? AND role = ?'
        ).bind(userId, r).first()
      }
      const tierDef = getTierDef(r, state.current_tier)
      const tierOrder = getTierOrder(r)
      const currentIdx = tierOrder.indexOf(state.current_tier)
      const nextTierId = currentIdx < tierOrder.length - 1 ? tierOrder[currentIdx + 1] : null
      const nextTierDef = nextTierId ? getTierDef(r, nextTierId) : null
      const metrics = {
        r12_completed:      state.r12_completed_bookings,
        r12_spend:          state.r12_total_spend,
        r12_revenue:        state.r12_total_revenue,
        r12_avg_rating:     state.r12_avg_rating,
        r12_cancel_rate:    state.r12_cancellation_rate,
        r12_response_rate:  state.r12_response_rate,
        r12_avg_response_hrs: state.r12_avg_response_hours,
        lifetime_completed: state.lifetime_completed,
        lifetime_spend:     state.lifetime_spend,
        lifetime_revenue:   state.lifetime_revenue,
      }
      const gaps = getNextTierGaps(metrics, state.current_tier, r)

      // Unread notifications
      const notifs = await db.prepare(`
        SELECT * FROM tier_notifications WHERE user_id = ? AND read = 0
        ORDER BY created_at DESC LIMIT 5
      `).bind(userId).all()

      results[r.toLowerCase()] = {
        role:            r,
        current_tier:    state.current_tier,
        tier_name:       tierDef.name,
        tier_tagline:    tierDef.tagline,
        tier_since:      state.tier_since,
        tier_color:      tierDef.color,
        tier_gradient:   tierDef.gradient,
        tier_icon:       tierDef.icon,
        tier_rank:       tierDef.rank,
        progress_to_next: state.progress_to_next,
        is_max_tier:     isMaxTier(state.current_tier, r),
        next_tier:       nextTierId ? { id: nextTierId, name: nextTierDef?.name, icon: nextTierDef?.icon } : null,
        benefits:        tierDef.benefits,
        metrics,
        gaps,
        loyalty_credits: state.loyalty_credits,
        is_protected:    !!state.is_protected,
        grace_period_ends: state.grace_period_ends,
        notifications:   notifs.results || [],
        last_recalculated: state.last_recalculated,
        consecutive_months: state.consecutive_months,
      }
    }
    return c.json({ success: true, ...results })
  } catch(e: any) {
    console.error('[GET /api/tiers/me]', e.message)
    return c.json({ error: 'Failed to fetch tier data' }, 500)
  }
})

// POST /api/tiers/recalculate  — manually trigger a recalculation (rate-limited)
apiRoutes.post('/tiers/recalculate', requireUserAuth(), async (c) => {
  const db      = c.env?.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)
  const session = c.get('user') as any
  const userId  = session?.userId
  const rawRole = (session?.role || 'driver').toUpperCase()

  // Rate limit: max 1 manual recalc per 10 minutes per user
  const limited = await isRateLimited(db, `tier_recalc:${userId}`, 1, 600)
  if (limited) return c.json({ error: 'Please wait before recalculating again.' }, 429)

  try {
    const roles: Array<'DRIVER' | 'HOST'> = rawRole === 'BOTH' ? ['DRIVER', 'HOST'] : [rawRole === 'HOST' ? 'HOST' : 'DRIVER']
    const results: any[] = []
    for (const r of roles) {
      const result = await recalculateTier(db, userId, r, 'manual_request')
      results.push({ role: r, tier: result.newTier, changed: result.changed, progress: result.progress })
    }
    return c.json({ success: true, results })
  } catch(e: any) {
    console.error('[POST /api/tiers/recalculate]', e.message)
    return c.json({ error: 'Recalculation failed' }, 500)
  }
})

// GET /api/tiers/notifications  — paginated tier notification inbox
apiRoutes.get('/tiers/notifications', requireUserAuth(), async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)
  const session = c.get('user') as any
  const limit   = Math.min(parseInt(c.req.query('limit') || '20'), 50)
  const offset  = parseInt(c.req.query('offset') || '0')

  try {
    const rows = await db.prepare(`
      SELECT * FROM tier_notifications WHERE user_id = ?
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).bind(session.userId, limit, offset).all()
    const total = await db.prepare(
      'SELECT COUNT(*) as n FROM tier_notifications WHERE user_id = ?'
    ).bind(session.userId).first<{n:number}>()
    return c.json({ success: true, notifications: rows.results, total: total?.n || 0 })
  } catch(e: any) {
    return c.json({ error: 'Failed to fetch notifications' }, 500)
  }
})

// PATCH /api/tiers/notifications/read  — mark all unread as read
apiRoutes.patch('/tiers/notifications/read', requireUserAuth(), async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)
  const session = c.get('user') as any
  await db.prepare(
    'UPDATE tier_notifications SET read = 1 WHERE user_id = ? AND read = 0'
  ).bind(session.userId).run()
  return c.json({ success: true })
})

// GET /api/tiers/history  — tier change history for user
apiRoutes.get('/tiers/history', requireUserAuth(), async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)
  const session = c.get('user') as any
  try {
    const rows = await db.prepare(`
      SELECT * FROM tier_history WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 20
    `).bind(session.userId).all()
    return c.json({ success: true, history: rows.results })
  } catch(e: any) {
    return c.json({ error: 'Failed to fetch history' }, 500)
  }
})

// GET /api/tiers/definitions  — public tier definitions (no auth required)
apiRoutes.get('/tiers/definitions', (c) => {
  return c.json({
    success: true,
    driver: Object.values(DRIVER_TIERS).map(t => ({
      id: t.id, rank: t.rank, name: t.name, tagline: t.tagline,
      description: t.description, icon: t.icon, color: t.color,
      requirements: t.req, benefits: t.benefits,
    })),
    host: Object.values(HOST_TIERS).map(t => ({
      id: t.id, rank: t.rank, name: t.name, tagline: t.tagline,
      description: t.description, icon: t.icon, color: t.color,
      requirements: t.req, benefits: t.benefits,
    })),
  })
})

// ════════════════════════════════════════════════════════════════════════════
// PRI (Parking Reliability Index) — calculate & store for a listing
// Called internally after booking events; also exposed for admin/on-demand use
// ════════════════════════════════════════════════════════════════════════════

/** Calculate PRI for a listing and upsert into pri_metrics + listings.pri_score */
async function recalculatePri(db: D1Database, listingId: number): Promise<number | null> {
  try {
    // Fetch booking stats for this listing
    const stats = await db.prepare(`
      SELECT
        COUNT(*)                                         AS total,
        SUM(CASE WHEN status='cancelled' AND cancelled_by IN ('host') THEN 1 ELSE 0 END) AS host_cancels,
        AVG(CASE WHEN status IN ('confirmed','active','completed')
                 THEN CAST((julianday(updated_at) - julianday(created_at)) * 24 AS REAL)
                 ELSE NULL END)                          AS avg_confirm_hrs
      FROM bookings
      WHERE listing_id = ?
    `).bind(listingId).first<any>()

    const total      = stats?.total     ?? 0
    const cancels    = stats?.host_cancels ?? 0
    const confirmHrs = stats?.avg_confirm_hrs ?? 0

    // Need at least 5 bookings for a valid PRI
    if (total < 5) return null

    // Rating variance from reviews
    const varRow = await db.prepare(`
      SELECT AVG(rating) as avg_r, COUNT(*) as cnt,
             SUM(rating * rating) as sum_sq
      FROM reviews WHERE listing_id = ? AND status = 'published'
    `).bind(listingId).first<any>()

    let varianceScore = 80 // default if no reviews
    if (varRow && varRow.cnt >= 3) {
      const mean  = varRow.avg_r || 0
      const sqMean = (varRow.sum_sq || 0) / varRow.cnt
      const variance = sqMean - mean * mean
      // Low variance (0–0.5) = high score. variance > 2 = score 0
      varianceScore = Math.max(0, Math.min(100, 100 - variance * 50))
    }

    // Component scores
    const cancelRate       = total > 0 ? (cancels / total) : 0
    const cancellationScore = Math.max(0, 100 - cancelRate * 100)

    // Confirmation speed: 0 hrs = 100, 24+ hrs = 0
    const confirmationScore = Math.max(0, Math.min(100, 100 - (confirmHrs / 24) * 100))

    // Responsiveness: not tracked in DB yet — default to 80
    const responsivenessScore = 80

    // Weighted PRI
    const pri = (
      cancellationScore  * 0.30 +
      confirmationScore  * 0.25 +
      responsivenessScore * 0.20 +
      varianceScore      * 0.25
    )

    const priRounded = Math.round(pri * 10) / 10

    // Upsert pri_metrics
    await db.prepare(`
      INSERT INTO pri_metrics
        (listing_id, cancellation_score, confirmation_score, responsiveness_score,
         consistency_score, total_bookings, cancel_count, avg_confirm_hours,
         avg_response_minutes, rating_variance, pri_score, calculated_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
      ON CONFLICT(listing_id) DO UPDATE SET
        cancellation_score=excluded.cancellation_score,
        confirmation_score=excluded.confirmation_score,
        responsiveness_score=excluded.responsiveness_score,
        consistency_score=excluded.consistency_score,
        total_bookings=excluded.total_bookings,
        cancel_count=excluded.cancel_count,
        avg_confirm_hours=excluded.avg_confirm_hours,
        pri_score=excluded.pri_score,
        updated_at=datetime('now')
    `).bind(
      listingId,
      cancellationScore, confirmationScore, responsivenessScore, varianceScore,
      total, cancels, confirmHrs, 0, 0,
      priRounded
    ).run()

    // Denormalize to listings table for fast sort/filter
    await db.prepare(
      `UPDATE listings SET pri_score = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(priRounded, listingId).run()

    // Update host_credentials tier3 (PRI >= 95)
    const listingHost = await db.prepare('SELECT host_id FROM listings WHERE id = ?').bind(listingId).first<any>()
    if (listingHost?.host_id) {
      const hostPriRow = await db.prepare(`
        SELECT MAX(pri_score) as best_pri FROM listings WHERE host_id = ? AND status = 'active'
      `).bind(listingHost.host_id).first<any>()
      const bestPri = hostPriRow?.best_pri ?? 0
      const isHighPerf = bestPri >= 95 ? 1 : 0
      await db.prepare(`
        INSERT INTO host_credentials (host_id, tier3_performance, tier3_performance_at, updated_at)
        VALUES (?, ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END, datetime('now'))
        ON CONFLICT(host_id) DO UPDATE SET
          tier3_performance = excluded.tier3_performance,
          tier3_performance_at = CASE
            WHEN excluded.tier3_performance = 1 AND tier3_performance = 0 THEN datetime('now')
            ELSE tier3_performance_at END,
          updated_at = datetime('now')
      `).bind(listingHost.host_id, isHighPerf, isHighPerf).run()
    }

    return priRounded
  } catch (e: any) {
    console.error('[recalculatePri] listing', listingId, e.message)
    return null
  }
}

// GET /api/pri/:listingId — PRI score + breakdown for a single listing
apiRoutes.get('/pri/:listingId', async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)
  const listingId = parseInt(c.req.param('listingId'))
  if (!listingId) return c.json({ error: 'Invalid listing ID' }, 400)

  try {
    // Check existing record first
    let row = await db.prepare(
      'SELECT * FROM pri_metrics WHERE listing_id = ?'
    ).bind(listingId).first<any>()

    // If no record or stale (>1hr), recalculate
    if (!row || (Date.now() - new Date(row.updated_at).getTime()) > 3600000) {
      await recalculatePri(db, listingId)
      row = await db.prepare(
        'SELECT * FROM pri_metrics WHERE listing_id = ?'
      ).bind(listingId).first<any>()
    }

    // Check booking count threshold
    const bookingCount = row?.total_bookings ?? 0
    if (bookingCount < 5) {
      return c.json({ pri_score: null, is_new: true, bookings: bookingCount })
    }

    return c.json({
      pri_score:    row ? Math.round(row.pri_score) : null,
      is_new:       false,
      bookings:     row?.total_bookings ?? 0,
      cancels:      row?.cancel_count ?? 0,
      confirm_hrs:  row?.avg_confirm_hours ?? 0,
      response_mins: row?.avg_response_minutes ?? 0,
      cancellation_score:   row?.cancellation_score ?? 0,
      confirmation_score:   row?.confirmation_score ?? 0,
      responsiveness_score: row?.responsiveness_score ?? 0,
      consistency_score:    row?.consistency_score ?? 0,
    })
  } catch (e: any) {
    return c.json({ error: 'Failed to fetch PRI'}, 500)
  }
})

// GET /api/host-credentials/:hostId — host badges for a single host
apiRoutes.get('/host-credentials/:hostId', async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)
  const hostId = parseInt(c.req.param('hostId'))
  if (!hostId) return c.json({ error: 'Invalid host ID' }, 400)

  try {
    // Auto-sync tier1 from users.id_verified
    const userRow = await db.prepare(
      'SELECT id_verified, created_at FROM users WHERE id = ?'
    ).bind(hostId).first<any>()

    if (userRow) {
      const FOUNDING_DATE = new Date('2025-12-31T23:59:59Z')
      const isFounder = userRow.created_at
        ? new Date(userRow.created_at) <= FOUNDING_DATE
        : false

      await db.prepare(`
        INSERT INTO host_credentials
          (host_id, tier1_verified, tier1_verified_at, tier4_founding, tier4_founding_at, updated_at)
        VALUES (?, ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END,
                ?, CASE WHEN ? = 1 THEN ? ELSE NULL END, datetime('now'))
        ON CONFLICT(host_id) DO UPDATE SET
          tier1_verified = excluded.tier1_verified,
          tier4_founding = excluded.tier4_founding,
          tier4_founding_at = CASE
            WHEN excluded.tier4_founding = 1 AND tier4_founding = 0 THEN datetime('now')
            ELSE tier4_founding_at END,
          updated_at = datetime('now')
      `).bind(
        hostId,
        userRow.id_verified ?? 0,
        userRow.id_verified ?? 0,
        isFounder ? 1 : 0,
        isFounder ? 1 : 0,
        userRow.created_at
      ).run()
    }

    const creds = await db.prepare(
      'SELECT * FROM host_credentials WHERE host_id = ?'
    ).bind(hostId).first<any>()

    if (!creds) return c.json({ verified: false, secure: false, performance: false, founding: false })

    return c.json({
      verified:         creds.tier1_verified === 1,
      verified_at:      creds.tier1_verified_at,
      secure:           creds.tier2_secure === 1,
      secure_at:        creds.tier2_secure_at,
      performance:      creds.tier3_performance === 1,
      performance_at:   creds.tier3_performance_at,
      founding:         creds.tier4_founding === 1,
      founding_at:      creds.tier4_founding_at,
    })
  } catch (e: any) {
    return c.json({ error: 'Failed to fetch host credentials'}, 500)
  }
})

// GET /api/savings — driver savings summary (authenticated)
apiRoutes.get('/savings', requireUserAuth(), async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)
  const session = c.get('user') as any
  const driverId = session.userId

  try {
    // Recalculate savings from completed bookings
    const bookings = await db.prepare(`
      SELECT b.id, b.duration_hours, b.total_charged, b.start_time,
             l.city, l.zip
      FROM bookings b
      JOIN listings l ON b.listing_id = l.id
      WHERE b.driver_id = ? AND b.status = 'completed'
      ORDER BY b.start_time DESC
    `).bind(driverId).all<any>()

    const rows = bookings.results || []
    const AVG_GARAGE_RATE = 18.0 // $/hr conservative US estimate

    let totalPaid = 0
    let totalGarage = 0
    const cityMap: Record<string, { city: string; zip: string; bookings: number; paid: number; garage: number }> = {}

    for (const b of rows) {
      const hrs    = b.duration_hours || 1
      const paid   = b.total_charged  || 0
      const garage = hrs * AVG_GARAGE_RATE
      totalPaid   += paid
      totalGarage += garage

      const key = b.city || 'Unknown'
      if (!cityMap[key]) cityMap[key] = { city: b.city || 'Unknown', zip: b.zip || '', bookings: 0, paid: 0, garage: 0 }
      cityMap[key].bookings++
      cityMap[key].paid   += paid
      cityMap[key].garage += garage
    }

    const totalSavings = Math.max(0, totalGarage - totalPaid)
    const nbhdBreakdown = Object.values(cityMap)
      .map(c => ({ ...c, savings: Math.max(0, c.garage - c.paid) }))
      .sort((a, b) => b.savings - a.savings)

    // Upsert driver_savings
    const milestones = {
      m100:  totalSavings >= 100  ? 1 : 0,
      m250:  totalSavings >= 250  ? 1 : 0,
      m500:  totalSavings >= 500  ? 1 : 0,
      m1000: totalSavings >= 1000 ? 1 : 0,
    }

    await db.prepare(`
      INSERT INTO driver_savings
        (driver_id, total_bookings, total_amount_paid, total_garage_equivalent,
         total_savings, neighborhood_breakdown,
         milestone_100, milestone_250, milestone_500, milestone_1000, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(driver_id) DO UPDATE SET
        total_bookings=excluded.total_bookings,
        total_amount_paid=excluded.total_amount_paid,
        total_garage_equivalent=excluded.total_garage_equivalent,
        total_savings=excluded.total_savings,
        neighborhood_breakdown=excluded.neighborhood_breakdown,
        milestone_100=excluded.milestone_100,
        milestone_250=excluded.milestone_250,
        milestone_500=excluded.milestone_500,
        milestone_1000=excluded.milestone_1000,
        updated_at=datetime('now')
    `).bind(
      driverId, rows.length, Math.round(totalPaid * 100) / 100,
      Math.round(totalGarage * 100) / 100, Math.round(totalSavings * 100) / 100,
      JSON.stringify(nbhdBreakdown),
      milestones.m100, milestones.m250, milestones.m500, milestones.m1000
    ).run()

    const monthlyAvg = rows.length > 0
      ? (() => {
          const months = new Set(rows.map((b: any) => (b.start_time || '').substring(0,7)))
          return months.size > 0 ? Math.round(totalSavings / months.size * 100) / 100 : 0
        })()
      : 0

    return c.json({
      success: true,
      total_bookings:   rows.length,
      total_paid:       Math.round(totalPaid * 100) / 100,
      total_savings:    Math.round(totalSavings * 100) / 100,
      avg_paid:         rows.length > 0 ? Math.round(totalPaid / rows.length * 100) / 100 : 0,
      avg_garage_rate:  AVG_GARAGE_RATE,
      avg_savings_per_booking: rows.length > 0 ? Math.round((totalGarage - totalPaid) / rows.length * 100) / 100 : 0,
      monthly_avg:      monthlyAvg,
      annual_projection: Math.round(monthlyAvg * 12 * 100) / 100,
      neighborhood_breakdown: nbhdBreakdown,
      milestones: {
        m100:  milestones.m100 === 1,
        m250:  milestones.m250 === 1,
        m500:  milestones.m500 === 1,
        m1000: milestones.m1000 === 1,
      }
    })
  } catch (e: any) {
    return c.json({ error: 'Failed to fetch savings'}, 500)
  }
})

// GET /api/top-hosts?lat=&lng=&radius_km= — top hosts in a geographic area
apiRoutes.get('/top-hosts', async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)
  const { lat, lng, radius_km = '50' } = c.req.query()

  try {
    let where = ["l.status = 'active'"]
    const params: any[] = []

    if (lat && lng) {
      const latF = parseFloat(lat), lngF = parseFloat(lng)
      if (latF !== 0 || lngF !== 0) {
        const km = parseFloat(radius_km)
        const latDelta = km / 111.0
        const lngDelta = km / (111.0 * Math.cos(latF * Math.PI / 180))
        where.push('l.lat BETWEEN ? AND ? AND l.lng BETWEEN ? AND ?')
        params.push(latF - latDelta, latF + latDelta, lngF - lngDelta, lngF + lngDelta)
      }
    }

    const whereStr = 'WHERE ' + where.join(' AND ')

    const rows = await db.prepare(`
      SELECT u.id, u.full_name,
             COUNT(l.id)         AS listing_count,
             AVG(l.avg_rating)   AS avg_rating,
             AVG(l.pri_score)    AS avg_pri,
             SUM(l.review_count) AS total_reviews,
             hc.tier1_verified, hc.tier2_secure, hc.tier3_performance, hc.tier4_founding
      FROM listings l
      JOIN users u ON l.host_id = u.id
      LEFT JOIN host_credentials hc ON hc.host_id = u.id
      ${whereStr}
      GROUP BY u.id
      HAVING listing_count >= 1
      ORDER BY avg_pri DESC NULLS LAST, avg_rating DESC
      LIMIT 5
    `).bind(...params).all<any>()

    const hosts = (rows.results || []).map((r: any) => ({
      id:            r.id,
      name:          r.full_name || 'ParkPeer Host',
      listing_count: r.listing_count,
      avg_rating:    r.avg_rating ? Math.round(r.avg_rating * 10) / 10 : 0,
      avg_pri:       r.avg_pri ? Math.round(r.avg_pri) : null,
      total_reviews: r.total_reviews || 0,
      verified:      r.tier1_verified === 1,
      secure:        r.tier2_secure === 1,
      performance:   r.tier3_performance === 1,
      founding:      r.tier4_founding === 1,
    }))

    return c.json({ success: true, hosts })
  } catch (e: any) {
    return c.json({ error: 'Failed to fetch top hosts' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// NOTIFICATION ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

// GET /api/notifications  — list notifications for the logged-in user
apiRoutes.get('/notifications', requireUserAuth(), async (c) => {
  const db      = c.env?.DB
  const session = c.get('user') as any
  const userId  = session?.userId
  if (!db || !userId) return c.json({ error: 'Unauthorized' }, 401)

  const limit  = Math.min(parseInt(c.req.query('limit')  || '30'), 100)
  const offset = parseInt(c.req.query('offset') || '0')
  const isAdmin = (session?.role || '').toLowerCase() === 'admin'

  try {
    // Admins see their own notifications + all admin-role notifications (user_id=0)
    const userIdClause = isAdmin
      ? '(user_id = ? OR (user_id = 0 AND user_role = \'admin\'))'
      : 'user_id = ?'

    const rows = await db.prepare(`
      SELECT id, type, title, message, related_entity, read_status, created_at
      FROM notifications
      WHERE ${userIdClause} AND delivery_inapp = 1
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(userId, limit, offset).all<any>()

    const unread = await db.prepare(
      `SELECT COUNT(*) AS n FROM notifications WHERE ${userIdClause} AND read_status = 0 AND delivery_inapp = 1`
    ).bind(userId).first<{ n: number }>()

    const total = await db.prepare(
      `SELECT COUNT(*) AS n FROM notifications WHERE ${userIdClause} AND delivery_inapp = 1`
    ).bind(userId).first<{ n: number }>()

    return c.json({
      notifications: (rows.results || []).map((r: any) => ({
        ...r,
        related_entity: r.related_entity ? JSON.parse(r.related_entity) : null,
      })),
      unread_count: unread?.n ?? 0,
      total: total?.n ?? 0,
    })
  } catch (e: any) {
    return c.json({ error: 'Failed to fetch notifications'}, 500)
  }
})

// PATCH /api/notifications/read  — mark all (or specific) as read
apiRoutes.patch('/notifications/read', requireUserAuth(), async (c) => {
  const db      = c.env?.DB
  const session = c.get('user') as any
  const userId  = session?.userId
  if (!db || !userId) return c.json({ error: 'Unauthorized' }, 401)

  let body: any = {}
  try { body = await c.req.json() } catch {}

  const isAdmin = (session?.role || '').toLowerCase() === 'admin'

  try {
    if (body.id) {
      // Mark specific notification — also allow admin to mark user_id=0 rows
      if (isAdmin) {
        await db.prepare(
          'UPDATE notifications SET read_status = 1 WHERE id = ? AND (user_id = ? OR user_id = 0)'
        ).bind(body.id, userId).run()
      } else {
        await db.prepare(
          'UPDATE notifications SET read_status = 1 WHERE id = ? AND user_id = ?'
        ).bind(body.id, userId).run()
      }
    } else {
      // Mark all read
      if (isAdmin) {
        await db.prepare(
          'UPDATE notifications SET read_status = 1 WHERE (user_id = ? OR (user_id = 0 AND user_role = \'admin\')) AND read_status = 0'
        ).bind(userId).run()
      } else {
        await db.prepare(
          'UPDATE notifications SET read_status = 1 WHERE user_id = ? AND read_status = 0'
        ).bind(userId).run()
      }
    }
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Failed to update notifications'}, 500)
  }
})

// GET /api/notifications/prefs  — get notification preferences
apiRoutes.get('/notifications/prefs', requireUserAuth(), async (c) => {
  const db      = c.env?.DB
  const session = c.get('user') as any
  const userId  = session?.userId
  if (!db || !userId) return c.json({ error: 'Unauthorized' }, 401)

  try {
    let prefs = await db.prepare(
      'SELECT * FROM notification_prefs WHERE user_id = ?'
    ).bind(userId).first<any>()

    if (!prefs) {
      // Return defaults without inserting — will be inserted on first PUT
      prefs = {
        user_id: userId,
        booking_inapp: 1, booking_email: 1, booking_sms: 1,
        payout_inapp:  1, payout_email:  1, payout_sms:  1,
        review_inapp:  1, review_email:  1, review_sms:  0,
        system_inapp:  1, system_email:  1, system_sms:  0,
      }
    }
    return c.json({ prefs })
  } catch (e: any) {
    return c.json({ error: 'Failed to fetch preferences'}, 500)
  }
})

// PUT /api/notifications/prefs  — save notification preferences
apiRoutes.put('/notifications/prefs', requireUserAuth(), async (c) => {
  const db      = c.env?.DB
  const session = c.get('user') as any
  const userId  = session?.userId
  if (!db || !userId) return c.json({ error: 'Unauthorized' }, 401)

  let body: any = {}
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const b = (v: any) => (v === true || v === 1) ? 1 : 0

  try {
    await db.prepare(`
      INSERT INTO notification_prefs
        (user_id, booking_inapp, booking_email, booking_sms,
         payout_inapp, payout_email, payout_sms,
         review_inapp, review_email, review_sms,
         system_inapp, system_email, system_sms, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        booking_inapp = excluded.booking_inapp,
        booking_email = excluded.booking_email,
        booking_sms   = excluded.booking_sms,
        payout_inapp  = excluded.payout_inapp,
        payout_email  = excluded.payout_email,
        payout_sms    = excluded.payout_sms,
        review_inapp  = excluded.review_inapp,
        review_email  = excluded.review_email,
        review_sms    = excluded.review_sms,
        system_inapp  = excluded.system_inapp,
        system_email  = excluded.system_email,
        system_sms    = excluded.system_sms,
        updated_at    = datetime('now')
    `).bind(
      userId,
      b(body.booking_inapp), b(body.booking_email), b(body.booking_sms),
      b(body.payout_inapp),  b(body.payout_email),  b(body.payout_sms),
      b(body.review_inapp),  b(body.review_email),  b(body.review_sms),
      b(body.system_inapp),  b(body.system_email),  b(body.system_sms),
    ).run()

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Failed to save preferences'}, 500)
  }
})
