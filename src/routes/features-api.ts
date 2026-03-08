/**
 * ParkPeer Feature Pack API Routes
 * Features: Reviews, Favorites, Referrals, Wallet, Quality Score, Fraud, Trust
 */
import { Hono } from 'hono'
import { requireUserAuth } from '../middleware/security'
import {
  calcHostTrustScore, isVerifiedHost,
  calcQualityScore, qualityLabel, qualitySuggestions,
  calcAvailabilityConfidence, generateReferralCode,
  checkListingFraud, checkBookingFraud,
} from '../services/features'

type Bindings = {
  DB: D1Database
  USER_TOKEN_SECRET: string
}

export const featuresApiRoutes = new Hono<{ Bindings: Bindings }>()

// ════════════════════════════════════════════════════════════════════════════
// REVIEWS
// ════════════════════════════════════════════════════════════════════════════

// POST /api/reviews — submit a review after a completed booking
featuresApiRoutes.post('/reviews', requireUserAuth(), async (c) => {
  const db   = c.env?.DB
  const user = c.get('user') as any
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  let body: any = {}
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const { booking_id, rating, review_text } = body
  if (!booking_id || !rating) return c.json({ error: 'booking_id and rating required' }, 400)
  if (Number(rating) < 1 || Number(rating) > 5) return c.json({ error: 'Rating must be 1–5' }, 400)

  try {
    // Verify booking belongs to this user and is completed
    const booking = await db.prepare(`
      SELECT b.*, l.host_id, l.id as listing_id
      FROM bookings b LEFT JOIN listings l ON b.listing_id = l.id
      WHERE b.id = ? AND (b.driver_id = ? OR b.host_id = ?)
    `).bind(booking_id, user.id, user.id).first<any>()

    if (!booking) return c.json({ error: 'Booking not found or access denied' }, 404)
    if (!['confirmed', 'completed'].includes(booking.status)) {
      return c.json({ error: 'Reviews can only be submitted for completed bookings' }, 400)
    }

    const isDriver = String(booking.driver_id) === String(user.id)
    const reviewerRole = isDriver ? 'driver' : 'host'
    const targetId     = isDriver ? booking.host_id : booking.driver_id

    // One review per booking per party
    const existing = await db.prepare(`
      SELECT id FROM reviews
      WHERE booking_id = ? AND reviewer_id = ? AND reviewer_role = ?
    `).bind(booking_id, user.id, reviewerRole).first<any>()
    if (existing) return c.json({ error: 'You have already reviewed this booking' }, 409)

    // Insert review
    const result = await db.prepare(`
      INSERT INTO reviews (booking_id, reviewer_id, review_target_id, listing_id, rating, comment, reviewer_role, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'published', datetime('now'))
    `).bind(booking_id, user.id, targetId, booking.listing_id, rating, review_text || '', reviewerRole).run()

    // Update listing avg_rating and review_count
    if (isDriver) {
      await db.prepare(`
        UPDATE listings SET
          review_count = (SELECT COUNT(*) FROM reviews WHERE listing_id=? AND reviewer_role='driver' AND status='published'),
          avg_rating   = (SELECT ROUND(AVG(rating),2) FROM reviews WHERE listing_id=? AND reviewer_role='driver' AND status='published')
        WHERE id = ?
      `).bind(booking.listing_id, booking.listing_id, booking.listing_id).run()
    }

    return c.json({ success: true, review_id: result.meta?.last_row_id }, 201)
  } catch (e: any) {
    console.error('[POST /reviews]', e.message)
    return c.json({ error: 'Failed to submit review' }, 500)
  }
})

