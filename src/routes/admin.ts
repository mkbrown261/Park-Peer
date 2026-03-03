import { Hono } from 'hono'
import { AdminLayout } from '../components/admin-layout'
import { adminAuthMiddleware } from './admin-auth'

export const adminPanel = new Hono()

// ── All admin routes require authentication ──────────────────────────────────
adminPanel.use('/*', adminAuthMiddleware)

// ── Helper: empty-state component ───────────────────────────────────────────
const EmptyState = (icon: string, title: string, sub: string) => `
  <div class="flex flex-col items-center justify-center py-20 text-center">
    <div class="w-16 h-16 bg-charcoal-200 rounded-2xl flex items-center justify-center mb-4">
      <i class="fas ${icon} text-gray-600 text-2xl"></i>
    </div>
    <p class="text-gray-400 font-semibold">${title}</p>
    <p class="text-gray-600 text-sm mt-1 max-w-xs">${sub}</p>
  </div>`

// ── Helper: stat card ────────────────────────────────────────────────────────
const StatCard = (label: string, value: string, icon: string, colorClass: string, bgClass: string, note = '') => `
  <div class="stat-card rounded-2xl p-5 card-hover">
    <div class="flex items-start justify-between mb-3">
      <div class="w-10 h-10 ${bgClass} rounded-xl flex items-center justify-center">
        <i class="fas ${icon} ${colorClass} text-lg"></i>
      </div>
    </div>
    <p class="text-2xl font-black text-white">${value}</p>
    <p class="text-gray-400 text-xs mt-1 font-medium">${label}</p>
    ${note ? `<p class="text-gray-600 text-xs mt-0.5">${note}</p>` : ''}
  </div>`

