/**
 * ParkPeer Tier & Reward Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * DRIVER TIERS:  Nomad → Cruiser → Vaulted → Apex
 * HOST TIERS:    Steward → Curator → Prestige → Icon
 *
 * Mechanics:
 *  - Rolling 12-month window for tier qualification (r12_*)
 *  - Lifetime floor: once achieved, users never drop more than 1 tier
 *  - Grace period: 30-day protection after a downgrade-triggering event
 *  - Recalculation: triggered on booking_complete, review_posted, nightly_job
 *  - Credits: awarded on upgrade, monthly streak bonus, and review posting
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── TIER DEFINITIONS ────────────────────────────────────────────────────────

export interface TierDef {
  id: string
  rank: number          // 1 = lowest, 4 = highest
  name: string
  tagline: string
  description: string
  color: string         // Tailwind color key
  gradient: string      // CSS gradient for badge
  icon: string          // FontAwesome class
  // Qualification thresholds (ALL must be met for rolling-12-month window)
  req: {
    r12_completed:     number   // minimum completed bookings in last 12 months
    r12_spend?:        number   // drivers: minimum $ spent in last 12 months
    r12_revenue?:      number   // hosts: minimum $ earned in last 12 months
    min_avg_rating:    number   // minimum average rating (1–5)
    max_cancel_rate:   number   // maximum cancellation rate (0.0–1.0)
    max_response_hrs?: number   // hosts only: max avg response time in hours
    min_response_rate?: number  // hosts only: min acceptance rate (0.0–1.0)
    lifetime_floor:    number   // lifetime bookings needed to hold this tier
  }
  // Benefits
  benefits: {
    fee_discount_pct:      number   // 0.05 = 5% off platform fee
    priority_access:       boolean  // early access to high-demand spots
    instant_confirm:       boolean  // drivers: skip host approval queue
    listing_boost:         boolean  // hosts: boosted in search ranking
    featured_eligible:     boolean  // hosts: eligible for Featured badge
    credits_on_upgrade:    number   // loyalty credits awarded on reaching tier
    monthly_credits:       number   // credits awarded every full calendar month at tier
    support_priority:      'standard' | 'priority' | 'dedicated'
    analytics_unlocked:    boolean  // hosts: detailed analytics dashboard
    early_feature_access:  boolean  // beta features opt-in
  }
}

// ── DRIVER TIERS ─────────────────────────────────────────────────────────────
export const DRIVER_TIERS: Record<string, TierDef> = {
  nomad: {
    id: 'nomad', rank: 1,
    name: 'Nomad',
    tagline: 'Every journey starts here.',
    description: 'New to ParkPeer. Building a track record and exploring the network.',
    color: 'gray',
    gradient: 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
    icon: 'fa-compass',
    req: {
      r12_completed:  0,
      min_avg_rating: 0,
      max_cancel_rate: 1.0,
      lifetime_floor: 0,
    },
    benefits: {
      fee_discount_pct:     0,
      priority_access:      false,
      instant_confirm:      false,
      listing_boost:        false,
      featured_eligible:    false,
      credits_on_upgrade:   0,
      monthly_credits:      0,
      support_priority:     'standard',
      analytics_unlocked:   false,
      early_feature_access: false,
    },
  },

  cruiser: {
    id: 'cruiser', rank: 2,
    name: 'Cruiser',
    tagline: 'You know the roads.',
    description: 'A regular who\'s proven reliability. Unlocks fee savings and priority booking access.',
    color: 'indigo',
    gradient: 'linear-gradient(135deg, #5B2EFF 0%, #4a20f0 100%)',
    icon: 'fa-car',
    req: {
      r12_completed:  5,
      r12_spend:      50,
      min_avg_rating: 3.5,
      max_cancel_rate: 0.25,
      lifetime_floor: 3,
    },
    benefits: {
      fee_discount_pct:     0.03,    // 3% off platform fee
      priority_access:      false,
      instant_confirm:      false,
      listing_boost:        false,
      featured_eligible:    false,
      credits_on_upgrade:   5,       // $5 in loyalty credits
      monthly_credits:      1,       // $1/month while at tier
      support_priority:     'standard',
      analytics_unlocked:   false,
      early_feature_access: false,
    },
  },

  vaulted: {
    id: 'vaulted', rank: 3,
    name: 'Vaulted',
    tagline: 'Reserved for the reliable.',
    description: 'Consistent, high-rated driver with strong booking history. Gets instant-confirm and reduced fees.',
    color: 'violet',
    gradient: 'linear-gradient(135deg, #7c3aed 0%, #5B2EFF 100%)',
    icon: 'fa-shield-halved',
    req: {
      r12_completed:  20,
      r12_spend:      250,
      min_avg_rating: 4.2,
      max_cancel_rate: 0.10,
      lifetime_floor: 10,
    },
    benefits: {
      fee_discount_pct:     0.07,    // 7% off platform fee
      priority_access:      true,
      instant_confirm:      true,
      listing_boost:        false,
      featured_eligible:    false,
      credits_on_upgrade:   15,
      monthly_credits:      3,
      support_priority:     'priority',
      analytics_unlocked:   false,
      early_feature_access: true,
    },
  },

  apex: {
    id: 'apex', rank: 4,
    name: 'Apex',
    tagline: 'The pinnacle of the network.',
    description: 'Elite drivers with exceptional records. Maximum rewards, zero friction, top-of-network access.',
    color: 'lime',
    gradient: 'linear-gradient(135deg, #C6FF00 0%, #84cc16 100%)',
    icon: 'fa-bolt',
    req: {
      r12_completed:  50,
      r12_spend:      750,
      min_avg_rating: 4.7,
      max_cancel_rate: 0.05,
      lifetime_floor: 30,
    },
    benefits: {
      fee_discount_pct:     0.12,    // 12% off platform fee
      priority_access:      true,
      instant_confirm:      true,
      listing_boost:        false,
      featured_eligible:    false,
      credits_on_upgrade:   40,
      monthly_credits:      8,
      support_priority:     'dedicated',
      analytics_unlocked:   false,
      early_feature_access: true,
    },
  },
}

// ── HOST TIERS ────────────────────────────────────────────────────────────────
export const HOST_TIERS: Record<string, TierDef> = {
  steward: {
    id: 'steward', rank: 1,
    name: 'Steward',
    tagline: 'Your space, your start.',
    description: 'New host building their first listing and reputation on the platform.',
    color: 'gray',
    gradient: 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
    icon: 'fa-key',
    req: {
      r12_completed:  0,
      min_avg_rating: 0,
      max_cancel_rate: 1.0,
      max_response_hrs: 999,
      min_response_rate: 0,
      lifetime_floor: 0,
    },
    benefits: {
      fee_discount_pct:     0,
      priority_access:      false,
      instant_confirm:      false,
      listing_boost:        false,
      featured_eligible:    false,
      credits_on_upgrade:   0,
      monthly_credits:      0,
      support_priority:     'standard',
      analytics_unlocked:   false,
      early_feature_access: false,
    },
  },

  curator: {
    id: 'curator', rank: 2,
    name: 'Curator',
    tagline: 'Crafted spaces, trusted host.',
    description: 'Proven host with consistent bookings and positive reviews. Earns reduced fees and boosted visibility.',
    color: 'blue',
    gradient: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
    icon: 'fa-star-half-stroke',
    req: {
      r12_completed:  10,
      r12_revenue:    200,
      min_avg_rating: 3.8,
      max_cancel_rate: 0.20,
      max_response_hrs: 24,
      min_response_rate: 0.70,
      lifetime_floor: 5,
    },
    benefits: {
      fee_discount_pct:     0.02,    // 2% off platform cut (platform takes 13% instead of 15%)
      priority_access:      false,
      instant_confirm:      false,
      listing_boost:        true,    // +10% search ranking boost
      featured_eligible:    false,
      credits_on_upgrade:   10,
      monthly_credits:      2,
      support_priority:     'standard',
      analytics_unlocked:   false,
      early_feature_access: false,
    },
  },

  prestige: {
    id: 'prestige', rank: 3,
    name: 'Prestige',
    tagline: 'The benchmark of excellence.',
    description: 'High-performing host with strong ratings, fast response, and reliable income. Unlocked analytics and featured eligibility.',
    color: 'violet',
    gradient: 'linear-gradient(135deg, #7c3aed 0%, #5B2EFF 100%)',
    icon: 'fa-award',
    req: {
      r12_completed:  40,
      r12_revenue:    1000,
      min_avg_rating: 4.4,
      max_cancel_rate: 0.08,
      max_response_hrs: 8,
      min_response_rate: 0.85,
      lifetime_floor: 20,
    },
    benefits: {
      fee_discount_pct:     0.04,    // 4% off (platform takes 11%)
      priority_access:      false,
      instant_confirm:      false,
      listing_boost:        true,    // +25% search ranking boost
      featured_eligible:    true,
      credits_on_upgrade:   25,
      monthly_credits:      5,
      support_priority:     'priority',
      analytics_unlocked:   true,
      early_feature_access: true,
    },
  },

  icon: {
    id: 'icon', rank: 4,
    name: 'Icon',
    tagline: 'The gold standard of hosting.',
    description: 'Elite hosts who define the ParkPeer experience. Maximum visibility, minimum fees, dedicated support.',
    color: 'amber',
    gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    icon: 'fa-crown',
    req: {
      r12_completed:  100,
      r12_revenue:    3000,
      min_avg_rating: 4.7,
      max_cancel_rate: 0.03,
      max_response_hrs: 4,
      min_response_rate: 0.95,
      lifetime_floor: 50,
    },
    benefits: {
      fee_discount_pct:     0.07,    // 7% off (platform takes 8%)
      priority_access:      false,
      instant_confirm:      false,
      listing_boost:        true,    // +50% boost + homepage carousel eligible
      featured_eligible:    true,
      credits_on_upgrade:   60,
      monthly_credits:      12,
      support_priority:     'dedicated',
      analytics_unlocked:   true,
      early_feature_access: true,
    },
  },
}

export const DRIVER_TIER_ORDER = ['nomad','cruiser','vaulted','apex'] as const
export const HOST_TIER_ORDER   = ['steward','curator','prestige','icon'] as const

// ─── METRIC CALCULATION ──────────────────────────────────────────────────────

export interface TierMetrics {
  r12_completed:      number
  r12_spend:          number
  r12_revenue:        number
  r12_avg_rating:     number
  r12_cancel_rate:    number
  r12_response_rate:  number
  r12_avg_response_hrs: number
  lifetime_completed: number
  lifetime_spend:     number
  lifetime_revenue:   number
}

/**
 * Fetch all raw metrics for a user from D1 in a single-pass multi-query.
 * Called by recalculateTier() on every trigger event.
 */