// GET /api/reviews/listing/:listing_id — public reviews for a listing
featuresApiRoutes.get('/reviews/listing/:listing_id', async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'DB unavailable' }, 503)
  const listingId = c.req.param('listing_id')
  const limit  = Math.min(Number(c.req.query('limit') || 20), 50)
  const offset = Number(c.req.query('offset') || 0)

  try {
    const rows = await db.prepare(`
      SELECT r.id, r.rating, r.comment, r.created_at, r.reviewer_role,
             u.full_name AS reviewer_name, u.avatar_url AS reviewer_avatar
      FROM reviews r
      LEFT JOIN users u ON r.reviewer_id = u.id
      WHERE r.listing_id = ? AND r.reviewer_role = 'driver'
        AND r.status = 'published' AND r.is_visible = 1
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(listingId, limit, offset).all<any>()

    const stats = await db.prepare(`
      SELECT COUNT(*) as total, ROUND(AVG(rating),2) as avg_rating
      FROM reviews WHERE listing_id=? AND reviewer_role='driver' AND status='published'
    `).bind(listingId).first<any>()

    return c.json({ reviews: rows.results || [], stats, limit, offset })
  } catch (e: any) {
    return c.json({ error: 'Failed to fetch reviews' }, 500)
  }
})

// GET /api/reviews/pending — reviews the current user needs to submit
featuresApiRoutes.get('/reviews/pending', requireUserAuth(), async (c) => {
  const db   = c.env?.DB
  const user = c.get('user') as any
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  try {
    const bookings = await db.prepare(`
      SELECT b.id, b.start_time, b.end_time, b.listing_id,
             l.title AS listing_title, l.address,
             u.full_name AS host_name
      FROM bookings b
      LEFT JOIN listings l ON b.listing_id = l.id
      LEFT JOIN users    u ON b.host_id = u.id
      WHERE b.driver_id = ?
        AND b.status IN ('confirmed','completed')
        AND b.end_time < datetime('now')
        AND NOT EXISTS (
          SELECT 1 FROM reviews r
          WHERE r.booking_id = b.id AND r.reviewer_id = ? AND r.reviewer_role = 'driver'
        )
      ORDER BY b.end_time DESC
      LIMIT 10
    `).bind(user.id, user.id).all<any>()

    return c.json({ pending: bookings.results || [] })
  } catch (e: any) {
    return c.json({ error: 'Failed to fetch pending reviews' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// FAVORITES (Saved Spots)
// ════════════════════════════════════════════════════════════════════════════

// POST /api/favorites — add a saved spot
featuresApiRoutes.post('/favorites', requireUserAuth(), async (c) => {
  const db   = c.env?.DB
  const user = c.get('user') as any
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  let body: any = {}
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  const { listing_id } = body
  if (!listing_id) return c.json({ error: 'listing_id required' }, 400)

  try {
    // Verify listing exists
    const listing = await db.prepare('SELECT id FROM listings WHERE id=? AND status=?')
      .bind(listing_id, 'active').first<any>()
    if (!listing) return c.json({ error: 'Listing not found' }, 404)

    await db.prepare(
      'INSERT OR IGNORE INTO favorites (user_id, listing_id) VALUES (?,?)'
    ).bind(user.id, listing_id).run()

    return c.json({ success: true, saved: true })
  } catch (e: any) {
    return c.json({ error: 'Failed to save spot' }, 500)
  }
})

// DELETE /api/favorites — remove a saved spot
featuresApiRoutes.delete('/favorites', requireUserAuth(), async (c) => {
  const db   = c.env?.DB
  const user = c.get('user') as any
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  let body: any = {}
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  const listing_id = body.listing_id || c.req.query('listing_id')
  if (!listing_id) return c.json({ error: 'listing_id required' }, 400)

  try {
    await db.prepare('DELETE FROM favorites WHERE user_id=? AND listing_id=?')
      .bind(user.id, listing_id).run()
    return c.json({ success: true, saved: false })
  } catch (e: any) {
    return c.json({ error: 'Failed to remove saved spot' }, 500)
  }
})

// GET /api/favorites — list all saved spots for current user
featuresApiRoutes.get('/favorites', requireUserAuth(), async (c) => {
  const db   = c.env?.DB
  const user = c.get('user') as any
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  try {
    const rows = await db.prepare(`
      SELECT
        f.id AS favorite_id, f.listing_id, f.created_at AS saved_at,
        l.id AS listing_id_check, l.title, l.address, l.city, l.state,
        l.rate_hourly, l.rate_daily, l.photos,
        l.avg_rating, l.review_count, l.availability_confidence,
        l.quality_score, l.lat, l.lng,
        u.full_name AS host_name, u.host_verified
      FROM favorites f
      LEFT JOIN listings l ON f.listing_id = l.id
      LEFT JOIN users    u ON l.host_id    = u.id
      WHERE f.user_id = ? AND l.status = 'active'
      ORDER BY f.created_at DESC
    `).bind(user.id).all<any>()

    return c.json({ favorites: rows.results || [], count: (rows.results || []).length })
  } catch (e: any) {
    return c.json({ error: 'Failed to fetch saved spots' }, 500)
  }
})

// GET /api/favorites/check/:listing_id — check if a listing is saved
featuresApiRoutes.get('/favorites/check/:listing_id', requireUserAuth(), async (c) => {
  const db   = c.env?.DB
  const user = c.get('user') as any
  if (!db) return c.json({ error: 'DB unavailable' }, 503)
  const listingId = c.req.param('listing_id')

  try {
    const row = await db.prepare('SELECT id FROM favorites WHERE user_id=? AND listing_id=?')
      .bind(user.id, listingId).first<any>()
    return c.json({ saved: !!row })
  } catch (e: any) {
    return c.json({ saved: false })
  }
})

// ════════════════════════════════════════════════════════════════════════════
// SMART REBOOKING
// ════════════════════════════════════════════════════════════════════════════

// GET /api/rebooking/check/:listing_id — has user parked here before?
featuresApiRoutes.get('/rebooking/check/:listing_id', requireUserAuth(), async (c) => {
  const db        = c.env?.DB
  const user      = c.get('user') as any
  const listingId = c.req.param('listing_id')
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  try {
    const row = await db.prepare(`
      SELECT b.id, b.start_time, b.end_time, b.total_charged,
             l.title, l.address, l.rate_hourly, l.rate_daily
      FROM bookings b
      LEFT JOIN listings l ON b.listing_id = l.id
      WHERE b.driver_id = ? AND b.listing_id = ?
        AND b.status IN ('confirmed','completed')
      ORDER BY b.start_time DESC
      LIMIT 1
    `).bind(user.id, listingId).first<any>()

    return c.json({ has_previous_booking: !!row, last_booking: row || null })
  } catch (e: any) {
    return c.json({ has_previous_booking: false, last_booking: null })
  }
})

// ════════════════════════════════════════════════════════════════════════════
// HOST TRUST & QUALITY SCORE
// ════════════════════════════════════════════════════════════════════════════

// GET /api/host/trust/:host_id — get host trust score and verification status
featuresApiRoutes.get('/host/trust/:host_id', async (c) => {
  const db     = c.env?.DB
  const hostId = c.req.param('host_id')
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  try {
    const host = await db.prepare(`
      SELECT u.id, u.full_name, u.avatar_url, u.id_verified, u.stripe_account_id,
             u.host_verified, u.host_trust_score, u.fraud_flags,
             uts.r12_completed_bookings, uts.r12_avg_rating, uts.r12_response_rate,
             uts.r12_cancellation_rate, uts.current_tier
      FROM users u
      LEFT JOIN user_tier_state uts ON uts.user_id = u.id AND uts.role = 'HOST'
      WHERE u.id = ?
    `).bind(hostId).first<any>()

    if (!host) return c.json({ error: 'Host not found' }, 404)

    const stripeConnected = !!(host.stripe_account_id)
    const trustScore = calcHostTrustScore({
      stripe_connected:    stripeConnected,
      id_verified:         !!host.id_verified,
      completed_bookings:  host.r12_completed_bookings || 0,
      avg_rating:          host.r12_avg_rating || 0,
      fraud_flags:         host.fraud_flags || 0,
      response_rate:       host.r12_response_rate || 0,
      cancellation_rate:   host.r12_cancellation_rate || 0,
    })
    const verified = isVerifiedHost({
      stripe_connected:   stripeConnected,
      id_verified:        !!host.id_verified,
      completed_bookings: host.r12_completed_bookings || 0,
      avg_rating:         host.r12_avg_rating || 0,
      fraud_flags:        host.fraud_flags || 0,
    })

    // Persist trust score + verified flag if changed
    if (Math.abs((host.host_trust_score || 0) - trustScore) > 1 || Number(host.host_verified) !== Number(verified)) {
      db.prepare('UPDATE users SET host_trust_score=?, host_verified=? WHERE id=?')
        .bind(trustScore, verified ? 1 : 0, hostId).run().catch(() => {})
    }

    return c.json({
      host_id: host.id,
      full_name: host.full_name,
      trust_score: trustScore,
      verified,
      tier: host.current_tier || 'steward',
      stats: {
        completed_bookings: host.r12_completed_bookings || 0,
        avg_rating: host.r12_avg_rating || 0,
        response_rate: host.r12_response_rate || 0,
      },
    })
  } catch (e: any) {
    console.error('[GET /host/trust]', e.message)
    return c.json({ error: 'Failed to fetch trust data' }, 500)
  }
})

// GET /api/listings/:listing_id/quality — listing quality score
featuresApiRoutes.get('/listings/:listing_id/quality', requireUserAuth(), async (c) => {
  const db        = c.env?.DB
  const user      = c.get('user') as any
  const listingId = c.req.param('listing_id')
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  try {
    const listing = await db.prepare(`
      SELECT l.*, u.id_verified, u.stripe_account_id, u.host_verified
      FROM listings l LEFT JOIN users u ON l.host_id = u.id
      WHERE l.id = ? AND l.host_id = ?
    `).bind(listingId, user.id).first<any>()

    if (!listing) return c.json({ error: 'Listing not found or access denied' }, 404)

    const photos: any[] = (() => { try { return JSON.parse(listing.photos || '[]') } catch { return [] } })()
    const recentBookings = await db.prepare(`
      SELECT COUNT(*) as cnt FROM bookings
      WHERE listing_id=? AND created_at >= datetime('now','-30 days') AND status IN ('confirmed','completed')
    `).bind(listingId).first<any>()

    const factors = {
      has_photos:       photos.length > 0,
      has_description:  (listing.description || '').trim().length > 20,
      has_price:        !!(listing.rate_hourly || listing.rate_daily),
      has_schedule:     !!(listing.available_from || listing.available_days),
      host_verified:    !!(listing.host_verified || (listing.id_verified && listing.stripe_account_id)),
      recent_bookings:  recentBookings?.cnt || 0,
      has_instructions: (listing.instructions || '').trim().length > 5,
      address_verified: !!listing.address_verified,
    }

    const score = calcQualityScore(factors)
    const suggestions = qualitySuggestions(factors)

    // Persist score
    db.prepare('UPDATE listings SET quality_score=? WHERE id=?').bind(score, listingId).run().catch(() => {})

    return c.json({ listing_id: listingId, score, label: qualityLabel(score), factors, suggestions })
  } catch (e: any) {
    return c.json({ error: 'Failed to compute quality score' }, 500)
  }
})

// GET /api/listings/:listing_id/confidence — availability confidence
featuresApiRoutes.get('/listings/:listing_id/confidence', async (c) => {
  const db        = c.env?.DB
  const listingId = c.req.param('listing_id')
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  try {
    const row = await db.prepare(`
      SELECT l.last_booking_at, l.booking_frequency, l.cancellation_rate,
             uts.r12_response_rate
      FROM listings l
      LEFT JOIN users u ON l.host_id = u.id
      LEFT JOIN user_tier_state uts ON uts.user_id = l.host_id AND uts.role = 'HOST'
      WHERE l.id = ?
    `).bind(listingId).first<any>()

    if (!row) return c.json({ error: 'Listing not found' }, 404)

    const level = calcAvailabilityConfidence({
      last_booking_at:    row.last_booking_at,
      cancellation_rate:  row.cancellation_rate || 0,
      booking_frequency:  row.booking_frequency || 0,
      host_response_rate: row.r12_response_rate || 0,
    })

    // Persist
    db.prepare('UPDATE listings SET availability_confidence=? WHERE id=?').bind(level, listingId).run().catch(() => {})

    return c.json({ listing_id: listingId, confidence: level })
  } catch (e: any) {
    return c.json({ error: 'Failed to compute confidence' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// REFERRAL PROGRAM
// ════════════════════════════════════════════════════════════════════════════

// GET /api/referral/code — get or generate referral code for current user
featuresApiRoutes.get('/referral/code', requireUserAuth(), async (c) => {
  const db   = c.env?.DB
  const user = c.get('user') as any
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  try {
    const userRow = await db.prepare('SELECT id, full_name, referral_code FROM users WHERE id=?')
      .bind(user.id).first<any>()
    if (!userRow) return c.json({ error: 'User not found' }, 404)

    let code = userRow.referral_code
    if (!code) {
      code = generateReferralCode(userRow.id, userRow.full_name || 'PP')
      // Ensure uniqueness
      let attempt = code
      let suffix = 1
      while (true) {
        const exists = await db.prepare('SELECT id FROM users WHERE referral_code=?').bind(attempt).first<any>()
        if (!exists) { code = attempt; break; }
        attempt = code + suffix++
      }
      await db.prepare('UPDATE users SET referral_code=? WHERE id=?').bind(code, user.id).run()
      // Also insert into referrals table
      await db.prepare('INSERT OR IGNORE INTO referrals (referrer_user_id, referral_code) VALUES (?,?)')
        .bind(user.id, code).run()
    }

    // Get stats
    const stats = await db.prepare(`
      SELECT
        COUNT(*) AS total_referrals,
        SUM(CASE WHEN status='rewarded' THEN 1 ELSE 0 END) AS rewarded_count,
        SUM(CASE WHEN status='rewarded' THEN reward_amount_cents ELSE 0 END) AS total_earned_cents
      FROM referrals WHERE referrer_user_id=?
    `).bind(user.id).first<any>()

    // Wallet balance
    const wallet = await db.prepare('SELECT balance_cents FROM user_wallet WHERE user_id=?')
      .bind(user.id).first<any>()

    return c.json({
      code,
      share_url: `https://parkpeer.pages.dev/auth/register?ref=${code}`,
      reward_per_referral: '$10.00',
      stats: {
        total_referrals: stats?.total_referrals || 0,
        rewarded_count: stats?.rewarded_count || 0,
        total_earned: '$' + ((stats?.total_earned_cents || 0) / 100).toFixed(2),
      },
      wallet_balance: '$' + ((wallet?.balance_cents || 0) / 100).toFixed(2),
    })
  } catch (e: any) {
    console.error('[GET /referral/code]', e.message)
    return c.json({ error: 'Failed to fetch referral code' }, 500)
  }
})

