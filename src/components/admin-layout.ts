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
  </script>
</body>
</html>`