export async function fetchMetrics(db: D1Database, userId: number, role: 'DRIVER' | 'HOST'): Promise<TierMetrics> {
  const cutoff = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString() // 12 months ago

  if (role === 'DRIVER') {
    // Rolling-12-month driver metrics
    const r12 = await db.prepare(`
      SELECT
        COUNT(CASE WHEN status='completed' THEN 1 END)                          AS r12_completed,
        COALESCE(SUM(CASE WHEN status='completed' THEN total_charged END), 0)   AS r12_spend,
        COUNT(CASE WHEN status='cancelled' AND cancelled_by='driver' THEN 1 END) AS r12_driver_cancels,
        COUNT(CASE WHEN status IN ('completed','cancelled') THEN 1 END)         AS r12_total_closed
      FROM bookings
      WHERE driver_id = ? AND created_at >= ?
    `).bind(userId, cutoff).first<any>()

    // Rolling-12-month average rating (reviews left on driver's bookings)
    const ratingRow = await db.prepare(`
      SELECT AVG(r.rating) AS avg_r
      FROM reviews r
      JOIN bookings b ON r.booking_id = b.id
      WHERE b.driver_id = ? AND b.status = 'completed' AND b.created_at >= ?
    `).bind(userId, cutoff).first<any>()

    // Lifetime
    const life = await db.prepare(`
      SELECT
        COUNT(CASE WHEN status='completed' THEN 1 END) AS lifetime_completed,
        COALESCE(SUM(CASE WHEN status='completed' THEN total_charged END), 0) AS lifetime_spend
      FROM bookings WHERE driver_id = ?
    `).bind(userId).first<any>()

    const r12_total_closed = r12?.r12_total_closed || 0
    const r12_cancel_rate  = r12_total_closed > 0
      ? (r12?.r12_driver_cancels || 0) / r12_total_closed
      : 0

    return {
      r12_completed:        r12?.r12_completed        ?? 0,
      r12_spend:            r12?.r12_spend             ?? 0,
      r12_revenue:          0,
      r12_avg_rating:       ratingRow?.avg_r            ? Math.round(ratingRow.avg_r * 100) / 100 : 0,
      r12_cancel_rate:      Math.round(r12_cancel_rate  * 1000) / 1000,
      r12_response_rate:    0,
      r12_avg_response_hrs: 0,
      lifetime_completed:   life?.lifetime_completed   ?? 0,
      lifetime_spend:       life?.lifetime_spend        ?? 0,
      lifetime_revenue:     0,
    }
  } else {
    // HOST
    const r12 = await db.prepare(`
      SELECT
        COUNT(CASE WHEN b.status='completed' THEN 1 END)                                AS r12_completed,
        COALESCE(SUM(CASE WHEN b.status='completed' THEN p.host_payout END), 0)         AS r12_revenue,
        COUNT(CASE WHEN b.status='cancelled' AND b.cancelled_by='host' THEN 1 END)      AS r12_host_cancels,
        COUNT(CASE WHEN b.status IN ('completed','cancelled') THEN 1 END)               AS r12_total_closed,
        COUNT(CASE WHEN b.status IN ('confirmed','completed','cancelled') THEN 1 END)   AS r12_responded,
        COUNT(b.id)                                                                      AS r12_total_requests
      FROM bookings b
      LEFT JOIN payments p ON p.booking_id = b.id AND p.status = 'succeeded'
      WHERE b.host_id = ? AND b.created_at >= ?
    `).bind(userId, cutoff).first<any>()

    const ratingRow = await db.prepare(`
      SELECT AVG(l.avg_rating) AS avg_r
      FROM listings l
      WHERE l.host_id = ? AND l.status = 'active' AND l.avg_rating > 0
    `).bind(userId).first<any>()

    const life = await db.prepare(`
      SELECT
        COUNT(CASE WHEN b.status='completed' THEN 1 END) AS lifetime_completed,
        COALESCE(SUM(CASE WHEN p.status='succeeded' THEN p.host_payout END), 0) AS lifetime_revenue
      FROM bookings b
      LEFT JOIN payments p ON p.booking_id = b.id
      WHERE b.host_id = ?
    `).bind(userId).first<any>()

    const r12_total_closed = r12?.r12_total_closed || 0
    const r12_cancel_rate  = r12_total_closed > 0
      ? (r12?.r12_host_cancels || 0) / r12_total_closed : 0
    const r12_total_req    = r12?.r12_total_requests || 0
    const r12_response_rate = r12_total_req > 0
      ? (r12?.r12_responded || 0) / r12_total_req : 0

    // Avg response time (hours) from bookings.created_at → bookings.updated_at for accepted/declined
    const respTime = await db.prepare(`
      SELECT AVG(
        (JULIANDAY(updated_at) - JULIANDAY(created_at)) * 24
      ) AS avg_hrs
      FROM bookings
      WHERE host_id = ?
        AND status IN ('confirmed','cancelled')
        AND created_at >= ?
        AND cancelled_by != 'driver'
    `).bind(userId, cutoff).first<any>()

    return {
      r12_completed:        r12?.r12_completed       ?? 0,
      r12_spend:            0,
      r12_revenue:          r12?.r12_revenue          ?? 0,
      r12_avg_rating:       ratingRow?.avg_r           ? Math.round(ratingRow.avg_r * 100) / 100 : 0,
      r12_cancel_rate:      Math.round(r12_cancel_rate * 1000) / 1000,
      r12_response_rate:    Math.round(r12_response_rate * 1000) / 1000,
      r12_avg_response_hrs: respTime?.avg_hrs          ? Math.round(respTime.avg_hrs * 10) / 10 : 999,
      lifetime_completed:   life?.lifetime_completed  ?? 0,
      lifetime_spend:       0,
      lifetime_revenue:     life?.lifetime_revenue     ?? 0,
    }
  }
}

