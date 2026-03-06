import { Hono } from 'hono'
import { AdminLayout } from '../components/admin-layout'
import { adminAuthMiddleware } from './admin-auth'

type Bindings = {
  DB: D1Database
  MEDIA: R2Bucket
  STRIPE_SECRET_KEY: string
  RESEND_API_KEY: string
  TWILIO_ACCOUNT_SID: string
  TWILIO_AUTH_TOKEN: string
  MAPBOX_TOKEN: string
}

export const adminPanel = new Hono<{ Bindings: Bindings }>()

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

// ── Format helpers ────────────────────────────────────────────────────────────
const fmtMoney = (n: number) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (dt: string) => {
  if (!dt) return '–'
  try { return new Date(dt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return dt }
}
const fmtTime = (dt: string) => {
  if (!dt) return ''
  try { return new Date(dt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) } catch { return '' }
}

// ════════════════════════════════════════════════════════════════════════════
// GET /admin  — Dashboard (with real D1 data)
// ════════════════════════════════════════════════════════════════════════════
adminPanel.get('/', async (c: any) => {
  const db: D1Database | undefined = c.env?.DB
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  // ── Real KPIs from D1 ─────────────────────────────────────────────────────
  let totalRevenueMtd  = 0
  let platformFeeMtd   = 0
  let totalBookings    = 0
  let totalUsers       = 0
  let activeListings   = 0
  let pendingListings  = 0
  let openDisputes     = 0
  let recentUsers:     any[] = []
  let pendingListRows: any[] = []
  let recentBookings:  any[] = []

  if (db) {
    try {
      // Month-to-date revenue and platform fees from payments
      const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
      const rev = await db.prepare(`
        SELECT COALESCE(SUM(amount),0) as total, COALESCE(SUM(platform_fee),0) as fees
        FROM payments WHERE status='succeeded' AND created_at >= ?
      `).bind(mtdStart).first<any>()
      totalRevenueMtd = Math.round((rev?.total ?? 0) * 100) / 100
      platformFeeMtd  = Math.round((rev?.fees  ?? 0) * 100) / 100

      // Total bookings count
      const bk = await db.prepare(`SELECT COUNT(*) as n FROM bookings`).first<any>()
      totalBookings = bk?.n ?? 0

      // Total users
      const us = await db.prepare(`SELECT COUNT(*) as n FROM users WHERE status != 'banned'`).first<any>()
      totalUsers = us?.n ?? 0

      // Active listings
      const al = await db.prepare(`SELECT COUNT(*) as n FROM listings WHERE status='active'`).first<any>()
      activeListings = al?.n ?? 0

      // Pending listings
      const pl = await db.prepare(`SELECT COUNT(*) as n FROM listings WHERE status='pending'`).first<any>()
      pendingListings = pl?.n ?? 0

      // Open disputes
      const od = await db.prepare(`SELECT COUNT(*) as n FROM disputes WHERE status IN ('open','in_progress')`).first<any>()
      openDisputes = od?.n ?? 0

      // Recent 5 users
      const ru = await db.prepare(`
        SELECT id, full_name, email, role, status, created_at FROM users
        ORDER BY created_at DESC LIMIT 5
      `).all<any>()
      recentUsers = ru.results || []

      // Up to 5 pending listings
      const pendR = await db.prepare(`
        SELECT l.id, l.title, l.type, l.city, l.state, l.created_at,
               u.full_name as host_name, u.email as host_email
        FROM listings l LEFT JOIN users u ON l.host_id = u.id
        WHERE l.status = 'pending'
        ORDER BY l.created_at DESC LIMIT 5
      `).all<any>()
      pendingListRows = pendR.results || []

      // Recent 5 bookings
      const rb = await db.prepare(`
        SELECT b.id, b.start_time, b.end_time, b.total_charged, b.status,
               l.title as listing_title, l.city,
               u.full_name as driver_name, u.email as driver_email
        FROM bookings b
        LEFT JOIN listings l ON b.listing_id = l.id
        LEFT JOIN users u    ON b.driver_id  = u.id
        ORDER BY b.created_at DESC LIMIT 5
      `).all<any>()
      recentBookings = rb.results || []

    } catch(e: any) {
      console.error('[admin] dashboard query error:', e.message)
    }
  }

  // ── Build table rows HTML ──────────────────────────────────────────────────
  const recentUsersHTML = recentUsers.length === 0
    ? `<tr><td colspan="5">${EmptyState('fa-user-plus', 'No users yet', 'New registrations will appear here.')}</td></tr>`
    : recentUsers.map(u => {
        const initials = (u.full_name || u.email || '?').substring(0, 2).toUpperCase()
        const roleBadge = u.role === 'ADMIN'
          ? 'bg-purple-500/20 text-purple-400'
          : u.role === 'HOST'
          ? 'bg-lime-500/20 text-lime-400'
          : 'bg-indigo-500/20 text-indigo-400'
        const statusBadge = u.status === 'active'
          ? 'bg-green-500/20 text-green-400'
          : u.status === 'suspended'
          ? 'bg-red-500/20 text-red-400'
          : 'bg-gray-500/20 text-gray-400'
        return `
          <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
            <td class="px-4 py-3">
              <div class="flex items-center gap-2">
                <div class="w-7 h-7 gradient-bg rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0">${initials}</div>
                <span class="text-white text-xs font-medium truncate max-w-[120px]">${u.full_name || '—'}</span>
              </div>
            </td>
            <td class="px-4 py-3 text-gray-400 text-xs truncate max-w-[150px]">${u.email}</td>
            <td class="px-4 py-3"><span class="text-xs px-2 py-0.5 rounded-full font-semibold ${roleBadge}">${u.role || '—'}</span></td>
            <td class="px-4 py-3 text-gray-500 text-xs">${fmtDate(u.created_at)}</td>
            <td class="px-4 py-3"><span class="text-xs px-2 py-0.5 rounded-full font-semibold ${statusBadge}">${u.status}</span></td>
          </tr>`
      }).join('')

  const pendingListingsHTML = pendingListRows.length === 0
    ? EmptyState('fa-parking', 'No pending listings', 'New listing submissions will appear here for moderation.')
    : `<table class="w-full text-sm"><tbody>
        ${pendingListRows.map(l => `
          <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
            <td class="px-4 py-3">
              <p class="text-white text-xs font-medium">${l.title}</p>
              <p class="text-gray-500 text-xs">${l.city || ''}, ${l.state || ''}</p>
            </td>
            <td class="px-4 py-3 text-gray-400 text-xs">${l.host_name || l.host_email || '—'}</td>
            <td class="px-4 py-3 text-gray-500 text-xs">${fmtDate(l.created_at)}</td>
            <td class="px-4 py-3">
              <span class="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-semibold">pending</span>
            </td>
          </tr>`).join('')}
        </tbody></table>`

  const recentBookingsHTML = recentBookings.length === 0
    ? EmptyState('fa-calendar-check', 'No bookings yet', 'All platform bookings will be displayed here in real time.')
    : `<table class="w-full text-sm"><tbody>
        ${recentBookings.map(b => {
          const statusColor = b.status === 'confirmed' ? 'bg-green-500/20 text-green-400'
            : b.status === 'completed'   ? 'bg-blue-500/20 text-blue-400'
            : b.status === 'cancelled'   ? 'bg-red-500/20 text-red-400'
            : b.status === 'active'      ? 'bg-lime-500/20 text-lime-400'
            : 'bg-gray-500/20 text-gray-400'
          return `
            <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
              <td class="px-4 py-3 text-gray-400 text-xs">${b.driver_name || b.driver_email || '—'}</td>
              <td class="px-4 py-3">
                <p class="text-white text-xs font-medium truncate max-w-[120px]">${b.listing_title || '—'}</p>
                <p class="text-gray-500 text-xs">${b.city || ''}</p>
              </td>
              <td class="px-4 py-3 text-gray-400 text-xs">${fmtDate(b.start_time)}</td>
              <td class="px-4 py-3 text-lime-400 text-xs font-semibold">${fmtMoney(b.total_charged)}</td>
              <td class="px-4 py-3"><span class="text-xs px-2 py-0.5 rounded-full font-semibold ${statusColor}">${b.status}</span></td>
            </tr>`
        }).join('')}
        </tbody></table>`

  const content = `
  <!-- Page header -->
  <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
    <div>
      <p class="text-gray-500 text-sm">${dateStr}</p>
    </div>
    <div class="flex items-center gap-2">
      ${db
        ? `<div class="flex items-center gap-1.5 bg-green-500/10 border border-green-500/20 rounded-full px-3 py-1.5">
             <div class="w-2 h-2 bg-green-500 rounded-full pulse-dot"></div>
             <span class="text-green-400 text-xs font-semibold">All Systems Operational</span>
           </div>`
        : `<div class="flex items-center gap-1.5 bg-red-500/10 border border-red-500/20 rounded-full px-3 py-1.5">
             <div class="w-2 h-2 bg-red-500 rounded-full"></div>
             <span class="text-red-400 text-xs font-semibold">D1 Database Not Bound</span>
           </div>`
      }
    </div>
  </div>

  <!-- KPI cards — live D1 data -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
    ${StatCard('Total Revenue (MTD)', fmtMoney(totalRevenueMtd), 'fa-dollar-sign', 'text-lime-500', 'bg-lime-500/10')}
    ${StatCard('Total Bookings', String(totalBookings), 'fa-calendar-check', 'text-indigo-400', 'bg-indigo-500/10')}
    ${StatCard('Registered Users', String(totalUsers), 'fa-users', 'text-blue-400', 'bg-blue-500/10')}
    ${StatCard('Active Listings', String(activeListings), 'fa-parking', 'text-amber-400', 'bg-amber-500/10')}
  </div>

  <!-- Secondary KPIs -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
    ${StatCard('Platform Fees (MTD)', fmtMoney(platformFeeMtd), 'fa-piggy-bank', 'text-purple-400', 'bg-purple-500/10')}
    ${StatCard('Pending Listings', String(pendingListings), 'fa-hourglass-half', 'text-amber-400', 'bg-amber-500/10', pendingListings > 0 ? 'Awaiting review' : '')}
    ${StatCard('Open Disputes', String(openDisputes), 'fa-gavel', 'text-red-400', 'bg-red-500/10')}
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
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-charcoal-200/40">
            <tr>
              ${['User','Email','Role','Joined','Status'].map(h => `<th class="px-4 py-2.5 text-left text-xs text-gray-500 uppercase tracking-wider font-semibold">${h}</th>`).join('')}
            </tr>
          </thead>
          <tbody>${recentUsersHTML}</tbody>
        </table>
      </div>
    </div>

    <!-- Pending Listings -->
    <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden">
      <div class="flex items-center justify-between p-5 border-b border-white/5">
        <h3 class="font-bold text-white text-sm">Listings Pending Review</h3>
        <a href="/admin/listings" class="text-indigo-400 text-xs font-medium hover:text-indigo-300 transition-colors">View All →</a>
      </div>
      ${pendingListingsHTML}
    </div>
  </div>

  <!-- Recent Bookings table -->
  <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden mb-6">
    <div class="flex items-center justify-between p-5 border-b border-white/5">
      <h3 class="font-bold text-white text-sm">Recent Bookings</h3>
      <a href="/admin/bookings" class="text-indigo-400 text-xs font-medium hover:text-indigo-300 transition-colors">View All →</a>
    </div>
    ${recentBookingsHTML}
  </div>

  <!-- Bottom row: Disputes + System Health -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

    <!-- Disputes -->
    <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden">
      <div class="flex items-center justify-between p-5 border-b border-white/5">
        <h3 class="font-bold text-white text-sm">Active Disputes</h3>
        <a href="/admin/disputes" class="text-indigo-400 text-xs font-medium hover:text-indigo-300 transition-colors">View All →</a>
      </div>
      ${EmptyState('fa-gavel', openDisputes === 0 ? 'No open disputes' : `${openDisputes} open dispute${openDisputes > 1 ? 's' : ''}`, 'Dispute requests from users will be listed here.')}
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
            { name: 'D1 Database',                 ok: !!(env.DB),                                                               note: env.DB ? '' : 'Not bound' },
            { name: 'R2 Media Storage',            ok: !!(env.MEDIA),                                                            note: env.MEDIA ? '' : 'Not bound' },
            { name: 'Stripe Payments',             ok: !!(env.STRIPE_SECRET_KEY),                                                note: env.STRIPE_SECRET_KEY ? '' : 'Key not configured' },
            { name: 'Resend Email',                ok: !!(env.RESEND_API_KEY && env.RESEND_API_KEY !== 'PLACEHOLDER_RESEND_KEY'), note: (!env.RESEND_API_KEY || env.RESEND_API_KEY === 'PLACEHOLDER_RESEND_KEY') ? 'Key not configured' : '' },
            { name: 'Twilio SMS',                  ok: !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN),                      note: !(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) ? 'Not configured' : '' },
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
// GET /admin/users — live D1 data
// ════════════════════════════════════════════════════════════════════════════
adminPanel.get('/users', async (c: any) => {
  const db: D1Database | undefined = c.env?.DB
  let users: any[] = []
  let total = 0

  if (db) {
    try {
      const rows = await db.prepare(`
        SELECT u.id, u.full_name, u.email, u.role, u.status, u.created_at, u.id_verified,
               ROUND(AVG(l.avg_rating), 1) as avg_rating
        FROM users u
        LEFT JOIN listings l ON l.host_id = u.id AND l.avg_rating > 0
        GROUP BY u.id
        ORDER BY u.created_at DESC
        LIMIT 100
      `).all<any>()
      users = rows.results || []
      total = users.length
    } catch(e: any) { console.error('[admin/users]', e.message) }
  }

  const tableRows = users.length === 0
    ? `<tr><td colspan="8">${EmptyState('fa-users', 'No users registered yet', 'Users will appear here as they sign up on the platform.')}</td></tr>`
    : users.map(u => {
        const initials = (u.full_name || u.email || '?').substring(0, 2).toUpperCase()
        const roleBadge = u.role === 'ADMIN'
          ? 'bg-purple-500/20 text-purple-400'
          : u.role === 'HOST'
          ? 'bg-lime-500/20 text-lime-400'
          : 'bg-indigo-500/20 text-indigo-400'
        const statusBadge = u.status === 'active'
          ? 'bg-green-500/20 text-green-400'
          : u.status === 'suspended'
          ? 'bg-red-500/20 text-red-400'
          : 'bg-gray-500/20 text-gray-400'
        return `
          <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
            <td class="px-4 py-3">
              <div class="flex items-center gap-2.5">
                <div class="w-8 h-8 gradient-bg rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0">${initials}</div>
                <span class="text-white text-xs font-medium">${u.full_name || '—'}</span>
              </div>
            </td>
            <td class="px-4 py-3 text-gray-400 text-xs">${u.email}</td>
            <td class="px-4 py-3"><span class="text-xs px-2 py-0.5 rounded-full font-semibold ${roleBadge}">${u.role || '—'}</span></td>
            <td class="px-4 py-3 text-gray-500 text-xs">${fmtDate(u.created_at)}</td>
            <td class="px-4 py-3 text-center">
              ${u.id_verified
                ? '<i class="fas fa-check-circle text-green-400 text-sm"></i>'
                : '<i class="fas fa-times-circle text-gray-600 text-sm"></i>'}
            </td>
            <td class="px-4 py-3 text-gray-400 text-xs">${u.avg_rating ? Number(u.avg_rating).toFixed(1) : '–'}</td>
            <td class="px-4 py-3"><span class="text-xs px-2 py-0.5 rounded-full font-semibold ${statusBadge}">${u.status}</span></td>
            <td class="px-4 py-3">
              <a href="/admin/users/${u.id}" class="text-indigo-400 hover:text-indigo-300 text-xs font-medium transition-colors">View</a>
            </td>
          </tr>`
      }).join('')

  const content = `
  <div class="flex items-center justify-between mb-6">
    <p class="text-gray-400 text-sm">Manage all platform users (${total} total)</p>
    <button class="btn-primary px-4 py-2 rounded-xl text-xs text-white font-semibold flex items-center gap-2">
      <i class="fas fa-download"></i> Export CSV
    </button>
  </div>

  <!-- Search & filter bar -->
  <div class="flex flex-wrap gap-3 mb-5">
    <div class="relative flex-1 min-w-[200px]">
      <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs pointer-events-none"></i>
      <input type="text" id="user-search" placeholder="Search by name or email..." onkeyup="filterUsers(this.value)"
        class="w-full bg-charcoal-100 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"/>
    </div>
    <select id="role-filter" onchange="filterUsers()" class="bg-charcoal-100 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-gray-400 focus:outline-none focus:border-indigo-500">
      <option value="">All Roles</option>
      <option>DRIVER</option>
      <option>HOST</option>
      <option>ADMIN</option>
    </select>
    <select id="status-filter" onchange="filterUsers()" class="bg-charcoal-100 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-gray-400 focus:outline-none focus:border-indigo-500">
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
        <tbody id="users-table">${tableRows}</tbody>
      </table>
    </div>
    <div class="flex items-center justify-between px-5 py-3 border-t border-white/5">
      <p class="text-gray-600 text-xs">Showing ${total} user${total !== 1 ? 's' : ''}</p>
      <div class="flex gap-2">
        <button disabled class="px-3 py-1.5 bg-charcoal-200 text-gray-600 rounded-lg text-xs">← Prev</button>
        <button disabled class="px-3 py-1.5 bg-charcoal-200 text-gray-600 rounded-lg text-xs">Next →</button>
      </div>
    </div>
  </div>

  <script>
    function filterUsers(val) {
      const q = (document.getElementById('user-search')?.value || '').toLowerCase()
      const role = document.getElementById('role-filter')?.value || ''
      const status = document.getElementById('status-filter')?.value || ''
      const rows = document.querySelectorAll('#users-table tr[class]')
      rows.forEach(row => {
        const text = row.textContent?.toLowerCase() || ''
        const show = (!q || text.includes(q)) && (!role || text.includes(role.toLowerCase())) && (!status || text.includes(status))
        row.style.display = show ? '' : 'none'
      })
    }
  </script>
  `
  return c.html(AdminLayout('Users', content))
})

// ════════════════════════════════════════════════════════════════════════════
// GET /admin/listings — live D1 data
// ════════════════════════════════════════════════════════════════════════════
adminPanel.get('/listings', async (c: any) => {
  const db: D1Database | undefined = c.env?.DB
  let listings: any[] = []
  let counts = { all: 0, pending: 0, active: 0, suspended: 0 }

  if (db) {
    try {
      const rows = await db.prepare(`
        SELECT l.id, l.title, l.type, l.city, l.state, l.rate_hourly, l.status, l.created_at,
               l.avg_rating, l.review_count, l.total_bookings,
               u.full_name as host_name, u.email as host_email
        FROM listings l LEFT JOIN users u ON l.host_id = u.id
        ORDER BY l.created_at DESC LIMIT 100
      `).all<any>()
      listings = rows.results || []

      counts.all = listings.length
      counts.pending   = listings.filter(l => l.status === 'pending').length
      counts.active    = listings.filter(l => l.status === 'active').length
      counts.suspended = listings.filter(l => l.status === 'suspended').length
    } catch(e: any) { console.error('[admin/listings]', e.message) }
  }

  const tableRows = listings.length === 0
    ? `<tr><td colspan="7">${EmptyState('fa-parking', 'No listings submitted yet', 'New listing submissions will appear here for your review and approval.')}</td></tr>`
    : listings.map(l => {
        const statusBadge = l.status === 'active'
          ? 'bg-green-500/20 text-green-400'
          : l.status === 'pending'
          ? 'bg-amber-500/20 text-amber-400'
          : l.status === 'suspended'
          ? 'bg-red-500/20 text-red-400'
          : 'bg-gray-500/20 text-gray-400'
        return `
          <tr class="listing-row border-b border-white/5 hover:bg-white/5 transition-colors" data-status="${l.status}">
            <td class="px-4 py-3">
              <p class="text-white text-xs font-medium">${l.title}</p>
              <p class="text-gray-500 text-xs">${l.city || ''}${l.state ? ', ' + l.state : ''}</p>
            </td>
            <td class="px-4 py-3 text-gray-400 text-xs">${l.host_name || l.host_email || '—'}</td>
            <td class="px-4 py-3 text-gray-400 text-xs capitalize">${l.type || '—'}</td>
            <td class="px-4 py-3 text-gray-400 text-xs">${l.rate_hourly ? '$' + Number(l.rate_hourly).toFixed(2) + '/hr' : '—'}</td>
            <td class="px-4 py-3 text-gray-500 text-xs">${fmtDate(l.created_at)}</td>
            <td class="px-4 py-3"><span class="text-xs px-2 py-0.5 rounded-full font-semibold ${statusBadge}">${l.status}</span></td>
            <td class="px-4 py-3">
              <a href="/listing/${l.id}" target="_blank" class="text-indigo-400 hover:text-indigo-300 text-xs font-medium transition-colors mr-2">View</a>
            </td>
          </tr>`
      }).join('')

  const content = `
  <div class="flex items-center justify-between mb-6">
    <p class="text-gray-400 text-sm">Review and moderate parking space submissions</p>
  </div>

  <!-- Tabs -->
  <div class="flex gap-2 mb-5">
    ${[
      { label: 'All',            val: '',          count: counts.all },
      { label: 'Pending Review', val: 'pending',   count: counts.pending },
      { label: 'Active',         val: 'active',    count: counts.active },
      { label: 'Suspended',      val: 'suspended', count: counts.suspended },
    ].map((tab, i) => `
      <button onclick="filterListings('${tab.val}')" data-filter="${tab.val}"
        class="listing-tab px-4 py-2 rounded-xl text-xs font-semibold transition-all ${i === 0 ? 'bg-indigo-500 text-white' : 'bg-charcoal-200 text-gray-400 hover:text-white border border-white/5'}">
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
        <tbody id="listings-table">${tableRows}</tbody>
      </table>
    </div>
    <div class="flex items-center justify-between px-5 py-3 border-t border-white/5">
      <p id="listing-count" class="text-gray-600 text-xs">Showing ${counts.all} listing${counts.all !== 1 ? 's' : ''}</p>
    </div>
  </div>

  <script>
    function filterListings(status) {
      document.querySelectorAll('.listing-tab').forEach(btn => {
        const active = btn.getAttribute('data-filter') === status
        btn.className = 'listing-tab px-4 py-2 rounded-xl text-xs font-semibold transition-all ' +
          (active ? 'bg-indigo-500 text-white' : 'bg-charcoal-200 text-gray-400 hover:text-white border border-white/5')
      })
      const rows = document.querySelectorAll('.listing-row')
      let shown = 0
      rows.forEach(row => {
        const show = !status || row.getAttribute('data-status') === status
        row.style.display = show ? '' : 'none'
        if (show) shown++
      })
      document.getElementById('listing-count').textContent = 'Showing ' + shown + ' listing' + (shown !== 1 ? 's' : '')
    }
  </script>
  `
  return c.html(AdminLayout('Listings', content))
})

// ════════════════════════════════════════════════════════════════════════════
// GET /admin/bookings — live D1 data
// ════════════════════════════════════════════════════════════════════════════
adminPanel.get('/bookings', async (c: any) => {
  const db: D1Database | undefined = c.env?.DB
  let bookings: any[] = []
  let total = 0

  if (db) {
    try {
      const rows = await db.prepare(`
        SELECT b.id, b.start_time, b.end_time, b.total_charged, b.platform_fee, b.status, b.created_at,
               l.title as listing_title, l.city,
               u.full_name as driver_name, u.email as driver_email
        FROM bookings b
        LEFT JOIN listings l ON b.listing_id = l.id
        LEFT JOIN users u    ON b.driver_id  = u.id
        ORDER BY b.created_at DESC LIMIT 100
      `).all<any>()
      bookings = rows.results || []
      total = bookings.length
    } catch(e: any) { console.error('[admin/bookings]', e.message) }
  }

  const tableRows = bookings.length === 0
    ? `<tr><td colspan="9">${EmptyState('fa-calendar-check', 'No bookings yet', 'All platform bookings will be shown here with full detail.')}</td></tr>`
    : bookings.map(b => {
        const statusColor = b.status === 'confirmed' ? 'bg-green-500/20 text-green-400'
          : b.status === 'completed'   ? 'bg-blue-500/20 text-blue-400'
          : b.status === 'cancelled'   ? 'bg-red-500/20 text-red-400'
          : b.status === 'active'      ? 'bg-lime-500/20 text-lime-400'
          : b.status === 'pending'     ? 'bg-amber-500/20 text-amber-400'
          : 'bg-gray-500/20 text-gray-400'
        return `
          <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
            <td class="px-4 py-3 text-gray-400 text-xs font-mono">${b.id}</td>
            <td class="px-4 py-3 text-gray-400 text-xs">${b.driver_name || b.driver_email || '—'}</td>
            <td class="px-4 py-3">
              <p class="text-white text-xs font-medium">${b.listing_title || '—'}</p>
              <p class="text-gray-500 text-xs">${b.city || ''}</p>
            </td>
            <td class="px-4 py-3 text-gray-400 text-xs">${fmtDate(b.start_time)} ${fmtTime(b.start_time)}</td>
            <td class="px-4 py-3 text-gray-400 text-xs">${fmtDate(b.end_time)} ${fmtTime(b.end_time)}</td>
            <td class="px-4 py-3 text-lime-400 text-xs font-semibold">${fmtMoney(b.total_charged)}</td>
            <td class="px-4 py-3 text-gray-500 text-xs">${b.platform_fee ? fmtMoney(b.platform_fee) : '—'}</td>
            <td class="px-4 py-3"><span class="text-xs px-2 py-0.5 rounded-full font-semibold ${statusColor}">${b.status}</span></td>
            <td class="px-4 py-3 text-gray-500 text-xs">${fmtDate(b.created_at)}</td>
          </tr>`
      }).join('')

  const content = `
  <div class="flex items-center justify-between mb-6">
    <p class="text-gray-400 text-sm">Full log of all platform bookings (${total} total)</p>
  </div>

  <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-charcoal-200/60">
          <tr>
            ${['Booking ID', 'Driver', 'Space', 'Start', 'End', 'Amount', 'Fee', 'Status', 'Date'].map(h => `
              <th class="px-4 py-3 text-left text-xs text-gray-500 uppercase tracking-wider font-semibold whitespace-nowrap">${h}</th>
            `).join('')}
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <div class="flex items-center justify-between px-5 py-3 border-t border-white/5">
      <p class="text-gray-600 text-xs">Showing ${total} booking${total !== 1 ? 's' : ''}</p>
    </div>
  </div>
  `
  return c.html(AdminLayout('Bookings', content))
})

// ════════════════════════════════════════════════════════════════════════════
// GET /admin/payments
// ════════════════════════════════════════════════════════════════════════════
adminPanel.get('/payments', async (c: any) => {
  const db: D1Database | undefined = c.env?.DB
  let payments: any[] = []
  let totalVol = 0, totalFees = 0, totalPayouts = 0, totalRefunds = 0

  if (db) {
    try {
      const kpis = await db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN status='succeeded' THEN amount ELSE 0 END), 0) as total_vol,
          COALESCE(SUM(CASE WHEN status='succeeded' THEN platform_fee ELSE 0 END), 0) as total_fees,
          COALESCE(SUM(CASE WHEN status='succeeded' THEN host_payout ELSE 0 END), 0) as total_payouts,
          COALESCE(SUM(CASE WHEN status='refunded'  THEN amount ELSE 0 END), 0) as total_refunds
        FROM payments
      `).first<any>()
      totalVol     = Math.round((kpis?.total_vol     ?? 0) * 100) / 100
      totalFees    = Math.round((kpis?.total_fees    ?? 0) * 100) / 100
      totalPayouts = Math.round((kpis?.total_payouts ?? 0) * 100) / 100
      totalRefunds = Math.round((kpis?.total_refunds ?? 0) * 100) / 100

      const rows = await db.prepare(`
        SELECT p.id, p.booking_id, p.amount, p.platform_fee, p.host_payout,
               p.status, p.type, p.created_at,
               u.email as driver_email
        FROM payments p LEFT JOIN users u ON p.driver_id = u.id
        ORDER BY p.created_at DESC LIMIT 100
      `).all<any>()
      payments = rows.results || []
    } catch(e: any) { console.error('[admin/payments]', e.message) }
  }

  const tableRows = payments.length === 0
    ? `<tr><td colspan="8">${EmptyState('fa-credit-card', 'No transactions yet', 'Payment records will appear here once Stripe is configured and bookings are made.')}</td></tr>`
    : payments.map(p => {
        const sc = p.status === 'succeeded' ? 'bg-green-500/20 text-green-400'
          : p.status === 'refunded' ? 'bg-blue-500/20 text-blue-400'
          : p.status === 'failed'   ? 'bg-red-500/20 text-red-400'
          : 'bg-gray-500/20 text-gray-400'
        return `
          <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
            <td class="px-4 py-3 text-gray-400 text-xs font-mono">${p.id}</td>
            <td class="px-4 py-3 text-gray-400 text-xs font-mono">${p.booking_id || '—'}</td>
            <td class="px-4 py-3 text-gray-400 text-xs">${p.driver_email || '—'}</td>
            <td class="px-4 py-3 text-lime-400 text-xs font-semibold">${fmtMoney(p.amount)}</td>
            <td class="px-4 py-3 text-gray-400 text-xs">${p.platform_fee ? fmtMoney(p.platform_fee) : '—'}</td>
            <td class="px-4 py-3 text-gray-400 text-xs">${p.host_payout ? fmtMoney(p.host_payout) : '—'}</td>
            <td class="px-4 py-3"><span class="text-xs px-2 py-0.5 rounded-full font-semibold ${sc}">${p.status}</span></td>
            <td class="px-4 py-3 text-gray-500 text-xs">${fmtDate(p.created_at)}</td>
          </tr>`
      }).join('')

  const content = `
  <div class="flex items-center justify-between mb-6">
    <p class="text-gray-400 text-sm">Payment transactions and payout management</p>
  </div>

  <!-- Payment KPIs -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
    ${StatCard('Total Volume', fmtMoney(totalVol), 'fa-dollar-sign', 'text-lime-500', 'bg-lime-500/10', 'All time')}
    ${StatCard('Platform Revenue', fmtMoney(totalFees), 'fa-piggy-bank', 'text-indigo-400', 'bg-indigo-500/10', '15% of transactions')}
    ${StatCard('Total Host Payouts', fmtMoney(totalPayouts), 'fa-clock', 'text-amber-400', 'bg-amber-500/10')}
    ${StatCard('Total Refunds', fmtMoney(totalRefunds), 'fa-rotate-left', 'text-red-400', 'bg-red-500/10', 'All time')}
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
        <tbody>${tableRows}</tbody>
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
              name: 'Resend Email',
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

// ════════════════════════════════════════════════════════════════════════════
// GET /admin/user-control  — Full user management with delete & refund
// ════════════════════════════════════════════════════════════════════════════
adminPanel.get('/user-control', async (c: any) => {
  const db: D1Database | undefined = c.env?.DB
  let totalUsers = 0, totalDeleted = 0, totalRefunded = 0, totalSuspended = 0

  // The admin cookie (__pp_admin) is HttpOnly/Secure and sent automatically via
  // credentials:'same-origin'. Never embed session tokens in HTML (XSS risk).

  // Load users + stats directly from DB — render server-side, no JS fetch needed
  let users: any[] = []
  if (db) {
    try {
      const [statsRows, userRows] = await Promise.all([
        Promise.all([
          db.prepare(`SELECT COUNT(*) as n FROM users WHERE status NOT IN ('deleted','suspended')`).first<any>(),
          db.prepare(`SELECT COUNT(*) as n FROM users WHERE status='suspended'`).first<any>(),
          db.prepare(`SELECT COUNT(*) as n FROM user_deletions`).first<any>(),
          db.prepare(`SELECT COALESCE(SUM(total_refunded),0) as n FROM user_deletions`).first<any>(),
        ]),
        db.prepare(`
          SELECT u.id, u.full_name, u.email, u.role, u.status, u.created_at,
            (SELECT COUNT(*) FROM listings l WHERE l.host_id=u.id AND l.status='active') as active_listings,
            (SELECT COUNT(*) FROM bookings b WHERE (b.driver_id=u.id OR b.host_id=u.id) AND b.status IN ('confirmed','pending')) as active_bookings,
            0 as open_disputes, 0 as total_paid, 0 as total_earned
          FROM users u
          WHERE u.status != 'deleted'
          ORDER BY u.created_at DESC
          LIMIT 100
        `).all<any>(),
      ])
      totalUsers     = statsRows[0]?.n ?? 0
      totalSuspended = statsRows[1]?.n ?? 0
      totalDeleted   = statsRows[2]?.n ?? 0
      totalRefunded  = Math.round((statsRows[3]?.n ?? 0) * 100) / 100
      users = userRows.results || []
    } catch (e: any) {
      // fall through with empty arrays
    }
  }

  // Helper to escape HTML for server-rendered output
  const esc = (s: string) => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
  const fmtDate = (d: string) => {
    try { return new Date(d).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) } catch { return d||'—' }
  }

  const userRows = users.map(u => {
    const roleColor = u.role === 'ADMIN' ? 'badge-indigo' : u.role === 'HOST' ? 'badge-green' : 'badge-amber'
    const statusColor = u.status === 'active' ? 'badge-green' : u.status === 'suspended' ? 'badge-red' : 'badge-gray'
    const initials = (u.full_name || u.email || '?').substring(0,2).toUpperCase()
    const nameEsc = esc(u.full_name || 'Unknown')
    const emailEsc = esc(u.email || '')
    return `<tr class="border-b border-white/5 hover:bg-white/[.025] transition-colors" data-name="${nameEsc.toLowerCase()}" data-email="${emailEsc.toLowerCase()}" data-role="${u.role||''}" data-status="${u.status||''}">
      <td class="px-4 py-3">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 gradient-bg rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0">${initials}</div>
          <div class="min-w-0">
            <p class="text-white text-xs font-semibold truncate max-w-[120px]">${esc(u.full_name||'—')}</p>
            <p class="text-gray-600 text-xs truncate max-w-[120px]">${emailEsc}</p>
          </div>
        </div>
      </td>
      <td class="px-4 py-3"><span class="text-xs px-2 py-0.5 rounded-full font-semibold ${roleColor}">${esc(u.role||'—')}</span></td>
      <td class="px-4 py-3"><span class="text-xs px-2 py-0.5 rounded-full font-semibold ${statusColor}">${esc(u.status||'—')}</span></td>
      <td class="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">${fmtDate(u.created_at)}</td>
      <td class="px-4 py-3 text-center text-xs ${u.active_listings > 0 ? 'text-indigo-400 font-semibold' : 'text-gray-600'}">${u.active_listings}</td>
      <td class="px-4 py-3 text-center text-xs ${u.active_bookings > 0 ? 'text-amber-400 font-semibold' : 'text-gray-600'}">${u.active_bookings}</td>
      <td class="px-4 py-3 text-xs text-gray-600">—</td>
      <td class="px-4 py-3 text-center"><span class="text-gray-700 text-xs">—</span></td>
      <td class="px-4 py-3">
        <div class="flex items-center gap-2">
          <button onclick="openDetailPanel(${u.id})" class="text-indigo-400 hover:text-indigo-300 text-xs font-medium transition-colors px-2 py-1 rounded hover:bg-indigo-500/10">Detail</button>
          ${u.role !== 'ADMIN' ? `
          <button onclick="openSuspendModal(${u.id},'${nameEsc}','${esc(u.status)}')" class="text-amber-400 hover:text-amber-300 text-xs font-medium transition-colors px-2 py-1 rounded hover:bg-amber-500/10">${u.status === 'suspended' ? 'Unsuspend' : 'Suspend'}</button>
          <button onclick="openDeleteModal(${u.id},'${nameEsc}','${emailEsc}','${esc(u.role)}')" class="text-red-400 hover:text-red-300 text-xs font-medium transition-colors px-2 py-1 rounded hover:bg-red-500/10 flex items-center gap-1"><i class="fas fa-trash-can text-xs"></i> Delete</button>
          ` : '<span class="text-xs text-gray-600 italic">Admin</span>'}
        </div>
      </td>
    </tr>`
  }).join('')

  const emptyRow = `<tr><td colspan="9" class="text-center py-10 text-gray-600 text-sm">No users found.</td></tr>`

  const content = `
  <!-- Header -->
  <div class="flex items-center justify-between mb-6">
    <div>
      <p class="text-gray-400 text-sm">Delete accounts, issue refunds, and maintain compliance records.</p>
      <p class="text-red-400/70 text-xs mt-1 flex items-center gap-1.5">
        <i class="fas fa-triangle-exclamation text-xs"></i>
        All actions are permanent and fully logged. Exercise with caution.
      </p>
    </div>
  </div>

  <!-- Stats -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
    <div class="stat-card rounded-2xl p-5">
      <div class="w-10 h-10 bg-indigo-500/10 rounded-xl flex items-center justify-center mb-3">
        <i class="fas fa-users text-indigo-400"></i>
      </div>
      <p class="text-2xl font-black text-white">${totalUsers}</p>
      <p class="text-gray-400 text-xs mt-1">Active Users</p>
    </div>
    <div class="stat-card rounded-2xl p-5">
      <div class="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center mb-3">
        <i class="fas fa-user-lock text-amber-400"></i>
      </div>
      <p class="text-2xl font-black text-white">${totalSuspended}</p>
      <p class="text-gray-400 text-xs mt-1">Suspended</p>
    </div>
    <div class="stat-card rounded-2xl p-5">
      <div class="w-10 h-10 bg-red-500/10 rounded-xl flex items-center justify-center mb-3">
        <i class="fas fa-user-slash text-red-400"></i>
      </div>
      <p class="text-2xl font-black text-white">${totalDeleted}</p>
      <p class="text-gray-400 text-xs mt-1">Deleted (GDPR Record)</p>
    </div>
    <div class="stat-card rounded-2xl p-5">
      <div class="w-10 h-10 bg-lime-500/10 rounded-xl flex items-center justify-center mb-3">
        <i class="fas fa-rotate-left text-lime-400"></i>
      </div>
      <p class="text-2xl font-black text-white">$${totalRefunded.toFixed(2)}</p>
      <p class="text-gray-400 text-xs mt-1">Total Refunded</p>
    </div>
  </div>

  <!-- Search + Filter Bar -->
  <div class="flex flex-wrap gap-3 mb-5">
    <div class="relative flex-1 min-w-[220px]">
      <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs pointer-events-none"></i>
      <input type="text" id="uc-search" placeholder="Search by name or email..."
        class="w-full bg-charcoal-100 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
        oninput="filterTable()"/>
    </div>
    <select id="uc-role" onchange="filterTable()"
      class="bg-charcoal-100 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-gray-400 focus:outline-none focus:border-indigo-500">
      <option value="">All Roles</option>
      <option value="DRIVER">Drivers</option>
      <option value="HOST">Hosts</option>
      <option value="BOTH">Both</option>
    </select>
    <select id="uc-status" onchange="filterTable()"
      class="bg-charcoal-100 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-gray-400 focus:outline-none focus:border-indigo-500">
      <option value="">All Statuses</option>
      <option value="active">Active</option>
      <option value="suspended">Suspended</option>
    </select>
  </div>

  <!-- Users Table — rendered server-side, no JS fetch needed -->
  <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-sm" id="uc-table">
        <thead class="bg-charcoal-200/60">
          <tr>
            ${['User', 'Role', 'Status', 'Joined', 'Listings', 'Bookings', 'Balance', 'Disputes', 'Actions'].map(h =>
              `<th class="px-4 py-3 text-left text-xs text-gray-500 uppercase tracking-wider font-semibold whitespace-nowrap">${h}</th>`
            ).join('')}
          </tr>
        </thead>
        <tbody id="uc-table-body">
          ${users.length ? userRows : emptyRow}
        </tbody>
      </table>
    </div>
    <div class="px-5 py-3 border-t border-white/5">
      <p class="text-gray-500 text-xs" id="uc-count">${users.length} user${users.length !== 1 ? 's' : ''} total</p>
    </div>
  </div>

  <!-- ── Suspend / Unsuspend Modal ────────────────────────────────────────── -->
  <div id="suspend-modal" class="fixed inset-0 z-50 hidden flex items-center justify-center p-4">
    <div class="absolute inset-0 bg-black/80 backdrop-blur-sm" onclick="closeSuspendModal()"></div>
    <div class="relative bg-charcoal-100 border border-amber-500/30 rounded-2xl p-6 w-full max-w-md shadow-2xl">
      <div class="flex items-start gap-4 mb-5">
        <div class="w-12 h-12 bg-amber-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
          <i id="suspend-icon" class="fas fa-user-lock text-amber-400 text-xl"></i>
        </div>
        <div>
          <h3 id="suspend-title" class="font-black text-white text-lg">Suspend Account</h3>
          <p id="suspend-subtitle" class="text-gray-400 text-sm mt-1">The user will lose access. You can unsuspend at any time.</p>
        </div>
      </div>
      <div class="bg-charcoal-200 rounded-xl p-3 mb-4 border border-white/5">
        <p class="text-white font-semibold text-sm" id="sus-user-name">—</p>
      </div>
      <div class="mb-5">
        <label class="text-xs text-gray-400 font-semibold block mb-1.5">Reason <span class="text-red-400">*</span></label>
        <textarea id="sus-reason" rows="2" placeholder="e.g. Policy violation, suspicious activity..."
          class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500 resize-none"
          oninput="document.getElementById('sus-confirm-btn').disabled = !this.value.trim()"></textarea>
      </div>
      <div class="flex gap-3">
        <button onclick="closeSuspendModal()" class="flex-1 py-3 bg-charcoal-200 hover:bg-charcoal-300 text-white rounded-xl text-sm font-semibold transition-colors">Cancel</button>
        <button id="sus-confirm-btn" onclick="confirmSuspend()" disabled
          class="flex-1 py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-900/50 disabled:text-amber-700 text-white rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2">
          <i id="sus-btn-icon" class="fas fa-user-lock text-sm"></i>
          <span id="sus-btn-text">Suspend Account</span>
        </button>
      </div>
    </div>
  </div>

  <!-- ── Delete Confirmation Modal ──────────────────────────────────────── -->
  <div id="delete-modal" class="fixed inset-0 z-50 hidden flex items-center justify-center p-4">
    <div class="absolute inset-0 bg-black/80 backdrop-blur-sm" onclick="closeDeleteModal()"></div>
    <div class="relative bg-charcoal-100 border border-red-500/30 rounded-2xl p-6 w-full max-w-lg shadow-2xl">
      <!-- Header -->
      <div class="flex items-start gap-4 mb-5">
        <div class="w-12 h-12 bg-red-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
          <i class="fas fa-triangle-exclamation text-red-400 text-xl"></i>
        </div>
        <div>
          <h3 class="font-black text-white text-lg">Permanently Delete Account</h3>
          <p class="text-gray-400 text-sm mt-1">This action <strong class="text-red-400">cannot be undone</strong>. All data will be scrubbed and refunds issued.</p>
        </div>
      </div>

      <!-- User preview -->
      <div id="del-user-preview" class="bg-charcoal-200 rounded-xl p-4 mb-4 border border-white/5">
        <p class="text-white font-semibold text-sm" id="del-user-name">—</p>
        <p class="text-gray-400 text-xs mt-0.5" id="del-user-email">—</p>
        <div class="flex gap-2 mt-2">
          <span id="del-user-role" class="text-xs px-2 py-0.5 rounded-full badge-indigo font-semibold">—</span>
          <span id="del-balance-badge" class="text-xs px-2 py-0.5 rounded-full badge-amber font-semibold hidden">Balance: $0.00</span>
        </div>
      </div>

      <!-- Blockers warning -->
      <div id="del-blockers" class="hidden bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-4">
        <p class="text-red-400 text-sm font-semibold mb-2 flex items-center gap-2">
          <i class="fas fa-shield-exclamation"></i> Deletion Blockers
        </p>
        <ul id="del-blockers-list" class="space-y-1 text-xs text-red-300/80 list-disc list-inside"></ul>
        <label class="flex items-center gap-2 mt-3 cursor-pointer">
          <input type="checkbox" id="del-force" class="rounded" onchange="toggleForceOverride()"/>
          <span class="text-xs text-yellow-400 font-medium">Force override — cancel active bookings and bypass disputes</span>
        </label>
      </div>

      <!-- Reason -->
      <div class="mb-4">
        <label class="text-xs text-gray-400 font-semibold block mb-1.5">Reason for Deletion <span class="text-red-400">*</span></label>
        <textarea id="del-reason" rows="2" placeholder="e.g. Fraudulent activity, TOS violation, User request..."
          class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-red-500 resize-none"></textarea>
      </div>

      <!-- Password re-entry -->
      <div class="mb-5">
        <label class="text-xs text-gray-400 font-semibold block mb-1.5">
          <i class="fas fa-lock text-xs mr-1"></i>Confirm Your Admin Password <span class="text-red-400">*</span>
        </label>
        <input type="password" id="del-password" placeholder="Enter your admin password to confirm"
          class="w-full bg-charcoal-200 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-red-500"/>
        <p id="del-pw-error" class="hidden text-red-400 text-xs mt-1.5 items-center gap-1">
          <i class="fas fa-xmark-circle text-xs"></i> <span id="del-pw-error-text">Incorrect password</span>
        </p>
      </div>

      <!-- Action buttons -->
      <div class="flex gap-3">
        <button onclick="closeDeleteModal()" class="flex-1 py-3 bg-charcoal-200 hover:bg-charcoal-300 text-white rounded-xl text-sm font-semibold transition-colors">
          Cancel
        </button>
        <button id="del-confirm-btn" onclick="confirmDelete()" disabled
          class="flex-1 py-3 bg-red-600 hover:bg-red-500 disabled:bg-red-900/50 disabled:text-red-700 text-white rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2">
          <i class="fas fa-trash-can text-sm"></i> <span id="del-btn-text">Delete Account</span>
        </button>
      </div>
    </div>
  </div>

  <!-- ── User Detail Side Panel ──────────────────────────────────────────── -->
  <div id="detail-panel" class="fixed right-0 top-0 bottom-0 w-full max-w-md bg-charcoal-100 border-l border-white/10 z-40 hidden overflow-y-auto shadow-2xl transform translate-x-full transition-transform duration-300">
    <div class="sticky top-0 bg-charcoal-100 border-b border-white/5 px-5 py-4 flex items-center justify-between z-10">
      <h3 class="font-bold text-white">User Detail</h3>
      <button onclick="closeDetailPanel()" class="w-8 h-8 bg-charcoal-200 hover:bg-charcoal-300 rounded-lg flex items-center justify-center text-gray-400 hover:text-white transition-colors">
        <i class="fas fa-xmark text-sm"></i>
      </button>
    </div>
    <div id="detail-content" class="p-5 space-y-4">
      <div class="text-center py-10 text-gray-600"><i class="fas fa-spinner fa-spin text-2xl"></i></div>
    </div>
  </div>
  <div id="detail-overlay" class="fixed inset-0 bg-black/50 z-30 hidden" onclick="closeDetailPanel()"></div>

  <!-- ── Toast ─────────────────────────────────────────────────────────── -->
  <div id="uc-toast" class="fixed bottom-6 right-6 z-50 hidden max-w-sm">
    <div id="uc-toast-inner" class="flex items-start gap-3 p-4 rounded-xl shadow-2xl border">
      <i id="uc-toast-icon" class="text-lg mt-0.5 flex-shrink-0"></i>
      <div class="min-w-0">
        <p id="uc-toast-title" class="font-semibold text-sm text-white"></p>
        <p id="uc-toast-msg" class="text-xs text-gray-300 mt-0.5"></p>
      </div>
    </div>
  </div>

  <script>
    // ── State ──────────────────────────────────────────────────────────────
    let currentDeleteUserId = null
    let currentDeleteUserName = ''
    let pendingBlockers = null

    // ── Auth helper — uses HttpOnly admin cookie sent automatically ──────────
    // The __pp_admin cookie is HttpOnly/Secure; credentials:'same-origin' sends it.
    function adminFetch(url, options) {
      options = options || {}
      return fetch(url, Object.assign({}, options, { credentials: 'same-origin' }))
    }

    // ── Client-side table filter (no fetch needed — users are server-rendered) ──
    function filterTable() {
      const q      = (document.getElementById('uc-search').value || '').toLowerCase()
      const role   = document.getElementById('uc-role').value.toLowerCase()
      const status = document.getElementById('uc-status').value.toLowerCase()
      const rows   = document.querySelectorAll('#uc-table-body tr[data-name]')
      let visible  = 0
      rows.forEach(row => {
        const name   = (row.dataset.name   || '')
        const email  = (row.dataset.email  || '')
        const rRole  = (row.dataset.role   || '').toLowerCase()
        const rStat  = (row.dataset.status || '').toLowerCase()
        const show   = (!q || name.includes(q) || email.includes(q)) &&
                       (!role   || rRole   === role) &&
                       (!status || rStat === status)
        row.style.display = show ? '' : 'none'
        if (show) visible++
      })
      const cnt = document.getElementById('uc-count')
      if (cnt) cnt.textContent = visible + ' user' + (visible !== 1 ? 's' : '') + (q||role||status ? ' matching filter' : ' total')
    }

    // ── After delete/suspend: reload page to refresh table ─────────────────
    function reloadPage() { window.location.reload() }

    // ── Suspend Modal ──────────────────────────────────────────────────────
    let currentSuspendUserId = null
    let currentSuspendAction = 'suspend'

    function openSuspendModal(userId, name, currentStatus) {
      currentSuspendUserId = userId
      currentSuspendAction = currentStatus === 'suspended' ? 'unsuspend' : 'suspend'
      const isSuspend = currentSuspendAction === 'suspend'
      document.getElementById('sus-user-name').textContent = name
      document.getElementById('sus-reason').value = ''
      document.getElementById('sus-confirm-btn').disabled = true
      document.getElementById('sus-btn-text').textContent = isSuspend ? 'Suspend Account' : 'Unsuspend Account'
      document.getElementById('sus-btn-icon').className = isSuspend ? 'fas fa-user-lock text-sm' : 'fas fa-user-check text-sm'
      document.getElementById('suspend-title').textContent = isSuspend ? 'Suspend Account' : 'Unsuspend Account'
      document.getElementById('suspend-subtitle').textContent = isSuspend
        ? 'The user will lose access immediately. You can unsuspend at any time.'
        : 'The user will regain full access. Make sure any issues have been resolved.'
      document.getElementById('suspend-icon').className = isSuspend
        ? 'fas fa-user-lock text-amber-400 text-xl'
        : 'fas fa-user-check text-green-400 text-xl'
      document.getElementById('suspend-modal').classList.remove('hidden')
      document.getElementById('suspend-modal').classList.add('flex')
    }

    function closeSuspendModal() {
      document.getElementById('suspend-modal').classList.add('hidden')
      document.getElementById('suspend-modal').classList.remove('flex')
      currentSuspendUserId = null
    }

    async function confirmSuspend() {
      const reason = document.getElementById('sus-reason').value.trim()
      if (!reason || !currentSuspendUserId) return
      const btn = document.getElementById('sus-confirm-btn')
      btn.disabled = true
      document.getElementById('sus-btn-text').textContent = 'Processing...'
      try {
        const r = await adminFetch('/api/admin/users/' + currentSuspendUserId + '/suspend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: currentSuspendAction, reason })
        })
        const d = await r.json()
        if (d.success) {
          closeSuspendModal()
          const label = currentSuspendAction === 'suspend' ? 'User Suspended' : 'User Unsuspended'
          showToast('success', label, 'Account status changed to ' + d.new_status + '.')
          setTimeout(reloadPage, 600)
        } else {
          showToast('error', 'Action Failed', d.error || 'Unknown error')
          btn.disabled = false
          document.getElementById('sus-btn-text').textContent =
            currentSuspendAction === 'suspend' ? 'Suspend Account' : 'Unsuspend Account'
        }
      } catch(e) {
        showToast('error', 'Network Error', e.message)
        btn.disabled = false
        document.getElementById('sus-btn-text').textContent =
          currentSuspendAction === 'suspend' ? 'Suspend Account' : 'Unsuspend Account'
      }
    }

    // ── Delete Modal ───────────────────────────────────────────────────────
    function openDeleteModal(userId, name, email, role) {
      currentDeleteUserId = userId
      currentDeleteUserName = name
      document.getElementById('del-user-name').textContent = name
      document.getElementById('del-user-email').textContent = email
      document.getElementById('del-user-role').textContent = role
      document.getElementById('del-reason').value = ''
      document.getElementById('del-password').value = ''
      document.getElementById('del-pw-error').classList.add('hidden')
      document.getElementById('del-blockers').classList.add('hidden')
      document.getElementById('del-force').checked = false
      document.getElementById('del-balance-badge').classList.add('hidden')
      document.getElementById('del-btn-text').textContent = 'Delete Account'
      document.getElementById('del-confirm-btn').disabled = true
      document.getElementById('delete-modal').classList.remove('hidden')
      document.getElementById('delete-modal').classList.add('flex')

      // Fetch user detail for balance + blockers
      loadDeletePreview(userId)

      // Enable button when both fields filled
      ['del-reason','del-password'].forEach(id => {
        document.getElementById(id).addEventListener('input', checkDeleteReady)
      })
    }

    async function loadDeletePreview(userId) {
      try {
        const r = await adminFetch('/api/admin/users/' + userId)
        if (!r.ok) return
        const d = await r.json()
        if (d.balance && d.balance.total > 0) {
          const badge = document.getElementById('del-balance-badge')
          badge.textContent = 'Balance: $' + d.balance.total.toFixed(2)
          badge.classList.remove('hidden')
        }
        if (d.blockers && d.blockers.blocked) {
          pendingBlockers = d.blockers
          document.getElementById('del-blockers').classList.remove('hidden')
          const list = document.getElementById('del-blockers-list')
          list.innerHTML = d.blockers.reasons.map(r => '<li>' + String(r).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</li>').join('')
        }
      } catch {}
    }

    function checkDeleteReady() {
      const reason = document.getElementById('del-reason').value.trim()
      const pw     = document.getElementById('del-password').value.trim()
      const force  = document.getElementById('del-force').checked
      const hasBlockers = pendingBlockers && pendingBlockers.blocked
      document.getElementById('del-confirm-btn').disabled =
        !reason || !pw || (hasBlockers && !force)
    }

    function toggleForceOverride() { checkDeleteReady() }

    function closeDeleteModal() {
      document.getElementById('delete-modal').classList.add('hidden')
      document.getElementById('delete-modal').classList.remove('flex')
      currentDeleteUserId = null
      pendingBlockers = null
    }

    async function confirmDelete() {
      const reason   = document.getElementById('del-reason').value.trim()
      const password = document.getElementById('del-password').value.trim()
      const force    = document.getElementById('del-force').checked

      if (!reason || !password) return

      const btn     = document.getElementById('del-confirm-btn')
      const btnText = document.getElementById('del-btn-text')
      const pwErr   = document.getElementById('del-pw-error')
      const pwErrTx = document.getElementById('del-pw-error-text')

      btn.disabled = true
      btnText.textContent = 'Deleting...'
      pwErr.classList.add('hidden')

      try {
        const res = await adminFetch('/api/admin/users/' + currentDeleteUserId + '/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason, force, password })
        })

        let data
        try { data = await res.json() } catch(e) {
          throw new Error('Server returned non-JSON (status ' + res.status + '). You may need to log in again.')
        }

        if (res.status === 401) {
          window.location.href = '/admin/login?reason=auth'
          return
        }

        if (res.status === 403 && data.code === 'wrong_password') {
          pwErrTx.textContent = 'Incorrect admin password'
          pwErr.classList.remove('hidden')
          btn.disabled = false
          btnText.textContent = 'Delete Account'
          document.getElementById('del-password').value = ''
          document.getElementById('del-password').focus()
          return
        }

        if (!res.ok) {
          // Show error inside modal so it's never missed
          pwErrTx.textContent = data.error || ('Unexpected error (HTTP ' + res.status + ')')
          pwErr.classList.remove('hidden')
          btn.disabled = false
          btnText.textContent = 'Delete Account'
          return
        }

        if (data.success) {
          closeDeleteModal()
          showToast('success', 'Account Deleted',
            data.balance_refunded > 0
              ? 'User deleted. $' + data.balance_refunded.toFixed(2) + ' refunded.'
              : 'User deleted successfully.')
          setTimeout(reloadPage, 800)
        } else {
          pwErrTx.textContent = data.error || 'Deletion failed — unknown error'
          pwErr.classList.remove('hidden')
          btn.disabled = false
          btnText.textContent = 'Delete Account'
        }

      } catch(e) {
        pwErrTx.textContent = 'Error: ' + e.message
        pwErr.classList.remove('hidden')
        btn.disabled = false
        btnText.textContent = 'Delete Account'
      }
    }

    // ── Detail Panel ───────────────────────────────────────────────────────
    async function openDetailPanel(userId) {
      document.getElementById('detail-panel').classList.remove('hidden')
      document.getElementById('detail-panel').classList.remove('translate-x-full')
      document.getElementById('detail-overlay').classList.remove('hidden')
      document.getElementById('detail-content').innerHTML =
        '<div class="text-center py-10 text-gray-600"><i class="fas fa-spinner fa-spin text-2xl"></i></div>'

      try {
        const r = await adminFetch('/api/admin/users/' + userId)
        if (r.status === 401) { window.location.href = '/admin/login?reason=auth'; return }
        const d = await r.json()
        renderDetailPanel(d)
      } catch(e) {
        document.getElementById('detail-content').innerHTML =
          '<p class="text-red-400 text-sm text-center py-10">Failed to load user details. Please try again.</p>'
      }
    }

    function closeDetailPanel() {
      document.getElementById('detail-panel').classList.add('translate-x-full')
      setTimeout(() => {
        document.getElementById('detail-panel').classList.add('hidden')
        document.getElementById('detail-overlay').classList.add('hidden')
      }, 300)
    }

    function renderDetailPanel(d) {
      const u = d.user || {}
      const bal = d.balance || {}
      const blk = d.blockers || {}
      const pmts = d.payments || []
      const lst  = d.listings || []
      const bks  = d.bookings || []

      const html =
        '<div class="flex items-center gap-3 p-4 bg-charcoal-200 rounded-xl">' +
          '<div class="w-12 h-12 gradient-bg rounded-full flex items-center justify-center font-black text-white text-lg">' +
            (u.full_name||'?').substring(0,2).toUpperCase() +
          '</div>' +
          '<div class="flex-1 min-w-0">' +
            '<p class="font-bold text-white">' + (u.full_name||'—').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</p>' +
            '<p class="text-gray-400 text-xs mt-0.5 truncate">' + (u.email||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</p>' +
            '<div class="flex gap-1.5 mt-1.5">' +
              '<span class="text-xs px-2 py-0.5 badge-indigo rounded-full font-semibold">' + (u.role||'').replace(/</g,'&lt;') + '</span>' +
              '<span class="text-xs px-2 py-0.5 ' + (u.status==='active'?'badge-green':'badge-red') + ' rounded-full font-semibold">' + (u.status||'').replace(/</g,'&lt;') + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // Balance section
        '<div class="bg-charcoal-200 rounded-xl p-4 border border-lime-500/20">' +
          '<p class="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-3 flex items-center gap-2">' +
            '<i class="fas fa-scale-balanced text-lime-400 text-xs"></i> Balance & Refund Preview' +
          '</p>' +
          '<p class="text-2xl font-black text-lime-400">$' + (bal.total||0).toFixed(2) + '</p>' +
          '<p class="text-xs text-gray-500 mt-0.5">Refundable amount</p>' +
          (bal.breakdown && bal.breakdown.length ? '<div class="mt-3 space-y-1.5">' +
            bal.breakdown.map(b =>
              '<div class="flex items-center justify-between text-xs"><span class="text-gray-400">' + b.label + '</span><span class="text-white font-semibold">$' + (b.amount||0).toFixed(2) + '</span></div>'
            ).join('') +
          '</div>' : '') +
        '</div>' +

        // Blockers
        (blk.blocked ? '<div class="bg-red-500/10 border border-red-500/20 rounded-xl p-4">' +
          '<p class="text-red-400 text-xs font-semibold mb-2 flex items-center gap-1.5"><i class="fas fa-shield-exclamation text-xs"></i> Deletion Blockers</p>' +
          '<ul class="space-y-1">' + blk.reasons.map(r => '<li class="text-red-300/80 text-xs">• ' + r + '</li>').join('') + '</ul>' +
        '</div>' : '') +

        // Stripe info
        (u.stripe_customer_id ? '<div class="flex items-center gap-2 p-3 bg-charcoal-200 rounded-xl">' +
          '<i class="fab fa-stripe text-indigo-400"></i>' +
          '<div><p class="text-xs text-gray-400">Stripe Customer</p><p class="text-xs font-mono text-white">' + u.stripe_customer_id + '</p></div>' +
        '</div>' : '') +

        // Listings
        (lst.length ? '<div>' +
          '<p class="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5"><i class="fas fa-parking text-xs text-indigo-400"></i> Listings (' + lst.length + ')</p>' +
          '<div class="space-y-1.5">' + lst.slice(0,5).map(l =>
            '<div class="flex items-center justify-between p-2.5 bg-charcoal-200 rounded-xl text-xs">' +
              '<span class="text-white truncate max-w-[200px]">' + l.title + '</span>' +
              '<span class="' + (l.status==='active'?'text-lime-400':'text-gray-600') + ' font-semibold ml-2">' + l.status + '</span>' +
            '</div>'
          ).join('') +
          '</div></div>' : '') +

        // Recent Payments
        (pmts.length ? '<div>' +
          '<p class="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5"><i class="fas fa-receipt text-xs text-indigo-400"></i> Recent Payments (' + pmts.length + ')</p>' +
          '<div class="space-y-1.5">' + pmts.slice(0,5).map(p =>
            '<div class="flex items-center justify-between p-2.5 bg-charcoal-200 rounded-xl text-xs">' +
              '<span class="text-gray-400">' + formatDate(p.created_at) + '</span>' +
              '<span class="' + (p.status==='succeeded'?'text-lime-400':p.status==='refunded'?'text-blue-400':'text-yellow-400') + ' font-semibold">$' + (p.amount||0).toFixed(2) + ' · ' + p.status + '</span>' +
            '</div>'
          ).join('') +
          '</div></div>' : '') +

        // Delete action
        '<div class="pt-2 border-t border-white/5">' +
          (u.role !== 'ADMIN' ?
            '<button onclick="openDeleteModal(' + u.id + ', \'' + escapeHtml(u.full_name||'Unknown') + '\', \'' + escapeHtml(u.email) + '\', \'' + u.role + '\')" class="w-full py-3 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-400 hover:text-red-300 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"><i class=\\"fas fa-trash-can\\"></i> Delete This Account</button>'
            : '<p class="text-center text-gray-600 text-xs py-2">Admin accounts cannot be deleted via this panel.</p>'
          ) +
        '</div>'

      document.getElementById('detail-content').innerHTML = html
    }

    // ── Toast ──────────────────────────────────────────────────────────────
    function showToast(type, title, msg) {
      const t   = document.getElementById('uc-toast')
      const ti  = document.getElementById('uc-toast-inner')
      const ico = document.getElementById('uc-toast-icon')
      document.getElementById('uc-toast-title').textContent = title
      document.getElementById('uc-toast-msg').textContent   = msg
      if (type === 'success') {
        ti.className  = 'flex items-start gap-3 p-4 rounded-xl shadow-2xl border bg-charcoal-100 border-lime-500/30'
        ico.className = 'fas fa-check-circle text-lime-400 text-lg mt-0.5 flex-shrink-0'
      } else {
        ti.className  = 'flex items-start gap-3 p-4 rounded-xl shadow-2xl border bg-charcoal-100 border-red-500/30'
        ico.className = 'fas fa-xmark-circle text-red-400 text-lg mt-0.5 flex-shrink-0'
      }
      t.classList.remove('hidden')
      setTimeout(() => t.classList.add('hidden'), 5000)
    }

    // ── Helpers ────────────────────────────────────────────────────────────
    function formatDate(dt) {
      if (!dt) return '—'
      try { return new Date(dt).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) } catch { return dt }
    }
    function escapeHtml(s) {
      return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
    }
  </script>
  `
  return c.html(AdminLayout('User Control', content))
})

// ════════════════════════════════════════════════════════════════════════════
// GET /admin/audit-log  — Paginated audit log viewer
// ════════════════════════════════════════════════════════════════════════════
adminPanel.get('/audit-log', async (c: any) => {
  // embeddedToken removed — admin cookie sent automatically via credentials:'same-origin'
  const content = `
  <div class="flex items-center justify-between mb-6">
    <p class="text-gray-400 text-sm">Immutable record of all admin actions. Every deletion, refund, and override is logged here.</p>
  </div>

  <!-- Filter bar -->
  <div class="flex flex-wrap gap-3 mb-5">
    <select id="al-action" onchange="alLoad()"
      class="bg-charcoal-100 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-gray-400 focus:outline-none focus:border-indigo-500">
      <option value="">All Actions</option>
      <option value="delete_user">Delete User</option>
      <option value="issue_refund">Issue Refund</option>
      <option value="suspend_user">Suspend User</option>
      <option value="cancel_booking">Cancel Booking</option>
    </select>
    <button onclick="alLoad()" class="btn-primary px-4 py-2.5 rounded-xl text-sm text-white font-semibold flex items-center gap-2">
      <i class="fas fa-arrows-rotate text-xs"></i> Refresh
    </button>
  </div>

  <!-- Log Table -->
  <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-charcoal-200/60">
          <tr>
            ${['#', 'Timestamp', 'Admin', 'Action', 'Target', 'Role', 'Reason', 'IP'].map(h =>
              '<th class="px-4 py-3 text-left text-xs text-gray-500 uppercase tracking-wider font-semibold whitespace-nowrap">' + h + '</th>'
            ).join('')}
          </tr>
        </thead>
        <tbody id="al-table-body">
          <tr><td colspan="8" class="text-center py-10 text-gray-600 text-sm">
            <i class="fas fa-spinner fa-spin mr-2"></i> Loading audit log...
          </td></tr>
        </tbody>
      </table>
    </div>
    <div class="flex items-center justify-between px-5 py-3 border-t border-white/5">
      <p class="text-gray-600 text-xs" id="al-count">Loading...</p>
      <div class="flex gap-2">
        <button id="al-prev" onclick="alPage(-1)" class="px-3 py-1.5 bg-charcoal-200 text-gray-500 hover:text-white rounded-lg text-xs transition-colors">← Prev</button>
        <button id="al-next" onclick="alPage(1)"  class="px-3 py-1.5 bg-charcoal-200 text-gray-500 hover:text-white rounded-lg text-xs transition-colors">Next →</button>
      </div>
    </div>
  </div>

  <!-- Refund Log Section -->
  <div class="mt-8">
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-bold text-white flex items-center gap-2">
        <i class="fas fa-rotate-left text-indigo-400"></i> Refund Log
      </h3>
    </div>
    <div class="bg-charcoal-100 rounded-2xl border border-white/5 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-charcoal-200/60">
            <tr>
              ${['#', 'Date', 'User Email', 'Type', 'Amount', 'Status', 'Stripe Refund ID', 'Note'].map(h =>
                '<th class="px-4 py-3 text-left text-xs text-gray-500 uppercase tracking-wider font-semibold whitespace-nowrap">' + h + '</th>'
              ).join('')}
            </tr>
          </thead>
          <tbody id="rl-table-body">
            <tr><td colspan="8" class="text-center py-6 text-gray-600 text-xs">Loading refund log...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    // Admin cookie is HttpOnly/Secure — sent automatically via credentials:'same-origin'
    function adminFetch(url, options) {
      options = options || {}
      return fetch(url, Object.assign({}, options, { credentials: 'same-origin' }))
    }

    let alOffset = 0
    const alLimit = 50
    let alTotal = 0

    async function alLoad() {
      const action = document.getElementById('al-action').value
      const params = new URLSearchParams({ limit: alLimit, offset: alOffset })
      if (action) params.set('action', action)
      try {
        const r = await adminFetch('/api/admin/audit-log?' + params.toString())
        const d = await r.json()
        alTotal = d.total
        renderAuditTable(d.entries || [])
        document.getElementById('al-count').textContent =
          'Showing ' + (alOffset + 1) + '–' + Math.min(alOffset + alLimit, alTotal) + ' of ' + alTotal + ' entries'
        document.getElementById('al-prev').disabled = alOffset === 0
        document.getElementById('al-next').disabled = alOffset + alLimit >= alTotal
      } catch(e) {
        document.getElementById('al-table-body').innerHTML =
          '<tr><td colspan="8" class="text-center py-8 text-red-400 text-xs">Failed to load: ' + e.message + '</td></tr>'
      }
    }

    function alPage(dir) { alOffset = Math.max(0, alOffset + dir * alLimit); alLoad() }

    function renderAuditTable(entries) {
      const tbody = document.getElementById('al-table-body')
      if (!entries.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-10 text-gray-600 text-sm">No audit entries yet.</td></tr>'
        return
      }
      const actionColors = {
        delete_user: 'badge-red', issue_refund: 'badge-green', suspend_user: 'badge-amber',
        cancel_booking: 'badge-amber', deactivate_listing: 'badge-gray', override: 'badge-indigo'
      }
      tbody.innerHTML = entries.map(e => {
        const color = actionColors[e.action] || 'badge-gray'
        const date = e.created_at ? new Date(e.created_at).toLocaleString('en-US', {month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'
        const eId      = parseInt(e.id) || 0
        const tId      = parseInt(e.target_id) || 0
        const action   = escapeHtml(e.action || '')
        const admEmail = escapeHtml(e.admin_email || '—')
        const tEmail   = escapeHtml(e.target_email || '')
        const tType    = escapeHtml(e.target_type || '')
        const tRole    = escapeHtml(e.target_role || '—')
        const reason   = escapeHtml(e.reason || '—')
        const ip       = escapeHtml(e.ip_address || '—')
        return '<tr class="border-b border-white/5 hover:bg-white/[.02] transition-colors">' +
          '<td class="px-4 py-3 text-gray-600 text-xs font-mono">' + eId + '</td>' +
          '<td class="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">' + date + '</td>' +
          '<td class="px-4 py-3 text-xs"><p class="text-white font-medium">' + admEmail + '</p></td>' +
          '<td class="px-4 py-3"><span class="text-xs px-2 py-0.5 rounded-full font-semibold ' + color + '">' + action.replace(/_/g,' ') + '</span></td>' +
          '<td class="px-4 py-3 text-xs"><p class="text-white">' + (tEmail || 'ID: ' + tId) + '</p><p class="text-gray-600">' + tType + ' #' + tId + '</p></td>' +
          '<td class="px-4 py-3 text-gray-400 text-xs">' + tRole + '</td>' +
          '<td class="px-4 py-3 text-gray-400 text-xs max-w-[160px] truncate" title="' + reason + '">' + reason + '</td>' +
          '<td class="px-4 py-3 text-gray-600 text-xs font-mono">' + ip + '</td>' +
        '</tr>'
      }).join('')
    }

    async function loadRefundLog() {
      try {
        const r = await adminFetch('/api/admin/refund-log?limit=50')
        const d = await r.json()
        const tbody = document.getElementById('rl-table-body')
        const entries = d.entries || []
        if (!entries.length) {
          tbody.innerHTML = '<tr><td colspan="8" class="text-center py-6 text-gray-600 text-xs">No refunds issued yet.</td></tr>'
          return
        }
        const statusColors = { succeeded:'badge-green', failed:'badge-red', manual_required:'badge-amber', pending:'badge-amber', skipped:'badge-gray' }
        tbody.innerHTML = entries.map(e => {
          const color = statusColors[e.status] || 'badge-gray'
          const date = e.refunded_at ? new Date(e.refunded_at).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'
          const eId     = parseInt(e.id) || 0
          const amount  = parseFloat(e.amount || 0)
          const uEmail  = escapeHtml(e.user_email || '—')
          const rType   = escapeHtml(e.refund_type || '—')
          const status  = escapeHtml(e.status || '—')
          const stripeId = escapeHtml(e.stripe_refund_id || '—')
          const note    = escapeHtml(e.manual_note || e.failure_reason || '—')
          return '<tr class="border-b border-white/5 hover:bg-white/[.02] transition-colors">' +
            '<td class="px-4 py-3 text-gray-600 text-xs font-mono">' + eId + '</td>' +
            '<td class="px-4 py-3 text-gray-400 text-xs">' + date + '</td>' +
            '<td class="px-4 py-3 text-white text-xs">' + uEmail + '</td>' +
            '<td class="px-4 py-3 text-gray-400 text-xs">' + rType + '</td>' +
            '<td class="px-4 py-3 text-lime-400 text-xs font-semibold">$' + amount.toFixed(2) + '</td>' +
            '<td class="px-4 py-3"><span class="text-xs px-2 py-0.5 rounded-full font-semibold ' + color + '">' + status + '</span></td>' +
            '<td class="px-4 py-3 text-gray-500 text-xs font-mono">' + stripeId + '</td>' +
            '<td class="px-4 py-3 text-gray-500 text-xs max-w-[120px] truncate">' + note + '</td>' +
          '</tr>'
        }).join('')
      } catch {}
    }

    alLoad(); loadRefundLog()
  </script>
  `
  return c.html(AdminLayout('Audit Log', content))
})