// ════════════════════════════════════════════════════════════════════════════
// GET /admin  — Dashboard
// ════════════════════════════════════════════════════════════════════════════
adminPanel.get('/', (c: any) => {
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const content = `
  <!-- Page header -->
  <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
    <div>
      <p class="text-gray-500 text-sm">${dateStr}</p>
    </div>
    <div class="flex items-center gap-2">
      <div class="flex items-center gap-1.5 bg-green-500/10 border border-green-500/20 rounded-full px-3 py-1.5">
        <div class="w-2 h-2 bg-green-500 rounded-full pulse-dot"></div>
        <span class="text-green-400 text-xs font-semibold">All Systems Operational</span>
      </div>
    </div>
  </div>

  <!-- KPI cards — all zeros until real DB is connected -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
    ${StatCard('Total Revenue (MTD)', '$0.00', 'fa-dollar-sign', 'text-lime-500', 'bg-lime-500/10', 'No transactions yet')}
    ${StatCard('Total Bookings', '0', 'fa-calendar-check', 'text-indigo-400', 'bg-indigo-500/10', 'No bookings yet')}
    ${StatCard('Registered Users', '0', 'fa-users', 'text-blue-400', 'bg-blue-500/10', 'No sign-ups yet')}
    ${StatCard('Active Listings', '0', 'fa-parking', 'text-amber-400', 'bg-amber-500/10', 'No listings yet')}
  </div>

  <!-- Secondary KPIs -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
    ${StatCard('Platform Fees Collected', '$0.00', 'fa-piggy-bank', 'text-purple-400', 'bg-purple-500/10')}
    ${StatCard('Pending Listings', '0', 'fa-hourglass-half', 'text-amber-400', 'bg-amber-500/10', 'Awaiting review')}
    ${StatCard('Open Disputes', '0', 'fa-gavel', 'text-red-400', 'bg-red-500/10')}
    ${StatCard('Fraud Alerts', '0', 'fa-triangle-exclamation', 'text-amber-400', 'bg-amber-500/10')}
  </div>

  <!-- Main grid -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

    <!-- Recent Users -->
    <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden">
      <div class="flex items-center justify-between p-5 border-b border-white/5">
        <h3 class="font-bold text-white text-sm">Recent Registrations</h3>
        <a href="/admin/users" class="text-indigo-400 text-xs font-medium hover:text-indigo-300 transition-colors">View All →</a>
      </div>
      ${EmptyState('fa-user-plus', 'No users yet', 'New registrations will appear here as people sign up.')}
    </div>

    <!-- Pending Listings -->
    <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden">
      <div class="flex items-center justify-between p-5 border-b border-white/5">
        <h3 class="font-bold text-white text-sm">Listings Pending Review</h3>
        <a href="/admin/listings" class="text-indigo-400 text-xs font-medium hover:text-indigo-300 transition-colors">View All →</a>
      </div>
      ${EmptyState('fa-parking', 'No pending listings', 'New listing submissions will appear here for moderation.')}
    </div>
  </div>

  <!-- Recent Bookings table -->
  <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden mb-6">
    <div class="flex items-center justify-between p-5 border-b border-white/5">
      <h3 class="font-bold text-white text-sm">Recent Bookings</h3>
      <a href="/admin/bookings" class="text-indigo-400 text-xs font-medium hover:text-indigo-300 transition-colors">View All →</a>
    </div>
    ${EmptyState('fa-calendar-check', 'No bookings yet', 'All platform bookings will be displayed here in real time.')}
  </div>

  <!-- Bottom row: Disputes + System Health -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

    <!-- Disputes -->
    <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden">
      <div class="flex items-center justify-between p-5 border-b border-white/5">
        <h3 class="font-bold text-white text-sm">Active Disputes</h3>
        <a href="/admin/disputes" class="text-indigo-400 text-xs font-medium hover:text-indigo-300 transition-colors">View All →</a>
      </div>
      ${EmptyState('fa-gavel', 'No open disputes', 'Dispute requests from users will be listed here.')}
    </div>

    <!-- System Health -->
    <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
      <h3 class="font-bold text-white text-sm mb-4">Service Health</h3>
      <div class="space-y-2.5">
        ${((): string => {
          const env = c.env || {}
          const services = [
            { name: 'Cloudflare Workers (API)',    ok: true },
            { name: 'Cloudflare Pages (Frontend)', ok: true },
            { name: 'D1 Database',                 ok: !!(env.DB),                                                              note: env.DB ? '' : 'Not bound' },
            { name: 'R2 Media Storage',            ok: !!(env.MEDIA),                                                           note: env.MEDIA ? '' : 'Not bound' },
            { name: 'Stripe Payments',             ok: !!(env.STRIPE_SECRET_KEY),                                               note: env.STRIPE_SECRET_KEY ? '' : 'Key not configured' },
            { name: 'Resend Email',              ok: !!(env.RESEND_API_KEY && env.RESEND_API_KEY !== 'PLACEHOLDER_RESEND_KEY'), note: (!env.RESEND_API_KEY || env.RESEND_API_KEY === 'PLACEHOLDER_RESEND_KEY') ? 'Key not configured' : '' },
            { name: 'Twilio SMS',                  ok: !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN),                     note: !(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) ? 'Not configured' : '' },
          ]
          return services.map(s => `
          <div class="flex items-center gap-3 p-2.5 bg-charcoal-200 rounded-xl">
            <div class="w-2 h-2 ${s.ok ? 'bg-green-500 pulse-dot' : 'bg-red-500'} rounded-full flex-shrink-0"></div>
            <span class="text-white text-xs font-medium flex-1">${s.name}</span>
            <span class="text-xs ${s.ok ? 'text-green-400' : 'text-red-400'}">${s.ok ? 'Operational' : (s.note || 'Offline')}</span>
          </div>`).join('')
        })()}
      </div>
    </div>
  </div>
  `
  return c.html(AdminLayout('Dashboard', content))
})