// ─── TIER QUALIFICATION ──────────────────────────────────────────────────────

/**
 * Returns the highest tier the user qualifies for given current metrics.
 * Checks ALL requirements; the tier with the highest rank that passes wins.
 */
export function qualifyTier(metrics: TierMetrics, role: 'DRIVER' | 'HOST'): string {
  const tierOrder = role === 'DRIVER' ? DRIVER_TIER_ORDER : HOST_TIER_ORDER
  const tierMap   = role === 'DRIVER' ? DRIVER_TIERS      : HOST_TIERS

  let qualified = tierOrder[0] // default = base tier

  for (const tierId of tierOrder) {
    const t = tierMap[tierId]
    const r = t.req

    const passes =
      metrics.r12_completed  >= r.r12_completed  &&
      metrics.r12_avg_rating >= r.min_avg_rating &&
      metrics.r12_cancel_rate <= r.max_cancel_rate &&
      metrics.lifetime_completed >= r.lifetime_floor &&
      (r.r12_spend    === undefined || metrics.r12_spend    >= r.r12_spend)    &&
      (r.r12_revenue  === undefined || metrics.r12_revenue  >= r.r12_revenue)  &&
      (r.max_response_hrs  === undefined || metrics.r12_avg_response_hrs <= r.max_response_hrs) &&
      (r.min_response_rate === undefined || metrics.r12_response_rate    >= r.min_response_rate)

    if (passes) qualified = tierId
  }

  return qualified
}

