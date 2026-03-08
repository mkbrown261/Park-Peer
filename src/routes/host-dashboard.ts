import { Hono } from 'hono'
import { Layout } from '../components/layout'
import { requireUserAuth, verifyUserToken } from '../middleware/security'
import { recalculateTier, getTierDef, getNextTierGaps } from '../services/tiers'
import { renderTierCard } from '../components/tier-card'
import { CURRENT_VERSIONS } from './agreements'

type Bindings = { DB: D1Database; USER_TOKEN_SECRET: string }

export const hostDashboard = new Hono<{ Bindings: Bindings }>()

// ── Protect ALL /host/* routes — redirect unauthenticated users to login ──────
hostDashboard.use('/*', requireUserAuth({ redirectOnFail: true }))

// ── Role guard: only HOST, BOTH, or ADMIN may access /host/* ─────────────────
hostDashboard.use('/*', async (c, next) => {
  const session = c.get('user') as any
  const role = (session?.role || '').toUpperCase()
  if (role !== 'HOST' && role !== 'BOTH' && role !== 'ADMIN') {
    // Drivers who navigate directly to /host are redirected to their dashboard
    return c.redirect('/dashboard?reason=wrong_role')
  }
  await next()
})

hostDashboard.get('/', async (c) => {
  const db = c.env?.DB
  const session = c.get('user') as any
  const userId = session?.userId

  // ── Real D1 data ──────────────────────────────────────────────────────────
  let totalRevenue       = 0
  let activeBookings     = 0
  let avgRating          = 0
  let activeListings     = 0
  let pendingBookings    = 0
  let myListings:        any[] = []
  let pendingReqs:       any[] = []
  let recentReviews:     any[] = []
  let recentConfirmed:   any[] = []   // ← new: recently confirmed bookings
  let nextPayout         = 0
  let payoutPending      = 0

  let hostName = ''
  let tierCardHTML = ''
  // Agreement state
  let hostAgreementVersion: string | null = null
  let agreementReacceptRequired = false
  const currentAgreementVersion = CURRENT_VERSIONS.host_agreement
  // Host credentials
  let hostCreds: any = null

  if (db && userId) {
    try {
      // Fetch host's display name
      const nameRow = await db.prepare('SELECT full_name, host_agreement_version, agreement_reaccept_required FROM users WHERE id = ?').bind(userId).first<{full_name: string; host_agreement_version: string | null; agreement_reaccept_required: number}>()
      hostName = nameRow?.full_name || ''
      hostAgreementVersion = nameRow?.host_agreement_version || null
      agreementReacceptRequired = !!(nameRow?.agreement_reaccept_required)

      // ── Tier data ─────────────────────────────────────────────────────────
      try {
        await recalculateTier(db, userId, 'HOST', 'dashboard_load')
        const tierState: any = await db.prepare(
          'SELECT * FROM user_tier_state WHERE user_id = ? AND role = ?'
        ).bind(userId, 'HOST').first()

        if (tierState) {
          const tierDef = getTierDef('HOST', tierState.current_tier)
          const metrics = {
            r12_completed:      tierState.r12_completed_bookings,
            r12_spend:          0,
            r12_revenue:        tierState.r12_total_revenue,
            r12_avg_rating:     tierState.r12_avg_rating,
            r12_cancel_rate:    tierState.r12_cancellation_rate,
            r12_response_rate:  tierState.r12_response_rate,
            r12_avg_response_hrs: tierState.r12_avg_response_hours,
            lifetime_completed: tierState.lifetime_completed,
            lifetime_spend:     0,
            lifetime_revenue:   tierState.lifetime_revenue,
          }
          const gaps = getNextTierGaps(metrics, tierState.current_tier, 'HOST')
          tierCardHTML = renderTierCard({
            role:            'HOST',
            current_tier:    tierState.current_tier,
            tier_name:       tierDef.name,
            tier_tagline:    tierDef.tagline,
            tier_since:      tierState.tier_since,
            tier_gradient:   tierDef.gradient,
            tier_icon:       tierDef.icon,
            tier_rank:       tierDef.rank,
            progress_to_next: tierState.progress_to_next,
            is_max_tier:     tierState.current_tier === 'icon',
            next_tier:       tierState.current_tier !== 'icon'
              ? (() => { const o = ['steward','curator','prestige','icon']; const i = o.indexOf(tierState.current_tier); return i < 3 ? { id: o[i+1], name: getTierDef('HOST',o[i+1]).name, icon: getTierDef('HOST',o[i+1]).icon } : null })()
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
        console.error('[host-dashboard] tier error:', tierErr.message)
      }

      // Revenue from succeeded payments for this host
      const rev = await db.prepare(`
        SELECT COALESCE(SUM(host_payout),0) as total FROM payments WHERE host_id=? AND status='succeeded'
      `).bind(userId).first<any>()
      totalRevenue = Math.round((rev?.total ?? 0) * 100) / 100

      // Active bookings for this host
      const ab = await db.prepare(`
        SELECT COUNT(*) as n FROM bookings WHERE host_id=? AND status IN ('confirmed','active')
      `).bind(userId).first<any>()
      activeBookings = ab?.n ?? 0

      // Pending approval for this host
      const pb = await db.prepare(`
        SELECT COUNT(*) as n FROM bookings WHERE host_id=? AND status='pending'
      `).bind(userId).first<any>()
      pendingBookings = pb?.n ?? 0

      // Avg rating across this host's listings
      const ar = await db.prepare(`
        SELECT AVG(avg_rating) as avg_r FROM listings WHERE host_id=? AND status='active' AND avg_rating > 0
      `).bind(userId).first<any>()
      avgRating = ar?.avg_r ? Math.round(ar.avg_r * 100) / 100 : 0

      // Active listing count for this host
      const al = await db.prepare(`
        SELECT COUNT(*) as n FROM listings WHERE host_id=? AND status='active'
      `).bind(userId).first<any>()
      activeListings = al?.n ?? 0

      // My listings with booking and revenue stats
      const listRows = await db.prepare(`
        SELECT l.id, l.title, l.type, l.rate_hourly, l.status,
               l.avg_rating, l.review_count, l.total_bookings, l.instant_book,
               COALESCE(SUM(p.host_payout),0) as revenue
        FROM listings l
        LEFT JOIN bookings b ON b.listing_id = l.id
        LEFT JOIN payments p ON p.booking_id = b.id AND p.status = 'succeeded'
        WHERE l.host_id = ?
        GROUP BY l.id
        ORDER BY l.status='active' DESC, l.avg_rating DESC
        LIMIT 10
      `).bind(userId).all<any>()
      myListings = listRows.results || []

      // Pending booking requests for this host's listings (include driver tier)
      const pendRows = await db.prepare(`
        SELECT b.id, b.start_time, b.end_time, b.total_charged, b.status,
               b.vehicle_description,
               l.title as space_title,
               u.full_name as driver_name, u.email as driver_email,
               u.id as driver_id,
               uts.current_tier as driver_tier
        FROM bookings b
        JOIN listings l ON b.listing_id = l.id
        LEFT JOIN users u ON b.driver_id = u.id
        LEFT JOIN user_tier_state uts ON uts.user_id = u.id AND uts.role = 'DRIVER'
        WHERE b.host_id = ? AND b.status = 'pending'
        ORDER BY b.created_at ASC
        LIMIT 6
      `).bind(userId).all<any>()
      pendingReqs = pendRows.results || []

      // Recently confirmed bookings for this host (paid, upcoming/active)
      const confirmedRows = await db.prepare(`
        SELECT b.id, b.start_time, b.end_time, b.total_charged, b.host_payout,
               b.status, b.vehicle_description, b.created_at,
               l.title as space_title,
               u.full_name as driver_name, u.email as driver_email
        FROM bookings b
        JOIN listings l ON b.listing_id = l.id
        LEFT JOIN users u ON b.driver_id = u.id
        WHERE b.host_id = ? AND b.status IN ('confirmed','active')
        ORDER BY b.created_at DESC
        LIMIT 8
      `).bind(userId).all<any>()
      recentConfirmed = confirmedRows.results || []

      // Recent reviews for this host's listings
      const revRows = await db.prepare(`
        SELECT r.rating, r.comment, r.created_at,
               u.full_name as reviewer_name,
               l.title as listing_title
        FROM reviews r
        JOIN listings l ON r.listing_id = l.id
        LEFT JOIN users u ON r.reviewer_id = u.id
        WHERE l.host_id = ? AND r.status = 'published'
        ORDER BY r.created_at DESC
        LIMIT 4
      `).bind(userId).all<any>()
      recentReviews = revRows.results || []

      // Next payout = sum of confirmed/active bookings for this host not yet paid out
      const payoutRow = await db.prepare(`
        SELECT COALESCE(SUM(host_payout),0) as pending
        FROM bookings
        WHERE host_id = ? AND status IN ('confirmed','active')
      `).bind(userId).first<any>()
      payoutPending = Math.round((payoutRow?.pending ?? 0) * 100) / 100
      const fee = Math.round(payoutPending * 0.15 * 100) / 100
      nextPayout = Math.round((payoutPending - fee) * 100) / 100

      // ── Host Credentials ──────────────────────────────────────────────────
      try {
        const FOUNDING_DATE = new Date('2025-12-31T23:59:59Z')
        const userRow = await db.prepare('SELECT id_verified, created_at FROM users WHERE id = ?').bind(userId).first<any>()
        const isFounder = userRow?.created_at ? new Date(userRow.created_at) <= FOUNDING_DATE : false

        // Best PRI across host's active listings
        const bestPriRow = await db.prepare(
          "SELECT MAX(pri_score) as best FROM listings WHERE host_id = ? AND status = 'active'"
        ).bind(userId).first<any>()
        const bestPri = bestPriRow?.best ?? 0
        const isHighPerf = bestPri >= 95 ? 1 : 0

        await db.prepare(`
          INSERT INTO host_credentials (host_id, tier1_verified, tier1_verified_at,
            tier3_performance, tier3_performance_at, tier4_founding, tier4_founding_at, updated_at)
          VALUES (?, ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END,
                  ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END,
                  ?, CASE WHEN ? = 1 THEN ? ELSE NULL END, datetime('now'))
          ON CONFLICT(host_id) DO UPDATE SET
            tier1_verified = excluded.tier1_verified,
            tier3_performance = excluded.tier3_performance,
            tier3_performance_at = CASE
              WHEN excluded.tier3_performance = 1 AND tier3_performance = 0 THEN datetime('now')
              ELSE tier3_performance_at END,
            tier4_founding = excluded.tier4_founding,
            updated_at = datetime('now')
        `).bind(
          userId,
          userRow?.id_verified ?? 0, userRow?.id_verified ?? 0,
          isHighPerf, isHighPerf,
          isFounder ? 1 : 0, isFounder ? 1 : 0, userRow?.created_at
        ).run()

        const credsRow = await db.prepare(
          'SELECT * FROM host_credentials WHERE host_id = ?'
        ).bind(userId).first<any>()
        if (credsRow) {
          hostCreds = {
            verified:    credsRow.tier1_verified === 1,
            secure:      credsRow.tier2_secure === 1,
            performance: credsRow.tier3_performance === 1,
            founding:    credsRow.tier4_founding === 1,
            best_pri:    Math.round(bestPri || 0),
          }
        }
      } catch(e: any) { console.error('[host-dashboard] credentials:', e.message) }

    } catch(e: any) { console.error('[host-dashboard]', e.message) }
  }

  // ── Format helpers ─────────────────────────────────────────────────────────
  const fmtDate = (dt: string) => {
    if (!dt) return '–'
    try { return new Date(dt).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' }) }
    catch { return dt }
  }
  const fmtTime = (dt: string) => {
    if (!dt) return '–'
    try { return new Date(dt).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' }) }
    catch { return '' }
  }
  const fmtMoney = (n: number) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

  // ── My Listings HTML ──────────────────────────────────────────────────────
  const listingsHTML = myListings.length === 0
    ? `<div class="p-8 text-center">
         <i class="fas fa-parking text-3xl text-gray-600 mb-3 block"></i>
         <p class="text-gray-400">No listings yet.</p>
         <button onclick="showAddListing()" class="mt-3 btn-lime px-5 py-2 rounded-xl text-sm font-bold">Add Your First Space</button>
       </div>`
    : myListings.map(l => {
        const typeIcon = l.type === 'garage' ? 'warehouse' : l.type === 'driveway' ? 'home' : 'parking'
        const isArchived = l.status === 'archived'
        return `
          <div class="p-4 hover:bg-white/5 transition-colors listing-row" data-id="${l.id}" data-title="${l.title.replace(/"/g,'&quot;')}">
            <div class="flex items-center gap-4">
              <div class="w-16 h-16 bg-gradient-to-br from-charcoal-300 to-charcoal-400 rounded-xl flex items-center justify-center flex-shrink-0 ${isArchived ? 'opacity-40' : ''}">
                <i class="fas fa-${typeIcon} text-white/30 text-2xl"></i>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <p class="font-bold text-white text-sm ${isArchived ? 'text-gray-400' : ''}">${l.title}</p>
                  <span class="text-xs px-2 py-0.5 rounded-full ${
                    l.status === 'active'   ? 'bg-green-500/20 text-green-400' :
                    l.status === 'archived' ? 'bg-amber-500/20 text-amber-400' :
                                              'bg-gray-500/20 text-gray-400'
                  }">${l.status === 'archived' ? '📦 archived' : l.status}</span>
                  ${l.instant_book && !isArchived ? '<span class="text-xs bg-lime-500/20 text-lime-500 px-2 py-0.5 rounded-full">⚡ Instant</span>' : ''}
                </div>
                <div class="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                  <span><i class="fas fa-dollar-sign text-indigo-400 mr-1"></i>$${l.rate_hourly}/hr</span>
                  <span><i class="fas fa-calendar text-indigo-400 mr-1"></i>${l.total_bookings || 0} bookings</span>
                  ${l.avg_rating > 0 ? `<span><i class="fas fa-star text-amber-400 mr-1"></i>${Number(l.avg_rating).toFixed(1)}</span>` : ''}
                  ${l.revenue > 0 ? `<span class="text-lime-500 font-semibold"><i class="fas fa-dollar-sign mr-0.5"></i>${Number(l.revenue).toFixed(0)} earned</span>` : ''}
                </div>
              </div>
              <div class="flex flex-col gap-2 relative">
                <a href="/listing/${l.id}" class="px-3 py-1.5 bg-charcoal-200 hover:bg-indigo-500/20 text-gray-400 hover:text-indigo-300 rounded-xl text-xs font-medium transition-colors border border-white/5 text-center">
                  View
                </a>
                ${isArchived
                  ? `<button onclick="confirmRestore(${l.id},'${l.title.replace(/'/g,'\\\'')}')"
                       class="px-3 py-1.5 bg-green-500/10 hover:bg-green-500/20 text-green-400 hover:text-green-300 rounded-xl text-xs font-medium transition-colors border border-green-500/20 whitespace-nowrap">
                       <i class="fas fa-undo mr-1"></i>Restore
                     </button>`
                  : `<button onclick="openManageListing(${l.id},'${l.title.replace(/'/g,'\\\'')}')"
                       class="px-3 py-1.5 bg-charcoal-200 hover:bg-red-500/10 text-gray-400 hover:text-red-400 rounded-xl text-xs font-medium transition-colors border border-white/5 hover:border-red-500/20 whitespace-nowrap">
                       <i class="fas fa-ellipsis-h mr-1"></i>Manage
                     </button>`
                }
              </div>
            </div>
          </div>
        `
      }).join('')

  // ── Pending Requests HTML ─────────────────────────────────────────────────
  const pendingHTML = pendingReqs.length === 0
    ? `<div class="p-8 text-center text-gray-500 text-sm">
         <i class="fas fa-inbox text-3xl text-gray-600 mb-3 block"></i>
         No pending booking requests.
       </div>`
    : pendingReqs.map(r => {
        const driverInit = (r.driver_name || r.driver_email || '?')[0].toUpperCase()
        const driverLabel = r.driver_name || r.driver_email || 'Unknown Driver'
        const vehicleLabel = r.vehicle_description || 'Vehicle not specified'
        return `
          <div class="p-4">
            <div class="flex items-start gap-3">
              <div class="w-10 h-10 gradient-bg rounded-full flex items-center justify-center font-bold text-white flex-shrink-0">
                ${driverInit}
              </div>
              <div class="flex-1">
                <div class="flex items-center justify-between">
                  <p class="font-semibold text-white text-sm">${driverLabel}</p>
                  <p class="font-bold text-white text-sm">${fmtMoney(r.total_charged)}</p>
                </div>
                <p class="text-xs text-gray-400 mt-0.5">
                  <i class="fas fa-car mr-1 text-indigo-400"></i>${vehicleLabel}
                </p>
                <p class="text-xs text-gray-500 mt-1">
                  <i class="fas fa-parking text-indigo-400 mr-1"></i>${r.space_title} ·
                  ${fmtDate(r.start_time)} · ${fmtTime(r.start_time)} – ${fmtTime(r.end_time)}
                </p>
                <div class="flex gap-2 mt-3">
                  <button onclick="acceptBooking(this,'${r.id}')" class="flex-1 py-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-xl text-xs font-semibold transition-colors border border-green-500/20">
                    <i class="fas fa-check mr-1"></i> Accept
                  </button>
                  <button onclick="declineBooking(this,'${r.id}')" class="flex-1 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl text-xs font-semibold transition-colors border border-red-500/20">
                    <i class="fas fa-times mr-1"></i> Decline
                  </button>
                </div>
              </div>
            </div>
          </div>
        `
      }).join('')

  // ── Recent Confirmed Bookings HTML ────────────────────────────────────────
  const confirmedHTML = recentConfirmed.length === 0
    ? `<div class=\"p-8 text-center text-gray-500 text-sm\">
         <i class=\"fas fa-calendar-check text-3xl text-gray-600 mb-3 block\"></i>
         No confirmed bookings yet.
       </div>`
    : recentConfirmed.map(b => {
        const driverInit = (b.driver_name || b.driver_email || '?')[0].toUpperCase()
        const driverLabel = b.driver_name || b.driver_email || 'Unknown Driver'
        const payout = Number(b.host_payout || 0)
        const statusCls = b.status === 'active' ? 'text-lime-400' : 'text-green-400'
        return `
          <div class=\"flex items-center gap-3 p-4 hover:bg-white/5 transition-colors\">
            <div class=\"w-9 h-9 gradient-bg rounded-full flex items-center justify-center font-bold text-white flex-shrink-0 text-sm\">
              ${driverInit}
            </div>
            <div class=\"flex-1 min-w-0\">
              <p class=\"font-semibold text-white text-sm truncate\">${driverLabel}</p>
              <p class=\"text-xs text-gray-500 mt-0.5\">
                <i class=\"fas fa-parking text-indigo-400 mr-1\"></i>${b.space_title} ·
                ${fmtDate(b.start_time)} · ${fmtTime(b.start_time)} – ${fmtTime(b.end_time)}
              </p>
            </div>
            <div class=\"text-right flex-shrink-0\">
              <p class=\"text-lime-400 font-bold text-sm\">${fmtMoney(payout > 0 ? payout : b.total_charged)}</p>
              <p class=\"text-xs ${statusCls} capitalize\">${b.status}</p>
            </div>
          </div>
        `
      }).join('')

  // ── Recent Reviews HTML ───────────────────────────────────────────────────
  const reviewsHTML = recentReviews.length === 0
    ? `<div class="p-4 text-center text-gray-500 text-xs">No reviews yet.</div>`
    : recentReviews.map(r => `
        <div class="p-3 bg-charcoal-200 rounded-xl">
          <div class="flex items-center justify-between mb-1.5">
            <p class="text-white text-xs font-semibold">${r.reviewer_name || 'Driver'}</p>
            <div class="flex gap-0.5">
              ${Array(Math.round(r.rating||0)).fill('<i class="fas fa-star text-amber-400 text-xs"></i>').join('')}
            </div>
          </div>
          <p class="text-gray-400 text-xs">${r.comment ? '"' + r.comment.substring(0,100) + '"' : ''}</p>
          ${r.listing_title ? `<p class="text-gray-600 text-xs mt-1">${r.listing_title}</p>` : ''}
        </div>
      `).join('')

  const content = `
  <div class="pt-16 min-h-screen">
    <div class="max-w-7xl mx-auto px-4 py-8">
      
      <!-- Header -->
      <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 class="text-3xl font-black text-white">Host Dashboard</h1>
          <p class="text-gray-400 mt-1">Manage your spaces and track earnings</p>
        </div>
        <div class="flex gap-3">
          <button onclick="showAddListing()" class="btn-lime px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2">
            <i class="fas fa-plus"></i> Add New Listing
          </button>
        </div>
      </div>

      <!-- Stats Row — real D1 -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div class="stat-card rounded-2xl p-5 card-hover">
          <div class="flex items-start justify-between mb-3">
            <div class="w-10 h-10 bg-lime-500/10 rounded-xl flex items-center justify-center">
              <i class="fas fa-dollar-sign text-lime-500"></i>
            </div>
            ${totalRevenue > 0 ? '<i class="fas fa-arrow-trend-up text-green-400 text-xs"></i>' : '<i class="fas fa-minus text-gray-500 text-xs"></i>'}
          </div>
          <p class="text-2xl font-black text-white">${fmtMoney(totalRevenue)}</p>
          <p class="text-gray-400 text-xs mt-1 font-medium">Total Revenue</p>
          <p class="text-gray-500 text-xs mt-0.5">Paid out to date</p>
        </div>
        <div class="stat-card rounded-2xl p-5 card-hover">
          <div class="flex items-start justify-between mb-3">
            <div class="w-10 h-10 bg-indigo-500/10 rounded-xl flex items-center justify-center">
              <i class="fas fa-calendar-check text-indigo-400"></i>
            </div>
            ${activeBookings > 0 ? '<i class="fas fa-arrow-trend-up text-green-400 text-xs"></i>' : '<i class="fas fa-minus text-gray-500 text-xs"></i>'}
          </div>
          <p class="text-2xl font-black text-white">${activeBookings}</p>
          <p class="text-gray-400 text-xs mt-1 font-medium">Active Bookings</p>
          <p class="text-gray-500 text-xs mt-0.5">${pendingBookings} pending approval</p>
        </div>
        <div class="stat-card rounded-2xl p-5 card-hover">
          <div class="flex items-start justify-between mb-3">
            <div class="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center">
              <i class="fas fa-star text-amber-400"></i>
            </div>
            ${avgRating >= 4.5 ? '<i class="fas fa-arrow-trend-up text-green-400 text-xs"></i>' : '<i class="fas fa-minus text-gray-500 text-xs"></i>'}
          </div>
          <p class="text-2xl font-black text-white">${avgRating > 0 ? avgRating : '–'}</p>
          <p class="text-gray-400 text-xs mt-1 font-medium">Avg Rating</p>
          <p class="text-gray-500 text-xs mt-0.5">Across all listings</p>
        </div>
        <div class="stat-card rounded-2xl p-5 card-hover">
          <div class="flex items-start justify-between mb-3">
            <div class="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center">
              <i class="fas fa-parking text-blue-400"></i>
            </div>
            <i class="fas fa-minus text-gray-500 text-xs"></i>
          </div>
          <p class="text-2xl font-black text-white">${activeListings}</p>
          <p class="text-gray-400 text-xs mt-1 font-medium">Active Listings</p>
          <p class="text-gray-500 text-xs mt-0.5">Live on platform</p>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        <!-- Left: Listings + Booking Requests -->
        <div class="lg:col-span-2 space-y-6">
          
          <!-- My Listings -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden">
            <div class="flex items-center justify-between p-5 border-b border-white/5">
              <h3 class="font-bold text-white text-lg">My Listings</h3>
              <button onclick="showAddListing()" class="text-indigo-400 hover:text-indigo-300 text-sm font-medium transition-colors">
                <i class="fas fa-plus mr-1"></i> Add New
              </button>
            </div>
            <div class="divide-y divide-white/5">
              ${listingsHTML}
            </div>
          </div>

          <!-- Booking Requests -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden">
            <div class="flex items-center justify-between p-5 border-b border-white/5">
              <h3 class="font-bold text-white text-lg">Booking Requests</h3>
              ${pendingBookings > 0 ? `<span class="bg-indigo-500 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center">${pendingBookings}</span>` : '<span class="text-gray-500 text-xs">None pending</span>'}
            </div>
            <div class="divide-y divide-white/5">
              ${pendingHTML}
            </div>
          </div>

          <!-- Recent Confirmed Bookings -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden">
            <div class="flex items-center justify-between p-5 border-b border-white/5">
              <h3 class="font-bold text-white text-lg">
                <i class="fas fa-calendar-check text-green-400 mr-2 text-base"></i>Confirmed Bookings
              </h3>
              ${recentConfirmed.length > 0
                ? `<span class="bg-green-500/20 text-green-400 text-xs font-bold px-2.5 py-1 rounded-full border border-green-500/20">${recentConfirmed.length} active</span>`
                : '<span class="text-gray-500 text-xs">None yet</span>'}
            </div>
            <div class="divide-y divide-white/5">
              ${confirmedHTML}
            </div>
          </div>

          <!-- Availability Calendar -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
            <div class="flex items-center justify-between mb-4">
              <h3 class="font-bold text-white text-lg"><i class="fas fa-calendar text-indigo-400 mr-2"></i>Availability Calendar</h3>
              <button onclick="window.location.href='/host'" class="btn-primary px-4 py-2 rounded-xl text-xs text-white font-semibold">
                Refresh
              </button>
            </div>
            ${generateHostCalendar()}
          </div>
        </div>

        <!-- Right Sidebar -->
        <div class="space-y-6">

          <!-- Tier Status Card -->
          ${tierCardHTML || `
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
            <div class="flex items-center gap-2 mb-2">
              <i class="fas fa-key text-gray-400"></i>
              <h3 class="font-bold text-white text-sm">Host Tier</h3>
            </div>
            <p class="text-gray-500 text-xs">Complete your first booking to unlock host tier status.</p>
          </div>`}
          
          <!-- Payout Card — real data -->
          <div class="relative gradient-bg rounded-2xl p-5 overflow-hidden">
            <div class="absolute top-0 right-0 w-32 h-32 bg-lime-500/10 rounded-full blur-2xl"></div>
            <div class="relative z-10">
              <p class="text-white/70 text-sm mb-1">Estimated Next Payout</p>
              <p class="text-4xl font-black text-white mb-1">${nextPayout > 0 ? fmtMoney(nextPayout) : '$0'}</p>
              <p class="text-indigo-200 text-xs mb-4">Based on confirmed bookings</p>
              <div class="space-y-2 text-sm">
                <div class="flex justify-between text-indigo-200">
                  <span>Pending bookings</span>
                  <span class="text-white">${fmtMoney(payoutPending)}</span>
                </div>
                <div class="flex justify-between text-indigo-200">
                  <span>Platform fee (15%)</span>
                  <span class="text-white">-${fmtMoney(payoutPending * 0.15)}</span>
                </div>
                <div class="border-t border-white/20 pt-2 flex justify-between font-bold">
                  <span class="text-white">Your payout</span>
                  <span class="text-lime-400">${fmtMoney(nextPayout)}</span>
                </div>
              </div>
              <button id="manage-payouts-btn" onclick="handleManagePayouts(this)" class="mt-4 w-full py-2.5 bg-lime-500 text-charcoal rounded-xl text-sm font-bold hover:bg-lime-400 transition-colors flex items-center justify-center gap-2">
                <i class="fas fa-wallet"></i> Manage Payouts
              </button>
            </div>
          </div>

          <!-- Recent Reviews -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
            <div class="flex items-center justify-between mb-4">
              <h3 class="font-bold text-white">Recent Reviews</h3>
              <span class="text-xs text-gray-400">From real bookings</span>
            </div>
            <div class="space-y-3">
              ${reviewsHTML}
            </div>
          </div>

          <!-- Host Tips -->
          <div class="bg-indigo-500/10 border border-indigo-500/20 rounded-2xl p-4">
            <h4 class="text-indigo-300 font-semibold text-sm mb-2 flex items-center gap-2">
              <i class="fas fa-lightbulb text-lime-500"></i> Host Tips
            </h4>
            <ul class="space-y-1.5 text-xs text-gray-400">
              <li class="flex items-center gap-2"><i class="fas fa-check text-lime-500 text-xs"></i> Add more photos to increase bookings by 40%</li>
              <li class="flex items-center gap-2"><i class="fas fa-check text-lime-500 text-xs"></i> Enable Instant Book for 2x more reservations</li>
              <li class="flex items-center gap-2"><i class="fas fa-check text-lime-500 text-xs"></i> Respond within 1hr to get Superhost status</li>
            </ul>
          </div>

          <!-- Host Agreement Status Card -->
          <div class="bg-charcoal-100 border ${hostAgreementVersion === currentAgreementVersion ? 'border-green-500/20' : 'border-yellow-500/30 ring-1 ring-yellow-500/20'} rounded-2xl p-4">
            <h4 class="text-gray-300 font-semibold text-sm mb-2 flex items-center gap-2">
              <i class="fas fa-file-signature ${hostAgreementVersion === currentAgreementVersion ? 'text-green-400' : 'text-yellow-400'}"></i>
              Host Agreement
              ${hostAgreementVersion === currentAgreementVersion
                ? `<span class="ml-auto text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">v${currentAgreementVersion} Accepted</span>`
                : `<span class="ml-auto text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full animate-pulse">Action Required</span>`
              }
            </h4>
            ${hostAgreementVersion === currentAgreementVersion
              ? `<p class="text-gray-500 text-xs mb-3">You've accepted the current Host Agreement. Required before creating listings.</p>
                 <a href="/legal/host-agreement" target="_blank"
                   class="text-indigo-400 text-xs hover:text-indigo-300 transition-colors flex items-center gap-1">
                   <i class="fas fa-external-link-alt text-xs"></i> View Full Agreement
                 </a>`
              : `<p class="text-yellow-300/80 text-xs mb-3">You must accept the current Host Agreement (v${currentAgreementVersion}) to create or manage listings.</p>
                 <button onclick="openAgreementModal()"
                   class="w-full py-2.5 bg-yellow-500/20 border border-yellow-500/40 hover:bg-yellow-500/30 text-yellow-300 rounded-xl text-sm font-semibold transition-colors">
                   <i class="fas fa-signature mr-2 text-xs"></i>Review & Accept Agreement
                 </button>`
            }
          </div>

          <!-- Danger Zone -->
          <div class="bg-charcoal-100 border border-red-500/10 rounded-2xl p-4">
            <h4 class="text-gray-400 font-semibold text-sm mb-2 flex items-center gap-2">
              <i class="fas fa-triangle-exclamation text-red-500/60"></i> Danger Zone
            </h4>
            <p class="text-gray-500 text-xs mb-3">Permanently remove your account and all listings. This action cannot be undone.</p>
            <button onclick="openDeleteAccount()"
              class="w-full py-2.5 bg-transparent border border-red-500/20 hover:bg-red-500/10 text-red-400 hover:text-red-300 rounded-xl text-sm font-medium transition-colors">
              <i class="fas fa-trash-alt mr-2 text-xs"></i>Delete Account
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Manage Listing Modal (Archive / Remove) -->
  <div id="manage-listing-modal" class="hidden fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onclick="closeManageModal(event)">
    <div class="bg-charcoal-100 rounded-3xl w-full max-w-md border border-white/10 overflow-hidden" onclick="event.stopPropagation()">

      <!-- Header -->
      <div class="flex items-center justify-between p-6 border-b border-white/10">
        <div>
          <h3 class="text-xl font-bold text-white">Manage Listing</h3>
          <p id="manage-listing-subtitle" class="text-gray-400 text-sm mt-0.5 truncate max-w-xs"></p>
        </div>
        <button onclick="hideManageModal()" class="w-8 h-8 bg-charcoal-200 rounded-full flex items-center justify-center text-gray-400 hover:text-white transition-colors">
          <i class="fas fa-times text-sm"></i>
        </button>
      </div>

      <!-- State: checking bookings (spinner) -->
      <div id="manage-state-loading" class="hidden p-8 text-center">
        <i class="fas fa-spinner fa-spin text-indigo-400 text-2xl mb-3 block"></i>
        <p class="text-gray-400 text-sm">Checking for active bookings…</p>
      </div>

      <!-- State: has active bookings — cannot remove -->
      <div id="manage-state-blocked" class="hidden p-6">
        <div class="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-5 mb-5">
          <div class="flex items-start gap-3">
            <i class="fas fa-exclamation-triangle text-amber-400 text-lg mt-0.5 flex-shrink-0"></i>
            <div>
              <p class="text-amber-300 font-semibold text-sm mb-1">Active Booking in Progress</p>
              <p id="manage-blocked-msg" class="text-amber-200/70 text-xs leading-relaxed">
                This listing has an active or upcoming booking. You can archive or remove it once all current reservations are completed.
              </p>
            </div>
          </div>
        </div>
        <button onclick="hideManageModal()" class="w-full py-3 bg-charcoal-200 hover:bg-charcoal-300 text-white rounded-xl text-sm font-semibold transition-colors border border-white/10">
          Got it
        </button>
      </div>

      <!-- State: available — show archive + remove options -->
      <div id="manage-state-options" class="hidden p-6 space-y-3">

        <!-- Archive option -->
        <div class="bg-charcoal-200 border border-white/5 hover:border-amber-500/30 rounded-2xl p-4 transition-colors cursor-pointer" onclick="showConfirm('archive')">
          <div class="flex items-center gap-4">
            <div class="w-11 h-11 bg-amber-500/10 rounded-xl flex items-center justify-center flex-shrink-0">
              <i class="fas fa-box-archive text-amber-400 text-lg"></i>
            </div>
            <div class="flex-1">
              <p class="text-white font-semibold text-sm">Archive Listing</p>
              <p class="text-gray-400 text-xs mt-0.5">Hide from search results. All reviews &amp; history are preserved. Restore any time.</p>
            </div>
            <i class="fas fa-chevron-right text-gray-600 text-xs"></i>
          </div>
        </div>

        <!-- Permanent remove option -->
        <div class="bg-charcoal-200 border border-white/5 hover:border-red-500/30 rounded-2xl p-4 transition-colors cursor-pointer" onclick="showConfirm('remove')">
          <div class="flex items-center gap-4">
            <div class="w-11 h-11 bg-red-500/10 rounded-xl flex items-center justify-center flex-shrink-0">
              <i class="fas fa-trash-alt text-red-400 text-lg"></i>
            </div>
            <div class="flex-1">
              <p class="text-white font-semibold text-sm">Remove Listing</p>
              <p class="text-gray-400 text-xs mt-0.5">Permanently delete this listing. This action cannot be undone.</p>
            </div>
            <i class="fas fa-chevron-right text-gray-600 text-xs"></i>
          </div>
        </div>

        <button onclick="hideManageModal()" class="w-full py-2.5 bg-transparent hover:bg-white/5 text-gray-400 rounded-xl text-sm transition-colors">
          Cancel
        </button>
      </div>

      <!-- State: confirm archive -->
      <div id="manage-state-confirm-archive" class="hidden p-6 space-y-4">
        <div class="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4">
          <p class="text-amber-300 font-semibold text-sm mb-1"><i class="fas fa-box-archive mr-2"></i>Archive this listing?</p>
          <p class="text-amber-200/70 text-xs leading-relaxed">
            Your listing will be hidden from search results and new bookings will be paused. Reviews and booking history are kept. You can restore it any time from this dashboard.
          </p>
        </div>
        <div id="manage-action-error" class="hidden bg-red-500/10 border border-red-500/20 rounded-xl p-3">
          <p id="manage-action-error-msg" class="text-red-400 text-sm"></p>
        </div>
        <div class="flex gap-3">
          <button onclick="showState('options')" class="flex-1 py-3 bg-charcoal-200 hover:bg-charcoal-300 text-gray-300 rounded-xl text-sm font-semibold transition-colors border border-white/10">
            Back
          </button>
          <button id="manage-archive-btn" onclick="executeAction('archive')"
            class="flex-1 py-3 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 hover:text-amber-200 rounded-xl text-sm font-bold transition-colors border border-amber-500/20">
            <i class="fas fa-box-archive mr-2"></i>Archive Listing
          </button>
        </div>
      </div>

      <!-- State: confirm remove -->
      <div id="manage-state-confirm-remove" class="hidden p-6 space-y-4">
        <div class="bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
          <p class="text-red-400 font-semibold text-sm mb-1"><i class="fas fa-exclamation-triangle mr-2"></i>Permanently remove this listing?</p>
          <p class="text-red-300/70 text-xs leading-relaxed">
            This will permanently delete the listing and cannot be undone. Past completed bookings will remain in booking history.
          </p>
        </div>
        <div id="manage-remove-error" class="hidden bg-red-500/10 border border-red-500/20 rounded-xl p-3">
          <p id="manage-remove-error-msg" class="text-red-400 text-sm"></p>
        </div>
        <div class="flex gap-3">
          <button onclick="showState('options')" class="flex-1 py-3 bg-charcoal-200 hover:bg-charcoal-300 text-gray-300 rounded-xl text-sm font-semibold transition-colors border border-white/10">
            Back
          </button>
          <button id="manage-remove-btn" onclick="executeAction('remove')"
            class="flex-1 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 rounded-xl text-sm font-bold transition-colors border border-red-500/20">
            <i class="fas fa-trash-alt mr-2"></i>Remove Listing
          </button>
        </div>
      </div>

      <!-- State: success -->
      <div id="manage-state-success" class="hidden p-8 text-center">
        <div id="manage-success-icon" class="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <i class="fas fa-check text-green-400 text-2xl"></i>
        </div>
        <p id="manage-success-title" class="text-white font-bold text-lg mb-2">Done!</p>
        <p id="manage-success-msg" class="text-gray-400 text-sm">Refreshing your dashboard…</p>
      </div>

    </div>
  </div>

  <!-- Restore Confirmation Modal -->
  <div id="restore-modal" class="hidden fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onclick="closeRestoreModal(event)">
    <div class="bg-charcoal-100 rounded-3xl w-full max-w-sm border border-white/10 overflow-hidden p-6 space-y-4" onclick="event.stopPropagation()">
      <div class="flex items-center gap-3">
        <div class="w-11 h-11 bg-green-500/10 rounded-xl flex items-center justify-center flex-shrink-0">
          <i class="fas fa-undo text-green-400 text-lg"></i>
        </div>
        <div>
          <p class="text-white font-bold text-sm">Restore Listing?</p>
          <p id="restore-listing-name" class="text-gray-400 text-xs mt-0.5"></p>
        </div>
      </div>
      <p class="text-gray-400 text-sm">This listing will become active again and visible to drivers on ParkPeer.</p>
      <div id="restore-error" class="hidden bg-red-500/10 border border-red-500/20 rounded-xl p-3">
        <p id="restore-error-msg" class="text-red-400 text-sm"></p>
      </div>
      <div class="flex gap-3">
        <button onclick="document.getElementById('restore-modal').classList.add('hidden')" class="flex-1 py-3 bg-charcoal-200 hover:bg-charcoal-300 text-gray-300 rounded-xl text-sm font-semibold transition-colors border border-white/10">
          Cancel
        </button>
        <button id="restore-btn" onclick="executeRestore()"
          class="flex-1 py-3 bg-green-500/20 hover:bg-green-500/30 text-green-400 hover:text-green-300 rounded-xl text-sm font-bold transition-colors border border-green-500/20">
          <i class="fas fa-undo mr-2"></i>Restore
        </button>
      </div>
    </div>
  </div>

  <!-- Add Listing Modal -->
  <div id="add-listing-modal" class="hidden fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
    <div id="add-listing-modal-inner" class="bg-charcoal-100 rounded-3xl w-full max-w-2xl border border-white/10 overflow-hidden max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between p-6 border-b border-white/10 sticky top-0 bg-charcoal-100 z-10">
        <h3 class="text-xl font-bold text-white">Create New Listing</h3>
        <button onclick="hideAddListing()" class="w-8 h-8 bg-charcoal-200 rounded-full flex items-center justify-center text-gray-400 hover:text-white">
          <i class="fas fa-times text-sm"></i>
        </button>
      </div>

      <!-- Error/Success banners (kept at top for legacy scroll targets) -->
      <div id="listing-error" class="hidden mx-6 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2">
        <i class="fas fa-exclamation-circle text-red-400 text-sm"></i>
        <p id="listing-error-msg" class="text-red-400 text-sm">Please fill in all required fields.</p>
      </div>
      <div id="listing-success" class="hidden mx-6 mt-4 p-3 bg-green-500/10 border border-green-500/20 rounded-xl flex items-center gap-2">
        <i class="fas fa-check-circle text-green-400 text-sm"></i>
        <p class="text-green-400 text-sm font-semibold">Listing created! Redirecting…</p>
      </div>

      <div class="p-6 space-y-5">
        <!-- Title -->
        <div>
          <label class="text-sm text-gray-400 font-medium block mb-2">Space Title <span class="text-red-400">*</span></label>
          <input type="text" id="listing-title" maxlength="120"
            placeholder="e.g. Secure Downtown Driveway"
            class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"/>
        </div>

        <!-- Type -->
        <div>
          <label class="text-sm text-gray-400 font-medium block mb-2">Space Type <span class="text-red-400">*</span></label>
          <input type="hidden" id="listing-type" value="driveway"/>
          <div class="grid grid-cols-3 gap-2">
            ${[{t:'Driveway',v:'driveway',icon:'🏠'},{t:'Garage',v:'garage',icon:'🏗️'},{t:'Lot',v:'lot',icon:'🅿️'},{t:'Covered',v:'covered',icon:'🏢'},{t:'Street',v:'street',icon:'🛣️'},{t:'Indoor',v:'covered',icon:'🏛️'}].map((type, i) => `
              <button type="button" onclick="selectType(this, '${type.v}')"
                class="type-btn p-3 bg-charcoal-200 border ${i===0?'border-indigo-500 bg-indigo-500/10':'border-white/5 hover:border-indigo-500/40'} rounded-xl text-center transition-all">
                <span class="text-2xl block mb-1">${type.icon}</span>
                <span class="text-xs text-gray-400">${type.t}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Address Autocomplete — Mapbox-powered verified address entry -->
        <div>
          <label class="text-sm text-gray-400 font-medium block mb-2">
            Property Address <span class="text-red-400">*</span>
          </label>

          <!-- Search input -->
          <div class="relative">
            <div class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <i id="addr-icon" class="fas fa-search text-gray-500 text-sm transition-colors"></i>
            </div>
            <input
              type="text"
              id="listing-address-input"
              maxlength="300"
              placeholder="Start typing your address…"
              autocomplete="off"
              class="w-full bg-charcoal-200 border border-white/10 rounded-xl pl-9 pr-28 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors"
              oninput="onAddressInput(this)"
              onkeydown="onAddressKeydown(event)"
            />
            <div id="addr-badge" class="hidden absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-xs font-semibold"></div>
          </div>

          <!-- Autocomplete dropdown -->
          <div id="addr-dropdown" class="hidden relative">
            <ul id="addr-suggestions"
              class="absolute top-1 left-0 right-0 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl overflow-hidden max-h-60 overflow-y-auto z-50">
            </ul>
          </div>

          <!-- Verified address panel -->
          <div id="addr-verified-panel" class="hidden mt-3 p-3 bg-green-500/10 border border-green-500/20 rounded-xl">
            <div class="flex items-start justify-between gap-2">
              <div class="flex items-center gap-2 min-w-0">
                <i class="fas fa-circle-check text-green-400 flex-shrink-0 text-sm"></i>
                <div class="min-w-0">
                  <p id="addr-verified-text" class="text-green-300 text-xs font-semibold leading-snug"></p>
                  <p class="text-gray-500 text-xs mt-0.5">Address verified · coordinates confirmed</p>
                </div>
              </div>
              <button type="button" onclick="resetAddressVerification()"
                class="flex-shrink-0 text-gray-500 hover:text-yellow-400 text-xs transition-colors flex items-center gap-1 whitespace-nowrap">
                <i class="fas fa-pen text-xs"></i> Change
              </button>
            </div>
          </div>

          <!-- Error state -->
          <div id="addr-error-panel" class="hidden mt-2 flex items-center gap-1.5">
            <i class="fas fa-triangle-exclamation text-red-400 text-xs"></i>
            <p id="addr-error-text" class="text-red-400 text-xs"></p>
          </div>

          <!-- Hidden fields populated on autocomplete selection -->
          <input type="hidden" id="listing-address"       />
          <input type="hidden" id="listing-city"           />
          <input type="hidden" id="listing-state"          />
          <input type="hidden" id="listing-zip"            />
          <input type="hidden" id="listing-lat"            />
          <input type="hidden" id="listing-lng"            />
          <input type="hidden" id="listing-place-id"       />
          <input type="hidden" id="listing-addr-verified" value="0" />
        </div>

        <!-- Mini Map Preview (revealed after address verified) -->
        <div id="listing-map-preview" class="hidden">
          <label class="text-sm text-gray-400 font-medium block mb-2">
            <i class="fas fa-map-location-dot text-indigo-400 mr-1"></i>Location Preview
          </label>
          <div id="listing-map" class="w-full h-44 rounded-xl overflow-hidden border border-white/10 bg-charcoal-200 relative">
            <div class="absolute inset-0 flex items-center justify-center">
              <i class="fas fa-map text-gray-600 text-3xl"></i>
            </div>
          </div>
          <p class="text-gray-500 text-xs mt-1.5 flex items-center gap-1">
            <i class="fas fa-eye-slash text-xs"></i>
            Exact address hidden from drivers until booking confirmed.
          </p>
        </div>

        <!-- Rates -->
        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="text-sm text-gray-400 font-medium block mb-2">Hourly Rate ($)</label>
            <input type="number" id="listing-rate-hourly" min="0.5" max="500" step="0.5"
              placeholder="e.g. 8"
              class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"/>
          </div>
          <div>
            <label class="text-sm text-gray-400 font-medium block mb-2">Daily Rate ($)</label>
            <input type="number" id="listing-rate-daily" min="1" max="5000" step="1"
              placeholder="e.g. 35"
              class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"/>
          </div>
          <div>
            <label class="text-sm text-gray-400 font-medium block mb-2">Monthly Rate ($)</label>
            <input type="number" id="listing-rate-monthly" min="10" max="50000" step="5"
              placeholder="e.g. 180"
              class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"/>
          </div>
        </div>

        <!-- Description -->
        <div>
          <label class="text-sm text-gray-400 font-medium block mb-2">Description</label>
          <textarea id="listing-description" maxlength="2000" rows="3"
            placeholder="Describe your space, access instructions, nearby landmarks..."
            class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"></textarea>
        </div>

        <!-- Amenities -->
        <div>
          <label class="text-sm text-gray-400 font-medium block mb-2">Amenities</label>
          <div class="grid grid-cols-2 gap-2">
            ${[
              {v:'security_camera', label:'CCTV Camera'},
              {v:'gated',           label:'Gated Access'},
              {v:'lighting',        label:'24/7 Lighting'},
              {v:'covered',         label:'Covered/Indoor'},
              {v:'ev_charging',     label:'EV Charging'},
              {v:'24hr_access',     label:'24/7 Access'},
            ].map(f => `
              <label class="flex items-center gap-3 p-3 bg-charcoal-200 rounded-xl cursor-pointer border border-white/5 hover:border-indigo-500/30">
                <input type="checkbox" value="${f.v}" class="amenity-check accent-indigo-500 w-4 h-4"/>
                <span class="text-sm text-gray-300">${f.label}</span>
              </label>
            `).join('')}
          </div>
        </div>

        <!-- Instant Book -->
        <div class="flex items-center justify-between p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
          <div>
            <p class="font-semibold text-white text-sm">Enable Instant Book</p>
            <p class="text-gray-400 text-xs mt-0.5">Guests can book without your manual approval</p>
          </div>
          <button type="button" id="instant-toggle" onclick="toggleInstant(this)" class="w-12 h-6 bg-charcoal-300 rounded-full relative transition-colors">
            <div class="w-5 h-5 bg-white rounded-full absolute top-0.5 left-0.5 shadow transition-transform" id="instant-dot"></div>
          </button>
        </div>
      </div>

      <!-- Bottom error banner — always visible above submit button -->
      <div id="listing-error-bottom" class="hidden mx-4 mb-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2">
        <i class="fas fa-exclamation-circle text-red-400 text-sm flex-shrink-0"></i>
        <p id="listing-error-msg-bottom" class="text-red-400 text-sm"></p>
      </div>

      <div class="p-4 border-t border-white/10 flex gap-3 sticky bottom-0 bg-charcoal-100">
        <button type="button" onclick="hideAddListing()"
          class="flex-1 py-3 bg-charcoal-200 text-gray-400 rounded-xl font-semibold text-sm hover:text-white transition-colors">
          Cancel
        </button>
        <button type="button" id="listing-submit-btn" onclick="submitListing()"
          class="flex-1 py-3 btn-primary text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2">
          <i class="fas fa-plus-circle"></i> Create Listing
        </button>
      </div>
    </div>
  </div>

  <script>
    function showAddListing() { document.getElementById('add-listing-modal').classList.remove('hidden'); }
    function hideAddListing() {
      document.getElementById('add-listing-modal').classList.add('hidden');
      document.getElementById('listing-error').classList.add('hidden');
      document.getElementById('listing-error-bottom').classList.add('hidden');
      document.getElementById('listing-success').classList.add('hidden');
      // Reset address autocomplete state when modal is closed
      if (typeof resetAddressVerification === 'function') resetAddressVerification();
    }

    function selectType(btn, value) {
      document.querySelectorAll('.type-btn').forEach(b => {
        b.classList.remove('border-indigo-500', 'bg-indigo-500/10');
        b.classList.add('border-white/5');
      });
      btn.classList.add('border-indigo-500', 'bg-indigo-500/10');
      btn.classList.remove('border-white/5');
      document.getElementById('listing-type').value = value;
    }

    let instantEnabled = false;
    function toggleInstant(btn) {
      instantEnabled = !instantEnabled;
      btn.style.backgroundColor = instantEnabled ? '#5B2EFF' : '';
      document.getElementById('instant-dot').style.transform = instantEnabled ? 'translateX(24px)' : '';
    }

    async function submitListing() {
      const errEl  = document.getElementById('listing-error');
      const errMsg = document.getElementById('listing-error-msg');
      const succEl = document.getElementById('listing-success');
      const btn    = document.getElementById('listing-submit-btn');
      errEl.classList.add('hidden');
      succEl.classList.add('hidden');
      document.getElementById('listing-error-bottom')?.classList.add('hidden');

      // Collect values
      const title    = document.getElementById('listing-title')?.value?.trim() || '';
      const type     = document.getElementById('listing-type')?.value || 'driveway';
      const address  = document.getElementById('listing-address')?.value?.trim() || '';
      const city     = document.getElementById('listing-city')?.value?.trim() || '';
      const state    = document.getElementById('listing-state')?.value?.trim() || '';
      const zip      = document.getElementById('listing-zip')?.value?.trim() || '';
      const lat      = parseFloat(document.getElementById('listing-lat')?.value || '') || null;
      const lng      = parseFloat(document.getElementById('listing-lng')?.value || '') || null;
      const placeId  = document.getElementById('listing-place-id')?.value?.trim() || '';
      const addrVerif= document.getElementById('listing-addr-verified')?.value || '0';
      const rateH    = document.getElementById('listing-rate-hourly')?.value || '';
      const rateD    = document.getElementById('listing-rate-daily')?.value || '';
      const rateM    = document.getElementById('listing-rate-monthly')?.value || '';
      const desc     = document.getElementById('listing-description')?.value?.trim() || '';
      const amenities = Array.from(document.querySelectorAll('.amenity-check:checked')).map(cb => cb.value);

      // Validate required fields
      if (!title) { showListingError('Space title is required.'); return; }
      // Require that address was selected from autocomplete (has lat/lng)
      if (!lat || !lng) {
        showListingError('Please select a verified address from the autocomplete suggestions.');
        const inp = document.getElementById('listing-address-input');
        if (inp) inp.focus();
        return;
      }
      if (!address) { showListingError('Street address is required.'); return; }
      if (!city)    { showListingError('City is required.'); return; }
      if (!state)   { showListingError('State is required.'); return; }
      if (!zip)     { showListingError('ZIP code is required.'); return; }
      if (!rateH && !rateD && !rateM) { showListingError('Please set at least one rate (hourly, daily, or monthly).'); return; }

      // ── Agreement gate: if host hasn't accepted, close listing modal and open agreement modal
      const agreedVersion = ${JSON.stringify(hostAgreementVersion)};
      const requiredVersion = ${JSON.stringify(currentAgreementVersion)};
      if (agreedVersion !== requiredVersion) {
        hideAddListing();
        setTimeout(() => openAgreementModal(), 100);
        return;
      }

      // Get CSRF token from the __pp_csrf cookie (set as non-HttpOnly after login/OAuth)
      const csrfToken = document.cookie.split('; ').find(r => r.startsWith('__pp_csrf='))?.split('=')[1] || '';

      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';

      try {
        const res = await fetch('/api/listings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          credentials: 'same-origin',
          body: JSON.stringify({
            title, type, address, city, state, zip,
            rate_hourly:  rateH  ? parseFloat(rateH)  : null,
            rate_daily:   rateD  ? parseFloat(rateD)   : null,
            rate_monthly: rateM  ? parseFloat(rateM) : null,
            description: desc,
            amenities,
            instant_book: instantEnabled,
            lat:          lat,
            lng:          lng,
            place_id:     placeId,
            address_verified: true,
          }),
        });

        const data = await res.json().catch(() => ({}));
        console.log('[submitListing] status=' + res.status, data);

        if (res.status === 401) {
          showListingError('You must be signed in to create a listing. Please log in and try again.');
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-plus-circle"></i> Create Listing';
          return;
        }

        if (res.status === 403) {
          // CSRF mismatch, wrong role, or agreement not accepted
          const msg = data.error || 'Access denied.';
          if (data.agreement_required) {
            // Close listing modal, open agreement modal
            hideAddListing();
            setTimeout(() => openAgreementModal(), 100);
            return;
          }
          if (msg.toLowerCase().includes('csrf')) {
            showListingError('Security token expired. Please refresh the page and try again.');
          } else {
            showListingError(msg);
          }
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-plus-circle"></i> Create Listing';
          return;
        }

        if (!res.ok) {
          showListingError(data.error || 'Failed to create listing. Please try again.');
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-plus-circle"></i> Create Listing';
          return;
        }

        // Success
        succEl.classList.remove('hidden');
        setTimeout(() => {
          window.location.href = data.redirect || '/host';
        }, 1200);

      } catch (err) {
        console.error('[submitListing] network error', err);
        showListingError('Network error. Please check your connection and try again.');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-plus-circle"></i> Create Listing';
      }
    }

    function showListingError(msg) {
      const errEl  = document.getElementById('listing-error');
      const errMsg = document.getElementById('listing-error-msg');
      const errEl2  = document.getElementById('listing-error-bottom');
      const errMsg2 = document.getElementById('listing-error-msg-bottom');
      if (errEl && errMsg) { errMsg.textContent = msg; errEl.classList.remove('hidden'); }
      // Also show error at the bottom near the submit button — always visible
      if (errEl2 && errMsg2) { errMsg2.textContent = msg; errEl2.classList.remove('hidden'); }
      // Scroll the modal container (not the page) to the bottom error
      const modal = document.getElementById('add-listing-modal-inner');
      if (modal) { setTimeout(() => modal.scrollTo({ top: modal.scrollHeight, behavior: 'smooth' }), 50); }
    }

    function acceptBooking(btn, id) {
      btn.closest('.flex').innerHTML = '<span class="text-green-400 text-sm font-semibold flex items-center gap-2"><i class="fas fa-check-circle"></i> Booking Accepted</span>';
      fetch('/api/bookings/' + id + '/confirm', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    }

    function declineBooking(btn, id) {
      btn.closest('.flex').innerHTML = '<span class="text-red-400 text-sm font-semibold flex items-center gap-2"><i class="fas fa-times-circle"></i> Booking Declined</span>';
      fetch('/api/bookings/' + id + '/cancel', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    }

    // ── Manage Payouts: smart routing ───────────────────────────────────────
    // Checks Stripe connection status before navigating so hosts without
    // a connected account are sent straight to onboarding (not a dead-end).
    async function handleManagePayouts(btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Loading…';
      try {
        const r = await fetch('/api/connect/status', { credentials: 'same-origin' });
        const d = await r.json();
        // If no account or onboarding not complete → go to onboarding
        if (!d.account_id || d.onboarding_status === 'not_started' || d.onboarding_status === 'pending' || !d.details_submitted) {
          window.location.href = '/host/connect/onboard';
        } else {
          // Account exists and details submitted → go to full cashout dashboard
          window.location.href = '/host/connect/cashout';
        }
      } catch (e) {
        // On network error fall back to cashout page (which handles the redirect itself)
        window.location.href = '/host/connect/cashout';
      }
    }

    // ── Manage Listing Modal ────────────────────────────────────────────────
    let _managingId    = null;
    let _managingTitle = '';
    const MANAGE_STATES = ['loading','blocked','options','confirm-archive','confirm-remove','success'];

    function showState(name) {
      MANAGE_STATES.forEach(s => {
        const el = document.getElementById('manage-state-' + s);
        if (el) el.classList.add('hidden');
      });
      const target = document.getElementById('manage-state-' + name);
      if (target) target.classList.remove('hidden');
    }

    function openManageListing(id, title) {
      _managingId    = id;
      _managingTitle = title;
      document.getElementById('manage-listing-subtitle').textContent = title;
      // clear error states
      ['manage-action-error','manage-remove-error'].forEach(eid => {
        const el = document.getElementById(eid);
        if (el) el.classList.add('hidden');
      });
      document.getElementById('manage-listing-modal').classList.remove('hidden');
      showState('loading');

      // Check for active bookings via a quick OPTIONS-like GET (no dedicated endpoint needed:
      // the archive/delete endpoint returns 409 if active — but we pre-check via a lightweight
      // fetch to avoid two round trips; we hit archive with a dry-run flag approach instead
      // we simply try to get the listing status inline from the available status API)
      // Use the archive attempt as a pre-check by passing a preview query param
      fetch('/api/listings/' + id + '/booking-check', { credentials: 'same-origin' })
        .then(r => r.json())
        .catch(() => ({ active_bookings: 0 }))
        .then(data => {
          if (data.active_bookings > 0) {
            const n = data.active_bookings;
            document.getElementById('manage-blocked-msg').textContent =
              'This listing has ' + n + ' active or upcoming booking' + (n > 1 ? 's' : '') +
              '. You can archive or remove it once all reservations are completed.';
            showState('blocked');
          } else {
            showState('options');
          }
        });
    }

    function showConfirm(action) {
      showState('confirm-' + action);
    }

    function hideManageModal() {
      document.getElementById('manage-listing-modal').classList.add('hidden');
      _managingId    = null;
      _managingTitle = '';
    }

    function closeManageModal(e) {
      if (e.target === document.getElementById('manage-listing-modal')) hideManageModal();
    }

    // ── Host Agreement Modal ─────────────────────────────────────────────────
    let _agreementScrolled = false;

    function openAgreementModal() {
      _agreementScrolled = false;
      document.getElementById('agreement-modal').classList.remove('hidden');
      document.body.style.overflow = 'hidden';
      const sa = document.getElementById('agreement-scroll-area');
      if (sa) sa.scrollTop = 0;
      const cb = document.getElementById('agreement-accept-check');
      if (cb) cb.checked = false;
      updateAgreementSubmit();
      document.getElementById('agreement-error').classList.add('hidden');
    }

    function closeAgreementModal(e) {
      // When called with an event (backdrop click), only close if the backdrop itself was clicked
      if (e && e.type === 'click' && e.target !== document.getElementById('agreement-modal')) return;
      document.getElementById('agreement-modal').classList.add('hidden');
      document.body.style.overflow = '';
    }

    function onAgreementScroll(el) {
      const threshold = el.scrollHeight - el.clientHeight - 80;
      if (el.scrollTop >= threshold && !_agreementScrolled) {
        _agreementScrolled = true;
        const label = document.getElementById('agreement-checkbox-label');
        if (label) label.classList.remove('opacity-50', 'pointer-events-none');
        const hint = document.getElementById('agreement-scroll-hint');
        if (hint) hint.classList.add('hidden');
      }
    }

    function updateAgreementSubmit() {
      const cb  = document.getElementById('agreement-accept-check');
      const btn = document.getElementById('agreement-submit-btn');
      if (!cb || !btn) return;
      if (cb.checked && _agreementScrolled) {
        btn.disabled = false;
        btn.className = 'px-6 py-3 btn-primary text-white rounded-xl font-semibold text-sm transition-all';
        btn.style.flex = '2';
      } else {
        btn.disabled = true;
        btn.className = 'px-6 py-3 bg-indigo-500/30 text-indigo-300 rounded-xl font-semibold text-sm cursor-not-allowed transition-all';
        btn.style.flex = '2';
      }
    }

    async function submitAgreementAcceptance() {
      const cb = document.getElementById('agreement-accept-check');
      const btn = document.getElementById('agreement-submit-btn');
      const err = document.getElementById('agreement-error');
      const errMsg = document.getElementById('agreement-error-msg');
      if (!cb?.checked || !_agreementScrolled) {
        err.classList.remove('hidden');
        errMsg.textContent = 'Please scroll through the full agreement and check the acceptance box.';
        return;
      }
      err.classList.add('hidden');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving…';
      try {
        const res = await fetch('/api/agreements/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
          credentials: 'same-origin',
          body: JSON.stringify({ document_type: 'host_agreement', version: '1.0', source: 'host_dashboard' }),
        });
        if (res.ok) {
          document.getElementById('agreement-modal').classList.add('hidden');
          document.body.style.overflow = '';
          // Show toast and reload to refresh the agreement card state
          const t = document.createElement('div');
          t.className = 'fixed bottom-6 right-6 z-[100] bg-green-500 text-white px-5 py-3 rounded-2xl shadow-xl flex items-center gap-2 text-sm font-semibold';
          t.innerHTML = '<i class="fas fa-check-circle"></i> Host Agreement accepted! Refreshing…';
          document.body.appendChild(t);
          setTimeout(() => location.reload(), 1800);
        } else {
          const data = await res.json().catch(() => ({}));
          err.classList.remove('hidden');
          errMsg.textContent = data.error || 'Failed to save acceptance. Please try again.';
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-signature mr-2"></i>Accept Agreement';
        }
      } catch (e) {
        err.classList.remove('hidden');
        errMsg.textContent = 'Network error. Please check your connection and try again.';
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-signature mr-2"></i>Accept Agreement';
      }
    }

    function getCsrfToken() {
      // Read from cookie __pp_csrf (non-httpOnly, written by server)
      const m = document.cookie.match(/(?:^|;\s*)__pp_csrf=([^;]+)/);
      if (m) return decodeURIComponent(m[1]).split('.').slice(0,3).join('.');
      return sessionStorage.getItem('csrf_token') || '';
    }

    async function executeAction(action) {
      if (!_managingId) return;
      const errId  = action === 'archive' ? 'manage-action-error' : 'manage-remove-error';
      const errMsg = action === 'archive' ? 'manage-action-error-msg' : 'manage-remove-error-msg';
      const btnId  = action === 'archive' ? 'manage-archive-btn' : 'manage-remove-btn';

      const errEl  = document.getElementById(errId);
      const btn    = document.getElementById(btnId);
      errEl.classList.add('hidden');

      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Processing…';

      const csrf = getCsrfToken();
      try {
        const url = action === 'archive'
          ? '/api/listings/' + _managingId + '/archive'
          : '/api/listings/' + _managingId;
        const method = action === 'archive' ? 'PATCH' : 'DELETE';

        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrf,
          },
          credentials: 'same-origin',
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const msg = data.error || 'Action failed. Please try again.';
          document.getElementById(errMsg).textContent = msg;
          errEl.classList.remove('hidden');
          btn.disabled = false;
          btn.innerHTML = action === 'archive'
            ? '<i class="fas fa-box-archive mr-2"></i>Archive Listing'
            : '<i class="fas fa-trash-alt mr-2"></i>Remove Listing';
          return;
        }

        // Success
        showState('success');
        if (action === 'archive') {
          document.getElementById('manage-success-icon').innerHTML = '<i class="fas fa-box-archive text-amber-400 text-2xl"></i>';
          document.getElementById('manage-success-icon').className = 'w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-4';
          document.getElementById('manage-success-title').textContent = 'Listing Archived';
          document.getElementById('manage-success-msg').textContent   = 'Hidden from search. Refreshing your dashboard…';
        } else {
          document.getElementById('manage-success-title').textContent = 'Listing Removed';
          document.getElementById('manage-success-msg').textContent   = 'Permanently deleted. Refreshing your dashboard…';
        }
        setTimeout(() => { window.location.reload(); }, 1500);

      } catch (err) {
        document.getElementById(errMsg).textContent = 'Network error. Please check your connection.';
        errEl.classList.remove('hidden');
        btn.disabled = false;
        btn.innerHTML = action === 'archive'
          ? '<i class="fas fa-box-archive mr-2"></i>Archive Listing'
          : '<i class="fas fa-trash-alt mr-2"></i>Remove Listing';
      }
    }

    // ── Restore Modal ───────────────────────────────────────────────────────
    let _restoringId = null;

    function confirmRestore(id, title) {
      _restoringId = id;
      document.getElementById('restore-listing-name').textContent = title;
      document.getElementById('restore-error').classList.add('hidden');
      document.getElementById('restore-btn').disabled = false;
      document.getElementById('restore-btn').innerHTML = '<i class="fas fa-undo mr-2"></i>Restore';
      document.getElementById('restore-modal').classList.remove('hidden');
    }

    function closeRestoreModal(e) {
      if (e.target === document.getElementById('restore-modal'))
        document.getElementById('restore-modal').classList.add('hidden');
    }

    async function executeRestore() {
      if (!_restoringId) return;
      const btn = document.getElementById('restore-btn');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Restoring…';

      const csrf = getCsrfToken();
      try {
        const res = await fetch('/api/listings/' + _restoringId + '/restore', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          credentials: 'same-origin',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          document.getElementById('restore-error-msg').textContent = data.error || 'Restore failed.';
          document.getElementById('restore-error').classList.remove('hidden');
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-undo mr-2"></i>Restore';
          return;
        }
        btn.innerHTML = '<i class="fas fa-check mr-2"></i>Restored!';
        setTimeout(() => { window.location.reload(); }, 1200);
      } catch {
        document.getElementById('restore-error-msg').textContent = 'Network error. Please try again.';
        document.getElementById('restore-error').classList.remove('hidden');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-undo mr-2"></i>Restore';
      }
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

    // ── Address Autocomplete (Mapbox) ─────────────────────────────────────
    (function initAddressAutocomplete() {
      // State machine: idle | searching | selected | error
      let addrState   = 'idle';
      let debounceTimer = null;
      let suggestions = [];
      let activeIdx   = -1;
      let listingMap  = null;
      let listingMarker = null;

      // ── DOM refs ──────────────────────────────────────────────────────
      const inputEl      = () => document.getElementById('listing-address-input');
      const dropdownEl   = () => document.getElementById('addr-dropdown');
      const suggestList  = () => document.getElementById('addr-suggestions');
      const badgeEl      = () => document.getElementById('addr-badge');
      const iconEl       = () => document.getElementById('addr-icon');
      const verifiedPanel= () => document.getElementById('addr-verified-panel');
      const verifiedText = () => document.getElementById('addr-verified-text');
      const errorPanel   = () => document.getElementById('addr-error-panel');
      const errorText    = () => document.getElementById('addr-error-text');
      const mapPreview   = () => document.getElementById('listing-map-preview');
      const mapEl        = () => document.getElementById('listing-map');
      const hiddenAddr   = () => document.getElementById('listing-address');
      const hiddenCity   = () => document.getElementById('listing-city');
      const hiddenState  = () => document.getElementById('listing-state');
      const hiddenZip    = () => document.getElementById('listing-zip');
      const hiddenLat    = () => document.getElementById('listing-lat');
      const hiddenLng    = () => document.getElementById('listing-lng');
      const hiddenPlace  = () => document.getElementById('listing-place-id');
      const hiddenVerif  = () => document.getElementById('listing-addr-verified');

      // ── Helpers ────────────────────────────────────────────────────────
      function setBadge(text, color) {
        const b = badgeEl();
        if (!text) { b.classList.add('hidden'); return; }
        b.textContent = text;
        b.className   = 'absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-xs font-semibold ' + color;
        b.classList.remove('hidden');
      }
      function setIcon(cls) {
        const i = iconEl();
        i.className = 'fas ' + cls + ' text-sm transition-colors';
      }
      function showError(msg) {
        const ep = errorPanel(), et = errorText();
        if (!ep || !et) return;
        et.textContent = msg;
        ep.classList.remove('hidden');
      }
      function clearError() {
        const ep = errorPanel();
        if (ep) ep.classList.add('hidden');
      }
      function clearDropdown() {
        const dl = dropdownEl(), sl = suggestList();
        if (dl) dl.classList.add('hidden');
        if (sl) sl.innerHTML = '';
        suggestions = [];
        activeIdx   = -1;
      }
      function clearHiddenFields() {
        [hiddenAddr, hiddenCity, hiddenState, hiddenZip, hiddenLat, hiddenLng, hiddenPlace].forEach(fn => {
          const el = fn(); if (el) el.value = '';
        });
        const hv = hiddenVerif(); if (hv) hv.value = '0';
      }
      function setVerifiedPanel(formatted) {
        const vp = verifiedPanel(), vt = verifiedText();
        if (!vp || !vt) return;
        vt.textContent = formatted;
        vp.classList.remove('hidden');
      }
      function hideVerifiedPanel() {
        const vp = verifiedPanel(); if (vp) vp.classList.add('hidden');
      }
      function showMapPreview(lat, lng) {
        const mp = mapPreview();
        if (!mp) return;
        mp.classList.remove('hidden');
        // Lazy-load Mapbox GL JS if not already loaded
        if (window.mapboxgl) {
          renderMiniMap(lat, lng);
        } else {
          const s = document.createElement('script');
          s.src = 'https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js';
          s.onload = () => renderMiniMap(lat, lng);
          document.head.appendChild(s);
          if (!document.querySelector('link[href*="mapbox-gl"]')) {
            const l = document.createElement('link');
            l.rel  = 'stylesheet';
            l.href = 'https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css';
            document.head.appendChild(l);
          }
        }
      }
      function renderMiniMap(lat, lng) {
        if (listingMap) {
          listingMap.setCenter([lng, lat]);
          if (listingMarker) listingMarker.setLngLat([lng, lat]);
          return;
        }
        // Fetch token then render
        fetch('/api/map/config', { credentials: 'same-origin' })
          .then(r => r.json())
          .then(d => {
            if (!d.mapbox_token) return;
            window.mapboxgl.accessToken = d.mapbox_token;
            listingMap = new window.mapboxgl.Map({
              container: 'listing-map',
              style: 'mapbox://styles/mapbox/dark-v11',
              center: [lng, lat],
              zoom: 15,
              interactive: false,
            });
            listingMarker = new window.mapboxgl.Marker({ color: '#6366f1' })
              .setLngLat([lng, lat])
              .addTo(listingMap);
          })
          .catch(() => {});
      }
      function hideMapPreview() {
        const mp = mapPreview();
        if (mp) mp.classList.add('hidden');
        if (listingMap) { listingMap.remove(); listingMap = null; listingMarker = null; }
      }

      // ── Global functions called from HTML ──────────────────────────────
      window.onAddressInput = function(el) {
        clearError();
        hideVerifiedPanel();
        clearHiddenFields();
        setBadge('', '');
        setIcon('fa-search text-gray-500');
        addrState = 'idle';

        const q = el.value.trim();
        if (q.length < 3) { clearDropdown(); return; }

        clearDropdown();
        setIcon('fa-spinner fa-spin text-indigo-400');
        setBadge('Searching…', 'text-gray-400');

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => fetchSuggestions(q), 320);
      };

      window.onAddressKeydown = function(e) {
        const sl = suggestList();
        if (!sl) return;
        const items = sl.querySelectorAll('li');
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          activeIdx = Math.min(activeIdx + 1, items.length - 1);
          updateActiveItem(items);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          activeIdx = Math.max(activeIdx - 1, 0);
          updateActiveItem(items);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (activeIdx >= 0 && suggestions[activeIdx]) selectSuggestion(suggestions[activeIdx]);
          else if (suggestions.length === 1) selectSuggestion(suggestions[0]);
        } else if (e.key === 'Escape') {
          clearDropdown();
        }
      };

      function updateActiveItem(items) {
        items.forEach((li, i) => {
          li.classList.toggle('bg-indigo-500/20', i === activeIdx);
        });
        if (items[activeIdx]) items[activeIdx].scrollIntoView({ block: 'nearest' });
      }

      window.selectAddressSuggestion = function(idx) { selectSuggestion(suggestions[idx]); };

      window.resetAddressVerification = function() {
        const inp = inputEl();
        if (inp) { inp.value = ''; inp.focus(); }
        clearDropdown();
        clearHiddenFields();
        clearError();
        hideVerifiedPanel();
        hideMapPreview();
        setBadge('', '');
        setIcon('fa-search text-gray-500');
        addrState = 'idle';
      };

      // ── Fetch suggestions from server-side proxy ───────────────────────
      async function fetchSuggestions(q) {
        try {
          const res  = await fetch('/api/geocode/autocomplete?q=' + encodeURIComponent(q) + '&types=address', {
            credentials: 'same-origin'
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.features) {
            setIcon('fa-search text-gray-500');
            setBadge('', '');
            if (data.error) showError(data.error);
            if (data.po_box_rejected) showError('P.O. Boxes are not permitted. Please enter a street address.');
            return;
          }
          setIcon('fa-search text-gray-500');
          setBadge('', '');
          renderSuggestions(data.features);
        } catch {
          setIcon('fa-search text-gray-500');
          setBadge('', '');
          showError('Address lookup unavailable. Please try again.');
        }
      }

      function renderSuggestions(list) {
        suggestions = list;
        activeIdx   = -1;
        const sl    = suggestList();
        const dl    = dropdownEl();
        if (!sl || !dl) return;
        sl.innerHTML = '';

        if (!list.length) {
          sl.innerHTML = '<li class="px-4 py-3 text-gray-500 text-sm italic">No matching addresses found</li>';
          dl.classList.remove('hidden');
          return;
        }

        list.forEach((s, i) => {
          const li = document.createElement('li');
          li.className = 'px-4 py-3 cursor-pointer hover:bg-indigo-500/20 transition-colors border-b border-white/5 last:border-0';
          li.innerHTML =
            '<div class="flex items-start gap-3">' +
            '  <i class="fas fa-map-marker-alt text-indigo-400 mt-0.5 flex-shrink-0 text-sm"></i>' +
            '  <div class="min-w-0">' +
            '    <p class="text-white text-sm font-medium truncate">' + escHtml(s.text || s.place_name) + '</p>' +
            '    <p class="text-gray-500 text-xs truncate mt-0.5">' + escHtml(s.place_name) + '</p>' +
            '  </div>' +
            '</div>';
          li.onclick = () => selectSuggestion(s);
          sl.appendChild(li);
        });
        dl.classList.remove('hidden');
      }

      async function selectSuggestion(s) {
        clearDropdown();
        setIcon('fa-spinner fa-spin text-indigo-400');
        setBadge('Verifying…', 'text-gray-400');
        clearError();

        try {
          // All data is already in the suggestion object returned by the first autocomplete call.
          // No second network request needed — avoids re-query failures on full place_name strings.
          const lat      = s.lat      || null;
          const lng      = s.lng      || null;
          const address  = (s.address || s.text || '').trim();
          const city     = (s.city    || '').trim();
          const state    = (s.state   || '').trim();
          const zip      = (s.zip     || '').trim();
          const placeId  = s.place_id || s.id || '';
          const formatted = s.place_name || address;

          if (!lat || !lng) {
            setIcon('fa-triangle-exclamation text-red-400');
            setBadge('✗ No coords', 'text-red-400');
            showError('Could not determine coordinates. Please select a different address.');
            addrState = 'error';
            return;
          }
          if (!address || address.length < 3) {
            setIcon('fa-triangle-exclamation text-red-400');
            setBadge('✗ Invalid', 'text-red-400');
            showError('Could not parse address. Please choose another suggestion.');
            addrState = 'error';
            return;
          }

          // Populate the visible input and all hidden fields
          const inp = inputEl();
          if (inp) inp.value = formatted;
          hiddenAddr().value  = address;
          hiddenCity().value  = city;
          hiddenState().value = state;
          hiddenZip().value   = zip;
          hiddenLat().value   = lat;
          hiddenLng().value   = lng;
          hiddenPlace().value = placeId;
          hiddenVerif().value = '1';

          // UI feedback
          setIcon('fa-circle-check text-green-400');
          setBadge('✓ Verified', 'text-green-400');
          setVerifiedPanel(formatted);
          showMapPreview(lat, lng);
          addrState = 'selected';

        } catch(err) {
          setIcon('fa-triangle-exclamation text-red-400');
          setBadge('✗ Error', 'text-red-400');
          showError('Address verification failed. Please try again.');
          addrState = 'error';
        }
      }

      function escHtml(str) {
        return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      }

      // Close dropdown on outside click
      document.addEventListener('click', function(e) {
        const dl = dropdownEl();
        const inp = inputEl();
        if (dl && inp && !dl.contains(e.target) && e.target !== inp) {
          clearDropdown();
        }
      });
    })();

    // Auto-open agreement modal if host hasn't accepted current version
    (function checkAgreement() {
      const accepted = ${JSON.stringify(hostAgreementVersion)};
      const required = ${JSON.stringify(currentAgreementVersion)};
      if (accepted !== required) {
        // Show after brief delay so page renders first
        setTimeout(() => openAgreementModal(), 800);
      }
    })();
  </script>

  <!-- Host Agreement Acceptance Modal -->
  <div id="agreement-modal" class="hidden fixed inset-0 bg-black/90 z-[60] flex items-start justify-center p-4 overflow-y-auto"
       onclick="closeAgreementModal(event)">
    <div class="bg-charcoal-100 rounded-3xl w-full max-w-3xl border border-yellow-500/30 overflow-hidden my-8"
         onclick="event.stopPropagation()">

      <!-- Header -->
      <div class="flex items-center justify-between p-6 border-b border-white/10 sticky top-0 bg-charcoal-100 z-10">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 bg-yellow-500/10 rounded-full flex items-center justify-center">
            <i class="fas fa-file-signature text-yellow-400"></i>
          </div>
          <div>
            <h3 class="font-bold text-white">Host Agreement</h3>
            <p class="text-yellow-400 text-xs">Version ${currentAgreementVersion} — Acceptance Required</p>
          </div>
        </div>
        <button onclick="closeAgreementModal()" class="w-8 h-8 bg-charcoal-200 rounded-full flex items-center justify-center text-gray-400 hover:text-white">
          <i class="fas fa-times text-sm"></i>
        </button>
      </div>

      <!-- Scrollable Agreement Content -->
      <div id="agreement-scroll-area" class="p-6 max-h-[55vh] overflow-y-auto text-sm leading-relaxed"
           onscroll="onAgreementScroll(this)">
        <div class="prose-agreement">
          <!-- Intro banner -->
          <div class="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 mb-6">
            <p class="text-yellow-300 text-sm font-semibold flex items-center gap-2">
              <i class="fas fa-info-circle"></i>
              Please read the full agreement before accepting. Scroll to the bottom to enable the checkbox.
            </p>
          </div>

          <h3 class="text-lg font-semibold text-white mt-0 mb-3">1. ParkPeer's Role as Technology Intermediary</h3>
          <p class="text-gray-300 mb-3">ParkPeer operates exclusively as a technology intermediary and marketplace platform. We connect Hosts who wish to rent parking spaces with Drivers who seek parking. ParkPeer is not a parking operator, landlord, insurer, or transportation company. We do not own, control, offer, or manage any parking space listed on the platform. All liability arising from the physical condition, safety, or legality of a listed space rests solely with the Host.</p>

          <h3 class="text-lg font-semibold text-white mt-5 mb-3">2. Host Eligibility and Responsibilities</h3>
          <ul class="list-disc list-inside text-gray-300 mb-3 space-y-1 text-xs">
            <li>You must be at least 18 years old and legally authorized to list the space.</li>
            <li>You represent and warrant that you have all necessary rights, licenses, and permissions to rent the space (including landlord or HOA consent where required).</li>
            <li>You are solely responsible for ensuring the space is safe, accessible, and compliant with local zoning ordinances.</li>
            <li>You must accurately represent the space, including dimensions, amenities, access instructions, and restrictions.</li>
            <li>You must respond to booking requests within 24 hours unless Instant Book is enabled.</li>
            <li>You may not discriminate against Drivers on the basis of any protected class.</li>
          </ul>

          <h3 class="text-lg font-semibold text-white mt-5 mb-3">3. Fees and Payouts</h3>
          <p class="text-gray-300 mb-3">ParkPeer charges a platform service fee of <strong class="text-white">15%</strong> of the booking subtotal. You will receive the remaining 85% ("Host Payout") after each completed booking. Payouts are processed via Stripe Connect. You are solely responsible for any taxes owed on your rental income.</p>

          <h3 class="text-lg font-semibold text-white mt-5 mb-3">4. Cancellation Policy</h3>
          <div class="overflow-x-auto mb-3">
            <table class="w-full text-xs text-gray-300 border border-white/10 rounded-xl">
              <thead><tr class="bg-white/5">
                <th class="px-3 py-2 text-left font-semibold text-white">Timing</th>
                <th class="px-3 py-2 text-left font-semibold text-white">Driver Refund</th>
                <th class="px-3 py-2 text-left font-semibold text-white">Host Receives</th>
              </tr></thead>
              <tbody>
                <tr class="border-t border-white/5"><td class="px-3 py-2">&gt; 24 hours before</td><td class="px-3 py-2 text-green-400">100% refund</td><td class="px-3 py-2 text-gray-400">No payout</td></tr>
                <tr class="border-t border-white/5 bg-white/2"><td class="px-3 py-2">2 – 24 hours before</td><td class="px-3 py-2 text-yellow-400">50% refund</td><td class="px-3 py-2 text-white">50% of subtotal</td></tr>
                <tr class="border-t border-white/5"><td class="px-3 py-2">&lt; 2 hours before</td><td class="px-3 py-2 text-red-400">No refund</td><td class="px-3 py-2 text-white">Full payout</td></tr>
              </tbody>
            </table>
          </div>

          <h3 class="text-lg font-semibold text-white mt-5 mb-3">5. Host Protection Program</h3>
          <p class="text-gray-300 mb-3">ParkPeer offers basic Host Protection for documented damages caused by Drivers during a booking. Claims must be submitted within 72 hours with photographic evidence. ParkPeer's determination is final. Protection does not cover pre-existing conditions, normal wear and tear, or Host negligence.</p>

          <h3 class="text-lg font-semibold text-white mt-5 mb-3">6. Limitation of Liability & Indemnification</h3>
          <p class="text-gray-300 mb-3">ParkPeer's aggregate liability shall not exceed the total platform fees earned from that Host in the three months preceding the claim. You agree to indemnify and hold harmless ParkPeer from claims arising from your listings, your spaces, or your violation of this Agreement.</p>

          <h3 class="text-lg font-semibold text-white mt-5 mb-3">7. Governing Law & Dispute Resolution</h3>
          <p class="text-gray-300 mb-3">This Agreement is governed by the laws of the State of Delaware. Disputes are resolved by binding individual arbitration. Class action waivers apply.</p>

          <h3 class="text-lg font-semibold text-white mt-5 mb-3">8. Agreement Updates</h3>
          <p class="text-gray-300 mb-3">ParkPeer may update this Agreement at any time. Hosts will be notified of material changes and required to re-accept before their next listing action.</p>

          <p class="text-gray-500 text-xs mt-6 border-t border-white/10 pt-4">
            <a href="/legal/host-agreement" target="_blank" class="text-indigo-400 hover:text-indigo-300 underline">
              <i class="fas fa-external-link-alt text-xs mr-1"></i>View full agreement in new tab
            </a>
            &nbsp;·&nbsp; For questions: <a href="mailto:legal@parkpeer.com" class="text-indigo-400 underline">legal@parkpeer.com</a>
            &nbsp;·&nbsp; © 2026 ParkPeer, Inc.
          </p>
        </div>
      </div>

      <!-- Error banner -->
      <div id="agreement-error" class="hidden mx-6 mt-0 mb-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2">
        <i class="fas fa-exclamation-circle text-red-400 text-sm"></i>
        <p id="agreement-error-msg" class="text-red-400 text-sm">Please scroll through and check the box to accept.</p>
      </div>

      <!-- Acceptance checkbox + footer -->
      <div class="p-6 border-t border-white/10">
        <label id="agreement-checkbox-label" class="flex items-start gap-3 cursor-pointer select-none group opacity-50 pointer-events-none transition-opacity duration-300" id="agreement-accept-label">
          <input type="checkbox" id="agreement-accept-check"
            class="mt-0.5 w-5 h-5 accent-indigo-500 rounded cursor-pointer flex-shrink-0"
            oninput="updateAgreementSubmit()"/>
          <span class="text-gray-300 text-sm leading-relaxed">
            I have read and agree to the
            <a href="/legal/host-agreement" target="_blank" class="text-indigo-400 hover:text-indigo-300 underline font-semibold">ParkPeer Host Agreement</a>
            (Version ${currentAgreementVersion}), including the cancellation policy, fee structure,
            host responsibilities, limitation of liability, and indemnification clauses.
            I understand this is a legally binding agreement.
          </span>
        </label>
        <p id="agreement-scroll-hint" class="text-yellow-400 text-xs mt-2 flex items-center gap-1">
          <i class="fas fa-arrow-down text-xs animate-bounce"></i>
          Scroll to the bottom of the agreement above to enable the checkbox.
        </p>

        <div class="flex gap-3 mt-4">
          <button onclick="closeAgreementModal()"
            class="flex-1 py-3 bg-charcoal-200 text-gray-400 rounded-xl font-semibold text-sm hover:text-white transition-colors">
            Cancel
          </button>
          <button id="agreement-submit-btn" onclick="submitAgreementAcceptance()" disabled
            class="flex-2 px-6 py-3 bg-indigo-500/30 text-indigo-300 rounded-xl font-semibold text-sm cursor-not-allowed transition-all"
            style="flex: 2">
            <i class="fas fa-signature mr-2"></i>Accept Agreement
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Delete Account Confirmation Modal -->
  <div id="delete-account-modal" class="hidden fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onclick="closeDeleteAccountModal(event)">
    <div class="bg-charcoal-100 rounded-3xl w-full max-w-md border border-white/10 overflow-hidden" onclick="event.stopPropagation()">
      <div class="flex items-center justify-between p-6 border-b border-white/10">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 bg-red-500/10 rounded-full flex items-center justify-center">
            <i class="fas fa-trash-alt text-red-400"></i>
          </div>
          <div>
            <h3 class="font-bold text-white">Delete Account</h3>
            <p class="text-xs text-gray-400">This action is permanent</p>
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
            <li class="flex items-start gap-2"><i class="fas fa-times text-red-400 mt-0.5 flex-shrink-0"></i>All your listings will be archived</li>
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
  const navSession = { name: hostName || session?.name || '', role: session?.role || 'HOST', isAdmin: (session?.role || '').toUpperCase() === 'ADMIN' }
  // Front-end route guard: if __pp_csrf cookie is absent the session has expired.
  // This runs synchronously in <head> before any HTML renders — prevents UI flash.
  const guardScript = `<script>
    (function(){
      var hasCsrf = document.cookie.split(';').some(function(c){ return c.trim().startsWith('__pp_csrf='); });
      if (!hasCsrf) { window.location.replace('/auth/login?reason=auth'); }
    })();
  <\/script>`
  return c.html(Layout('Host Dashboard', content, guardScript, navSession))
})

function generateHostCalendar() {
  const today = new Date()
  const year  = today.getFullYear()
  const month = today.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDay    = new Date(year, month, 1).getDay()
  const monthName   = today.toLocaleString('default', { month: 'long' })
  
  let html = `
    <div class="flex items-center justify-between mb-4">
      <button class="w-8 h-8 bg-charcoal-200 rounded-full flex items-center justify-center text-gray-400"><i class="fas fa-chevron-left text-xs"></i></button>
      <span class="font-bold text-white">${monthName} ${year}</span>
      <button class="w-8 h-8 bg-charcoal-200 rounded-full flex items-center justify-center text-gray-400"><i class="fas fa-chevron-right text-xs"></i></button>
    </div>
    <div class="grid grid-cols-7 gap-1 text-center text-xs text-gray-500 mb-2">
      ${['S','M','T','W','T','F','S'].map(d => `<div class="font-medium">${d}</div>`).join('')}
    </div>
    <div class="grid grid-cols-7 gap-1">
  `
  for (let i = 0; i < firstDay; i++) html += `<div></div>`
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = d === today.getDate()
    const isPast  = d < today.getDate()
    let cls = 'w-8 h-8 mx-auto rounded-lg flex items-center justify-center text-xs cursor-pointer transition-all '
    if (isToday)   cls += 'gradient-bg text-white font-bold'
    else if (isPast) cls += 'text-gray-600 cursor-not-allowed'
    else           cls += 'text-gray-400 hover:bg-charcoal-200 hover:text-white'
    html += `<div><div class="${cls}">${d}</div></div>`
  }
  html += `</div>
    <div class="flex flex-wrap items-center gap-3 mt-4 text-xs text-gray-400">
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 gradient-bg rounded"></div> Today</div>
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 bg-charcoal-200 rounded"></div> Available</div>
    </div>
    <p class="text-xs text-gray-600 mt-2">Blocked dates loaded from live bookings. Manage in listing settings.</p>
  `
  return html
}

// ── GET /host/notifications ───────────────────────────────────────────────────
hostDashboard.get('/notifications', async (c) => {
  const session = c.get('user') as any
  const hostName = session?.name || session?.full_name || session?.email?.split('@')[0] || 'Host'
  const content = `
  <div class="max-w-2xl mx-auto py-8 px-4">
    <div class="flex items-center gap-3 mb-6">
      <a href="/host" class="text-gray-400 hover:text-white transition-colors">
        <i class="fas fa-arrow-left text-lg"></i>
      </a>
      <h1 class="text-2xl font-bold text-white">Notification Preferences</h1>
    </div>

    <div id="prefs-status" class="hidden mb-4 p-3 rounded-xl text-sm font-medium"></div>

    <div class="glass rounded-2xl border border-white/10 p-6 space-y-6">
      <div>
        <h3 class="font-semibold text-white mb-3 flex items-center gap-2">
          <i class="fas fa-car text-indigo-400"></i> Booking Notifications
        </h3>
        <div class="space-y-3 ml-6">
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">In-app notifications</span>
            <input type="checkbox" id="booking_inapp" class="w-4 h-4 accent-indigo-500">
          </label>
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">Email notifications</span>
            <input type="checkbox" id="booking_email" class="w-4 h-4 accent-indigo-500">
          </label>
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">SMS notifications</span>
            <input type="checkbox" id="booking_sms" class="w-4 h-4 accent-indigo-500">
          </label>
        </div>
      </div>
      <div class="border-t border-white/10"></div>
      <div>
        <h3 class="font-semibold text-white mb-3 flex items-center gap-2">
          <i class="fas fa-dollar-sign text-green-400"></i> Payout Notifications
        </h3>
        <div class="space-y-3 ml-6">
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">In-app notifications</span>
            <input type="checkbox" id="payout_inapp" class="w-4 h-4 accent-indigo-500">
          </label>
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">Email notifications</span>
            <input type="checkbox" id="payout_email" class="w-4 h-4 accent-indigo-500">
          </label>
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">SMS notifications</span>
            <input type="checkbox" id="payout_sms" class="w-4 h-4 accent-indigo-500">
          </label>
        </div>
      </div>
      <div class="border-t border-white/10"></div>
      <div>
        <h3 class="font-semibold text-white mb-3 flex items-center gap-2">
          <i class="fas fa-star text-amber-400"></i> Review Notifications
        </h3>
        <div class="space-y-3 ml-6">
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">In-app notifications</span>
            <input type="checkbox" id="review_inapp" class="w-4 h-4 accent-indigo-500">
          </label>
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">Email notifications</span>
            <input type="checkbox" id="review_email" class="w-4 h-4 accent-indigo-500">
          </label>
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">SMS notifications</span>
            <input type="checkbox" id="review_sms" class="w-4 h-4 accent-indigo-500">
          </label>
        </div>
      </div>
      <div class="border-t border-white/10"></div>
      <div>
        <h3 class="font-semibold text-white mb-3 flex items-center gap-2">
          <i class="fas fa-shield-alt text-blue-400"></i> System &amp; Security Alerts
        </h3>
        <div class="space-y-3 ml-6">
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">In-app notifications</span>
            <input type="checkbox" id="system_inapp" class="w-4 h-4 accent-indigo-500">
          </label>
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">Email notifications</span>
            <input type="checkbox" id="system_email" class="w-4 h-4 accent-indigo-500">
          </label>
          <label class="flex items-center justify-between cursor-pointer">
            <span class="text-gray-300 text-sm">SMS notifications</span>
            <input type="checkbox" id="system_sms" class="w-4 h-4 accent-indigo-500">
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
      try {
        const res = await fetch('/api/notifications/prefs');
        if (res.ok) { const { prefs } = await res.json(); fields.forEach(f => { const el = document.getElementById(f); if (el) el.checked = prefs[f] === 1; }); }
      } catch {}
      document.getElementById('save-prefs-btn').addEventListener('click', async () => {
        const body = {};
        fields.forEach(f => { const el = document.getElementById(f); body[f] = el && el.checked ? 1 : 0; });
        try {
          const res = await fetch('/api/notifications/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const status = document.getElementById('prefs-status');
          if (res.ok) { status.textContent = '✓ Saved!'; status.className = 'mb-4 p-3 rounded-xl text-sm font-medium bg-green-500/20 text-green-300 border border-green-500/20'; }
          else { status.textContent = 'Failed to save.'; status.className = 'mb-4 p-3 rounded-xl text-sm font-medium bg-red-500/20 text-red-300 border border-red-500/20'; }
          status.classList.remove('hidden');
          setTimeout(() => status.classList.add('hidden'), 3000);
        } catch {}
      });
    })();
    </script>
  </div>
  `
  const navSession = { name: hostName, role: session?.role || 'HOST', isAdmin: (session?.role || '').toUpperCase() === 'ADMIN' }
  const guardScript = `<script>(function(){ var hasCsrf = document.cookie.split(';').some(function(c){ return c.trim().startsWith('__pp_csrf='); }); if (!hasCsrf) { window.location.replace('/auth/login?reason=auth'); } })();<\/script>`
  return c.html(Layout('Notification Preferences', content, guardScript, navSession))
})

// ════════════════════════════════════════════════════════════════════════════
// HOST CONNECT — Stripe Express Onboarding Landing Pages
// GET /host/connect/onboard   — initiate / resume onboarding
// GET /host/connect/complete  — return_url after Stripe onboarding
// GET /host/connect/refresh   — refresh_url if onboarding link expires
// GET /host/connect/cashout   — host cash-out dashboard
// ════════════════════════════════════════════════════════════════════════════

hostDashboard.get('/connect/onboard', async (c) => {
  const session = (c as any).get('user') as any
  const hostName = session?.fullName || session?.email || 'Host'
  const navSession = { name: hostName, role: session?.role || 'HOST', isAdmin: (session?.role || '').toUpperCase() === 'ADMIN' }
  const guardScript = `<script>(function(){ var hasCsrf = document.cookie.split(';').some(function(c){ return c.trim().startsWith('__pp_csrf='); }); if (!hasCsrf) { window.location.replace('/auth/login?reason=auth'); } })();<\/script>`
  const content = `
  <div class="max-w-lg mx-auto py-12 px-4">
    <div class="bg-[#1a1a2e] rounded-2xl p-8 border border-white/10 text-center">
      <div class="w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
        <i class="fas fa-university text-2xl text-indigo-400"></i>
      </div>
      <h1 class="text-2xl font-bold text-white mb-2">Connect Your Bank Account</h1>
      <p class="text-gray-400 mb-6">Set up payouts via Stripe to receive your earnings directly to your bank account. Takes about 2 minutes.</p>
      <div id="connect-status" class="mb-5 hidden p-4 rounded-xl text-sm"></div>
      <div class="mb-6 space-y-3 text-left">
        <label class="block text-sm text-gray-400 font-medium mb-1">Account Type</label>
        <div class="flex gap-3">
          <label class="flex-1 flex items-center gap-3 p-3 rounded-xl border border-white/10 cursor-pointer hover:border-indigo-500/50 transition">
            <input type="radio" name="biz_type" value="individual" checked class="accent-indigo-500">
            <div><div class="text-white font-medium text-sm">Individual</div><div class="text-gray-500 text-xs">Personal bank account</div></div>
          </label>
          <label class="flex-1 flex items-center gap-3 p-3 rounded-xl border border-white/10 cursor-pointer hover:border-indigo-500/50 transition">
            <input type="radio" name="biz_type" value="company" class="accent-indigo-500">
            <div><div class="text-white font-medium text-sm">Business</div><div class="text-gray-500 text-xs">Business bank account</div></div>
          </label>
        </div>
      </div>
      <button id="start-onboard-btn"
        class="w-full py-3 px-6 rounded-xl font-semibold text-black bg-[#C6FF00] hover:bg-[#d4ff33] transition flex items-center justify-center gap-2">
        <i class="fas fa-arrow-right"></i> Start Bank Setup
      </button>
      <p class="text-xs text-gray-500 mt-4">Secured by <strong class="text-gray-400">Stripe</strong> — ParkPeer never stores your bank details.</p>
    </div>
  </div>
  <script>
  document.getElementById('start-onboard-btn').addEventListener('click', async function() {
    const btn = this;
    const statusEl = document.getElementById('connect-status');
    const bizType = document.querySelector('input[name="biz_type"]:checked')?.value || 'individual';
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Setting up...';
    statusEl.className = 'mb-5 p-4 rounded-xl text-sm bg-blue-500/10 border border-blue-500/20 text-blue-300';
    statusEl.textContent = 'Creating your Stripe account...';
    statusEl.classList.remove('hidden');
    try {
      const res = await fetch('/api/connect/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_type: bizType })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start onboarding');
      if (data.status === 'complete') {
        statusEl.className = 'mb-5 p-4 rounded-xl text-sm bg-green-500/10 border border-green-500/20 text-green-300';
        statusEl.textContent = 'Your account is already connected! Redirecting to cash-out...';
        setTimeout(() => window.location.href = '/host/connect/cashout', 1500);
        return;
      }
      statusEl.textContent = 'Redirecting to Stripe...';
      window.location.href = data.onboarding_url;
    } catch(e) {
      statusEl.className = 'mb-5 p-4 rounded-xl text-sm bg-red-500/10 border border-red-500/20 text-red-300';
      statusEl.textContent = e.message || 'Something went wrong. Please try again.';
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-arrow-right"></i> Start Bank Setup';
    }
  });
  </script>
  `
  return c.html(Layout('Connect Bank Account – ParkPeer', content, guardScript, navSession))
})

hostDashboard.get('/connect/complete', async (c) => {
  const session = (c as any).get('user') as any
  const hostName = session?.fullName || session?.email || 'Host'
  const navSession = { name: hostName, role: session?.role || 'HOST', isAdmin: (session?.role || '').toUpperCase() === 'ADMIN' }
  const guardScript = `<script>(function(){ var hasCsrf = document.cookie.split(';').some(function(c){ return c.trim().startsWith('__pp_csrf='); }); if (!hasCsrf) { window.location.replace('/auth/login?reason=auth'); } })();<\/script>`
  const content = `
  <div class="max-w-lg mx-auto py-12 px-4">
    <div class="bg-[#1a1a2e] rounded-2xl p-8 border border-white/10 text-center">
      <div id="complete-icon" class="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
        <i class="fas fa-spinner fa-spin text-2xl text-green-400"></i>
      </div>
      <h1 id="complete-title" class="text-2xl font-bold text-white mb-2">Verifying your account...</h1>
      <p id="complete-msg" class="text-gray-400 mb-6">Checking your Stripe account status.</p>
      <div id="complete-actions" class="hidden space-y-3">
        <a href="/host/connect/cashout" class="block w-full py-3 px-6 rounded-xl font-semibold text-black bg-[#C6FF00] hover:bg-[#d4ff33] transition text-center">
          <i class="fas fa-wallet mr-2"></i> Go to Cash-Out Dashboard
        </a>
        <a href="/host" class="block w-full py-3 px-6 rounded-xl font-semibold text-white bg-white/10 hover:bg-white/20 transition text-center">
          Back to Host Dashboard
        </a>
      </div>
    </div>
  </div>
  <script>
  (async () => {
    try {
      const res = await fetch('/api/connect/status');
      const data = await res.json();
      const icon = document.getElementById('complete-icon');
      const title = document.getElementById('complete-title');
      const msg = document.getElementById('complete-msg');
      const actions = document.getElementById('complete-actions');
      if (data.onboarding_status === 'complete' || data.details_submitted) {
        icon.innerHTML = '<i class="fas fa-check-circle text-3xl text-green-400"></i>';
        icon.className = 'w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4';
        title.textContent = 'Bank Account Connected!';
        msg.textContent = 'Your account is verified and ready for payouts. Redirecting to your dashboard…';
        actions.classList.remove('hidden');
        // Auto-redirect to cashout dashboard after 2.5 seconds
        setTimeout(() => { window.location.href = '/host/connect/cashout'; }, 2500);
      } else if (data.requirements?.currently_due?.length > 0) {
        icon.innerHTML = '<i class="fas fa-exclamation-triangle text-3xl text-yellow-400"></i>';
        icon.className = 'w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-4';
        title.textContent = 'More Information Required';
        msg.textContent = 'Stripe needs a bit more info to complete verification. Please finish the setup.';
      } else {
        icon.innerHTML = '<i class="fas fa-clock text-3xl text-blue-400"></i>';
        icon.className = 'w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4';
        title.textContent = 'Verification In Progress';
        msg.textContent = 'Your information is being reviewed by Stripe. This usually takes a few minutes.';
      }
      actions.classList.remove('hidden');
    } catch(e) {
      document.getElementById('complete-title').textContent = 'Setup Complete';
      document.getElementById('complete-msg').textContent = 'You can now access your cash-out dashboard.';
      document.getElementById('complete-actions').classList.remove('hidden');
    }
  })();
  </script>
  `
  return c.html(Layout('Onboarding Complete – ParkPeer', content, guardScript, navSession))
})

hostDashboard.get('/connect/refresh', async (c) => {
  const session = (c as any).get('user') as any
  const hostName = session?.fullName || session?.email || 'Host'
  const navSession = { name: hostName, role: session?.role || 'HOST', isAdmin: (session?.role || '').toUpperCase() === 'ADMIN' }
  const guardScript = `<script>(function(){ var hasCsrf = document.cookie.split(';').some(function(c){ return c.trim().startsWith('__pp_csrf='); }); if (!hasCsrf) { window.location.replace('/auth/login?reason=auth'); } })();<\/script>`
  const content = `
  <div class="max-w-lg mx-auto py-12 px-4">
    <div class="bg-[#1a1a2e] rounded-2xl p-8 border border-white/10 text-center">
      <div class="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
        <i class="fas fa-sync-alt text-2xl text-yellow-400"></i>
      </div>
      <h1 class="text-2xl font-bold text-white mb-2">Session Expired</h1>
      <p class="text-gray-400 mb-6">Your onboarding link has expired. Click below to generate a fresh one.</p>
      <button onclick="window.location.href='/host/connect/onboard'"
        class="w-full py-3 px-6 rounded-xl font-semibold text-black bg-[#C6FF00] hover:bg-[#d4ff33] transition">
        <i class="fas fa-redo mr-2"></i> Restart Onboarding
      </button>
    </div>
  </div>`
  return c.html(Layout('Session Expired – ParkPeer', content, guardScript, navSession))
})


hostDashboard.get('/connect/cashout', async (c) => {
  const session = (c as any).get('user') as any
  const hostName = session?.fullName || session?.email || 'Host'
  const navSession = { name: hostName, role: session?.role || 'HOST', isAdmin: (session?.role || '').toUpperCase() === 'ADMIN' }
  const guardScript = `<script>(function(){ var hasCsrf = document.cookie.split(';').some(function(c){ return c.trim().startsWith('__pp_csrf='); }); if (!hasCsrf) { window.location.replace('/auth/login?reason=auth'); } })();<\/script>`

  const content = `
  <div class="max-w-5xl mx-auto py-8 px-4 space-y-6">

    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-white flex items-center gap-2">
          <i class="fas fa-wallet text-[#C6FF00]"></i> Cash-Out Dashboard
        </h1>
        <p class="text-gray-400 text-sm mt-1">Manage your earnings and withdraw to your bank account</p>
      </div>
      <div class="flex gap-2">
        <button id="refresh-btn" onclick="loadAll()" class="px-4 py-2 rounded-xl text-sm bg-white/10 hover:bg-white/20 text-white transition">
          <i class="fas fa-sync-alt mr-1"></i> Refresh
        </button>
        <a href="/host" class="px-4 py-2 rounded-xl text-sm bg-white/10 hover:bg-white/20 text-white transition">
          <i class="fas fa-arrow-left mr-1"></i> Dashboard
        </a>
      </div>
    </div>

    <!-- Connect Status Banner -->
    <div id="connect-banner" class="hidden p-4 rounded-xl border text-sm flex items-start gap-3">
      <i id="banner-icon" class="fas fa-info-circle mt-0.5 text-lg"></i>
      <div>
        <div id="banner-title" class="font-semibold"></div>
        <div id="banner-msg" class="text-xs mt-0.5 opacity-80"></div>
        <a id="banner-cta" href="#" class="inline-block mt-2 text-xs font-semibold underline hidden"></a>
      </div>
    </div>

    <!-- Balance Cards -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4" id="balance-cards">
      <div class="bg-[#1a1a2e] rounded-2xl p-5 border border-white/10">
        <div class="text-gray-400 text-xs mb-1">Available Balance</div>
        <div id="bal-available" class="text-2xl font-bold text-[#C6FF00]">–</div>
        <div class="text-gray-500 text-xs mt-1">Ready to withdraw</div>
      </div>
      <div class="bg-[#1a1a2e] rounded-2xl p-5 border border-white/10">
        <div class="text-gray-400 text-xs mb-1">Pending</div>
        <div id="bal-pending" class="text-2xl font-bold text-white">–</div>
        <div class="text-gray-500 text-xs mt-1">In transit from Stripe</div>
      </div>
      <div class="bg-[#1a1a2e] rounded-2xl p-5 border border-white/10">
        <div class="text-gray-400 text-xs mb-1">Total Earned</div>
        <div id="bal-earned" class="text-2xl font-bold text-white">–</div>
        <div class="text-gray-500 text-xs mt-1">All time (net)</div>
      </div>
      <div class="bg-[#1a1a2e] rounded-2xl p-5 border border-white/10">
        <div class="text-gray-400 text-xs mb-1">Total Paid Out</div>
        <div id="bal-paidout" class="text-2xl font-bold text-white">–</div>
        <div class="text-gray-500 text-xs mt-1">Settled to bank</div>
      </div>
    </div>

    <!-- Cash-Out Panel -->
    <div class="grid lg:grid-cols-2 gap-6">

      <!-- Manual Cash-Out -->
      <div class="bg-[#1a1a2e] rounded-2xl p-6 border border-white/10">
        <h2 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <i class="fas fa-money-bill-wave text-[#C6FF00]"></i> Manual Cash-Out
        </h2>
        <div class="space-y-4">
          <div>
            <label class="block text-xs text-gray-400 mb-1">Amount to withdraw</label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
              <input id="payout-amount" type="number" step="0.01" min="1"
                placeholder="Enter amount (or leave blank for full balance)"
                class="w-full bg-white/5 border border-white/10 rounded-xl px-8 py-3 text-white text-sm focus:outline-none focus:border-indigo-500/50 placeholder-gray-600">
            </div>
            <p class="text-xs text-gray-500 mt-1">Leave blank to withdraw full available balance</p>
          </div>

          <!-- Confirmation checkbox -->
          <label class="flex items-start gap-3 cursor-pointer group">
            <input type="checkbox" id="payout-confirm" class="w-4 h-4 mt-0.5 accent-indigo-500 flex-shrink-0">
            <span class="text-xs text-gray-400 group-hover:text-gray-300 transition">
              I confirm I want to withdraw earnings to my connected bank account. This action cannot be undone once processing starts.
            </span>
          </label>

          <button id="payout-btn" disabled
            class="w-full py-3 px-6 rounded-xl font-semibold text-black bg-[#C6FF00] hover:bg-[#d4ff33] transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            <i class="fas fa-arrow-right"></i> Request Cash-Out
          </button>

          <div id="payout-result" class="hidden p-4 rounded-xl text-sm"></div>
        </div>
      </div>

      <!-- Automatic Schedule -->
      <div class="bg-[#1a1a2e] rounded-2xl p-6 border border-white/10">
        <h2 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <i class="fas fa-calendar-alt text-indigo-400"></i> Automatic Payouts
        </h2>
        <div class="space-y-4">
          <div>
            <label class="block text-xs text-gray-400 mb-1">Payout Frequency</label>
            <select id="sched-interval"
              class="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-indigo-500/50">
              <option value="manual">Manual (I'll do it myself)</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly (every Friday)</option>
              <option value="monthly">Monthly (1st of month)</option>
            </select>
          </div>
          <div id="weekly-opts" class="hidden">
            <label class="block text-xs text-gray-400 mb-1">Day of week</label>
            <select id="sched-weekly-anchor"
              class="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-indigo-500/50">
              <option value="monday">Monday</option><option value="tuesday">Tuesday</option>
              <option value="wednesday">Wednesday</option><option value="thursday">Thursday</option>
              <option value="friday" selected>Friday</option><option value="saturday">Saturday</option><option value="sunday">Sunday</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-400 mb-1">Minimum payout amount ($)</label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
              <input id="sched-min" type="number" step="1" min="1" value="10"
                class="w-full bg-white/5 border border-white/10 rounded-xl px-8 py-3 text-white text-sm focus:outline-none focus:border-indigo-500/50">
            </div>
          </div>
          <button id="sched-save-btn"
            class="w-full py-3 px-6 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition flex items-center justify-center gap-2">
            <i class="fas fa-save"></i> Save Schedule
          </button>
          <div id="sched-result" class="hidden p-3 rounded-xl text-xs"></div>
        </div>
      </div>
    </div>

    <!-- Payout History + Earnings Tabs -->
    <div class="bg-[#1a1a2e] rounded-2xl border border-white/10 overflow-hidden">
      <div class="flex border-b border-white/10">
        <button onclick="switchTab('payouts')" id="tab-payouts"
          class="px-5 py-3 text-sm font-medium text-[#C6FF00] border-b-2 border-[#C6FF00]">
          <i class="fas fa-history mr-1"></i> Payout History
        </button>
        <button onclick="switchTab('earnings')" id="tab-earnings"
          class="px-5 py-3 text-sm font-medium text-gray-400 hover:text-white transition">
          <i class="fas fa-chart-bar mr-1"></i> Earnings Breakdown
        </button>
        <button onclick="switchTab('account')" id="tab-account"
          class="px-5 py-3 text-sm font-medium text-gray-400 hover:text-white transition">
          <i class="fas fa-cog mr-1"></i> Account Settings
        </button>
      </div>

      <!-- Payouts Tab -->
      <div id="panel-payouts" class="p-5">
        <div class="flex items-center justify-between mb-4">
          <div class="flex gap-2 text-xs">
            <button onclick="filterPayouts('all')" class="px-3 py-1 rounded-lg bg-indigo-600 text-white" id="pf-all">All</button>
            <button onclick="filterPayouts('paid')" class="px-3 py-1 rounded-lg bg-white/10 text-gray-400 hover:text-white" id="pf-paid">Paid</button>
            <button onclick="filterPayouts('pending')" class="px-3 py-1 rounded-lg bg-white/10 text-gray-400 hover:text-white" id="pf-pending">Pending</button>
            <button onclick="filterPayouts('failed')" class="px-3 py-1 rounded-lg bg-white/10 text-gray-400 hover:text-white" id="pf-failed">Failed</button>
          </div>
        </div>
        <div id="payouts-table" class="overflow-x-auto">
          <div class="text-gray-500 text-sm text-center py-8"><i class="fas fa-spinner fa-spin mr-2"></i>Loading...</div>
        </div>
      </div>

      <!-- Earnings Tab -->
      <div id="panel-earnings" class="p-5 hidden">
        <div id="earnings-summary" class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5"></div>
        <div id="earnings-table" class="overflow-x-auto">
          <div class="text-gray-500 text-sm text-center py-8"><i class="fas fa-spinner fa-spin mr-2"></i>Loading...</div>
        </div>
      </div>

      <!-- Account Settings Tab -->
      <div id="panel-account" class="p-5 hidden">
        <div class="space-y-4">
          <div class="p-4 rounded-xl bg-white/5 border border-white/10">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-white font-medium text-sm">Stripe Express Account</div>
                <div id="acct-stripe-id" class="text-gray-500 text-xs mt-0.5">Loading...</div>
              </div>
              <span id="acct-badge" class="px-3 py-1 rounded-full text-xs font-medium bg-gray-500/20 text-gray-400">–</span>
            </div>
          </div>
          <div class="p-4 rounded-xl bg-white/5 border border-white/10">
            <div class="text-white font-medium text-sm mb-2">Requirements</div>
            <div id="acct-requirements" class="text-gray-400 text-xs">Loading...</div>
          </div>
          <button id="stripe-dashboard-btn"
            class="w-full py-3 px-6 rounded-xl font-semibold text-white bg-[#635bff] hover:bg-[#7b74ff] transition flex items-center justify-center gap-2">
            <i class="fab fa-stripe mr-1"></i> Open Stripe Express Dashboard
          </button>
          <a href="/host/connect/onboard"
            class="block w-full py-3 px-6 rounded-xl font-semibold text-white bg-white/10 hover:bg-white/20 transition text-center text-sm">
            <i class="fas fa-edit mr-1"></i> Update Bank Account / Identity
          </a>
        </div>
      </div>
    </div>

  </div>

  <script>
  const fmt = v => '$' + (v||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');
  let currentFilter = 'all';

  function switchTab(tab) {
    ['payouts','earnings','account'].forEach(t => {
      document.getElementById('panel-'+t).classList.toggle('hidden', t !== tab);
      const btn = document.getElementById('tab-'+t);
      if (t === tab) { btn.className = 'px-5 py-3 text-sm font-medium text-[#C6FF00] border-b-2 border-[#C6FF00]'; }
      else           { btn.className = 'px-5 py-3 text-sm font-medium text-gray-400 hover:text-white transition'; }
    });
    if (tab === 'earnings' && !document.getElementById('earnings-table').dataset.loaded) loadEarnings();
    if (tab === 'account'  && !document.getElementById('acct-stripe-id').dataset.loaded) loadAccount();
  }

  function statusBadge(s) {
    const map = { paid:'bg-green-500/20 text-green-400', in_transit:'bg-blue-500/20 text-blue-400',
      pending:'bg-yellow-500/20 text-yellow-400', requested:'bg-yellow-500/20 text-yellow-300',
      failed:'bg-red-500/20 text-red-400', canceled:'bg-gray-500/20 text-gray-400' };
    return '<span class="px-2 py-0.5 rounded-full text-xs font-medium ' + (map[s]||'bg-gray-500/20 text-gray-400') + '">' + (s||'–') + '</span>';
  }

  async function loadBalance() {
    try {
      const r = await fetch('/api/connect/balance');
      const d = await r.json();

      // ── Case 1: No Stripe account at all → auto-redirect to onboarding ──
      if (d.not_connected) {
        showBanner('info',
          'Bank account not connected',
          'You need to complete Stripe onboarding before you can manage payouts. Redirecting…',
          'Set Up Now',
          '/host/connect/onboard'
        );
        // Disable the cash-out button so nothing fires while we redirect
        const payoutBtn = document.getElementById('payout-btn');
        if (payoutBtn) payoutBtn.disabled = true;
        // Auto-redirect after 2 seconds so the user can read the message
        setTimeout(() => { window.location.href = '/host/connect/onboard'; }, 2000);
        return;
      }

      if (!r.ok) {
        showBanner('warning', d.error || 'Could not load balance', '', 'Complete onboarding', '/host/connect/onboard');
        return;
      }

      document.getElementById('bal-available').textContent = fmt(d.available_usd);
      document.getElementById('bal-pending').textContent   = fmt(d.pending_usd);
      document.getElementById('bal-earned').textContent    = fmt(d.total_earned);
      document.getElementById('bal-paidout').textContent   = fmt(d.total_paid_out);

      // ── Case 2: Account exists but payouts not yet enabled ──
      if (!d.payouts_enabled) {
        showBanner('warning',
          'Payouts not yet enabled',
          'Complete your Stripe verification to enable withdrawals.',
          'Finish Setup',
          '/host/connect/onboard'
        );
        const payoutBtn = document.getElementById('payout-btn');
        if (payoutBtn) payoutBtn.disabled = true;
      }
    } catch(e) {
      showBanner('error', 'Could not load balance. Check your connection.', '');
    }
  }

  function showBanner(type, title, msg, ctaText, ctaHref) {
    const banner = document.getElementById('connect-banner');
    const clsMap = { success:'bg-green-500/10 border-green-500/30 text-green-300', warning:'bg-yellow-500/10 border-yellow-500/30 text-yellow-300', error:'bg-red-500/10 border-red-500/30 text-red-300', info:'bg-blue-500/10 border-blue-500/30 text-blue-300' };
    const iconMap = { success:'fa-check-circle', warning:'fa-exclamation-triangle', error:'fa-times-circle', info:'fa-info-circle' };
    banner.className = 'p-4 rounded-xl border text-sm flex items-start gap-3 ' + (clsMap[type]||clsMap.info);
    document.getElementById('banner-icon').className = 'fas ' + (iconMap[type]||iconMap.info) + ' mt-0.5 text-lg';
    document.getElementById('banner-title').textContent = title;
    document.getElementById('banner-msg').textContent   = msg || '';
    const cta = document.getElementById('banner-cta');
    if (ctaText) { cta.textContent = ctaText; cta.href = ctaHref || '#'; cta.classList.remove('hidden'); }
    else cta.classList.add('hidden');
    banner.classList.remove('hidden');
  }

  async function loadPayouts(filter) {
    currentFilter = filter || currentFilter;
    const qs = currentFilter === 'all' ? '' : '?status=' + currentFilter;
    try {
      const r  = await fetch('/api/connect/payouts' + qs);
      const d  = await r.json();
      const tbl = document.getElementById('payouts-table');
      if (!r.ok || !d.payouts?.length) { tbl.innerHTML = '<div class="text-gray-500 text-sm text-center py-10">No payouts found.</div>'; return; }
      tbl.innerHTML = '<table class="w-full text-sm"><thead><tr class="text-left text-gray-500 border-b border-white/5"><th class="pb-2 pr-4">Date</th><th class="pb-2 pr-4">Amount</th><th class="pb-2 pr-4">Status</th><th class="pb-2 pr-4">Est. Arrival</th><th class="pb-2">Payout ID</th></tr></thead><tbody>' +
        d.payouts.map(p => '<tr class="border-b border-white/5 hover:bg-white/5 transition"><td class="py-3 pr-4 text-gray-300">' + new Date(p.requested_at||p.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) + '</td><td class="py-3 pr-4 font-semibold text-white">' + fmt(p.amount_usd) + '</td><td class="py-3 pr-4">' + statusBadge(p.status) + '</td><td class="py-3 pr-4 text-gray-400 text-xs">' + (p.arrival_date_formatted||'–') + '</td><td class="py-3 text-gray-600 text-xs font-mono">' + (p.stripe_payout_id||'pending').slice(0,18) + (p.status === 'pending'||p.status === 'requested' ? '<button onclick="cancelPayout('+p.id+')" class="ml-2 text-red-400 hover:text-red-300 text-xs">Cancel</button>' : '') + '</td></tr>').join('') +
        '</tbody></table>';
    } catch(e) { document.getElementById('payouts-table').innerHTML = '<div class="text-red-400 text-sm text-center py-8">Failed to load payouts.</div>'; }
  }

  function filterPayouts(f) {
    ['all','paid','pending','failed'].forEach(k => {
      const btn = document.getElementById('pf-'+k);
      btn.className = k === f ? 'px-3 py-1 rounded-lg bg-indigo-600 text-white text-xs' : 'px-3 py-1 rounded-lg bg-white/10 text-gray-400 hover:text-white text-xs';
    });
    loadPayouts(f);
  }

  async function cancelPayout(id) {
    if (!confirm('Cancel this payout? Funds will remain in your Stripe balance.')) return;
    try {
      const r = await fetch('/api/connect/payout/'+id+'/cancel', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({}) });
      const d = await r.json();
      if (r.ok) { showBanner('success','Payout cancelled.',''); loadPayouts(); loadBalance(); }
      else alert(d.error || 'Failed to cancel.');
    } catch(e) { alert('Network error.'); }
  }

  async function loadEarnings() {
    try {
      const r = await fetch('/api/connect/earnings?days=90');
      const d = await r.json();
      document.getElementById('earnings-table').dataset.loaded = '1';
      const s = d.summary || {};
      document.getElementById('earnings-summary').innerHTML =
        [['Gross Revenue', s.gross_revenue,'text-white'],['Platform Fees (15%)', s.platform_fees,'text-red-400'],
         ['Net Earnings', s.net_earnings,'text-[#C6FF00]'],['Transferred Out', s.transferred_out,'text-blue-400']].map(
          ([label,val,cls]) => '<div class="bg-white/5 rounded-xl p-3"><div class="text-gray-500 text-xs">'+label+'</div><div class="'+cls+' font-bold mt-1">'+fmt(val)+'</div></div>'
        ).join('');
      const rows = d.earnings || [];
      if (!rows.length) { document.getElementById('earnings-table').innerHTML = '<div class="text-gray-500 text-sm text-center py-10">No earnings in the last 90 days.</div>'; return; }
      document.getElementById('earnings-table').innerHTML = '<table class="w-full text-sm"><thead><tr class="text-left text-gray-500 border-b border-white/5"><th class="pb-2 pr-3">Date</th><th class="pb-2 pr-3">Listing</th><th class="pb-2 pr-3">Gross</th><th class="pb-2 pr-3">Fee (15%)</th><th class="pb-2 pr-3">Net</th><th class="pb-2">Transfer</th></tr></thead><tbody>' +
        rows.map(r => '<tr class="border-b border-white/5 hover:bg-white/5"><td class="py-3 pr-3 text-gray-400 text-xs">' + new Date(r.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}) + '</td><td class="py-3 pr-3 text-gray-300 text-xs truncate max-w-[120px]">' + (r.listing_title||'–') + '</td><td class="py-3 pr-3 text-white">' + fmt(r.gross) + '</td><td class="py-3 pr-3 text-red-400">' + fmt(r.platform_fee) + '</td><td class="py-3 pr-3 text-[#C6FF00] font-semibold">' + fmt(r.net) + '</td><td class="py-3 text-xs">' + (r.transfer_id ? '<span class="text-green-400"><i class="fas fa-check mr-1"></i>Sent</span>' : '<span class="text-yellow-400">Pending</span>') + '</td></tr>').join('') + '</tbody></table>';
    } catch(e) { document.getElementById('earnings-table').innerHTML = '<div class="text-red-400 text-sm text-center py-8">Failed to load earnings.</div>'; }
  }

  async function loadAccount() {
    try {
      const r = await fetch('/api/connect/status');
      const d = await r.json();
      document.getElementById('acct-stripe-id').textContent = d.account_id || 'Not connected';
      document.getElementById('acct-stripe-id').dataset.loaded = '1';
      const badge = document.getElementById('acct-badge');
      const bmap  = { complete:'bg-green-500/20 text-green-400', in_progress:'bg-yellow-500/20 text-yellow-400', restricted:'bg-red-500/20 text-red-400', pending:'bg-gray-500/20 text-gray-400', not_started:'bg-gray-500/20 text-gray-400' };
      badge.className = 'px-3 py-1 rounded-full text-xs font-medium ' + (bmap[d.onboarding_status]||bmap.pending);
      badge.textContent = d.onboarding_status || 'unknown';
      const req = d.requirements?.currently_due || [];
      document.getElementById('acct-requirements').innerHTML = req.length
        ? '<ul class="list-disc list-inside space-y-1">' + req.map(r => '<li>' + r + '</li>').join('') + '</ul>'
        : '<span class="text-green-400"><i class="fas fa-check-circle mr-1"></i>All requirements met</span>';
    } catch {}
  }

  async function loadSchedule() {
    try {
      const r = await fetch('/api/connect/schedule');
      const d = await r.json();
      document.getElementById('sched-interval').value = d.interval || 'manual';
      if (d.weekly_anchor) document.getElementById('sched-weekly-anchor').value = d.weekly_anchor;
      if (d.minimum_payout_usd) document.getElementById('sched-min').value = d.minimum_payout_usd;
      toggleWeeklyOpts();
    } catch {}
  }

  function toggleWeeklyOpts() {
    const val = document.getElementById('sched-interval').value;
    document.getElementById('weekly-opts').classList.toggle('hidden', val !== 'weekly');
  }

  async function loadAll() {
    await loadBalance();
    await loadPayouts();
    await loadSchedule();
  }

  // Payout confirmation toggle
  document.getElementById('payout-confirm').addEventListener('change', function() {
    document.getElementById('payout-btn').disabled = !this.checked;
  });
  document.getElementById('sched-interval').addEventListener('change', toggleWeeklyOpts);

  // Cash-out button
  document.getElementById('payout-btn').addEventListener('click', async function() {
    const btn = this;
    const amtInput = document.getElementById('payout-amount').value;
    const result   = document.getElementById('payout-result');
    const body = { payout_confirmed: true };
    if (amtInput) body.amount_cents = Math.round(parseFloat(amtInput) * 100);

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Processing...';

    try {
      const r = await fetch('/api/connect/payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const d = await r.json();
      if (r.ok && d.success) {
        result.className = 'p-4 rounded-xl text-sm bg-green-500/10 border border-green-500/20 text-green-300';
        result.innerHTML = '<i class="fas fa-check-circle mr-2"></i>' + d.message;
        result.classList.remove('hidden');
        document.getElementById('payout-confirm').checked = false;
        document.getElementById('payout-amount').value = '';
        setTimeout(() => { loadBalance(); loadPayouts(); }, 1500);
      } else {
        result.className = 'p-4 rounded-xl text-sm bg-red-500/10 border border-red-500/20 text-red-300';
        result.innerHTML = '<i class="fas fa-exclamation-triangle mr-2"></i>' + (d.error || 'Payout failed. Please try again.');
        result.classList.remove('hidden');
        btn.disabled = false;
      }
    } catch(e) {
      result.className = 'p-4 rounded-xl text-sm bg-red-500/10 border border-red-500/20 text-red-300';
      result.innerHTML = '<i class="fas fa-exclamation-triangle mr-2"></i> Network error. Please try again.';
      result.classList.remove('hidden');
      btn.disabled = false;
    }
    btn.innerHTML = '<i class="fas fa-arrow-right"></i> Request Cash-Out';
  });

  // Schedule save
  document.getElementById('sched-save-btn').addEventListener('click', async function() {
    const btn = this;
    const res = document.getElementById('sched-result');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Saving...';
    try {
      const r = await fetch('/api/connect/schedule', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          interval: document.getElementById('sched-interval').value,
          weekly_anchor: document.getElementById('sched-weekly-anchor').value,
          minimum_payout_cents: Math.round(parseFloat(document.getElementById('sched-min').value||'10') * 100),
        })
      });
      const d = await r.json();
      if (r.ok) { res.className = 'p-3 rounded-xl text-xs bg-green-500/10 border border-green-500/20 text-green-300'; res.textContent = 'Schedule saved!'; }
      else       { res.className = 'p-3 rounded-xl text-xs bg-red-500/10 border border-red-500/20 text-red-300'; res.textContent = d.error || 'Failed to save.'; }
      res.classList.remove('hidden');
      setTimeout(() => res.classList.add('hidden'), 3000);
    } catch { res.textContent = 'Network error.'; res.classList.remove('hidden'); }
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Schedule';
  });

  // Stripe dashboard button
  document.getElementById('stripe-dashboard-btn').addEventListener('click', async function() {
    this.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Opening...';
    try {
      const r = await fetch('/api/connect/dashboard-link');
      const d = await r.json();
      if (r.ok && d.url) { window.open(d.url, '_blank'); }
      else alert(d.error || 'Failed to open dashboard. Ensure onboarding is complete.');
    } catch { alert('Network error. Please try again.'); }
    this.innerHTML = '<i class="fab fa-stripe mr-1"></i> Open Stripe Express Dashboard';
  });

  // Boot
  loadAll();
  </script>
  `
  return c.html(Layout('Cash-Out Dashboard – ParkPeer', content, guardScript, navSession))
})