// ════════════════════════════════════════════════════════════════════════════
// GET /admin/users
// ════════════════════════════════════════════════════════════════════════════
adminPanel.get('/users', (c) => {
  const content = `
  <div class="flex items-center justify-between mb-6">
    <p class="text-gray-400 text-sm">Manage all platform users</p>
    <button class="btn-primary px-4 py-2 rounded-xl text-xs text-white font-semibold flex items-center gap-2">
      <i class="fas fa-download"></i> Export CSV
    </button>
  </div>

  <!-- Search & filter bar -->
  <div class="flex flex-wrap gap-3 mb-5">
    <div class="relative flex-1 min-w-[200px]">
      <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs pointer-events-none"></i>
      <input type="text" placeholder="Search by name, email, phone..." class="w-full bg-charcoal-100 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"/>
    </div>
    <select class="bg-charcoal-100 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-gray-400 focus:outline-none focus:border-indigo-500">
      <option value="">All Roles</option>
      <option>DRIVER</option>
      <option>HOST</option>
      <option>ADMIN</option>
    </select>
    <select class="bg-charcoal-100 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-gray-400 focus:outline-none focus:border-indigo-500">
      <option value="">All Statuses</option>
      <option>active</option>
      <option>suspended</option>
      <option>pending</option>
    </select>
  </div>

  <!-- Users table -->
  <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-charcoal-200/60">
          <tr>
            ${['User', 'Email', 'Role', 'Joined', 'ID Verified', 'Rating', 'Status', 'Actions'].map(h => `
              <th class="px-4 py-3 text-left text-xs text-gray-500 uppercase tracking-wider font-semibold whitespace-nowrap">${h}</th>
            `).join('')}
          </tr>
        </thead>
        <tbody id="users-table">
          <tr><td colspan="8">
            ${EmptyState('fa-users', 'No users registered yet', 'Users will appear here as they sign up on the platform.')}
          </td></tr>
        </tbody>
      </table>
    </div>
    <!-- Pagination placeholder -->
    <div class="flex items-center justify-between px-5 py-3 border-t border-white/5">
      <p class="text-gray-600 text-xs">Showing 0 of 0 users</p>
      <div class="flex gap-2">
        <button disabled class="px-3 py-1.5 bg-charcoal-200 text-gray-600 rounded-lg text-xs">← Prev</button>
        <button disabled class="px-3 py-1.5 bg-charcoal-200 text-gray-600 rounded-lg text-xs">Next →</button>
      </div>
    </div>
  </div>
  `
  return c.html(AdminLayout('Users', content))
})

// ════════════════════════════════════════════════════════════════════════════
// GET /admin/listings
// ════════════════════════════════════════════════════════════════════════════
adminPanel.get('/listings', (c) => {
  const content = `
  <div class="flex items-center justify-between mb-6">
    <p class="text-gray-400 text-sm">Review and moderate parking space submissions</p>
    <button class="btn-primary px-4 py-2 rounded-xl text-xs text-white font-semibold flex items-center gap-2">
      <i class="fas fa-download"></i> Export CSV
    </button>
  </div>

  <!-- Tabs -->
  <div class="flex gap-2 mb-5">
    ${[
      { label: 'All', count: 0 },
      { label: 'Pending Review', count: 0 },
      { label: 'Active', count: 0 },
      { label: 'Suspended', count: 0 },
    ].map((tab, i) => `
      <button class="px-4 py-2 rounded-xl text-xs font-semibold transition-all ${i === 0 ? 'bg-indigo-500 text-white' : 'bg-charcoal-200 text-gray-400 hover:text-white border border-white/5'}">
        ${tab.label} <span class="ml-1 opacity-60">(${tab.count})</span>
      </button>
    `).join('')}
  </div>

  <!-- Listings table -->
  <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-charcoal-200/60">
          <tr>
            ${['Listing', 'Host', 'Type', 'Rates', 'Submitted', 'Status', 'Actions'].map(h => `
              <th class="px-4 py-3 text-left text-xs text-gray-500 uppercase tracking-wider font-semibold whitespace-nowrap">${h}</th>
            `).join('')}
          </tr>
        </thead>
        <tbody>
          <tr><td colspan="7">
            ${EmptyState('fa-parking', 'No listings submitted yet', 'New listing submissions will appear here for your review and approval.')}
          </td></tr>
        </tbody>
      </table>
    </div>
    <div class="flex items-center justify-between px-5 py-3 border-t border-white/5">
      <p class="text-gray-600 text-xs">Showing 0 of 0 listings</p>
      <div class="flex gap-2">
        <button disabled class="px-3 py-1.5 bg-charcoal-200 text-gray-600 rounded-lg text-xs">← Prev</button>
        <button disabled class="px-3 py-1.5 bg-charcoal-200 text-gray-600 rounded-lg text-xs">Next →</button>
      </div>
    </div>
  </div>
  `
  return c.html(AdminLayout('Listings', content))
})

