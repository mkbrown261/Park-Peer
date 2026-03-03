import { Hono } from 'hono'
import { Layout } from '../components/layout'

export const listingPage = new Hono()

listingPage.get('/:id', (c) => {
  const id = c.req.param('id')
  const listings: Record<string, any> = {
    '1': { title: 'Secure Covered Garage', type: 'Garage', address: '120 S Michigan Ave, Chicago, IL 60603', price: 12, daily: 55, monthly: 320, rating: 4.9, reviews: 142, host: 'Jennifer K.', hostRating: 4.95, hostJoined: 'Jan 2023', responseTime: '< 1 hour', features: ['CCTV', 'Covered', 'EV Charging', '24/7 Access', 'Gated', 'Lighting'], desc: 'Premium covered garage space in the heart of downtown. Perfect for commuters and event-goers. The spot is well-lit, monitored 24/7 by CCTV, and features EV charging capability. Easy access from Michigan Ave with clearance for full-size SUVs.', maxSize: 'SUV / Full-Size', cancellation: 'Free cancellation up to 1 hour before', security: 'Camera + Gated + Lighting' },
    '2': { title: 'Private Driveway — Wrigley', type: 'Driveway', address: '3614 N Clark St, Chicago, IL 60613', price: 8, daily: 35, monthly: 180, rating: 4.8, reviews: 89, host: 'Marcus T.', hostRating: 4.88, hostJoined: 'Mar 2023', responseTime: '< 30 min', features: ['Gated', 'Lighting', 'Street Access'], desc: 'Private driveway 1 block from Wrigley Field. Perfect for Cubs games and events at Wrigleyville. The driveway fits 2 vehicles side-by-side. Gated entry with remote access provided upon booking.', maxSize: 'Sedan / Midsize', cancellation: 'Free cancellation up to 2 hours before', security: 'Gated + Lighting' },
  }
  const l = listings[id] || listings['1']
  
  const content = `
  <div class="pt-16">
    <div class="max-w-7xl mx-auto px-4 py-8">
      <!-- Breadcrumb -->
      <div class="flex items-center gap-2 text-sm text-gray-500 mb-6">
        <a href="/" class="hover:text-white transition-colors">Home</a>
        <i class="fas fa-chevron-right text-xs"></i>
        <a href="/search" class="hover:text-white transition-colors">Chicago</a>
        <i class="fas fa-chevron-right text-xs"></i>
        <span class="text-gray-300">${l.title}</span>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <!-- Main Content -->
        <div class="lg:col-span-2 space-y-6">
          <!-- Photo Gallery -->
          <div class="grid grid-cols-4 gap-2 h-64 md:h-80 rounded-2xl overflow-hidden">
            <div class="col-span-2 row-span-2 bg-gradient-to-br from-charcoal-300 to-charcoal-400 flex items-center justify-center relative group cursor-pointer">
              <i class="fas fa-${l.type === 'Garage' ? 'warehouse' : 'home'} text-6xl text-white/15"></i>
              <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                <i class="fas fa-expand text-white opacity-0 group-hover:opacity-100 transition-opacity text-2xl"></i>
              </div>
              <span class="absolute bottom-3 left-3 bg-black/60 text-white text-xs px-2 py-1 rounded-lg">Main View</span>
            </div>
            ${['Entry View', 'Interior', 'Night View'].map(label => `
              <div class="bg-gradient-to-br from-charcoal-200 to-charcoal-300 rounded-sm flex items-center justify-center relative cursor-pointer group">
                <i class="fas fa-image text-white/10 text-2xl"></i>
                <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all"></div>
                <span class="absolute bottom-1 left-1 text-gray-500 text-xs">${label}</span>
              </div>
            `).join('')}
          </div>

          <!-- Header -->
          <div>
            <div class="flex items-start justify-between gap-4">
              <div>
                <div class="flex items-center gap-2 mb-2">
                  <span class="bg-indigo-500/20 text-indigo-400 text-xs font-semibold px-3 py-1 rounded-full">
                    <i class="fas fa-${l.type === 'Garage' ? 'warehouse' : l.type === 'Driveway' ? 'home' : 'parking'} mr-1"></i>${l.type}
                  </span>
                  <span class="bg-lime-500/10 text-lime-500 text-xs font-semibold px-3 py-1 rounded-full">
                    ⚡ Instant Book
                  </span>
                </div>
                <h1 class="text-2xl md:text-3xl font-black text-white">${l.title}</h1>
                <p class="text-gray-400 mt-1 flex items-center gap-2">
                  <i class="fas fa-map-pin text-indigo-400"></i>
                  ${l.address}
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
                <span class="font-bold text-white text-lg">${l.rating}</span>
                <span class="text-gray-400">(${l.reviews} reviews)</span>
              </div>
              <span class="text-gray-600">·</span>
              <span class="text-gray-400 text-sm">${l.maxSize}</span>
            </div>
          </div>

          <!-- Description -->
          <div class="bg-charcoal-100 rounded-2xl p-6 border border-white/5">
            <h2 class="text-lg font-bold text-white mb-3">About This Space</h2>
            <p class="text-gray-300 leading-relaxed">${l.desc}</p>
          </div>

          <!-- Features -->
          <div class="bg-charcoal-100 rounded-2xl p-6 border border-white/5">
            <h2 class="text-lg font-bold text-white mb-4">Features & Amenities</h2>
            <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
              ${l.features.map((f: string) => {
                const icons: Record<string, string> = { 'CCTV': 'fa-video', 'Covered': 'fa-umbrella', 'EV Charging': 'fa-bolt', '24/7 Access': 'fa-clock', 'Gated': 'fa-lock', 'Lighting': 'fa-lightbulb', 'Shuttle': 'fa-shuttle-space', 'Street Access': 'fa-road' }
                return `
                  <div class="flex items-center gap-3 p-3 bg-charcoal-200 rounded-xl">
                    <i class="fas ${icons[f] || 'fa-check'} text-indigo-400 w-4 text-center"></i>
                    <span class="text-sm text-gray-300">${f}</span>
                  </div>
                `
              }).join('')}
            </div>
          </div>

          <!-- Details Grid -->
          <div class="bg-charcoal-100 rounded-2xl p-6 border border-white/5">
            <h2 class="text-lg font-bold text-white mb-4">Parking Details</h2>
            <div class="grid grid-cols-2 gap-4">
              ${[
                { label: 'Space Type', val: l.type, icon: 'fa-parking' },
                { label: 'Max Vehicle Size', val: l.maxSize, icon: 'fa-car' },
                { label: 'Security', val: l.security, icon: 'fa-shield-halved' },
                { label: 'Cancellation', val: l.cancellation, icon: 'fa-calendar-xmark' },
              ].map(d => `
                <div class="flex gap-3">
                  <div class="w-9 h-9 bg-indigo-500/10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                    <i class="fas ${d.icon} text-indigo-400 text-sm"></i>
                  </div>
                  <div>
                    <p class="text-xs text-gray-500 mb-0.5">${d.label}</p>
                    <p class="text-sm text-white font-medium">${d.val}</p>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Availability Calendar -->
          <div class="bg-charcoal-100 rounded-2xl p-6 border border-white/5">
            <h2 class="text-lg font-bold text-white mb-4">
              <i class="fas fa-calendar text-indigo-400 mr-2"></i>Availability
            </h2>
            <div id="mini-calendar" class="text-sm">
              ${generateMiniCalendar()}
            </div>
          </div>

          <!-- Reviews -->
          <div class="bg-charcoal-100 rounded-2xl p-6 border border-white/5">
            <div class="flex items-center justify-between mb-6">
              <h2 class="text-lg font-bold text-white flex items-center gap-2">
                <i class="fas fa-star text-amber-400"></i>
                ${l.rating} · ${l.reviews} Reviews
              </h2>
            </div>
            <!-- Rating Breakdown -->
            <div class="grid grid-cols-2 gap-6 mb-6">
              <div class="space-y-2">
                ${[5,4,3,2,1].map((star, i) => {
                  const counts = [72, 45, 18, 5, 2]
                  const pct = Math.round(counts[i] / l.reviews * 100)
                  return `
                    <div class="flex items-center gap-2 text-sm">
                      <span class="text-gray-400 w-3">${star}</span>
                      <i class="fas fa-star text-amber-400 text-xs"></i>
                      <div class="flex-1 bg-charcoal-200 rounded-full h-1.5">
                        <div class="bg-amber-400 h-1.5 rounded-full" style="width:${pct}%"></div>
                      </div>
                      <span class="text-gray-500 w-8 text-right">${pct}%</span>
                    </div>
                  `
                }).join('')}
              </div>
              <div class="grid grid-cols-2 gap-2 text-center">
                ${['Accuracy','Location','Value','Safety'].map(cat => `
                  <div class="bg-charcoal-200 rounded-xl p-2">
                    <p class="text-xl font-black text-white">4.${Math.floor(Math.random()*3+7)}</p>
                    <p class="text-xs text-gray-400">${cat}</p>
                  </div>
                `).join('')}
              </div>
            </div>
            <!-- Review List -->
            <div class="space-y-4">
              ${[
                { name: 'David L.', avatar: 'D', date: 'Feb 2026', stars: 5, comment: 'Exactly as described. Clean, safe, easy to find. Jennifer was super responsive. Will definitely book again!' },
                { name: 'Priya S.', avatar: 'P', date: 'Jan 2026', stars: 5, comment: 'Best parking in the area for the price. The EV charging was a huge bonus. Highly recommend.' },
                { name: 'Carlos M.', avatar: 'C', date: 'Jan 2026', stars: 4, comment: 'Great spot, covered and secure. The entry gate took a minute to figure out but host was quick to help.' },
              ].map(r => `
                <div class="border-t border-white/5 pt-4">
                  <div class="flex items-center gap-3 mb-2">
                    <div class="w-9 h-9 gradient-bg rounded-full flex items-center justify-center font-bold text-sm text-white flex-shrink-0">${r.avatar}</div>
                    <div>
                      <p class="font-semibold text-white text-sm">${r.name}</p>
                      <p class="text-gray-500 text-xs">${r.date}</p>
                    </div>
                    <div class="flex ml-auto gap-0.5">
                      ${Array(r.stars).fill('<i class="fas fa-star text-amber-400 text-xs"></i>').join('')}
                    </div>
                  </div>
                  <p class="text-gray-300 text-sm leading-relaxed">${r.comment}</p>
                </div>
              `).join('')}
            </div>
            <button class="mt-4 w-full py-3 bg-charcoal-200 text-gray-400 hover:text-white rounded-xl text-sm transition-colors border border-white/5">
              Show All ${l.reviews} Reviews
            </button>
          </div>

          <!-- Location Map -->
          <div class="bg-charcoal-100 rounded-2xl p-6 border border-white/5">
            <h2 class="text-lg font-bold text-white mb-4"><i class="fas fa-map text-indigo-400 mr-2"></i>Location</h2>
            <div class="h-48 bg-gradient-to-br from-charcoal-300 to-charcoal-400 rounded-xl flex items-center justify-center relative overflow-hidden">
              <div class="absolute inset-0" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);">
                <svg class="w-full h-full opacity-10"><rect width="100%" height="100%" fill="url(#grid)"/></svg>
              </div>
              <div class="relative text-center">
                <div class="w-10 h-10 gradient-bg rounded-full flex items-center justify-center mx-auto mb-2 glow-indigo">
                  <i class="fas fa-parking text-white"></i>
                </div>
                <p class="text-white text-sm font-medium">${l.address}</p>
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
                <span class="text-3xl font-black text-white">$${l.price}</span>
                <span class="text-gray-400">/hour</span>
              </div>
              <div class="flex gap-3 mb-4 text-sm text-gray-400">
                <span class="text-white font-semibold">$${l.daily}</span>/day
                <span>·</span>
                <span class="text-white font-semibold">$${l.monthly}</span>/month
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
                  <span>$${l.price}/hr × <span id="hours-count">3</span> hours</span>
                  <span id="base-price">$${l.price * 3}</span>
                </div>
                <div class="flex justify-between text-gray-300">
                  <span>Service fee (15%)</span>
                  <span id="service-fee">$${Math.round(l.price * 3 * 0.15)}</span>
                </div>
                <div class="border-t border-white/10 pt-2 flex justify-between font-bold text-white">
                  <span>Total</span>
                  <span id="total-price">$${Math.round(l.price * 3 * 1.15)}</span>
                </div>
              </div>

              <a href="/booking/${id}" class="btn-primary w-full flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-white text-base mb-3">
                <i class="fas fa-bolt"></i>
                Reserve Now
              </a>
              <p class="text-center text-gray-500 text-xs mb-4">You won't be charged yet · Free cancellation</p>

              <!-- Guarantee -->
              <div class="flex items-start gap-2 text-xs text-gray-500">
                <i class="fas fa-shield-halved text-green-400 mt-0.5"></i>
                <p>Protected by ParkPeer Guarantee. Refund if space unavailable on arrival.</p>
              </div>
            </div>

            <!-- Host Card -->
            <div class="bg-charcoal-100 border border-white/5 rounded-2xl p-5 mt-4">
              <div class="flex items-center gap-3 mb-4">
                <div class="w-12 h-12 gradient-bg rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                  ${l.host[0]}
                </div>
                <div>
                  <p class="font-bold text-white">Hosted by ${l.host}</p>
                  <div class="flex items-center gap-1 text-xs text-gray-400">
                    <i class="fas fa-star text-amber-400"></i>
                    <span>${l.hostRating} · Member since ${l.hostJoined}</span>
                  </div>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-2 text-xs">
                <div class="bg-charcoal-200 rounded-xl p-2.5 text-center">
                  <p class="text-gray-400">Response time</p>
                  <p class="font-semibold text-white mt-0.5">${l.responseTime}</p>
                </div>
                <div class="bg-charcoal-200 rounded-xl p-2.5 text-center">
                  <p class="text-gray-400">Response rate</p>
                  <p class="font-semibold text-white mt-0.5">98%</p>
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
    // Set default times
    const now = new Date();
    const later = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const toInputVal = (d) => d.toISOString().slice(0,16);
    document.getElementById('arrive-dt').value = toInputVal(now);
    document.getElementById('depart-dt').value = toInputVal(later);
    document.getElementById('arrive-dt').min = toInputVal(now);

    function updatePrice() {
      const arrive = new Date(document.getElementById('arrive-dt').value);
      const depart = new Date(document.getElementById('depart-dt').value);
      if (!arrive || !depart || depart <= arrive) return;
      const hours = Math.max(1, Math.round((depart - arrive) / 3600000));
      const base = ${l.price} * hours;
      const fee = Math.round(base * 0.15);
      const total = base + fee;
      document.getElementById('hours-count').textContent = hours;
      document.getElementById('base-price').textContent = '$' + base;
      document.getElementById('service-fee').textContent = '$' + fee;
      document.getElementById('total-price').textContent = '$' + total;
    }

    document.getElementById('arrive-dt').addEventListener('change', updatePrice);
    document.getElementById('depart-dt').addEventListener('change', updatePrice);
  </script>
  `
  return c.html(Layout(l.title, content))
})

function generateMiniCalendar() {
  const today = new Date()
  const year = today.getFullYear()
  const month = today.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDay = new Date(year, month, 1).getDay()
  const monthName = today.toLocaleString('default', { month: 'long' })
  
  const unavailable = [3, 7, 8, 14, 21, 22, 28]
  
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
    const isToday = d === today.getDate()
    const isUnavail = unavailable.includes(d)
    const isPast = d < today.getDate()
    let cls = 'w-8 h-8 mx-auto rounded-full flex items-center justify-center text-xs cursor-pointer transition-all '
    if (isToday) cls += 'gradient-bg text-white font-bold glow-indigo'
    else if (isUnavail) cls += 'bg-red-500/10 text-red-400/60 cursor-not-allowed'
    else if (isPast) cls += 'text-gray-600 cursor-not-allowed'
    else cls += 'text-gray-300 hover:bg-indigo-500/20 hover:text-white'
    html += `<div><div class="${cls}">${d}</div></div>`
  }
  html += `</div>
    <div class="flex items-center gap-4 mt-4 text-xs text-gray-400">
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 gradient-bg rounded-full"></div> Today</div>
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 bg-red-500/20 rounded-full"></div> Unavailable</div>
      <div class="flex items-center gap-1.5"><div class="w-3 h-3 bg-charcoal-200 rounded-full border border-white/10"></div> Available</div>
    </div>
  `
  return html
}
