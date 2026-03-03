import { Hono } from 'hono'
import { Layout } from '../components/layout'

export const landingPage = new Hono()

landingPage.get('/', (c) => {
  const content = `
  <!-- Hero Section -->
  <section class="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
    <!-- Animated background grid -->
    <div class="absolute inset-0 map-bg opacity-40"></div>
    
    <!-- Gradient orbs -->
    <div class="absolute top-20 left-1/4 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl"></div>
    <div class="absolute bottom-20 right-1/4 w-80 h-80 bg-lime-500/10 rounded-full blur-3xl"></div>
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-900/10 rounded-full blur-3xl"></div>
    
    <!-- Floating Map Pins -->
    <div class="absolute inset-0 pointer-events-none">
      <div class="absolute top-32 left-16 animate-bounce" style="animation-delay: 0s; animation-duration: 3s;">
        <div class="bg-indigo-500 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg glow-indigo">$8/hr</div>
        <div class="w-2 h-2 bg-indigo-500 rounded-full mx-auto mt-1"></div>
      </div>
      <div class="absolute top-48 right-20 animate-bounce" style="animation-delay: 0.5s; animation-duration: 3.5s;">
        <div class="bg-lime-500 text-charcoal text-xs font-bold px-3 py-1.5 rounded-full shadow-lg glow-lime">$5/hr</div>
        <div class="w-2 h-2 bg-lime-500 rounded-full mx-auto mt-1"></div>
      </div>
      <div class="absolute bottom-48 left-24 animate-bounce" style="animation-delay: 1s; animation-duration: 4s;">
        <div class="bg-indigo-500 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg glow-indigo">$12/hr</div>
        <div class="w-2 h-2 bg-indigo-500 rounded-full mx-auto mt-1"></div>
      </div>
      <div class="absolute bottom-32 right-32 animate-bounce" style="animation-delay: 1.5s; animation-duration: 2.8s;">
        <div class="bg-indigo-400 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg">$6/hr</div>
        <div class="w-2 h-2 bg-indigo-400 rounded-full mx-auto mt-1"></div>
      </div>
      <div class="absolute top-64 left-1/2 animate-bounce hide-mobile" style="animation-delay: 0.8s; animation-duration: 3.2s;">
        <div class="bg-lime-500 text-charcoal text-xs font-bold px-3 py-1.5 rounded-full shadow-lg">$9/hr</div>
        <div class="w-2 h-2 bg-lime-500 rounded-full mx-auto mt-1"></div>
      </div>
    </div>

    <!-- Hero Content -->
    <div class="relative z-10 max-w-5xl mx-auto px-4 text-center slide-up">
      <!-- Badge -->
      <div class="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/30 rounded-full px-4 py-2 mb-8">
        <span class="w-2 h-2 bg-lime-500 rounded-full pulse-dot"></span>
        <span class="text-sm text-indigo-300 font-medium">Now live in Chicago — 2,400+ spots available</span>
      </div>

      <h1 class="text-5xl md:text-7xl lg:text-8xl font-black leading-none mb-6 tracking-tight">
        Turn Empty Space<br/>
        <span class="gradient-text">Into Income.</span>
      </h1>
      
      <p class="text-xl md:text-2xl text-gray-300 max-w-2xl mx-auto mb-10 leading-relaxed font-light">
        The peer-to-peer parking marketplace. List your driveway. Find affordable parking. No middlemen.
      </p>

      <!-- CTA Buttons -->
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

      <!-- Quick Search Bar -->
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

      <!-- Trust indicators -->
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
          <i class="fas fa-star text-amber-400"></i>
          <span>4.8/5 Average Rating</span>
        </div>
        <div class="flex items-center gap-2">
          <i class="fas fa-headset text-green-400"></i>
          <span>24/7 Support</span>
        </div>
      </div>
    </div>

    <!-- Scroll indicator -->
    <div class="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-gray-500 animate-bounce">
      <span class="text-xs font-medium tracking-wider uppercase">Scroll</span>
      <i class="fas fa-chevron-down text-sm"></i>
    </div>
  </section>

  <!-- Stats Section -->
  <section class="py-16 border-y border-white/5">
    <div class="max-w-7xl mx-auto px-4">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
        ${[
          { num: '12,400+', label: 'Parking Spots', icon: 'fa-parking', color: 'text-indigo-400' },
          { num: '$2.8M+', label: 'Host Earnings', icon: 'fa-dollar-sign', color: 'text-lime-500' },
          { num: '89,000+', label: 'Happy Drivers', icon: 'fa-users', color: 'text-indigo-400' },
          { num: '28 Cities', label: 'And Growing', icon: 'fa-city', color: 'text-lime-500' }
        ].map(s => `
          <div class="stat-card rounded-2xl p-6 text-center card-hover cursor-default">
            <i class="fas ${s.icon} text-3xl ${s.color} mb-3 block"></i>
            <div class="text-3xl md:text-4xl font-black text-white mb-1">${s.num}</div>
            <div class="text-gray-400 text-sm font-medium">${s.label}</div>
          </div>
        `).join('')}
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
    
    <!-- Tabs -->
    <div class="flex justify-center gap-2 mb-12">
      <button onclick="switchTab('driver')" id="tab-driver" class="tab-btn px-6 py-3 rounded-full font-semibold text-sm transition-all bg-indigo-500 text-white">
        <i class="fas fa-car mr-2"></i>For Drivers
      </button>
      <button onclick="switchTab('host')" id="tab-host" class="tab-btn px-6 py-3 rounded-full font-semibold text-sm transition-all bg-charcoal-200 text-gray-400 hover:text-white border border-white/10">
        <i class="fas fa-home mr-2"></i>For Hosts
      </button>
    </div>

    <!-- Driver Steps -->
    <div id="driver-steps" class="grid grid-cols-1 md:grid-cols-4 gap-6">
      ${[
        { step: '01', icon: 'fa-search-location', title: 'Search', desc: 'Enter your destination and select arrival time. Filter by price, vehicle type, and amenities.', color: 'from-indigo-600 to-indigo-800' },
        { step: '02', icon: 'fa-map-pin', title: 'Choose a Spot', desc: 'Browse verified spots with photos, reviews, and real-time availability. Compare prices instantly.', color: 'from-indigo-700 to-purple-800' },
        { step: '03', icon: 'fa-credit-card', title: 'Book & Pay', desc: 'Secure checkout in seconds. Pay with card, Apple Pay, or Google Pay. Get instant confirmation.', color: 'from-purple-700 to-indigo-800' },
        { step: '04', icon: 'fa-qrcode', title: 'Park & Go', desc: 'Receive QR code for contactless check-in. Navigate directly to your spot with in-app directions.', color: 'from-indigo-600 to-purple-700' }
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

    <!-- Host Steps -->
    <div id="host-steps" class="hidden grid grid-cols-1 md:grid-cols-4 gap-6">
      ${[
        { step: '01', icon: 'fa-camera', title: 'Create Listing', desc: 'Add photos, set your rates, and describe your space. Our AI suggests competitive pricing.', color: 'from-lime-700 to-green-800' },
        { step: '02', icon: 'fa-calendar-check', title: 'Set Availability', desc: 'Control when your space is available with an easy calendar editor. Block off personal use days.', color: 'from-green-700 to-teal-800' },
        { step: '03', icon: 'fa-bell', title: 'Get Booked', desc: 'Receive instant booking notifications. Review driver profiles. Enable Instant Book to maximize income.', color: 'from-teal-700 to-green-800' },
        { step: '04', icon: 'fa-money-bill-wave', title: 'Get Paid', desc: 'Automatic weekly payouts to your bank account. Track all earnings in your host dashboard.', color: 'from-lime-700 to-green-700' }
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

  <!-- Featured Listings -->
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
        ${[
          { id: 1, title: 'Wrigley Field Driveway', type: 'Driveway', address: '3612 N Sheffield, Chicago', price: 8, rating: 4.9, reviews: 127, badge: '⚡ Instant Book', badgeColor: 'bg-lime-500 text-charcoal', img: '🏠', distance: '0.2 mi' },
          { id: 2, title: 'Downtown Covered Garage', type: 'Garage', address: '100 W Randolph, Chicago', price: 15, rating: 4.7, reviews: 89, badge: '🏆 Top Rated', badgeColor: 'bg-amber-500 text-charcoal', img: '🅿️', distance: '0.5 mi' },
          { id: 3, title: 'O\'Hare Airport Lot', type: 'Lot', address: 'Near ORD Terminal 3', price: 12, rating: 4.8, reviews: 234, badge: '✈️ Airport', badgeColor: 'bg-indigo-500 text-white', img: '🚗', distance: '1.2 mi' },
          { id: 4, title: 'Navy Pier Secured Spot', type: 'Covered', address: '600 E Grand Ave, Chicago', price: 10, rating: 4.6, reviews: 56, badge: '🔒 Gated', badgeColor: 'bg-purple-500 text-white', img: '🏢', distance: '0.8 mi' },
        ].map(l => `
          <a href="/listing/${l.id}" class="block card-hover">
            <div class="bg-charcoal-200 rounded-2xl overflow-hidden border border-white/5 hover:border-indigo-500/30 transition-all h-full">
              <!-- Image placeholder -->
              <div class="h-48 bg-gradient-to-br from-charcoal-300 to-charcoal-400 flex items-center justify-center relative">
                <span class="text-7xl opacity-30">${l.img}</span>
                <div class="absolute top-3 left-3">
                  <span class="${l.badgeColor} text-xs font-bold px-2.5 py-1 rounded-full">${l.badge}</span>
                </div>
                <div class="absolute top-3 right-3">
                  <button onclick="event.preventDefault(); toggleFavorite(${l.id})" class="w-8 h-8 bg-black/40 hover:bg-red-500/80 rounded-full flex items-center justify-center transition-colors">
                    <i class="fas fa-heart text-white/60 text-sm" id="fav-${l.id}"></i>
                  </button>
                </div>
                <div class="absolute bottom-3 right-3 flex items-center gap-1 bg-black/60 rounded-full px-2.5 py-1">
                  <i class="fas fa-map-marker-alt text-indigo-400 text-xs"></i>
                  <span class="text-white text-xs font-medium">${l.distance}</span>
                </div>
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
                    <p class="text-lg font-black text-white">$${l.price}</p>
                    <p class="text-gray-500 text-xs">/hr</p>
                  </div>
                </div>
                <div class="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
                  <div class="flex items-center gap-1">
                    <i class="fas fa-star text-amber-400 text-xs"></i>
                    <span class="text-white text-sm font-semibold">${l.rating}</span>
                    <span class="text-gray-500 text-xs">(${l.reviews})</span>
                  </div>
                  <span class="text-xs bg-charcoal-300 text-gray-300 px-2.5 py-1 rounded-full">
                    <i class="fas fa-parking mr-1 text-indigo-400"></i>${l.type}
                  </span>
                </div>
              </div>
            </div>
          </a>
        `).join('')}
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
          Hosts in Chicago average <strong class="text-white">$350–$900/month</strong> from a single parking spot. Airport-adjacent spaces earn even more.
        </p>
        <div class="space-y-4">
          ${[
            { label: 'Driveway', range: '$150–$400/mo', icon: 'fa-home' },
            { label: 'Garage', range: '$300–$800/mo', icon: 'fa-warehouse' },
            { label: 'Lot Space', range: '$200–$600/mo', icon: 'fa-parking' },
            { label: 'Airport Spot', range: '$500–$1,200/mo', icon: 'fa-plane' },
          ].map(e => `
            <div class="flex items-center gap-4 p-4 bg-charcoal-100 rounded-xl border border-white/5 hover:border-lime-500/30 transition-all">
              <div class="w-10 h-10 bg-lime-500/10 rounded-xl flex items-center justify-center flex-shrink-0">
                <i class="fas ${e.icon} text-lime-500"></i>
              </div>
              <span class="text-white font-medium flex-1">${e.label}</span>
              <span class="text-lime-500 font-bold">${e.range}</span>
            </div>
          `).join('')}
        </div>
        <a href="/host" class="btn-lime inline-flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-lg mt-8">
          <i class="fas fa-rocket"></i>
          Start Earning Today
        </a>
      </div>

      <!-- Calculator -->
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

  <!-- City Coverage -->
  <section class="py-16 bg-charcoal-100 border-y border-white/5">
    <div class="max-w-7xl mx-auto px-4">
      <div class="text-center mb-12">
        <span class="text-indigo-400 text-sm font-semibold uppercase tracking-widest">Coverage</span>
        <h2 class="text-3xl md:text-4xl font-black mt-3">Available In Your City</h2>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        ${[
          { city: 'Chicago', spots: '2,400', status: 'live' },
          { city: 'New York', spots: '5,100', status: 'live' },
          { city: 'Los Angeles', spots: '3,200', status: 'live' },
          { city: 'Miami', spots: '1,800', status: 'live' },
          { city: 'Austin', spots: '900', status: 'live' },
          { city: 'Seattle', spots: '1,100', status: 'live' },
          { city: 'Boston', spots: '750', status: 'coming' },
        ].map(c => `
          <div class="relative p-4 rounded-2xl ${c.status === 'live' ? 'bg-indigo-500/10 border border-indigo-500/20' : 'bg-charcoal-200 border border-white/5 opacity-60'} text-center card-hover cursor-pointer">
            ${c.status === 'live' ? `<div class="absolute top-2 right-2 w-2 h-2 bg-lime-500 rounded-full pulse-dot"></div>` : ''}
            <p class="font-bold text-white text-sm">${c.city}</p>
            <p class="text-indigo-400 text-xs mt-1">${c.spots} spots</p>
            <p class="text-gray-500 text-xs mt-0.5">${c.status === 'live' ? 'Active' : 'Coming Soon'}</p>
          </div>
        `).join('')}
      </div>
    </div>
  </section>

  <!-- Testimonials -->
  <section class="py-24 max-w-7xl mx-auto px-4">
    <div class="text-center mb-16">
      <span class="text-indigo-400 text-sm font-semibold uppercase tracking-widest">Reviews</span>
      <h2 class="text-4xl md:text-5xl font-black mt-3">Real Stories from Real Users</h2>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      ${[
        { name: 'Marcus Johnson', role: 'Daily Commuter', avatar: 'M', stars: 5, quote: 'Saved me $180/month compared to the downtown garage. Found a spot 2 blocks from my office. Game changer!', location: 'Chicago, IL', joined: 'Driver since 2024' },
        { name: 'Sarah Chen', role: 'Homeowner & Host', avatar: 'S', stars: 5, quote: 'My driveway makes $420/month while I\'m at work. I literally do nothing and money appears in my account. Incredible.', location: 'Lincoln Park, IL', joined: 'Host since 2024' },
        { name: 'Derek Williams', role: 'Event Goer', avatar: 'D', stars: 5, quote: 'Used ParkPeer for 3 Cubs games last month. Found spots for $8 while everyone else was paying $35. Never going back.', location: 'Wrigleyville, IL', joined: 'Driver since 2023' },
      ].map(t => `
        <div class="bg-charcoal-100 rounded-2xl p-6 border border-white/5 card-hover">
          <div class="flex gap-1 mb-4">
            ${Array(t.stars).fill('<i class="fas fa-star text-amber-400 text-sm"></i>').join('')}
          </div>
          <p class="text-gray-300 leading-relaxed mb-6 italic">"${t.quote}"</p>
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 gradient-bg rounded-full flex items-center justify-center font-bold text-white flex-shrink-0">${t.avatar}</div>
            <div>
              <p class="font-bold text-white text-sm">${t.name}</p>
              <p class="text-gray-500 text-xs">${t.role} · ${t.location}</p>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  </section>

  <!-- Safety Section -->
  <section class="py-16 bg-charcoal-100 border-y border-white/5">
    <div class="max-w-7xl mx-auto px-4">
      <div class="text-center mb-12">
        <span class="text-green-400 text-sm font-semibold uppercase tracking-widest">Trust & Safety</span>
        <h2 class="text-3xl md:text-4xl font-black mt-3">Built for Safety First</h2>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        ${[
          { icon: 'fa-id-card', title: 'ID Verification', desc: 'Every host undergoes identity verification before listing their first space.', color: 'bg-blue-500/10 text-blue-400' },
          { icon: 'fa-shield-halved', title: 'Host Protection', desc: '$1M property damage protection included with every booking on our platform.', color: 'bg-green-500/10 text-green-400' },
          { icon: 'fa-credit-card', title: 'Secure Payments', desc: 'All transactions processed via Stripe. Your financial data is never stored on our servers.', color: 'bg-indigo-500/10 text-indigo-400' },
          { icon: 'fa-star', title: 'Rating System', desc: 'Transparent two-way reviews after every booking. Drivers and hosts rate each other.', color: 'bg-amber-500/10 text-amber-400' },
          { icon: 'fa-phone', title: '24/7 Support', desc: 'Real humans available around the clock via chat, email, or phone for any issue.', color: 'bg-purple-500/10 text-purple-400' },
          { icon: 'fa-qrcode', title: 'QR Check-In', desc: 'Contactless check-in with unique QR codes. No key exchanges, no awkward meetings.', color: 'bg-lime-500/10 text-lime-500' },
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
        <h2 class="text-4xl md:text-6xl font-black text-white mb-4">
          Own the Curb.
        </h2>
        <p class="text-indigo-200 text-xl mb-10 max-w-lg mx-auto">
          Join 89,000+ drivers and hosts who've discovered smarter parking.
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
      const driverSteps = document.getElementById('driver-steps');
      const hostSteps = document.getElementById('host-steps');
      const driverBtn = document.getElementById('tab-driver');
      const hostBtn = document.getElementById('tab-host');
      
      if (type === 'driver') {
        driverSteps.classList.remove('hidden');
        hostSteps.classList.add('hidden');
        driverBtn.className = 'tab-btn px-6 py-3 rounded-full font-semibold text-sm transition-all bg-indigo-500 text-white';
        hostBtn.className = 'tab-btn px-6 py-3 rounded-full font-semibold text-sm transition-all bg-charcoal-200 text-gray-400 hover:text-white border border-white/10';
      } else {
        hostSteps.classList.remove('hidden');
        driverSteps.classList.add('hidden');
        hostBtn.className = 'tab-btn px-6 py-3 rounded-full font-semibold text-sm transition-all bg-lime-500 text-charcoal font-bold';
        driverBtn.className = 'tab-btn px-6 py-3 rounded-full font-semibold text-sm transition-all bg-charcoal-200 text-gray-400 hover:text-white border border-white/10';
      }
    }

    function toggleFavorite(id) {
      const icon = document.getElementById('fav-' + id);
      icon.classList.toggle('text-red-500');
      icon.classList.toggle('text-white/60');
    }

    function calcEarnings() {
      const type = parseInt(document.getElementById('calc-type').value);
      const hours = parseInt(document.getElementById('calc-hours').value);
      const days = parseInt(document.getElementById('calc-days').value);
      
      document.getElementById('hours-label').textContent = hours + ' hrs';
      document.getElementById('days-label').textContent = days + ' days';
      
      const weeksPerMonth = 4.33;
      const occupancy = 0.65;
      const fee = 0.85;
      const weekly = type * hours * days * occupancy * fee;
      const monthly = weekly * weeksPerMonth;
      const yearly = monthly * 12;
      
      document.getElementById('calc-result').textContent = '$' + Math.round(monthly).toLocaleString();
      document.getElementById('calc-weekly').textContent = '$' + Math.round(weekly).toLocaleString();
      document.getElementById('calc-yearly').textContent = '$' + Math.round(yearly).toLocaleString();
    }

    function searchParking() {
      const loc = document.getElementById('hero-location').value;
      const date = document.getElementById('hero-date').value;
      let url = '/search';
      const params = new URLSearchParams();
      if (loc) params.set('q', loc);
      if (date) params.set('date', date);
      if (params.toString()) url += '?' + params.toString();
      window.location.href = url;
    }

    // Initialize
    calcEarnings();
    
    // Set min date to today
    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('hero-date');
    if (dateInput) {
      dateInput.min = today;
      dateInput.value = today;
    }

    // Animate numbers on scroll
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('slide-up');
        }
      });
    }, { threshold: 0.1 });
    
    document.querySelectorAll('.card-hover').forEach(el => observer.observe(el));
  </script>
  `
  return c.html(Layout('Find & List Parking Near You', content))
})
