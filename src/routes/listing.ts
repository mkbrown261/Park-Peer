import { Hono } from 'hono'
import { Layout } from '../components/layout'

type Bindings = { DB: D1Database }

export const listingPage = new Hono<{ Bindings: Bindings }>()

listingPage.get('/:id', async (c) => {
  const id = c.req.param('id')
  const db = c.env?.DB

  // ── Fetch real listing from D1 ─────────────────────────────────────────────
  let l: any = null
  let reviews: any[] = []
  let reviewStats = { five: 0, four: 0, three: 0, two: 0, one: 0, total: 0, avg: 0 }
  let blockedDates: number[] = []

  if (db) {
    try {
      const row = await db.prepare(`
        SELECT l.id, l.title, l.type, l.description,
               l.address, l.city, l.state, l.zip, l.lat, l.lng,
               l.rate_hourly, l.rate_daily, l.rate_monthly,
               l.max_vehicle_size, l.amenities, l.photos,
               l.instant_book, l.available_from, l.available_to,
               l.avg_rating, l.review_count, l.total_bookings,
               l.status,
               u.full_name as host_name, u.created_at as host_joined,
               u.id as host_id
        FROM listings l
        LEFT JOIN users u ON l.host_id = u.id
        WHERE l.id = ?
      `).bind(id).first<any>()

      if (row) {
        let amenities: string[] = []
        let photos: string[]    = []
        try { amenities = JSON.parse(row.amenities || '[]') } catch {}
        try { photos    = JSON.parse(row.photos    || '[]') } catch {}
        l = { ...row, amenities, photos, instant_book: row.instant_book === 1 }
      }
    } catch(e: any) { console.error('[listing/:id] fetch', e.message) }

    if (l) {
      // Reviews for this listing
      try {
        const revRows = await db.prepare(`
          SELECT r.rating, r.comment, r.created_at,
                 u.full_name as reviewer_name
          FROM reviews r
          LEFT JOIN users u ON r.reviewer_id = u.id
          WHERE r.listing_id = ? AND r.status = 'published'
          ORDER BY r.created_at DESC
          LIMIT 6
        `).bind(id).all<any>()
        reviews = revRows.results || []

        // Stats breakdown
        const total = l.review_count || 0
        reviewStats.total = total
        reviewStats.avg   = l.avg_rating || 0
        // Count per star
        for (const rv of reviews) {
          const s = Math.round(rv.rating)
          if (s === 5) reviewStats.five++
          else if (s === 4) reviewStats.four++
          else if (s === 3) reviewStats.three++
          else if (s === 2) reviewStats.two++
          else              reviewStats.one++
        }
      } catch(e: any) { console.error('[listing/:id] reviews', e.message) }

      // Blocked / booked dates this month
      try {
        const now   = new Date()
        const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
        const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString()
        const blocked = await db.prepare(`
          SELECT start_datetime, end_datetime FROM bookings
          WHERE listing_id = ? AND status IN ('confirmed','active')
            AND start_datetime >= ? AND start_datetime <= ?
        `).bind(id, start, end).all<any>()
        for (const b of (blocked.results || [])) {
          const d = new Date(b.start_datetime).getDate()
          if (!blockedDates.includes(d)) blockedDates.push(d)
        }
        // Also availability_blocks table
        const ab = await db.prepare(`
          SELECT start_time FROM availability_blocks
          WHERE listing_id = ? AND start_time >= ? AND start_time <= ?
        `).bind(id, start, end).all<any>()
        for (const b of (ab.results || [])) {
          const d = new Date(b.start_time).getDate()
          if (!blockedDates.includes(d)) blockedDates.push(d)
        }
      } catch(e: any) { console.error('[listing/:id] availability', e.message) }
    }
  }

  // 404 if no listing found
  if (!l) {
    return c.html(Layout('Listing Not Found', `
      <div class="pt-24 min-h-screen flex items-center justify-center">
        <div class="text-center px-4">
          <i class="fas fa-parking text-6xl text-gray-700 mb-6 block"></i>
          <h1 class="text-3xl font-black text-white mb-3">Listing Not Found</h1>
          <p class="text-gray-400 mb-6">This parking spot may have been removed or doesn't exist.</p>
          <a href="/search" class="btn-primary inline-flex items-center gap-2 px-6 py-3 rounded-xl text-white font-bold">
            <i class="fas fa-search"></i> Browse All Spots
          </a>
        </div>
      </div>
    `), 404)
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  const typeIcon = (t: string) => {
    const v = (t||'').toLowerCase()
    if (v==='garage')   return 'fa-warehouse'
    if (v==='driveway') return 'fa-home'
    if (v==='covered')  return 'fa-building'
    return 'fa-parking'
  }

  const amenityIcons: Record<string,string> = {
    'cctv':'fa-video', 'camera':'fa-video',
    'covered':'fa-umbrella',
    'ev':'fa-bolt', 'ev charging':'fa-bolt',
    '24/7':'fa-clock', '24/7 access':'fa-clock',
    'gated':'fa-lock', 'gated access':'fa-lock',
    'lighting':'fa-lightbulb', '24/7 lighting':'fa-lightbulb',
    'shuttle':'fa-shuttle-space',
    'street access':'fa-road',
    'attended':'fa-user-shield',
  }
  const amenityIcon = (a: string) => amenityIcons[(a||'').toLowerCase()] || 'fa-check'

  const hostInitial = (l.host_name || '?')[0].toUpperCase()
  const hostJoined  = l.host_joined
    ? new Date(l.host_joined).toLocaleDateString('en-US', { month:'short', year:'numeric' })
    : 'ParkPeer Host'

  const price   = l.rate_hourly  ? `$${l.rate_hourly}`  : '–'
  const daily   = l.rate_daily   ? `$${l.rate_daily}`   : '–'
  const monthly = l.rate_monthly ? `$${l.rate_monthly}` : '–'
  const rating  = l.avg_rating   ? Number(l.avg_rating).toFixed(1)  : '–'
  const cityState = [l.city, l.state].filter(Boolean).join(', ')
  const fullAddr  = [l.address, cityState].filter(Boolean).join(', ')

  // ── Reviews HTML ───────────────────────────────────────────────────────────
  const starsForPct = (count: number, total: number) =>
    total > 0 ? Math.round(count / total * 100) : 0

  const reviewBreakdownHTML = `
    <div class="space-y-2">
      ${[
        { star: 5, count: reviewStats.five },
        { star: 4, count: reviewStats.four },
        { star: 3, count: reviewStats.three },
        { star: 2, count: reviewStats.two },
        { star: 1, count: reviewStats.one },
      ].map(row => {
        const pct = starsForPct(row.count, reviews.length)
        return `
          <div class="flex items-center gap-2 text-sm">
            <span class="text-gray-400 w-3">${row.star}</span>
            <i class="fas fa-star text-amber-400 text-xs"></i>
            <div class="flex-1 bg-charcoal-200 rounded-full h-1.5">
              <div class="bg-amber-400 h-1.5 rounded-full" style="width:${pct}%"></div>
            </div>
            <span class="text-gray-500 w-8 text-right">${pct}%</span>
          </div>
        `
      }).join('')}
    </div>
  `

  const reviewListHTML = reviews.length === 0
    ? `<div class="pt-4 text-center text-gray-500 text-sm py-6">
         <i class="fas fa-star text-gray-700 text-2xl mb-2 block"></i>
         No reviews yet — be the first to book and leave one!
       </div>`
    : reviews.map(r => {
        const name    = r.reviewer_name || 'Driver'
        const initial = name[0].toUpperCase()
        const date    = r.created_at
          ? new Date(r.created_at).toLocaleDateString('en-US', { month:'short', year:'numeric' })
          : ''
        const stars = Array(Math.round(r.rating || 0)).fill('<i class="fas fa-star text-amber-400 text-xs"></i>').join('')
        return `
          <div class="border-t border-white/5 pt-4">
            <div class="flex items-center gap-3 mb-2">
              <div class="w-9 h-9 gradient-bg rounded-full flex items-center justify-center font-bold text-sm text-white flex-shrink-0">${initial}</div>
              <div>
                <p class="font-semibold text-white text-sm">${name}</p>
                <p class="text-gray-500 text-xs">${date}</p>
              </div>
              <div class="flex ml-auto gap-0.5">${stars}</div>
            </div>
            <p class="text-gray-300 text-sm leading-relaxed">${r.comment || ''}</p>
          </div>
        `
      }).join('')

  // ── Mini calendar with real blocked dates ──────────────────────────────────
  const calHTML = generateMiniCalendar(blockedDates)

  const content = `
  <div class="pt-16">
    <div class="max-w-7xl mx-auto px-4 py-8">
      <!-- Breadcrumb -->
      <div class="flex items-center gap-2 text-sm text-gray-500 mb-6">
        <a href="/" class="hover:text-white transition-colors">Home</a>
        <i class="fas fa-chevron-right text-xs"></i>
        <a href="/search${cityState ? '?q=' + encodeURIComponent(l.city||'') : ''}" class="hover:text-white transition-colors">${cityState || 'Search'}</a>
        <i class="fas fa-chevron-right text-xs"></i>
        <span class="text-gray-300">${l.title}</span>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <!-- Main Content -->
        <div class="lg:col-span-2 space-y-6">
          <!-- Photo Gallery -->
          <div class="grid grid-cols-4 gap-2 h-64 md:h-80 rounded-2xl overflow-hidden">
            <div class="col-span-2 row-span-2 bg-gradient-to-br from-charcoal-300 to-charcoal-400 flex items-center justify-center relative group cursor-pointer">
              <i class="fas ${typeIcon(l.type)} text-6xl text-white/15"></i>
              <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                <i class="fas fa-expand text-white opacity-0 group-hover:opacity-100 transition-opacity text-2xl"></i>
              </div>
              <span class="absolute bottom-3 left-3 bg-black/60 text-white text-xs px-2 py-1 rounded-lg">Main View</span>
            </div>
            ${['Entry View','Interior','Night View'].map(label => `
              <div class="bg-gradient-to-br from-charcoal-200 to-charcoal-300 rounded-sm flex items-center justify-center relative cursor-pointer group">
                <i class="fas fa-image text-white/10 text-2xl"></i>
                <span class="absolute bottom-1 left-1 text-gray-500 text-xs">${label}</span>
              </div>
            `).join('')}
          </div>

          <!-- Header -->
          <div>
            <div class="flex items-start justify-between gap-4">
              <div>
                <div class="flex items-center gap-2 mb-2">
                  <span class="bg-indigo-500/20 text-indigo-400 text-xs font-semibold px-3 py-1 rounded-full capitalize">
                    <i class="fas ${typeIcon(l.type)} mr-1"></i>${l.type || 'Spot'}
                  </span>
                  ${l.instant_book ? `<span class="bg-lime-500/10 text-lime-500 text-xs font-semibold px-3 py-1 rounded-full">⚡ Instant Book</span>` : ''}
                </div>
                <h1 class="text-2xl md:text-3xl font-black text-white">${l.title}</h1>
                <p class="text-gray-400 mt-1 flex items-center gap-2">
                  <i class="fas fa-map-pin text-indigo-400"></i>
                  ${fullAddr}
                </p>
              </div>
              <div class="flex gap-2 flex-shrink-0">
                <button class="w-10 h-10 bg-charcoal-100 border border-white/10 rounded-xl flex items-center justify-center text-gray-400 hover:text-red-400 transition-colors">
                  <i class="fas fa-heart text-lg"></i>
                </button>
                <button class="w-10 h-10 bg-charcoal-100 border border-white/10 rounded-xl flex items-center justify-center text-gray-400 hover:text-white transition-colors">
                  <i class="fas fa-share-nodes text-lg"></i>
                </button>
              </div>
            </div>
            <div class="flex items-center gap-4 mt-4">
              <div class="flex items-center gap-1.5">
                <i class="fas fa-star text-amber-400"></i>
                <span class="font-bold text-white text-lg">${rating}</span>
                <span class="text-gray-400">(${l.review_count || 0} reviews)</span>
              </div>
              ${l.max_vehicle_size ? `<span class="text-gray-600">·</span><span class="text-gray-400 text-sm capitalize">${l.max_vehicle_size}</span>` : ''}
            </div>
          </div>

          <!-- Description -->
          <div class="bg-charcoal-100 rounded-2xl p-6 border border-white/5">
            <h2 class="text-lg font-bold text-white mb-3">About This Space</h2>
            <p class="text-gray-300 leading-relaxed">${l.description || 'No description provided.'}</p>
          </div>

          <!-- Amenities -->
          ${l.amenities && l.amenities.length > 0 ? `
          <div class="bg-charcoal-100 rounded-2xl p-6 border border-white/5">
            <h2 class="text-lg font-bold text-white mb-4">Features & Amenities</h2>
            <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
              ${l.amenities.map((a: string) => `
                <div class="flex items-center gap-3 p-3 bg-charcoal-200 rounded-xl">
                  <i class="fas ${amenityIcon(a)} text-indigo-400 w-4 text-center"></i>
                  <span class="text-sm text-gray-300">${a}</span>
                </div>
              `).join('')}
            </div>
          </div>
          ` : ''}

          <!-- Parking Details -->
          <div class="bg-charcoal-100 rounded-2xl p-6 border border-white/5">
            <h2 class="text-lg font-bold text-white mb-4">Parking Details</h2>
            <div class="grid grid-cols-2 gap-4">
              <div class="flex gap-3">
                <div class="w-9 h-9 bg-indigo-500/10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                  <i class="fas fa-parking text-indigo-400 text-sm"></i>
                </div>
                <div>
                  <p class="text-xs text-gray-500 mb-0.5">Space Type</p>
                  <p class="text-sm text-white font-medium capitalize">${l.type || '–'}</p>
                </div>
              </div>
              ${l.max_vehicle_size ? `
              <div class="flex gap-3">
                <div class="w-9 h-9 bg-indigo-500/10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                  <i class="fas fa-car text-indigo-400 text-sm"></i>
                </div>
                <div>
                  <p class="text-xs text-gray-500 mb-0.5">Max Vehicle Size</p>
                  <p class="text-sm text-white font-medium capitalize">${l.max_vehicle_size}</p>
                </div>
              </div>` : ''}
              <div class="flex gap-3">
                <div class="w-9 h-9 bg-indigo-500/10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                  <i class="fas fa-calendar-xmark text-indigo-400 text-sm"></i>
                </div>
                <div>
                  <p class="text-xs text-gray-500 mb-0.5">Cancellation</p>
                  <p class="text-sm text-white font-medium">Free up to 1 hour before</p>
                </div>
              </div>
              <div class="flex gap-3">
                <div class="w-9 h-9 bg-indigo-500/10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                  <i class="fas fa-bolt text-indigo-400 text-sm"></i>
                </div>
                <div>
                  <p class="text-xs text-gray-500 mb-0.5">Booking</p>
                  <p class="text-sm text-white font-medium">${l.instant_book ? '⚡ Instant Book' : 'Request to Book'}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Availability Calendar — real blocked dates -->
          <div class="bg-charcoal-100 rounded-2xl p-6 border border-white/5">
            <h2 class="text-lg font-bold text-white mb-4">
              <i class="fas fa-calendar text-indigo-400 mr-2"></i>Availability
            </h2>
            <div id="mini-calendar" class="text-sm">
              ${calHTML}
            </div>
          </div>

          <!-- Reviews — real D1 -->
          <div class="bg-charcoal-100 rounded-2xl p-6 border border-white/5">
            <div class="flex items-center justify-between mb-6">
              <h2 class="text-lg font-bold text-white flex items-center gap-2">
                <i class="fas fa-star text-amber-400"></i>
                ${rating} · ${l.review_count || 0} Reviews
              </h2>
            </div>
            <div class="grid grid-cols-2 gap-6 mb-6">
              ${reviewBreakdownHTML}
              <div class="grid grid-cols-2 gap-2 text-center">
                ${['Accuracy','Location','Value','Safety'].map(cat => `
                  <div class="bg-charcoal-200 rounded-xl p-2">
                    <p class="text-xl font-black text-white">${rating !== '–' ? rating : '–'}</p>
                    <p class="text-xs text-gray-400">${cat}</p>
                  </div>
                `).join('')}
              </div>
            </div>
            <div class="space-y-4">
              ${reviewListHTML}
            </div>
            ${(l.review_count||0) > reviews.length ? `
            <button class="mt-4 w-full py-3 bg-charcoal-200 text-gray-400 hover:text-white rounded-xl text-sm transition-colors border border-white/5">
              Show All ${l.review_count} Reviews
            </button>` : ''}
          </div>

          <!-- Location Map -->
          <div class="bg-charcoal-100 rounded-2xl p-6 border border-white/5">
            <h2 class="text-lg font-bold text-white mb-4"><i class="fas fa-map text-indigo-400 mr-2"></i>Location</h2>
            <div class="h-48 bg-gradient-to-br from-charcoal-300 to-charcoal-400 rounded-xl flex items-center justify-center relative overflow-hidden" id="listing-map">
              <div class="absolute inset-0" style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);">
              </div>
              <div class="relative text-center" id="map-placeholder">
                <div class="w-10 h-10 gradient-bg rounded-full flex items-center justify-center mx-auto mb-2 glow-indigo">
                  <i class="fas fa-parking text-white"></i>
                </div>
                <p class="text-white text-sm font-medium">${fullAddr}</p>
                <p class="text-gray-400 text-xs mt-1">Exact location provided after booking</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Booking Sidebar -->
        <div class="lg:col-span-1">
          <div class="sticky top-20">
            <div class="bg-charcoal-100 border border-white/10 rounded-2xl p-6 shadow-2xl">
              <!-- Pricing -->
              <div class="flex items-baseline gap-1 mb-1">
                <span class="text-3xl font-black text-white">${price}</span>
                <span class="text-gray-400">/hour</span>
              </div>
              <div class="flex gap-3 mb-4 text-sm text-gray-400">
                ${l.rate_daily   ? `<span class="text-white font-semibold">${daily}</span>/day` : ''}
                ${l.rate_daily && l.rate_monthly ? '<span>·</span>' : ''}
                ${l.rate_monthly ? `<span class="text-white font-semibold">${monthly}</span>/month` : ''}
              </div>

              <!-- Date/Time Picker -->
              <div class="border border-white/10 rounded-xl overflow-hidden mb-3">
                <div class="grid grid-cols-2 divide-x divide-white/10">
                  <div class="p-3">
                    <label class="text-xs text-gray-500 font-medium uppercase tracking-wider block mb-1">Arrive</label>
                    <input type="datetime-local" id="arrive-dt" class="bg-transparent text-white text-sm w-full focus:outline-none"/>
                  </div>
                  <div class="p-3">
                    <label class="text-xs text-gray-500 font-medium uppercase tracking-wider block mb-1">Depart</label>
                    <input type="datetime-local" id="depart-dt" class="bg-transparent text-white text-sm w-full focus:outline-none"/>
                  </div>
                </div>
              </div>

              <!-- Vehicle Size -->
              <select class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-4 py-3 text-sm text-white mb-4 focus:outline-none focus:border-indigo-500">
                <option>Compact / Sedan</option>
                <option>SUV / Crossover</option>
                <option>Truck</option>
                <option>Van</option>
                <option>Motorcycle</option>
              </select>

              <!-- Price Breakdown -->
              <div id="price-breakdown" class="bg-charcoal-200 rounded-xl p-4 mb-4 space-y-2.5 text-sm">
                <div class="flex justify-between text-gray-300">
                  <span>${price}/hr × <span id="hours-count">3</span> hours</span>
                  <span id="base-price">${l.rate_hourly ? '$'+(l.rate_hourly*3) : '–'}</span>
                </div>
                <div class="flex justify-between text-gray-300">
                  <span>Service fee (15%)</span>
                  <span id="service-fee">${l.rate_hourly ? '$'+Math.round(l.rate_hourly*3*0.15) : '–'}</span>
                </div>
                <div class="border-t border-white/10 pt-2 flex justify-between font-bold text-white">
                  <span>Total</span>
                  <span id="total-price">${l.rate_hourly ? '$'+Math.round(l.rate_hourly*3*1.15) : '–'}</span>
                </div>
              </div>

              <a href="/booking/${id}" class="btn-primary w-full flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-white text-base mb-3">
                <i class="fas fa-bolt"></i>
                Reserve Now
              </a>
              <p class="text-center text-gray-500 text-xs mb-4">You won't be charged yet · Free cancellation</p>

              <div class="flex items-start gap-2 text-xs text-gray-500">
                <i class="fas fa-shield-halved text-green-400 mt-0.5"></i>
                <p>Protected by ParkPeer Guarantee. Refund if space unavailable on arrival.</p>
              </div>
            </div>

            <!-- Host Card -->
            <div class="bg-charcoal-100 border border-white/5 rounded-2xl p-5 mt-4">
              <div class="flex items-center gap-3 mb-4">
                <div class="w-12 h-12 gradient-bg rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                  ${hostInitial}
                </div>
                <div>
                  <p class="font-bold text-white">Hosted by ${l.host_name || 'ParkPeer Host'}</p>
                  <div class="flex items-center gap-1 text-xs text-gray-400">
                    <i class="fas fa-star text-amber-400"></i>
                    <span>Member since ${hostJoined}</span>
                  </div>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-2 text-xs">
                <div class="bg-charcoal-200 rounded-xl p-2.5 text-center">
                  <p class="text-gray-400">Listings</p>
                  <p class="font-semibold text-white mt-0.5">${l.total_bookings || 0} bookings</p>
                </div>
                <div class="bg-charcoal-200 rounded-xl p-2.5 text-center">
                  <p class="text-gray-400">Rating</p>
                  <p class="font-semibold text-white mt-0.5">${rating} ★</p>
                </div>
              </div>
              <button class="mt-3 w-full py-2.5 bg-charcoal-200 border border-white/10 text-gray-300 hover:text-white rounded-xl text-sm font-medium transition-colors">
                <i class="fas fa-message mr-2 text-indigo-400"></i>Contact Host
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const HOURLY_RATE = ${l.rate_hourly || 0};

    // Set default times
    const now   = new Date();
    const later = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const toVal = (d) => d.toISOString().slice(0,16);
    const arriveEl = document.getElementById('arrive-dt');
    const departEl = document.getElementById('depart-dt');
    if (arriveEl) { arriveEl.value = toVal(now); arriveEl.min = toVal(now); }
    if (departEl) departEl.value = toVal(later);

    function updatePrice() {
      if (!HOURLY_RATE) return;
      const arrive = new Date(arriveEl.value);
      const depart = new Date(departEl.value);
      if (!arrive || !depart || depart <= arrive) return;
      const hours   = Math.max(1, Math.round((depart - arrive) / 3600000));
      const base    = HOURLY_RATE * hours;
      const fee     = Math.round(base * 0.15);
      const total   = base + fee;
      document.getElementById('hours-count').textContent = hours;
      document.getElementById('base-price').textContent  = '$' + base;
      document.getElementById('service-fee').textContent = '$' + fee;
      document.getElementById('total-price').textContent = '$' + total;
    }

    if (arriveEl) arriveEl.addEventListener('change', updatePrice);
    if (departEl) departEl.addEventListener('change', updatePrice);
  </script>
  `
  return c.html(Layout(l.title, content))
})

function generateMiniCalendar(blocked: number[] = []) {
  const today      = new Date()
  const year       = today.getFullYear()
  const month      = today.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDay   = new Date(year, month, 1).getDay()
  const monthName  = today.toLocaleString('default', { month: 'long' })

  let html = `
    <div class="flex items-center justify-between mb-4">
      <button class="w-8 h-8 rounded-full bg-charcoal-200 flex items-center justify-center text-gray-400 hover:text-white"><i class="fas fa-chevron-left text-xs"></i></button>
      <span class="font-bold text-white">${monthName} ${year}</span>
      <button class="w-8 h-8 rounded-full bg-charcoal-200 flex items-center justify-center text-gray-400 hover:text-white"><i class="fas fa-chevron-right text-xs"></i></button>
    </div>
    <div class="grid grid-cols-7 gap-1 text-center text-xs text-gray-500 mb-2">
      ${['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => `<div class="font-medium">${d}</div>`).join('')}
    </div>
    <div class="grid grid-cols-7 gap-1">
  `
  for (let i = 0; i < firstDay; i++) html += `<div></div>`
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday    = d === today.getDate()
    const isUnavail  = blocked.includes(d)
    const isPast     = d < today.getDate()
    let cls = 'w-8 h-8 mx-auto rounded-full flex items-center justify-center text-xs cursor-pointer transition-all '
    if (isToday)        cls += 'gradient-bg text-white font-bold glow-indigo'
    else if (isUnavail) cls += 'bg-red-500/10 text-red-400/60 cursor-not-allowed'
    else if (isPast)    cls += 'text-gray-600 cursor-not-allowed'
    else                cls += 'text-gray-300 hover:bg-indigo-500/20 hover:text-white'
    html += `<div><div class="${cls}">${d}</div></div>`
  }
  html += `</div>
    <div class="flex items-center gap-4 mt-4 text-xs text-gray-400">
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 gradient-bg rounded-full"></div> Today</div>
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 bg-red-500/20 rounded-full"></div> Booked</div>
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 bg-charcoal-200 rounded-full border border-white/10"></div> Available</div>
    </div>
  `
  return html
}
