import { Hono } from 'hono'
import { Layout } from '../components/layout'

export const searchPage = new Hono()

searchPage.get('/', (c) => {
  const q = c.req.query('q') || ''
  const content = `
  <div class="pt-16 flex h-screen overflow-hidden">
    
    <!-- Left Panel: Filters + Listings -->
    <div class="w-full lg:w-[480px] xl:w-[520px] flex flex-col border-r border-white/10 overflow-hidden flex-shrink-0">
      
      <!-- Search Header -->
      <div class="p-4 border-b border-white/10 bg-charcoal flex-shrink-0">
        <!-- Search Bar -->
        <div class="relative mb-3">
          <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-indigo-400 text-sm"></i>
          <input type="text" id="search-input" value="${q}" placeholder="Address, neighborhood, landmark..." 
            class="w-full bg-charcoal-100 border border-white/10 rounded-xl pl-9 pr-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-all"/>
          <button onclick="performSearch()" class="absolute right-2 top-1/2 -translate-y-1/2 btn-primary px-3 py-1.5 rounded-lg text-xs text-white font-medium">Search</button>
        </div>
        
        <!-- Quick Date/Time Filters -->
        <div class="grid grid-cols-2 gap-2 mb-3">
          <div class="bg-charcoal-100 border border-white/10 rounded-xl px-3 py-2.5 flex items-center gap-2">
            <i class="fas fa-calendar text-indigo-400 text-xs"></i>
            <input type="date" id="filter-date" class="bg-transparent text-white text-xs flex-1 focus:outline-none"/>
          </div>
          <div class="bg-charcoal-100 border border-white/10 rounded-xl px-3 py-2.5 flex items-center gap-2">
            <i class="fas fa-clock text-indigo-400 text-xs"></i>
            <select id="filter-duration" class="bg-transparent text-white text-xs flex-1 focus:outline-none appearance-none">
              <option>1 hour</option>
              <option>2 hours</option>
              <option>4 hours</option>
              <option>8 hours</option>
              <option>Full day</option>
              <option>Weekly</option>
              <option>Monthly</option>
            </select>
          </div>
        </div>

        <!-- Filter Pills -->
        <div class="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <button onclick="toggleFilter(this)" data-filter="all" class="filter-pill active-pill flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-indigo-500 text-white transition-all whitespace-nowrap">
            All Types
          </button>
          <button onclick="toggleFilter(this)" data-filter="driveway" class="filter-pill flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-charcoal-200 text-gray-400 hover:text-white border border-white/10 transition-all whitespace-nowrap">
            <i class="fas fa-home mr-1"></i> Driveway
          </button>
          <button onclick="toggleFilter(this)" data-filter="garage" class="filter-pill flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-charcoal-200 text-gray-400 hover:text-white border border-white/10 transition-all whitespace-nowrap">
            <i class="fas fa-warehouse mr-1"></i> Garage
          </button>
          <button onclick="toggleFilter(this)" data-filter="lot" class="filter-pill flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibond bg-charcoal-200 text-gray-400 hover:text-white border border-white/10 transition-all whitespace-nowrap">
            <i class="fas fa-parking mr-1"></i> Lot
          </button>
          <button onclick="toggleFilter(this)" data-filter="covered" class="filter-pill flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-charcoal-200 text-gray-400 hover:text-white border border-white/10 transition-all whitespace-nowrap">
            <i class="fas fa-shield mr-1"></i> Covered
          </button>
          <button onclick="openFilterModal()" class="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-charcoal-200 text-gray-400 hover:text-white border border-white/10 transition-all flex items-center gap-1 whitespace-nowrap">
            <i class="fas fa-sliders"></i> More Filters
          </button>
        </div>
      </div>

      <!-- Results Header -->
      <div class="px-4 py-3 flex items-center justify-between border-b border-white/5 flex-shrink-0">
        <p class="text-sm text-gray-400"><span class="text-white font-semibold">47 spots</span> near Chicago, IL</p>
        <select class="bg-transparent text-gray-400 text-xs focus:outline-none">
          <option>Best Match</option>
          <option>Price: Low to High</option>
          <option>Price: High to Low</option>
          <option>Highest Rated</option>
          <option>Nearest First</option>
        </select>
      </div>

      <!-- Listing Results -->
      <div class="flex-1 overflow-y-auto p-4 space-y-3" id="listings-container">
        ${generateListings()}
      </div>
    </div>

    <!-- Right Panel: Map -->
    <div class="hidden lg:flex flex-1 relative bg-charcoal-200 flex-col">
      <!-- Fake Map Background -->
      <div class="absolute inset-0 overflow-hidden">
        <div class="w-full h-full" id="fake-map" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 30%, #0f3460 60%, #1a1a2e 100%); position: relative;">
          <!-- Grid lines simulating streets -->
          <svg class="absolute inset-0 w-full h-full opacity-20" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">
                <path d="M 80 0 L 0 0 0 80" fill="none" stroke="#5B2EFF" stroke-width="1"/>
              </pattern>
              <pattern id="road" width="240" height="240" patternUnits="userSpaceOnUse">
                <rect width="240" height="30" fill="#2a2a3a" opacity="0.8"/>
                <rect y="80" width="240" height="30" fill="#2a2a3a" opacity="0.8"/>
                <rect y="160" width="240" height="30" fill="#2a2a3a" opacity="0.8"/>
                <rect x="0" width="30" height="240" fill="#2a2a3a" opacity="0.8" transform="rotate(0)"/>
                <rect x="80" width="30" height="240" fill="#2a2a3a" opacity="0.8"/>
                <rect x="160" width="30" height="240" fill="#2a2a3a" opacity="0.8"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#road)"/>
            <rect width="100%" height="100%" fill="url(#grid)"/>
          </svg>

          <!-- Map blocks/buildings -->
          <div class="absolute inset-0">
            ${Array(20).fill(0).map((_, i) => `
              <div class="absolute rounded-sm opacity-30" style="
                background: #${['2a2a4a', '1e2a4a', '2a3a5a', '1a2a3a'][i % 4]};
                width: ${30 + Math.random() * 60}px;
                height: ${20 + Math.random() * 40}px;
                left: ${5 + (i * 47) % 85}%;
                top: ${10 + (i * 37) % 75}%;
              "></div>
            `).join('')}
          </div>

          <!-- Parking Pins -->
          <div id="map-pins" class="absolute inset-0">
            ${[
              { x: 30, y: 25, price: 8, active: true },
              { x: 55, y: 40, price: 12, active: false },
              { x: 20, y: 55, price: 6, active: false },
              { x: 70, y: 30, price: 15, active: false },
              { x: 45, y: 65, price: 10, active: false },
              { x: 80, y: 55, price: 7, active: false },
              { x: 35, y: 75, price: 9, active: false },
              { x: 60, y: 70, price: 11, active: false },
              { x: 15, y: 35, price: 5, active: false },
              { x: 75, y: 15, price: 14, active: false },
            ].map((pin, i) => `
              <button onclick="selectPin(${i})" class="map-pin absolute flex flex-col items-center cursor-pointer group" 
                style="left: ${pin.x}%; top: ${pin.y}%; transform: translate(-50%, -100%)">
                <div class="${pin.active ? 'bg-lime-500 text-charcoal scale-110' : 'bg-indigo-500 text-white'} font-bold text-xs px-2.5 py-1.5 rounded-full shadow-lg group-hover:scale-110 transition-all group-hover:bg-lime-500 group-hover:text-charcoal">
                  $${pin.price}
                </div>
                <div class="${pin.active ? 'bg-lime-500' : 'bg-indigo-500'} w-2 h-2 rounded-full mt-0.5 group-hover:bg-lime-500 transition-colors"></div>
              </button>
            `).join('')}
          </div>

          <!-- Map Controls -->
          <div class="absolute right-4 bottom-4 flex flex-col gap-2">
            <button class="w-10 h-10 glass rounded-xl flex items-center justify-center text-white hover:bg-white/10 transition-colors font-bold">+</button>
            <button class="w-10 h-10 glass rounded-xl flex items-center justify-center text-white hover:bg-white/10 transition-colors font-bold">−</button>
            <button class="w-10 h-10 glass rounded-xl flex items-center justify-center text-white hover:bg-white/10 transition-colors">
              <i class="fas fa-crosshairs text-sm"></i>
            </button>
          </div>

          <!-- Map Layer Toggle -->
          <div class="absolute top-4 right-4 flex gap-2">
            <button class="glass px-3 py-1.5 rounded-xl text-xs text-white font-medium hover:bg-white/10 transition-colors">
              <i class="fas fa-map mr-1"></i>Street
            </button>
            <button class="glass px-3 py-1.5 rounded-xl text-xs text-white font-medium hover:bg-white/10 transition-colors">
              <i class="fas fa-satellite mr-1"></i>Satellite
            </button>
          </div>

          <!-- Spot count overlay -->
          <div class="absolute top-4 left-4 glass rounded-xl px-4 py-2">
            <p class="text-white text-sm font-semibold"><i class="fas fa-parking text-indigo-400 mr-2"></i>47 spots in view</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Filter Modal -->
  <div id="filter-modal" class="hidden fixed inset-0 bg-black/70 z-50 flex items-end md:items-center justify-center p-4">
    <div class="bg-charcoal-100 rounded-3xl w-full max-w-lg border border-white/10 overflow-hidden">
      <div class="flex items-center justify-between p-6 border-b border-white/10">
        <h3 class="text-xl font-bold text-white">Filters</h3>
        <button onclick="closeFilterModal()" class="w-8 h-8 bg-charcoal-200 rounded-full flex items-center justify-center text-gray-400 hover:text-white transition-colors">
          <i class="fas fa-times text-sm"></i>
        </button>
      </div>
      <div class="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
        <!-- Price Range -->
        <div>
          <h4 class="font-semibold text-white mb-3 flex items-center justify-between">
            Price Range 
            <span class="text-indigo-400 text-sm font-normal" id="price-range-label">$2 — $25/hr</span>
          </h4>
          <div class="flex gap-3">
            <div class="flex-1">
              <label class="text-xs text-gray-500 mb-1 block">Min</label>
              <input type="number" value="2" min="1" max="50" class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"/>
            </div>
            <div class="flex-1">
              <label class="text-xs text-gray-500 mb-1 block">Max</label>
              <input type="number" value="25" min="1" max="100" class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"/>
            </div>
          </div>
        </div>
        <!-- Distance -->
        <div>
          <h4 class="font-semibold text-white mb-3 flex items-center justify-between">
            Distance <span class="text-indigo-400 text-sm font-normal" id="dist-label">Within 1.0 mile</span>
          </h4>
          <input type="range" min="0.1" max="10" step="0.1" value="1.0" oninput="document.getElementById('dist-label').textContent='Within '+this.value+' mile'" class="w-full accent-indigo-500"/>
        </div>
        <!-- Security Features -->
        <div>
          <h4 class="font-semibold text-white mb-3">Security Features</h4>
          <div class="grid grid-cols-2 gap-2">
            ${['CCTV Camera', 'Gated Access', 'Lighting', 'Covered/Indoor', '24/7 Access', 'Attendant On Site'].map(f => `
              <label class="flex items-center gap-3 p-3 bg-charcoal-200 rounded-xl cursor-pointer hover:border-indigo-500/30 border border-white/5 transition-all">
                <input type="checkbox" class="accent-indigo-500 w-4 h-4"/>
                <span class="text-sm text-gray-300">${f}</span>
              </label>
            `).join('')}
          </div>
        </div>
        <!-- Vehicle Size -->
        <div>
          <h4 class="font-semibold text-white mb-3">Vehicle Size</h4>
          <div class="grid grid-cols-3 gap-2">
            ${[{ size: 'Compact', icon: '🚗' }, { size: 'Sedan', icon: '🚙' }, { size: 'SUV', icon: '🚐' }, { size: 'Truck', icon: '🛻' }, { size: 'Van', icon: '🚌' }, { size: 'Motorcycle', icon: '🏍️' }].map(v => `
              <button class="p-3 bg-charcoal-200 border border-white/5 hover:border-indigo-500/40 rounded-xl text-center transition-all group">
                <span class="text-2xl block mb-1">${v.icon}</span>
                <span class="text-xs text-gray-400 group-hover:text-white">${v.size}</span>
              </button>
            `).join('')}
          </div>
        </div>
        <!-- Amenities -->
        <div>
          <h4 class="font-semibold text-white mb-3">Booking Options</h4>
          <div class="space-y-2">
            ${['Instant Book Only', 'Has EV Charging', 'Handicap Accessible', 'Free Cancellation'].map(a => `
              <label class="flex items-center justify-between p-3 bg-charcoal-200 rounded-xl cursor-pointer border border-white/5">
                <span class="text-sm text-gray-300">${a}</span>
                <input type="checkbox" class="accent-indigo-500 w-4 h-4"/>
              </label>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="p-4 border-t border-white/10 flex gap-3">
        <button onclick="closeFilterModal()" class="flex-1 py-3 bg-charcoal-200 text-gray-400 rounded-xl font-semibold text-sm hover:text-white transition-colors">
          Reset All
        </button>
        <button onclick="closeFilterModal()" class="flex-2 flex-1 py-3 btn-primary text-white rounded-xl font-semibold text-sm">
          Show 47 Results
        </button>
      </div>
    </div>
  </div>

  <script>
    // Set today's date
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('filter-date').value = today;
    document.getElementById('filter-date').min = today;

    function toggleFilter(btn) {
      document.querySelectorAll('.filter-pill').forEach(b => {
        b.className = b.className.replace('bg-indigo-500 text-white', 'bg-charcoal-200 text-gray-400 hover:text-white border border-white/10');
        b.classList.remove('active-pill');
      });
      btn.className = btn.className.replace('bg-charcoal-200 text-gray-400 hover:text-white border border-white/10', 'bg-indigo-500 text-white');
      btn.classList.add('active-pill');
    }

    function openFilterModal() {
      document.getElementById('filter-modal').classList.remove('hidden');
    }

    function closeFilterModal() {
      document.getElementById('filter-modal').classList.add('hidden');
    }

    function performSearch() {
      const q = document.getElementById('search-input').value;
      window.location.href = '/search?q=' + encodeURIComponent(q);
    }

    document.getElementById('search-input').addEventListener('keypress', e => {
      if (e.key === 'Enter') performSearch();
    });

    function selectPin(idx) {
      const pins = document.querySelectorAll('.map-pin > div:first-child');
      pins.forEach((p, i) => {
        if (i === idx) {
          p.className = p.className.replace('bg-indigo-500 text-white', 'bg-lime-500 text-charcoal scale-110');
        } else {
          p.className = p.className.replace('bg-lime-500 text-charcoal scale-110', 'bg-indigo-500 text-white');
        }
      });
      // Scroll to listing
      const listing = document.querySelector('[data-listing="'+idx+'"]');
      if (listing) listing.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Hover on listing highlights pin
    document.querySelectorAll('[data-listing]').forEach((card, i) => {
      card.addEventListener('mouseenter', () => selectPin(i));
    });
  </script>
  `
  return c.html(Layout('Find Parking', content))
})

function generateListings() {
  const listings = [
    { id: 1, title: 'Secure Covered Garage', address: '120 S Michigan Ave', price: 12, daily: 55, rating: 4.9, reviews: 142, type: 'Garage', badge: '⚡ Instant', badgeColor: 'bg-lime-500 text-charcoal', features: ['CCTV', 'Covered', 'EV Charging'], size: 'SUV OK', dist: '0.2 mi' },
    { id: 2, title: 'Private Driveway — Wrigley', address: '3614 N Clark St', price: 8, daily: 35, rating: 4.8, reviews: 89, type: 'Driveway', badge: '⭐ Top Rated', badgeColor: 'bg-amber-500 text-charcoal', features: ['Gated', 'Lighting'], size: 'Sedan OK', dist: '0.5 mi' },
    { id: 3, title: 'O\'Hare Airport Long-Term', address: 'Near ORD Terminal 1', price: 14, daily: 45, rating: 4.7, reviews: 311, type: 'Lot', badge: '✈️ Airport', badgeColor: 'bg-indigo-500 text-white', features: ['Shuttle', 'CCTV', '24/7'], size: 'SUV OK', dist: '1.1 mi' },
    { id: 4, title: 'Loop District Open Lot', address: '55 W Monroe St', price: 6, daily: 28, rating: 4.5, reviews: 67, type: 'Lot', badge: '💲 Best Value', badgeColor: 'bg-green-500 text-white', features: ['Open Air'], size: 'Compact', dist: '0.3 mi' },
    { id: 5, title: 'Navy Pier Gated Spot', address: '600 E Grand Ave', price: 10, daily: 42, rating: 4.9, reviews: 203, type: 'Covered', badge: '🔒 Gated', badgeColor: 'bg-purple-500 text-white', features: ['Gated', 'Covered', 'Lighting'], size: 'SUV OK', dist: '0.8 mi' },
    { id: 6, title: 'River North Driveway', address: '320 W Erie St', price: 9, daily: 38, rating: 4.6, reviews: 44, type: 'Driveway', badge: '🆕 New', badgeColor: 'bg-blue-500 text-white', features: ['Lighting'], size: 'Sedan OK', dist: '0.6 mi' },
    { id: 7, title: 'Lincoln Park Residential', address: '2150 N Lincoln Ave', price: 5, daily: 22, rating: 4.4, reviews: 28, type: 'Driveway', badge: '💲 Cheapest', badgeColor: 'bg-green-600 text-white', features: ['Street Access'], size: 'Compact', dist: '1.4 mi' },
  ]

  return listings.map((l, i) => `
    <a href="/listing/${l.id}" data-listing="${i}" class="block bg-charcoal-100 rounded-2xl border border-white/5 hover:border-indigo-500/30 transition-all overflow-hidden group">
      <div class="flex gap-0">
        <!-- Image -->
        <div class="w-28 h-28 bg-gradient-to-br from-charcoal-300 to-charcoal-400 flex items-center justify-center flex-shrink-0 relative">
          <i class="fas fa-${l.type === 'Garage' ? 'warehouse' : l.type === 'Driveway' ? 'home' : 'parking'} text-3xl text-white/20"></i>
          <span class="${l.badgeColor} text-xs font-bold absolute top-2 left-2 px-1.5 py-0.5 rounded-md">${l.badge}</span>
        </div>
        <!-- Info -->
        <div class="flex-1 p-3 min-w-0">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <h3 class="font-bold text-white text-sm group-hover:text-indigo-300 transition-colors truncate">${l.title}</h3>
              <p class="text-gray-500 text-xs flex items-center gap-1 mt-0.5 truncate">
                <i class="fas fa-map-pin text-indigo-400 flex-shrink-0"></i> ${l.address}
              </p>
            </div>
            <div class="text-right flex-shrink-0">
              <p class="font-black text-white text-base">$${l.price}<span class="text-gray-500 font-normal text-xs">/hr</span></p>
              <p class="text-gray-500 text-xs">$${l.daily}/day</p>
            </div>
          </div>
          <div class="flex items-center justify-between mt-2">
            <div class="flex items-center gap-1">
              <i class="fas fa-star text-amber-400 text-xs"></i>
              <span class="text-white text-xs font-semibold">${l.rating}</span>
              <span class="text-gray-500 text-xs">(${l.reviews})</span>
              <span class="text-gray-600 text-xs ml-1">· ${l.dist}</span>
            </div>
            <div class="flex gap-1">
              ${l.features.slice(0,2).map(f => `<span class="text-xs bg-charcoal-300 text-gray-400 px-1.5 py-0.5 rounded-md">${f}</span>`).join('')}
            </div>
          </div>
        </div>
      </div>
    </a>
  `).join('')
}