/**
 * Calculate progress (0.0–1.0) toward the next tier.
 * Returns 1.0 if already at max tier.
 * Uses the metric that is furthest from meeting next tier as the bottleneck.
 */
export function progressToNext(metrics: TierMetrics, currentTier: string, role: 'DRIVER' | 'HOST'): number {
  const tierOrder = role === 'DRIVER' ? DRIVER_TIER_ORDER : HOST_TIER_ORDER
  const tierMap   = role === 'DRIVER' ? DRIVER_TIERS      : HOST_TIERS

  const currentIdx = tierOrder.indexOf(currentTier as any)
  if (currentIdx === -1 || currentIdx >= tierOrder.length - 1) return 1.0

  const next = tierMap[tierOrder[currentIdx + 1]]
  const r    = next.req

  // Compute progress for each required metric (0.0–1.0 each)
  const progresses: number[] = []

  if (r.r12_completed > 0)
    progresses.push(Math.min(1, metrics.r12_completed / r.r12_completed))

  if (r.r12_spend && r.r12_spend > 0)
    progresses.push(Math.min(1, metrics.r12_spend / r.r12_spend))

  if (r.r12_revenue && r.r12_revenue > 0)
    progresses.push(Math.min(1, metrics.r12_revenue / r.r12_revenue))

  if (r.min_avg_rating > 0)
    progresses.push(Math.min(1, metrics.r12_avg_rating / r.min_avg_rating))

  // Cancel rate: inverted (lower is better). Progress = how close we are to the max allowed.
  // If cancel rate is already at 0, progress = 1.
  if (r.max_cancel_rate < 1.0) {
    const cancelProgress = metrics.r12_cancel_rate <= r.max_cancel_rate
      ? 1.0
      : Math.max(0, 1 - (metrics.r12_cancel_rate - r.max_cancel_rate) / r.max_cancel_rate)
    progresses.push(cancelProgress)
  }

  if (progresses.length === 0) return 0
  // Overall progress = minimum of all individual metric progresses (bottleneck)
  return Math.round(Math.min(...progresses) * 1000) / 1000
}