// ════════════════════════════════════════════════════════════════════════════
// GET /admin/bookings
// ════════════════════════════════════════════════════════════════════════════
adminPanel.get('/bookings', (c) => {
  const content = `
  <div class="flex items-center justify-between mb-6">
    <p class="text-gray-400 text-sm">Full log of all platform bookings</p>
    <button class="btn-primary px-4 py-2 rounded-xl text-xs text-white font-semibold flex items-center gap-2">
      <i class="fas fa-download"></i> Export CSV
    </button>
  </div>

  <!-- Filter bar -->
  <div class="flex flex-wrap gap-3 mb-5">
    <div class="relative flex-1 min-w-[200px]">
      <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs pointer-events-none"></i>
      <input type="text" placeholder="Search by booking ID, driver, space..." class="w-full bg-charcoal-100 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"/>
    </div>
    <input type="date" class="bg-charcoal-100 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-gray-400 focus:outline-none focus:border-indigo-500"/>
    <select class="bg-charcoal-100 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-gray-400 focus:outline-none focus:border-indigo-500">
      <option value="">All Statuses</option>
      <option>active</option>
      <option>confirmed</option>
      <option>completed</option>
      <option>cancelled</option>
      <option>refunded</option>
    </select>
  </div>

  <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-charcoal-200/60">
          <tr>
            ${['Booking ID', 'Driver', 'Space', 'Start', 'End', 'Amount', 'Fee', 'Status', 'Actions'].map(h => `
              <th class="px-4 py-3 text-left text-xs text-gray-500 uppercase tracking-wider font-semibold whitespace-nowrap">${h}</th>
            `).join('')}
          </tr>
        </thead>
        <tbody>
          <tr><td colspan="9">
            ${EmptyState('fa-calendar-check', 'No bookings yet', 'All platform bookings will be shown here with full detail.')}
          </td></tr>
        </tbody>
      </table>
    </div>
    <div class="flex items-center justify-between px-5 py-3 border-t border-white/5">
      <p class="text-gray-600 text-xs">Showing 0 of 0 bookings</p>
      <div class="flex gap-2">
        <button disabled class="px-3 py-1.5 bg-charcoal-200 text-gray-600 rounded-lg text-xs">← Prev</button>
        <button disabled class="px-3 py-1.5 bg-charcoal-200 text-gray-600 rounded-lg text-xs">Next →</button>
      </div>
    </div>
  </div>
  `
  return c.html(AdminLayout('Bookings', content))
})

