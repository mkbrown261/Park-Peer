import { Hono } from 'hono'
import { Layout } from '../components/layout'
import { requireUserAuth } from '../middleware/security'

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

  if (db && userId) {
    try {
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

    } catch(e: any) { console.error('[driver-dashboard]', e.message) }
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
        <div class="flex items-center gap-4 p-4 hover:bg-white/5 transition-colors">
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
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden">
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
        </div>

        <!-- Right Sidebar -->
        <div class="space-y-6">
          
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
  </script>
  `
  return c.html(Layout('Driver Dashboard', content))
})
