import { Hono } from 'hono'
import { Layout } from '../components/layout'
import { requireUserAuth } from '../middleware/security'
import { recalculateTier, getTierDef, getNextTierGaps, progressToNext } from '../services/tiers'
import { renderTierCard } from '../components/tier-card'

type Bindings = { DB: D1Database; USER_TOKEN_SECRET: string }

export const driverDashboard = new Hono<{ Bindings: Bindings }>()

// ── Protect ALL /dashboard/* routes — redirect unauthenticated users to login ──────
driverDashboard.use('/*', requireUserAuth({ redirectOnFail: true }))

// ── Role guard: HOST-only users are redirected to /host ───────────────────────
driverDashboard.use('/*', async (c, next) => {
  const session = c.get('user') as any
  const role = (session?.role || '').toUpperCase()
  if (role === 'HOST') {
    // Pure hosts should use /host, not /dashboard
    return c.redirect('/host?reason=wrong_role')
  }
  await next()
})

driverDashboard.get('/', async (c) => {
  const db = c.env?.DB
  const session = c.get('user') as any
  const userId = session?.userId

  // ── Real D1 queries ────────────────────────────────────────────────────────
  let totalBookings = 0
  let totalSpent    = 0
  let avgRating     = 0
  let upcomingList: any[] = []
  let historyList:  any[] = []
  let activeBooking: any  = null
  let driverName = ''
  let tierCardHTML = ''
  let savingsData: any = null

  if (db && userId) {
    try {
      // Fetch driver's display name
      const nameRow = await db.prepare('SELECT full_name FROM users WHERE id = ?').bind(userId).first<{full_name: string}>()
      driverName = nameRow?.full_name || ''

      // ── Tier data (recalculate on each dashboard load for freshness) ──────
      try {
        const tierResult = await recalculateTier(db, userId, 'DRIVER', 'dashboard_load')
        const tierState: any = await db.prepare(
          'SELECT * FROM user_tier_state WHERE user_id = ? AND role = ?'
        ).bind(userId, 'DRIVER').first()

        if (tierState) {
          const tierDef = getTierDef('DRIVER', tierState.current_tier)
          const metrics = {
            r12_completed:      tierState.r12_completed_bookings,
            r12_spend:          tierState.r12_total_spend,
            r12_revenue:        0,
            r12_avg_rating:     tierState.r12_avg_rating,
            r12_cancel_rate:    tierState.r12_cancellation_rate,
            r12_response_rate:  0,
            r12_avg_response_hrs: 0,
            lifetime_completed: tierState.lifetime_completed,
            lifetime_spend:     tierState.lifetime_spend,
            lifetime_revenue:   0,
          }
          const gaps = getNextTierGaps(metrics, tierState.current_tier, 'DRIVER')
          tierCardHTML = renderTierCard({
            role:            'DRIVER',
            current_tier:    tierState.current_tier,
            tier_name:       tierDef.name,
            tier_tagline:    tierDef.tagline,
            tier_since:      tierState.tier_since,
            tier_gradient:   tierDef.gradient,
            tier_icon:       tierDef.icon,
            tier_rank:       tierDef.rank,
            progress_to_next: tierState.progress_to_next,
            is_max_tier:     tierState.current_tier === 'apex',
            next_tier:       tierState.current_tier !== 'apex'
              ? (() => { const o = ['nomad','cruiser','vaulted','apex']; const i = o.indexOf(tierState.current_tier); return i < 3 ? { id: o[i+1], name: getTierDef('DRIVER',o[i+1]).name, icon: getTierDef('DRIVER',o[i+1]).icon } : null })()
              : null,
            benefits:        tierDef.benefits as any,
            metrics,
            gaps,
            loyalty_credits: tierState.loyalty_credits,
            is_protected:    !!tierState.is_protected,
            grace_period_ends: tierState.grace_period_ends,
            consecutive_months: tierState.consecutive_months || 0,
          })
        }
      } catch(tierErr: any) {
        console.error('[driver-dashboard] tier error:', tierErr.message)
      }

      // Stats scoped to this driver
      const stats = await db.prepare(`
        SELECT
          COUNT(*) as total_bookings,
          COALESCE(SUM(CASE WHEN status='completed' THEN total_charged ELSE 0 END), 0) as total_spent
        FROM bookings
        WHERE driver_id = ?
          AND status IN ('pending','confirmed','active','completed','cancelled')
        LIMIT 1
      `).bind(userId).first<any>()
      totalBookings = stats?.total_bookings ?? 0
      totalSpent    = Math.round((stats?.total_spent ?? 0) * 100) / 100

      // Active booking for this driver
      const active = await db.prepare(`
        SELECT b.id, b.start_time, b.end_time, b.total_charged, b.status,
               l.title, l.address
        FROM bookings b
        JOIN listings l ON b.listing_id = l.id
        WHERE b.driver_id = ? AND b.status = 'active'
        ORDER BY b.start_time ASC
        LIMIT 1
      `).bind(userId).first<any>()
      activeBooking = active || null

      // Upcoming confirmed bookings for this driver
      const upcoming = await db.prepare(`
        SELECT b.id, b.start_time, b.end_time, b.total_charged, b.status,
               l.title, l.address, l.type
        FROM bookings b
        JOIN listings l ON b.listing_id = l.id
        WHERE b.driver_id = ?
          AND b.status IN ('confirmed','pending')
          AND b.start_time > datetime('now')
        ORDER BY b.start_time ASC
        LIMIT 5
      `).bind(userId).all<any>()
      upcomingList = upcoming.results || []

      // Booking history for this driver
      const history = await db.prepare(`
        SELECT b.id, b.start_time, b.end_time, b.total_charged, b.status,
               l.title, l.address,
               r.rating
        FROM bookings b
        JOIN listings l ON b.listing_id = l.id
        LEFT JOIN reviews r ON r.booking_id = b.id
        WHERE b.driver_id = ?
          AND b.status IN ('completed','cancelled')
        ORDER BY b.end_time DESC
        LIMIT 8
      `).bind(userId).all<any>()
      historyList = history.results || []

      // Avg rating given by this driver
      const ratingRow = await db.prepare(`
        SELECT AVG(r.rating) as avg_r
        FROM reviews r
        JOIN bookings b ON r.booking_id = b.id
        WHERE b.driver_id = ? AND b.status = 'completed'
      `).bind(userId).first<any>()
      avgRating = ratingRow?.avg_r ? Math.round(ratingRow.avg_r * 10) / 10 : 0

      // ── Savings data ─────────────────────────────────────────────────────
      try {
        const savingsRow = await db.prepare(
          'SELECT * FROM driver_savings WHERE driver_id = ?'
        ).bind(userId).first<any>()
        if (savingsRow) {
          let nbhd: any[] = []
          try { nbhd = JSON.parse(savingsRow.neighborhood_breakdown || '[]') } catch {}
          savingsData = {
            total_bookings:   savingsRow.total_bookings,
            total_savings:    Math.round(savingsRow.total_savings * 100) / 100,
            total_paid:       Math.round(savingsRow.total_amount_paid * 100) / 100,
            avg_paid:         savingsRow.total_bookings > 0
              ? Math.round(savingsRow.total_amount_paid / savingsRow.total_bookings * 100) / 100
              : 0,
            avg_garage:       18.0,
            avg_savings_per:  savingsRow.total_bookings > 0
              ? Math.round((savingsRow.total_garage_equivalent - savingsRow.total_amount_paid) / savingsRow.total_bookings * 100) / 100
              : 0,
            milestone_100:    savingsRow.milestone_100 === 1,
            milestone_250:    savingsRow.milestone_250 === 1,
            milestone_500:    savingsRow.milestone_500 === 1,
            milestone_1000:   savingsRow.milestone_1000 === 1,
            neighborhood_breakdown: nbhd,
          }
        }
      } catch(e: any) { console.error('[driver-dashboard] savings:', e.message) }

    } catch(e: any) { console.error('[driver-dashboard]', e.message) }
  }

  // ── Savings HTML helpers (pre-computed to avoid nested template literals) ──
  let milestonesHTML = ''
  let neighborhoodHTML = ''
  let savingsCardHTML = ''
  if (savingsData && (savingsData.total_bookings || 0) >= 2) {
    const milestones = [
      { label: '$100 Saved',   achieved: savingsData.milestone_100  },
      { label: '$250 Saved',   achieved: savingsData.milestone_250  },
      { label: '$500 Saved',   achieved: savingsData.milestone_500  },
      { label: '$1,000 Saved', achieved: savingsData.milestone_1000 },
    ]
    milestonesHTML = milestones.map(m => m.achieved
      ? '<span class="flex items-center gap-1 text-xs bg-lime-500/10 border border-lime-500/20 text-lime-400 px-2.5 py-1 rounded-full font-medium"><i class="fas fa-check text-xs"></i> ' + m.label + '</span>'
      : '<span class="text-xs text-gray-600 px-2.5 py-1 rounded-full border border-white/5 font-medium">' + m.label + '</span>'
    ).join('')

    if (savingsData.neighborhood_breakdown.length > 0) {
      const nbhdRows = savingsData.neighborhood_breakdown.slice(0, 5).map((n: any) =>
        '<div class="flex items-center justify-between text-xs">' +
          '<div class="flex items-center gap-2">' +
            '<i class="fas fa-map-pin text-indigo-400"></i>' +
            '<span class="text-gray-300">' + (n.city || 'Unknown') + '</span>' +
            '<span class="text-gray-600">(' + n.bookings + ' bookings)</span>' +
          '</div>' +
          '<span class="text-lime-400 font-semibold">$' + Math.round(n.savings) + ' saved</span>' +
        '</div>'
      ).join('')
      neighborhoodHTML = '<div id="savings-breakdown" class="hidden">' +
        '<p class="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-2">By City</p>' +
        '<div class="space-y-2">' + nbhdRows + '</div>' +
        '<p class="text-gray-600 text-xs mt-3">Avg garage rate used: $18/hr (US estimate)</p>' +
        '</div>'
    }

    savingsCardHTML = `
      <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden" id="savings-section">
        <div class="flex items-center justify-between p-5 border-b border-white/5">
          <h3 class="font-bold text-white text-lg flex items-center gap-2">
            <i class="fas fa-piggy-bank text-lime-500"></i> Your Savings
          </h3>
          <button onclick="toggleSavingsBreakdown()" class="text-indigo-400 hover:text-indigo-300 text-xs font-medium transition-colors">Breakdown</button>
        </div>
        <div class="p-5 space-y-4">
          <div class="flex items-end gap-2">
            <span class="text-4xl font-black text-lime-400">$${savingsData.total_savings.toFixed(0)}</span>
            <span class="text-gray-400 text-sm mb-1">total saved</span>
          </div>
          <div class="grid grid-cols-3 gap-3 text-center text-xs">
            <div class="bg-charcoal-200 rounded-xl p-3">
              <p class="text-gray-400 mb-1">Bookings</p>
              <p class="font-bold text-white text-base">${savingsData.total_bookings}</p>
            </div>
            <div class="bg-charcoal-200 rounded-xl p-3">
              <p class="text-gray-400 mb-1">Avg You Paid</p>
              <p class="font-bold text-white text-base">$${savingsData.avg_paid.toFixed(0)}</p>
            </div>
            <div class="bg-charcoal-200 rounded-xl p-3">
              <p class="text-gray-400 mb-1">Avg Saved</p>
              <p class="font-bold text-lime-400 text-base">$${savingsData.avg_savings_per.toFixed(0)}</p>
            </div>
          </div>
          <div>
            <p class="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-2">Milestones</p>
            <div class="flex flex-wrap gap-2">${milestonesHTML}</div>
          </div>
          ${neighborhoodHTML}
        </div>
      </div>`
  }

  // ── Format helpers ─────────────────────────────────────────────────────────
  const fmtDate = (dt: string) => {
    if (!dt) return '–'
    try {
      return new Date(dt).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })
    } catch { return dt }
  }
  const fmtTime = (dt: string) => {
    if (!dt) return '–'
    try {
      return new Date(dt).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' })
    } catch { return '' }
  }
  const typeIcon = (type: string) => {
    const t = (type||'').toLowerCase()
    if (t==='garage')   return 'fa-warehouse'
    if (t==='driveway') return 'fa-home'
    if (t==='covered')  return 'fa-building'
    return 'fa-parking'
  }

  // ── Active booking card HTML ──────────────────────────────────────────────
  const activeHTML = activeBooking ? `
    <div class="relative gradient-bg rounded-2xl p-6 overflow-hidden">
      <div class="absolute top-0 right-0 w-48 h-48 bg-lime-500/10 rounded-full blur-2xl"></div>
      <div class="relative z-10">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 bg-lime-500 rounded-full pulse-dot"></span>
            <span class="text-white/80 text-sm font-medium">Active Booking</span>
          </div>
          <span class="bg-lime-500 text-charcoal text-xs font-bold px-3 py-1 rounded-full">IN PROGRESS</span>
        </div>
        <h3 class="text-xl font-black text-white mb-1">${activeBooking.title}</h3>
        <p class="text-indigo-200 text-sm mb-4">
          <i class="fas fa-map-pin mr-1"></i>${activeBooking.address}
        </p>
        <div class="grid grid-cols-3 gap-3 mb-5">
          <div class="bg-white/10 rounded-xl p-3 text-center">
            <p class="text-white/60 text-xs">Arrived</p>
            <p class="font-bold text-white">${fmtTime(activeBooking.start_time)}</p>
          </div>
          <div class="bg-white/10 rounded-xl p-3 text-center">
            <p class="text-white/60 text-xs">Depart By</p>
            <p class="font-bold text-white">${fmtTime(activeBooking.end_time)}</p>
          </div>
          <div class="bg-white/10 rounded-xl p-3 text-center">
            <p class="text-white/60 text-xs">Time Left</p>
            <p class="font-bold text-lime-400" id="countdown">–</p>
          </div>
        </div>
        <div class="flex gap-3">
          <button class="flex-1 bg-white/10 hover:bg-white/20 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
            <i class="fas fa-qrcode"></i> View QR
          </button>
          <button class="flex-1 bg-white/10 hover:bg-white/20 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
            <i class="fas fa-map"></i> Navigate
          </button>
        </div>
      </div>
    </div>
  ` : `
    <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-8 text-center">
      <i class="fas fa-parking text-4xl text-gray-600 mb-3 block"></i>
      <p class="text-gray-400 font-medium">No active booking right now</p>
      <a href="/search" class="inline-flex items-center gap-2 mt-4 btn-primary px-5 py-2.5 rounded-xl text-white font-semibold text-sm">
        <i class="fas fa-search-location"></i> Find Parking
      </a>
    </div>
  `

  // ── Upcoming bookings HTML ────────────────────────────────────────────────
  const upcomingHTML = upcomingList.length === 0
    ? `<div class="p-6 text-center text-gray-500 text-sm">No upcoming reservations.</div>`
    : upcomingList.map(b => `
        <div class="flex items-center gap-4 p-4 hover:bg-white/5 transition-colors rounded-xl" id="booking-row-${b.id}" data-ref="PP-${new Date().getFullYear()}-${String(b.id).padStart(4,'0')}">
          <div class="w-10 h-10 gradient-bg rounded-xl flex items-center justify-center flex-shrink-0">
            <i class="fas ${typeIcon(b.type)} text-white text-sm"></i>
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-semibold text-white text-sm truncate">${b.title}</p>
            <p class="text-gray-500 text-xs mt-0.5">${fmtDate(b.start_time)} · ${fmtTime(b.start_time)} – ${fmtTime(b.end_time)}</p>
          </div>
          <div class="text-right flex-shrink-0">
            <p class="font-bold text-white text-sm">$${Number(b.total_charged||0).toFixed(2)}</p>
            <p class="text-xs ${b.status==='confirmed' ? 'text-green-400' : 'text-amber-400'} mt-0.5 capitalize">${b.status}</p>
          </div>
          <a href="/booking/${b.id}" class="w-8 h-8 bg-charcoal-200 rounded-xl flex items-center justify-center text-gray-400 hover:text-white transition-colors ml-1">
            <i class="fas fa-chevron-right text-xs"></i>
          </a>
        </div>
      `).join('')

  // ── History HTML ──────────────────────────────────────────────────────────
  const historyHTML = historyList.length === 0
    ? `<div class="p-6 text-center text-gray-500 text-sm">No booking history yet.</div>`
    : historyList.map(h => {
        const stars = h.rating > 0 ? Array(Math.round(h.rating)).fill('<i class="fas fa-star text-amber-400 text-xs"></i>').join('') : ''
        const isCancelled = h.status === 'cancelled'
        return `
          <div class="flex items-center gap-4 p-4 hover:bg-white/5 transition-colors">
            <div class="w-10 h-10 bg-charcoal-200 rounded-xl flex items-center justify-center flex-shrink-0">
              <i class="fas fa-parking text-gray-400"></i>
            </div>
            <div class="flex-1 min-w-0">
              <p class="font-medium text-white text-sm truncate">${h.title}</p>
              <p class="text-gray-500 text-xs mt-0.5">${fmtDate(h.start_time)}</p>
            </div>
            <div class="flex items-center gap-2">
              ${stars ? `<div class="flex gap-0.5">${stars}</div>` : (isCancelled ? '<span class="text-xs text-red-400">Cancelled</span>' : '')}
            </div>
            <p class="font-semibold ${isCancelled ? 'text-red-400' : 'text-white'} text-sm flex-shrink-0">$${Number(h.total_charged||0).toFixed(2)}</p>
          </div>
        `
      }).join('')

  // ── Set depart time for countdown (active booking) ────────────────────────
  const departStr = activeBooking?.end_time || ''

  const content = `
  <div class="pt-16 min-h-screen">
    <div class="max-w-7xl mx-auto px-4 py-8">
      
      <!-- Dashboard Header -->
      <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 class="text-3xl font-black text-white">Driver Dashboard</h1>
          <p class="text-gray-400 mt-1">Your bookings, history, and saved spots</p>
        </div>
        <div class="flex gap-3">
          <a href="/search" class="btn-primary px-5 py-2.5 rounded-xl text-white font-semibold text-sm flex items-center gap-2">
            <i class="fas fa-search-location"></i> Find Parking
          </a>
        </div>
      </div>

      <!-- Stats Row — real D1 -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div class="stat-card rounded-2xl p-5 card-hover">
          <div class="flex items-start justify-between mb-3">
            <div class="w-10 h-10 bg-indigo-500/10 rounded-xl flex items-center justify-center">
              <i class="fas fa-calendar-check text-indigo-400"></i>
            </div>
          </div>
          <p class="text-2xl font-black text-white">${totalBookings}</p>
          <p class="text-gray-400 text-xs mt-1 font-medium">Total Bookings</p>
          <p class="text-gray-500 text-xs mt-0.5">All time</p>
        </div>
        <div class="stat-card rounded-2xl p-5 card-hover">
          <div class="flex items-start justify-between mb-3">
            <div class="w-10 h-10 bg-lime-500/10 rounded-xl flex items-center justify-center">
              <i class="fas fa-dollar-sign text-lime-500"></i>
            </div>
          </div>
          <p class="text-2xl font-black text-white">$${totalSpent.toLocaleString()}</p>
          <p class="text-gray-400 text-xs mt-1 font-medium">Total Spent</p>
          <p class="text-gray-500 text-xs mt-0.5">Completed bookings</p>
        </div>
        <div class="stat-card rounded-2xl p-5 card-hover">
          <div class="flex items-start justify-between mb-3">
            <div class="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center">
              <i class="fas fa-star text-amber-400"></i>
            </div>
          </div>
          <p class="text-2xl font-black text-white">${avgRating > 0 ? avgRating : '–'}</p>
          <p class="text-gray-400 text-xs mt-1 font-medium">Avg Rating Given</p>
          <p class="text-gray-500 text-xs mt-0.5">As a driver</p>
        </div>
        <div class="stat-card rounded-2xl p-5 card-hover">
          <div class="flex items-start justify-between mb-3">
            <div class="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center">
              <i class="fas fa-map-location-dot text-blue-400"></i>
            </div>
          </div>
          <p class="text-2xl font-black text-white">${upcomingList.length}</p>
          <p class="text-gray-400 text-xs mt-1 font-medium">Upcoming</p>
          <p class="text-gray-500 text-xs mt-0.5">Confirmed reservations</p>
        </div>
      </div>

      <!-- Main Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        <div class="lg:col-span-2 space-y-6">
          
          <!-- Active Booking -->
          ${activeHTML}

          <!-- Upcoming Reservations -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden" data-section="upcoming">
            <div class="flex items-center justify-between p-5 border-b border-white/5">
              <h3 class="font-bold text-white text-lg">Upcoming Reservations</h3>
              <a href="/search" class="text-indigo-400 hover:text-indigo-300 text-sm font-medium transition-colors">Find More</a>
            </div>
            <div class="divide-y divide-white/5">
              ${upcomingHTML}
            </div>
          </div>

          <!-- Booking History -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden">
            <div class="flex items-center justify-between p-5 border-b border-white/5">
              <h3 class="font-bold text-white text-lg">Booking History</h3>
              <span class="text-gray-500 text-xs">${historyList.length} records</span>
            </div>
            <div class="divide-y divide-white/5">
              ${historyHTML}
            </div>
          </div>

          <!-- Savings Dashboard -->
          ${savingsCardHTML}
        </div>

        <!-- Right Sidebar -->
        <div class="space-y-6">

          <!-- Tier Status Card -->
          ${tierCardHTML || `
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
            <div class="flex items-center gap-2 mb-2">
              <i class="fas fa-compass text-gray-400"></i>
              <h3 class="font-bold text-white text-sm">Your Tier</h3>
            </div>
            <p class="text-gray-500 text-xs">Complete your first booking to unlock tier status.</p>
          </div>`}
          
          <!-- Quick Actions -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
            <h3 class="font-bold text-white mb-4">Quick Actions</h3>
            <div class="grid grid-cols-2 gap-2">
              ${[
                { label: 'Book Now',  icon: 'fa-search',     href: '/search',  color: 'text-indigo-400' },
                { label: 'View Map',  icon: 'fa-map',        href: '/search',  color: 'text-lime-500' },
                { label: 'Support',   icon: 'fa-headset',    href: '#',        color: 'text-blue-400' },
                { label: 'Receipts',  icon: 'fa-receipt',    href: '#',        color: 'text-amber-400' },
              ].map(a => `
                <a href="${a.href}" class="flex flex-col items-center gap-2 p-3 bg-charcoal-200 hover:bg-charcoal-300 rounded-xl text-center transition-colors group">
                  <i class="fas ${a.icon} ${a.color} text-xl"></i>
                  <span class="text-xs text-gray-400 group-hover:text-white">${a.label}</span>
                </a>
              `).join('')}
            </div>
          </div>

          <!-- Account Status -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
            <h3 class="font-bold text-white mb-4">Account</h3>
            <div class="space-y-2 text-sm">
              <div class="flex items-center gap-2 text-gray-400">
                <i class="fas fa-user text-indigo-400 w-4"></i>
                <span>Driver Account</span>
                <i class="fas fa-check text-green-400 ml-auto"></i>
              </div>
              <div class="flex items-center gap-2 text-gray-400">
                <i class="fas fa-lock text-indigo-400 w-4"></i>
                <span>Secure Payments</span>
                <i class="fas fa-check text-green-400 ml-auto"></i>
              </div>
              <div class="flex items-center gap-2 text-gray-400">
                <i class="fas fa-shield-halved text-indigo-400 w-4"></i>
                <span>ParkPeer Protected</span>
                <i class="fas fa-check text-green-400 ml-auto"></i>
              </div>
            </div>
            <a href="/auth/signup" class="mt-4 block w-full py-2.5 text-center bg-charcoal-200 border border-white/10 text-gray-300 hover:text-white rounded-xl text-sm font-medium transition-colors">
              Manage Profile
            </a>
            <!-- Danger zone -->
            <div class="mt-3 pt-3 border-t border-white/5">
              <button onclick="openDeleteAccount()"
                class="w-full py-2.5 text-center bg-transparent border border-red-500/20 hover:bg-red-500/10 text-red-400 hover:text-red-300 rounded-xl text-sm font-medium transition-colors">
                <i class="fas fa-trash-alt mr-2 text-xs"></i>Delete Account
              </button>
            </div>
          </div>

          <!-- Become a Host CTA -->
          <div class="bg-indigo-500/10 border border-indigo-500/20 rounded-2xl p-4">
            <h4 class="text-white font-semibold text-sm mb-2 flex items-center gap-2">
              <i class="fas fa-dollar-sign text-lime-500"></i> Have a Space to Share?
            </h4>
            <p class="text-gray-400 text-xs mb-3">List your driveway or garage and earn extra income every month.</p>
            <a href="/host" class="block w-full py-2 text-center bg-lime-500 text-charcoal rounded-xl text-xs font-bold hover:bg-lime-400 transition-colors">
              Start Hosting →
            </a>
          </div>

          <!-- Legal Links Card -->
          <div class="bg-charcoal-100 border border-white/5 rounded-2xl p-4">
            <h4 class="text-gray-400 font-semibold text-xs mb-3 uppercase tracking-wider flex items-center gap-2">
              <i class="fas fa-scale-balanced text-gray-500 text-xs"></i> Policies & Legal
            </h4>
            <ul class="space-y-2">
              <li>
                <a href="/legal/cancellation-policy" class="flex items-center gap-2 text-gray-400 hover:text-indigo-400 text-xs transition-colors">
                  <i class="fas fa-calendar-xmark text-xs w-3.5"></i> Cancellation Policy
                </a>
              </li>
              <li>
                <a href="/legal/tos" class="flex items-center gap-2 text-gray-400 hover:text-indigo-400 text-xs transition-colors">
                  <i class="fas fa-file-contract text-xs w-3.5"></i> Terms of Service
                </a>
              </li>
              <li>
                <a href="/legal/privacy" class="flex items-center gap-2 text-gray-400 hover:text-indigo-400 text-xs transition-colors">
                  <i class="fas fa-shield-halved text-xs w-3.5"></i> Privacy Policy
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    // Countdown to depart time (if active booking exists)
    const departStr = '${departStr}';
    if (departStr) {
      function updateCountdown() {
        const depart = new Date(departStr);
        const now = new Date();
        const diff = depart - now;
        const el = document.getElementById('countdown');
        if (!el) return;
        if (diff <= 0) { el.textContent = 'Time up'; return; }
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        el.textContent = (h > 0 ? h + 'h ' : '') + m + 'm';
      }
      updateCountdown();
      setInterval(updateCountdown, 60000);
    }

    // ── Savings breakdown toggle ──────────────────────────────────────────
    function toggleSavingsBreakdown() {
      const el = document.getElementById('savings-breakdown')
      if (el) el.classList.toggle('hidden')
    }

    // ── Delete Account ────────────────────────────────────────────────────
    function openDeleteAccount() {
      document.getElementById('delete-account-modal').classList.remove('hidden');
      document.getElementById('delete-account-error').classList.add('hidden');
      const btn = document.getElementById('delete-account-btn');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-trash-alt mr-2"></i>Yes, Delete My Account';
    }

    function closeDeleteAccountModal(e) {
      if (!e || e.target === document.getElementById('delete-account-modal')) {
        document.getElementById('delete-account-modal').classList.add('hidden');
      }
    }

    function getCsrfToken() {
      const m = document.cookie.match(/(?:^|;\\s*)__pp_csrf=([^;]+)/);
      if (m) return decodeURIComponent(m[1]).split('.').slice(0,3).join('.');
      return sessionStorage.getItem('csrf_token') || '';
    }

    async function confirmDeleteAccount() {
      const btn = document.getElementById('delete-account-btn');
      const errEl = document.getElementById('delete-account-error');
      const errMsg = document.getElementById('delete-account-error-msg');
      errEl.classList.add('hidden');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Deleting…';

      try {
        const res = await fetch('/api/auth/account', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken(),
          },
          credentials: 'same-origin',
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          errMsg.textContent = data.error || 'Failed to delete account. Please try again.';
          errEl.classList.remove('hidden');
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-trash-alt mr-2"></i>Yes, Delete My Account';
          return;
        }

        // Success — show confirmation then redirect to homepage
        btn.innerHTML = '<i class="fas fa-check mr-2"></i>Account Deleted';
        document.getElementById('delete-account-body').innerHTML =
          '<div class="text-center py-4"><i class="fas fa-check-circle text-green-400 text-3xl mb-3 block"></i>' +
          '<p class="text-white font-bold mb-1">Account Deleted</p>' +
          '<p class="text-gray-400 text-sm">Your account has been permanently removed. Redirecting…</p></div>';
        setTimeout(() => { window.location.href = '/'; }, 2000);

      } catch(err) {
        errMsg.textContent = 'Network error. Please check your connection and try again.';
        errEl.classList.remove('hidden');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash-alt mr-2"></i>Yes, Delete My Account';
      }
    }
  </script>

  <!-- Delete Account Confirmation Modal -->
  <div id="delete-account-modal" class="hidden fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onclick="closeDeleteAccountModal(event)">
    <div class="bg-charcoal-100 rounded-3xl w-full max-w-md border border-white/10 overflow-hidden" onclick="event.stopPropagation()">
      <div class="flex items-center justify-between p-6 border-b border-white/10">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 bg-red-500/10 rounded-xl flex items-center justify-center flex-shrink-0">
            <i class="fas fa-trash-alt text-red-400"></i>
          </div>
          <div>
            <h3 class="text-lg font-bold text-white">Delete Account</h3>
            <p class="text-gray-400 text-xs mt-0.5">This action cannot be undone</p>
          </div>
        </div>
        <button onclick="document.getElementById('delete-account-modal').classList.add('hidden')"
          class="w-8 h-8 bg-charcoal-200 rounded-full flex items-center justify-center text-gray-400 hover:text-white transition-colors">
          <i class="fas fa-times text-sm"></i>
        </button>
      </div>
      <div id="delete-account-body" class="p-6 space-y-4">
        <div class="bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
          <p class="text-red-300 font-semibold text-sm mb-2">⚠️ Are you sure?</p>
          <ul class="text-red-300/70 text-xs space-y-1.5 leading-relaxed">
            <li class="flex items-start gap-2"><i class="fas fa-times text-red-400 mt-0.5 flex-shrink-0"></i>Your account will be permanently deleted</li>
            <li class="flex items-start gap-2"><i class="fas fa-times text-red-400 mt-0.5 flex-shrink-0"></i>You will be immediately signed out</li>
            <li class="flex items-start gap-2"><i class="fas fa-times text-red-400 mt-0.5 flex-shrink-0"></i>This cannot be reversed</li>
          </ul>
        </div>
        <div id="delete-account-error" class="hidden bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
          <p id="delete-account-error-msg" class="text-amber-300 text-sm"></p>
        </div>
        <div class="flex gap-3">
          <button onclick="document.getElementById('delete-account-modal').classList.add('hidden')"
            class="flex-1 py-3 bg-charcoal-200 hover:bg-charcoal-300 text-gray-300 rounded-xl text-sm font-semibold transition-colors border border-white/10">
            Cancel
          </button>
          <button id="delete-account-btn" onclick="confirmDeleteAccount()"
            class="flex-1 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 rounded-xl text-sm font-bold transition-colors border border-red-500/20">
            <i class="fas fa-trash-alt mr-2"></i>Yes, Delete My Account
          </button>
        </div>
      </div>
    </div>
  </div>
  `
  const navSession = { name: driverName || session?.name || '', role: session?.role || 'DRIVER', isAdmin: (session?.role || '').toUpperCase() === 'ADMIN' }
  // Front-end route guard: if __pp_csrf cookie is absent the session has expired.
  // This runs synchronously in <head> before any HTML renders — prevents UI flash.
  const guardScript = `<script>
    (function(){
      var hasCsrf = document.cookie.split(';').some(function(c){ return c.trim().startsWith('__pp_csrf='); });
      if (!hasCsrf) { window.location.replace('/auth/login?reason=auth'); }

      // Handle ?tab= and ?highlight= params from post-booking redirect
      var params = new URLSearchParams(window.location.search);
      var tab = params.get('tab');
      var highlight = params.get('highlight');

      document.addEventListener('DOMContentLoaded', function() {
        // If tab=upcoming, scroll to upcoming section
        if (tab === 'upcoming') {
          var upcomingSection = document.querySelector('[data-section="upcoming"]');
          if (upcomingSection) {
            upcomingSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }

        // Highlight the just-booked row
        if (highlight) {
          var rows = document.querySelectorAll('[data-ref]');
          var found = false;
          rows.forEach(function(row) {
            if (row.getAttribute('data-ref') === highlight) {
              found = true;
              row.scrollIntoView({ behavior: 'smooth', block: 'center' });
              row.style.transition = 'background 0.5s ease';
              row.style.background = 'rgba(99,102,241,0.3)';
              row.style.borderRadius = '12px';
              row.style.border = '1px solid rgba(99,102,241,0.5)';
              setTimeout(function() {
                row.style.background = '';
                row.style.border = '';
              }, 3500);
            }
          });
          // If booking not in list yet (< 1s after confirm), show a toast
          if (!found) {
            var toast = document.createElement('div');
            toast.textContent = '✅ Booking ' + highlight + ' confirmed! Refreshing…';
            toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#4f46e5;color:#fff;padding:12px 24px;border-radius:12px;font-size:14px;font-weight:600;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.4)';
            document.body.appendChild(toast);
            setTimeout(function() { window.location.reload(); }, 1800);
          }
        }

        // Clean up URL (remove params without triggering reload)
        if (tab || highlight) {
          window.history.replaceState({}, '', window.location.pathname);
        }
      });
    })();
  <\/script>`
  return c.html(Layout('Driver Dashboard', content, guardScript, navSession))
})