// ─── NEXT-TIER REQUIREMENTS HINTS ────────────────────────────────────────────

export interface TierGap {
  metric: string
  current: number | string
  required: number | string
  unit: string
  pct_complete: number
}

/**
 * Returns a list of gaps between current metrics and next tier requirements.
 * Used to power the progress hints in the UI.
 */
export function getNextTierGaps(metrics: TierMetrics, currentTier: string, role: 'DRIVER' | 'HOST'): TierGap[] {
  const tierOrder = role === 'DRIVER' ? DRIVER_TIER_ORDER : HOST_TIER_ORDER
  const tierMap   = role === 'DRIVER' ? DRIVER_TIERS      : HOST_TIERS

  const currentIdx = tierOrder.indexOf(currentTier as any)
  if (currentIdx === -1 || currentIdx >= tierOrder.length - 1) return []

  const next = tierMap[tierOrder[currentIdx + 1]]
  const r    = next.req
  const gaps: TierGap[] = []

  if (r.r12_completed > 0) gaps.push({
    metric: 'Completed bookings (12mo)',
    current: metrics.r12_completed,
    required: r.r12_completed,
    unit: 'bookings',
    pct_complete: Math.min(100, Math.round(metrics.r12_completed / r.r12_completed * 100)),
  })
  if (r.r12_spend && r.r12_spend > 0) gaps.push({
    metric: 'Total spend (12mo)',
    current: `$${metrics.r12_spend.toFixed(0)}`,
    required: `$${r.r12_spend}`,
    unit: 'USD',
    pct_complete: Math.min(100, Math.round(metrics.r12_spend / r.r12_spend * 100)),
  })
  if (r.r12_revenue && r.r12_revenue > 0) gaps.push({
    metric: 'Total earnings (12mo)',
    current: `$${metrics.r12_revenue.toFixed(0)}`,
    required: `$${r.r12_revenue}`,
    unit: 'USD',
    pct_complete: Math.min(100, Math.round(metrics.r12_revenue / r.r12_revenue * 100)),
  })
  if (r.min_avg_rating > 0) gaps.push({
    metric: 'Average rating',
    current: metrics.r12_avg_rating.toFixed(1),
    required: r.min_avg_rating.toFixed(1),
    unit: '★',
    pct_complete: Math.min(100, Math.round(metrics.r12_avg_rating / r.min_avg_rating * 100)),
  })
  if (r.max_cancel_rate < 1.0) gaps.push({
    metric: 'Cancellation rate',
    current: `${(metrics.r12_cancel_rate * 100).toFixed(1)}%`,
    required: `≤ ${(r.max_cancel_rate * 100).toFixed(0)}%`,
    unit: '%',
    pct_complete: metrics.r12_cancel_rate <= r.max_cancel_rate
      ? 100
      : Math.max(0, Math.round((1 - (metrics.r12_cancel_rate - r.max_cancel_rate) / r.max_cancel_rate) * 100)),
  })
  if (r.max_response_hrs && r.max_response_hrs < 999) gaps.push({
    metric: 'Avg response time',
    current: metrics.r12_avg_response_hrs < 900
      ? `${metrics.r12_avg_response_hrs.toFixed(1)}h` : 'N/A',
    required: `≤ ${r.max_response_hrs}h`,
    unit: 'hours',
    pct_complete: metrics.r12_avg_response_hrs <= r.max_response_hrs
      ? 100
      : Math.max(0, Math.round((r.max_response_hrs / metrics.r12_avg_response_hrs) * 100)),
  })

  return gaps
}

