/**
 * ParkPeer Feature Services
 * Handles: Trust scores, Quality scores, Availability confidence,
 *          Fraud detection, Referral codes, Wallet operations
 */

// ════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════
export type AvailabilityConfidence = 'high' | 'medium' | 'low'

export interface ListingQualityFactors {
  has_photos: boolean
  has_description: boolean
  has_price: boolean
  has_schedule: boolean
  host_verified: boolean
  recent_bookings: number // last 30 days
  has_instructions: boolean
  address_verified: boolean
}

// ════════════════════════════════════════════════════════════════════════════
// HOST TRUST SCORE
// ════════════════════════════════════════════════════════════════════════════
export function calcHostTrustScore(opts: {
  stripe_connected: boolean
  id_verified: boolean
  completed_bookings: number
  avg_rating: number
  fraud_flags: number
  response_rate: number   // 0–1
  cancellation_rate: number // 0–1
}): number {
  if (opts.fraud_flags > 0) return Math.max(0, 30 - opts.fraud_flags * 10)

  let score = 0
  // Base eligibility gates (each gate contributes to score)
  if (opts.stripe_connected)    score += 20
  if (opts.id_verified)         score += 15
  if (opts.completed_bookings >= 3) score += 15

  // Continuous metrics
  const ratingScore = Math.min(opts.avg_rating / 5, 1) * 25
  const responseScore = Math.min(opts.response_rate, 1) * 15
  const cancelPenalty = Math.min(opts.cancellation_rate, 1) * 10

  score += ratingScore + responseScore - cancelPenalty
  return Math.round(Math.min(100, Math.max(0, score)))
}

export function isVerifiedHost(opts: {
  stripe_connected: boolean
  id_verified: boolean
  completed_bookings: number
  avg_rating: number
  fraud_flags: number
}): boolean {
  return (
    opts.stripe_connected &&
    opts.id_verified &&
    opts.completed_bookings >= 3 &&
    opts.avg_rating >= 4.5 &&
    opts.fraud_flags === 0
  )
}

// ════════════════════════════════════════════════════════════════════════════
// LISTING QUALITY SCORE (0–100)
// ════════════════════════════════════════════════════════════════════════════
export function calcQualityScore(f: ListingQualityFactors): number {
  let score = 0
  if (f.has_photos)        score += 20
  if (f.has_description)   score += 15
  if (f.has_price)         score += 10
  if (f.has_schedule)      score += 20
  if (f.host_verified)     score += 20
  if (f.address_verified)  score += 5
  if (f.has_instructions)  score += 5
  // Recent bookings: up to 25 pts, scales with activity (max at 10/month)
  score += Math.min(f.recent_bookings / 10, 1) * 25
  // Penalty for low description quality etc. already factored via absence
  return Math.round(Math.min(100, score))
}

export function qualityLabel(score: number): string {
  if (score >= 80) return 'Excellent'
  if (score >= 60) return 'Good'
  if (score >= 40) return 'Fair'
  return 'Needs Attention'
}

export function qualityColor(score: number): string {
  if (score >= 80) return '#22c55e'
  if (score >= 60) return '#3b82f6'
  if (score >= 40) return '#f59e0b'
  return '#ef4444'
}

export function qualitySuggestions(f: ListingQualityFactors): string[] {
  const suggestions: string[] = []
  if (!f.has_photos)       suggestions.push('Add at least 3 photos to boost bookings by 60%')
  if (!f.has_description)  suggestions.push('Write a description — drivers want to know what to expect')
  if (!f.has_price)        suggestions.push('Set an hourly or daily price to appear in search results')
  if (!f.has_schedule)     suggestions.push('Add your availability schedule so drivers know when to book')
  if (!f.host_verified)    suggestions.push('Complete host verification to earn the Verified badge')
  if (!f.has_instructions) suggestions.push('Add parking instructions to reduce driver confusion')
  if (!f.address_verified) suggestions.push('Verify your address for higher search ranking')
  return suggestions
}

// ════════════════════════════════════════════════════════════════════════════
// AVAILABILITY CONFIDENCE
// ════════════════════════════════════════════════════════════════════════════
export function calcAvailabilityConfidence(opts: {
  last_booking_at: string | null   // ISO date
  cancellation_rate: number        // 0–1
  booking_frequency: number        // bookings per 30 days
  host_response_rate: number       // 0–1
}): AvailabilityConfidence {
  let score = 0

  // Recent activity
  if (opts.last_booking_at) {
    const daysSince = (Date.now() - new Date(opts.last_booking_at).getTime()) / 86400000
    if (daysSince <= 7)  score += 30
    else if (daysSince <= 30) score += 15
    else if (daysSince <= 90) score += 5
  }

  // Booking frequency
  if (opts.booking_frequency >= 4)  score += 30
  else if (opts.booking_frequency >= 1) score += 15
  else if (opts.booking_frequency > 0)  score += 5

  // Host response rate
  score += Math.min(opts.host_response_rate, 1) * 25

  // Cancellation penalty
  score -= Math.min(opts.cancellation_rate, 1) * 30

  if (score >= 55) return 'high'
  if (score >= 25) return 'medium'
  return 'low'
}