// ── GET /dashboard/notifications ─────────────────────────────────────────────
driverDashboard.get('/notifications', async (c) => {
  const session = c.get('user') as any
  const driverName = session?.name || session?.full_name || session?.email?.split('@')[0] || 'Driver'
  const content = `
  <div class="max-w-2xl mx-auto py-8 px-4">
    <div class="flex items-center gap-3 mb-6">
      <a href="/dashboard" class="text-gray-400 hover:text-white transition-colors">
        <i class="fas fa-arrow-left text-lg"></i>
      </a>
      <h1 class="text-2xl font-bold text-white">Notification Preferences</h1>
    </div>

    <div id="prefs-status" class="hidden mb-4 p-3 rounded-xl text-sm font-medium"></div>

    <div class="glass rounded-2xl border border-white/10 p-6 space-y-6">
      <!-- Booking Notifications -->
      <div>
        <h3 class="font-semibold text-white mb-3 flex items-center gap-2">
          <i class="fas fa-car text-indigo-400"></i> Booking Notifications
        </h3>
        <div class="space-y-3 ml-6">
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">In-app notifications</span>
            <input type="checkbox" id="booking_inapp" class="notif-toggle w-4 h-4 accent-indigo-500">
          </label>
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">Email notifications</span>
            <input type="checkbox" id="booking_email" class="notif-toggle w-4 h-4 accent-indigo-500">
          </label>
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">SMS notifications</span>
            <input type="checkbox" id="booking_sms" class="notif-toggle w-4 h-4 accent-indigo-500">
          </label>
        </div>
      </div>

      <div class="border-t border-white/10"></div>

      <!-- Payout Notifications -->
      <div>
        <h3 class="font-semibold text-white mb-3 flex items-center gap-2">
          <i class="fas fa-dollar-sign text-green-400"></i> Payout Notifications
        </h3>
        <div class="space-y-3 ml-6">
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">In-app notifications</span>
            <input type="checkbox" id="payout_inapp" class="notif-toggle w-4 h-4 accent-indigo-500">
          </label>
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">Email notifications</span>
            <input type="checkbox" id="payout_email" class="notif-toggle w-4 h-4 accent-indigo-500">
          </label>
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">SMS notifications</span>
            <input type="checkbox" id="payout_sms" class="notif-toggle w-4 h-4 accent-indigo-500">
          </label>
        </div>
      </div>

      <div class="border-t border-white/10"></div>

      <!-- Review Notifications -->
      <div>
        <h3 class="font-semibold text-white mb-3 flex items-center gap-2">
          <i class="fas fa-star text-amber-400"></i> Review Notifications
        </h3>
        <div class="space-y-3 ml-6">
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">In-app notifications</span>
            <input type="checkbox" id="review_inapp" class="notif-toggle w-4 h-4 accent-indigo-500">
          </label>
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">Email notifications</span>
            <input type="checkbox" id="review_email" class="notif-toggle w-4 h-4 accent-indigo-500">
          </label>
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">SMS notifications</span>
            <input type="checkbox" id="review_sms" class="notif-toggle w-4 h-4 accent-indigo-500">
          </label>
        </div>
      </div>

      <div class="border-t border-white/10"></div>

      <!-- System Notifications -->
      <div>
        <h3 class="font-semibold text-white mb-3 flex items-center gap-2">
          <i class="fas fa-shield-alt text-blue-400"></i> System &amp; Security Alerts
        </h3>
        <div class="space-y-3 ml-6">
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">In-app notifications</span>
            <input type="checkbox" id="system_inapp" class="notif-toggle w-4 h-4 accent-indigo-500">
          </label>
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">Email notifications</span>
            <input type="checkbox" id="system_email" class="notif-toggle w-4 h-4 accent-indigo-500">
          </label>
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">SMS notifications</span>
            <input type="checkbox" id="system_sms" class="notif-toggle w-4 h-4 accent-indigo-500">
          </label>
        </div>
      </div>

      <button id="save-prefs-btn" class="w-full py-3 gradient-bg text-white font-semibold rounded-xl hover:opacity-90 transition-opacity mt-2">
        <i class="fas fa-save mr-2"></i>Save Preferences
      </button>
    </div>

    <script>
    (async () => {
      const fields = ['booking_inapp','booking_email','booking_sms','payout_inapp','payout_email','payout_sms','review_inapp','review_email','review_sms','system_inapp','system_email','system_sms'];
      // Load prefs
      try {
        const res = await fetch('/api/notifications/prefs');
        if (res.ok) {
          const { prefs } = await res.json();
          fields.forEach(f => { const el = document.getElementById(f); if (el) el.checked = prefs[f] === 1; });
        }
      } catch {}

      // Save prefs
      document.getElementById('save-prefs-btn').addEventListener('click', async () => {
        const body = {};
        fields.forEach(f => { const el = document.getElementById(f); body[f] = el && el.checked ? 1 : 0; });
        try {
          const res = await fetch('/api/notifications/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const status = document.getElementById('prefs-status');
          if (res.ok) {
            status.textContent = '✓ Preferences saved!';
            status.className = 'mb-4 p-3 rounded-xl text-sm font-medium bg-green-500/20 text-green-300 border border-green-500/20';
          } else {
            status.textContent = 'Failed to save. Please try again.';
            status.className = 'mb-4 p-3 rounded-xl text-sm font-medium bg-red-500/20 text-red-300 border border-red-500/20';
          }
          status.classList.remove('hidden');
          setTimeout(() => status.classList.add('hidden'), 3000);
        } catch {}
      });
    })();
    </script>
  </div>
  `
  const navSession = { name: driverName, role: session?.role || 'DRIVER', isAdmin: (session?.role || '').toUpperCase() === 'ADMIN' }
  const guardScript = `<script>(function(){ var hasCsrf = document.cookie.split(';').some(function(c){ return c.trim().startsWith('__pp_csrf='); }); if (!hasCsrf) { window.location.replace('/auth/login?reason=auth'); } })();<\\/script>`
  return c.html(Layout('Notification Preferences', content, guardScript, navSession))
})