// ════════════════════════════════════════════════════════════════════════════
// GET /admin/payments
// ════════════════════════════════════════════════════════════════════════════
adminPanel.get('/payments', (c) => {
  const content = `
  <div class="flex items-center justify-between mb-6">
    <p class="text-gray-400 text-sm">Payment transactions and payout management</p>
    <button class="btn-primary px-4 py-2 rounded-xl text-xs text-white font-semibold flex items-center gap-2">
      <i class="fas fa-download"></i> Export CSV
    </button>
  </div>

  <!-- Payment KPIs -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
    ${StatCard('Total Volume', '$0.00', 'fa-dollar-sign', 'text-lime-500', 'bg-lime-500/10', 'All time')}
    ${StatCard('Platform Revenue', '$0.00', 'fa-piggy-bank', 'text-indigo-400', 'bg-indigo-500/10', '15% of transactions')}
    ${StatCard('Pending Payouts', '$0.00', 'fa-clock', 'text-amber-400', 'bg-amber-500/10', 'To hosts')}
    ${StatCard('Total Refunds', '$0.00', 'fa-rotate-left', 'text-red-400', 'bg-red-500/10', 'All time')}
  </div>

  <!-- Stripe status notice -->
  <div class="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl mb-5">
    <i class="fas fa-triangle-exclamation text-amber-400 flex-shrink-0 mt-0.5"></i>
    <div>
      <p class="text-amber-300 font-semibold text-sm">Stripe not configured</p>
      <p class="text-amber-400/70 text-xs mt-0.5">Payment processing is inactive. Add your <code class="bg-black/20 px-1 rounded">STRIPE_SECRET_KEY</code> as a Cloudflare secret to enable transactions.</p>
    </div>
  </div>

  <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-charcoal-200/60">
          <tr>
            ${['Transaction ID','Booking ID','Driver','Amount','Platform Fee','Host Payout','Status','Date'].map(h => `
              <th class="px-4 py-3 text-left text-xs text-gray-500 uppercase tracking-wider font-semibold whitespace-nowrap">${h}</th>
            `).join('')}
          </tr>
        </thead>
        <tbody>
          <tr><td colspan="8">
            ${EmptyState('fa-credit-card', 'No transactions yet', 'Payment records will appear here once Stripe is configured and bookings are made.')}
          </td></tr>
        </tbody>
      </table>
    </div>
  </div>
  `
  return c.html(AdminLayout('Payments', content))
})

// ════════════════════════════════════════════════════════════════════════════
// GET /admin/reviews
// ════════════════════════════════════════════════════════════════════════════
adminPanel.get('/reviews', (c) => {
  const content = `
  <div class="flex items-center justify-between mb-6">
    <p class="text-gray-400 text-sm">Moderate user reviews and ratings</p>
  </div>

  <!-- Filter -->
  <div class="flex flex-wrap gap-3 mb-5">
    <div class="relative flex-1 min-w-[200px]">
      <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs pointer-events-none"></i>
      <input type="text" placeholder="Search reviews..." class="w-full bg-charcoal-100 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"/>
    </div>
    <select class="bg-charcoal-100 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-gray-400 focus:outline-none focus:border-indigo-500">
      <option>All Stars</option>
      <option>5 ★</option><option>4 ★</option><option>3 ★</option><option>2 ★</option><option>1 ★</option>
    </select>
    <select class="bg-charcoal-100 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-gray-400 focus:outline-none focus:border-indigo-500">
      <option>All Statuses</option>
      <option>published</option>
      <option>flagged</option>
      <option>removed</option>
    </select>
  </div>

  <div class="bg-charcoal-100 rounded-2xl border border-white/5">
    ${EmptyState('fa-star', 'No reviews yet', 'User reviews will appear here after completed bookings.')}
  </div>
  `
  return c.html(AdminLayout('Reviews', content))
})

// ════════════════════════════════════════════════════════════════════════════
// GET /admin/disputes
// ════════════════════════════════════════════════════════════════════════════
adminPanel.get('/disputes', (c) => {
  const content = `
  <div class="flex items-center justify-between mb-6">
    <p class="text-gray-400 text-sm">Handle and resolve user disputes</p>
  </div>

  <!-- Priority tabs -->
  <div class="flex gap-2 mb-5">
    ${[
      { label: 'All', count: 0 },
      { label: 'High Priority', count: 0 },
      { label: 'In Progress', count: 0 },
      { label: 'Resolved', count: 0 },
    ].map((tab, i) => `
      <button class="px-4 py-2 rounded-xl text-xs font-semibold transition-all ${i === 0 ? 'bg-indigo-500 text-white' : 'bg-charcoal-200 text-gray-400 hover:text-white border border-white/5'}">
        ${tab.label} <span class="ml-1 opacity-60">(${tab.count})</span>
      </button>
    `).join('')}
  </div>

  <div class="bg-charcoal-100 rounded-2xl border border-white/5">
    ${EmptyState('fa-gavel', 'No active disputes', 'Dispute requests submitted by drivers or hosts will appear here for your resolution.')}
  </div>
  `
  return c.html(AdminLayout('Disputes', content))
})

