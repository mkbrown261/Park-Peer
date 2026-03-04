import { Hono } from 'hono'
import { Layout } from '../components/layout'
import { requireUserAuth, verifyUserToken } from '../middleware/security'

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
  let totalRevenue    = 0
  let activeBookings  = 0
  let avgRating       = 0
  let activeListings  = 0
  let pendingBookings = 0
  let myListings:     any[] = []
  let pendingReqs:    any[] = []
  let recentReviews:  any[] = []
  let nextPayout      = 0
  let payoutPending   = 0

  let hostName = ''

  if (db && userId) {
    try {
      // Fetch host's display name
      const nameRow = await db.prepare('SELECT full_name FROM users WHERE id = ?').bind(userId).first<{full_name: string}>()
      hostName = nameRow?.full_name || ''

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

      // Pending booking requests for this host's listings
      const pendRows = await db.prepare(`
        SELECT b.id, b.start_time, b.end_time, b.total_charged, b.status,
               b.vehicle_description,
               l.title as space_title,
               u.full_name as driver_name, u.email as driver_email
        FROM bookings b
        JOIN listings l ON b.listing_id = l.id
        LEFT JOIN users u ON b.driver_id = u.id
        WHERE b.host_id = ? AND b.status = 'pending'
        ORDER BY b.created_at ASC
        LIMIT 6
      `).bind(userId).all<any>()
      pendingReqs = pendRows.results || []

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

          <!-- Availability Calendar -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
            <div class="flex items-center justify-between mb-4">
              <h3 class="font-bold text-white text-lg"><i class="fas fa-calendar text-indigo-400 mr-2"></i>Availability Calendar</h3>
              <button class="btn-primary px-4 py-2 rounded-xl text-xs text-white font-semibold">
                Edit Availability
              </button>
            </div>
            ${generateHostCalendar()}
          </div>
        </div>

        <!-- Right Sidebar -->
        <div class="space-y-6">
          
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
              <button class="mt-4 w-full py-2.5 bg-lime-500 text-charcoal rounded-xl text-sm font-bold hover:bg-lime-400 transition-colors">
                Manage Payouts
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
    <div class="bg-charcoal-100 rounded-3xl w-full max-w-2xl border border-white/10 overflow-hidden max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between p-6 border-b border-white/10 sticky top-0 bg-charcoal-100 z-10">
        <h3 class="text-xl font-bold text-white">Create New Listing</h3>
        <button onclick="hideAddListing()" class="w-8 h-8 bg-charcoal-200 rounded-full flex items-center justify-center text-gray-400 hover:text-white">
          <i class="fas fa-times text-sm"></i>
        </button>
      </div>

      <!-- Error/Success banners -->
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

        <!-- Address (full) -->
        <div>
          <label class="text-sm text-gray-400 font-medium block mb-2">Street Address <span class="text-red-400">*</span></label>
          <input type="text" id="listing-address" maxlength="200"
            placeholder="e.g. 123 Main St"
            class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"/>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="text-sm text-gray-400 font-medium block mb-2">City <span class="text-red-400">*</span></label>
            <input type="text" id="listing-city" maxlength="100"
              placeholder="e.g. Austin"
              class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"/>
          </div>
          <div>
            <label class="text-sm text-gray-400 font-medium block mb-2">State <span class="text-red-400">*</span></label>
            <input type="text" id="listing-state" maxlength="50"
              placeholder="e.g. TX"
              class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"/>
          </div>
          <div>
            <label class="text-sm text-gray-400 font-medium block mb-2">ZIP <span class="text-red-400">*</span></label>
            <input type="text" id="listing-zip" maxlength="20"
              placeholder="e.g. 78701"
              class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"/>
          </div>
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
      document.getElementById('listing-success').classList.add('hidden');
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

      // Collect values
      const title   = document.getElementById('listing-title')?.value?.trim() || '';
      const type    = document.getElementById('listing-type')?.value || 'driveway';
      const address = document.getElementById('listing-address')?.value?.trim() || '';
      const city    = document.getElementById('listing-city')?.value?.trim() || '';
      const state   = document.getElementById('listing-state')?.value?.trim() || '';
      const zip     = document.getElementById('listing-zip')?.value?.trim() || '';
      const rateH   = document.getElementById('listing-rate-hourly')?.value || '';
      const rateD   = document.getElementById('listing-rate-daily')?.value || '';
      const rateM   = document.getElementById('listing-rate-monthly')?.value || '';
      const desc    = document.getElementById('listing-description')?.value?.trim() || '';
      const amenities = Array.from(document.querySelectorAll('.amenity-check:checked')).map(cb => cb.value);

      // Validate required fields
      if (!title) { showListingError('Space title is required.'); return; }
      if (!address) { showListingError('Address is required.'); return; }
      if (!city) { showListingError('City is required.'); return; }
      if (!state) { showListingError('State is required.'); return; }
      if (!zip) { showListingError('ZIP code is required.'); return; }
      if (!rateH && !rateD && !rateM) { showListingError('Please set at least one rate (hourly, daily, or monthly).'); return; }

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
          // CSRF mismatch or wrong role
          const msg = data.error || 'Access denied.';
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
      errMsg.textContent = msg;
      errEl.classList.remove('hidden');
      errEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function acceptBooking(btn, id) {
      btn.closest('.flex').innerHTML = '<span class="text-green-400 text-sm font-semibold flex items-center gap-2"><i class="fas fa-check-circle"></i> Booking Accepted</span>';
      fetch('/api/bookings/' + id + '/confirm', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    }

    function declineBooking(btn, id) {
      btn.closest('.flex').innerHTML = '<span class="text-red-400 text-sm font-semibold flex items-center gap-2"><i class="fas fa-times-circle"></i> Booking Declined</span>';
      fetch('/api/bookings/' + id + '/cancel', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
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

    function getCsrfToken() {
      // Read from cookie __pp_csrf (non-httpOnly, written by server)
      const m = document.cookie.match(/(?:^|;\\s*)__pp_csrf=([^;]+)/);
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
  </script>

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
