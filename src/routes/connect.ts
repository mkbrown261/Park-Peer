/**
 * ParkPeer — Host Cash-Out System (Stripe Connect)
 * ─────────────────────────────────────────────────────────────────────────────
 * All routes mounted at /api/connect/*
 *
 * Endpoints:
 *   POST /api/connect/onboard           — create/resume Connect Express onboarding
 *   GET  /api/connect/status            — account status + onboarding completeness
 *   GET  /api/connect/balance           — available + pending balance
 *   GET  /api/connect/earnings          — platform-side earnings breakdown
 *   POST /api/connect/payout            — request a manual cash-out
 *   GET  /api/connect/payouts           — payout history
 *   GET  /api/connect/dashboard-link    — Stripe Express Dashboard (one-time URL)
 *   POST /api/connect/schedule          — set automatic payout schedule
 *   GET  /api/connect/schedule          — get current payout schedule
 *   POST /api/connect/payout/:id/cancel — cancel a pending payout
 *
 * Security:
 *   - All routes require a valid user JWT (requireUserAuth)
 *   - Rate-limited per IP
 *   - Payout requests require explicit confirmation flag (2-step UX)
 *   - All actions logged to stripe_connect_events
 */

import { Hono } from 'hono'
import { requireUserAuth } from '../middleware/security'
import {
  createConnectAccount,
  createAccountLink,
  getConnectAccount,
  getConnectBalance,
  createConnectPayout,
  listConnectPayouts,
  createLoginLink,
  updatePayoutSchedule,
  getConnectPayout,
  cancelConnectPayout,
} from '../services/stripe'

type Bindings = {
  DB: D1Database
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  USER_TOKEN_SECRET: string
  ENCRYPTION_SECRET: string
  [key: string]: any
}

export const connectRoutes = new Hono<{ Bindings: Bindings }>()

// ── Rate limiter (shared with api.ts pattern) ─────────────────────────────────
const rlMap = new Map<string, { count: number; resetAt: number }>()
function rl(key: string, max: number, windowMs: number): boolean {
  const now  = Date.now()
  const rec  = rlMap.get(key)
  if (!rec || now > rec.resetAt) { rlMap.set(key, { count: 1, resetAt: now + windowMs }); return false }
  if (rec.count >= max) return true
  rec.count++
  return false
}

// ── Helper: resolve host's connect account from DB ────────────────────────────
async function getHostConnectAccount(
  db: D1Database,
  userId: number
): Promise<{ stripe_account_id: string; onboarding_status: string; payouts_enabled: number } | null> {
  return db.prepare(`
    SELECT stripe_account_id, onboarding_status, payouts_enabled
    FROM stripe_connect_accounts
    WHERE user_id = ? LIMIT 1
  `).bind(userId).first<any>().catch(() => null)
}

// ── Helper: log a connect event ───────────────────────────────────────────────
async function logConnectEvent(
  db: D1Database,
  opts: {
    eventId?:    string
    eventType:   string
    accountId?:  string
    payoutId?:   string
    hostId?:     number
    payload:     object
    processed?:  boolean
    error?:      string
  }
): Promise<void> {
  try {
    await db.prepare(`
      INSERT OR IGNORE INTO stripe_connect_events
        (stripe_event_id, event_type, connected_account_id, stripe_payout_id,
         host_id, payload_json, processed, error_detail, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      opts.eventId    || `internal-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      opts.eventType,
      opts.accountId  || null,
      opts.payoutId   || null,
      opts.hostId     || null,
      JSON.stringify(opts.payload),
      opts.processed  ? 1 : 0,
      opts.error      || null,
    ).run()
  } catch { /* non-fatal */ }
}