// ════════════════════════════════════════════════════════════════════════════
// GET /admin/fraud
// ════════════════════════════════════════════════════════════════════════════
adminPanel.get('/fraud', (c) => {
  const content = `
  <div class="flex items-center justify-between mb-6">
    <p class="text-gray-400 text-sm">Monitor and action suspicious activity</p>
  </div>

  <!-- Alert types -->
  <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
    ${StatCard('Active Fraud Alerts', '0', 'fa-triangle-exclamation', 'text-amber-400', 'bg-amber-500/10')}
    ${StatCard('Accounts Suspended', '0', 'fa-ban', 'text-red-400', 'bg-red-500/10', 'All time')}
    ${StatCard('Flagged Transactions', '0', 'fa-flag', 'text-orange-400', 'bg-orange-500/10')}
  </div>

  <div class="bg-charcoal-100 rounded-2xl border border-white/5">
    ${EmptyState('fa-shield-halved', 'No fraud alerts', 'The system will flag suspicious booking patterns, multiple accounts, and unusual activity here.')}
  </div>
  `
  return c.html(AdminLayout('Fraud', content))
})

// ════════════════════════════════════════════════════════════════════════════
// GET /admin/analytics
// ════════════════════════════════════════════════════════════════════════════
adminPanel.get('/analytics', (c) => {
  const content = `
  <div class="flex items-center justify-between mb-6">
    <p class="text-gray-400 text-sm">Platform growth and usage metrics</p>
    <div class="flex gap-2">
      ${['7D','30D','3M','1Y'].map((p, i) => `
        <button class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${i === 1 ? 'bg-indigo-500 text-white' : 'bg-charcoal-200 text-gray-400 hover:text-white border border-white/5'}">${p}</button>
      `).join('')}
    </div>
  </div>

  <!-- Charts placeholder grid -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
    ${['Bookings Over Time', 'Revenue Over Time', 'New User Signups', 'Listing Growth'].map(chart => `
      <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
        <h3 class="font-semibold text-white text-sm mb-4">${chart}</h3>
        ${EmptyState('fa-chart-line', 'No data yet', 'Chart will populate once the platform has activity.')}
      </div>
    `).join('')}
  </div>

  <!-- Geo breakdown placeholder -->
  <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
    <h3 class="font-semibold text-white text-sm mb-4">Bookings by City</h3>
    ${EmptyState('fa-map-location-dot', 'No city data yet', 'Geographic breakdown of bookings will appear here.')}
  </div>
  `
  return c.html(AdminLayout('Analytics', content))
})

// ════════════════════════════════════════════════════════════════════════════
// GET /admin/revenue
// ════════════════════════════════════════════════════════════════════════════
adminPanel.get('/revenue', (c) => {
  const content = `
  <div class="flex items-center justify-between mb-6">
    <p class="text-gray-400 text-sm">Detailed financial reporting</p>
    <button class="btn-primary px-4 py-2 rounded-xl text-xs text-white font-semibold flex items-center gap-2">
      <i class="fas fa-download"></i> Export Report
    </button>
  </div>

  <!-- Revenue KPIs -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
    ${StatCard('Gross Volume (All Time)', '$0.00', 'fa-dollar-sign', 'text-lime-500', 'bg-lime-500/10')}
    ${StatCard('Net Platform Revenue', '$0.00', 'fa-piggy-bank', 'text-indigo-400', 'bg-indigo-500/10', 'After payouts')}
    ${StatCard('Total Host Payouts', '$0.00', 'fa-money-bill-wave', 'text-blue-400', 'bg-blue-500/10', 'Paid out to hosts')}
    ${StatCard('Total Refunds Issued', '$0.00', 'fa-rotate-left', 'text-red-400', 'bg-red-500/10')}
  </div>

  <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-5">
    <h3 class="font-semibold text-white text-sm mb-4">Monthly Revenue Breakdown</h3>
    ${EmptyState('fa-chart-bar', 'No revenue data yet', 'Monthly revenue reports will populate here as transactions occur.')}
  </div>
  `
  return c.html(AdminLayout('Revenue', content))
})