export function confidenceBadgeHTML(level: AvailabilityConfidence): string {
  const map = {
    high:   { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   icon: 'fa-circle-check',   label: 'High Availability' },
    medium: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  icon: 'fa-circle-half-stroke', label: 'Moderate Availability' },
    low:    { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   icon: 'fa-circle-exclamation', label: 'Low Availability' },
  }
  const { color, bg, icon, label } = map[level]
  return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:${color};background:${bg};border:1px solid ${color}33;border-radius:20px;padding:3px 10px;">
    <i class="fas ${icon}" style="font-size:9px"></i>${label}
  </span>`
}

// ════════════════════════════════════════════════════════════════════════════
// REFERRAL CODE GENERATION
// ════════════════════════════════════════════════════════════════════════════
export function generateReferralCode(userId: number, name: string): string {
  const prefix = name.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 4) || 'PP'
  const suffix = (userId * 7919 + 1234).toString(36).toUpperCase().slice(0, 5)
  return `${prefix}${suffix}`
}

// ════════════════════════════════════════════════════════════════════════════
// FRAUD DETECTION
// ════════════════════════════════════════════════════════════════════════════
export interface FraudCheckResult {
  flagged: boolean
  flags: Array<{ type: string; severity: string; description: string }>
}

export async function checkListingFraud(db: any, listing: {
  host_id: number
  lat: number
  lng: number
  listing_id?: number
}): Promise<FraudCheckResult> {
  const flags: Array<{ type: string; severity: string; description: string }> = []

  try {
    // 1. Too many listings per host (>10 active)
    const countRow = await db.prepare(
      `SELECT COUNT(*) as cnt FROM listings WHERE host_id=? AND status='active'`
    ).bind(listing.host_id).first<any>()
    if ((countRow?.cnt || 0) > 10) {
      flags.push({ type: 'excessive_listings', severity: 'medium',
        description: `Host has ${countRow.cnt} active listings — exceeds limit of 10` })
    }

    // 2. Duplicate coordinates (within ~5m, different listing)
    const dupeRow = await db.prepare(`
      SELECT COUNT(*) as cnt FROM listings
      WHERE host_id != ?
        AND ABS(lat - ?) < 0.00005
        AND ABS(lng - ?) < 0.00005
        AND status = 'active'
        ${listing.listing_id ? 'AND id != ' + listing.listing_id : ''}
    `).bind(listing.host_id, listing.lat, listing.lng).first<any>()
    if ((dupeRow?.cnt || 0) > 0) {
      flags.push({ type: 'coordinate_duplicate', severity: 'high',
        description: 'Another listing exists at nearly identical coordinates' })
    }
  } catch (_) {}

  return { flagged: flags.length > 0, flags }
}

export async function checkBookingFraud(db: any, opts: {
  driver_id: number
  listing_id: number
  start_time: string
  end_time: string
}): Promise<FraudCheckResult> {
  const flags: Array<{ type: string; severity: string; description: string }> = []

  try {
    // Check for rapid booking attempts (>5 in 10 min)
    const rapidRow = await db.prepare(`
      SELECT COUNT(*) as cnt FROM bookings
      WHERE driver_id = ?
        AND created_at >= datetime('now', '-10 minutes')
    `).bind(opts.driver_id).first<any>()
    if ((rapidRow?.cnt || 0) >= 5) {
      flags.push({ type: 'rapid_booking', severity: 'high',
        description: 'More than 5 booking attempts in 10 minutes' })
    }

    // Overlapping bookings at same listing
    const overlapRow = await db.prepare(`
      SELECT COUNT(*) as cnt FROM bookings
      WHERE listing_id = ?
        AND status IN ('confirmed','pending')
        AND start_time < ?
        AND end_time > ?
    `).bind(opts.listing_id, opts.end_time, opts.start_time).first<any>()
    if ((overlapRow?.cnt || 0) > 0) {
      flags.push({ type: 'overlapping_booking', severity: 'critical',
        description: 'Requested time slot overlaps an existing confirmed booking' })
    }
  } catch (_) {}

  return { flagged: flags.length > 0, flags }
}

// ════════════════════════════════════════════════════════════════════════════
// HOST TRUST BADGE HTML
// ════════════════════════════════════════════════════════════════════════════
export function hostTrustBadgeHTML(opts: {
  verified: boolean
  trust_score: number
  size?: 'sm' | 'md' | 'lg'
}): string {
  if (!opts.verified) return ''
  const sizes = { sm: '10px', md: '12px', lg: '14px' }
  const sz = sizes[opts.size || 'md']
  return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:${sz};font-weight:700;color:#5B2EFF;background:rgba(91,46,255,0.1);border:1px solid rgba(91,46,255,0.3);border-radius:20px;padding:2px 8px;">
    <i class="fas fa-shield-check" style="font-size:${sz}"></i>Verified Host
  </span>`
}
