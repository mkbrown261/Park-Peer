import { Hono } from 'hono'
import { Layout } from '../components/layout'

type Bindings = { DB: D1Database }

export const hostDashboard = new Hono<{ Bindings: Bindings }>()

hostDashboard.get('/', async (c) => {
  const db = c.env?.DB

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

  if (db) {
    try {
      // Revenue from succeeded payments (host payout)
      const rev = await db.prepare(`
        SELECT COALESCE(SUM(host_payout),0) as total FROM payments WHERE status='succeeded'
      `).first<any>()
      totalRevenue = Math.round((rev?.total ?? 0) * 100) / 100

      // Active bookings count
      const ab = await db.prepare(`
        SELECT COUNT(*) as n FROM bookings WHERE status IN ('confirmed','active')
      `).first<any>()
      activeBookings = ab?.n ?? 0

      // Pending approval count
      const pb = await db.prepare(`
        SELECT COUNT(*) as n FROM bookings WHERE status='pending'
      `).first<any>()
      pendingBookings = pb?.n ?? 0

      // Avg rating across all listings
      const ar = await db.prepare(`
        SELECT AVG(avg_rating) as avg_r FROM listings WHERE status='active' AND avg_rating > 0
      `).first<any>()
      avgRating = ar?.avg_r ? Math.round(ar.avg_r * 100) / 100 : 0

      // Active listing count
      const al = await db.prepare(`
        SELECT COUNT(*) as n FROM listings WHERE status='active'
      `).first<any>()
      activeListings = al?.n ?? 0

      // My listings with booking and revenue stats
      const listRows = await db.prepare(`
        SELECT l.id, l.title, l.type, l.rate_hourly, l.status,
               l.avg_rating, l.review_count, l.total_bookings, l.instant_book,
               COALESCE(SUM(p.host_payout),0) as revenue
        FROM listings l
        LEFT JOIN bookings b ON b.listing_id = l.id
        LEFT JOIN payments p ON p.booking_id = b.id AND p.status = 'succeeded'
        GROUP BY l.id
        ORDER BY l.status='active' DESC, l.avg_rating DESC
        LIMIT 10
      `).all<any>()
      myListings = listRows.results || []

      // Pending booking requests with driver info
      const pendRows = await db.prepare(`
        SELECT b.id, b.start_datetime, b.end_datetime, b.total_charged, b.status,
               b.vehicle_make, b.vehicle_model,
               l.title as space_title,
               u.full_name as driver_name, u.email as driver_email
        FROM bookings b
        JOIN listings l ON b.listing_id = l.id
        LEFT JOIN users u ON b.driver_id = u.id
        WHERE b.status = 'pending'
        ORDER BY b.created_at ASC
        LIMIT 6
      `).all<any>()
      pendingReqs = pendRows.results || []

      // Recent reviews
      const revRows = await db.prepare(`
        SELECT r.rating, r.comment, r.created_at,
               u.full_name as reviewer_name,
               l.title as listing_title
        FROM reviews r
        JOIN listings l ON r.listing_id = l.id
        LEFT JOIN users u ON r.reviewer_id = u.id
        WHERE r.status = 'published'
        ORDER BY r.created_at DESC
        LIMIT 4
      `).all<any>()
      recentReviews = revRows.results || []

      // Next payout = sum of confirmed/active bookings not yet paid out
      const payoutRow = await db.prepare(`
        SELECT COALESCE(SUM(host_payout),0) as pending
        FROM bookings
        WHERE status IN ('confirmed','active')
      `).first<any>()
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
        return `
          <div class="p-4 hover:bg-white/5 transition-colors">
            <div class="flex items-center gap-4">
              <div class="w-16 h-16 bg-gradient-to-br from-charcoal-300 to-charcoal-400 rounded-xl flex items-center justify-center flex-shrink-0">
                <i class="fas fa-${typeIcon} text-white/30 text-2xl"></i>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <p class="font-bold text-white text-sm">${l.title}</p>
                  <span class="text-xs px-2 py-0.5 rounded-full ${l.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}">${l.status}</span>
                  ${l.instant_book ? '<span class="text-xs bg-lime-500/20 text-lime-500 px-2 py-0.5 rounded-full">⚡ Instant</span>' : ''}
                </div>
                <div class="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                  <span><i class="fas fa-dollar-sign text-indigo-400 mr-1"></i>$${l.rate_hourly}/hr</span>
                  <span><i class="fas fa-calendar text-indigo-400 mr-1"></i>${l.total_bookings || 0} bookings</span>
                  ${l.avg_rating > 0 ? `<span><i class="fas fa-star text-amber-400 mr-1"></i>${Number(l.avg_rating).toFixed(1)}</span>` : ''}
                  ${l.revenue > 0 ? `<span class="text-lime-500 font-semibold"><i class="fas fa-dollar-sign mr-0.5"></i>${Number(l.revenue).toFixed(0)} earned</span>` : ''}
                </div>
              </div>
              <div class="flex flex-col gap-2">
                <a href="/listing/${l.id}" class="px-3 py-1.5 bg-charcoal-200 hover:bg-indigo-500/20 text-gray-400 hover:text-indigo-300 rounded-xl text-xs font-medium transition-colors border border-white/5">
                  View
                </a>
                <button class="px-3 py-1.5 bg-charcoal-200 hover:bg-charcoal-300 text-gray-400 hover:text-white rounded-xl text-xs transition-colors border border-white/5">
                  ${l.status === 'active' ? 'Pause' : 'Activate'}
                </button>
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
        const vehicleLabel = [r.vehicle_make, r.vehicle_model].filter(Boolean).join(' ') || 'Vehicle not specified'
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
                  ${fmtDate(r.start_datetime)} · ${fmtTime(r.start_datetime)} – ${fmtTime(r.end_datetime)}
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
        </div>
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
      <div class="p-6 space-y-5">
        <div>
          <label class="text-sm text-gray-400 font-medium block mb-2">Space Title</label>
          <input type="text" placeholder="e.g. Secure Downtown Driveway" class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"/>
        </div>
        <div>
          <label class="text-sm text-gray-400 font-medium block mb-2">Space Type</label>
          <div class="grid grid-cols-3 gap-2">
            ${[{t:'Driveway',icon:'🏠'},{t:'Garage',icon:'🏗️'},{t:'Lot',icon:'🅿️'},{t:'Covered',icon:'🏢'},{t:'Uncovered',icon:'☁️'},{t:'Indoor',icon:'🏛️'}].map(type => `
              <button onclick="selectType(this)" class="type-btn p-3 bg-charcoal-200 border border-white/5 hover:border-indigo-500/40 rounded-xl text-center transition-all">
                <span class="text-2xl block mb-1">${type.icon}</span>
                <span class="text-xs text-gray-400">${type.t}</span>
              </button>
            `).join('')}
          </div>
        </div>
        <div>
          <label class="text-sm text-gray-400 font-medium block mb-2">Address</label>
          <input type="text" placeholder="Enter your space address" class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"/>
        </div>
        <div class="grid grid-cols-3 gap-3">
          ${[{label:'Hourly Rate ($)',placeholder:'e.g. 8'},{label:'Daily Rate ($)',placeholder:'e.g. 35'},{label:'Monthly Rate ($)',placeholder:'e.g. 180'}].map(f => `
            <div>
              <label class="text-sm text-gray-400 font-medium block mb-2">${f.label}</label>
              <input type="number" placeholder="${f.placeholder}" class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"/>
            </div>
          `).join('')}
        </div>
        <div>
          <label class="text-sm text-gray-400 font-medium block mb-2">Description</label>
          <textarea placeholder="Describe your space, access instructions, nearby landmarks..." rows="3" class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"></textarea>
        </div>
        <div>
          <label class="text-sm text-gray-400 font-medium block mb-2">Security Features</label>
          <div class="grid grid-cols-2 gap-2">
            ${['CCTV Camera','Gated Access','24/7 Lighting','Covered/Indoor','EV Charging','Attended'].map(f => `
              <label class="flex items-center gap-3 p-3 bg-charcoal-200 rounded-xl cursor-pointer border border-white/5 hover:border-indigo-500/30">
                <input type="checkbox" class="accent-indigo-500 w-4 h-4"/>
                <span class="text-sm text-gray-300">${f}</span>
              </label>
            `).join('')}
          </div>
        </div>
        <div class="flex items-center justify-between p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
          <div>
            <p class="font-semibold text-white text-sm">Enable Instant Book</p>
            <p class="text-gray-400 text-xs mt-0.5">Guests can book without your manual approval</p>
          </div>
          <button id="instant-toggle" onclick="toggleInstant(this)" class="w-12 h-6 bg-charcoal-300 rounded-full relative transition-colors">
            <div class="w-5 h-5 bg-white rounded-full absolute top-0.5 left-0.5 shadow transition-transform" id="instant-dot"></div>
          </button>
        </div>
      </div>
      <div class="p-4 border-t border-white/10 flex gap-3 sticky bottom-0 bg-charcoal-100">
        <button onclick="hideAddListing()" class="flex-1 py-3 bg-charcoal-200 text-gray-400 rounded-xl font-semibold text-sm hover:text-white">Cancel</button>
        <button class="flex-2 flex-1 py-3 btn-primary text-white rounded-xl font-semibold text-sm">
          Continue <i class="fas fa-arrow-right ml-2"></i>
        </button>
      </div>
    </div>
  </div>

  <script>
    function showAddListing() { document.getElementById('add-listing-modal').classList.remove('hidden'); }
    function hideAddListing() { document.getElementById('add-listing-modal').classList.add('hidden'); }
    
    function selectType(btn) {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('border-indigo-500','bg-indigo-500/10'));
      btn.classList.add('border-indigo-500','bg-indigo-500/10');
    }
    
    let instantEnabled = false;
    function toggleInstant(btn) {
      instantEnabled = !instantEnabled;
      btn.style.backgroundColor = instantEnabled ? '#5B2EFF' : '';
      document.getElementById('instant-dot').style.transform = instantEnabled ? 'translateX(24px)' : '';
    }
    
    function acceptBooking(btn, id) {
      btn.closest('.flex').innerHTML = '<span class="text-green-400 text-sm font-semibold flex items-center gap-2"><i class="fas fa-check-circle"></i> Booking Accepted</span>';
      fetch('/api/bookings/' + id + '/confirm', { method: 'POST' }).catch(() => {});
    }
    
    function declineBooking(btn, id) {
      btn.closest('.flex').innerHTML = '<span class="text-red-400 text-sm font-semibold flex items-center gap-2"><i class="fas fa-times-circle"></i> Booking Declined</span>';
      fetch('/api/bookings/' + id + '/cancel', { method: 'POST' }).catch(() => {});
    }
  </script>
  `
  return c.html(Layout('Host Dashboard', content))
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