// ════════════════════════════════════════════════════════════════════════════
// POST /api/connect/onboard
// Creates (or resumes) Stripe Express onboarding for the authenticated host.
// Returns a one-time Stripe-hosted onboarding URL.
// ════════════════════════════════════════════════════════════════════════════
connectRoutes.post('/onboard', requireUserAuth(), async (c) => {
  const env  = c.env
  const user = c.get('user') as any
  const db   = env.DB
  const ip   = c.req.header('CF-Connecting-IP') || 'unknown'

  if (!env.STRIPE_SECRET_KEY) return c.json({ error: 'Stripe not configured' }, 503)
  if (!db)                    return c.json({ error: 'Database unavailable' }, 503)
  if (rl(`connect-onboard:${ip}`, 5, 60_000)) {
    return c.json({ error: 'Too many requests. Please wait a moment.' }, 429)
  }

  let body: any = {}
  try { body = await c.req.json() } catch {}

  const businessType: 'individual' | 'company' =
    body.business_type === 'company' ? 'company' : 'individual'

  try {
    // Check if host already has a connect account
    const existing = await db.prepare(
      'SELECT stripe_account_id, onboarding_status FROM stripe_connect_accounts WHERE user_id = ? LIMIT 1'
    ).bind(user.userId).first<any>()

    const baseUrl = 'https://parkpeer.pages.dev'

    let stripeAccountId: string

    if (existing?.stripe_account_id) {
      // Resume existing onboarding
      stripeAccountId = existing.stripe_account_id

      // If already complete, return status instead
      if (existing.onboarding_status === 'complete') {
        return c.json({
          status:    'complete',
          message:   'Your account is already connected.',
          account_id: stripeAccountId,
        })
      }
    } else {
      // Fetch host email from DB
      const hostUser = await db.prepare(
        'SELECT email, full_name FROM users WHERE id = ? LIMIT 1'
      ).bind(user.userId).first<any>()

      // Create new Express account
      const { accountId } = await createConnectAccount(env as any, {
        email:        hostUser?.email || user.email || '',
        businessType,
        metadata: {
          host_id:   String(user.userId),
          platform:  'parkpeer',
        },
      })
      stripeAccountId = accountId

      // Persist the new account
      await db.prepare(`
        INSERT INTO stripe_connect_accounts
          (user_id, stripe_account_id, business_type, email, onboarding_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))
      `).bind(user.userId, stripeAccountId, businessType, hostUser?.email || '').run()

      // Also update payout_info
      await db.prepare(`
        INSERT INTO payout_info (user_id, stripe_account_id, connect_account_id, onboarding_status, updated_at)
        VALUES (?, ?, ?, 'pending', datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET
          connect_account_id = excluded.connect_account_id,
          stripe_account_id  = excluded.stripe_account_id,
          onboarding_status  = 'pending',
          updated_at         = datetime('now')
      `).bind(user.userId, stripeAccountId, stripeAccountId).run()

      await logConnectEvent(db, {
        eventType: 'connect.account_created',
        accountId: stripeAccountId,
        hostId:    user.userId,
        payload:   { host_id: user.userId, business_type: businessType },
        processed: true,
      })
    }

    // Generate a fresh onboarding link (they expire after a few minutes)
    const { url, expiresAt } = await createAccountLink(env as any, {
      accountId:  stripeAccountId,
      refreshUrl: `${baseUrl}/host/connect/refresh`,
      returnUrl:  `${baseUrl}/host/connect/complete`,
    })

    // Mark as in_progress
    await db.prepare(`
      UPDATE stripe_connect_accounts
      SET onboarding_status = 'in_progress', updated_at = datetime('now')
      WHERE user_id = ? AND onboarding_status IN ('pending','in_progress','restricted')
    `).bind(user.userId).run()

    await logConnectEvent(db, {
      eventType: 'connect.onboard_link_created',
      accountId: stripeAccountId,
      hostId:    user.userId,
      payload:   { expires_at: expiresAt },
      processed: true,
    })

    return c.json({
      onboarding_url: url,
      expires_at:     expiresAt,
      account_id:     stripeAccountId,
      business_type:  businessType,
    })

  } catch (e: any) {
    console.error('[connect/onboard]', e.message)
    return c.json({ error: e.message || 'Failed to start onboarding' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// GET /api/connect/status
// Returns the host's Connect account status, requirements, and capabilities.
// ════════════════════════════════════════════════════════════════════════════
connectRoutes.get('/status', requireUserAuth(), async (c) => {
  const env  = c.env
  const user = c.get('user') as any
  const db   = env.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  try {
    const row = await db.prepare(`
      SELECT sca.stripe_account_id, sca.onboarding_status, sca.business_type,
             sca.charges_enabled, sca.payouts_enabled, sca.details_submitted,
             sca.requirements_json, sca.updated_at,
             ps.interval AS payout_interval
      FROM stripe_connect_accounts sca
      LEFT JOIN payout_schedule ps ON ps.host_id = sca.user_id
      WHERE sca.user_id = ? LIMIT 1
    `).bind(user.userId).first<any>()

    if (!row) {
      return c.json({
        connected:         false,
        not_connected:     true,
        account_id:        null,
        onboarding_status: 'not_started',
        details_submitted: false,
        charges_enabled:   false,
        payouts_enabled:   false,
        redirect:          '/host/connect/onboard',
      })
    }

    // Optionally refresh from Stripe (only if account is not yet complete)
    let liveStatus: any = null
    if (env.STRIPE_SECRET_KEY && row.onboarding_status !== 'complete') {
      try {
        liveStatus = await getConnectAccount(env as any, row.stripe_account_id)
        // Sync updated fields back to DB
        const newStatus = liveStatus.detailsSubmitted ? 'complete'
          : (liveStatus.requirements?.currently_due?.length > 0) ? 'restricted'
          : row.onboarding_status

        await db.prepare(`
          UPDATE stripe_connect_accounts
          SET onboarding_status = ?,
              charges_enabled   = ?,
              payouts_enabled   = ?,
              details_submitted = ?,
              requirements_json = ?,
              updated_at        = datetime('now')
          WHERE user_id = ?
        `).bind(
          newStatus,
          liveStatus.chargesEnabled ? 1 : 0,
          liveStatus.payoutsEnabled ? 1 : 0,
          liveStatus.detailsSubmitted ? 1 : 0,
          JSON.stringify(liveStatus.requirements || {}),
          user.userId
        ).run()

        // Sync payout_info
        await db.prepare(`
          UPDATE payout_info
          SET onboarding_status = ?, payouts_enabled = ?, updated_at = datetime('now')
          WHERE user_id = ?
        `).bind(newStatus, liveStatus.payoutsEnabled ? 1 : 0, user.userId).run()

      } catch (stripeErr: any) {
        console.warn('[connect/status] Stripe refresh failed:', stripeErr.message)
      }
    }

    const requirements = liveStatus?.requirements || (row.requirements_json ? JSON.parse(row.requirements_json) : {})

    return c.json({
      connected:         true,
      account_id:        row.stripe_account_id,
      onboarding_status: liveStatus
        ? (liveStatus.detailsSubmitted ? 'complete' : (requirements?.currently_due?.length > 0 ? 'restricted' : row.onboarding_status))
        : row.onboarding_status,
      business_type:      row.business_type,
      charges_enabled:    !!(liveStatus?.chargesEnabled ?? row.charges_enabled),
      payouts_enabled:    !!(liveStatus?.payoutsEnabled ?? row.payouts_enabled),
      details_submitted:  !!(liveStatus?.detailsSubmitted ?? row.details_submitted),
      requirements: {
        currently_due:  requirements?.currently_due  || [],
        eventually_due: requirements?.eventually_due || [],
        past_due:       requirements?.past_due       || [],
      },
      payout_interval:   row.payout_interval || 'manual',
      last_updated:      row.updated_at,
    })

  } catch (e: any) {
    console.error('[connect/status]', e.message)
    return c.json({ error: 'Failed to fetch status' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// GET /api/connect/balance
// Live balance from the connected account + platform-side breakdown.
// ════════════════════════════════════════════════════════════════════════════
connectRoutes.get('/balance', requireUserAuth(), async (c) => {
  const env  = c.env
  const user = c.get('user') as any
  const db   = env.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  try {
    const row = await getHostConnectAccount(db, user.userId)
    if (!row) return c.json({
      not_connected:   true,
      error:           'No connected account found. Please complete Stripe onboarding.',
      redirect:        '/host/connect/onboard',
      available_usd:   0,
      pending_usd:     0,
      payouts_enabled: false,
    }, 200)  // 200 so the frontend can read the body and redirect gracefully
    if (!row.payouts_enabled) {
      return c.json({
        available_usd: 0, pending_usd: 0,
        message: 'Account verification required before balance is available.',
        payouts_enabled: false,
      })
    }

    // Live balance from Stripe connected account
    const { availableUsd, pendingUsd } = await getConnectBalance(env as any, row.stripe_account_id)

    // Platform-side earnings summary (from our DB)
    const earnRow = await db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN p.status='succeeded' THEN p.host_payout ELSE 0 END), 0) AS total_earned,
        COALESCE(SUM(CASE WHEN p.status='succeeded' THEN p.platform_fee ELSE 0 END), 0) AS total_platform_fees,
        COALESCE(SUM(CASE WHEN p.status='refunded' THEN p.host_payout ELSE 0 END), 0)  AS total_refunded,
        COUNT(CASE WHEN p.status='succeeded' THEN 1 END)                                AS completed_bookings
      FROM payments p
      WHERE p.host_id = ?
    `).bind(user.userId).first<any>()

    const totalPaidOut = await db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM host_payouts
      WHERE host_id = ? AND status IN ('paid','in_transit','pending')
    `).bind(user.userId).first<{ total: number }>()

    return c.json({
      available_usd:      availableUsd,
      pending_usd:        pendingUsd,
      payouts_enabled:    true,
      // Platform-side summary
      total_earned:       Math.round((earnRow?.total_earned       ?? 0) * 100) / 100,
      total_platform_fees:Math.round((earnRow?.total_platform_fees?? 0) * 100) / 100,
      total_refunded:     Math.round((earnRow?.total_refunded     ?? 0) * 100) / 100,
      total_paid_out:     Math.round((totalPaidOut?.total         ?? 0) * 100) / 100,
      completed_bookings: earnRow?.completed_bookings ?? 0,
    })

  } catch (e: any) {
    console.error('[connect/balance]', e.message)
    return c.json({ error: 'Failed to fetch balance' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// GET /api/connect/earnings
// Detailed earnings breakdown: per-booking host_payout records, refunds,
// disputes, and running totals. No Stripe API call — purely DB.
// Query: ?days=90&page=1&per_page=25
// ════════════════════════════════════════════════════════════════════════════
connectRoutes.get('/earnings', requireUserAuth(), async (c) => {
  const user    = c.get('user') as any
  const db      = c.env.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  const days    = Math.min(365, parseInt(c.req.query('days')    || '90'))
  const page    = Math.max(1,   parseInt(c.req.query('page')    || '1'))
  const perPage = Math.min(100, parseInt(c.req.query('per_page')|| '25'))
  const offset  = (page - 1) * perPage

  try {
    // Summary
    const summary = await db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN p.status='succeeded' THEN p.amount     ELSE 0 END),0) AS gross_revenue,
        COALESCE(SUM(CASE WHEN p.status='succeeded' THEN p.platform_fee ELSE 0 END),0) AS platform_fees,
        COALESCE(SUM(CASE WHEN p.status='succeeded' THEN p.host_payout  ELSE 0 END),0) AS net_earnings,
        COALESCE(SUM(CASE WHEN p.status='refunded'  THEN p.host_payout  ELSE 0 END),0) AS refunds,
        COALESCE(SUM(CASE WHEN p.status='disputed'  THEN p.host_payout  ELSE 0 END),0) AS disputes,
        COUNT(CASE WHEN p.status='succeeded' THEN 1 END)                                AS booking_count,
        COALESCE(SUM(CASE WHEN p.stripe_transfer_id IS NOT NULL AND p.status='succeeded' THEN p.host_payout ELSE 0 END),0) AS transferred_out
      FROM payments p
      WHERE p.host_id = ?
        AND datetime(p.created_at) >= datetime('now', ? || ' days')
    `).bind(user.userId, String(-days)).first<any>()

    // Per-booking detail
    const rows = await db.prepare(`
      SELECT
        p.id             AS payment_id,
        p.booking_id,
        p.amount         AS gross,
        p.platform_fee,
        p.host_payout    AS net,
        p.stripe_transfer_id AS transfer_id,
        p.status,
        b.start_time,
        b.end_time,
        b.duration_hours,
        b.vehicle_plate,
        l.title          AS listing_title,
        l.address        AS listing_address,
        p.created_at
      FROM payments p
      LEFT JOIN bookings b ON b.id = p.booking_id
      LEFT JOIN listings l ON l.id = b.listing_id
      WHERE p.host_id = ?
        AND datetime(p.created_at) >= datetime('now', ? || ' days')
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(user.userId, String(-days), perPage, offset).all<any>()

    const s = summary || {}
    return c.json({
      period_days: days,
      page, per_page: perPage,
      summary: {
        gross_revenue:   Math.round((s.gross_revenue  ?? 0) * 100) / 100,
        platform_fees:   Math.round((s.platform_fees  ?? 0) * 100) / 100,
        net_earnings:    Math.round((s.net_earnings   ?? 0) * 100) / 100,
        refunds:         Math.round((s.refunds        ?? 0) * 100) / 100,
        disputes:        Math.round((s.disputes       ?? 0) * 100) / 100,
        transferred_out: Math.round((s.transferred_out?? 0) * 100) / 100,
        booking_count:   s.booking_count ?? 0,
        available_for_payout: Math.round(((s.net_earnings ?? 0) - (s.refunds ?? 0) - (s.disputes ?? 0) - (s.transferred_out ?? 0)) * 100) / 100,
      },
      earnings: rows?.results ?? [],
    })
  } catch (e: any) {
    console.error('[connect/earnings]', e.message)
    return c.json({ error: 'Failed to fetch earnings' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// POST /api/connect/payout
// Request a manual cash-out. Requires payout_confirmed=true (2-step UX).
// Body: { amount_cents?, payout_confirmed: true, idempotency_key? }
//   amount_cents: optional. If omitted → full available balance.
// ════════════════════════════════════════════════════════════════════════════
connectRoutes.post('/payout', requireUserAuth(), async (c) => {
  const env  = c.env
  const user = c.get('user') as any
  const db   = env.DB
  const ip   = c.req.header('CF-Connecting-IP') || 'unknown'

  if (!env.STRIPE_SECRET_KEY) return c.json({ error: 'Stripe not configured' }, 503)
  if (!db)                    return c.json({ error: 'Database unavailable' }, 503)
  if (rl(`connect-payout:${user.userId}`, 3, 60_000)) {
    return c.json({ error: 'Too many payout requests. Please wait a minute.' }, 429)
  }

  let body: any = {}
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // 2-step confirmation guard
  if (!body.payout_confirmed) {
    return c.json({
      error:              'Please confirm the payout before proceeding.',
      payout_confirm_required: true,
      message:            'Set payout_confirmed: true to proceed with cash-out.',
    }, 400)
  }

  try {
    // Verify connected account exists and payouts are enabled
    const connectRow = await getHostConnectAccount(db, user.userId)
    if (!connectRow) {
      return c.json({ error: 'No connected account. Please complete Stripe onboarding first.' }, 400)
    }
    if (!connectRow.payouts_enabled) {
      return c.json({ error: 'Your account is not yet verified for payouts. Please complete onboarding.' }, 400)
    }

    const stripeAccountId = connectRow.stripe_account_id

    // Get live balance to validate amount
    const { availableUsd } = await getConnectBalance(env as any, stripeAccountId)
    const availableCents   = Math.floor(availableUsd * 100)

    if (availableCents < 100) {
      return c.json({
        error:           'Minimum payout is $1.00. Your available balance is insufficient.',
        available_usd:   availableUsd,
        minimum_usd:     1.00,
      }, 400)
    }

    // Determine payout amount
    const requestedCents = body.amount_cents ? parseInt(String(body.amount_cents)) : availableCents
    if (requestedCents > availableCents) {
      return c.json({
        error:           `Requested amount ($${(requestedCents/100).toFixed(2)}) exceeds available balance ($${availableUsd.toFixed(2)}).`,
        available_usd:   availableUsd,
        requested_usd:   requestedCents / 100,
      }, 400)
    }
    if (requestedCents < 100) {
      return c.json({ error: 'Minimum payout amount is $1.00 (100 cents).' }, 400)
    }

    // Idempotency key from client or auto-generate
    const idempKey = String(body.idempotency_key || `${user.userId}-${Date.now()}`)

    // Create a pending DB row first (before Stripe call)
    const insertResult = await db.prepare(`
      INSERT INTO host_payouts
        (host_id, stripe_account_id, amount, amount_cents, status, trigger_type,
         confirmation_ip, confirmed_at, requested_at, created_at)
      VALUES (?, ?, ?, ?, 'requested', 'manual', ?, datetime('now'), datetime('now'), datetime('now'))
    `).bind(
      user.userId, stripeAccountId,
      requestedCents / 100, requestedCents,
      ip
    ).run()

    const dbPayoutId = insertResult.meta?.last_row_id

    // Fire payout via Stripe
    const { payoutId, status, amountCents, arrivalDate } = await createConnectPayout(
      env as any,
      stripeAccountId,
      {
        amountCents:    requestedCents,
        statementDesc:  'ParkPeer Earnings',
        metadata: {
          host_id:     String(user.userId),
          platform:    'parkpeer',
          db_payout_id: String(dbPayoutId),
        },
      },
      idempKey
    )

    // Update DB row with Stripe payout ID + status
    await db.prepare(`
      UPDATE host_payouts
      SET stripe_payout_id = ?,
          status           = ?,
          arrival_date     = ?,
          processed_at     = datetime('now')
      WHERE id = ?
    `).bind(payoutId, status, arrivalDate, dbPayoutId).run()

    await logConnectEvent(db, {
      eventType: 'connect.payout_requested',
      accountId: stripeAccountId,
      payoutId,
      hostId:    user.userId,
      payload:   { amount_cents: amountCents, status, arrival_date: arrivalDate },
      processed: true,
    })

    const arrivalDateStr = arrivalDate
      ? new Date(arrivalDate * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'typically 2–5 business days'

    return c.json({
      success:       true,
      payout_id:     payoutId,
      db_payout_id:  dbPayoutId,
      amount_usd:    amountCents / 100,
      amount_cents:  amountCents,
      status,
      arrival_date:  arrivalDate,
      arrival_date_formatted: arrivalDateStr,
      message:       `Your cash-out of $${(amountCents/100).toFixed(2)} is on the way! Expected arrival: ${arrivalDateStr}.`,
    }, 201)

  } catch (e: any) {
    console.error('[connect/payout]', e.message)
    // Mark DB row as failed if it was created
    try {
      await db.prepare(`
        UPDATE host_payouts
        SET status='failed', failure_message=?, processed_at=datetime('now')
        WHERE host_id=? AND status='requested' AND stripe_payout_id IS NULL
        ORDER BY created_at DESC LIMIT 1
      `).bind(e.message?.slice(0, 500), user.userId).run()
    } catch {}
    return c.json({ error: e.message || 'Payout failed. Please try again.' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// GET /api/connect/payouts
// Returns payout history: DB rows enriched with Stripe live status.
// Query: ?page=1&per_page=20&status=all|pending|paid|failed
// ════════════════════════════════════════════════════════════════════════════
connectRoutes.get('/payouts', requireUserAuth(), async (c) => {
  const user    = c.get('user') as any
  const db      = c.env.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  const page    = Math.max(1,   parseInt(c.req.query('page')    || '1'))
  const perPage = Math.min(50,  parseInt(c.req.query('per_page')|| '20'))
  const filter  = c.req.query('status') || 'all'
  const offset  = (page - 1) * perPage

  const statusClause = ['all',''].includes(filter) ? '' : `AND status = '${filter.replace(/[^a-z_]/g,'')}'`

  try {
    const rows = await db.prepare(`
      SELECT id, stripe_payout_id, amount, amount_cents, currency, status,
             trigger_type, arrival_date, failure_code, failure_message,
             retry_count, requested_at, processed_at, created_at
      FROM host_payouts
      WHERE host_id = ?
        ${statusClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(user.userId, perPage, offset).all<any>()

    const totals = await db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status='paid'       THEN amount ELSE 0 END),0) AS total_paid,
        COALESCE(SUM(CASE WHEN status='in_transit' THEN amount ELSE 0 END),0) AS in_transit,
        COALESCE(SUM(CASE WHEN status='pending'    THEN amount ELSE 0 END),0) AS pending,
        COALESCE(SUM(CASE WHEN status='failed'     THEN amount ELSE 0 END),0) AS failed,
        COUNT(*) AS total_count
      FROM host_payouts WHERE host_id = ?
    `).bind(user.userId).first<any>()

    // Format arrival dates
    const payouts = (rows?.results || []).map((r: any) => ({
      ...r,
      amount_usd:    r.amount,
      arrival_date_formatted: r.arrival_date
        ? new Date(r.arrival_date * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : null,
    }))

    return c.json({
      page, per_page: perPage,
      totals: {
        total_paid:    Math.round((totals?.total_paid  ?? 0) * 100) / 100,
        in_transit:    Math.round((totals?.in_transit  ?? 0) * 100) / 100,
        pending:       Math.round((totals?.pending     ?? 0) * 100) / 100,
        failed:        Math.round((totals?.failed      ?? 0) * 100) / 100,
        total_count:   totals?.total_count ?? 0,
      },
      payouts,
    })
  } catch (e: any) {
    console.error('[connect/payouts]', e.message)
    return c.json({ error: 'Failed to fetch payout history' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// GET /api/connect/dashboard-link
// Generates a one-time URL for Stripe Express Dashboard.
// ════════════════════════════════════════════════════════════════════════════
connectRoutes.get('/dashboard-link', requireUserAuth(), async (c) => {
  const env  = c.env
  const user = c.get('user') as any
  const db   = env.DB
  if (!env.STRIPE_SECRET_KEY) return c.json({ error: 'Stripe not configured' }, 503)
  if (!db)                    return c.json({ error: 'Database unavailable' }, 503)

  try {
    const row = await getHostConnectAccount(db, user.userId)
    if (!row) return c.json({ error: 'No connected account found.' }, 404)
    if (row.onboarding_status !== 'complete') {
      return c.json({ error: 'Please complete onboarding before accessing your dashboard.' }, 400)
    }

    const { url } = await createLoginLink(env as any, row.stripe_account_id)
    return c.json({ url, expires_in_seconds: 300 })

  } catch (e: any) {
    console.error('[connect/dashboard-link]', e.message)
    return c.json({ error: 'Failed to generate dashboard link' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// GET /api/connect/schedule  — get current auto-payout schedule
// POST /api/connect/schedule — set auto-payout schedule
// Body: { interval: 'manual'|'daily'|'weekly'|'monthly', weekly_anchor?, monthly_anchor?, minimum_payout_cents? }
// ════════════════════════════════════════════════════════════════════════════
connectRoutes.get('/schedule', requireUserAuth(), async (c) => {
  const user = c.get('user') as any
  const db   = c.env.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  const row = await db.prepare(
    'SELECT * FROM payout_schedule WHERE host_id = ? LIMIT 1'
  ).bind(user.userId).first<any>().catch(() => null)

  if (!row) return c.json({ interval: 'manual', enabled: true, minimum_payout_usd: 10 })

  return c.json({
    interval:            row.interval,
    weekly_anchor:       row.weekly_anchor,
    monthly_anchor:      row.monthly_anchor,
    minimum_payout_usd:  row.minimum_payout_cents / 100,
    enabled:             !!row.enabled,
    last_run_at:         row.last_run_at,
    next_run_at:         row.next_run_at,
  })
})

connectRoutes.post('/schedule', requireUserAuth(), async (c) => {
  const env  = c.env
  const user = c.get('user') as any
  const db   = env.DB
  const ip   = c.req.header('CF-Connecting-IP') || 'unknown'
  if (!db) return c.json({ error: 'Database unavailable' }, 503)
  if (rl(`connect-schedule:${ip}`, 10, 60_000)) return c.json({ error: 'Rate limited' }, 429)

  let body: any = {}
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const interval: 'manual'|'daily'|'weekly'|'monthly' =
    ['manual','daily','weekly','monthly'].includes(body.interval) ? body.interval : 'manual'
  const weeklyAnchor  = body.weekly_anchor  || 'friday'
  const monthlyAnchor = parseInt(body.monthly_anchor || '1') || 1
  const minCents      = Math.max(100, parseInt(body.minimum_payout_cents || '1000') || 1000)

  try {
    const connectRow = await getHostConnectAccount(db, user.userId)
    if (!connectRow) return c.json({ error: 'No connected account found.' }, 404)

    // Update Stripe account's payout schedule
    if (env.STRIPE_SECRET_KEY) {
      await updatePayoutSchedule(env as any, connectRow.stripe_account_id, interval, {
        weeklyAnchor,
        monthlyAnchor,
      }).catch((e: any) => console.warn('[connect/schedule] Stripe update failed:', e.message))
    }

    // Upsert local schedule
    await db.prepare(`
      INSERT INTO payout_schedule
        (host_id, stripe_account_id, interval, weekly_anchor, monthly_anchor,
         minimum_payout_cents, enabled, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
      ON CONFLICT(host_id) DO UPDATE SET
        interval              = excluded.interval,
        weekly_anchor         = excluded.weekly_anchor,
        monthly_anchor        = excluded.monthly_anchor,
        minimum_payout_cents  = excluded.minimum_payout_cents,
        enabled               = 1,
        updated_at            = datetime('now')
    `).bind(user.userId, connectRow.stripe_account_id, interval, weeklyAnchor, monthlyAnchor, minCents).run()

    await logConnectEvent(db, {
      eventType: 'connect.schedule_updated',
      accountId: connectRow.stripe_account_id,
      hostId:    user.userId,
      payload:   { interval, weekly_anchor: weeklyAnchor, monthly_anchor: monthlyAnchor, min_cents: minCents },
      processed: true,
    })

    return c.json({
      success:            true,
      interval,
      weekly_anchor:      weeklyAnchor,
      monthly_anchor:     monthlyAnchor,
      minimum_payout_usd: minCents / 100,
    })
  } catch (e: any) {
    console.error('[connect/schedule POST]', e.message)
    return c.json({ error: 'Failed to update schedule' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// POST /api/connect/payout/:id/cancel
// Cancel a pending (not yet in_transit) payout.
// ════════════════════════════════════════════════════════════════════════════
connectRoutes.post('/payout/:id/cancel', requireUserAuth(), async (c) => {
  const env      = c.env
  const user     = c.get('user') as any
  const db       = env.DB
  const payoutId = c.req.param('id')
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  try {
    const dbRow = await db.prepare(
      'SELECT * FROM host_payouts WHERE id = ? AND host_id = ? LIMIT 1'
    ).bind(payoutId, user.userId).first<any>()

    if (!dbRow) return c.json({ error: 'Payout not found' }, 404)
    if (!['requested','pending'].includes(dbRow.status)) {
      return c.json({ error: `Cannot cancel a payout with status '${dbRow.status}'.` }, 400)
    }

    // Cancel on Stripe if we have a stripe_payout_id
    if (dbRow.stripe_payout_id && env.STRIPE_SECRET_KEY) {
      const connectRow = await getHostConnectAccount(db, user.userId)
      if (connectRow) {
        await cancelConnectPayout(env as any, connectRow.stripe_account_id, dbRow.stripe_payout_id)
          .catch((e: any) => console.warn('[connect/payout/cancel] Stripe cancel:', e.message))
      }
    }

    await db.prepare(`
      UPDATE host_payouts SET status='canceled', processed_at=datetime('now') WHERE id=?
    `).bind(payoutId).run()

    await logConnectEvent(db, {
      eventType: 'connect.payout_cancelled',
      accountId: dbRow.stripe_account_id,
      payoutId:  dbRow.stripe_payout_id,
      hostId:    user.userId,
      payload:   { db_payout_id: payoutId },
      processed: true,
    })

    return c.json({ success: true, payout_id: payoutId, status: 'canceled' })

  } catch (e: any) {
    console.error('[connect/payout/cancel]', e.message)
    return c.json({ error: 'Failed to cancel payout' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// POST /api/connect/payout/:id/retry
// Retry a failed payout (max 3 attempts, same amount).
// ════════════════════════════════════════════════════════════════════════════
connectRoutes.post('/payout/:id/retry', requireUserAuth(), async (c) => {
  const env      = c.env
  const user     = c.get('user') as any
  const db       = env.DB
  const dbPayoutIdStr = c.req.param('id')
  const ip       = c.req.header('CF-Connecting-IP') || 'unknown'

  if (!env.STRIPE_SECRET_KEY) return c.json({ error: 'Stripe not configured' }, 503)
  if (!db)                    return c.json({ error: 'Database unavailable' }, 503)
  if (rl(`connect-retry:${user.userId}`, 3, 60_000)) {
    return c.json({ error: 'Too many retry requests. Please wait a minute.' }, 429)
  }

  try {
    const dbRow = await db.prepare(
      'SELECT * FROM host_payouts WHERE id = ? AND host_id = ? LIMIT 1'
    ).bind(dbPayoutIdStr, user.userId).first<any>()

    if (!dbRow) return c.json({ error: 'Payout record not found.' }, 404)
    if (dbRow.status !== 'failed') {
      return c.json({ error: `Cannot retry a payout with status '${dbRow.status}'.` }, 400)
    }
    if (dbRow.retry_count >= 3) {
      return c.json({ error: 'Maximum retry attempts (3) reached. Please contact support.' }, 400)
    }

    const connectRow = await getHostConnectAccount(db, user.userId)
    if (!connectRow?.payouts_enabled) {
      return c.json({ error: 'Account not enabled for payouts.' }, 400)
    }

    // Verify sufficient balance before retry
    const { availableUsd } = await getConnectBalance(env as any, connectRow.stripe_account_id)
    const availableCents   = Math.floor(availableUsd * 100)
    if (availableCents < dbRow.amount_cents) {
      return c.json({
        error: `Insufficient balance. Available: $${availableUsd.toFixed(2)}, Required: $${(dbRow.amount_cents/100).toFixed(2)}`,
        available_usd:  availableUsd,
        required_usd:   dbRow.amount_cents / 100,
      }, 400)
    }

    const idempKey = `retry-${dbRow.id}-${dbRow.retry_count + 1}`

    const { payoutId, status, amountCents, arrivalDate } = await createConnectPayout(
      env as any,
      connectRow.stripe_account_id,
      {
        amountCents:   dbRow.amount_cents,
        statementDesc: 'ParkPeer Earnings Retry',
        metadata: {
          host_id:      String(user.userId),
          platform:     'parkpeer',
          db_payout_id: String(dbRow.id),
          retry_count:  String(dbRow.retry_count + 1),
        },
      },
      idempKey
    )

    await db.prepare(`
      UPDATE host_payouts
      SET stripe_payout_id = ?,
          status           = ?,
          failure_code     = NULL,
          failure_message  = NULL,
          retry_count      = retry_count + 1,
          last_retry_at    = datetime('now'),
          arrival_date     = ?,
          processed_at     = datetime('now')
      WHERE id = ?
    `).bind(payoutId, status, arrivalDate, dbRow.id).run()

    await logConnectEvent(db, {
      eventType: 'connect.payout_retried',
      accountId: connectRow.stripe_account_id,
      payoutId,
      hostId:    user.userId,
      payload:   { db_payout_id: dbRow.id, retry_count: dbRow.retry_count + 1, amount_cents: amountCents },
      processed: true,
    })

    return c.json({
      success:       true,
      payout_id:     payoutId,
      db_payout_id:  dbRow.id,
      amount_usd:    amountCents / 100,
      status,
      arrival_date:  arrivalDate,
      retry_count:   dbRow.retry_count + 1,
    })
  } catch (e: any) {
    console.error('[connect/payout/retry]', e.message)
    return c.json({ error: e.message || 'Retry failed' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// GET /api/connect/audit-log
// Returns the connect event log for this host (for reporting/tax purposes).
// Query: ?days=90&page=1&per_page=50
// ════════════════════════════════════════════════════════════════════════════
connectRoutes.get('/audit-log', requireUserAuth(), async (c) => {
  const user    = c.get('user') as any
  const db      = c.env.DB
  if (!db) return c.json({ error: 'Database unavailable' }, 503)

  const days    = Math.min(365, parseInt(c.req.query('days')    || '90'))
  const page    = Math.max(1,   parseInt(c.req.query('page')    || '1'))
  const perPage = Math.min(100, parseInt(c.req.query('per_page')|| '50'))
  const offset  = (page - 1) * perPage

  try {
    const rows = await db.prepare(`
      SELECT id, stripe_event_id, event_type, stripe_payout_id,
             payload_json, processed, error_detail, created_at
      FROM stripe_connect_events
      WHERE host_id = ?
        AND datetime(created_at) >= datetime('now', ? || ' days')
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(user.userId, String(-days), perPage, offset).all<any>()

    // Earnings summary for tax reporting
    const taxSummary = await db.prepare(`
      SELECT
        strftime('%Y', p.created_at)                                           AS year,
        strftime('%m', p.created_at)                                           AS month,
        ROUND(SUM(CASE WHEN p.status='succeeded' THEN p.host_payout ELSE 0 END),2) AS net_earnings,
        ROUND(SUM(CASE WHEN p.status='succeeded' THEN p.platform_fee ELSE 0 END),2) AS platform_fees_paid,
        COUNT(CASE WHEN p.status='succeeded' THEN 1 END)                       AS bookings_completed,
        ROUND(SUM(CASE WHEN p.status='refunded' THEN p.host_payout ELSE 0 END),2) AS refunds_issued
      FROM payments p
      WHERE p.host_id = ?
        AND datetime(p.created_at) >= datetime('now', ? || ' days')
      GROUP BY year, month
      ORDER BY year DESC, month DESC
    `).bind(user.userId, String(-days)).all<any>()

    return c.json({
      period_days: days,
      page, per_page: perPage,
      events:      rows?.results ?? [],
      tax_summary: taxSummary?.results ?? [],
    })
  } catch (e: any) {
    console.error('[connect/audit-log]', e.message)
    return c.json({ error: 'Failed to fetch audit log' }, 500)
  }
})
