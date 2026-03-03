import { Hono } from 'hono'
import { Layout } from '../components/layout'

export const adminPanel = new Hono()

adminPanel.get('/', (c) => {
  const content = `
  <div class="pt-16 min-h-screen">
    <div class="flex h-screen overflow-hidden">
      
      <!-- Admin Sidebar -->
      <div class="w-64 bg-charcoal-100 border-r border-white/5 flex flex-col flex-shrink-0 hidden lg:flex">
        <div class="p-5 border-b border-white/5">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 gradient-bg rounded-xl flex items-center justify-center">
              <i class="fas fa-shield-halved text-white"></i>
            </div>
            <div>
              <p class="font-bold text-white text-sm">Admin Panel</p>
              <p class="text-xs text-gray-500">ParkPeer HQ</p>
            </div>
          </div>
        </div>
        
        <nav class="flex-1 p-3 overflow-y-auto">
          <p class="text-xs text-gray-600 uppercase tracking-wider font-medium mb-2 px-2">Overview</p>
          ${[
            { label: 'Dashboard', icon: 'fa-gauge-high', active: true, badge: '' },
            { label: 'Analytics', icon: 'fa-chart-line', active: false, badge: '' },
            { label: 'Revenue', icon: 'fa-dollar-sign', active: false, badge: '' },
          ].map(item => `
            <button onclick="switchSection('${item.label.toLowerCase()}')" class="admin-nav w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 text-sm transition-all ${item.active ? 'bg-indigo-500/20 text-indigo-300 font-semibold' : 'text-gray-400 hover:bg-white/5 hover:text-white'}">
              <i class="fas ${item.icon} w-4 text-center"></i>
              ${item.label}
            </button>
          `).join('')}
          
          <p class="text-xs text-gray-600 uppercase tracking-wider font-medium mb-2 px-2 mt-4">Management</p>
          ${[
            { label: 'Users', icon: 'fa-users', badge: '2' },
            { label: 'Listings', icon: 'fa-parking', badge: '5' },
            { label: 'Bookings', icon: 'fa-calendar-check', badge: '' },
            { label: 'Payments', icon: 'fa-credit-card', badge: '' },
            { label: 'Reviews', icon: 'fa-star', badge: '' },
          ].map(item => `
            <button onclick="switchSection('${item.label.toLowerCase()}')" class="admin-nav w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 text-sm transition-all text-gray-400 hover:bg-white/5 hover:text-white">
              <i class="fas ${item.icon} w-4 text-center"></i>
              <span class="flex-1 text-left">${item.label}</span>
              ${item.badge ? `<span class="w-5 h-5 bg-indigo-500 rounded-full text-xs font-bold text-white flex items-center justify-center">${item.badge}</span>` : ''}
            </button>
          `).join('')}
          
          <p class="text-xs text-gray-600 uppercase tracking-wider font-medium mb-2 px-2 mt-4">Support</p>
          ${[
            { label: 'Disputes', icon: 'fa-gavel', badge: '3' },
            { label: 'Fraud Alerts', icon: 'fa-triangle-exclamation', badge: '1' },
            { label: 'Reports', icon: 'fa-flag', badge: '' },
            { label: 'Settings', icon: 'fa-gear', badge: '' },
          ].map(item => `
            <button onclick="switchSection('${item.label.toLowerCase().replace(' ','')}')" class="admin-nav w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 text-sm transition-all text-gray-400 hover:bg-white/5 hover:text-white ${item.label === 'Fraud Alerts' ? 'text-amber-400/70' : ''}">
              <i class="fas ${item.icon} w-4 text-center ${item.label === 'Fraud Alerts' ? 'text-amber-400' : ''}"></i>
              <span class="flex-1 text-left">${item.label}</span>
              ${item.badge ? `<span class="w-5 h-5 ${item.label === 'Fraud Alerts' ? 'bg-amber-500' : 'bg-red-500'} rounded-full text-xs font-bold text-white flex items-center justify-center">${item.badge}</span>` : ''}
            </button>
          `).join('')}
        </nav>

        <div class="p-4 border-t border-white/5">
          <div class="flex items-center gap-2 mb-3">
            <div class="w-8 h-8 gradient-bg rounded-full flex items-center justify-center text-white text-xs font-bold">SA</div>
            <div>
              <p class="text-white text-xs font-semibold">Super Admin</p>
              <p class="text-gray-500 text-xs">admin@parkpeer.com</p>
            </div>
          </div>
          <a href="/" class="flex items-center gap-2 text-gray-400 hover:text-white text-xs transition-colors">
            <i class="fas fa-arrow-left"></i> Back to App
          </a>
        </div>
      </div>

      <!-- Main Content -->
      <div class="flex-1 overflow-y-auto p-6">
        
        <!-- Header -->
        <div class="flex items-center justify-between mb-6">
          <div>
            <h1 class="text-2xl font-black text-white" id="section-title">Dashboard Overview</h1>
            <p class="text-gray-400 text-sm mt-0.5">March 3, 2026 · All systems operational</p>
          </div>
          <div class="flex items-center gap-2">
            <div class="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-full px-3 py-1.5">
              <div class="w-2 h-2 bg-green-500 rounded-full pulse-dot"></div>
              <span class="text-green-400 text-xs font-medium">System Healthy</span>
            </div>
            <button class="px-4 py-2 bg-charcoal-100 border border-white/10 rounded-xl text-gray-400 hover:text-white text-sm transition-colors">
              <i class="fas fa-rotate-right mr-1"></i> Refresh
            </button>
          </div>
        </div>

        <!-- Key Metrics -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          ${[
            { label: 'Total Revenue (MTD)', val: '$84,320', change: '+22%', icon: 'fa-dollar-sign', color: 'text-lime-500', bg: 'bg-lime-500/10', positive: true },
            { label: 'Total Bookings', val: '2,847', change: '+15%', icon: 'fa-calendar-check', color: 'text-indigo-400', bg: 'bg-indigo-500/10', positive: true },
            { label: 'Active Users', val: '12,441', change: '+8%', icon: 'fa-users', color: 'text-blue-400', bg: 'bg-blue-500/10', positive: true },
            { label: 'Platform Fees', val: '$14,256', change: '+22%', icon: 'fa-piggy-bank', color: 'text-amber-400', bg: 'bg-amber-500/10', positive: true },
          ].map(s => `
            <div class="stat-card rounded-2xl p-5">
              <div class="flex items-start justify-between mb-3">
                <div class="w-10 h-10 ${s.bg} rounded-xl flex items-center justify-center">
                  <i class="fas ${s.icon} ${s.color}"></i>
                </div>
                <span class="text-xs ${s.positive ? 'text-green-400' : 'text-red-400'} font-semibold">${s.change}</span>
              </div>
              <p class="text-2xl font-black text-white">${s.val}</p>
              <p class="text-gray-400 text-xs mt-1">${s.label}</p>
            </div>
          `).join('')}
        </div>

        <!-- Alert Banner -->
        <div class="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl mb-6">
          <i class="fas fa-triangle-exclamation text-amber-400 text-lg flex-shrink-0"></i>
          <div class="flex-1">
            <p class="text-white font-semibold text-sm">Fraud Alert: Suspicious booking activity detected</p>
            <p class="text-amber-300/70 text-xs mt-0.5">User #44291 made 12 bookings in 2 hours from different IP addresses</p>
          </div>
          <div class="flex gap-2">
            <button class="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-lg text-xs font-semibold transition-colors">Review</button>
            <button class="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-xs font-semibold transition-colors">Suspend</button>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          
          <!-- User Management -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden">
            <div class="flex items-center justify-between p-5 border-b border-white/5">
              <h3 class="font-bold text-white">Recent Users</h3>
              <button class="text-indigo-400 text-sm font-medium hover:text-indigo-300 transition-colors">View All →</button>
            </div>
            <div class="divide-y divide-white/5">
              ${[
                { name: 'Marcus Johnson', email: 'marcus@email.com', role: 'DRIVER', status: 'active', joined: '2h ago', flag: false },
                { name: 'Sarah Chen', email: 'sarah@email.com', role: 'HOST', status: 'active', joined: '5h ago', flag: false },
                { name: 'John Suspicious', email: 'suspicious@mail.ru', role: 'DRIVER', status: 'flagged', joined: '1h ago', flag: true },
                { name: 'Emily Rodriguez', email: 'emily@gmail.com', role: 'HOST', status: 'pending', joined: '1d ago', flag: false },
              ].map(u => `
                <div class="flex items-center gap-3 px-5 py-3 hover:bg-white/5 transition-colors">
                  <div class="w-8 h-8 ${u.flag ? 'bg-red-500/20' : 'gradient-bg'} rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    ${u.name[0]}
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-white text-sm font-medium truncate ${u.flag ? 'text-red-300' : ''}">${u.name}</p>
                    <p class="text-gray-500 text-xs truncate">${u.email}</p>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-xs ${u.role === 'HOST' ? 'bg-lime-500/20 text-lime-400' : 'bg-indigo-500/20 text-indigo-400'} px-2 py-0.5 rounded-full">${u.role}</span>
                    <span class="text-xs ${u.status === 'active' ? 'bg-green-500/20 text-green-400' : u.status === 'flagged' ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'} px-2 py-0.5 rounded-full">${u.status}</span>
                  </div>
                  <div class="flex gap-1 ml-2">
                    <button title="View Profile" class="w-7 h-7 bg-charcoal-200 hover:bg-indigo-500/20 rounded-lg flex items-center justify-center text-gray-400 hover:text-indigo-400 transition-colors">
                      <i class="fas fa-eye text-xs"></i>
                    </button>
                    <button title="Ban User" class="w-7 h-7 bg-charcoal-200 hover:bg-red-500/20 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-400 transition-colors">
                      <i class="fas fa-ban text-xs"></i>
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Listings Moderation -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden">
            <div class="flex items-center justify-between p-5 border-b border-white/5">
              <h3 class="font-bold text-white">Listings Pending Review</h3>
              <span class="bg-amber-500/20 text-amber-400 text-xs font-bold px-2.5 py-1 rounded-full">5 pending</span>
            </div>
            <div class="divide-y divide-white/5">
              ${[
                { title: 'Downtown Covered Garage', host: 'James T.', type: 'Garage', rate: 15, status: 'pending' },
                { title: 'Airport Adjacent Lot', host: 'Linda M.', type: 'Lot', rate: 12, status: 'pending' },
                { title: 'Suspicious Empty Lot', host: 'Unknown User', type: 'Lot', rate: 3, status: 'flagged' },
                { title: 'River North Driveway', host: 'Carlos P.', type: 'Driveway', rate: 7, status: 'pending' },
              ].map(l => `
                <div class="flex items-center gap-3 px-5 py-3 hover:bg-white/5 transition-colors">
                  <div class="w-10 h-10 bg-charcoal-200 rounded-xl flex items-center justify-center flex-shrink-0">
                    <i class="fas fa-${l.type === 'Garage' ? 'warehouse' : l.type === 'Driveway' ? 'home' : 'parking'} text-gray-400 text-sm"></i>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-white text-sm font-medium truncate ${l.status === 'flagged' ? 'text-red-300' : ''}">${l.title}</p>
                    <p class="text-gray-500 text-xs">${l.host} · $${l.rate}/hr</p>
                  </div>
                  <span class="text-xs ${l.status === 'flagged' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'} px-2 py-0.5 rounded-full flex-shrink-0">${l.status}</span>
                  <div class="flex gap-1">
                    <button onclick="approveListing(this)" class="w-7 h-7 bg-green-500/10 hover:bg-green-500/20 rounded-lg flex items-center justify-center text-green-400 transition-colors">
                      <i class="fas fa-check text-xs"></i>
                    </button>
                    <button onclick="rejectListing(this)" class="w-7 h-7 bg-red-500/10 hover:bg-red-500/20 rounded-lg flex items-center justify-center text-red-400 transition-colors">
                      <i class="fas fa-times text-xs"></i>
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Recent Bookings -->
        <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden mb-6">
          <div class="flex items-center justify-between p-5 border-b border-white/5">
            <h3 class="font-bold text-white">Recent Bookings</h3>
            <div class="flex gap-2">
              <button class="px-3 py-1.5 bg-charcoal-200 border border-white/5 rounded-xl text-xs text-gray-400 hover:text-white transition-colors">
                <i class="fas fa-download mr-1"></i> Export CSV
              </button>
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-charcoal-200/50">
                <tr>
                  ${['Booking ID', 'Driver', 'Space', 'Date', 'Amount', 'Status', 'Actions'].map(h => `
                    <th class="px-4 py-3 text-left text-xs text-gray-500 uppercase tracking-wider font-medium">${h}</th>
                  `).join('')}
                </tr>
              </thead>
              <tbody class="divide-y divide-white/5">
                ${[
                  { id: 'PP-8741', driver: 'Alex M.', space: 'Covered Garage', date: 'Mar 3, 10am', amount: 48, status: 'active' },
                  { id: 'PP-8740', driver: 'Sarah K.', space: 'Wrigley Driveway', date: 'Mar 3, 8am', amount: 32, status: 'completed' },
                  { id: 'PP-8739', driver: 'Marcus B.', space: "O'Hare Lot", date: 'Mar 2', amount: 84, status: 'completed' },
                  { id: 'PP-8738', driver: 'Lisa T.', space: 'River North', date: 'Mar 2', amount: 18, status: 'cancelled' },
                  { id: 'PP-8737', driver: 'Derek W.', space: 'Navy Pier', date: 'Mar 1', amount: 40, status: 'refunded' },
                ].map(b => `
                  <tr class="hover:bg-white/5 transition-colors">
                    <td class="px-4 py-3 text-indigo-400 font-mono text-xs">${b.id}</td>
                    <td class="px-4 py-3 text-white">${b.driver}</td>
                    <td class="px-4 py-3 text-gray-400">${b.space}</td>
                    <td class="px-4 py-3 text-gray-400 text-xs">${b.date}</td>
                    <td class="px-4 py-3 text-white font-semibold">$${b.amount}</td>
                    <td class="px-4 py-3">
                      <span class="text-xs px-2 py-1 rounded-full ${
                        b.status === 'active' ? 'bg-green-500/20 text-green-400' :
                        b.status === 'completed' ? 'bg-indigo-500/20 text-indigo-400' :
                        b.status === 'cancelled' ? 'bg-gray-500/20 text-gray-400' :
                        'bg-red-500/20 text-red-400'
                      }">${b.status}</span>
                    </td>
                    <td class="px-4 py-3">
                      <div class="flex gap-1">
                        <button class="w-7 h-7 bg-charcoal-200 hover:bg-indigo-500/20 rounded-lg flex items-center justify-center text-gray-400 hover:text-indigo-400 transition-colors">
                          <i class="fas fa-eye text-xs"></i>
                        </button>
                        <button class="w-7 h-7 bg-charcoal-200 hover:bg-amber-500/20 rounded-lg flex items-center justify-center text-gray-400 hover:text-amber-400 transition-colors">
                          <i class="fas fa-pen text-xs"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Dispute Resolution + System Health -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          <!-- Active Disputes -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
            <div class="flex items-center justify-between mb-4">
              <h3 class="font-bold text-white">Active Disputes</h3>
              <span class="bg-red-500/20 text-red-400 text-xs font-bold px-2.5 py-1 rounded-full">3 open</span>
            </div>
            <div class="space-y-3">
              ${[
                { id: 'D-441', type: 'Space Unavailable', parties: 'Marcus vs Host J.', priority: 'high', amount: 48 },
                { id: 'D-440', type: 'Unauthorized Charge', parties: 'Sarah vs Platform', priority: 'medium', amount: 25 },
                { id: 'D-439', type: 'No Show - Host', parties: 'Derek vs Host K.', priority: 'low', amount: 32 },
              ].map(d => `
                <div class="p-3 bg-charcoal-200 rounded-xl flex items-center gap-3">
                  <div class="w-8 h-8 ${d.priority === 'high' ? 'bg-red-500/20' : d.priority === 'medium' ? 'bg-amber-500/20' : 'bg-blue-500/20'} rounded-lg flex items-center justify-center flex-shrink-0">
                    <i class="fas fa-gavel ${d.priority === 'high' ? 'text-red-400' : d.priority === 'medium' ? 'text-amber-400' : 'text-blue-400'} text-xs"></i>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-white text-xs font-semibold">${d.id} · ${d.type}</p>
                    <p class="text-gray-500 text-xs truncate">${d.parties}</p>
                  </div>
                  <span class="text-white text-xs font-bold">$${d.amount}</span>
                  <button class="px-2.5 py-1.5 btn-primary text-white rounded-lg text-xs font-semibold">Resolve</button>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- System Health -->
          <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
            <h3 class="font-bold text-white mb-4">System Health</h3>
            <div class="space-y-3">
              ${[
                { service: 'API Gateway', status: 'Operational', latency: '24ms', uptime: '99.98%', ok: true },
                { service: 'Payment Service (Stripe)', status: 'Operational', latency: '340ms', uptime: '99.99%', ok: true },
                { service: 'Database (D1)', status: 'Operational', latency: '8ms', uptime: '100%', ok: true },
                { service: 'Email Service (SendGrid)', status: 'Degraded', latency: '1.2s', uptime: '98.3%', ok: false },
                { service: 'SMS Service (Twilio)', status: 'Operational', latency: '220ms', uptime: '99.95%', ok: true },
              ].map(s => `
                <div class="flex items-center gap-3 p-2.5 bg-charcoal-200 rounded-xl">
                  <div class="w-2 h-2 ${s.ok ? 'bg-green-500' : 'bg-amber-400'} rounded-full flex-shrink-0 pulse-dot"></div>
                  <span class="text-white text-xs font-medium flex-1">${s.service}</span>
                  <span class="text-xs ${s.ok ? 'text-green-400' : 'text-amber-400'}">${s.status}</span>
                  <span class="text-gray-500 text-xs font-mono">${s.latency}</span>
                  <span class="text-gray-600 text-xs">${s.uptime}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    function switchSection(section) {
      const titles = {
        dashboard: 'Dashboard Overview',
        analytics: 'Analytics & Insights',
        revenue: 'Revenue Management',
        users: 'User Management',
        listings: 'Listings Moderation',
        bookings: 'All Bookings',
        payments: 'Payment Management',
        reviews: 'Reviews & Ratings',
        disputes: 'Dispute Resolution',
        fraudalerts: 'Fraud Detection',
        reports: 'Reports',
        settings: 'Platform Settings',
      };
      const el = document.getElementById('section-title');
      if (el && titles[section]) el.textContent = titles[section];
      
      document.querySelectorAll('.admin-nav').forEach(btn => {
        btn.className = btn.className.replace('bg-indigo-500/20 text-indigo-300 font-semibold', 'text-gray-400 hover:bg-white/5 hover:text-white');
      });
    }

    function approveListing(btn) {
      const row = btn.closest('.flex');
      const statusEl = row.previousElementSibling;
      if (statusEl) {
        statusEl.className = 'text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full flex-shrink-0';
        statusEl.textContent = 'approved';
      }
      row.innerHTML = '<span class="text-green-400 text-xs font-semibold"><i class="fas fa-check mr-1"></i>Approved</span>';
    }

    function rejectListing(btn) {
      const row = btn.closest('.flex');
      const statusEl = row.previousElementSibling;
      if (statusEl) {
        statusEl.className = 'text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full flex-shrink-0';
        statusEl.textContent = 'rejected';
      }
      row.innerHTML = '<span class="text-red-400 text-xs font-semibold"><i class="fas fa-times mr-1"></i>Rejected</span>';
    }
  </script>
  `
  return c.html(Layout('Admin Panel', content))
})
