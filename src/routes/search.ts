import { Hono } from 'hono'
import { Layout } from '../components/layout'

export const searchPage = new Hono()

searchPage.get('/', (c) => {
  const q    = c.req.query('q') || ''
  const city = c.req.query('city') || ''

  const content = `
  <div class="pt-16 flex h-screen overflow-hidden">

    <!-- ══════════════════════════════════════════
         LEFT PANEL: Filters + Live Listing Results
         ══════════════════════════════════════════ -->
    <div class="w-full lg:w-[480px] xl:w-[520px] flex flex-col border-r border-white/10 overflow-hidden flex-shrink-0">

      <!-- Search Header -->
      <div class="p-4 border-b border-white/10 bg-charcoal flex-shrink-0">

        <!-- Search Bar with Geocoding -->
        <div class="relative mb-3">
          <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-indigo-400 text-sm"></i>
          <input type="text" id="search-input" value="${q || city}"
            placeholder="City, address, neighborhood, airport..."
            class="w-full bg-charcoal-100 border border-white/10 rounded-xl pl-9 pr-20 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-all"/>
          <button onclick="performSearch()"
            class="absolute right-2 top-1/2 -translate-y-1/2 btn-primary px-3 py-1.5 rounded-lg text-xs text-white font-medium">
            Search
          </button>
        </div>

        <!-- Date + Duration -->
        <div class="grid grid-cols-2 gap-2 mb-3">
          <div class="bg-charcoal-100 border border-white/10 rounded-xl px-3 py-2.5 flex items-center gap-2">
            <i class="fas fa-calendar text-indigo-400 text-xs flex-shrink-0"></i>
            <input type="date" id="filter-date"
              class="bg-transparent text-white text-xs flex-1 focus:outline-none"/>
          </div>
          <div class="bg-charcoal-100 border border-white/10 rounded-xl px-3 py-2.5 flex items-center gap-2">
            <i class="fas fa-clock text-indigo-400 text-xs flex-shrink-0"></i>
            <select id="filter-duration"
              class="bg-transparent text-white text-xs flex-1 focus:outline-none appearance-none">
              <option value="1">1 hour</option>
              <option value="2">2 hours</option>
              <option value="4">4 hours</option>
              <option value="8">8 hours</option>
              <option value="24">Full day</option>
              <option value="168">Weekly</option>
              <option value="720">Monthly</option>
            </select>
          </div>
        </div>

        <!-- Filter Pills -->
        <div class="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <button onclick="setTypeFilter('all', this)" data-filter="all"
            class="filter-pill active-pill flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-indigo-500 text-white transition-all whitespace-nowrap">
            All Types
          </button>
          <button onclick="setTypeFilter('driveway', this)" data-filter="driveway"
            class="filter-pill flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-charcoal-200 text-gray-400 hover:text-white border border-white/10 transition-all whitespace-nowrap">
            <i class="fas fa-home mr-1"></i> Driveway
          </button>
          <button onclick="setTypeFilter('garage', this)" data-filter="garage"
            class="filter-pill flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-charcoal-200 text-gray-400 hover:text-white border border-white/10 transition-all whitespace-nowrap">
            <i class="fas fa-warehouse mr-1"></i> Garage
          </button>
          <button onclick="setTypeFilter('lot', this)" data-filter="lot"
            class="filter-pill flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-charcoal-200 text-gray-400 hover:text-white border border-white/10 transition-all whitespace-nowrap">
            <i class="fas fa-parking mr-1"></i> Lot
          </button>
          <button onclick="setTypeFilter('covered', this)" data-filter="covered"
            class="filter-pill flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-charcoal-200 text-gray-400 hover:text-white border border-white/10 transition-all whitespace-nowrap">
            <i class="fas fa-shield mr-1"></i> Covered
          </button>
          <button onclick="openFilterModal()"
            class="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-charcoal-200 text-gray-400 hover:text-white border border-white/10 transition-all flex items-center gap-1 whitespace-nowrap">
            <i class="fas fa-sliders"></i> More Filters
          </button>
        </div>
      </div>

      <!-- Results Header -->
      <div class="px-4 py-3 flex items-center justify-between border-b border-white/5 flex-shrink-0 bg-charcoal">
        <p class="text-sm text-gray-400" id="results-count">
          <span class="inline-flex items-center gap-1.5">
            <span class="w-2 h-2 bg-lime-500 rounded-full animate-pulse"></span>
            <span class="text-white font-semibold" id="count-num">Loading</span>
            <span id="count-label">spots nearby</span>
          </span>
        </p>
        <select id="sort-select" onchange="sortListings(this.value)"
          class="bg-transparent text-gray-400 text-xs focus:outline-none cursor-pointer hover:text-white transition-colors">
          <option value="rating">Best Match</option>
          <option value="price_asc">Price: Low to High</option>
          <option value="price_desc">Price: High to Low</option>
          <option value="reviews">Most Reviewed</option>
        </select>
      </div>

      <!-- Listing Results (dynamically populated) -->
      <div class="flex-1 overflow-y-auto p-4 space-y-3" id="listings-container">
        <!-- Loading skeleton -->
        <div id="loading-skeleton" class="space-y-3">
          ${Array(4).fill(0).map(() => `
            <div class="bg-charcoal-100 rounded-2xl overflow-hidden animate-pulse">
              <div class="flex gap-0">
                <div class="w-28 h-28 bg-charcoal-300 flex-shrink-0"></div>
                <div class="flex-1 p-3 space-y-2">
                  <div class="h-4 bg-charcoal-300 rounded w-3/4"></div>
                  <div class="h-3 bg-charcoal-300 rounded w-1/2"></div>
                  <div class="h-3 bg-charcoal-300 rounded w-2/3"></div>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
        <div id="no-results" class="hidden text-center py-16">
          <div class="w-16 h-16 bg-charcoal-200 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <i class="fas fa-parking text-2xl text-gray-500"></i>
          </div>
          <p class="text-white font-bold mb-1">No spots found</p>
          <p class="text-gray-500 text-sm">Try adjusting your filters or searching a different area</p>
        </div>
        <div id="prompt-location" class="hidden text-center py-16">
          <div class="w-16 h-16 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <i class="fas fa-search-location text-2xl text-indigo-400"></i>
          </div>
          <p class="text-white font-bold mb-1">Search for parking</p>
          <p class="text-gray-500 text-sm mb-4">Enter a city, address, or neighborhood above to find spots near you</p>
          <button onclick="locateUser()" class="inline-flex items-center gap-2 px-4 py-2 bg-indigo-500/20 border border-indigo-500/30 rounded-xl text-indigo-300 text-sm font-medium hover:bg-indigo-500/30 transition-colors">
            <i class="fas fa-crosshairs"></i> Use my current location
          </button>
        </div>
      </div>
    </div>

    <!-- ══════════════════════════════════════════
         RIGHT PANEL: Real Mapbox Map
         ══════════════════════════════════════════ -->
    <div class="hidden lg:flex flex-1 relative" id="map-panel">
      <!-- Mapbox GL map fills this container -->
      <div id="map" class="absolute inset-0 w-full h-full"></div>

      <!-- Spots in view overlay -->
      <div class="absolute top-4 left-4 z-10 glass rounded-xl px-4 py-2 pointer-events-none">
        <p class="text-white text-sm font-semibold">
          <i class="fas fa-parking text-indigo-400 mr-2"></i>
          <span id="map-spot-count">0</span> spots in view
        </p>
      </div>

      <!-- Map style toggle -->
      <div class="absolute top-4 right-4 z-10 flex gap-2">
        <button onclick="setMapStyle('dark')" id="btn-dark"
          class="glass px-3 py-1.5 rounded-xl text-xs text-white font-medium hover:bg-white/10 transition-colors active-map-btn">
          <i class="fas fa-moon mr-1"></i>Dark
        </button>
        <button onclick="setMapStyle('street')" id="btn-street"
          class="glass px-3 py-1.5 rounded-xl text-xs text-white font-medium hover:bg-white/10 transition-colors">
          <i class="fas fa-map mr-1"></i>Street
        </button>
        <button onclick="setMapStyle('satellite')" id="btn-satellite"
          class="glass px-3 py-1.5 rounded-xl text-xs text-white font-medium hover:bg-white/10 transition-colors">
          <i class="fas fa-satellite mr-1"></i>Satellite
        </button>
      </div>

      <!-- Locate Me button -->
      <div class="absolute bottom-4 right-4 z-10 flex flex-col gap-2">
        <button onclick="locateUser()"
          class="w-10 h-10 glass rounded-xl flex items-center justify-center text-white hover:bg-white/10 transition-colors" title="Find my location">
          <i class="fas fa-crosshairs text-sm"></i>
        </button>
      </div>

      <!-- Map loading overlay -->
      <div id="map-loading" class="absolute inset-0 bg-charcoal flex items-center justify-center z-20">
        <div class="text-center">
          <div class="w-12 h-12 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p class="text-gray-400 text-sm">Loading map...</p>
        </div>
      </div>

      <!-- No listings overlay (shown over the map when API returns 0 results) -->
      <div id="map-no-listings" class="hidden absolute inset-0 bg-charcoal/80 backdrop-blur-sm flex items-center justify-center z-10 pointer-events-none">
        <div class="text-center px-6">
          <div class="w-16 h-16 bg-indigo-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <i class="fas fa-map-marker-alt text-indigo-400 text-2xl"></i>
          </div>
          <p class="text-white font-semibold text-lg">No listings available yet.</p>
          <p class="text-gray-400 text-sm mt-1">Be the first to list your space!</p>
        </div>
      </div>
    </div>
  </div>

  <!-- ══════════════════════════════════════════
       LISTING POPUP (shown on map pin click)
       ══════════════════════════════════════════ -->
  <div id="listing-popup" class="hidden fixed bottom-4 left-4 z-50 lg:absolute lg:bottom-20 lg:left-4 bg-charcoal-100 border border-white/10 rounded-2xl shadow-2xl p-4 w-72 transition-all">
    <button onclick="closePopup()" class="absolute top-2 right-2 w-6 h-6 bg-charcoal-200 rounded-full flex items-center justify-center text-gray-400 hover:text-white text-xs">
      <i class="fas fa-times"></i>
    </button>
    <div id="popup-content"></div>
  </div>

  <!-- ══════════════════════════════════════════
       ADVANCED FILTER MODAL
       ══════════════════════════════════════════ -->
  <div id="filter-modal" class="hidden fixed inset-0 bg-black/70 z-50 flex items-end md:items-center justify-center p-4">
    <div class="bg-charcoal-100 rounded-3xl w-full max-w-lg border border-white/10 overflow-hidden">
      <div class="flex items-center justify-between p-6 border-b border-white/10">
        <h3 class="text-xl font-bold text-white">Advanced Filters</h3>
        <button onclick="closeFilterModal()"
          class="w-8 h-8 bg-charcoal-200 rounded-full flex items-center justify-center text-gray-400 hover:text-white transition-colors">
          <i class="fas fa-times text-sm"></i>
        </button>
      </div>
      <div class="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
        <!-- Price Range -->
        <div>
          <h4 class="font-semibold text-white mb-3 flex items-center justify-between">
            Hourly Rate
            <span class="text-indigo-400 text-sm font-normal" id="price-range-label">Any price</span>
          </h4>
          <div class="flex gap-3">
            <div class="flex-1">
              <label class="text-xs text-gray-500 mb-1 block">Min $/hr</label>
              <input type="number" id="min-price" value="" min="1" max="50" placeholder="Any"
                class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"/>
            </div>
            <div class="flex-1">
              <label class="text-xs text-gray-500 mb-1 block">Max $/hr</label>
              <input type="number" id="max-price" value="" min="1" max="200" placeholder="Any"
                class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"/>
            </div>
          </div>
        </div>
        <!-- Radius -->
        <div>
          <h4 class="font-semibold text-white mb-3 flex items-center justify-between">
            Search Radius
            <span class="text-indigo-400 text-sm font-normal" id="radius-label">50 km</span>
          </h4>
          <input type="range" id="radius-range" min="1" max="200" step="1" value="50"
            oninput="document.getElementById('radius-label').textContent=this.value+' km'"
            class="w-full accent-indigo-500"/>
        </div>
        <!-- Amenities -->
        <div>
          <h4 class="font-semibold text-white mb-3">Amenities</h4>
          <div class="grid grid-cols-2 gap-2">
            ${[
              { key: 'covered',         label: 'Covered/Indoor',   icon: 'fa-umbrella' },
              { key: 'ev_charging',     label: 'EV Charging',      icon: 'fa-bolt' },
              { key: 'security_camera', label: 'CCTV Camera',      icon: 'fa-video' },
              { key: 'gated',           label: 'Gated Access',     icon: 'fa-lock' },
              { key: 'lighting',        label: 'Lighting',         icon: 'fa-lightbulb' },
              { key: '24hr_access',     label: '24/7 Access',      icon: 'fa-clock' },
              { key: 'shuttle',         label: 'Shuttle Service',  icon: 'fa-bus' },
            ].map(a => `
              <label class="flex items-center gap-3 p-3 bg-charcoal-200 rounded-xl cursor-pointer hover:border-indigo-500/30 border border-white/5 transition-all">
                <input type="checkbox" value="${a.key}" class="amenity-check accent-indigo-500 w-4 h-4"/>
                <i class="fas ${a.icon} text-indigo-400 w-4 text-center"></i>
                <span class="text-sm text-gray-300">${a.label}</span>
              </label>
            `).join('')}
          </div>
        </div>
        <!-- Vehicle Size -->
        <div>
          <h4 class="font-semibold text-white mb-3">Vehicle Size</h4>
          <div class="grid grid-cols-3 gap-2">
            ${[
              { size: 'motorcycle', label: 'Motorcycle', icon: '🏍️' },
              { size: 'sedan',      label: 'Sedan',      icon: '🚗' },
              { size: 'suv',        label: 'SUV',        icon: '🚙' },
              { size: 'truck',      label: 'Truck',      icon: '🛻' },
            ].map(v => `
              <button onclick="toggleVehicle(this, '${v.size}')"
                data-size="${v.size}"
                class="vehicle-btn p-3 bg-charcoal-200 border border-white/5 hover:border-indigo-500/40 rounded-xl text-center transition-all group">
                <span class="text-2xl block mb-1">${v.icon}</span>
                <span class="text-xs text-gray-400 group-hover:text-white">${v.label}</span>
              </button>
            `).join('')}
          </div>
        </div>
        <!-- Booking Options -->
        <div>
          <h4 class="font-semibold text-white mb-3">Booking Options</h4>
          <div class="space-y-2">
            <label class="flex items-center justify-between p-3 bg-charcoal-200 rounded-xl cursor-pointer border border-white/5">
              <span class="text-sm text-gray-300 flex items-center gap-2"><i class="fas fa-bolt text-lime-500"></i> Instant Book Only</span>
              <input type="checkbox" id="instant-only" class="accent-indigo-500 w-4 h-4"/>
            </label>
          </div>
        </div>
      </div>
      <div class="p-4 border-t border-white/10 flex gap-3">
        <button onclick="resetFilters()"
          class="flex-1 py-3 bg-charcoal-200 text-gray-400 rounded-xl font-semibold text-sm hover:text-white transition-colors">
          Reset All
        </button>
        <button onclick="applyFiltersAndClose()"
          class="flex-1 py-3 btn-primary text-white rounded-xl font-semibold text-sm">
          Apply Filters
        </button>
      </div>
    </div>
  </div>

  <!-- Mapbox GL JS -->
  <link href="https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css" rel="stylesheet"/>
  <script src="https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js"></script>

  <style>
    .mapboxgl-popup-content {
      background: #1a1a1a !important;
      border: 1px solid rgba(255,255,255,0.1) !important;
      border-radius: 16px !important;
      padding: 0 !important;
      color: #fff;
      box-shadow: 0 20px 40px rgba(0,0,0,0.6) !important;
    }
    .mapboxgl-popup-tip { display: none !important; }
    .mapboxgl-popup-close-button {
      color: #9ca3af;
      font-size: 18px;
      padding: 8px 12px;
    }
    .mapboxgl-popup-close-button:hover { color: #fff; background: transparent; }
    .mapboxgl-ctrl-group { background: rgba(26,26,26,0.9) !important; border: 1px solid rgba(255,255,255,0.1) !important; border-radius: 12px !important; }
    .mapboxgl-ctrl-group button { color: #fff !important; }
    .active-map-btn { background: rgba(91,46,255,0.3) !important; border: 1px solid rgba(91,46,255,0.5) !important; }
    .listing-card { cursor: pointer; transition: all 0.2s; }
    .listing-card:hover { border-color: rgba(91,46,255,0.4) !important; transform: translateY(-1px); }
    .listing-card.highlighted { border-color: rgba(91,46,255,0.6) !important; box-shadow: 0 0 0 2px rgba(91,46,255,0.2); }
    .park-pin {
      background: #5B2EFF;
      color: white;
      font-weight: 700;
      font-size: 11px;
      padding: 5px 8px;
      border-radius: 20px;
      border: 2px solid white;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s;
      font-family: 'Inter', sans-serif;
    }
    .park-pin:hover, .park-pin.active { background: #C6FF00 !important; color: #121212 !important; transform: scale(1.15); border-color: #C6FF00; }
    .scrollbar-hide::-webkit-scrollbar { display: none; }
  </style>

  <script>
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STATE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let map = null
  let allListings = []
  let activeMarkers = []
  let activePopup = null
  let currentType = 'all'
  let currentSort = 'rating'
  let selectedVehicles = []
  let mapCenter = { lat: 0, lng: 0 }  // Will be set by geolocation or search
  let mapRadius = 50
  let mapStyleId = 'dark-v11'

  let MAPBOX_TOKEN = ''

  const MAP_STYLES = {
    dark:      'mapbox://styles/mapbox/dark-v11',
    street:    'mapbox://styles/mapbox/streets-v12',
    satellite: 'mapbox://styles/mapbox/satellite-streets-v12'
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // INIT
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  document.addEventListener('DOMContentLoaded', async () => {
    // Set today's date
    const today = new Date().toISOString().split('T')[0]
    document.getElementById('filter-date').value = today
    document.getElementById('filter-date').min = today

    // Parse initial query
    const urlQ = new URLSearchParams(window.location.search)
    const qVal = urlQ.get('q') || urlQ.get('city') || ''
    if (qVal) document.getElementById('search-input').value = qVal

    // Fetch Mapbox token from server then init map
    try {
      const cfg = await fetch('/api/map/config').then(r => r.json())
      MAPBOX_TOKEN = cfg.mapbox_token || ''
    } catch(e) {}
    initMap()

    // Load listings based on initial search
    if (qVal) {
      await geocodeAndLoad(qVal)
    } else {
      // Try user's location first
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          pos => {
            mapCenter = { lat: pos.coords.latitude, lng: pos.coords.longitude }
            if (map) map.flyTo({ center: [mapCenter.lng, mapCenter.lat], zoom: 12 })
            loadListings()
          },
          () => showPromptLocation()  // User denied location — ask them to search
        )
      } else {
        showPromptLocation()  // No geolocation API — ask them to search
      }
    }
  })

  function showPromptLocation() {
    document.getElementById('loading-skeleton').style.display = 'none'
    document.getElementById('no-results').classList.add('hidden')
    document.getElementById('prompt-location').classList.remove('hidden')
    document.getElementById('count-num').textContent = '–'
    document.getElementById('count-label').textContent = 'enter a location'
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // MAP INIT
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function initMap() {
    if (typeof mapboxgl === 'undefined' || !MAPBOX_TOKEN) {
      // Graceful fallback: show styled static map visual with real pins
      const loadingEl = document.getElementById('map-loading')
      loadingEl.innerHTML = \`
        <div class="absolute inset-0 overflow-hidden" id="fallback-map"
          style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 30%, #0f3460 60%, #1a1a2e 100%);">
          <svg class="absolute inset-0 w-full h-full opacity-10" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">
                <path d="M 80 0 L 0 0 0 80" fill="none" stroke="#5B2EFF" stroke-width="1"/>
              </pattern>
              <pattern id="roads" width="240" height="240" patternUnits="userSpaceOnUse">
                <rect width="240" height="25" fill="#2a2a3a" opacity="0.9"/>
                <rect y="80" width="240" height="25" fill="#2a2a3a" opacity="0.9"/>
                <rect y="160" width="240" height="25" fill="#2a2a3a" opacity="0.9"/>
                <rect x="0" width="25" height="240" fill="#2a2a3a" opacity="0.9"/>
                <rect x="80" width="25" height="240" fill="#2a2a3a" opacity="0.9"/>
                <rect x="160" width="25" height="240" fill="#2a2a3a" opacity="0.9"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#roads)"/>
            <rect width="100%" height="100%" fill="url(#grid)"/>
          </svg>
          <div id="fallback-pins" class="absolute inset-0"></div>
          <div class="absolute bottom-4 left-4 glass rounded-xl px-3 py-2 text-xs text-gray-400">
            <i class="fas fa-info-circle text-indigo-400 mr-1"></i>
            Add MAPBOX_TOKEN to enable interactive map
          </div>
        </div>
      \`
      return
    }

    mapboxgl.accessToken = MAPBOX_TOKEN

    map = new mapboxgl.Map({
      container: 'map',
      style: MAP_STYLES.dark,
      center: [mapCenter.lng || -98.5795, mapCenter.lat || 39.8283],  // US center if no location yet
      zoom: mapCenter.lat ? 12 : 4,
      attributionControl: false
    })

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left')

    map.on('load', () => {
      document.getElementById('map-loading').style.display = 'none'
    })

    // Safety: if map takes >10s to load, remove the loading spinner anyway
    setTimeout(() => {
      const loader = document.getElementById('map-loading')
      if (loader && loader.style.display !== 'none') {
        loader.style.display = 'none'
      }
    }, 10000)

    // Update spot count when map moves
    map.on('moveend', updateMapSpotCount)
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // LOAD LISTINGS FROM REAL API
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async function loadListings() {
    document.getElementById('loading-skeleton').style.display = 'block'
    document.getElementById('no-results').classList.add('hidden')
    document.getElementById('prompt-location').classList.add('hidden')

    // Clear existing cards (but keep skeleton)
    const container = document.getElementById('listings-container')
    const existingCards = container.querySelectorAll('.listing-card')
    existingCards.forEach(c => c.remove())

    const params = new URLSearchParams({ limit: 100 })

    // Only apply geo filter when we have a real location (non-zero coords)
    if (mapCenter.lat !== 0 || mapCenter.lng !== 0) {
      params.set('lat', mapCenter.lat)
      params.set('lng', mapCenter.lng)
      params.set('radius_km', mapRadius)
    }

    if (currentType !== 'all') params.set('type', currentType)

    const minP = document.getElementById('min-price')?.value
    const maxP = document.getElementById('max-price')?.value
    if (minP) params.set('min_price', minP)
    if (maxP) params.set('max_price', maxP)

    if (document.getElementById('instant-only')?.checked) params.set('instant', '1')

    const q = document.getElementById('search-input').value.trim()
    if (q) params.set('q', q)

    try {
      const res = await fetch('/api/listings?' + params.toString())
      if (!res.ok) throw new Error('API returned ' + res.status)
      const data = await res.json()

      document.getElementById('loading-skeleton').style.display = 'none'

      if (!data.data || data.data.length === 0) {
        document.getElementById('no-results').classList.remove('hidden')
        document.getElementById('count-num').textContent = '0'
        document.getElementById('count-label').textContent = 'spots found'
        // Show the "No listings available yet" overlay on the map
        const mapOverlay = document.getElementById('map-no-listings')
        if (mapOverlay) mapOverlay.classList.remove('hidden')
        clearMarkers()
        return
      }

      // Hide map no-listings overlay when listings are present
      const mapOverlay = document.getElementById('map-no-listings')
      if (mapOverlay) mapOverlay.classList.add('hidden')

      allListings = data.data
      applySortAndRender()
    } catch (e) {
      console.error('Failed to load listings:', e)
      document.getElementById('loading-skeleton').style.display = 'none'
      document.getElementById('count-num').textContent = '!'
      document.getElementById('count-label').textContent = 'error loading'
      document.getElementById('no-results').classList.remove('hidden')
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SORT + RENDER
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function applySortAndRender() {
    let sorted = [...allListings]
    if (currentSort === 'price_asc')  sorted.sort((a, b) => a.price_hourly - b.price_hourly)
    if (currentSort === 'price_desc') sorted.sort((a, b) => b.price_hourly - a.price_hourly)
    if (currentSort === 'rating')     sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0))
    if (currentSort === 'reviews')    sorted.sort((a, b) => (b.review_count || 0) - (a.review_count || 0))

    document.getElementById('count-num').textContent = sorted.length
    document.getElementById('count-label').textContent = 'spots nearby'

    renderListingCards(sorted)
    renderMapPins(sorted)
    updateMapSpotCount()
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RENDER LISTING CARDS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function renderListingCards(listings) {
    const container = document.getElementById('listings-container')
    // Remove existing cards
    container.querySelectorAll('.listing-card').forEach(c => c.remove())

    if (listings.length === 0) {
      document.getElementById('no-results').classList.remove('hidden')
      return
    }
    document.getElementById('no-results').classList.add('hidden')

    listings.forEach((l, i) => {
      const card = document.createElement('a')
      card.href = '/listing/' + l.id
      card.className = 'listing-card block bg-charcoal-100 rounded-2xl border border-white/5 transition-all overflow-hidden group'
      card.dataset.id = l.id

      const type    = l.type || 'lot'
      const typeIcon= type === 'garage' ? 'fa-warehouse' : type === 'driveway' ? 'fa-home' : type === 'covered' ? 'fa-shield' : 'fa-parking'
      const badge   = l.instant_book ? { text: '⚡ Instant', cls: 'bg-lime-500 text-black' } :
                      l.rating >= 4.8  ? { text: '⭐ Top Rated', cls: 'bg-amber-500 text-black' } :
                      type === 'lot'   ? { text: '🅿️ ' + capitalize(type), cls: 'bg-indigo-500 text-white' } :
                                         { text: capitalize(type), cls: 'bg-charcoal-300 text-gray-300' }
      const amenitiesArr = l.amenities || []
      const tags = []
      if (amenitiesArr.includes('covered'))         tags.push('Covered')
      if (amenitiesArr.includes('ev_charging'))     tags.push('EV')
      if (amenitiesArr.includes('security_camera')) tags.push('CCTV')
      if (amenitiesArr.includes('gated'))           tags.push('Gated')
      if (amenitiesArr.includes('24hr_access'))     tags.push('24/7')
      if (amenitiesArr.includes('shuttle'))         tags.push('Shuttle')

      card.innerHTML = \`
        <div class="flex gap-0">
          <div class="w-28 h-28 bg-gradient-to-br from-charcoal-300 to-charcoal-400 flex items-center justify-center flex-shrink-0 relative overflow-hidden">
            <i class="fas \${typeIcon} text-3xl text-white/20"></i>
            <span class="\${badge.cls} text-xs font-bold absolute top-2 left-2 px-1.5 py-0.5 rounded-md">\${badge.text}</span>
          </div>
          <div class="flex-1 p-3 min-w-0">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <h3 class="font-bold text-white text-sm group-hover:text-indigo-300 transition-colors truncate">\${l.title}</h3>
                <p class="text-gray-500 text-xs flex items-center gap-1 mt-0.5 truncate">
                  <i class="fas fa-map-pin text-indigo-400 flex-shrink-0"></i> \${l.address}
                  \${l.city ? ', ' + l.city : ''}
                </p>
              </div>
              <div class="text-right flex-shrink-0">
                <p class="font-black text-white text-base">$\${(l.price_hourly || 0).toFixed(0)}<span class="text-gray-500 font-normal text-xs">/hr</span></p>
                \${l.price_daily ? '<p class="text-gray-500 text-xs">$' + l.price_daily.toFixed(0) + '/day</p>' : ''}
              </div>
            </div>
            <div class="flex items-center justify-between mt-2">
              <div class="flex items-center gap-1">
                <i class="fas fa-star text-amber-400 text-xs"></i>
                <span class="text-white text-xs font-semibold">\${(l.rating || 0).toFixed(1)}</span>
                <span class="text-gray-500 text-xs">(\${l.review_count || 0})</span>
              </div>
              <div class="flex gap-1 flex-wrap justify-end">
                \${tags.slice(0,3).map(t => '<span class="text-xs bg-charcoal-300 text-gray-400 px-1.5 py-0.5 rounded-md">' + t + '</span>').join('')}
              </div>
            </div>
          </div>
        </div>
      \`

      card.addEventListener('mouseenter', () => highlightPin(l.id))
      card.addEventListener('mouseleave', () => unhighlightPin(l.id))

      container.appendChild(card)
    })
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RENDER MAP PINS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function renderMapPins(listings) {
    clearMarkers()

    // No real Mapbox map? Use fallback visual pins
    if (!map || typeof mapboxgl === 'undefined' || !MAPBOX_TOKEN) {
      renderFallbackPins(listings)
      return
    }

    listings.forEach(l => {
      if (!l.lat || !l.lng) return

      const el = document.createElement('div')
      el.className = 'park-pin'
      el.dataset.id = l.id
      el.textContent = '$' + (l.price_hourly || 0).toFixed(0)

      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([l.lng, l.lat])
        .addTo(map)

      el.addEventListener('click', (e) => {
        e.stopPropagation()
        showPinPopup(l, marker)
      })

      activeMarkers.push({ marker, id: l.id, el })
    })

    // Fit map to all visible pins
    if (listings.length > 0 && map) {
      const validListings = listings.filter(l => l.lat && l.lng)
      if (validListings.length > 0) {
        const bounds = new mapboxgl.LngLatBounds()
        validListings.forEach(l => bounds.extend([l.lng, l.lat]))
        map.fitBounds(bounds, { padding: { top: 60, bottom: 60, left: 20, right: 60 }, maxZoom: 14, duration: 800 })
      }
    }
  }

  function renderFallbackPins(listings) {
    const container = document.getElementById('fallback-pins')
    if (!container) return
    container.innerHTML = ''

    const validListings = listings.filter(l => l.lat && l.lng)
    if (validListings.length === 0) return

    // Project lat/lng to x/y percentage within bounding box
    const lats = validListings.map(l => l.lat)
    const lngs = validListings.map(l => l.lng)
    const minLat = Math.min(...lats), maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
    const latRange = Math.max(maxLat - minLat, 0.05)
    const lngRange = Math.max(maxLng - minLng, 0.05)

    validListings.forEach((l, i) => {
      const xPct = 10 + ((l.lng - minLng) / lngRange) * 80
      const yPct = 10 + ((maxLat - l.lat) / latRange) * 80

      const pin = document.createElement('button')
      pin.className = 'park-pin absolute'
      pin.dataset.id = l.id
      pin.style.cssText = \`left:\${xPct.toFixed(1)}%;top:\${yPct.toFixed(1)}%;transform:translate(-50%,-100%)\`
      pin.textContent = '$' + (l.price_hourly || 0).toFixed(0)
      pin.addEventListener('click', () => {
        // Scroll to card in left panel
        const card = document.querySelector('[data-id="' + l.id + '"].listing-card')
        if (card) {
          card.classList.add('highlighted')
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          setTimeout(() => card.classList.remove('highlighted'), 2000)
        }
      })
      container.appendChild(pin)
    })

    // Update spot count
    document.getElementById('map-spot-count').textContent = validListings.length
  }

  function clearMarkers() {
    activeMarkers.forEach(m => m.marker.remove())
    activeMarkers = []
    if (activePopup) { activePopup.remove(); activePopup = null }
    // Clear fallback pins too
    const fb = document.getElementById('fallback-pins')
    if (fb) fb.innerHTML = ''
  }

  function highlightPin(id) {
    activeMarkers.forEach(m => {
      if (m.id == id) m.el.classList.add('active')
    })
  }
  function unhighlightPin(id) {
    activeMarkers.forEach(m => {
      if (m.id == id && !m.el._popupOpen) m.el.classList.remove('active')
    })
  }

  function showPinPopup(l, marker) {
    if (!map || typeof mapboxgl === 'undefined') return
    if (activePopup) activePopup.remove()

    const amenitiesArr = l.amenities || []
    const tags = []
    if (amenitiesArr.includes('covered'))         tags.push({ t: 'Covered',  i: 'fa-umbrella' })
    if (amenitiesArr.includes('ev_charging'))     tags.push({ t: 'EV',       i: 'fa-bolt' })
    if (amenitiesArr.includes('security_camera')) tags.push({ t: 'CCTV',     i: 'fa-video' })
    if (amenitiesArr.includes('gated'))           tags.push({ t: 'Gated',    i: 'fa-lock' })
    if (amenitiesArr.includes('24hr_access'))     tags.push({ t: '24/7',     i: 'fa-clock' })

    const popup = new mapboxgl.Popup({ offset: 10, maxWidth: '280px', closeButton: true })
      .setLngLat([l.lng, l.lat])
      .setHTML(\`
        <div class="p-4">
          <div class="flex items-start gap-2 mb-3">
            <div class="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
              <i class="fas \${l.type === 'garage' ? 'fa-warehouse' : l.type === 'driveway' ? 'fa-home' : 'fa-parking'} text-indigo-400"></i>
            </div>
            <div class="flex-1 min-w-0">
              <h4 class="font-bold text-white text-sm leading-tight mb-0.5 truncate">\${l.title}</h4>
              <p class="text-gray-400 text-xs truncate">\${l.address}\${l.city ? ', ' + l.city : ''}</p>
            </div>
          </div>
          <div class="flex items-center justify-between mb-3">
            <div>
              <span class="text-2xl font-black text-white">$\${(l.price_hourly||0).toFixed(0)}</span>
              <span class="text-gray-400 text-xs">/hr</span>
              \${l.price_daily ? '<span class="text-gray-500 text-xs ml-2">$' + l.price_daily.toFixed(0) + '/day</span>' : ''}
            </div>
            <div class="flex items-center gap-1">
              <i class="fas fa-star text-amber-400 text-xs"></i>
              <span class="text-white text-sm font-semibold">\${(l.rating||0).toFixed(1)}</span>
              <span class="text-gray-400 text-xs">(\${l.review_count||0})</span>
            </div>
          </div>
          \${tags.length > 0 ? '<div class="flex gap-1 flex-wrap mb-3">' + tags.slice(0,4).map(t => '<span class="text-xs bg-white/5 text-gray-400 px-2 py-0.5 rounded-full flex items-center gap-1"><i class=\\"fas ' + t.i + ' text-indigo-400 text-xs\\"></i>' + t.t + '</span>').join('') + '</div>' : ''}
          \${l.instant_book ? '<div class="flex items-center gap-1.5 mb-3"><span class="w-1.5 h-1.5 bg-lime-500 rounded-full"></span><span class="text-lime-400 text-xs font-semibold">Instant Book Available</span></div>' : ''}
          <a href="/listing/\${l.id}" class="block w-full py-2.5 btn-primary text-white text-center text-sm font-bold rounded-xl transition-all">
            View & Reserve
          </a>
        </div>
      \`)
      .addTo(map)

    activePopup = popup

    // Highlight the corresponding card
    const card = document.querySelector('[data-id="' + l.id + '"].listing-card')
    if (card) {
      card.classList.add('highlighted')
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }

    // Highlight marker
    highlightPin(l.id)

    popup.on('close', () => {
      if (card) card.classList.remove('highlighted')
      unhighlightPin(l.id)
      activePopup = null
    })
  }

  function updateMapSpotCount() {
    if (!map) return
    const bounds = map.getBounds()
    const inView = activeMarkers.filter(m => {
      const ll = m.marker.getLngLat()
      return bounds.contains(ll)
    }).length
    document.getElementById('map-spot-count').textContent = inView
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // GEOCODING: search by city/address name → coordinates
  // Uses Mapbox Geocoding API when token is available;
  // otherwise loads all listings with the text query filter.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async function geocodeAndLoad(query) {
    // If Mapbox token is available, use the geocoding API
    if (MAPBOX_TOKEN && MAPBOX_TOKEN.length > 20) {
      try {
        const r = await fetch(\`https://api.mapbox.com/geocoding/v5/mapbox.places/\${encodeURIComponent(query)}.json?access_token=\${MAPBOX_TOKEN}&types=place,address,neighborhood,poi&limit=1\`)
        const geo = await r.json()
        if (geo.features && geo.features.length > 0) {
          const [lng, lat] = geo.features[0].center
          mapCenter = { lat, lng }
          if (map) map.flyTo({ center: [lng, lat], zoom: 12, duration: 1000 })
          await loadListings()
          return
        }
      } catch(e) {}
    }

    // No geocoding available — just load with text query filter
    await loadListings()
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CONTROLS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function performSearch() {
    const q = document.getElementById('search-input').value.trim()
    if (q) {
      geocodeAndLoad(q)
    } else {
      loadListings()
    }
  }

  function setTypeFilter(type, btn) {
    currentType = type
    document.querySelectorAll('.filter-pill').forEach(b => {
      b.className = b.className
        .replace('bg-indigo-500 text-white', 'bg-charcoal-200 text-gray-400 hover:text-white border border-white/10')
      b.classList.remove('active-pill')
    })
    btn.className = btn.className
      .replace('bg-charcoal-200 text-gray-400 hover:text-white border border-white/10', 'bg-indigo-500 text-white')
    btn.classList.add('active-pill')
    loadListings()
  }

  function sortListings(val) {
    currentSort = val
    applySortAndRender()
  }

  function locateUser() {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(pos => {
      mapCenter = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      if (map) {
        map.flyTo({ center: [mapCenter.lng, mapCenter.lat], zoom: 13 })
        new mapboxgl.Marker({ color: '#C6FF00' })
          .setLngLat([mapCenter.lng, mapCenter.lat])
          .addTo(map)
      }
      loadListings()
    }, () => alert('Could not get your location. Please allow location access.'))
  }

  function setMapStyle(style) {
    if (!map) return
    map.setStyle(MAP_STYLES[style] || MAP_STYLES.dark)
    map.once('style.load', () => renderMapPins(allListings))
    document.querySelectorAll('[id^=btn-]').forEach(b => b.classList.remove('active-map-btn'))
    document.getElementById('btn-' + style)?.classList.add('active-map-btn')
  }

  function openFilterModal() {
    document.getElementById('filter-modal').classList.remove('hidden')
  }
  function closeFilterModal() {
    document.getElementById('filter-modal').classList.add('hidden')
  }
  function applyFiltersAndClose() {
    closeFilterModal()
    loadListings()
  }
  function resetFilters() {
    document.getElementById('min-price').value = ''
    document.getElementById('max-price').value = ''
    document.getElementById('instant-only').checked = false
    document.getElementById('radius-range').value = 50
    document.getElementById('radius-label').textContent = '50 km'
    document.querySelectorAll('.vehicle-btn').forEach(b => b.classList.remove('border-indigo-500', 'bg-indigo-500/20'))
    selectedVehicles = []
    mapRadius = 50
    closeFilterModal()
    loadListings()
  }
  function toggleVehicle(btn, size) {
    btn.classList.toggle('border-indigo-500')
    btn.classList.toggle('bg-indigo-500/20')
    if (selectedVehicles.includes(size)) {
      selectedVehicles = selectedVehicles.filter(s => s !== size)
    } else {
      selectedVehicles.push(size)
    }
  }

  function closePopup() {
    document.getElementById('listing-popup').classList.add('hidden')
  }

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
  }

  // Search on Enter key
  document.addEventListener('keypress', e => {
    if (e.key === 'Enter' && document.activeElement === document.getElementById('search-input')) {
      performSearch()
    }
  })
  </script>
  `

  return c.html(Layout('Find Parking Near You', content))
})
