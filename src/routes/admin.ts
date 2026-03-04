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
