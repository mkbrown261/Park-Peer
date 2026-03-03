// Shared layout and component helpers

export const Layout = (title: string, content: string, extraHead = '') => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title} — ParkPeer</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet"/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet"/>
  ${extraHead}
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            indigo: { 
              DEFAULT: '#5B2EFF',
              50: '#f0ebff',
              100: '#e0d5ff',
              200: '#c2aaff',
              300: '#9e7aff',
              400: '#7a4fff',
              500: '#5B2EFF',
              600: '#4a20f0',
              700: '#3a12d4',
              800: '#2d0faa',
              900: '#1f0a7a'
            },
            lime: {
              DEFAULT: '#C6FF00',
              400: '#d4ff33',
              500: '#C6FF00',
              600: '#a8d900'
            },
            charcoal: {
              DEFAULT: '#121212',
              100: '#1E1E1E',
              200: '#2a2a2a',
              300: '#3a3a3a',
              400: '#4a4a4a'
            }
          },
          fontFamily: {
            sans: ['Inter', 'system-ui', 'sans-serif']
          }
        }
      }
    }
  </script>
  <style>
    * { font-family: 'Inter', sans-serif; }
    .gradient-text {
      background: linear-gradient(135deg, #5B2EFF 0%, #C6FF00 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .gradient-bg {
      background: linear-gradient(135deg, #5B2EFF 0%, #3a12d4 100%);
    }
    .glow-indigo {
      box-shadow: 0 0 30px rgba(91, 46, 255, 0.4);
    }
    .glow-lime {
      box-shadow: 0 0 20px rgba(198, 255, 0, 0.3);
    }
    .card-hover {
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .card-hover:hover {
      transform: translateY(-4px);
      box-shadow: 0 20px 40px rgba(91, 46, 255, 0.15);
    }
    .btn-primary {
      background: linear-gradient(135deg, #5B2EFF 0%, #4a20f0 100%);
      transition: all 0.2s ease;
    }
    .btn-primary:hover {
      transform: translateY(-1px);
      box-shadow: 0 8px 25px rgba(91, 46, 255, 0.5);
    }
    .btn-lime {
      background: #C6FF00;
      color: #121212;
      transition: all 0.2s ease;
    }
    .btn-lime:hover {
      background: #d4ff33;
      transform: translateY(-1px);
      box-shadow: 0 8px 25px rgba(198, 255, 0, 0.4);
    }
    .map-bg {
      background-image: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%235B2EFF' fill-opacity='0.08'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
    }
    .glass {
      background: rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .glass-light {
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }
    .pulse-dot {
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.7; transform: scale(1.1); }
    }
    .slide-up {
      animation: slideUp 0.6s ease forwards;
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .nav-link {
      position: relative;
    }
    .nav-link::after {
      content: '';
      position: absolute;
      bottom: -2px;
      left: 0;
      width: 0;
      height: 2px;
      background: #C6FF00;
      transition: width 0.3s ease;
    }
    .nav-link:hover::after { width: 100%; }
    .star-rating .star { color: #FFB300; }
    .parking-pin {
      background: #5B2EFF;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .stat-card {
      background: linear-gradient(135deg, #1E1E1E 0%, #2a2a2a 100%);
      border: 1px solid rgba(91, 46, 255, 0.2);
    }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: #121212; }
    ::-webkit-scrollbar-thumb { background: #5B2EFF; border-radius: 3px; }
    .shimmer {
      background: linear-gradient(90deg, #1E1E1E 25%, #2a2a2a 50%, #1E1E1E 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
    }
    @keyframes shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    .toggle-switch input:checked + label { background-color: #5B2EFF; }
    .toggle-switch input:checked + label::after { transform: translateX(100%); }
    @media (max-width: 768px) {
      .hide-mobile { display: none !important; }
      .mobile-full { width: 100% !important; }
    }
  </style>
</head>
<body class="bg-charcoal text-white min-h-screen">
  ${Navbar()}
  <main>
    ${content}
  </main>
  ${Footer()}
  <script>
    // Mobile menu toggle
    const menuBtn = document.getElementById('mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    if (menuBtn && mobileMenu) {
      menuBtn.addEventListener('click', () => {
        mobileMenu.classList.toggle('hidden');
      });
    }

    // Notification bell
    const notifBtn = document.getElementById('notif-btn');
    const notifDropdown = document.getElementById('notif-dropdown');
    if (notifBtn && notifDropdown) {
      notifBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        notifDropdown.classList.toggle('hidden');
      });
      document.addEventListener('click', () => notifDropdown.classList.add('hidden'));
    }

    // User menu
    const userBtn = document.getElementById('user-menu-btn');
    const userMenu = document.getElementById('user-menu-dropdown');
    if (userBtn && userMenu) {
      userBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        userMenu.classList.toggle('hidden');
      });
      document.addEventListener('click', () => userMenu.classList.add('hidden'));
    }
  </script>
</body>
</html>`

export const Navbar = () => `
<nav class="fixed top-0 left-0 right-0 z-50 glass border-b border-white/10">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="flex items-center justify-between h-16">
      <!-- Logo -->
      <a href="/" class="flex items-center gap-2 group">
        <div class="w-8 h-8 gradient-bg rounded-lg flex items-center justify-center glow-indigo group-hover:scale-110 transition-transform">
          <i class="fas fa-parking text-white text-sm"></i>
        </div>
        <span class="text-xl font-black tracking-tight">
          Park<span class="gradient-text">Peer</span>
        </span>
      </a>

      <!-- Search Bar (center) -->
      <div class="hidden md:flex flex-1 max-w-md mx-8">
        <div class="relative w-full">
          <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
          <input 
            type="text" 
            placeholder="Search by address, city, or landmark..." 
            class="w-full bg-charcoal-100 border border-white/10 rounded-full pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
            onclick="window.location.href='/search'"
          />
        </div>
      </div>

      <!-- Right Nav -->
      <div class="flex items-center gap-2">
        <a href="/host" class="hidden md:block text-sm font-medium text-gray-300 hover:text-white nav-link px-3 py-2 transition-colors">
          List Your Space
        </a>
        
        <!-- Notification Bell -->
        <div class="relative" id="notif-container">
          <button id="notif-btn" class="relative p-2 text-gray-400 hover:text-white transition-colors">
            <i class="fas fa-bell text-lg"></i>
            <span class="absolute top-1 right-1 w-2 h-2 bg-lime-500 rounded-full pulse-dot"></span>
          </button>
          <div id="notif-dropdown" class="hidden absolute right-0 top-12 w-80 glass rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
            <div class="p-4 border-b border-white/10">
              <h3 class="font-semibold text-white">Notifications</h3>
            </div>
            <div class="max-h-80 overflow-y-auto">
              <div class="p-4 hover:bg-white/5 cursor-pointer border-b border-white/5">
                <div class="flex gap-3">
                  <div class="w-10 h-10 gradient-bg rounded-full flex items-center justify-center flex-shrink-0">
                    <i class="fas fa-car text-white text-sm"></i>
                  </div>
                  <div>
                    <p class="text-sm text-white font-medium">New booking request!</p>
                    <p class="text-xs text-gray-400 mt-1">Marcus B. wants to book your driveway on Sat</p>
                    <span class="text-xs text-indigo-400 mt-1 block">2 min ago</span>
                  </div>
                </div>
              </div>
              <div class="p-4 hover:bg-white/5 cursor-pointer border-b border-white/5">
                <div class="flex gap-3">
                  <div class="w-10 h-10 bg-green-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                    <i class="fas fa-dollar-sign text-green-400 text-sm"></i>
                  </div>
                  <div>
                    <p class="text-sm text-white font-medium">Payout processed</p>
                    <p class="text-xs text-gray-400 mt-1">$45.50 has been sent to your account</p>
                    <span class="text-xs text-gray-500 mt-1 block">1 hour ago</span>
                  </div>
                </div>
              </div>
              <div class="p-4 hover:bg-white/5 cursor-pointer">
                <div class="flex gap-3">
                  <div class="w-10 h-10 bg-amber-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                    <i class="fas fa-star text-amber-400 text-sm"></i>
                  </div>
                  <div>
                    <p class="text-sm text-white font-medium">New 5-star review!</p>
                    <p class="text-xs text-gray-400 mt-1">"Perfect spot, easy access, will book again!"</p>
                    <span class="text-xs text-gray-500 mt-1 block">3 hours ago</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- User Menu -->
        <div class="relative">
          <button id="user-menu-btn" class="flex items-center gap-2 bg-charcoal-100 border border-white/10 rounded-full pl-3 pr-2 py-1.5 hover:border-indigo-500/50 transition-all group">
            <span class="text-sm font-medium text-gray-300 group-hover:text-white hide-mobile">Alex M.</span>
            <div class="w-7 h-7 gradient-bg rounded-full flex items-center justify-center">
              <span class="text-xs font-bold text-white">A</span>
            </div>
          </button>
          <div id="user-menu-dropdown" class="hidden absolute right-0 top-12 w-56 glass rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
            <div class="p-4 border-b border-white/10">
              <p class="font-semibold text-white text-sm">Alex Martinez</p>
              <p class="text-xs text-gray-400">alex@example.com</p>
            </div>
            <div class="p-2">
              <a href="/dashboard" class="flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded-xl text-sm text-gray-300 hover:text-white transition-colors">
                <i class="fas fa-gauge-high w-4 text-center text-indigo-400"></i> Driver Dashboard
              </a>
              <a href="/host" class="flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded-xl text-sm text-gray-300 hover:text-white transition-colors">
                <i class="fas fa-home w-4 text-center text-indigo-400"></i> Host Dashboard
              </a>
              <a href="/search" class="flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded-xl text-sm text-gray-300 hover:text-white transition-colors">
                <i class="fas fa-search w-4 text-center text-indigo-400"></i> Find Parking
              </a>
              <a href="/admin" class="flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded-xl text-sm text-gray-300 hover:text-white transition-colors">
                <i class="fas fa-shield-halved w-4 text-center text-indigo-400"></i> Admin Panel
              </a>
              <div class="border-t border-white/10 my-2"></div>
              <a href="/auth/login" class="flex items-center gap-3 px-3 py-2.5 hover:bg-red-500/10 rounded-xl text-sm text-red-400 hover:text-red-300 transition-colors">
                <i class="fas fa-right-from-bracket w-4 text-center"></i> Sign Out
              </a>
            </div>
          </div>
        </div>

        <!-- Mobile Menu Button -->
        <button id="mobile-menu-btn" class="md:hidden p-2 text-gray-400 hover:text-white transition-colors">
          <i class="fas fa-bars text-lg"></i>
        </button>
      </div>
    </div>

    <!-- Mobile Menu -->
    <div id="mobile-menu" class="hidden md:hidden pb-4 border-t border-white/10 mt-2 pt-4">
      <div class="flex flex-col gap-2">
        <input 
          type="text" 
          placeholder="Search parking spots..." 
          class="w-full bg-charcoal-100 border border-white/10 rounded-full px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          onclick="window.location.href='/search'"
        />
        <a href="/search" class="px-3 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 rounded-xl transition-colors">
          <i class="fas fa-search mr-2 text-indigo-400"></i> Find Parking
        </a>
        <a href="/host" class="px-3 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 rounded-xl transition-colors">
          <i class="fas fa-home mr-2 text-indigo-400"></i> List Your Space
        </a>
        <a href="/dashboard" class="px-3 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 rounded-xl transition-colors">
          <i class="fas fa-gauge-high mr-2 text-indigo-400"></i> Dashboard
        </a>
        <a href="/auth/login" class="px-3 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 rounded-xl transition-colors">
          <i class="fas fa-right-from-bracket mr-2 text-indigo-400"></i> Sign Out
        </a>
      </div>
    </div>
  </div>
</nav>
`

export const Footer = () => `
<footer class="bg-charcoal-100 border-t border-white/5 mt-20">
  <div class="max-w-7xl mx-auto px-4 py-16">
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10">
      <!-- Brand -->
      <div class="lg:col-span-2">
        <div class="flex items-center gap-2 mb-4">
          <div class="w-9 h-9 gradient-bg rounded-lg flex items-center justify-center">
            <i class="fas fa-parking text-white"></i>
          </div>
          <span class="text-2xl font-black">Park<span class="gradient-text">Peer</span></span>
        </div>
        <p class="text-gray-400 text-sm leading-relaxed max-w-xs">
          The peer-to-peer parking marketplace. Turn empty driveways into income and find affordable parking near you.
        </p>
        <div class="flex gap-3 mt-6">
          <a href="#" class="w-9 h-9 bg-charcoal-200 hover:bg-indigo-500 rounded-lg flex items-center justify-center transition-colors">
            <i class="fab fa-twitter text-sm"></i>
          </a>
          <a href="#" class="w-9 h-9 bg-charcoal-200 hover:bg-indigo-500 rounded-lg flex items-center justify-center transition-colors">
            <i class="fab fa-instagram text-sm"></i>
          </a>
          <a href="#" class="w-9 h-9 bg-charcoal-200 hover:bg-indigo-500 rounded-lg flex items-center justify-center transition-colors">
            <i class="fab fa-linkedin text-sm"></i>
          </a>
          <a href="#" class="w-9 h-9 bg-charcoal-200 hover:bg-indigo-500 rounded-lg flex items-center justify-center transition-colors">
            <i class="fab fa-tiktok text-sm"></i>
          </a>
        </div>
      </div>
      <!-- Drivers -->
      <div>
        <h4 class="font-semibold text-white mb-4 text-sm uppercase tracking-wider">For Drivers</h4>
        <ul class="space-y-2.5">
          ${['Find Parking','How It Works','Pricing','Mobile App','Safety'].map(l => `<li><a href="/search" class="text-gray-400 hover:text-white text-sm transition-colors">${l}</a></li>`).join('')}
        </ul>
      </div>
      <!-- Hosts -->
      <div>
        <h4 class="font-semibold text-white mb-4 text-sm uppercase tracking-wider">For Hosts</h4>
        <ul class="space-y-2.5">
          ${['List Your Space','Host Dashboard','Earnings Calculator','Host Protection','Community'].map(l => `<li><a href="/host" class="text-gray-400 hover:text-white text-sm transition-colors">${l}</a></li>`).join('')}
        </ul>
      </div>
      <!-- Company -->
      <div>
        <h4 class="font-semibold text-white mb-4 text-sm uppercase tracking-wider">Company</h4>
        <ul class="space-y-2.5">
          ${['About Us','Careers','Press','Blog','Contact','Terms','Privacy','Insurance'].map(l => `<li><a href="#" class="text-gray-400 hover:text-white text-sm transition-colors">${l}</a></li>`).join('')}
        </ul>
      </div>
    </div>

    <!-- App Store Badges -->
    <div class="border-t border-white/5 mt-12 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
      <div class="flex gap-3">
        <a href="#" class="flex items-center gap-2 bg-charcoal-200 border border-white/10 rounded-xl px-4 py-2.5 hover:border-indigo-500/50 transition-all">
          <i class="fab fa-apple text-2xl text-white"></i>
          <div>
            <p class="text-gray-400 text-xs">Download on the</p>
            <p class="font-semibold text-white text-sm">App Store</p>
          </div>
        </a>
        <a href="#" class="flex items-center gap-2 bg-charcoal-200 border border-white/10 rounded-xl px-4 py-2.5 hover:border-indigo-500/50 transition-all">
          <i class="fab fa-google-play text-2xl text-white"></i>
          <div>
            <p class="text-gray-400 text-xs">Get it on</p>
            <p class="font-semibold text-white text-sm">Google Play</p>
          </div>
        </a>
      </div>
      <div class="text-center text-sm text-gray-500">
        <p>© 2026 ParkPeer, Inc. All rights reserved.</p>
        <p class="mt-1">Made with <span class="text-red-400">♥</span> for urban commuters everywhere</p>
      </div>
    </div>
  </div>
</footer>
`
