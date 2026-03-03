import { Hono } from 'hono'
import { Layout } from '../components/layout'

export const driverDashboard = new Hono()

driverDashboard.get('/', (c) => {
  const content = `
  <div class="pt-16 min-h-screen">
    <div class="max-w-7xl mx-auto px-4 py-8">
      
      <!-- Dashboard Header -->
      <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 class="text-3xl font-black text-white">Driver Dashboard</h1>
          <p class="text-gray-400 mt-1">Welcome back, <span class="text-indigo-400 font-semibold">Alex</span> 👋</p>
        </div>
        <div class="flex gap-3">
          <a href="/search" class="btn-primary px-5 py-2.5 rounded-xl text-white font-semibold text-sm flex items-center gap-2">
            <i class="fas fa-search-location"></i> Find Parking
          </a>
          <button class="px-5 py-2.5 rounded-xl bg-charcoal-100 border border-white/10 text-gray-300 hover:text-white text-sm font-medium transition-colors flex items-center gap-2">
            <i class="fas fa-bell text-indigo-400"></i> Alerts <span class="ml-1 w-5 h-5 bg-indigo-500 rounded-full text-xs flex items-center justify-center text-white">3</span>
          </button>
        </div>
      </div>

      <!-- Stats Row -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        ${[
          { label: 'Total Bookings', val: '34', change: '+3 this month', icon: 'fa-calendar-check', color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
          { label: 'Money Saved', val: '$1,240', change: 'vs street parking', icon: 'fa-piggy-bank', color: 'text-lime-500', bg: 'bg-lime-500/10' },
          { label: 'Avg Rating Given', val: '4.7', change: 'As a driver', icon: 'fa-star', color: 'text-amber-400', bg: 'bg-amber-500/10' },
          { label: 'Favorite Spots', val: '8', change: 'Saved locations', icon: 'fa-heart', color: 'text-red-400', bg: 'bg-red-500/10' },
        ].map(s => `
          <div class="stat-card rounded-2xl p-5 card-hover">
            <div class="flex items-start justify-between mb-3">
              <div class="w-10 h-10 ${s.bg} rounded-xl flex items-center justify-center">
                <i class="fas ${s.icon} ${s.color}"></i>
              </div>
            </div>
            <p class="text-2xl font-black text-white">${s.val}</p>
            <p class="text-gray-400 text-xs mt-1 font-medium">${s.label}</p>
            <p class="text-gray-500 text-xs mt-0.5">${s.change}</p>
          </div>
        `).join('')}
      </div>

      <!-- Main Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        <!-- Active Booking -->
        <div class="lg:col-span-2 space-y-6">
          
          <!-- Active Booking Card -->
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
              <h3 class="text-xl font-black text-white mb-1">Secure Covered Garage</h3>
              <p class="text-indigo-200 text-sm mb-4">
                <i class="fas fa-map-pin mr-1"></i>120 S Michigan Ave, Chicago
              </p>
              <div class="grid grid-cols-3 gap-3 mb-5">
                <div class="bg-white/10 rounded-xl p-3 text-center">
                  <p class="text-white/60 text-xs">Arrived</p>
                  <p class="font-bold text-white">10:00 AM</p>
                </div>
                <div class="bg-white/10 rounded-xl p-3 text-center">
                  <p class="text-white/60 text-xs">Depart By</p>
                  <p class="font-bold text-white">2:00 PM</p>
                </div>
                <div class="bg-white/10 rounded-xl p-3 text-center">
                  <p class="text-white/60 text-xs">Time Left</p>
                  <p class="font-bold text-lime-400" id="countdown">1h 42m</p>
                </div>
              </div>
              <div class="flex gap-3">
                <button class="flex-1 bg-white/10 hover:bg-white/20 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
                  <i class="fas fa-qrcode"></i> View QR
                </button>
                <button class="flex-1 bg-white/10 hover:bg-white/20 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
                  <i class="fas fa-map"></i> Navigate
                </button>
                <button class="flex-1 bg-red-500/30 hover:bg-red-500/50 text-red-300 font-semibold py-2.5 rounded-xl text-sm transition-colors">
                  End Early
                </button>
              </div>
            </div>
          </div>

          <!-- Upcoming Reservations -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden">
            <div class="flex items-center justify-between p-5 border-b border-white/5">
              <h3 class="font-bold text-white text-lg">Upcoming Reservations</h3>
              <button class="text-indigo-400 hover:text-indigo-300 text-sm font-medium transition-colors">View All</button>
            </div>
            <div class="divide-y divide-white/5">
              ${[
                { title: 'Wrigley Driveway', date: 'Sat, Mar 8', time: '5:00 PM – 9:00 PM', price: 32, status: 'confirmed', statusColor: 'text-green-400', icon: 'fa-baseball' },
                { title: "O'Hare Airport Lot", date: 'Mon, Mar 10', time: '8:00 AM – 6:00 PM', price: 100, status: 'confirmed', statusColor: 'text-green-400', icon: 'fa-plane-departure' },
                { title: 'Navy Pier Spot', date: 'Fri, Mar 14', time: '6:00 PM – 10:00 PM', price: 40, status: 'pending', statusColor: 'text-amber-400', icon: 'fa-ship' },
              ].map(b => `
                <div class="flex items-center gap-4 p-4 hover:bg-white/5 transition-colors">
                  <div class="w-10 h-10 gradient-bg rounded-xl flex items-center justify-center flex-shrink-0">
                    <i class="fas ${b.icon} text-white text-sm"></i>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="font-semibold text-white text-sm truncate">${b.title}</p>
                    <p class="text-gray-500 text-xs mt-0.5">${b.date} · ${b.time}</p>
                  </div>
                  <div class="text-right flex-shrink-0">
                    <p class="font-bold text-white text-sm">$${b.price}</p>
                    <p class="text-xs ${b.statusColor} mt-0.5 capitalize">${b.status}</p>
                  </div>
                  <button class="w-8 h-8 bg-charcoal-200 rounded-xl flex items-center justify-center text-gray-400 hover:text-white transition-colors ml-1">
                    <i class="fas fa-chevron-right text-xs"></i>
                  </button>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Booking History -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden">
            <div class="flex items-center justify-between p-5 border-b border-white/5">
              <h3 class="font-bold text-white text-lg">Booking History</h3>
              <button class="text-indigo-400 hover:text-indigo-300 text-sm font-medium transition-colors">Export</button>
            </div>
            <div class="divide-y divide-white/5">
              ${[
                { title: 'Downtown Garage', date: 'Feb 28, 2026', price: 24, status: 'completed', rating: 5 },
                { title: 'River North Driveway', date: 'Feb 22, 2026', price: 18, status: 'completed', rating: 4 },
                { title: 'Millennium Park Lot', date: 'Feb 14, 2026', price: 35, status: 'completed', rating: 5 },
                { title: 'Lakeshore Covered', date: 'Feb 7, 2026', price: 42, status: 'cancelled', rating: 0 },
              ].map(h => `
                <div class="flex items-center gap-4 p-4 hover:bg-white/5 transition-colors">
                  <div class="w-10 h-10 bg-charcoal-200 rounded-xl flex items-center justify-center flex-shrink-0">
                    <i class="fas fa-parking text-gray-400"></i>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="font-medium text-white text-sm truncate">${h.title}</p>
                    <p class="text-gray-500 text-xs mt-0.5">${h.date}</p>
                  </div>
                  <div class="flex items-center gap-2">
                    ${h.rating > 0 ? `<div class="flex gap-0.5">${Array(h.rating).fill('<i class="fas fa-star text-amber-400 text-xs"></i>').join('')}</div>` : '<span class="text-xs text-red-400">Cancelled</span>'}
                  </div>
                  <p class="font-semibold text-${h.status === 'cancelled' ? 'red-400' : 'white'} text-sm flex-shrink-0">$${h.price}</p>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Right Sidebar -->
        <div class="space-y-6">
          
          <!-- Profile Card -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
            <div class="flex items-center gap-3 mb-4">
              <div class="relative">
                <div class="w-14 h-14 gradient-bg rounded-2xl flex items-center justify-center text-white text-xl font-black">A</div>
                <div class="absolute -bottom-1 -right-1 w-5 h-5 bg-lime-500 rounded-full flex items-center justify-center">
                  <i class="fas fa-check text-charcoal text-xs font-bold"></i>
                </div>
              </div>
              <div>
                <p class="font-bold text-white text-lg">Alex Martinez</p>
                <p class="text-gray-400 text-xs">Driver · Member since 2024</p>
                <div class="flex items-center gap-1 mt-1">
                  <i class="fas fa-star text-amber-400 text-xs"></i>
                  <span class="text-white text-sm font-semibold">4.9</span>
                  <span class="text-gray-500 text-xs">driver rating</span>
                </div>
              </div>
            </div>
            <div class="space-y-2 text-sm">
              <div class="flex items-center gap-2 text-gray-400">
                <i class="fas fa-id-card text-indigo-400 w-4"></i>
                <span>ID Verified</span>
                <i class="fas fa-check text-green-400 ml-auto"></i>
              </div>
              <div class="flex items-center gap-2 text-gray-400">
                <i class="fas fa-phone text-indigo-400 w-4"></i>
                <span>Phone Verified</span>
                <i class="fas fa-check text-green-400 ml-auto"></i>
              </div>
              <div class="flex items-center gap-2 text-gray-400">
                <i class="fas fa-envelope text-indigo-400 w-4"></i>
                <span>Email Verified</span>
                <i class="fas fa-check text-green-400 ml-auto"></i>
              </div>
            </div>
            <button class="mt-4 w-full py-2.5 bg-charcoal-200 border border-white/10 text-gray-300 hover:text-white rounded-xl text-sm font-medium transition-colors">
              Edit Profile
            </button>
          </div>

          <!-- Payment Methods -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
            <div class="flex items-center justify-between mb-4">
              <h3 class="font-bold text-white">Payment Methods</h3>
              <button class="text-indigo-400 text-sm font-medium hover:text-indigo-300">+ Add</button>
            </div>
            <div class="space-y-2">
              ${[
                { brand: 'Visa', last4: '4242', expiry: '12/27', default: true },
                { brand: 'Mastercard', last4: '8541', expiry: '08/26', default: false },
              ].map(card => `
                <div class="flex items-center gap-3 p-3 bg-charcoal-200 rounded-xl border ${card.default ? 'border-indigo-500/40' : 'border-white/5'}">
                  <div class="w-9 h-7 bg-gradient-to-r ${card.brand === 'Visa' ? 'from-blue-600 to-blue-800' : 'from-orange-500 to-red-600'} rounded-md flex items-center justify-center">
                    <span class="text-white text-xs font-black">${card.brand === 'Visa' ? 'VISA' : 'MC'}</span>
                  </div>
                  <div class="flex-1">
                    <p class="text-white text-sm font-medium">•••• ${card.last4}</p>
                    <p class="text-gray-500 text-xs">Exp ${card.expiry}</p>
                  </div>
                  ${card.default ? '<span class="text-xs bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full">Default</span>' : ''}
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Saved Spots -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
            <div class="flex items-center justify-between mb-4">
              <h3 class="font-bold text-white">Saved Spots</h3>
              <a href="/search" class="text-indigo-400 text-sm font-medium hover:text-indigo-300">Browse</a>
            </div>
            <div class="space-y-2">
              ${[
                { name: 'Work Garage', address: '120 S Michigan', price: 12 },
                { name: 'Wrigley Driveway', address: '3614 N Clark', price: 8 },
                { name: 'Airport Lot', address: 'Near ORD T1', price: 14 },
              ].map(s => `
                <a href="/search" class="flex items-center gap-3 p-2.5 hover:bg-charcoal-200 rounded-xl transition-colors group">
                  <div class="w-8 h-8 bg-red-500/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <i class="fas fa-heart text-red-400 text-sm"></i>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-white text-sm font-medium truncate">${s.name}</p>
                    <p class="text-gray-500 text-xs truncate">${s.address}</p>
                  </div>
                  <span class="text-gray-400 text-sm group-hover:text-white">$${s.price}/hr</span>
                </a>
              `).join('')}
            </div>
          </div>

          <!-- Quick Actions -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
            <h3 class="font-bold text-white mb-4">Quick Actions</h3>
            <div class="grid grid-cols-2 gap-2">
              ${[
                { label: 'Book Now', icon: 'fa-search', href: '/search', color: 'text-indigo-400' },
                { label: 'View Map', icon: 'fa-map', href: '/search', color: 'text-lime-500' },
                { label: 'Support', icon: 'fa-headset', href: '#', color: 'text-blue-400' },
                { label: 'Receipts', icon: 'fa-receipt', href: '#', color: 'text-amber-400' },
              ].map(a => `
                <a href="${a.href}" class="flex flex-col items-center gap-2 p-3 bg-charcoal-200 hover:bg-charcoal-300 rounded-xl text-center transition-colors group">
                  <i class="fas ${a.icon} ${a.color} text-xl"></i>
                  <span class="text-xs text-gray-400 group-hover:text-white">${a.label}</span>
                </a>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    // Live countdown timer
    function updateCountdown() {
      const depart = new Date();
      depart.setHours(14, 0, 0, 0);
      const now = new Date();
      const diff = depart - now;
      if (diff <= 0) {
        document.getElementById('countdown').textContent = 'Expired';
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      document.getElementById('countdown').textContent = h + 'h ' + m + 'm';
    }
    updateCountdown();
    setInterval(updateCountdown, 60000);
  </script>
  `
  return c.html(Layout('Driver Dashboard', content))
})
