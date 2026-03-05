// Admin-specific layout — completely separate from public site layout
// No public nav, no public footer, no user data leaked

export const AdminLayout = (title: string, content: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title} — ParkPeer Admin</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet"/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet"/>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            indigo: { DEFAULT:'#5B2EFF', 50:'#f0ebff', 400:'#7a4fff', 500:'#5B2EFF', 600:'#4a20f0', 700:'#3a12d4' },
            lime: { DEFAULT:'#C6FF00', 500:'#C6FF00', 600:'#a8d900' },
            charcoal: { DEFAULT:'#121212', 100:'#1E1E1E', 200:'#2a2a2a', 300:'#3a3a3a', 400:'#4a4a4a' }
          },
          fontFamily: { sans: ['Inter','system-ui','sans-serif'] }
        }
      }
    }
  </script>
  <style>
    * { font-family: 'Inter', sans-serif; }
    .gradient-bg { background: linear-gradient(135deg, #5B2EFF 0%, #3a12d4 100%); }
    .gradient-text { background:linear-gradient(135deg,#5B2EFF,#C6FF00); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
    .btn-primary { background:linear-gradient(135deg,#5B2EFF,#4a20f0); transition:all .2s; }
    .btn-primary:hover { transform:translateY(-1px); box-shadow:0 8px 25px rgba(91,46,255,.5); }
    .stat-card { background:linear-gradient(135deg,#1E1E1E,#2a2a2a); border:1px solid rgba(91,46,255,.15); }
    .card-hover { transition:all .3s cubic-bezier(.4,0,.2,1); }
    .card-hover:hover { transform:translateY(-2px); box-shadow:0 12px 30px rgba(91,46,255,.12); }
    .pulse-dot { animation:pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.7;transform:scale(1.1)} }
    .admin-nav-active { background:rgba(91,46,255,.15); color:#a78bfa; font-weight:600; border-left:2px solid #5B2EFF; }
    .admin-nav-item { border-left:2px solid transparent; transition:all .15s; }
    .admin-nav-item:hover { background:rgba(255,255,255,.04); color:#fff; }
    ::-webkit-scrollbar { width:4px; }
    ::-webkit-scrollbar-track { background:#121212; }
    ::-webkit-scrollbar-thumb { background:#5B2EFF; border-radius:2px; }
    .badge-red { background:rgba(239,68,68,.15); color:#f87171; }
    .badge-green { background:rgba(34,197,94,.15); color:#4ade80; }
    .badge-amber { background:rgba(245,158,11,.15); color:#fbbf24; }
    .badge-indigo { background:rgba(91,46,255,.15); color:#a78bfa; }
    .badge-gray { background:rgba(107,114,128,.15); color:#9ca3af; }
    .table-row:hover { background:rgba(255,255,255,.025); }
    @media(max-width:1024px) { .admin-sidebar { display:none !important; } }
  </style>
</head>
<body class="bg-[#121212] text-white min-h-screen">
  <div class="flex h-screen overflow-hidden">

    <!-- ── Sidebar ── -->
    <aside class="admin-sidebar w-60 bg-charcoal-100 border-r border-white/5 flex flex-col flex-shrink-0 overflow-y-auto">

      <!-- Brand -->
      <div class="p-5 border-b border-white/5 flex-shrink-0">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 gradient-bg rounded-xl flex items-center justify-center flex-shrink-0">
            <i class="fas fa-shield-halved text-white text-sm"></i>
          </div>
          <div class="min-w-0">
            <p class="font-black text-white text-sm leading-tight">ParkPeer</p>
            <p class="text-xs text-gray-500">Admin Console</p>
          </div>
        </div>
      </div>

      <!-- Nav -->
      <nav class="flex-1 p-3 pt-4 space-y-0.5">
        <p class="text-xs text-gray-600 uppercase tracking-wider font-semibold mb-2 px-3">Overview</p>
        <a href="/admin" class="admin-nav-item flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-400 ${title === 'Dashboard' ? 'admin-nav-active' : ''}">
          <i class="fas fa-gauge-high w-4 text-center text-indigo-500/80"></i> Dashboard
        </a>
        <a href="/admin/analytics" class="admin-nav-item flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-400 ${title === 'Analytics' ? 'admin-nav-active' : ''}">
          <i class="fas fa-chart-line w-4 text-center text-indigo-500/80"></i> Analytics
        </a>
        <a href="/admin/revenue" class="admin-nav-item flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-400 ${title === 'Revenue' ? 'admin-nav-active' : ''}">
          <i class="fas fa-dollar-sign w-4 text-center text-indigo-500/80"></i> Revenue
        </a>

        <p class="text-xs text-gray-600 uppercase tracking-wider font-semibold mb-2 mt-5 px-3">Manage</p>
        <a href="/admin/users" class="admin-nav-item flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-400 ${title === 'Users' ? 'admin-nav-active' : ''}">
          <i class="fas fa-users w-4 text-center text-indigo-500/80"></i>
          <span class="flex-1">Users</span>
          <span id="badge-users" class="hidden w-5 h-5 badge-indigo rounded-full text-xs font-bold flex items-center justify-center">0</span>
        </a>
        <a href="/admin/listings" class="admin-nav-item flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-400 ${title === 'Listings' ? 'admin-nav-active' : ''}">
          <i class="fas fa-parking w-4 text-center text-indigo-500/80"></i>
          <span class="flex-1">Listings</span>
          <span id="badge-listings" class="hidden w-5 h-5 badge-amber rounded-full text-xs font-bold flex items-center justify-center">0</span>
        </a>
        <a href="/admin/bookings" class="admin-nav-item flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-400 ${title === 'Bookings' ? 'admin-nav-active' : ''}">
          <i class="fas fa-calendar-check w-4 text-center text-indigo-500/80"></i> Bookings
        </a>
        <a href="/admin/payments" class="admin-nav-item flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-400 ${title === 'Payments' ? 'admin-nav-active' : ''}">
          <i class="fas fa-credit-card w-4 text-center text-indigo-500/80"></i> Payments
        </a>
        <a href="/admin/reviews" class="admin-nav-item flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-400 ${title === 'Reviews' ? 'admin-nav-active' : ''}">
          <i class="fas fa-star w-4 text-center text-indigo-500/80"></i> Reviews
        </a>

        <p class="text-xs text-gray-600 uppercase tracking-wider font-semibold mb-2 mt-5 px-3">Support</p>
        <a href="/admin/disputes" class="admin-nav-item flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-400 ${title === 'Disputes' ? 'admin-nav-active' : ''}">
          <i class="fas fa-gavel w-4 text-center text-indigo-500/80"></i>
          <span class="flex-1">Disputes</span>
          <span id="badge-disputes" class="hidden w-5 h-5 badge-red rounded-full text-xs font-bold flex items-center justify-center">0</span>
        </a>
        <a href="/admin/fraud" class="admin-nav-item flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-400 ${title === 'Fraud' ? 'admin-nav-active' : ''}">
          <i class="fas fa-triangle-exclamation w-4 text-center text-amber-500/80"></i>
          <span class="flex-1">Fraud Alerts</span>
          <span id="badge-fraud" class="hidden w-5 h-5 badge-amber rounded-full text-xs font-bold flex items-center justify-center">0</span>
        </a>
        <a href="/admin/user-control" class="admin-nav-item flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-400 ${title === 'User Control' ? 'admin-nav-active' : ''}">
          <i class="fas fa-user-xmark w-4 text-center text-red-500/80"></i>
          <span class="flex-1">User Control</span>
        </a>
        <a href="/admin/audit-log" class="admin-nav-item flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-400 ${title === 'Audit Log' ? 'admin-nav-active' : ''}">
          <i class="fas fa-scroll w-4 text-center text-indigo-500/80"></i> Audit Log
        </a>
        <a href="/admin/settings" class="admin-nav-item flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-400 ${title === 'Settings' ? 'admin-nav-active' : ''}">
          <i class="fas fa-gear w-4 text-center text-indigo-500/80"></i> Settings
        </a>
      </nav>

      <!-- Admin identity + logout -->
      <div class="p-4 border-t border-white/5 flex-shrink-0">
        <div class="flex items-center gap-2.5 mb-3">
          <div class="w-8 h-8 gradient-bg rounded-full flex items-center justify-center text-white text-xs font-black flex-shrink-0">A</div>
          <div class="min-w-0">
            <p class="text-white text-xs font-semibold truncate">adminpanama</p>
            <p class="text-gray-600 text-xs">Super Admin</p>
          </div>
        </div>
        <a href="/admin/logout" class="flex items-center gap-2 px-3 py-2 hover:bg-red-500/10 rounded-xl text-xs text-gray-500 hover:text-red-400 transition-colors">
          <i class="fas fa-right-from-bracket text-xs"></i> Sign Out
        </a>
        <a href="/" target="_blank" class="flex items-center gap-2 px-3 py-2 hover:bg-white/5 rounded-xl text-xs text-gray-600 hover:text-gray-400 transition-colors mt-0.5">
          <i class="fas fa-arrow-up-right-from-square text-xs"></i> View Live Site
        </a>
      </div>
    </aside>

    <!-- ── Main area ── -->
    <div class="flex-1 flex flex-col overflow-hidden">

      <!-- Top bar -->
      <header class="flex-shrink-0 h-14 bg-charcoal-100 border-b border-white/5 flex items-center justify-between px-6">
        <div class="flex items-center gap-3">
          <!-- Mobile menu (shown < lg) -->
          <button class="lg:hidden p-2 text-gray-400 hover:text-white" onclick="document.querySelector('.admin-sidebar').classList.toggle('hidden')">
            <i class="fas fa-bars text-sm"></i>
          </button>
          <h1 class="font-bold text-white text-base">${title}</h1>
        </div>
        <div class="flex items-center gap-3">
          <div id="sys-status" class="flex items-center gap-1.5 bg-green-500/10 border border-green-500/20 rounded-full px-3 py-1">
            <div class="w-1.5 h-1.5 bg-green-500 rounded-full pulse-dot"></div>
            <span class="text-green-400 text-xs font-medium">Live</span>
          </div>
          <span class="text-gray-600 text-xs hidden md:block" id="admin-clock"></span>

          <!-- Notification Bell -->
          <div class="relative" id="admin-notif-container">
            <button id="admin-notif-btn" class="relative w-8 h-8 bg-charcoal-200 hover:bg-white/10 rounded-xl flex items-center justify-center text-gray-400 hover:text-white transition-colors" aria-label="Notifications">
              <i class="fas fa-bell text-xs"></i>
              <span id="admin-notif-badge" class="hidden absolute -top-1 -right-1 min-w-[16px] h-[16px] bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none"></span>
            </button>
            <div id="admin-notif-dropdown" class="hidden absolute right-0 top-10 w-80 bg-charcoal-100 border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50">
              <div class="p-3 border-b border-white/5 flex items-center justify-between">
                <h3 class="font-semibold text-white text-sm">Admin Notifications</h3>
                <button id="admin-notif-mark-all" class="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">Mark all read</button>
              </div>
              <div id="admin-notif-list" class="max-h-80 overflow-y-auto">
                <div class="p-4 text-center text-gray-500 text-sm">
                  <i class="fas fa-spinner fa-spin mr-2"></i>Loading…
                </div>
              </div>
              <div class="p-2.5 border-t border-white/5 text-center">
                <a href="/admin/audit-log" class="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">View audit log</a>
              </div>
            </div>
          </div>

          <a href="/admin/logout" title="Sign out" class="w-8 h-8 bg-charcoal-200 hover:bg-red-500/10 rounded-xl flex items-center justify-center text-gray-500 hover:text-red-400 transition-colors">
            <i class="fas fa-right-from-bracket text-xs"></i>
          </a>
        </div>
      </header>

      <!-- Scrollable content -->
      <main class="flex-1 overflow-y-auto p-6">
        ${content}
      </main>
    </div>
  </div>

  <script>
    // Live clock
    function tick() {
      const el = document.getElementById('admin-clock')
      if (el) el.textContent = new Date().toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' })
    }
    tick(); setInterval(tick, 30000)

    // ── Admin Notification Bell ──────────────────────────────────────────────
    const adminNotifBtn      = document.getElementById('admin-notif-btn')
    const adminNotifDropdown = document.getElementById('admin-notif-dropdown')
    const adminNotifBadge    = document.getElementById('admin-notif-badge')
    const adminNotifList     = document.getElementById('admin-notif-list')
    const adminMarkAllBtn    = document.getElementById('admin-notif-mark-all')
    let adminNotifLoading    = false  // prevent concurrent fetches
    let adminDropdownOpen    = false

    const notifIconMap = {
      booking_request:   ['fas fa-car',          'rgba(91,46,255,.15)',  '#a78bfa'],
      booking_confirmed: ['fas fa-check-circle',  'rgba(34,197,94,.15)', '#4ade80'],
      booking_cancelled: ['fas fa-times-circle',  'rgba(239,68,68,.15)', '#f87171'],
      payout_processed:  ['fas fa-dollar-sign',   'rgba(34,197,94,.15)', '#4ade80'],
      review_received:   ['fas fa-star',          'rgba(245,158,11,.15)','#fbbf24'],
      new_registration:  ['fas fa-user-plus',     'rgba(91,46,255,.15)', '#a78bfa'],
      new_listing:       ['fas fa-parking',       'rgba(91,46,255,.15)', '#a78bfa'],
      dispute_opened:    ['fas fa-balance-scale', 'rgba(239,68,68,.15)', '#f87171'],
      refund_processed:  ['fas fa-undo',          'rgba(245,158,11,.15)','#fbbf24'],
      security_alert:    ['fas fa-shield-alt',    'rgba(239,68,68,.15)', '#f87171'],
      system:            ['fas fa-bell',          'rgba(107,114,128,.15)','#9ca3af'],
    }

    function adminNotifLink(n) {
      if (!n.related_entity) return '/admin'
      const { type } = n.related_entity
      if (type === 'booking')  return '/admin/bookings'
      if (type === 'listing')  return '/admin/listings'
      if (type === 'user')     return '/admin/user-control'
      if (type === 'dispute')  return '/admin/disputes'
      return '/admin'
    }

    function timeAgo(d) {
      const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
      if (s < 60)  return 'just now'
      if (s < 3600) return Math.floor(s/60)   + 'm ago'
      if (s < 86400) return Math.floor(s/3600) + 'h ago'
      return Math.floor(s/86400) + 'd ago'
    }

    function updateAdminBadge(unreadCount) {
      if (!adminNotifBadge) return
      if (unreadCount > 0) {
        adminNotifBadge.textContent = unreadCount > 99 ? '99+' : String(unreadCount)
        adminNotifBadge.classList.remove('hidden')
      } else {
        adminNotifBadge.classList.add('hidden')
        adminNotifBadge.textContent = ''
      }
    }

    async function loadAdminNotifs() {
      if (!adminNotifList || adminNotifLoading) return
      adminNotifLoading = true
      // Show loading spinner only if list is currently empty/stale
      const currentContent = adminNotifList.innerHTML
      if (!currentContent.includes('admin-notif-item')) {
        adminNotifList.innerHTML = '<div class="p-4 text-center text-gray-500 text-sm"><i class="fas fa-spinner fa-spin mr-2"></i>Loading…</div>'
      }
      try {
        const res  = await fetch('/api/admin/notifications?limit=20')
        if (!res.ok) {
          adminNotifList.innerHTML = '<div class="p-4 text-center text-gray-500 text-sm"><i class="fas fa-exclamation-circle mr-2 text-red-400"></i>Unable to load (' + res.status + ')</div>'
          adminNotifLoading = false
          return
        }
        const data = await res.json()

        // Always sync badge with server count
        updateAdminBadge(data.unread_count ?? 0)

        const items = data.notifications || []
        if (items.length === 0) {
          adminNotifList.innerHTML = '<div class="p-6 text-center text-gray-500 text-sm"><i class="fas fa-bell-slash mb-2 block text-xl"></i>No notifications yet</div>'
          adminNotifLoading = false
          return
        }

        adminNotifList.innerHTML = items.map(n => {
          const [icon, bg, color] = notifIconMap[n.type] || ['fas fa-bell','rgba(107,114,128,.15)','#9ca3af']
          const link    = adminNotifLink(n)
          const unread  = n.read_status === 0
          return \`<div class="admin-notif-item px-4 py-3 hover:bg-white/5 cursor-pointer border-b border-white/5 \${unread ? 'bg-indigo-500/5' : ''}" data-id="\${n.id}" data-link="\${link}" data-unread="\${unread ? '1' : '0'}">
            <div class="flex gap-3 items-start">
              <div class="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style="background:\${bg}">
                <i class="\${icon} text-xs" style="color:\${color}"></i>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-xs \${unread ? 'text-white font-semibold' : 'text-gray-300'} truncate">\${n.title}</p>
                <p class="text-xs text-gray-500 mt-0.5 line-clamp-2">\${n.message}</p>
                <span class="text-[10px] \${unread ? 'text-indigo-400' : 'text-gray-600'} mt-0.5 block">\${timeAgo(n.created_at)}</span>
              </div>
              \${unread ? '<div class="w-1.5 h-1.5 bg-indigo-500 rounded-full mt-1.5 flex-shrink-0 notif-dot"></div>' : ''}
            </div>
          </div>\`
        }).join('')

        adminNotifList.querySelectorAll('.admin-notif-item').forEach(el => {
          el.addEventListener('click', async () => {
            const id   = el.getAttribute('data-id')
            const link = el.getAttribute('data-link')
            // Mark as read visually immediately
            if (el.getAttribute('data-unread') === '1') {
              el.setAttribute('data-unread', '0')
              el.classList.remove('bg-indigo-500/5')
              const titleEl = el.querySelector('p.text-white')
              if (titleEl) { titleEl.classList.remove('text-white', 'font-semibold'); titleEl.classList.add('text-gray-300') }
              const dot = el.querySelector('.notif-dot')
              if (dot) dot.remove()
              // Decrement badge
              const cur = parseInt(adminNotifBadge?.textContent || '0', 10)
              updateAdminBadge(Math.max(0, cur - 1))
            }
            await fetch('/api/admin/notifications/read', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: Number(id) }),
            }).catch(() => {})
            if (link) window.location.href = link
          })
        })
      } catch (err) {
        if (adminNotifList) adminNotifList.innerHTML = '<div class="p-4 text-center text-gray-500 text-sm"><i class="fas fa-wifi mr-2 text-red-400"></i>Could not load notifications</div>'
      } finally {
        adminNotifLoading = false
      }
    }

    if (adminNotifBtn && adminNotifDropdown) {
      adminNotifBtn.addEventListener('click', e => {
        e.stopPropagation()
        adminDropdownOpen = !adminDropdownOpen
        if (adminDropdownOpen) {
          adminNotifDropdown.classList.remove('hidden')
          loadAdminNotifs()  // always refresh when opening
        } else {
          adminNotifDropdown.classList.add('hidden')
        }
      })
      document.addEventListener('click', e => {
        if (adminDropdownOpen && !adminNotifDropdown.contains(e.target) && e.target !== adminNotifBtn) {
          adminDropdownOpen = false
          adminNotifDropdown.classList.add('hidden')
        }
      })
    }

    if (adminMarkAllBtn) {
      adminMarkAllBtn.addEventListener('click', async e => {
        e.stopPropagation()
        await fetch('/api/admin/notifications/read', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:'{}' }).catch(()=>{})
        updateAdminBadge(0)
        // Refresh list to reflect read state
        await loadAdminNotifs()
      })
    }

    // Poll badge every 30s — keeps count in sync with server
    async function pollAdminBadge() {
      if (adminDropdownOpen) return  // skip poll while dropdown is open (loadAdminNotifs handles it)
      try {
        const res  = await fetch('/api/admin/notifications?limit=1')
        if (!res.ok) return
        const data = await res.json()
        updateAdminBadge(data.unread_count ?? 0)
      } catch {}
    }
    pollAdminBadge()
    setInterval(pollAdminBadge, 30000)
  </script>
</body>
</html>`
