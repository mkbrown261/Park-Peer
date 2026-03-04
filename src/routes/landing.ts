import { Hono } from 'hono'
import { Layout } from '../components/layout'

type Bindings = {
  DB: D1Database
}

export const landingPage = new Hono<{ Bindings: Bindings }>()

landingPage.get('/', async (c) => {
  const db = c.env?.DB

  // ── Real D1 stats ──────────────────────────────────────────────────────────
  let totalSpots    = 0
  let totalHosts    = 0
  let totalCities   = 0
  let totalEarnings = 0
  let featured: any[] = []
  let cityRows: any[] = []

  if (db) {
    try {
      const [spots, hosts, cities, earnings] = await Promise.all([
        db.prepare("SELECT COUNT(*) as n FROM listings WHERE status='active'").first<{n:number}>(),
        db.prepare("SELECT COUNT(DISTINCT host_id) as n FROM listings WHERE status='active'").first<{n:number}>(),
        db.prepare("SELECT COUNT(DISTINCT city) as n FROM listings WHERE status='active'").first<{n:number}>(),
        db.prepare("SELECT COALESCE(SUM(host_payout),0) as n FROM payments WHERE status='succeeded'").first<{n:number}>(),
      ])
      totalSpots    = spots?.n    ?? 0
      totalHosts    = hosts?.n    ?? 0
      totalCities   = cities?.n   ?? 0
      totalEarnings = earnings?.n ?? 0
    } catch(e: any) { console.error('[landing/stats]', e.message) }

    try {
      const rows = await db.prepare(`
        SELECT l.id, l.title, l.type, l.address, l.city, l.state,
               l.rate_hourly, l.rate_daily,
               l.avg_rating, l.review_count,
               l.instant_book, l.amenities, l.max_vehicle_size
        FROM listings l
        WHERE l.status = 'active'
        ORDER BY l.avg_rating DESC, l.review_count DESC, l.created_at DESC
        LIMIT 8
      `).all<any>()
      featured = (rows.results || []).map((r: any) => {
        let amenities: string[] = []
        try { amenities = JSON.parse(r.amenities || '[]') } catch {}
        return { ...r, amenities, instant_book: r.instant_book === 1 }
      })
    } catch(e: any) { console.error('[landing/featured]', e.message) }

    try {
      const rows = await db.prepare(`
        SELECT city, state, COUNT(*) as spot_count
        FROM listings WHERE status='active'
        GROUP BY city, state ORDER BY spot_count DESC LIMIT 8
      `).all<any>()
      cityRows = rows.results || []
    } catch(e: any) { console.error('[landing/cities]', e.message) }
  }

  // ── Format helpers ─────────────────────────────────────────────────────────
  const fmtNum = (n: number) => n >= 1000 ? `${(n/1000).toFixed(1).replace('.0','')}K+` : `${n}+`
  const fmtDollars = (n: number) => {
    if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(1).replace('.0','')}M+`
    if (n >= 1_000)     return `$${(n/1_000).toFixed(0)}K+`
    return `$${n.toFixed(0)}`
  }

  // ── Type → badge helper ────────────────────────────────────────────────────
  const typeBadge = (l: any) => {
    if (l.instant_book) return { text: '⚡ Instant Book', cls: 'bg-lime-500 text-charcoal' }
    if (l.avg_rating >= 4.8 && l.review_count > 20) return { text: '🏆 Top Rated', cls: 'bg-amber-500 text-charcoal' }
    const t = (l.type || '').toLowerCase()
    if (t === 'lot')      return { text: '🅿️ Lot',     cls: 'bg-blue-500 text-white' }
    if (t === 'covered')  return { text: '🏢 Covered', cls: 'bg-purple-500 text-white' }
    if (t === 'garage')   return { text: '🏗️ Garage',  cls: 'bg-indigo-500 text-white' }
    return { text: '🏠 Driveway', cls: 'bg-gray-600 text-white' }
  }

  // ── Featured cards HTML ────────────────────────────────────────────────────
  const featuredHTML = featured.length === 0
    ? `<div class="col-span-full text-center py-16 text-gray-500">
         <i class="fas fa-parking text-4xl mb-3 block text-gray-600"></i>
         <p class="text-lg font-medium text-gray-400">No listings yet.</p>
         <p class="text-sm mt-1">Be the first to <a href="/host" class="text-lime-500 underline">list your space</a>.</p>
       </div>`
    : featured.map((l: any, idx: number) => {
        const badge = typeBadge(l)
        const typeIcon = l.type === 'garage' ? 'fa-warehouse' : l.type === 'driveway' ? 'fa-home' : l.type === 'covered' ? 'fa-building' : 'fa-parking'
        const cityLabel = l.city ? `${l.city}${l.state ? ', '+l.state : ''}` : ''
        const rating  = l.avg_rating  ? Number(l.avg_rating).toFixed(1)  : '–'
        const reviews = l.review_count ?? 0
        const price   = l.rate_hourly ? `$${l.rate_hourly}` : '–'
        return `
          <a href="/listing/${l.id}" class="block card-hover">
            <div class="bg-charcoal-200 rounded-2xl overflow-hidden border border-white/5 hover:border-indigo-500/30 transition-all h-full">
              <div class="h-48 bg-gradient-to-br from-charcoal-300 to-charcoal-400 flex items-center justify-center relative">
                <i class="fas ${typeIcon} text-7xl text-white/10"></i>
                <div class="absolute top-3 left-3">
                  <span class="${badge.cls} text-xs font-bold px-2.5 py-1 rounded-full">${badge.text}</span>
                </div>
                <div class="absolute top-3 right-3">
                  <button onclick="event.preventDefault(); toggleFavorite(${l.id})" class="w-8 h-8 bg-black/40 hover:bg-red-500/80 rounded-full flex items-center justify-center transition-colors">
                    <i class="fas fa-heart text-white/60 text-sm" id="fav-${l.id}"></i>
                  </button>
                </div>
                ${cityLabel ? `<div class="absolute bottom-3 right-3 flex items-center gap-1 bg-black/60 rounded-full px-2.5 py-1">
                  <i class="fas fa-map-marker-alt text-indigo-400 text-xs"></i>
                  <span class="text-white text-xs font-medium">${cityLabel}</span>
                </div>` : ''}
              </div>
              <div class="p-4">
                <div class="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <h3 class="font-bold text-white text-base leading-tight">${l.title}</h3>
                    <p class="text-gray-500 text-xs mt-0.5 flex items-center gap-1">
                      <i class="fas fa-map-pin text-indigo-400"></i> ${l.address}
                    </p>
                  </div>
                  <div class="text-right flex-shrink-0">
                    <p class="text-lg font-black text-white">${price}</p>
                    <p class="text-gray-500 text-xs">/hr</p>
                  </div>
                </div>
                <div class="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
                  <div class="flex items-center gap-1">
                    <i class="fas fa-star text-amber-400 text-xs"></i>
                    <span class="text-white text-sm font-semibold">${rating}</span>
                    <span class="text-gray-500 text-xs">(${reviews})</span>
                  </div>
                  <span class="text-xs bg-charcoal-300 text-gray-300 px-2.5 py-1 rounded-full capitalize">
                    <i class="fas fa-parking mr-1 text-indigo-400"></i>${l.type || 'Spot'}
                  </span>
                </div>
              </div>
            </div>
          </a>
        `
      }).join('')

  // ── City grid HTML ─────────────────────────────────────────────────────────
  const cityHTML = cityRows.length === 0
    ? `<div class="col-span-full text-center text-gray-500 text-sm py-4">No active cities yet.</div>`
    : cityRows.map((c2: any) => `
        <div class="relative p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-center card-hover cursor-pointer">
          <div class="absolute top-2 right-2 w-2 h-2 bg-lime-500 rounded-full pulse-dot"></div>
          <p class="font-bold text-white text-sm">${c2.city}</p>
          <p class="text-indigo-400 text-xs mt-1">${c2.spot_count} spot${c2.spot_count !== 1 ? 's' : ''}</p>
          <p class="text-gray-500 text-xs mt-0.5">Active</p>
        </div>
      `).join('')

  const content = `
  <!-- Hero Section -->
  <section class="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
    <div class="absolute inset-0 map-bg opacity-40"></div>
    <div class="absolute top-20 left-1/4 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl"></div>
    <div class="absolute bottom-20 right-1/4 w-80 h-80 bg-lime-500/10 rounded-full blur-3xl"></div>
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-900/10 rounded-full blur-3xl"></div>
    
    <div class="absolute inset-0 pointer-events-none">
    </div>

    <div class="relative z-10 max-w-5xl mx-auto px-4 text-center slide-up">
      <div class="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/30 rounded-full px-4 py-2 mb-8">
        <span class="w-2 h-2 bg-lime-500 rounded-full pulse-dot"></span>
        <span class="text-sm text-indigo-300 font-medium">Now live — ${totalSpots > 0 ? fmtNum(totalSpots) : 'Growing'} spots available</span>
      </div>

      <h1 class="text-5xl md:text-7xl lg:text-8xl font-black leading-none mb-6 tracking-tight">
        Turn Empty Space<br/>
        <span class="gradient-text">Into Income.</span>
      </h1>
      
      <p class="text-xl md:text-2xl text-gray-300 max-w-2xl mx-auto mb-10 leading-relaxed font-light">
        The peer-to-peer parking marketplace. List your driveway. Find affordable parking. No middlemen.
      </p>

      <div class="flex flex-col sm:flex-row gap-4 justify-center mb-12">
        <a href="/search" class="btn-primary inline-flex items-center justify-center gap-3 px-8 py-4 rounded-2xl font-bold text-lg text-white">
          <i class="fas fa-search-location"></i>
          Find Parking Near You
        </a>
        <a href="/host" class="btn-lime inline-flex items-center justify-center gap-3 px-8 py-4 rounded-2xl font-bold text-lg">
          <i class="fas fa-plus-circle"></i>
          List Your Space
        </a>
      </div>

      <div class="max-w-2xl mx-auto">
        <div class="glass rounded-2xl p-2 flex flex-col sm:flex-row gap-2">
          <div class="flex-1 flex items-center gap-3 bg-charcoal-100 rounded-xl px-4 py-3">
            <i class="fas fa-map-marker-alt text-indigo-400"></i>
            <input type="text" placeholder="Where are you going?" class="bg-transparent text-white placeholder-gray-500 text-sm flex-1 focus:outline-none" id="hero-location"/>
          </div>
          <div class="flex items-center gap-3 bg-charcoal-100 rounded-xl px-4 py-3 sm:w-40">
            <i class="fas fa-calendar text-indigo-400"></i>
            <input type="date" class="bg-transparent text-white text-sm flex-1 focus:outline-none" id="hero-date"/>
          </div>
          <button onclick="searchParking()" class="btn-primary px-6 py-3 rounded-xl font-bold text-white flex items-center gap-2">
            <i class="fas fa-search"></i>
            <span class="sm:hidden">Search</span>
          </button>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-center gap-6 mt-10 text-sm text-gray-400">
        <div class="flex items-center gap-2">
          <i class="fas fa-shield-halved text-green-400"></i>
          <span>Verified Listings</span>
        </div>
        <div class="flex items-center gap-2">
          <i class="fas fa-lock text-green-400"></i>
          <span>Secure Payments</span>
        </div>
        <div class="flex items-center gap-2">
          <i class="fas fa-headset text-green-400"></i>
          <span>24/7 Support</span>
        </div>
      </div>
    </div>

    <div class="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-gray-500 animate-bounce">
      <span class="text-xs font-medium tracking-wider uppercase">Scroll</span>
      <i class="fas fa-chevron-down text-sm"></i>
    </div>
  </section>

  <!-- Stats Section — real D1 data -->
  <section class="py-16 border-y border-white/5">
    <div class="max-w-7xl mx-auto px-4">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
        <div class="stat-card rounded-2xl p-6 text-center card-hover cursor-default">
          <i class="fas fa-parking text-3xl text-indigo-400 mb-3 block"></i>
          <div class="text-3xl md:text-4xl font-black text-white mb-1">${totalSpots > 0 ? fmtNum(totalSpots) : '–'}</div>
          <div class="text-gray-400 text-sm font-medium">Parking Spots</div>
        </div>
        <div class="stat-card rounded-2xl p-6 text-center card-hover cursor-default">
          <i class="fas fa-dollar-sign text-3xl text-lime-500 mb-3 block"></i>
          <div class="text-3xl md:text-4xl font-black text-white mb-1">${totalEarnings > 0 ? fmtDollars(totalEarnings) : '$0'}</div>
          <div class="text-gray-400 text-sm font-medium">Host Earnings</div>
        </div>
        <div class="stat-card rounded-2xl p-6 text-center card-hover cursor-default">
          <i class="fas fa-users text-3xl text-indigo-400 mb-3 block"></i>
          <div class="text-3xl md:text-4xl font-black text-white mb-1">${totalHosts > 0 ? fmtNum(totalHosts) : '–'}</div>
          <div class="text-gray-400 text-sm font-medium">Active Hosts</div>
        </div>
        <div class="stat-card rounded-2xl p-6 text-center card-hover cursor-default">
          <i class="fas fa-city text-3xl text-lime-500 mb-3 block"></i>
          <div class="text-3xl md:text-4xl font-black text-white mb-1">${totalCities > 0 ? totalCities : '–'}</div>
          <div class="text-gray-400 text-sm font-medium">Cities</div>
        </div>
      </div>
    </div>
  </section>

  <!-- How It Works -->
  <section class="py-24 max-w-7xl mx-auto px-4">
    <div class="text-center mb-16">
      <span class="text-indigo-400 text-sm font-semibold uppercase tracking-widest">Simple Process</span>
      <h2 class="text-4xl md:text-5xl font-black mt-3 mb-4">How ParkPeer Works</h2>
      <p class="text-gray-400 text-lg max-w-xl mx-auto">Find or list parking in under 60 seconds. No apps, no meters, no stress.</p>
    </div>
    
    <div class="flex justify-center gap-2 mb-12">
      <button onclick="switchTab('driver')" id="tab-driver" class="tab-btn px-6 py-3 rounded-full font-semibold text-sm transition-all bg-indigo-500 text-white">
        <i class="fas fa-car mr-2"></i>For Drivers
      </button>
      <button onclick="switchTab('host')" id="tab-host" class="tab-btn px-6 py-3 rounded-full font-semibold text-sm transition-all bg-charcoal-200 text-gray-400 hover:text-white border border-white/10">
        <i class="fas fa-home mr-2"></i>For Hosts
      </button>
    </div>

    <div id="driver-steps" class="grid grid-cols-1 md:grid-cols-4 gap-6">
      ${[
        { step:'01', icon:'fa-search-location', title:'Search', desc:'Enter your destination and select arrival time. Filter by price, vehicle type, and amenities.', color:'from-indigo-600 to-indigo-800' },
        { step:'02', icon:'fa-map-pin', title:'Choose a Spot', desc:'Browse verified spots with photos, reviews, and real-time availability. Compare prices instantly.', color:'from-indigo-700 to-purple-800' },
        { step:'03', icon:'fa-credit-card', title:'Book & Pay', desc:'Secure checkout in seconds. Pay with card, Apple Pay, or Google Pay. Get instant confirmation.', color:'from-purple-700 to-indigo-800' },
        { step:'04', icon:'fa-qrcode', title:'Park & Go', desc:'Receive QR code for contactless check-in. Navigate directly to your spot with in-app directions.', color:'from-indigo-600 to-purple-700' }
      ].map(s => `
        <div class="relative card-hover">
          <div class="bg-gradient-to-br ${s.color} rounded-2xl p-6 h-full border border-indigo-500/20">
            <div class="text-6xl font-black text-white/5 absolute top-4 right-4">${s.step}</div>
            <div class="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center mb-4">
              <i class="fas ${s.icon} text-white text-xl"></i>
            </div>
            <h3 class="font-bold text-xl text-white mb-2">${s.title}</h3>
            <p class="text-indigo-200 text-sm leading-relaxed">${s.desc}</p>
          </div>
        </div>
      `).join('')}
    </div>

    <div id="host-steps" class="hidden grid grid-cols-1 md:grid-cols-4 gap-6">
      ${[
        { step:'01', icon:'fa-camera', title:'Create Listing', desc:'Add photos, set your rates, and describe your space. Our AI suggests competitive pricing.', color:'from-lime-700 to-green-800' },
        { step:'02', icon:'fa-calendar-check', title:'Set Availability', desc:'Control when your space is available with an easy calendar editor. Block off personal use days.', color:'from-green-700 to-teal-800' },
        { step:'03', icon:'fa-bell', title:'Get Booked', desc:'Receive instant booking notifications. Review driver profiles. Enable Instant Book to maximize income.', color:'from-teal-700 to-green-800' },
        { step:'04', icon:'fa-money-bill-wave', title:'Get Paid', desc:'Automatic weekly payouts to your bank account. Track all earnings in your host dashboard.', color:'from-lime-700 to-green-700' }
      ].map(s => `
        <div class="relative card-hover">
          <div class="bg-gradient-to-br ${s.color} rounded-2xl p-6 h-full border border-lime-500/20">
            <div class="text-6xl font-black text-white/5 absolute top-4 right-4">${s.step}</div>
            <div class="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center mb-4">
              <i class="fas ${s.icon} text-white text-xl"></i>
            </div>
            <h3 class="font-bold text-xl text-white mb-2">${s.title}</h3>
            <p class="text-green-200 text-sm leading-relaxed">${s.desc}</p>
          </div>
        </div>
      `).join('')}
    </div>
  </section>

  <!-- Featured Listings — real D1 -->
  <section class="py-16 bg-charcoal-100 border-y border-white/5">
    <div class="max-w-7xl mx-auto px-4">
      <div class="flex items-center justify-between mb-10">
        <div>
          <span class="text-indigo-400 text-sm font-semibold uppercase tracking-widest">Trending Now</span>
          <h2 class="text-3xl md:text-4xl font-black mt-2">Popular Parking Spots</h2>
        </div>
        <a href="/search" class="hidden md:flex items-center gap-2 text-indigo-400 hover:text-indigo-300 font-medium text-sm transition-colors">
          View All <i class="fas fa-arrow-right"></i>
        </a>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        ${featuredHTML}
      </div>
    </div>
  </section>

  <!-- Earnings Calculator -->
  <section class="py-24 max-w-7xl mx-auto px-4">
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
      <div>
        <span class="text-lime-500 text-sm font-semibold uppercase tracking-widest">For Hosts</span>
        <h2 class="text-4xl md:text-5xl font-black mt-3 mb-6 leading-tight">
          How Much Can <br/><span class="gradient-text">Your Space Earn?</span>
        </h2>
        <p class="text-gray-400 text-lg mb-8 leading-relaxed">
          Hosts earn passive income from their unused parking space. Earnings vary by location, type, and availability.
        </p>
        <div class="space-y-4">
          ${[
            { label: 'Driveway',     icon: 'fa-home' },
            { label: 'Garage',       icon: 'fa-warehouse' },
            { label: 'Lot Space',    icon: 'fa-parking' },
            { label: 'Airport Spot', icon: 'fa-plane' },
          ].map(e => `
            <div class="flex items-center gap-4 p-4 bg-charcoal-100 rounded-xl border border-white/5 hover:border-lime-500/30 transition-all">
              <div class="w-10 h-10 bg-lime-500/10 rounded-xl flex items-center justify-center flex-shrink-0">
                <i class="fas ${e.icon} text-lime-500"></i>
              </div>
              <span class="text-white font-medium flex-1">${e.label}</span>
              <span class="text-lime-500 font-bold text-sm">Varies by location</span>
            </div>
          `).join('')}
        </div>
        <a href="/host" class="btn-lime inline-flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-lg mt-8">
          <i class="fas fa-rocket"></i>
          Start Earning Today
        </a>
      </div>

      <div class="glass rounded-3xl p-8 border border-white/10">
        <h3 class="text-xl font-bold text-white mb-6 flex items-center gap-2">
          <i class="fas fa-calculator text-lime-500"></i>
          Earnings Calculator
        </h3>
        <div class="space-y-6">
          <div>
            <label class="text-sm text-gray-400 font-medium block mb-2">Space Type</label>
            <select id="calc-type" onchange="calcEarnings()" class="w-full bg-charcoal-100 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500 appearance-none">
              <option value="4">Driveway</option>
              <option value="8">Garage</option>
              <option value="6">Lot Space</option>
              <option value="12">Airport Adjacent</option>
            </select>
          </div>
          <div>
            <label class="text-sm text-gray-400 font-medium flex justify-between mb-2">
              <span>Hours Available Per Day</span>
              <span class="text-white font-bold" id="hours-label">8 hrs</span>
            </label>
            <input type="range" id="calc-hours" min="2" max="24" value="8" oninput="calcEarnings()" class="w-full accent-indigo-500"/>
          </div>
          <div>
            <label class="text-sm text-gray-400 font-medium flex justify-between mb-2">
              <span>Days Available Per Week</span>
              <span class="text-white font-bold" id="days-label">5 days</span>
            </label>
            <input type="range" id="calc-days" min="1" max="7" value="5" oninput="calcEarnings()" class="w-full accent-indigo-500"/>
          </div>
          <div class="bg-gradient-to-br from-indigo-600/20 to-lime-500/10 rounded-2xl p-6 border border-indigo-500/20">
            <p class="text-gray-400 text-sm mb-1">Estimated Monthly Earnings</p>
            <p class="text-5xl font-black text-white" id="calc-result">$384</p>
            <p class="text-gray-400 text-xs mt-2">After ParkPeer 15% service fee</p>
            <div class="grid grid-cols-2 gap-3 mt-4">
              <div class="bg-black/20 rounded-xl p-3 text-center">
                <p class="text-gray-400 text-xs">Weekly</p>
                <p class="font-bold text-white" id="calc-weekly">$96</p>
              </div>
              <div class="bg-black/20 rounded-xl p-3 text-center">
                <p class="text-gray-400 text-xs">Yearly</p>
                <p class="font-bold text-lime-500" id="calc-yearly">$4,608</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- City Coverage — real D1 -->
  <section class="py-16 bg-charcoal-100 border-y border-white/5">
    <div class="max-w-7xl mx-auto px-4">
      <div class="text-center mb-12">
        <span class="text-indigo-400 text-sm font-semibold uppercase tracking-widest">Coverage</span>
        <h2 class="text-3xl md:text-4xl font-black mt-3">Available In Your City</h2>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-${Math.min(cityRows.length || 4, 8)} gap-4">
        ${cityHTML}
      </div>
    </div>
  </section>

  <!-- Testimonials removed — replaced with live reviews on listing pages -->

  <!-- Safety Section -->
  <section class="py-16 bg-charcoal-100 border-y border-white/5">
    <div class="max-w-7xl mx-auto px-4">
      <div class="text-center mb-12">
        <span class="text-green-400 text-sm font-semibold uppercase tracking-widest">Trust & Safety</span>
        <h2 class="text-3xl md:text-4xl font-black mt-3">Built for Safety First</h2>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        ${[
          { icon:'fa-id-card',        title:'ID Verification',    desc:'Every host undergoes identity verification before listing their first space.',               color:'bg-blue-500/10 text-blue-400' },
          { icon:'fa-shield-halved',  title:'Host Protection',    desc:'$1M property damage protection included with every booking on our platform.',             color:'bg-green-500/10 text-green-400' },
          { icon:'fa-credit-card',    title:'Secure Payments',    desc:'All transactions processed via Stripe. Your financial data is never stored on our servers.', color:'bg-indigo-500/10 text-indigo-400' },
          { icon:'fa-star',           title:'Rating System',      desc:'Transparent two-way reviews after every booking. Drivers and hosts rate each other.',       color:'bg-amber-500/10 text-amber-400' },
          { icon:'fa-phone',          title:'24/7 Support',       desc:'Real humans available around the clock via chat, email, or phone for any issue.',            color:'bg-purple-500/10 text-purple-400' },
          { icon:'fa-qrcode',         title:'QR Check-In',        desc:'Contactless check-in with unique QR codes. No key exchanges, no awkward meetings.',          color:'bg-lime-500/10 text-lime-500' },
        ].map(s => `
          <div class="p-6 rounded-2xl bg-charcoal-200 border border-white/5 card-hover">
            <div class="w-12 h-12 ${s.color} rounded-xl flex items-center justify-center mb-4">
              <i class="fas ${s.icon} text-xl"></i>
            </div>
            <h3 class="font-bold text-white text-lg mb-2">${s.title}</h3>
            <p class="text-gray-400 text-sm leading-relaxed">${s.desc}</p>
          </div>
        `).join('')}
      </div>
    </div>
  </section>

  <!-- CTA Section -->
  <section class="py-24 max-w-7xl mx-auto px-4">
    <div class="relative gradient-bg rounded-3xl p-12 md:p-16 text-center overflow-hidden">
      <div class="absolute inset-0 map-bg opacity-10"></div>
      <div class="absolute top-0 right-0 w-64 h-64 bg-lime-500/10 rounded-full blur-3xl"></div>
      <div class="relative z-10">
        <h2 class="text-4xl md:text-6xl font-black text-white mb-4">Own the Curb.</h2>
        <p class="text-indigo-200 text-xl mb-10 max-w-lg mx-auto">
          Join drivers and hosts who've discovered smarter parking.
        </p>
        <div class="flex flex-col sm:flex-row gap-4 justify-center">
          <a href="/auth/signup" class="btn-lime inline-flex items-center justify-center gap-3 px-8 py-4 rounded-2xl font-bold text-lg">
            <i class="fas fa-rocket"></i>
            Get Started Free
          </a>
          <a href="/search" class="inline-flex items-center justify-center gap-3 px-8 py-4 rounded-2xl font-bold text-lg bg-white/10 text-white hover:bg-white/20 transition-all border border-white/20">
            <i class="fas fa-search"></i>
            Browse Spots
          </a>
        </div>
        <p class="text-indigo-300 text-sm mt-6">No credit card required · Free to list · No hidden fees</p>
      </div>
    </div>
  </section>

  <script>
    function switchTab(type) {
      const ds = document.getElementById('driver-steps');
      const hs = document.getElementById('host-steps');
      const db = document.getElementById('tab-driver');
      const hb = document.getElementById('tab-host');
      if (type === 'driver') {
        ds.classList.remove('hidden'); hs.classList.add('hidden');
        db.className = 'tab-btn px-6 py-3 rounded-full font-semibold text-sm transition-all bg-indigo-500 text-white';
        hb.className = 'tab-btn px-6 py-3 rounded-full font-semibold text-sm transition-all bg-charcoal-200 text-gray-400 hover:text-white border border-white/10';
      } else {
        hs.classList.remove('hidden'); ds.classList.add('hidden');
        hb.className = 'tab-btn px-6 py-3 rounded-full font-semibold text-sm transition-all bg-lime-500 text-charcoal font-bold';
        db.className = 'tab-btn px-6 py-3 rounded-full font-semibold text-sm transition-all bg-charcoal-200 text-gray-400 hover:text-white border border-white/10';
      }
    }

    function toggleFavorite(id) {
      const icon = document.getElementById('fav-' + id);
      if (icon) { icon.classList.toggle('text-red-500'); icon.classList.toggle('text-white/60'); }
    }

    function calcEarnings() {
      const type  = parseInt(document.getElementById('calc-type').value);
      const hours = parseInt(document.getElementById('calc-hours').value);
      const days  = parseInt(document.getElementById('calc-days').value);
      document.getElementById('hours-label').textContent = hours + ' hrs';
      document.getElementById('days-label').textContent  = days + ' days';
      const weekly  = type * hours * days * 0.65 * 0.85;
      const monthly = weekly * 4.33;
      const yearly  = monthly * 12;
      document.getElementById('calc-result').textContent = '$' + Math.round(monthly).toLocaleString();
      document.getElementById('calc-weekly').textContent = '$' + Math.round(weekly).toLocaleString();
      document.getElementById('calc-yearly').textContent = '$' + Math.round(yearly).toLocaleString();
    }

    function searchParking() {
      const loc  = document.getElementById('hero-location').value;
      const date = document.getElementById('hero-date').value;
      let url = '/search';
      const p = new URLSearchParams();
      if (loc)  p.set('q', loc);
      if (date) p.set('date', date);
      if (p.toString()) url += '?' + p.toString();
      window.location.href = url;
    }

    calcEarnings();
    const today = new Date().toISOString().split('T')[0];
    const di = document.getElementById('hero-date');
    if (di) { di.min = today; di.value = today; }

    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('slide-up'); });
    }, { threshold: 0.1 });
    document.querySelectorAll('.card-hover').forEach(el => observer.observe(el));
  </script>
  `
  return c.html(Layout('Find & List Parking Near You', content))
})
