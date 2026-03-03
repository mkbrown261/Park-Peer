import { Hono } from 'hono'
import { Layout } from '../components/layout'

export const hostDashboard = new Hono()

hostDashboard.get('/', (c) => {
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
          <button class="px-5 py-2.5 rounded-xl bg-charcoal-100 border border-white/10 text-gray-300 hover:text-white text-sm font-medium transition-colors flex items-center gap-2">
            <i class="fas fa-download text-indigo-400"></i> Export Report
          </button>
        </div>
      </div>

      <!-- Stats Row -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        ${[
          { label: 'Total Revenue', val: '$3,840', change: '+18% this month', icon: 'fa-dollar-sign', color: 'text-lime-500', bg: 'bg-lime-500/10', trend: 'up' },
          { label: 'Active Bookings', val: '7', change: '3 pending approval', icon: 'fa-calendar-check', color: 'text-indigo-400', bg: 'bg-indigo-500/10', trend: 'up' },
          { label: 'Avg Rating', val: '4.87', change: 'From 89 reviews', icon: 'fa-star', color: 'text-amber-400', bg: 'bg-amber-500/10', trend: 'up' },
          { label: 'Active Listings', val: '3', change: '1 pending review', icon: 'fa-parking', color: 'text-blue-400', bg: 'bg-blue-500/10', trend: 'neutral' },
        ].map(s => `
          <div class="stat-card rounded-2xl p-5 card-hover">
            <div class="flex items-start justify-between mb-3">
              <div class="w-10 h-10 ${s.bg} rounded-xl flex items-center justify-center">
                <i class="fas ${s.icon} ${s.color}"></i>
              </div>
              ${s.trend === 'up' ? '<i class="fas fa-arrow-trend-up text-green-400 text-xs"></i>' : '<i class="fas fa-minus text-gray-500 text-xs"></i>'}
            </div>
            <p class="text-2xl font-black text-white">${s.val}</p>
            <p class="text-gray-400 text-xs mt-1 font-medium">${s.label}</p>
            <p class="text-gray-500 text-xs mt-0.5">${s.change}</p>
          </div>
        `).join('')}
      </div>

      <!-- Revenue Chart -->
      <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-6 mb-6">
        <div class="flex items-center justify-between mb-6">
          <h3 class="font-bold text-white text-lg">Revenue Overview</h3>
          <div class="flex gap-2">
            ${['7D', '30D', '3M', '1Y'].map((p, i) => `
              <button onclick="selectPeriod(this)" class="period-btn px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${i === 1 ? 'bg-indigo-500 text-white' : 'bg-charcoal-200 text-gray-400 hover:text-white'}">
                ${p}
              </button>
            `).join('')}
          </div>
        </div>
        <!-- SVG Chart -->
        <div class="relative h-48">
          <svg viewBox="0 0 800 200" class="w-full h-full" id="revenue-chart">
            <!-- Y axis labels -->
            <text x="0" y="20" fill="#6b7280" font-size="11">$600</text>
            <text x="0" y="70" fill="#6b7280" font-size="11">$400</text>
            <text x="0" y="120" fill="#6b7280" font-size="11">$200</text>
            <text x="0" y="170" fill="#6b7280" font-size="11">$0</text>
            
            <!-- Grid lines -->
            <line x1="30" y1="15" x2="800" y2="15" stroke="#2a2a2a" stroke-width="1"/>
            <line x1="30" y1="65" x2="800" y2="65" stroke="#2a2a2a" stroke-width="1"/>
            <line x1="30" y1="115" x2="800" y2="115" stroke="#2a2a2a" stroke-width="1"/>
            <line x1="30" y1="165" x2="800" y2="165" stroke="#2a2a2a" stroke-width="1"/>
            
            <!-- Area fill -->
            <defs>
              <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#5B2EFF" stop-opacity="0.3"/>
                <stop offset="100%" stop-color="#5B2EFF" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <path d="M30,140 L140,110 L250,90 L360,130 L470,60 L580,40 L690,70 L800,30 L800,165 L30,165 Z" fill="url(#chartGrad)"/>
            <!-- Line -->
            <path d="M30,140 L140,110 L250,90 L360,130 L470,60 L580,40 L690,70 L800,30" fill="none" stroke="#5B2EFF" stroke-width="2.5" stroke-linecap="round"/>
            <!-- Lime accent line (this month) -->
            <path d="M580,40 L690,70 L800,30" fill="none" stroke="#C6FF00" stroke-width="3" stroke-linecap="round"/>
            
            <!-- Data points -->
            ${[{x:30,y:140},{x:140,y:110},{x:250,y:90},{x:360,y:130},{x:470,y:60},{x:580,y:40},{x:690,y:70},{x:800,y:30}].map(p => `
              <circle cx="${p.x}" cy="${p.y}" r="4" fill="${p.x >= 580 ? '#C6FF00' : '#5B2EFF'}" stroke="#121212" stroke-width="2"/>
            `).join('')}
            
            <!-- X axis labels -->
            ${['Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'].map((m, i) => `
              <text x="${30 + i * 110}" y="185" fill="#6b7280" font-size="11" text-anchor="middle">${m}</text>
            `).join('')}
          </svg>
          <div class="absolute top-2 right-0 flex items-center gap-4 text-xs text-gray-400">
            <div class="flex items-center gap-1.5"><div class="w-3 h-1 bg-indigo-500 rounded"></div> Revenue</div>
            <div class="flex items-center gap-1.5"><div class="w-3 h-1 bg-lime-500 rounded"></div> This Month</div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        <!-- Left: Listings + Bookings -->
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
              ${[
                { title: 'Secure Covered Garage', type: 'Garage', rate: 12, status: 'active', bookings: 34, rating: 4.9, revenue: 1840, instant: true },
                { title: 'Private Driveway', type: 'Driveway', rate: 8, status: 'active', bookings: 21, rating: 4.8, revenue: 1100, instant: false },
                { title: 'Open Parking Lot', type: 'Lot', rate: 5, status: 'inactive', bookings: 8, rating: 4.3, revenue: 450, instant: false },
              ].map(l => `
                <div class="p-4 hover:bg-white/5 transition-colors">
                  <div class="flex items-center gap-4">
                    <div class="w-16 h-16 bg-gradient-to-br from-charcoal-300 to-charcoal-400 rounded-xl flex items-center justify-center flex-shrink-0">
                      <i class="fas fa-${l.type === 'Garage' ? 'warehouse' : l.type === 'Driveway' ? 'home' : 'parking'} text-white/30 text-2xl"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 mb-1">
                        <p class="font-bold text-white text-sm">${l.title}</p>
                        <span class="text-xs px-2 py-0.5 rounded-full ${l.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}">${l.status}</span>
                        ${l.instant ? '<span class="text-xs bg-lime-500/20 text-lime-500 px-2 py-0.5 rounded-full">⚡ Instant</span>' : ''}
                      </div>
                      <div class="flex items-center gap-3 text-xs text-gray-400">
                        <span><i class="fas fa-dollar-sign text-indigo-400 mr-1"></i>$${l.rate}/hr</span>
                        <span><i class="fas fa-calendar text-indigo-400 mr-1"></i>${l.bookings} bookings</span>
                        <span><i class="fas fa-star text-amber-400 mr-1"></i>${l.rating}</span>
                        <span class="text-lime-500 font-semibold"><i class="fas fa-dollar-sign mr-0.5"></i>${l.revenue.toLocaleString()} earned</span>
                      </div>
                    </div>
                    <div class="flex flex-col gap-2">
                      <button class="px-3 py-1.5 bg-charcoal-200 hover:bg-indigo-500/20 text-gray-400 hover:text-indigo-300 rounded-xl text-xs font-medium transition-colors border border-white/5">
                        Edit
                      </button>
                      <button onclick="toggleListing(this)" class="px-3 py-1.5 bg-charcoal-200 hover:bg-charcoal-300 text-gray-400 hover:text-white rounded-xl text-xs transition-colors border border-white/5">
                        ${l.status === 'active' ? 'Pause' : 'Activate'}
                      </button>
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Booking Requests -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden">
            <div class="flex items-center justify-between p-5 border-b border-white/5">
              <h3 class="font-bold text-white text-lg">Booking Requests</h3>
              <span class="bg-indigo-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">3</span>
            </div>
            <div class="divide-y divide-white/5">
              ${[
                { name: 'Marcus B.', vehicle: 'Honda Accord', rating: 4.8, reviews: 12, space: 'Covered Garage', date: 'Sat, Mar 8', time: '10am–4pm', price: 72, status: 'pending' },
                { name: 'Sarah K.', vehicle: 'Toyota RAV4', rating: 5.0, reviews: 23, space: 'Private Driveway', date: 'Sun, Mar 9', time: '8am–12pm', price: 32, status: 'pending' },
                { name: 'Derek W.', vehicle: 'F-150 Truck', rating: 4.6, reviews: 7, space: 'Open Parking Lot', date: 'Mon, Mar 10', time: '9am–6pm', price: 40, status: 'pending' },
              ].map(r => `
                <div class="p-4">
                  <div class="flex items-start gap-3">
                    <div class="w-10 h-10 gradient-bg rounded-full flex items-center justify-center font-bold text-white flex-shrink-0">
                      ${r.name[0]}
                    </div>
                    <div class="flex-1">
                      <div class="flex items-center justify-between">
                        <p class="font-semibold text-white text-sm">${r.name}</p>
                        <p class="font-bold text-white text-sm">$${r.price}</p>
                      </div>
                      <div class="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
                        <span><i class="fas fa-car mr-1 text-indigo-400"></i>${r.vehicle}</span>
                        <span><i class="fas fa-star text-amber-400 mr-0.5"></i>${r.rating} (${r.reviews})</span>
                      </div>
                      <p class="text-xs text-gray-500 mt-1">
                        <i class="fas fa-parking text-indigo-400 mr-1"></i>${r.space} · ${r.date} · ${r.time}
                      </p>
                      <div class="flex gap-2 mt-3">
                        <button onclick="acceptBooking(this)" class="flex-1 py-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-xl text-xs font-semibold transition-colors border border-green-500/20">
                          <i class="fas fa-check mr-1"></i> Accept
                        </button>
                        <button onclick="declineBooking(this)" class="flex-1 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl text-xs font-semibold transition-colors border border-red-500/20">
                          <i class="fas fa-times mr-1"></i> Decline
                        </button>
                        <button class="px-3 py-2 bg-charcoal-200 hover:bg-charcoal-300 text-gray-400 rounded-xl text-xs transition-colors">
                          <i class="fas fa-message text-xs"></i>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              `).join('')}
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
          
          <!-- Payout Card -->
          <div class="relative gradient-bg rounded-2xl p-5 overflow-hidden">
            <div class="absolute top-0 right-0 w-32 h-32 bg-lime-500/10 rounded-full blur-2xl"></div>
            <div class="relative z-10">
              <p class="text-white/70 text-sm mb-1">Next Payout</p>
              <p class="text-4xl font-black text-white mb-1">$487<span class="text-indigo-300 text-lg font-normal">.50</span></p>
              <p class="text-indigo-200 text-xs mb-4">Scheduled for March 10, 2026</p>
              <div class="space-y-2 text-sm">
                <div class="flex justify-between text-indigo-200">
                  <span>Active bookings</span>
                  <span class="text-white">$573.00</span>
                </div>
                <div class="flex justify-between text-indigo-200">
                  <span>Platform fee (15%)</span>
                  <span class="text-white">-$85.50</span>
                </div>
                <div class="border-t border-white/20 pt-2 flex justify-between font-bold">
                  <span class="text-white">Your payout</span>
                  <span class="text-lime-400">$487.50</span>
                </div>
              </div>
              <button class="mt-4 w-full py-2.5 bg-lime-500 text-charcoal rounded-xl text-sm font-bold hover:bg-lime-400 transition-colors">
                Manage Payouts
              </button>
            </div>
          </div>

          <!-- Performance -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
            <h3 class="font-bold text-white mb-4">Performance</h3>
            <div class="space-y-4">
              ${[
                { label: 'Occupancy Rate', val: 68, color: 'bg-indigo-500' },
                { label: 'Booking Acceptance', val: 94, color: 'bg-green-500' },
                { label: 'Response Rate', val: 98, color: 'bg-lime-500' },
                { label: 'Guest Satisfaction', val: 97, color: 'bg-amber-500' },
              ].map(p => `
                <div>
                  <div class="flex justify-between text-sm text-gray-400 mb-1.5">
                    <span>${p.label}</span>
                    <span class="text-white font-semibold">${p.val}%</span>
                  </div>
                  <div class="h-2 bg-charcoal-300 rounded-full overflow-hidden">
                    <div class="h-full ${p.color} rounded-full transition-all" style="width:${p.val}%"></div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Recent Reviews -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
            <div class="flex items-center justify-between mb-4">
              <h3 class="font-bold text-white">Recent Reviews</h3>
              <span class="text-xs text-gray-400">See all</span>
            </div>
            <div class="space-y-3">
              ${[
                { name: 'James R.', stars: 5, text: 'Perfect, clean, exactly as described!' },
                { name: 'Lisa T.', stars: 5, text: 'So convenient, will book every time.' },
                { name: 'Carlos M.', stars: 4, text: 'Great spot, easy access.' },
              ].map(r => `
                <div class="p-3 bg-charcoal-200 rounded-xl">
                  <div class="flex items-center justify-between mb-1.5">
                    <p class="text-white text-xs font-semibold">${r.name}</p>
                    <div class="flex gap-0.5">
                      ${Array(r.stars).fill('<i class="fas fa-star text-amber-400 text-xs"></i>').join('')}
                    </div>
                  </div>
                  <p class="text-gray-400 text-xs">"${r.text}"</p>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Tips -->
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
        <!-- Step Indicator -->
        <div class="flex items-center gap-2 mb-6">
          ${['Space Info','Rates & Rules','Photos','Review'].map((step, i) => `
            <div class="flex items-center gap-2 flex-1">
              <div class="w-7 h-7 rounded-full ${i === 0 ? 'gradient-bg text-white' : 'bg-charcoal-200 text-gray-500'} flex items-center justify-center text-xs font-bold flex-shrink-0">${i+1}</div>
              <span class="text-xs ${i === 0 ? 'text-white font-medium' : 'text-gray-500'} hidden sm:block">${step}</span>
              ${i < 3 ? '<div class="flex-1 h-px bg-white/10"></div>' : ''}
            </div>
          `).join('')}
        </div>
        
        <div>
          <label class="text-sm text-gray-400 font-medium block mb-2">Space Title</label>
          <input type="text" placeholder="e.g. Secure Downtown Driveway" class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"/>
        </div>
        <div>
          <label class="text-sm text-gray-400 font-medium block mb-2">Space Type</label>
          <div class="grid grid-cols-3 gap-2">
            ${[{ t: 'Driveway', icon: '🏠' }, { t: 'Garage', icon: '🏗️' }, { t: 'Lot', icon: '🅿️' }, { t: 'Covered', icon: '🏢' }, { t: 'Uncovered', icon: '☁️' }, { t: 'Indoor', icon: '🏛️' }].map(type => `
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
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('border-indigo-500', 'bg-indigo-500/10'));
      btn.classList.add('border-indigo-500', 'bg-indigo-500/10');
    }
    
    let instantEnabled = false;
    function toggleInstant(btn) {
      instantEnabled = !instantEnabled;
      btn.style.backgroundColor = instantEnabled ? '#5B2EFF' : '';
      document.getElementById('instant-dot').style.transform = instantEnabled ? 'translateX(24px)' : '';
    }
    
    function acceptBooking(btn) {
      const card = btn.closest('.p-4');
      btn.closest('.flex').innerHTML = '<span class="text-green-400 text-sm font-semibold flex items-center gap-2"><i class="fas fa-check-circle"></i> Booking Accepted</span>';
    }
    
    function declineBooking(btn) {
      const card = btn.closest('.p-4');
      btn.closest('.flex').innerHTML = '<span class="text-red-400 text-sm font-semibold flex items-center gap-2"><i class="fas fa-times-circle"></i> Booking Declined</span>';
    }

    function selectPeriod(btn) {
      document.querySelectorAll('.period-btn').forEach(b => {
        b.className = 'period-btn px-3 py-1.5 rounded-lg text-xs font-semibold transition-all bg-charcoal-200 text-gray-400 hover:text-white';
      });
      btn.className = 'period-btn px-3 py-1.5 rounded-lg text-xs font-semibold transition-all bg-indigo-500 text-white';
    }
  </script>
  `
  return c.html(Layout('Host Dashboard', content))
})

function generateHostCalendar() {
  const today = new Date()
  const year = today.getFullYear()
  const month = today.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDay = new Date(year, month, 1).getDay()
  const monthName = today.toLocaleString('default', { month: 'long' })
  
  const booked = [5, 6, 7, 12, 13, 19, 20, 26]
  const blocked = [21, 22]
  
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
    const isBooked = booked.includes(d)
    const isBlocked = blocked.includes(d)
    let cls = 'w-8 h-8 mx-auto rounded-lg flex items-center justify-center text-xs cursor-pointer transition-all '
    if (isToday) cls += 'gradient-bg text-white font-bold'
    else if (isBooked) cls += 'bg-indigo-500/30 text-indigo-300 font-medium'
    else if (isBlocked) cls += 'bg-red-500/20 text-red-400 cursor-not-allowed'
    else cls += 'text-gray-400 hover:bg-charcoal-200 hover:text-white'
    html += `<div><div class="${cls}">${d}</div></div>`
  }
  html += `</div>
    <div class="flex flex-wrap items-center gap-3 mt-4 text-xs text-gray-400">
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 gradient-bg rounded"></div> Today</div>
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 bg-indigo-500/30 rounded"></div> Booked</div>
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 bg-red-500/20 rounded"></div> Blocked</div>
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 bg-charcoal-200 rounded"></div> Available</div>
    </div>
  `
  return html
}