// ─── MAIN RECALCULATION FUNCTION ─────────────────────────────────────────────

export interface RecalcResult {
  userId:       number
  role:         'DRIVER' | 'HOST'
  prevTier:     string
  newTier:      string
  changed:      boolean
  changeType:   'upgrade' | 'downgrade' | 'no_change' | 'init'
  metrics:      TierMetrics
  progress:     number
  creditsAwarded: number
}

const GRACE_PERIOD_DAYS = 30

/**
 * Full tier recalculation for a single user.
 * - Fetches live metrics from D1
 * - Determines qualified tier
 * - Applies lifetime floor protection (never drop more than 1 tier)
 * - Applies grace period on downgrade
 * - Updates user_tier_state
 * - Logs to tier_history
 * - Queues tier_notifications
 * - Updates loyalty_ledger on upgrade
 * - Syncs denormalized users.tier_driver / users.tier_host
 *
 * @param db        D1Database binding
 * @param userId    User ID
 * @param role      'DRIVER' | 'HOST'
 * @param trigger   Event that caused this recalc
 */
export async function recalculateTier(
  db: D1Database,
  userId: number,
  role: 'DRIVER' | 'HOST',
  trigger: string = 'nightly_job'
): Promise<RecalcResult> {

  // 1. Fetch or create current state row
  let state: any = await db.prepare(
    'SELECT * FROM user_tier_state WHERE user_id = ? AND role = ?'
  ).bind(userId, role).first()

  const isInit = !state

  if (isInit) {
    await db.prepare(`
      INSERT INTO user_tier_state (user_id, role, current_tier, recalc_trigger)
      VALUES (?, ?, ?, 'init')
    `).bind(userId, role, role === 'DRIVER' ? 'nomad' : 'steward').run()

    state = await db.prepare(
      'SELECT * FROM user_tier_state WHERE user_id = ? AND role = ?'
    ).bind(userId, role).first()
  }

  const prevTier = state.current_tier

  // 2. Fetch live metrics
  const metrics = await fetchMetrics(db, userId, role)

  // 3. Determine qualified tier from metrics
  const rawQualified = qualifyTier(metrics, role)

  // 4. Lifetime floor protection: never drop more than 1 tier below lifetime peak
  //    Lifetime peak is derived from lifetime_completed vs tier floors
  const tierOrder = role === 'DRIVER' ? DRIVER_TIER_ORDER : HOST_TIER_ORDER
  const tierMap   = role === 'DRIVER' ? DRIVER_TIERS      : HOST_TIERS
  let floorTier   = tierOrder[0]
  for (const tid of tierOrder) {
    if (metrics.lifetime_completed >= tierMap[tid].req.lifetime_floor) {
      floorTier = tid
    }
  }
  const floorIdx = tierOrder.indexOf(floorTier as any)
  const floorProtected = floorIdx > 0 ? tierOrder[Math.max(0, floorIdx - 1)] : tierOrder[0]

  const qualifiedIdx     = tierOrder.indexOf(rawQualified as any)
  const floorProtectedIdx = tierOrder.indexOf(floorProtected as any)
  const effectiveIdx     = Math.max(qualifiedIdx, floorProtectedIdx)
  let newTier            = tierOrder[effectiveIdx]

  // 5. Grace period: if downgrading, check/set grace period
  let changeType: RecalcResult['changeType'] = 'no_change'
  const prevIdx = tierOrder.indexOf(prevTier as any)
  const newIdx  = tierOrder.indexOf(newTier  as any)

  if (isInit) {
    changeType = 'init'
  } else if (newIdx > prevIdx) {
    changeType = 'upgrade'
  } else if (newIdx < prevIdx) {
    // Check if in grace period
    if (state.is_protected && state.grace_period_ends) {
      const graceEnd = new Date(state.grace_period_ends)
      if (graceEnd > new Date()) {
        // Still in grace — hold at previous tier
        newTier    = prevTier
        changeType = 'no_change'
      } else {
        // Grace expired — apply downgrade
        changeType = 'downgrade'
      }
    } else {
      // Start grace period (hold at current tier, schedule downgrade)
      changeType = 'no_change'
      const graceEnd = new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 3600 * 1000).toISOString()
      await db.prepare(`
        UPDATE user_tier_state
        SET is_protected = 1, grace_period_ends = ?, demotion_warning_sent = 0, updated_at = datetime('now')
        WHERE user_id = ? AND role = ?
      `).bind(graceEnd, userId, role).run()

      // Queue grace warning notification
      await db.prepare(`
        INSERT INTO tier_notifications (user_id, notif_type, tier_from, tier_to, message)
        VALUES (?, 'grace_warning', ?, ?, ?)
      `).bind(userId, prevTier, newTier,
        `Your ${TIER_DISPLAY[role][prevTier]?.name || prevTier} status is at risk. ` +
        `You have 30 days to meet the requirements again or your tier will be adjusted.`
      ).run()

      newTier = prevTier // hold during grace
    }
  } else {
    // Same tier — clear grace if metrics now pass again
    if (state.is_protected && newIdx >= prevIdx) {
      await db.prepare(`
        UPDATE user_tier_state
        SET is_protected = 0, grace_period_ends = NULL, updated_at = datetime('now')
        WHERE user_id = ? AND role = ?
      `).bind(userId, role).run()
    }
  }

  // 6. Calculate progress and credits
  const progress       = progressToNext(metrics, newTier, role)
  let creditsAwarded   = 0

  // 7. Apply update to user_tier_state
  const tierDef = tierMap[newTier]
  await db.prepare(`
    UPDATE user_tier_state SET
      current_tier            = ?,
      tier_since              = CASE WHEN current_tier != ? THEN datetime('now') ELSE tier_since END,
      r12_completed_bookings  = ?,
      r12_total_spend         = ?,
      r12_total_revenue       = ?,
      r12_avg_rating          = ?,
      r12_cancellation_rate   = ?,
      r12_response_rate       = ?,
      r12_avg_response_hours  = ?,
      lifetime_completed      = ?,
      lifetime_spend          = ?,
      lifetime_revenue        = ?,
      progress_to_next        = ?,
      fee_discount_pct        = ?,
      priority_access         = ?,
      instant_confirm         = ?,
      listing_boost_active    = ?,
      featured_eligible       = ?,
      last_recalculated       = datetime('now'),
      recalc_trigger          = ?,
      updated_at              = datetime('now')
    WHERE user_id = ? AND role = ?
  `).bind(
    newTier, newTier,
    metrics.r12_completed, metrics.r12_spend, metrics.r12_revenue,
    metrics.r12_avg_rating, metrics.r12_cancel_rate, metrics.r12_response_rate, metrics.r12_avg_response_hrs,
    metrics.lifetime_completed, metrics.lifetime_spend, metrics.lifetime_revenue,
    progress,
    tierDef.benefits.fee_discount_pct,
    tierDef.benefits.priority_access ? 1 : 0,
    tierDef.benefits.instant_confirm ? 1 : 0,
    tierDef.benefits.listing_boost ? 1 : 0,
    tierDef.benefits.featured_eligible ? 1 : 0,
    trigger,
    userId, role
  ).run()

  // 8. Tier changed — log history + award credits + notify
  if (changeType === 'upgrade' || changeType === 'downgrade') {
    // Log history
    await db.prepare(`
      INSERT INTO tier_history
        (user_id, role, from_tier, to_tier, change_type,
         snap_r12_completed, snap_r12_spend, snap_r12_revenue, snap_r12_avg_rating,
         snap_r12_cancel_rate, snap_lifetime, trigger_event)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      userId, role, prevTier, newTier, changeType,
      metrics.r12_completed, metrics.r12_spend, metrics.r12_revenue,
      metrics.r12_avg_rating, metrics.r12_cancel_rate, metrics.lifetime_completed,
      trigger
    ).run()

    // Award upgrade credits
    if (changeType === 'upgrade') {
      creditsAwarded = tierDef.benefits.credits_on_upgrade

      if (creditsAwarded > 0) {
        const newBalance = (state.loyalty_credits || 0) + creditsAwarded
        await db.prepare(`
          UPDATE user_tier_state SET loyalty_credits = ? WHERE user_id = ? AND role = ?
        `).bind(newBalance, userId, role).run()

        await db.prepare(`
          INSERT INTO loyalty_ledger (user_id, delta, balance_after, reason, reference_type)
          VALUES (?, ?, ?, 'tier_upgrade', 'tier_event')
        `).bind(userId, creditsAwarded, newBalance, role).run()
      }

      // Upgrade notification
      const tierName = tierDef.name
      const msg = creditsAwarded > 0
        ? `🎉 You've reached ${tierName}! You've been awarded $${creditsAwarded.toFixed(2)} in loyalty credits.`
        : `🎉 You've reached ${tierName}! Enjoy your new benefits.`
      await db.prepare(`
        INSERT INTO tier_notifications (user_id, notif_type, tier_from, tier_to, message, credits_delta)
        VALUES (?, 'upgrade', ?, ?, ?, ?)
      `).bind(userId, prevTier, newTier, msg, creditsAwarded).run()

      // Clear grace period flags after upgrade
      await db.prepare(`
        UPDATE user_tier_state
        SET is_protected = 0, grace_period_ends = NULL, demotion_warning_sent = 0
        WHERE user_id = ? AND role = ?
      `).bind(userId, role).run()
    }

    if (changeType === 'downgrade') {
      const prevName = TIER_DISPLAY[role][prevTier]?.name || prevTier
      const newName  = tierDef.name
      await db.prepare(`
        INSERT INTO tier_notifications (user_id, notif_type, tier_from, tier_to, message)
        VALUES (?, 'downgrade', ?, ?, ?)
      `).bind(userId, prevTier, newTier,
        `Your tier has been updated to ${newName}. ` +
        `Keep booking and maintaining your ratings to climb back to ${prevName}.`
      ).run()

      // Clear grace period after applying downgrade
      await db.prepare(`
        UPDATE user_tier_state
        SET is_protected = 0, grace_period_ends = NULL, demotion_warning_sent = 0
        WHERE user_id = ? AND role = ?
      `).bind(userId, role).run()
    }
  }

  // 9. Sync denormalized column on users table (fast-path reads)
  if (!isInit && (changeType === 'upgrade' || changeType === 'downgrade' || isInit)) {
    const col = role === 'DRIVER' ? 'tier_driver' : 'tier_host'
    await db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).bind(newTier, userId).run()
  }

  // 10. Near-upgrade notification (send once when progress >= 80%)
  if (progress >= 0.80 && progress < 1.0 && !isInit && changeType === 'no_change') {
    const nextTierOrder = tierOrder[tierOrder.indexOf(newTier as any) + 1]
    if (nextTierOrder) {
      const nextDef  = tierMap[nextTierOrder]
      const gaps     = getNextTierGaps(metrics, newTier, role)
      const topGap   = gaps.find(g => g.pct_complete < 100)
      const hintText = topGap
        ? ` You're ${100 - topGap.pct_complete}% away on ${topGap.metric}.`
        : ''
      // Only send if no recent near-upgrade notif (check last 7 days)
      const recentNotif = await db.prepare(`
        SELECT id FROM tier_notifications
        WHERE user_id = ? AND notif_type = 'near_upgrade'
          AND created_at > datetime('now', '-7 days')
        LIMIT 1
      `).bind(userId).first()
      if (!recentNotif) {
        await db.prepare(`
          INSERT INTO tier_notifications (user_id, notif_type, tier_from, tier_to, message)
          VALUES (?, 'near_upgrade', ?, ?, ?)
        `).bind(userId, newTier, nextTierOrder,
          `You're 80%+ of the way to ${nextDef.name}!${hintText}`
        ).run()
      }
    }
  }

  return {
    userId,
    role,
    prevTier,
    newTier,
    changed:  prevTier !== newTier,
    changeType: isInit ? 'init' : changeType === 'no_change' && prevTier === newTier ? 'no_change' : changeType,
    metrics,
    progress,
    creditsAwarded,
  }
}

// ─── DISPLAY HELPERS ─────────────────────────────────────────────────────────

export const TIER_DISPLAY: Record<string, Record<string, TierDef>> = {
  DRIVER: DRIVER_TIERS,
  HOST:   HOST_TIERS,
}

export function getTierDef(role: 'DRIVER' | 'HOST', tierId: string): TierDef {
  const map = role === 'DRIVER' ? DRIVER_TIERS : HOST_TIERS
  return map[tierId] || (role === 'DRIVER' ? DRIVER_TIERS.nomad : HOST_TIERS.steward)
}

export function getTierOrder(role: 'DRIVER' | 'HOST'): readonly string[] {
  return role === 'DRIVER' ? DRIVER_TIER_ORDER : HOST_TIER_ORDER
}

export function isMaxTier(tierId: string, role: 'DRIVER' | 'HOST'): boolean {
  const order = getTierOrder(role)
  return tierId === order[order.length - 1]
}

/**
 * Format loyalty credits as dollar amount.
 * 1 credit = $1 USD in fee offset.
 */
export function formatCredits(credits: number): string {
  return `$${credits.toFixed(2)}`
}
