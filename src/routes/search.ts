import { Hono } from 'hono'
import { Layout } from '../components/layout'
import { verifyUserToken } from '../middleware/security'

type Bindings = { USER_TOKEN_SECRET: string }

export const searchPage = new Hono<{ Bindings: Bindings }>()

searchPage.get('/', async (c) => {
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

        <!-- ── Walk Score Destination Input ── -->
        <div class="relative mb-3" id="walk-dest-row">
          <div class="flex items-center gap-2 bg-charcoal-100 border border-indigo-500/40 rounded-xl px-3 py-2.5 focus-within:border-indigo-500 transition-all">
            <i class="fas fa-location-dot text-lime-500 text-sm flex-shrink-0"></i>
            <input type="text" id="dest-input" placeholder="Where are you going? (for walk score)" autocomplete="off"
              class="bg-transparent text-white placeholder-gray-500 text-sm flex-1 focus:outline-none"/>
            <button id="dest-clear" onclick="clearDestination()" class="hidden text-gray-500 hover:text-white text-xs flex-shrink-0 transition-colors">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <!-- Autocomplete dropdown -->
          <div id="dest-suggestions" class="hidden absolute left-0 right-0 top-full mt-1 bg-charcoal-100 border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden"></div>
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

      <!-- Walk Score Banner (shown when destination is set) -->
      <div id="walk-banner" class="hidden px-4 py-2.5 bg-gradient-to-r from-lime-500/10 to-indigo-500/10 border-b border-lime-500/20 flex-shrink-0">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <i class="fas fa-person-walking text-lime-400 text-sm flex-shrink-0"></i>
            <span class="text-lime-300 text-xs font-semibold truncate" id="walk-banner-dest">Destination set</span>
          </div>
          <div id="walk-calc-status" class="text-gray-500 text-xs flex-shrink-0 flex items-center gap-1">
            <span id="walk-calc-spinner" class="hidden"><i class="fas fa-spinner fa-spin text-indigo-400"></i></span>
            <span id="walk-calc-label"></span>
          </div>
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
        <div class="flex items-center gap-2">
          <!-- Mobile map toggle — hidden on desktop -->
          <button onclick="toggleMobileMap()" id="mobile-map-btn"
            class="lg:hidden flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 transition-colors">
            <i class="fas fa-map text-xs"></i> Map
          </button>
          <select id="sort-select" onchange="sortListings(this.value)"
            class="bg-transparent text-gray-400 text-xs focus:outline-none cursor-pointer hover:text-white transition-colors">
            <option value="rating">Best Match</option>
            <option value="walk_score" id="sort-walk-option" class="hidden">🚶 Closest Walk</option>
            <option value="price_asc">Price: Low to High</option>
            <option value="price_desc">Price: High to Low</option>
            <option value="reviews">Most Reviewed</option>
            <option value="reliability">Most Reliable</option>
          </select>
        </div>
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

      <!-- Walk Score Compact Chips (best-walk hint + active route) -->
      <!-- best-walk-chip: transient toast shown after scores load -->
      <div id="best-walk-chip" class="hidden absolute top-14 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
        <div class="ws-chip ws-chip-best">
          <i class="fas fa-person-walking"></i>
          <span id="best-walk-chip-text">Best parking nearby</span>
        </div>
      </div>

      <!-- walk-route-panel: compact chip shown when a pin is selected -->
      <!-- FIX 2: UNIFIED route info pill — replaces walk-route-panel + route-info-label -->
      <!-- Only ONE pill exists. It is a CSS-positioned overlay (bottom-center).        -->
      <!-- A separate Mapbox-anchored marker (#route-pin-label) handles map position.   -->
      <div id="route-info-pill" class="hidden absolute z-20">
        <div class="rip-inner">
          <i class="fas fa-person-walking rip-icon"></i>
          <span id="rip-time">–</span>
          <span class="rip-sep">·</span>
          <span id="rip-dist">–</span>
          <span class="rip-sep">·</span>
          <span id="rip-price" class="rip-price"></span>
          <button id="rip-close" onclick="clearWalkRoute()" class="rip-close" aria-label="Close route">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>

      <!-- Map loading overlay -->
      <div id="map-loading" class="absolute inset-0 bg-charcoal flex items-center justify-center z-20">
        <div class="text-center">
          <div class="w-12 h-12 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p class="text-gray-400 text-sm">Loading map...</p>
        </div>
      </div>

      <!-- Top Hosts Widget -->
      <div id="top-hosts-widget" class="hidden absolute bottom-16 left-4 z-10 w-64">
        <div class="glass rounded-2xl border border-white/10 overflow-hidden">
          <button onclick="toggleTopHosts()" class="w-full px-4 py-2.5 flex items-center justify-between text-left">
            <span class="text-white text-xs font-bold"><i class="fas fa-crown text-amber-400 mr-1.5"></i>Top Hosts Nearby</span>
            <i id="top-hosts-chevron" class="fas fa-chevron-up text-gray-500 text-xs transition-transform"></i>
          </button>
          <div id="top-hosts-list" class="border-t border-white/10 px-3 py-2 space-y-2 text-xs"></div>
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
        <!-- Booking Options -->\n        <div>\n          <h4 class=\"font-semibold text-white mb-3\">Booking Options</h4>\n          <div class=\"space-y-2\">\n            <label class=\"flex items-center justify-between p-3 bg-charcoal-200 rounded-xl cursor-pointer border border-white/5\">\n              <span class=\"text-sm text-gray-300 flex items-center gap-2\"><i class=\"fas fa-bolt text-lime-500\"></i> Instant Book Only</span>\n              <input type=\"checkbox\" id=\"instant-only\" class=\"accent-indigo-500 w-4 h-4\"/>\n            </label>\n            <label class=\"flex items-center justify-between p-3 bg-charcoal-200 rounded-xl cursor-pointer border border-white/5\">\n              <span class=\"text-sm text-gray-300 flex items-center gap-2\"><i class=\"fas fa-layer-group text-green-400\"></i> Show Trusted Zones</span>\n              <input type=\"checkbox\" id=\"trusted-zones\" class=\"accent-green-500 w-4 h-4\" onchange=\"toggleTrustedZones(this.checked)\"/>\n            </label>\n          </div>\n        </div>\n        <!-- Reliability Filter -->\n        <div>\n          <h4 class=\"font-semibold text-white mb-1\">Minimum Reliability</h4>\n          <p class=\"text-xs text-gray-500 mb-3\">Show spots with at least X% reliability</p>\n          <div class=\"flex items-center gap-3\">\n            <input type=\"range\" id=\"pri-range\" min=\"0\" max=\"100\" step=\"5\" value=\"0\"\n              oninput=\"document.getElementById('pri-label').textContent = this.value > 0 ? this.value + '%' : 'Any'\"\n              class=\"flex-1 accent-green-500\"/>\n            <span class=\"text-indigo-300 text-sm font-bold w-10 text-right\" id=\"pri-label\">Any</span>\n          </div>\n        </div>
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
    /* ── Critical: prevent Mapbox marker wrapper from stretching ── */
    .mapboxgl-marker { width: fit-content !important; max-width: fit-content !important; }
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
      /* Transition shadow/color only — no transform transitions (would fight Mapbox positioning) */
      transition: box-shadow 0.15s ease, background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
      font-family: 'Inter', sans-serif;
      /* Prevent marker from stretching to map width */
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: fit-content;
      max-width: 120px;
      box-sizing: border-box;
    }
    /* Hover/active: shadow lift only — NO transform:scale (would shift Mapbox bottom-anchor) */
    .park-pin:hover:not(.pin-active-pulse) { box-shadow: 0 4px 14px rgba(0,0,0,0.55), 0 0 0 2px rgba(255,255,255,0.5); }
    .park-pin.active { background: #C6FF00 !important; color: #121212 !important; border-color: #C6FF00; box-shadow: 0 0 0 3px rgba(198,255,0,0.45), 0 4px 12px rgba(0,0,0,0.5); }
    .park-pin.pri-green  { background: #16a34a; }
    .park-pin.pri-blue   { background: #2563eb; }
    .park-pin.pri-yellow { background: #ca8a04; }
    .park-pin.pri-gray   { background: #6b7280; }
    .pri-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-left: 3px; vertical-align: middle; }
    .pri-dot-green  { background: #16a34a; }
    .pri-dot-blue   { background: #2563eb; }
    .pri-dot-yellow { background: #ca8a04; }
    .pri-dot-red    { background: #dc2626; }
    .pri-tooltip { position: relative; display: inline-block; }
    .pri-tooltip .pri-tip {
      visibility: hidden; opacity: 0; transition: opacity 0.2s;
      position: absolute; bottom: 125%; left: 50%; transform: translateX(-50%);
      background: #1a1a1a; border: 1px solid rgba(255,255,255,0.1);
      color: #e5e7eb; border-radius: 10px; padding: 8px 10px;
      font-size: 11px; line-height: 1.5; white-space: nowrap; z-index: 100;
      box-shadow: 0 8px 24px rgba(0,0,0,0.6);
      pointer-events: none;
    }
    .pri-tooltip:hover .pri-tip { visibility: visible; opacity: 1; }
    .badge-tooltip { position: relative; display: inline-block; cursor: default; }
    .badge-tooltip .badge-tip {
      visibility: hidden; opacity: 0; transition: opacity 0.2s 0.1s;
      position: absolute; bottom: 125%; left: 50%; transform: translateX(-50%);
      background: #1a1a1a; border: 1px solid rgba(255,255,255,0.1);
      color: #e5e7eb; border-radius: 8px; padding: 4px 8px;
      font-size: 11px; white-space: nowrap; z-index: 100;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      pointer-events: none;
    }
    .badge-tooltip:hover .badge-tip { visibility: visible; opacity: 1; }
    .scrollbar-hide::-webkit-scrollbar { display: none; }

    /* ── Walk Score Marker Pins ────────────────────────────── */
    .park-pin.walk-pin {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4px 9px 3px;
      gap: 0;
      width: fit-content;
      max-width: 80px;
      min-width: 44px;
      box-sizing: border-box;
      /* No transform — hover uses shadow lift only */
    }
    /* walk-pin hover/active: shadow lift only — no scale ever */
    .park-pin.walk-pin:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.55), 0 0 0 2px rgba(255,255,255,0.4) !important; }
    .park-pin.walk-pin.active { box-shadow: 0 0 0 3px rgba(198,255,0,0.5), 0 4px 12px rgba(0,0,0,0.5) !important; }
    .ws-time {
      font-size: 11px;
      font-weight: 900;
      line-height: 1.1;
      display: block;
    }
    .ws-price {
      font-size: 9px;
      font-weight: 600;
      opacity: 0.75;
      display: block;
      line-height: 1.1;
    }
    .ws-best-badge {
      font-size: 7px;
      font-weight: 900;
      letter-spacing: 0.05em;
      background: rgba(255,255,255,0.25);
      border-radius: 20px;
      padding: 1px 4px;
      margin-top: 2px;
      display: block;
      line-height: 1.2;
    }
    /* Tier colors */
    .park-pin.ws-green  { background: #16a34a; border-color: #22c55e; color: #fff; }
    .park-pin.ws-yellow { background: #a16207; border-color: #eab308; color: #fff; }
    .park-pin.ws-orange { background: #c2410c; border-color: #f97316; color: #fff; }
    .park-pin.ws-red    { background: #991b1b; border-color: #ef4444; color: #fff; }
    /* Best walk glow — NO transform:scale, glow only */
    .park-pin.ws-best {
      box-shadow: 0 0 0 3px rgba(34,197,94,0.6), 0 0 18px rgba(34,197,94,0.5), 0 2px 8px rgba(0,0,0,0.4) !important;
      border-color: #22c55e !important;
      z-index: 10;
    }
    .park-pin.ws-best:hover:not(.pin-active-pulse) {
      box-shadow: 0 0 0 4px rgba(34,197,94,0.7), 0 0 24px rgba(34,197,94,0.6), 0 4px 14px rgba(0,0,0,0.5) !important;
    }
    /* Walk card badge */
    .ws-card-badge {
      padding: 0 12px 8px;
    }
    .ws-card-badge-inner {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 20px;
      background: rgba(34,197,94,0.08);
      border: 1px solid rgba(34,197,94,0.2);
      color: #86efac;
    }
    .ws-card-badge-inner.ws-yellow { background: rgba(234,179,8,0.08); border-color: rgba(234,179,8,0.2); color: #fde68a; }
    .ws-card-badge-inner.ws-orange { background: rgba(249,115,22,0.08); border-color: rgba(249,115,22,0.2); color: #fed7aa; }
    .ws-card-badge-inner.ws-red    { background: rgba(239,68,68,0.08);  border-color: rgba(239,68,68,0.2);  color: #fca5a5; }
    .ws-card-badge-inner.ws-best   { background: rgba(34,197,94,0.14); border-color: rgba(34,197,94,0.4); color: #4ade80; box-shadow: 0 0 0 1px rgba(34,197,94,0.15); }
    .ws-best-label {
      background: #22c55e;
      color: #000;
      font-size: 9px;
      font-weight: 900;
      letter-spacing: 0.05em;
      padding: 1px 5px;
      border-radius: 20px;
      margin-left: 2px;
    }
    .ws-approx { opacity: 0.55; font-style: italic; }
    /* Destination input row */
    #dest-suggestions button:hover { background: rgba(99,102,241,0.08); }
    /* Walk route dashed line animation */
    @keyframes dashOffset { to { stroke-dashoffset: -20; } }

    /* ── Best-walk toast chip (auto-dismiss, not interactive) ── */
    .ws-chip-best {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 13px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
      white-space: nowrap;
      background: rgba(34,197,94,0.92);
      color: #000;
      pointer-events: none;
      box-shadow: 0 4px 16px rgba(0,0,0,0.45);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       UNIFIED ROUTE INFO PILL
       Key rules:
       • position/centering is ONLY in CSS (not Tailwind classes)
       • hidden = display:none so the element never occupies layout
       • NO transform in any animation — opacity-only fade
       ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    #route-info-pill {
      position: absolute;
      bottom: 6rem;          /* 96px from bottom of map */
      left: 50%;
      transform: translateX(-50%);   /* centering — never touched by JS or keyframes */
      z-index: 20;
      pointer-events: auto;
      /* opacity-only transition for show/hide — ZERO layout/transform change */
      opacity: 1;
      transition: opacity 0.18s ease;
    }
    #route-info-pill.hidden {
      display: none !important;  /* fully removed from layout when hidden */
    }
    .rip-inner {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 8px 14px;
      border-radius: 999px;
      background: rgba(12,12,12,0.90);
      border: 1px solid rgba(34,197,94,0.4);
      color: #fff;
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
      white-space: nowrap;
      max-width: 320px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.5), 0 0 0 1px rgba(34,197,94,0.12);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
    }
    .rip-icon  { color: #4ade80; font-size: 11px; flex-shrink: 0; }
    #rip-time  { font-weight: 800; font-size: 13px; color: #fff; }
    .rip-sep   { color: rgba(255,255,255,0.25); font-size: 10px; }
    #rip-dist  { color: #4ade80; font-weight: 700; font-size: 12px; }
    .rip-price { color: #c4b5fd; font-weight: 700; font-size: 11px; }
    .rip-close {
      margin-left: 4px;
      color: rgba(255,255,255,0.35);
      font-size: 10px;
      background: none;
      border: none;
      cursor: pointer;
      padding: 0 2px;
      line-height: 1;
      transition: color 0.15s;
      flex-shrink: 0;
    }
    .rip-close:hover { color: #fff; }
    @media (max-width: 767px) {
      #route-info-pill { bottom: 5rem; }
      .rip-inner { font-size: 11px; padding: 7px 12px; max-width: 88vw; }
      #rip-time  { font-size: 12px; }
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       ROUTE ANIMATION SYSTEM
       ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    /* ── 1. Route line glow pulse ── */
    /* ── 2. Pin pulse ring ── */
    @keyframes pinPulseRing {
      0%   { transform: scale(1);   opacity: 0.7; }
      70%  { transform: scale(2.4); opacity: 0;   }
      100% { transform: scale(2.4); opacity: 0;   }
    }
    /* ── Park pin pulse ring (::before only — body transform never changes) ── */
    .park-pin.pin-active-pulse {
      position: relative;
      z-index: 5;
    }
    .park-pin.pin-active-pulse::before {
      content: '';
      position: absolute;
      inset: -4px;
      border-radius: 50%;
      border: 2px solid currentColor;
      animation: pinPulseRing 1.5s ease-out infinite;
      will-change: transform, opacity;
      pointer-events: none;
    }

    /* ── Pill border flash on re-select (opacity+border only, no transform) ── */
    @keyframes ripFlash {
      0%,100% { border-color: rgba(34,197,94,0.4); }
      40%     { border-color: rgba(34,197,94,0.9); box-shadow: 0 6px 20px rgba(0,0,0,0.5), 0 0 0 4px rgba(34,197,94,0.25); }
    }
    .rip-inner.rip-flash {
      animation: ripFlash 0.45s ease-out both;
    }

    /* Reduced motion */
    @media (prefers-reduced-motion: reduce) {
      .park-pin.pin-active-pulse::before { animation: none !important; }
      .rip-inner.rip-flash               { animation: none !important; }
    }
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
  let trustedZonesEnabled = false
  let topHostsCollapsed = false
  let trustedZoneLayerAdded = false

  let MAPBOX_TOKEN = ''

  // ── WALK SCORE STATE ───────────────────────────────────────────────────────
  const WS = {
    destCoords: null,          // { lng, lat }
    destName: '',              // human-readable label
    scores: new Map(),         // listingId → { distanceM, durationS, source:'api'|'haversine' }
    closestId: null,           // id of closest listing
    activeRoute: null,         // { listingId, distanceM, durationS }
    destMarker: null,          // mapboxgl.Marker for destination pin
    calcQueue: [],             // listing ids awaiting calculation
    calcInFlight: 0,           // concurrent requests in flight
    calcDone: 0,               // completed this batch
    calcTotal: 0,              // total in batch
    debounceTimer: null,
    // Prevent recalc when destination hasn't meaningfully changed
    lastCalcDestKey: null
  }
  const WS_CONCURRENCY = 4    // max parallel Directions API calls
  const WS_MAX_SPOTS   = 20   // only compute for nearest N spots by haversine
  const WS_CACHE_TTL   = 5 * 60 * 1000  // 5 min cache
  const wsCache = new Map()   // key → { result, ts }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ROUTE ANIMATION ENGINE
  // Manages: route glow, pin pulse, info label, chip state
  // Does NOT touch routing logic or WS calculations.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const RA = {
    activeListingId : null,   // currently highlighted listing id
    glowTimer       : null,   // setInterval for Mapbox glow pulse
    // NOTE: No labelMarker — the bottom-center #route-info-pill is the one true pill.
    // A map-anchored Mapbox Marker was tried but its transform conflicts with
    // Mapbox's own positioning transforms, causing the pin to jump around the map.
    reducedMotion   : window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  // ── Colour config (uses existing brand palette) ───────────
  const RA_ACTIVE_COLOR   = '#22c55e'   // brand green (existing)
  const RA_INACTIVE_COLOR = '#4b5563'   // muted neutral (existing grey-600)
  const RA_GLOW_COLOR     = '#22c55e'

  // ── 1. ROUTE GLOW ─────────────────────────────────────────
  function raActivateGlow() {
    if (!map) return
    try {
      if (map.getLayer('walk-route-line')) {
        map.setPaintProperty('walk-route-line', 'line-width',   6)
        map.setPaintProperty('walk-route-line', 'line-opacity', 1)
        map.setPaintProperty('walk-route-line', 'line-color',   RA_ACTIVE_COLOR)
      }
      if (map.getLayer('walk-route-glow')) {
        map.setPaintProperty('walk-route-glow', 'line-width',   18)
        map.setPaintProperty('walk-route-glow', 'line-opacity', 0.28)
        map.setPaintProperty('walk-route-glow', 'line-blur',    10)
      }
      clearInterval(RA.glowTimer)
      if (!RA.reducedMotion) {
        let tick = 0
        RA.glowTimer = setInterval(() => {
          if (!map || !map.getLayer('walk-route-glow')) { clearInterval(RA.glowTimer); return }
          tick++
          map.setPaintProperty('walk-route-glow', 'line-opacity', (tick % 2 === 0) ? 0.28 : 0.14)
        }, 1000)
      }
    } catch(e) {}
  }

  function raDeactivateGlow() {
    clearInterval(RA.glowTimer)
    if (!map) return
    try {
      if (map.getLayer('walk-route-line')) {
        map.setPaintProperty('walk-route-line', 'line-width',   3.5)
        map.setPaintProperty('walk-route-line', 'line-opacity', 0.4)
        map.setPaintProperty('walk-route-line', 'line-color',   RA_INACTIVE_COLOR)
      }
      if (map.getLayer('walk-route-glow')) {
        map.setPaintProperty('walk-route-glow', 'line-width',   10)
        map.setPaintProperty('walk-route-glow', 'line-opacity', 0.08)
        map.setPaintProperty('walk-route-glow', 'line-blur',    6)
      }
    } catch(e) {}
  }

  // ── 2. PIN PULSE ──────────────────────────────────────────
  function raStartPinPulse(listingId) {
    if (RA.reducedMotion) return
    const m = activeMarkers.find(m => m.id == listingId)
    if (m) m.el.classList.add('pin-active-pulse')
  }

  function raStopPinPulse(listingId) {
    const m = activeMarkers.find(m => m.id == listingId)
    if (m) m.el.classList.remove('pin-active-pulse')
  }

  function raStopAllPinPulses() {
    activeMarkers.forEach(m => m.el.classList.remove('pin-active-pulse'))
  }

  // ── 3. UNIFIED ROUTE INFO PILL ────────────────────────────
  // Single bottom-center pill. No Mapbox-anchored marker — those conflict
  // with Mapbox's own transform-based positioning and cause the pin to jump.
  function raShowRoutePill(score, listing, listingId) {
    // Update content first (before making visible) — no flash of stale text
    _updateBottomPill(score, listing)

    const pill = document.getElementById('route-info-pill')
    if (!pill) return

    const wasHidden  = pill.classList.contains('hidden')
    const isReselect = !wasHidden && RA.activeListingId === listingId

    pill.classList.remove('hidden')

    // Only flash border on re-tap of same pin
    if (isReselect) {
      const inner = pill.querySelector('.rip-inner')
      if (inner) {
        inner.classList.remove('rip-flash')
        void inner.offsetWidth
        inner.classList.add('rip-flash')
        setTimeout(() => inner.classList.remove('rip-flash'), 500)
      }
    }
  }

  function _updateBottomPill(score, listing) {
    const pill = document.getElementById('route-info-pill')
    if (!pill) return
    const timeEl  = document.getElementById('rip-time')
    const distEl  = document.getElementById('rip-dist')
    const priceEl = document.getElementById('rip-price')
    if (timeEl)  timeEl.textContent  = fmtDur(score.durationS)
    if (distEl)  distEl.textContent  = fmtDist(score.distanceM)
    if (priceEl) priceEl.textContent = listing ? ('$' + (listing.price_hourly || 0).toFixed(0) + '/hr') : ''
  }

  function raHideRoutePill() {
    const pill = document.getElementById('route-info-pill')
    if (pill) pill.classList.add('hidden')
  }

  // ── 4. ORCHESTRATOR ───────────────────────────────────────
  function raActivateRoute(listingId, score, listing) {
    if (RA.activeListingId && RA.activeListingId !== listingId) {
      raStopPinPulse(RA.activeListingId)
    }
    RA.activeListingId = listingId

    // Debug: log route destination for stability verification
    if (WS.destCoords) {
      console.debug('[route] activated listing=' + listingId +
        ' destLng=' + WS.destCoords.lng.toFixed(5) +
        ' destLat=' + WS.destCoords.lat.toFixed(5) +
        ' dur=' + Math.round(score.durationS) + 's' +
        ' dist=' + Math.round(score.distanceM) + 'm')
    }

    raActivateGlow()
    raStartPinPulse(listingId)
    raShowRoutePill(score, listing, listingId)
  }

  function raDeactivateRoute() {
    raDeactivateGlow()
    raStopAllPinPulses()
    raHideRoutePill()
    RA.activeListingId = null
  }

  // Format meters → human string
  function fmtDist(m) {
    if (m < 160)  return Math.round(m) + ' m'
    const miles = m / 1609.34
    if (miles < 0.1) return Math.round(m) + ' m'
    return miles.toFixed(2) + ' mi'
  }
  // Format seconds → human string
  function fmtDur(s) {
    const m = Math.round(s / 60)
    if (m < 1)  return '< 1 min'
    if (m === 1) return '1 min'
    return m + ' min'
  }
  // Haversine fallback (returns metres)
  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000
    const toR = x => x * Math.PI / 180
    const dLat = toR(lat2 - lat1)
    const dLng = toR(lng2 - lng1)
    const a = Math.sin(dLat/2)**2 + Math.cos(toR(lat1))*Math.cos(toR(lat2))*Math.sin(dLng/2)**2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  }
  // Walk score color tier: green <3min, yellow 3-6min, orange 6-10min, red >10min
  function wsColor(durationS) {
    const m = durationS / 60
    if (m < 3)  return 'ws-green'
    if (m < 6)  return 'ws-yellow'
    if (m < 10) return 'ws-orange'
    return 'ws-red'
  }
  function wsColorHex(durationS) {
    const m = durationS / 60
    if (m < 3)  return '#22c55e'
    if (m < 6)  return '#eab308'
    if (m < 10) return '#f97316'
    return '#ef4444'
  }

  // PRI helpers
  function priColor(score) {
    if (score == null) return null
    if (score >= 95) return 'green'
    if (score >= 85) return 'blue'
    if (score >= 75) return 'yellow'
    return 'red'
  }
  function priDot(score) {
    if (score == null) return ''
    const color = priColor(score)
    return \`<span class="pri-dot pri-dot-\${color}"></span>\`
  }
  function priPinClass(score) {
    if (score == null) return ''
    if (score >= 95) return 'pri-green'
    if (score >= 85) return 'pri-blue'
    if (score >= 75) return 'pri-yellow'
    return 'pri-gray'
  }
  function hostBadges(host) {
    if (!host) return ''
    let badges = ''
    if (host.verified)    badges += \`<span class="badge-tooltip ml-1"><span style="color:#2563eb;font-size:12px">✓</span><span class="badge-tip">Identity Verified</span></span>\`
    if (host.secure)      badges += \`<span class="badge-tooltip ml-0.5"><span style="color:#16a34a;font-size:12px">🛡</span><span class="badge-tip">Secure Location</span></span>\`
    if (host.performance) badges += \`<span class="badge-tooltip ml-0.5"><span style="color:#d97706;font-size:12px">⭐</span><span class="badge-tip">High-Performance Host</span></span>\`
    if (host.founding)    badges += \`<span class="badge-tooltip ml-0.5"><span style="color:#7c3aed;font-size:12px">🏆</span><span class="badge-tip">Founding Member</span></span>\`
    return badges
  }

  const MAP_STYLES = {
    dark:      'mapbox://styles/mapbox/dark-v11',
    street:    'mapbox://styles/mapbox/streets-v12',
    satellite: 'mapbox://styles/mapbox/satellite-streets-v12'
  }

  // mapReady: resolves once Mapbox fires 'load' (or immediately for fallback)
  let _mapReadyResolve = null
  const mapReadyPromise = new Promise(res => { _mapReadyResolve = res })
  let pendingListings = null  // listings queued before map was ready

  function hideMapLoader() {
    const el = document.getElementById('map-loading')
    if (el) el.style.display = 'none'
  }
  function resolveMapReady() {
    if (_mapReadyResolve) { _mapReadyResolve(); _mapReadyResolve = null }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const today = new Date().toISOString().split('T')[0]
    document.getElementById('filter-date').value = today
    document.getElementById('filter-date').min = today

    const urlQ = new URLSearchParams(window.location.search)
    const qVal = urlQ.get('q') || urlQ.get('city') || ''
    if (qVal) document.getElementById('search-input').value = qVal

    // ── Route pill tap: re-trigger animations if tapped while route showing ──
    const routePillEl = document.getElementById('route-info-pill')
    if (routePillEl) {
      routePillEl.addEventListener('click', (e) => {
        // Don't re-trigger if the close button was clicked
        if (e.target.closest('#rip-close')) return
        if (WS.activeRoute) {
          const listing = allListings.find(l => l.id == WS.activeRoute.listingId)
          raActivateRoute(WS.activeRoute.listingId, WS.activeRoute, listing)
        }
      })
    }

    // Fetch Mapbox token then start map (non-blocking relative to listing fetch)
    try {
      const cfg = await fetch('/api/map/config').then(r => r.json())
      MAPBOX_TOKEN = cfg.mapbox_token || ''
    } catch(e) { console.warn('[map] config fetch failed:', e) }
    initMap()

    // Load listings immediately — renderMapPins queues pins until map is ready
    if (qVal) {
      await geocodeAndLoad(qVal)
    } else {
      await loadListings()
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          pos => {
            mapCenter = { lat: pos.coords.latitude, lng: pos.coords.longitude }
            if (map) map.flyTo({ center: [mapCenter.lng, mapCenter.lat], zoom: 12 })
            loadListings()
          },
          () => {}
        )
      }
    }
  })

  function showPromptLocation() {
    document.getElementById('prompt-location')?.classList.add('hidden')
  }

  function initMap() {
    if (typeof mapboxgl === 'undefined' || !MAPBOX_TOKEN) {
      const loadingEl = document.getElementById('map-loading')
      if (loadingEl) {
        loadingEl.style.display = 'block'
        loadingEl.innerHTML =
          '<div class="absolute inset-0 overflow-hidden" id="fallback-map" ' +
          'style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 30%,#0f3460 60%,#1a1a2e 100%)">' +
            '<svg class="absolute inset-0 w-full h-full opacity-10" xmlns="http://www.w3.org/2000/svg">' +
              '<defs>' +
                '<pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">' +
                  '<path d="M 80 0 L 0 0 0 80" fill="none" stroke="#5B2EFF" stroke-width="1"/>' +
                '</pattern>' +
                '<pattern id="roads" width="240" height="240" patternUnits="userSpaceOnUse">' +
                  '<rect width="240" height="25" fill="#2a2a3a" opacity="0.9"/>' +
                  '<rect y="80" width="240" height="25" fill="#2a2a3a" opacity="0.9"/>' +
                  '<rect y="160" width="240" height="25" fill="#2a2a3a" opacity="0.9"/>' +
                  '<rect x="0" width="25" height="240" fill="#2a2a3a" opacity="0.9"/>' +
                  '<rect x="80" width="25" height="240" fill="#2a2a3a" opacity="0.9"/>' +
                  '<rect x="160" width="25" height="240" fill="#2a2a3a" opacity="0.9"/>' +
                '</pattern>' +
              '</defs>' +
              '<rect width="100%" height="100%" fill="url(#roads)"/>' +
              '<rect width="100%" height="100%" fill="url(#grid)"/>' +
            '</svg>' +
            '<div id="fallback-pins" class="absolute inset-0"></div>' +
            '<div class="absolute bottom-4 left-4 glass rounded-xl px-3 py-2 text-xs text-gray-400">' +
              '<i class="fas fa-map-marked-alt text-indigo-400 mr-1"></i> Map preview mode' +
            '</div>' +
          '</div>'
      }
      resolveMapReady()
      return
    }

    mapboxgl.accessToken = MAPBOX_TOKEN
    try {
      map = new mapboxgl.Map({
        container: 'map',
        style: MAP_STYLES.dark,
        center: [mapCenter.lng || -98.5795, mapCenter.lat || 39.8283],
        zoom: mapCenter.lat ? 12 : 4,
        attributionControl: false,
        failIfMajorPerformanceCaveat: false
      })
    } catch(e) {
      console.error('[map] Mapbox init failed:', e)
      map = null; hideMapLoader(); resolveMapReady(); return
    }

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left')

    map.on('load', () => {
      hideMapLoader()
      resolveMapReady()
      // Replay any pins queued before tiles finished loading
      if (pendingListings !== null) {
        const toRender = pendingListings; pendingListings = null
        _renderPinsNow(toRender)
      }
    })

    map.on('error', (e) => {
      console.error('[map] error:', e && e.error ? e.error.message : e)
      hideMapLoader(); resolveMapReady()
    })

    // Hard safety: clear loader after 8 seconds no matter what
    setTimeout(() => { hideMapLoader(); resolveMapReady() }, 8000)

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

    // PRI minimum filter
    const minPri = parseInt(document.getElementById('pri-range')?.value || '0')
    if (minPri > 0) params.set('min_pri', minPri)

    // Sort (pass reliability sort to API for server-side ordering)
    if (currentSort === 'reliability') params.set('sort', 'reliability')

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
    if (currentSort === 'price_asc')   sorted.sort((a, b) => a.price_hourly - b.price_hourly)
    if (currentSort === 'price_desc')  sorted.sort((a, b) => b.price_hourly - a.price_hourly)
    if (currentSort === 'rating')      sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0))
    if (currentSort === 'reviews')     sorted.sort((a, b) => (b.review_count || 0) - (a.review_count || 0))
    if (currentSort === 'reliability') sorted.sort((a, b) => (b.pri_score ?? -1) - (a.pri_score ?? -1))
    if (currentSort === 'walk_score') {
      sorted.sort((a, b) => {
        const sa = WS.scores.get(a.id)?.durationS ?? Infinity
        const sb = WS.scores.get(b.id)?.durationS ?? Infinity
        return sa - sb
      })
    }

    document.getElementById('count-num').textContent = sorted.length
    document.getElementById('count-label').textContent = 'spots nearby'

    renderListingCards(sorted)
    renderMapPins(sorted)
    updateMapSpotCount()

    // Update trusted zones overlay if enabled
    if (trustedZonesEnabled) toggleTrustedZones(true)
    // Load/refresh top hosts widget
    loadTopHosts()
    // Trigger walk score calc if destination is set and listings just refreshed
    if (WS.destCoords && sorted.length > 0) scheduleWalkScoreCalc(600)
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

      // Build PRI badge using string concat (no nested template literals)
      const priHtml = l.pri_score != null
        ? '<span class="pri-tooltip">' +
            '<span class="text-gray-400 text-xs">PRI: <span class="font-semibold text-white">' + l.pri_score + '%</span>' + priDot(l.pri_score) + '</span>' +
            '<span class="pri-tip">Reliability: ' + l.pri_score + '%<br>Based on ' + (l.pri_bookings || 0) + ' bookings, ' + (l.pri_cancels || 0) + ' cancellations<br>Avg confirmation: ' + ((l.pri_confirm_hours||0)).toFixed(1) + ' hrs</span>' +
          '</span>'
        : (l.pri_bookings < 5 ? '<span class="text-gray-600 text-xs">New Listing</span>' : '')
      const hostLine = l.host
        ? '<p class="text-gray-600 text-xs mt-1.5 flex items-center">' + (l.host.name || '') + hostBadges(l.host) + '</p>'
        : ''
      const dailyPrice = l.price_daily
        ? '<p class="text-gray-500 text-xs">$' + l.price_daily.toFixed(0) + '/day</p>'
        : ''

      card.innerHTML =
        '<div class="flex gap-0">' +
          '<div class="w-28 h-28 bg-gradient-to-br from-charcoal-300 to-charcoal-400 flex items-center justify-center flex-shrink-0 relative overflow-hidden">' +
            '<i class="fas ' + typeIcon + ' text-3xl text-white/20"></i>' +
            '<span class="' + badge.cls + ' text-xs font-bold absolute top-2 left-2 px-1.5 py-0.5 rounded-md">' + badge.text + '</span>' +
          '</div>' +
          '<div class="flex-1 p-3 min-w-0">' +
            '<div class="flex items-start justify-between gap-2">' +
              '<div class="min-w-0">' +
                '<h3 class="font-bold text-white text-sm group-hover:text-indigo-300 transition-colors truncate">' + l.title + '</h3>' +
                '<p class="text-gray-500 text-xs flex items-center gap-1 mt-0.5 truncate">' +
                  '<i class="fas fa-map-pin text-indigo-400 flex-shrink-0"></i> ' + l.address +
                  (l.city ? ', ' + l.city : '') +
                '</p>' +
              '</div>' +
              '<div class="text-right flex-shrink-0">' +
                '<p class="font-black text-white text-base">$' + (l.price_hourly || 0).toFixed(0) + '<span class="text-gray-500 font-normal text-xs">/hr</span></p>' +
                dailyPrice +
              '</div>' +
            '</div>' +
            '<div class="flex items-center justify-between mt-2 flex-wrap gap-1">' +
              '<div class="flex items-center gap-2 flex-wrap">' +
                '<div class="flex items-center gap-1">' +
                  '<i class="fas fa-star text-amber-400 text-xs"></i>' +
                  '<span class="text-white text-xs font-semibold">' + (l.rating || 0).toFixed(1) + '</span>' +
                  '<span class="text-gray-500 text-xs">(' + (l.review_count || 0) + ')</span>' +
                '</div>' +
                priHtml +
              '</div>' +
              '<div class="flex gap-1 flex-wrap justify-end items-center">' +
                tags.slice(0,2).map(t => '<span class="text-xs bg-charcoal-300 text-gray-400 px-1.5 py-0.5 rounded-md">' + t + '</span>').join('') +
              '</div>' +
            '</div>' +
            hostLine +
          '</div>' +
        '</div>'

      card.addEventListener('mouseenter', () => highlightPin(l.id))
      card.addEventListener('mouseleave', () => unhighlightPin(l.id))

      container.appendChild(card)
    })

    // Inject walk badges into freshly-rendered cards
    if (WS.destCoords && WS.scores.size > 0) refreshCardWalkBadges()
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RENDER MAP PINS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // renderMapPins: public entry — queues if map not ready, renders immediately if ready
  function renderMapPins(listings) {
    clearMarkers()

    // No Mapbox token or object — use the fallback visual map
    if (!MAPBOX_TOKEN || typeof mapboxgl === 'undefined') {
      renderFallbackPins(listings)
      return
    }

    // Map object exists but tiles not loaded yet — queue and wait
    if (!map || !map.loaded()) {
      pendingListings = listings
      return
    }

    _renderPinsNow(listings)
  }

  // _renderPinsNow: places Mapbox markers directly — only call when map.loaded()
  function _renderPinsNow(listings) {
    listings.forEach(l => {
      if (!l.lat || !l.lng) return

      const el = document.createElement('div')
      // Store meta on element for walk badge updates (never overwritten)
      el._priceHr  = l.price_hourly || 0
      el._priScore = l.pri_score
      el._lng      = l.lng   // FIX 3 debug: freeze coords on element
      el._lat      = l.lat

      // Base inline style — set ONCE here, updateWalkBadge only touches className + textContent
      const score   = WS.scores.get(l.id)
      const isBest  = (l.id == WS.closestId)

      if (score && WS.destCoords) {
        // Walk-pin mode: column layout with time + price spans (built once, updated via textContent)
        const cls = wsColor(score.durationS)
        el.className = 'park-pin walk-pin ' + priPinClass(l.pri_score) + ' ' + cls + (isBest ? ' ws-best' : '')
        el.style.cssText = 'width:fit-content;max-width:90px;display:inline-flex;flex-direction:column;align-items:center;box-sizing:border-box;'
        // Build spans once — updateWalkBadge will only do textContent from here on
        const ts = document.createElement('span'); ts.className = 'ws-time'; ts.textContent = fmtDur(score.durationS)
        const ps = document.createElement('span'); ps.className = 'ws-price'; ps.textContent = '$' + (l.price_hourly || 0).toFixed(0)
        const bs = document.createElement('span'); bs.className = 'ws-best-badge'; bs.textContent = 'BEST'; bs.style.display = isBest ? '' : 'none'
        el.appendChild(ts); el.appendChild(ps); el.appendChild(bs)
      } else {
        // Plain price-pin mode
        el.className = 'park-pin ' + priPinClass(l.pri_score)
        el.style.cssText = 'width:fit-content;max-width:90px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;'
        el.textContent = '$' + (l.price_hourly || 0).toFixed(0)
      }
      el.dataset.id = l.id

      try {
        // FIX 3: Marker is created with frozen LngLat — never re-created on interaction
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([l.lng, l.lat])
          .addTo(map)
        console.debug('[pin] created id=' + l.id + ' lng=' + l.lng.toFixed(5) + ' lat=' + l.lat.toFixed(5))
        el.addEventListener('click', (e) => { e.stopPropagation(); showPinPopup(l, marker) })
        activeMarkers.push({ marker, id: l.id, el, lng: l.lng, lat: l.lat })
      } catch(e) {
        console.error('[map] failed to add pin for listing', l.id, e)
      }
    })

    // Auto-fit map to show all pins
    const valid = listings.filter(l => l.lat && l.lng)
    if (valid.length > 0 && map) {
      try {
        const bounds = new mapboxgl.LngLatBounds()
        valid.forEach(l => bounds.extend([l.lng, l.lat]))
        map.fitBounds(bounds, { padding: { top: 60, bottom: 60, left: 20, right: 60 }, maxZoom: 14, duration: 800 })
      } catch(e) { console.warn('[map] fitBounds failed:', e) }
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
      .setHTML(
        '<div class="p-4">' +
          '<div class="flex items-start gap-2 mb-3">' +
            '<div class="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center flex-shrink-0">' +
              '<i class="fas ' + (l.type === 'garage' ? 'fa-warehouse' : l.type === 'driveway' ? 'fa-home' : 'fa-parking') + ' text-indigo-400"></i>' +
            '</div>' +
            '<div class="flex-1 min-w-0">' +
              '<h4 class="font-bold text-white text-sm leading-tight mb-0.5 truncate">' + l.title + '</h4>' +
              '<p class="text-gray-400 text-xs truncate">' + l.address + (l.city ? ', ' + l.city : '') + '</p>' +
            '</div>' +
          '</div>' +
          '<div class="flex items-center justify-between mb-3">' +
            '<div>' +
              '<span class="text-2xl font-black text-white">$' + (l.price_hourly||0).toFixed(0) + '</span>' +
              '<span class="text-gray-400 text-xs">/hr</span>' +
              (l.price_daily ? '<span class="text-gray-500 text-xs ml-2">$' + l.price_daily.toFixed(0) + '/day</span>' : '') +
            '</div>' +
            '<div class="flex items-center gap-1">' +
              '<i class="fas fa-star text-amber-400 text-xs"></i>' +
              '<span class="text-white text-sm font-semibold">' + (l.rating||0).toFixed(1) + '</span>' +
              '<span class="text-gray-400 text-xs">(' + (l.review_count||0) + ')</span>' +
              (l.pri_score != null ? '<span class="ml-1 text-xs font-semibold" style="color:' + (l.pri_score>=95?'#16a34a':l.pri_score>=85?'#2563eb':l.pri_score>=75?'#ca8a04':'#dc2626') + '">• ' + l.pri_score + '%</span>' : '') +
            '</div>' +
          '</div>' +
          // Walk score section in popup
          (WS.destCoords ? (() => {
            const ws = WS.scores.get(l.id)
            const hex = ws ? wsColorHex(ws.durationS) : '#94a3b8'
            const isBest = l.id == WS.closestId
            return '<div style="background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.2);border-radius:12px;padding:10px 12px;margin-bottom:12px;display:flex;align-items:center;gap:8px">' +
              '<i class="fas fa-person-walking" style="color:' + hex + ';font-size:14px"></i>' +
              '<div style="flex:1">' +
                '<p style="color:' + hex + ';font-size:14px;font-weight:800;margin:0">' +
                  (ws ? fmtDur(ws.durationS) : 'Calculating…') +
                '</p>' +
                '<p style="color:#94a3b8;font-size:11px;margin:2px 0 0">' +
                  (ws ? fmtDist(ws.distanceM) + ' walk' + (ws.source==='haversine'?' ~':'') : '') +
                '</p>' +
              '</div>' +
              (isBest ? '<span style="background:#22c55e;color:#000;font-size:9px;font-weight:900;padding:2px 7px;border-radius:20px">CLOSEST</span>' : '') +
            '</div>'
          })() : '') +
          (tags.length > 0 ? '<div class="flex gap-1 flex-wrap mb-3">' + tags.slice(0,4).map(t => '<span class="text-xs bg-white/5 text-gray-400 px-2 py-0.5 rounded-full flex items-center gap-1"><i class=\\"fas ' + t.i + ' text-indigo-400 text-xs\\"></i>' + t.t + '</span>').join('') + '</div>' : '') +
          (l.instant_book ? '<div class="flex items-center gap-1.5 mb-3"><span class="w-1.5 h-1.5 bg-lime-500 rounded-full"></span><span class="text-lime-400 text-xs font-semibold">Instant Book Available</span></div>' : '') +
          '<a href="/listing/' + l.id + '" class="block w-full py-2.5 btn-primary text-white text-center text-sm font-bold rounded-xl transition-all">View &amp; Reserve</a>' +
        '</div>'
      )
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

    // Show walk route if destination is set
    if (WS.destCoords) showWalkRoute(l.id)

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

  let mobileMapVisible = false
  function toggleMobileMap() {
    mobileMapVisible = !mobileMapVisible
    const panel = document.getElementById('map-panel')
    const btn   = document.getElementById('mobile-map-btn')
    if (mobileMapVisible) {
      panel.classList.remove('hidden')
      panel.classList.add('flex')
      panel.style.cssText = 'position:fixed;inset:0;z-index:50;display:flex!important'
      if (btn) btn.innerHTML = '<i class="fas fa-list text-xs"></i> List'
      // Trigger map resize so tiles fill the new size
      if (map) setTimeout(() => map.resize(), 100)
    } else {
      panel.style.cssText = ''
      panel.classList.add('hidden')
      panel.classList.remove('flex')
      if (btn) btn.innerHTML = '<i class="fas fa-map text-xs"></i> Map'
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

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // WALK SCORE — DESTINATION INPUT + AUTOCOMPLETE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let destDebounce = null
  const destSuggestionData = new Map()  // key → { lng, lat, name }

  // Wire up destination input — runs inline (script executes after DOM is parsed)
  ;(function initDestInput() {
    const inp = document.getElementById('dest-input')
    const box = document.getElementById('dest-suggestions')
    if (!inp || !box) return

    inp.addEventListener('input', () => {
      clearTimeout(destDebounce)
      const q = inp.value.trim()
      if (!q || q.length < 2) { closeSuggestions(); return }
      destDebounce = setTimeout(() => runDestAutocomplete(q), 300)
    })

    inp.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeSuggestions(); inp.blur() }
    })

    // Use mousedown (fires before blur/click) so suggestion click registers
    // before the document click handler can wipe the dropdown
    box.addEventListener('mousedown', e => {
      const btn = e.target.closest('[data-dest-key]')
      if (!btn) return
      e.preventDefault()  // prevent input blur
      const key  = btn.dataset.destKey
      const data = destSuggestionData.get(key)
      if (data) selectDestination(data.lng, data.lat, data.name)
    })

    // Close on outside click — use mousedown so it runs before blur
    document.addEventListener('mousedown', e => {
      if (!e.target.closest('#walk-dest-row')) closeSuggestions()
    })
  })()

  async function runDestAutocomplete(q) {
    const box = document.getElementById('dest-suggestions')
    if (!box) return
    if (!MAPBOX_TOKEN) {
      console.warn('[walk] no MAPBOX_TOKEN yet, retrying in 500ms')
      setTimeout(() => runDestAutocomplete(q), 500)
      return
    }
    try {
      const url = 'https://api.mapbox.com/geocoding/v5/mapbox.places/'
        + encodeURIComponent(q)
        + '.json?access_token=' + MAPBOX_TOKEN
        + '&types=poi,address,place,neighborhood&limit=5&language=en'
      const res = await fetch(url)
      if (!res.ok) throw new Error('Geocoding ' + res.status)
      const geo = await res.json()
      if (!geo.features || !geo.features.length) { closeSuggestions(); return }

      destSuggestionData.clear()
      const html = geo.features.map((f, i) => {
        const key  = 'dest_' + i
        const name = f.place_name || f.text || ''
        destSuggestionData.set(key, { lng: f.center[0], lat: f.center[1], name })
        // Safely escape for HTML display only (no inline JS)
        const safeName    = name.replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const safeText    = (f.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const safePlaceFull = (f.place_name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        return '<button data-dest-key="' + key + '" '
          + 'class="w-full text-left px-4 py-3 hover:bg-indigo-500/10 border-b border-white/5 last:border-0 transition-colors cursor-pointer">'
          + '<div class="flex items-start gap-3 pointer-events-none">'
            + '<i class="fas fa-location-dot text-lime-400 text-xs mt-0.5 flex-shrink-0"></i>'
            + '<div class="min-w-0">'
              + '<p class="text-white text-xs font-semibold truncate">' + safeText + '</p>'
              + '<p class="text-gray-500 text-xs truncate">' + safePlaceFull + '</p>'
            + '</div>'
          + '</div>'
          + '</button>'
      }).join('')

      box.innerHTML = html
      box.classList.remove('hidden')
    } catch(e) {
      console.warn('[walk] autocomplete error', e)
    }
  }

  function closeSuggestions() {
    const box = document.getElementById('dest-suggestions')
    if (box) { box.classList.add('hidden'); box.innerHTML = '' }
    destSuggestionData.clear()
  }

  function selectDestination(lng, lat, name) {
    WS.destCoords = { lng, lat }
    WS.destName   = name
    const inp = document.getElementById('dest-input')
    if (inp) inp.value = name
    document.getElementById('dest-clear').classList.remove('hidden')
    closeSuggestions()
    // Update walk banner
    document.getElementById('walk-banner').classList.remove('hidden')
    document.getElementById('walk-banner-dest').textContent = '→ ' + name
    // Unlock walk sort option
    const opt = document.getElementById('sort-walk-option')
    if (opt) { opt.classList.remove('hidden') }
    // Place destination pin on map
    placeDestMarker(lng, lat, name)
    // Trigger walk score calculation for current listings
    if (allListings.length > 0) scheduleWalkScoreCalc()
  }

  function clearDestination() {
    WS.destCoords  = null
    WS.destName    = ''
    WS.scores.clear()
    WS.closestId   = null
    WS.lastCalcDestKey = null
    const inp = document.getElementById('dest-input')
    if (inp) inp.value = ''
    document.getElementById('dest-clear').classList.add('hidden')
    document.getElementById('walk-banner').classList.add('hidden')
    document.getElementById('best-walk-chip').classList.add('hidden')
    document.getElementById('walk-calc-label').textContent = ''
    const opt = document.getElementById('sort-walk-option')
    if (opt) opt.classList.add('hidden')
    if (currentSort === 'walk_score') {
      currentSort = 'rating'
      const sel = document.getElementById('sort-select')
      if (sel) sel.value = 'rating'
    }
    clearDestMarker()
    clearWalkRoute()
    // FIX 5: Do NOT call _renderPinsNow directly here — applySortAndRender
    // calls renderMapPins → clearMarkers + _renderPinsNow in the right order.
    // Double-calling _renderPinsNow was causing stacked markers and displacement.
    applySortAndRender()
  }

  function placeDestMarker(lng, lat, name) {
    clearDestMarker()
    if (!map || typeof mapboxgl === 'undefined') return
    const el = document.createElement('div')
    el.innerHTML = '<div style="background:#22c55e;color:#000;font-size:10px;font-weight:800;padding:4px 10px;border-radius:20px;white-space:nowrap;box-shadow:0 0 0 3px rgba(34,197,94,0.3)">' +
      '<i class="fas fa-location-dot" style="margin-right:4px"></i>Destination</div>' +
      '<div style="width:8px;height:8px;background:#22c55e;border-radius:50%;margin:3px auto 0"></div>'
    el.style.cssText = 'cursor:default;'
    WS.destMarker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([lng, lat]).addTo(map)
  }
  function clearDestMarker() {
    if (WS.destMarker) { WS.destMarker.remove(); WS.destMarker = null }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // WALK SCORE — CALCULATION ENGINE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function scheduleWalkScoreCalc(debounceMs = 300) {
    clearTimeout(WS.debounceTimer)
    WS.debounceTimer = setTimeout(runWalkScoreCalc, debounceMs)
  }

  async function runWalkScoreCalc() {
    if (!WS.destCoords) return
    const { lng: dLng, lat: dLat } = WS.destCoords
    const destKey = dLat.toFixed(5) + ',' + dLng.toFixed(5)
    // Skip if destination hasn't changed and we already have scores for current listings
    const listingKey = allListings.map(l => l.id).join(',')
    const calcKey    = destKey + '|' + listingKey
    if (calcKey === WS.lastCalcDestKey) return
    WS.lastCalcDestKey = calcKey

    // Filter to spots with coords, limit to nearest WS_MAX_SPOTS by haversine
    const valid = allListings
      .filter(l => l.lat && l.lng)
      .map(l => ({ ...l, _hav: haversine(l.lat, l.lng, dLat, dLng) }))
      .sort((a, b) => a._hav - b._hav)
      .slice(0, WS_MAX_SPOTS)

    // Seed haversine estimates immediately (instant visual feedback)
    valid.forEach(l => {
      if (!WS.scores.has(l.id)) {
        // Walking speed ~1.4 m/s (5 km/h) for initial estimate
        WS.scores.set(l.id, { distanceM: l._hav, durationS: l._hav / 1.4, source: 'haversine' })
      }
    })

    // Update markers with haversine estimates right away
    updateAllWalkBadges()
    updateBestWalkChip()

    // Now queue API calls for listings that don't have fresh cached results
    const toFetch = []
    valid.forEach(l => {
      const cacheKey = l.id + '|' + destKey
      const cached   = wsCache.get(cacheKey)
      if (cached && (Date.now() - cached.ts < WS_CACHE_TTL)) {
        WS.scores.set(l.id, cached.result)
      } else {
        toFetch.push(l)
      }
    })

    if (toFetch.length === 0) {
      finalizeWalkScores()
      return
    }

    // Show progress
    WS.calcDone  = 0
    WS.calcTotal = toFetch.length
    updateCalcStatus()
    document.getElementById('walk-calc-spinner').classList.remove('hidden')

    // Process in batches of WS_CONCURRENCY
    WS.calcQueue = [...toFetch]
    for (let i = 0; i < WS_CONCURRENCY; i++) drainWalkQueue(destKey)
  }

  async function drainWalkQueue(destKey) {
    if (WS.calcQueue.length === 0) return
    const l = WS.calcQueue.shift()
    const cacheKey = l.id + '|' + destKey
    try {
      const url = 'https://api.mapbox.com/directions/v5/mapbox/walking/' +
        l.lng + ',' + l.lat + ';' +
        WS.destCoords.lng + ',' + WS.destCoords.lat +
        '?access_token=' + MAPBOX_TOKEN +
        '&overview=full&geometries=geojson&steps=false&language=en'
      const res  = await fetch(url)
      const data = await res.json()
      if (data.routes && data.routes[0]) {
        const route = data.routes[0]
        const result = {
          distanceM: route.distance,
          durationS: route.duration,
          geometry:  route.geometry,
          source:    'api'
        }
        WS.scores.set(l.id, result)
        wsCache.set(cacheKey, { result, ts: Date.now() })
      }
    } catch(e) {
      // Keep haversine estimate already set
    }
    WS.calcDone++
    updateCalcStatus()
    // Update visuals incrementally
    updateWalkBadge(l.id)
    updateBestWalkChip()
    // Continue queue
    if (WS.calcQueue.length > 0) {
      drainWalkQueue(destKey)
    } else if (WS.calcDone >= WS.calcTotal) {
      finalizeWalkScores()
    }
  }

  function finalizeWalkScores() {
    document.getElementById('walk-calc-spinner').classList.add('hidden')
    document.getElementById('walk-calc-label').textContent = 'Scores ready'
    setTimeout(() => { document.getElementById('walk-calc-label').textContent = '' }, 2500)
    updateAllWalkBadges()
    updateBestWalkChip()
    // Auto-sort by walk score if user has set walk sort
    if (currentSort === 'walk_score') applySortAndRender()
    // Update listing cards with walk badges
    refreshCardWalkBadges()
  }

  function updateCalcStatus() {
    const lbl = document.getElementById('walk-calc-label')
    if (lbl) lbl.textContent = WS.calcDone + '/' + WS.calcTotal + ' scored'
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // WALK SCORE — MARKER BADGE RENDERING
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function updateAllWalkBadges() {
    activeMarkers.forEach(m => updateWalkBadge(m.id))
    // Find closest
    let best = null, bestDur = Infinity
    WS.scores.forEach((v, id) => {
      if (v.durationS < bestDur) { bestDur = v.durationS; best = id }
    })
    WS.closestId = best
    // Apply/remove best-walk class on all markers
    activeMarkers.forEach(m => {
      m.el.classList.toggle('ws-best', m.id == WS.closestId)
    })
  }

  function updateWalkBadge(listingId) {
    const m = activeMarkers.find(m => m.id == listingId)
    if (!m) return
    const score = WS.scores.get(listingId)
    if (!score) return
    const dur = score.durationS
    const cls = wsColor(dur)
    const label = fmtDur(dur)
    const isBest = (listingId == WS.closestId)

    // FIX 3 & 5: Update className only — do NOT rebuild innerHTML.
    // Rebuilding innerHTML detaches Mapbox's internal anchor reference and
    // causes markers to drift or disappear entirely.
    const el = m.el
    const wasWalkPin = el.classList.contains('walk-pin')

    if (!wasWalkPin) {
      // First time converting from a plain price-pin to a walk-pin:
      // Build the inner spans once, then never touch innerHTML again.
      el.innerHTML =
        '<span class="ws-time"></span>' +
        '<span class="ws-price"></span>' +
        '<span class="ws-best-badge" style="display:none">BEST</span>'
    }

    // Now only touch className + textContent — ZERO layout recalc on marker position
    el.className = 'park-pin walk-pin ' + priPinClass(el._priScore) + ' ' + cls + (isBest ? ' ws-best' : '')
    el.style.cssText = 'width:fit-content;max-width:90px;display:inline-flex;flex-direction:column;align-items:center;box-sizing:border-box;'

    const timeSpan = el.querySelector('.ws-time')
    const priceSpan = el.querySelector('.ws-price')
    const bestSpan = el.querySelector('.ws-best-badge')
    if (timeSpan)  timeSpan.textContent  = label
    if (priceSpan) priceSpan.textContent = '$' + (el._priceHr || 0).toFixed(0)
    if (bestSpan)  bestSpan.style.display = isBest ? '' : 'none'
  }

  function updateBestWalkChip() {
    const chip = document.getElementById('best-walk-chip')
    const txt  = document.getElementById('best-walk-chip-text')
    if (!chip || !WS.closestId || !WS.destCoords) return
    const score = WS.scores.get(WS.closestId)
    if (!score) return
    txt.textContent = 'Best parking · ' + fmtDur(score.durationS) + ' walk'
    chip.classList.remove('hidden')
    // Hide chip after 5s
    clearTimeout(chip._hideTimer)
    chip._hideTimer = setTimeout(() => chip.classList.add('hidden'), 5000)
  }

  function refreshCardWalkBadges() {
    // Inject walk badges into existing listing cards
    allListings.forEach(l => {
      const card = document.querySelector('[data-id="' + l.id + '"].listing-card')
      if (!card) return
      // Remove stale badge
      card.querySelector('.ws-card-badge')?.remove()
      const score = WS.scores.get(l.id)
      if (!score) return
      const badge = document.createElement('div')
      badge.className = 'ws-card-badge'
      const isB = (l.id == WS.closestId)
      badge.innerHTML =
        '<div class="ws-card-badge-inner ' + wsColor(score.durationS) + (isB ? ' ws-best' : '') + '">' +
          (isB ? '<i class="fas fa-circle-check"></i> ' : '<i class="fas fa-person-walking"></i> ') +
          fmtDur(score.durationS) + ' · ' + fmtDist(score.distanceM) +
          (score.source === 'haversine' ? ' <span class="ws-approx">~</span>' : '') +
          (isB ? ' <span class="ws-best-label">CLOSEST</span>' : '') +
        '</div>'
      card.querySelector('.flex.items-center.justify-between.mt-2')?.after(badge)
    })
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // WALK ROUTE — DISPLAY WALKING PATH ON MAP
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function showWalkRoute(listingId) {
    if (!WS.destCoords || !map || typeof mapboxgl === 'undefined') return
    const score = WS.scores.get(listingId)
    if (!score) {
      // Fetch on demand
      fetchWalkRouteOnDemand(listingId)
      return
    }
    _renderWalkRoute(listingId, score)
  }

  async function fetchWalkRouteOnDemand(listingId) {
    const l = allListings.find(x => x.id == listingId)
    if (!l || !l.lat || !l.lng || !WS.destCoords) return
    try {
      const url = 'https://api.mapbox.com/directions/v5/mapbox/walking/' +
        l.lng + ',' + l.lat + ';' +
        WS.destCoords.lng + ',' + WS.destCoords.lat +
        '?access_token=' + MAPBOX_TOKEN +
        '&overview=full&geometries=geojson&steps=false'
      const res  = await fetch(url)
      const data = await res.json()
      if (data.routes && data.routes[0]) {
        const route = data.routes[0]
        const result = { distanceM: route.distance, durationS: route.duration, geometry: route.geometry, source: 'api' }
        WS.scores.set(listingId, result)
        _renderWalkRoute(listingId, result)
      }
    } catch(e) {}
  }

  function _renderWalkRoute(listingId, score) {
    if (!map || !score.geometry) return
    clearWalkRoute()
    WS.activeRoute = { listingId, ...score }
    // Add route source + layers (start inactive — raActivateRoute will brighten them)
    try {
      if (map.getSource('walk-route')) map.removeSource('walk-route')
      if (map.getLayer('walk-route-line')) map.removeLayer('walk-route-line')
      if (map.getLayer('walk-route-glow')) map.removeLayer('walk-route-glow')
    } catch(e) {}
    map.addSource('walk-route', { type: 'geojson', data: { type: 'Feature', geometry: score.geometry } })
    // Glow layer — starts at inactive opacity; raActivateGlow() ramps it up
    map.addLayer({ id: 'walk-route-glow', type: 'line', source: 'walk-route',
      paint: { 'line-color': RA_GLOW_COLOR, 'line-width': 10, 'line-opacity': 0.08, 'line-blur': 6 } })
    // Main line — starts thin/muted; raActivateGlow() makes it bold
    map.addLayer({ id: 'walk-route-line', type: 'line', source: 'walk-route',
      paint: { 'line-color': RA_INACTIVE_COLOR, 'line-width': 3.5, 'line-opacity': 0.4,
               'line-dasharray': [2, 1.5] } })

    // ── Trigger Route Animation Engine ──────────────────────
    // raActivateRoute → raShowRoutePill handles showing + updating the pill.
    // Do NOT also call classList.remove('hidden') here — that double-show
    // triggers the CSS animation twice and causes a brief flicker.
    const listing = allListings.find(l => l.id == listingId)
    // rAF ensures layers are committed to GL before we read them back
    requestAnimationFrame(() => raActivateRoute(listingId, score, listing))
  }

  function clearWalkRoute() {
    if (!map) return
    // Stop all animations + remove map-anchored label marker
    raDeactivateRoute()
    try {
      if (map.getLayer('walk-route-glow')) map.removeLayer('walk-route-glow')
      if (map.getLayer('walk-route-line')) map.removeLayer('walk-route-line')
      if (map.getSource('walk-route'))     map.removeSource('walk-route')
    } catch(e) {}
    // FIX 2: hide unified pill (raDeactivateRoute already calls raHideRoutePill)
    document.getElementById('route-info-pill').classList.add('hidden')
    WS.activeRoute = null
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
    // After style reload, re-add all pins and walk route
    map.once('style.load', () => {
      clearMarkers()
      _renderPinsNow(allListings)
      if (WS.destCoords) {
        placeDestMarker(WS.destCoords.lng, WS.destCoords.lat, WS.destName)
        if (WS.activeRoute) {
          const score = WS.scores.get(WS.activeRoute.listingId)
          if (score) _renderWalkRoute(WS.activeRoute.listingId, score)
        }
      }
    })
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
    document.getElementById('trusted-zones').checked = false
    document.getElementById('pri-range').value = 0
    document.getElementById('pri-label').textContent = 'Any'
    document.getElementById('radius-range').value = 50
    document.getElementById('radius-label').textContent = '50 km'
    document.querySelectorAll('.vehicle-btn').forEach(b => b.classList.remove('border-indigo-500', 'bg-indigo-500/20'))
    selectedVehicles = []
    mapRadius = 50
    if (trustedZonesEnabled) toggleTrustedZones(false)
    closeFilterModal()
    loadListings()
  }

  function toggleTrustedZones(enabled) {
    trustedZonesEnabled = enabled
    if (!map || typeof mapboxgl === 'undefined') return
    if (enabled) {
      // Build trusted zone clusters from listings with PRI >= 95
      const highPri = allListings.filter(l => l.lat && l.lng && l.pri_score >= 95)
      if (highPri.length === 0) return
      // Remove old layer first
      if (trustedZoneLayerAdded) {
        try { map.removeLayer('trusted-zones-layer'); map.removeSource('trusted-zones') } catch(e) {}
        trustedZoneLayerAdded = false
      }
      // Create GeoJSON points
      const geojson = {
        type: 'FeatureCollection',
        features: highPri.map(l => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [l.lng, l.lat] },
          properties: { pri: l.pri_score }
        }))
      }
      map.addSource('trusted-zones', { type: 'geojson', data: geojson })
      map.addLayer({
        id: 'trusted-zones-layer',
        type: 'circle',
        source: 'trusted-zones',
        paint: {
          'circle-radius': 40,
          'circle-color': '#16a34a',
          'circle-opacity': 0.08,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#16a34a',
          'circle-stroke-opacity': 0.25
        }
      })
      trustedZoneLayerAdded = true
    } else {
      if (trustedZoneLayerAdded) {
        try { map.removeLayer('trusted-zones-layer'); map.removeSource('trusted-zones') } catch(e) {}
        trustedZoneLayerAdded = false
      }
    }
  }

  async function loadTopHosts() {
    const widget = document.getElementById('top-hosts-widget')
    const list   = document.getElementById('top-hosts-list')
    if (!widget || !list) return
    if (mapCenter.lat === 0 && mapCenter.lng === 0) return
    try {
      const r = await fetch(\`/api/top-hosts?lat=\${mapCenter.lat}&lng=\${mapCenter.lng}&radius_km=\${mapRadius}\`)
      const data = await r.json()
      if (!data.hosts || data.hosts.length === 0) return
      widget.classList.remove('hidden')
      list.innerHTML = data.hosts.map(h => {
        const badges = [
          h.verified    ? \`<span title="Identity Verified" style="color:#2563eb">✓</span>\` : '',
          h.secure      ? \`<span title="Secure Location"   style="color:#16a34a">🛡</span>\` : '',
          h.performance ? \`<span title="High-Performance"  style="color:#d97706">⭐</span>\` : '',
          h.founding    ? \`<span title="Founding Member"   style="color:#7c3aed">🏆</span>\` : '',
        ].join('')
        return \`<div class="flex items-center justify-between gap-2 py-1 border-b border-white/5 last:border-0">
          <button onclick="filterByHost(\${h.id})" class="text-left flex-1 min-w-0">
            <p class="text-white font-medium truncate">\${h.name}\${badges ? ' <span class="text-xs">' + badges + '</span>' : ''}</p>
            <p class="text-gray-500 text-xs">\${h.listing_count} spots · ⭐\${h.avg_rating}</p>
          </button>
          \${h.avg_pri != null ? \`<span class="text-xs font-semibold flex-shrink-0" style="color:\${h.avg_pri>=95?'#16a34a':h.avg_pri>=85?'#2563eb':'#ca8a04'}">\${h.avg_pri}% PRI</span>\` : ''}
        </div>\`
      }).join('')
    } catch(e) {}
  }

  function toggleTopHosts() {
    const list    = document.getElementById('top-hosts-list')
    const chevron = document.getElementById('top-hosts-chevron')
    if (!list) return
    topHostsCollapsed = !topHostsCollapsed
    list.classList.toggle('hidden', topHostsCollapsed)
    if (chevron) chevron.style.transform = topHostsCollapsed ? 'rotate(180deg)' : ''
  }

  function filterByHost(hostId) {
    // Filter allListings to only show this host's listings
    const filtered = allListings.filter(l => l.host && l.host.id == hostId)
    if (filtered.length === 0) return
    renderListingCards(filtered)
    renderMapPins(filtered)
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

  const _session = await verifyUserToken(c, c.env?.USER_TOKEN_SECRET || 'pp-user-secret-change-in-prod').catch(() => null)
  const navSession = _session ? { name: _session.name || _session.email || '', role: _session.role || '' } : null

  return c.html(Layout('Find Parking Near You', content, '', navSession))
})