// ════════════════════════════════════════════════════════════════════════════
// GET /admin/settings
// ════════════════════════════════════════════════════════════════════════════
adminPanel.get('/settings', (c: any) => {
  const content = `
  <div class="mb-6">
    <p class="text-gray-400 text-sm">Platform-wide configuration and integrations</p>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

    <!-- Platform Settings -->
    <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-6">
      <h3 class="font-bold text-white mb-5 flex items-center gap-2">
        <i class="fas fa-gear text-indigo-400"></i> Platform Settings
      </h3>
      <div class="space-y-4">
        ${[
          { label: 'Platform Service Fee (%)', value: '15', type: 'number', note: 'Percentage charged on each booking' },
          { label: 'Platform Name', value: 'ParkPeer', type: 'text', note: '' },
          { label: 'Support Email', value: '', type: 'email', note: 'Shown to users in support section' },
          { label: 'Max Booking Duration (hours)', value: '720', type: 'number', note: 'Maximum booking length allowed' },
        ].map(f => `
          <div>
            <label class="text-xs text-gray-400 font-medium block mb-1.5">${f.label}</label>
            <input type="${f.type}" value="${f.value}" class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 transition-all"/>
            ${f.note ? `<p class="text-gray-600 text-xs mt-1">${f.note}</p>` : ''}
          </div>
        `).join('')}
        <button class="btn-primary w-full py-2.5 rounded-xl text-sm text-white font-semibold mt-2">
          Save Settings
        </button>
      </div>
    </div>

    <!-- Integrations status — read live from env -->
    <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-6">
      <h3 class="font-bold text-white mb-5 flex items-center gap-2">
        <i class="fas fa-plug text-indigo-400"></i> Third-Party Integrations
      </h3>
      <div class="space-y-3" id="integrations-list">
        ${((): string => {
          const env = c.env || {}
          const integrations = [
            {
              name: 'Stripe',
              desc: 'Payment processing',
              icon: 'fa-credit-card',
              connected: !!(env.STRIPE_SECRET_KEY),
              label: env.STRIPE_SECRET_KEY ? 'Connected' : 'Not Configured',
              note: env.STRIPE_SECRET_KEY ? '' : 'STRIPE_SECRET_KEY not set'
            },
            {
              name: 'SendGrid',
              desc: 'Email notifications',
              icon: 'fa-envelope',
              connected: !!(env.RESEND_API_KEY && env.RESEND_API_KEY !== 'PLACEHOLDER_RESEND_KEY'),
              label: (env.RESEND_API_KEY && env.RESEND_API_KEY !== 'PLACEHOLDER_RESEND_KEY') ? 'Connected' : 'Not Configured',
              note: (!env.RESEND_API_KEY || env.RESEND_API_KEY === 'PLACEHOLDER_RESEND_KEY') ? 'RESEND_API_KEY not set' : ''
            },
            {
              name: 'Twilio',
              desc: 'SMS notifications',
              icon: 'fa-mobile-screen',
              connected: !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN),
              label: (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) ? 'Connected' : 'Not Configured',
              note: !(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) ? 'TWILIO credentials not set' : ''
            },
            {
              name: 'Mapbox',
              desc: 'Interactive maps',
              icon: 'fa-map',
              connected: !!(env.MAPBOX_TOKEN),
              label: env.MAPBOX_TOKEN ? 'Connected' : 'Not Configured',
              note: !env.MAPBOX_TOKEN ? 'MAPBOX_TOKEN not set' : ''
            },
            {
              name: 'Cloudflare D1',
              desc: 'Database',
              icon: 'fa-database',
              connected: !!(env.DB),
              label: env.DB ? 'Connected' : 'Not Bound',
              note: ''
            },
            {
              name: 'Cloudflare R2',
              desc: 'Media storage',
              icon: 'fa-bucket',
              connected: !!(env.MEDIA),
              label: env.MEDIA ? 'Connected' : 'Not Bound',
              note: ''
            },
          ]
          return integrations.map(s => `
          <div class="flex items-center gap-3 p-3.5 bg-charcoal-200 rounded-xl border ${s.connected ? 'border-green-500/20' : 'border-white/5'}">
            <div class="w-9 h-9 ${s.connected ? 'bg-green-500/10' : 'bg-charcoal-300'} rounded-xl flex items-center justify-center flex-shrink-0">
              <i class="fas ${s.icon} ${s.connected ? 'text-green-400' : 'text-gray-600'} text-sm"></i>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-white text-sm font-semibold">${s.name}</p>
              <p class="text-gray-500 text-xs">${s.desc}</p>
              ${s.note ? `<p class="text-gray-600 text-xs font-mono mt-0.5">${s.note}</p>` : ''}
            </div>
            <span class="text-xs px-2.5 py-1 rounded-full font-semibold flex-shrink-0 ${s.connected ? 'badge-green' : 'badge-gray'}">
              ${s.label}
            </span>
          </div>`).join('')
        })()}
      </div>
    </div>

    <!-- Security settings -->
    <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-6">
      <h3 class="font-bold text-white mb-5 flex items-center gap-2">
        <i class="fas fa-shield-halved text-indigo-400"></i> Security
      </h3>
      <div class="space-y-3">
        ${[
          { label: 'Admin session duration', value: '8 hours', icon: 'fa-clock' },
          { label: 'Login lockout threshold', value: '5 failed attempts', icon: 'fa-lock' },
          { label: 'Lockout duration', value: '15 minutes', icon: 'fa-ban' },
          { label: 'Cookie scope', value: '/admin path only', icon: 'fa-cookie' },
          { label: 'Cookie flags', value: 'HttpOnly · Secure · SameSite=Strict', icon: 'fa-shield-halved' },
        ].map(s => `
          <div class="flex items-center justify-between p-3 bg-charcoal-200 rounded-xl">
            <div class="flex items-center gap-2.5">
              <i class="fas ${s.icon} text-indigo-400/70 text-xs w-4 text-center"></i>
              <span class="text-sm text-gray-300">${s.label}</span>
            </div>
            <span class="text-xs text-indigo-300 font-mono">${s.value}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Admin account -->
    <div class="bg-charcoal-100 rounded-2xl border border-white/5 p-6">
      <h3 class="font-bold text-white mb-5 flex items-center gap-2">
        <i class="fas fa-user-shield text-indigo-400"></i> Admin Account
      </h3>
      <div class="flex items-center gap-3 p-4 bg-charcoal-200 rounded-xl mb-4">
        <div class="w-10 h-10 gradient-bg rounded-full flex items-center justify-center font-black text-white">A</div>
        <div>
          <p class="font-bold text-white text-sm">adminpanama</p>
          <p class="text-gray-500 text-xs">Super Administrator · Full access</p>
        </div>
        <span class="ml-auto badge-green text-xs px-2.5 py-1 rounded-full font-semibold">Active</span>
      </div>
      <div class="space-y-3">
        <div>
          <label class="text-xs text-gray-400 font-medium block mb-1.5">New Password</label>
          <input type="password" placeholder="Enter new password" autocomplete="new-password" class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"/>
        </div>
        <div>
          <label class="text-xs text-gray-400 font-medium block mb-1.5">Confirm New Password</label>
          <input type="password" placeholder="Repeat new password" autocomplete="new-password" class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"/>
        </div>
        <button class="w-full py-2.5 bg-charcoal-300 border border-white/10 text-gray-300 hover:text-white rounded-xl text-sm font-semibold transition-colors">
          Change Password
        </button>
      </div>
    </div>
  </div>
  `
  return c.html(AdminLayout('Settings', content))
})