// POST /api/referral/apply — apply a referral code during registration
featuresApiRoutes.post('/referral/apply', requireUserAuth(), async (c) => {
  const db   = c.env?.DB
  const user = c.get('user') as any
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  let body: any = {}
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  const { code } = body
  if (!code) return c.json({ error: 'code required' }, 400)

  try {
    // Check if user already has a referral applied
    const currentUser = await db.prepare('SELECT id, referred_by_code FROM users WHERE id=?')
      .bind(user.id).first<any>()
    if (currentUser?.referred_by_code) {
      return c.json({ error: 'A referral code has already been applied to your account' }, 409)
    }

    // Find referral
    const referral = await db.prepare(`
      SELECT r.*, u.id AS ref_user_id FROM referrals r
      LEFT JOIN users u ON r.referrer_user_id = u.id
      WHERE r.referral_code = ? AND r.status = 'pending'
    `).bind(code.toUpperCase()).first<any>()
    if (!referral) return c.json({ error: 'Invalid or expired referral code' }, 404)
    if (String(referral.referrer_user_id) === String(user.id)) {
      return c.json({ error: 'You cannot use your own referral code' }, 400)
    }

    // Apply
    await db.batch([
      db.prepare('UPDATE users SET referred_by_code=? WHERE id=?').bind(code, user.id),
      db.prepare('UPDATE referrals SET referred_user_id=?, status=? WHERE referral_code=?')
        .bind(user.id, 'registered', code),
    ])

    return c.json({ success: true, message: 'Referral code applied! You\'ll receive $10 credit after your first booking.' })
  } catch (e: any) {
    return c.json({ error: 'Failed to apply referral code' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// WALLET
// ════════════════════════════════════════════════════════════════════════════

// GET /api/wallet — get wallet balance and recent transactions
featuresApiRoutes.get('/wallet', requireUserAuth(), async (c) => {
  const db   = c.env?.DB
  const user = c.get('user') as any
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  try {
    // Upsert wallet
    await db.prepare(`
      INSERT OR IGNORE INTO user_wallet (user_id, balance_cents) VALUES (?, 0)
    `).bind(user.id).run()

    const wallet = await db.prepare('SELECT * FROM user_wallet WHERE user_id=?')
      .bind(user.id).first<any>()

    const transactions = await db.prepare(`
      SELECT type, amount_cents, description, created_at
      FROM wallet_transactions WHERE user_id=?
      ORDER BY created_at DESC LIMIT 20
    `).bind(user.id).all<any>()

    return c.json({
      balance_cents: wallet?.balance_cents || 0,
      balance: '$' + ((wallet?.balance_cents || 0) / 100).toFixed(2),
      lifetime_earned: '$' + ((wallet?.lifetime_earned_cents || 0) / 100).toFixed(2),
      transactions: transactions.results || [],
    })
  } catch (e: any) {
    return c.json({ error: 'Failed to fetch wallet' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// FRAUD FLAGS (Admin + internal use)
// ════════════════════════════════════════════════════════════════════════════

// GET /api/fraud/flags — list recent fraud flags (admin only handled in admin-api, this is internal)
// POST /api/fraud/check/listing — run fraud check on a listing
featuresApiRoutes.post('/fraud/check/listing', requireUserAuth(), async (c) => {
  const db   = c.env?.DB
  const user = c.get('user') as any
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  let body: any = {}
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  const { listing_id } = body

  try {
    const listing = await db.prepare('SELECT id, host_id, lat, lng FROM listings WHERE id=? AND host_id=?')
      .bind(listing_id, user.id).first<any>()
    if (!listing) return c.json({ error: 'Listing not found' }, 404)

    const result = await checkListingFraud(db, {
      host_id:    listing.host_id,
      lat:        listing.lat,
      lng:        listing.lng,
      listing_id: listing.id,
    })

    if (result.flagged) {
      for (const flag of result.flags) {
        await db.prepare(`
          INSERT INTO fraud_flags (entity_type, entity_id, flag_type, severity, description)
          VALUES ('listing', ?, ?, ?, ?)
        `).bind(listing_id, flag.type, flag.severity, flag.description).run()
      }
      await db.prepare('UPDATE listings SET fraud_flags=fraud_flags+? WHERE id=?')
        .bind(result.flags.length, listing_id).run()
    }

    return c.json(result)
  } catch (e: any) {
    return c.json({ error: 'Fraud check failed' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// BOOKING CONFIRMATION ENRICHED API
// POST /api/booking/confirm-data — returns enriched data for the confirmation page
// ════════════════════════════════════════════════════════════════════════════
featuresApiRoutes.post('/booking/confirm-data', requireUserAuth(), async (c) => {
  const db   = c.env?.DB
  const user = c.get('user') as any
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  let body: any = {}
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  const { booking_id } = body
  if (!booking_id) return c.json({ error: 'booking_id required' }, 400)

  try {
    const row = await db.prepare(`
      SELECT b.id, b.listing_id, b.driver_id, b.host_id,
             b.start_time, b.end_time, b.total_charged, b.status,
             l.title, l.address, l.city, l.state, l.lat, l.lng,
             l.instructions AS parking_instructions,
             l.photos, l.avg_rating,
             u.full_name AS host_name, u.host_verified, u.host_trust_score
      FROM bookings b
      LEFT JOIN listings l ON b.listing_id = l.id
      LEFT JOIN users    u ON b.host_id    = u.id
      WHERE b.id = ? AND b.driver_id = ?
    `).bind(booking_id, user.id).first<any>()

    if (!row) return c.json({ error: 'Booking not found or access denied' }, 404)

    return c.json({
      booking_id: row.id,
      spot_id: row.listing_id,
      host_name: row.host_name,
      host_verified: !!row.host_verified,
      address: [row.address, row.city, row.state].filter(Boolean).join(', '),
      coordinates: { lat: row.lat, lng: row.lng },
      start_time: row.start_time,
      end_time: row.end_time,
      total_charged: row.total_charged,
      booking_status: row.status,
      parking_instructions: row.parking_instructions,
      avg_rating: row.avg_rating,
    })
  } catch (e: any) {
    return c.json({ error: 'Failed to fetch booking data' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// GET /api/bookings/by-intent?pi=<payment_intent_id>
// Used by the /booking/confirmation/pending page to poll for booking status
// after a Stripe 3DS redirect. Returns booking_id when the booking is confirmed.
// Auth required to prevent enumeration.
// ════════════════════════════════════════════════════════════════════════════
featuresApiRoutes.get('/bookings/by-intent', requireUserAuth(), async (c) => {
  const db   = c.env?.DB
  const user = c.get('user') as any
  if (!db) return c.json({ error: 'DB unavailable' }, 503)

  const pi = c.req.query('pi') || ''
  if (!pi || pi.length > 200) return c.json({ error: 'Invalid payment intent' }, 400)

  try {
    const booking = await db.prepare(
      `SELECT id FROM bookings
       WHERE stripe_payment_intent_id = ? AND driver_id = ?
       AND status IN ('confirmed','active','completed') LIMIT 1`
    ).bind(pi, user.id).first<any>()

    if (booking) return c.json({ booking_id: booking.id })

    // Also check most recent confirmed booking in last 15 minutes for this driver
    // (handles cases where the PI wasn't stored yet when Stripe redirected back)
    const recent = await db.prepare(
      `SELECT id FROM bookings
       WHERE driver_id = ? AND status IN ('confirmed','active')
       AND created_at >= datetime('now','-15 minutes')
       ORDER BY id DESC LIMIT 1`
    ).bind(user.id).first<any>()

    if (recent) return c.json({ booking_id: recent.id })

    return c.json({ booking_id: null, status: 'processing' })
  } catch (e: any) {
    return c.json({ error: 'Lookup failed' }, 500)
  }
})
