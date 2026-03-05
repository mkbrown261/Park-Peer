// Shared layout and component helpers

export type NavSession = { name?: string; role?: string; isAdmin?: boolean } | null

export const Layout = (title: string, content: string, extraHead = '', session: NavSession = null) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title} — ParkPeer</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
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
  ${Navbar(session)}
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
    const notifBtn      = document.getElementById('notif-btn');
    const notifDropdown = document.getElementById('notif-dropdown');
    const notifBadge    = document.getElementById('notif-badge');
    const notifList     = document.getElementById('notif-list');
    const markAllBtn    = document.getElementById('notif-mark-all');

    let notifLoaded = false;

    function notifIcon(type) {
      const map = {
        booking_request:   ['fas fa-car',        'gradient-bg',         'text-white'],
        booking_confirmed: ['fas fa-check-circle','bg-green-500/20',     'text-green-400'],
        booking_cancelled: ['fas fa-times-circle','bg-red-500/20',       'text-red-400'],
        booking_reminder:  ['fas fa-clock',       'bg-blue-500/20',      'text-blue-400'],
        payout_processed:  ['fas fa-dollar-sign', 'bg-green-500/20',     'text-green-400'],
        review_received:   ['fas fa-star',        'bg-amber-500/20',     'text-amber-400'],
        new_registration:  ['fas fa-user-plus',   'bg-indigo-500/20',    'text-indigo-400'],
        new_listing:       ['fas fa-parking',     'bg-indigo-500/20',    'text-indigo-400'],
        dispute_opened:    ['fas fa-balance-scale','bg-red-500/20',      'text-red-400'],
        refund_processed:  ['fas fa-undo',        'bg-amber-500/20',     'text-amber-400'],
        security_alert:    ['fas fa-shield-alt',  'bg-red-500/20',       'text-red-400'],
        system:            ['fas fa-bell',         'bg-gray-500/20',     'text-gray-400'],
      };
      return map[type] || ['fas fa-bell', 'bg-gray-500/20', 'text-gray-400'];
    }

    function notifLink(n) {
      if (!n.related_entity) return null;
      const { type, id } = n.related_entity;
      if (type === 'booking') return '/dashboard';
      if (type === 'listing') return '/listing/' + id;
      if (type === 'user')    return '/dashboard';
      if (type === 'dispute') return '/dashboard';
      return '/dashboard';
    }

    function timeAgo(dateStr) {
      const diff = Date.now() - new Date(dateStr).getTime();
      const s = Math.floor(diff / 1000);
      if (s < 60) return 'just now';
      const m = Math.floor(s / 60);
      if (m < 60) return m + ' min ago';
      const h = Math.floor(m / 60);
      if (h < 24) return h + 'h ago';
      const d = Math.floor(h / 24);
      return d + 'd ago';
    }

    async function loadNotifications() {
      if (!notifList) return;
      try {
        const res = await fetch('/api/notifications?limit=10');
        if (!res.ok) { notifList.innerHTML = '<div class="p-4 text-center text-gray-500 text-sm">Sign in to see notifications</div>'; return; }
        const data = await res.json();
        const items = data.notifications || [];

        // Update badge
        if (notifBadge) {
          if (data.unread_count > 0) {
            notifBadge.textContent = data.unread_count > 99 ? '99+' : String(data.unread_count);
            notifBadge.classList.remove('hidden');
          } else {
            notifBadge.classList.add('hidden');
          }
        }

        if (items.length === 0) {
          notifList.innerHTML = '<div class="p-6 text-center text-gray-500 text-sm"><i class="fas fa-bell-slash mb-2 block text-2xl"></i>No notifications yet</div>';
          return;
        }

        notifList.innerHTML = items.map(n => {
          const [iconClass, bgClass, colorClass] = notifIcon(n.type);
          const link = notifLink(n);
          const unread = n.read_status === 0;
          return \`<div class="notif-item p-4 hover:bg-white/5 cursor-pointer border-b border-white/5 \${unread ? 'bg-white/3' : ''}" data-id="\${n.id}" data-link="\${link || ''}">
            <div class="flex gap-3">
              <div class="w-10 h-10 \${bgClass} rounded-full flex items-center justify-center flex-shrink-0">
                <i class="\${iconClass} \${colorClass} text-sm"></i>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm \${unread ? 'text-white font-semibold' : 'text-gray-300'} truncate">\${n.title}</p>
                <p class="text-xs text-gray-400 mt-0.5 line-clamp-2">\${n.message}</p>
                <span class="text-xs \${unread ? 'text-indigo-400' : 'text-gray-500'} mt-1 block">\${timeAgo(n.created_at)}</span>
              </div>
              \${unread ? '<div class="w-2 h-2 bg-indigo-500 rounded-full mt-2 flex-shrink-0"></div>' : ''}
            </div>
          </div>\`;
        }).join('');

        // Click handler: mark read + navigate
        notifList.querySelectorAll('.notif-item').forEach(el => {
          el.addEventListener('click', async () => {
            const id   = el.getAttribute('data-id');
            const link = el.getAttribute('data-link');
            await fetch('/api/notifications/read', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: Number(id) }),
            }).catch(() => {});
            if (link) window.location.href = link;
          });
        });

      } catch (err) {
        if (notifList) notifList.innerHTML = '<div class="p-4 text-center text-gray-500 text-sm">Could not load notifications</div>';
      }
    }

    if (notifBtn && notifDropdown) {
      notifBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        notifDropdown.classList.toggle('hidden');
        if (!notifLoaded) { notifLoaded = true; loadNotifications(); }
      });
      document.addEventListener('click', () => notifDropdown.classList.add('hidden'));
    }

    if (markAllBtn) {
      markAllBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await fetch('/api/notifications/read', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
        if (notifBadge) { notifBadge.classList.add('hidden'); notifBadge.textContent = ''; }
        notifList && notifList.querySelectorAll('.notif-item').forEach(el => {
          el.classList.remove('bg-white/3');
          const dot = el.querySelector('.bg-indigo-500.rounded-full');
          if (dot) dot.remove();
          const title = el.querySelector('p.text-white');
          if (title) { title.classList.remove('text-white', 'font-semibold'); title.classList.add('text-gray-300'); }
          const ts = el.querySelector('span.text-indigo-400');
          if (ts) { ts.classList.remove('text-indigo-400'); ts.classList.add('text-gray-500'); }
        });
      });
    }

    // Poll badge count every 60s (only when user is on page)
    async function pollBadge() {
      try {
        const res = await fetch('/api/notifications?limit=1');
        if (!res.ok) return;
        const data = await res.json();
        if (notifBadge) {
          if (data.unread_count > 0) {
            notifBadge.textContent = data.unread_count > 99 ? '99+' : String(data.unread_count);
            notifBadge.classList.remove('hidden');
          } else {
            notifBadge.classList.add('hidden');
          }
        }
      } catch {}
    }
    pollBadge(); // initial count on page load
    setInterval(pollBadge, 60000);

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

    // Sign Out — POST to /api/auth/logout (clears HttpOnly cookie), then redirect
    // This is the ONLY correct way to log out: a simple href to /auth/login does
    // NOT clear the HttpOnly __pp_user cookie, leaving the session alive.
    window.signOut = async function(e) {
      if (e) e.preventDefault();
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'same-origin',
        });
      } catch (_) {}
      // Hard navigate away — clears all in-memory state
      window.location.href = '/auth/login';
    };
  </script>

  <!-- ═══════════════════════════════════════════════════════════════════
       PARKPEER AI CHAT WIDGET
       Floating circular button (bottom-right) → slide-up chat panel
       All API calls go to /api/chat — key is never in frontend code
  ═══════════════════════════════════════════════════════════════════ -->

  <!-- Chat Styles -->
  <style>
    /* ── Chat button ── */
    #pp-chat-btn {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9998;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: linear-gradient(135deg, #5B2EFF 0%, #4a20f0 100%);
      box-shadow: 0 4px 24px rgba(91,46,255,0.55);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      border: none;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      outline: none;
    }
    #pp-chat-btn:hover {
      transform: scale(1.08) translateY(-2px);
      box-shadow: 0 8px 32px rgba(91,46,255,0.65);
    }
    #pp-chat-btn:active { transform: scale(0.96); }

    /* Unread badge */
    #pp-chat-badge {
      position: absolute;
      top: -2px;
      right: -2px;
      width: 14px;
      height: 14px;
      background: #C6FF00;
      border-radius: 50%;
      border: 2px solid #121212;
      display: none;
    }
    #pp-chat-badge.visible { display: block; }

    /* ── Chat panel ── */
    #pp-chat-panel {
      position: fixed;
      bottom: 92px;
      right: 24px;
      z-index: 9999;
      width: 360px;
      max-width: calc(100vw - 32px);
      height: 520px;
      max-height: calc(100vh - 120px);
      background: #1a1a2e;
      border: 1px solid rgba(91,46,255,0.35);
      border-radius: 20px;
      box-shadow: 0 24px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(91,46,255,0.15);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      /* Closed state */
      opacity: 0;
      transform: translateY(20px) scale(0.97);
      pointer-events: none;
      transition: opacity 0.25s ease, transform 0.25s cubic-bezier(0.34,1.56,0.64,1);
    }
    #pp-chat-panel.open {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: all;
    }

    /* Header */
    #pp-chat-header {
      background: linear-gradient(135deg, #5B2EFF 0%, #3a12d4 100%);
      padding: 14px 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }
    .pp-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: rgba(255,255,255,0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    #pp-chat-close {
      margin-left: auto;
      background: rgba(255,255,255,0.15);
      border: none;
      color: white;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
    }
    #pp-chat-close:hover { background: rgba(255,255,255,0.25); }

    /* Messages area */
    #pp-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 14px 14px 8px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      scrollbar-width: thin;
      scrollbar-color: #5B2EFF #1a1a2e;
    }
    #pp-chat-messages::-webkit-scrollbar { width: 4px; }
    #pp-chat-messages::-webkit-scrollbar-track { background: #1a1a2e; }
    #pp-chat-messages::-webkit-scrollbar-thumb { background: #5B2EFF; border-radius: 2px; }

    /* Bubbles */
    .pp-bubble {
      max-width: 82%;
      padding: 9px 13px;
      border-radius: 14px;
      font-size: 13.5px;
      line-height: 1.5;
      word-break: break-word;
      animation: pp-pop-in 0.2s ease forwards;
    }
    @keyframes pp-pop-in {
      from { opacity: 0; transform: scale(0.92) translateY(4px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }
    .pp-bubble-bot {
      background: rgba(91,46,255,0.18);
      border: 1px solid rgba(91,46,255,0.25);
      color: #e0d5ff;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }
    .pp-bubble-user {
      background: linear-gradient(135deg, #5B2EFF, #4a20f0);
      color: #fff;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
    }
    .pp-bubble-error {
      background: rgba(239,68,68,0.15);
      border: 1px solid rgba(239,68,68,0.3);
      color: #fca5a5;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }

    /* Typing indicator */
    .pp-typing {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 9px 13px;
      background: rgba(91,46,255,0.12);
      border: 1px solid rgba(91,46,255,0.2);
      border-radius: 14px;
      border-bottom-left-radius: 4px;
      align-self: flex-start;
    }
    .pp-typing span {
      width: 6px;
      height: 6px;
      background: #9e7aff;
      border-radius: 50%;
      animation: pp-bounce 1.2s infinite;
    }
    .pp-typing span:nth-child(2) { animation-delay: 0.2s; }
    .pp-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes pp-bounce {
      0%, 80%, 100% { transform: translateY(0); opacity: 0.5; }
      40% { transform: translateY(-6px); opacity: 1; }
    }

    /* Quick-reply chips */
    #pp-chat-chips {
      padding: 4px 14px 8px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      flex-shrink: 0;
    }
    .pp-chip {
      background: rgba(91,46,255,0.15);
      border: 1px solid rgba(91,46,255,0.35);
      color: #c2aaff;
      font-size: 11.5px;
      padding: 4px 10px;
      border-radius: 20px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      white-space: nowrap;
    }
    .pp-chip:hover { background: rgba(91,46,255,0.32); color: #fff; }

    /* Input row */
    #pp-chat-input-row {
      padding: 10px 12px 12px;
      display: flex;
      gap: 8px;
      border-top: 1px solid rgba(255,255,255,0.07);
      flex-shrink: 0;
      background: #16162a;
    }
    #pp-chat-input {
      flex: 1;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      color: #fff;
      font-size: 13px;
      padding: 8px 12px;
      outline: none;
      resize: none;
      min-height: 38px;
      max-height: 90px;
      font-family: inherit;
      transition: border-color 0.2s;
    }
    #pp-chat-input:focus { border-color: rgba(91,46,255,0.6); }
    #pp-chat-input::placeholder { color: #666; }
    #pp-chat-send {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      background: linear-gradient(135deg, #5B2EFF, #4a20f0);
      border: none;
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: opacity 0.2s, transform 0.15s;
      align-self: flex-end;
    }
    #pp-chat-send:hover { opacity: 0.88; transform: translateY(-1px); }
    #pp-chat-send:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

    /* Powered-by footer */
    #pp-chat-footer {
      padding: 5px 0 7px;
      text-align: center;
      font-size: 10px;
      color: #444;
      flex-shrink: 0;
      background: #16162a;
    }

    /* ── Mobile tweaks ── */
    @media (max-width: 480px) {
      #pp-chat-btn  { bottom: 16px; right: 16px; }
      #pp-chat-panel {
        bottom: 80px;
        right: 8px;
        left: 8px;
        width: auto;
        max-width: none;
      }
    }
  </style>

  <!-- Chat Button -->
  <button id="pp-chat-btn" aria-label="Open ParkPeer support chat" title="Chat with ParkPeer Assistant">
    <i class="fas fa-comment-dots text-white text-xl" id="pp-chat-icon-open"></i>
    <i class="fas fa-times text-white text-xl hidden" id="pp-chat-icon-close"></i>
    <span id="pp-chat-badge" class="visible"></span>
  </button>

  <!-- Chat Panel -->
  <div id="pp-chat-panel" role="dialog" aria-label="ParkPeer Support Chat" aria-modal="true">

    <!-- Header -->
    <div id="pp-chat-header">
      <div class="pp-avatar">
        <i class="fas fa-parking text-white text-sm"></i>
      </div>
      <div>
        <p class="text-white font-semibold text-sm leading-tight">ParkPeer Assistant</p>
        <p class="text-indigo-200 text-xs mt-0.5 flex items-center gap-1">
          <span class="w-1.5 h-1.5 bg-lime-400 rounded-full inline-block"></span>
          Online · AI-powered support
        </p>
      </div>
      <button id="pp-chat-close" aria-label="Close chat">
        <i class="fas fa-times text-xs"></i>
      </button>
    </div>

    <!-- Messages -->
    <div id="pp-chat-messages" aria-live="polite" aria-relevant="additions">
      <!-- Greeting injected by JS -->
    </div>

    <!-- Quick-reply chips -->
    <div id="pp-chat-chips">
      <button class="pp-chip" data-msg="How do I find parking?">Find parking</button>
      <button class="pp-chip" data-msg="How do I list my parking space?">List my space</button>
      <button class="pp-chip" data-msg="How do host earnings work?">Host earnings</button>
      <button class="pp-chip" data-msg="What is the cancellation policy?">Cancellations</button>
      <button class="pp-chip" data-msg="How does payment work?">Payments</button>
    </div>

    <!-- Input -->
    <div id="pp-chat-input-row">
      <textarea
        id="pp-chat-input"
        placeholder="Ask me anything about ParkPeer…"
        rows="1"
        maxlength="800"
        aria-label="Chat message"
      ></textarea>
      <button id="pp-chat-send" aria-label="Send message" disabled>
        <i class="fas fa-paper-plane text-sm"></i>
      </button>
    </div>

    <div id="pp-chat-footer">Powered by ParkPeer AI</div>
  </div>

  <!-- Chat Script -->
  <script>
  (function() {
    // ── DOM refs ─────────────────────────────────────────────────────────────
    const btn        = document.getElementById('pp-chat-btn');
    const panel      = document.getElementById('pp-chat-panel');
    const closeBtn   = document.getElementById('pp-chat-close');
    const messages   = document.getElementById('pp-chat-messages');
    const input      = document.getElementById('pp-chat-input');
    const sendBtn    = document.getElementById('pp-chat-send');
    const badge      = document.getElementById('pp-chat-badge');
    const iconOpen   = document.getElementById('pp-chat-icon-open');
    const iconClose  = document.getElementById('pp-chat-icon-close');
    const chips      = document.querySelectorAll('.pp-chip');

    // ── State ─────────────────────────────────────────────────────────────────
    let isOpen     = false;
    let isWaiting  = false;
    let history    = []; // {role, content}
    let sessionId  = 'sess_' + Math.random().toString(36).slice(2, 10);
    let greeted    = false;

    // ── Open / close ─────────────────────────────────────────────────────────
    function openPanel() {
      isOpen = true;
      panel.classList.add('open');
      iconOpen.classList.add('hidden');
      iconClose.classList.remove('hidden');
      badge.classList.remove('visible');
      if (!greeted) { showGreeting(); greeted = true; }
      setTimeout(() => input.focus(), 260);
    }

    function closePanel() {
      isOpen = false;
      panel.classList.remove('open');
      iconOpen.classList.remove('hidden');
      iconClose.classList.add('hidden');
    }

    btn.addEventListener('click', () => isOpen ? closePanel() : openPanel());
    closeBtn.addEventListener('click', closePanel);

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) closePanel();
    });

    // ── Greeting ─────────────────────────────────────────────────────────────
    function showGreeting() {
      appendBubble('bot',
        "Hi! I'm the ParkPeer Assistant. How can I help you today? " +
        "I can help you find parking, list your space, or answer questions about bookings and payments."
      );
    }

    // ── Append bubble ─────────────────────────────────────────────────────────
    function appendBubble(type, text) {
      const div = document.createElement('div');
      div.className = 'pp-bubble ' +
        (type === 'user' ? 'pp-bubble-user' : type === 'error' ? 'pp-bubble-error' : 'pp-bubble-bot');
      // Render newlines as <br>
      div.innerHTML = text.replace(/\\n/g, '<br>').replace(/\\r\\n/g, '<br>');
      messages.appendChild(div);
      scrollBottom();
      return div;
    }

    // ── Typing indicator ──────────────────────────────────────────────────────
    function showTyping() {
      const d = document.createElement('div');
      d.className = 'pp-typing';
      d.id = 'pp-typing-indicator';
      d.innerHTML = '<span></span><span></span><span></span>';
      messages.appendChild(d);
      scrollBottom();
    }

    function hideTyping() {
      const d = document.getElementById('pp-typing-indicator');
      if (d) d.remove();
    }

    // ── Scroll to bottom ──────────────────────────────────────────────────────
    function scrollBottom() {
      requestAnimationFrame(() => {
        messages.scrollTop = messages.scrollHeight;
      });
    }

    // ── Input helpers ─────────────────────────────────────────────────────────
    input.addEventListener('input', function() {
      sendBtn.disabled = !this.value.trim() || isWaiting;
      // Auto-grow textarea
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 90) + 'px';
    });

    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled) handleSend();
      }
    });

    sendBtn.addEventListener('click', handleSend);

    // ── Quick-reply chips ─────────────────────────────────────────────────────
    chips.forEach(chip => {
      chip.addEventListener('click', function() {
        const msg = this.getAttribute('data-msg');
        if (msg && !isWaiting) sendMessage(msg);
      });
    });

    // ── Send flow ─────────────────────────────────────────────────────────────
    function handleSend() {
      const text = input.value.trim();
      if (!text || isWaiting) return;
      input.value = '';
      input.style.height = 'auto';
      sendBtn.disabled = true;
      sendMessage(text);
    }

    async function sendMessage(text) {
      if (isWaiting) return;

      // Optimistic UI: show user bubble
      appendBubble('user', text);
      history.push({ role: 'user', content: text });

      isWaiting = true;
      sendBtn.disabled = true;
      showTyping();

      try {
        const res = await fetch('/api/chat', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history, sessionId }),
        });

        hideTyping();

        if (res.status === 429) {
          appendBubble('error',
            'You\\'re sending messages too quickly. Please wait a moment and try again.'
          );
          history.pop(); // remove the failed user message
        } else if (!res.ok) {
          appendBubble('error',
            'Something went wrong on our end. Please try again or email support@parkpeer.com.'
          );
          history.pop();
        } else {
          const data = await res.json();
          const reply = data.reply || data.error || 'I couldn\\'t generate a response. Please try again.';
          appendBubble('bot', reply);
          history.push({ role: 'assistant', content: reply });

          // Keep history manageable (last 20 turns)
          if (history.length > 20) history = history.slice(-20);
        }
      } catch (err) {
        hideTyping();
        appendBubble('error',
          'Network error. Please check your connection and try again.'
        );
        history.pop();
      }

      isWaiting = false;
      sendBtn.disabled = !input.value.trim();
    }

    // ── Show badge after 3 s if panel has not been opened ────────────────────
    setTimeout(() => {
      if (!greeted) badge.classList.add('visible');
    }, 3000);

  })();
  </script>
</body>
</html>`

export const Navbar = (session: NavSession = null) => {
const isAdmin = session?.isAdmin || (session?.role || '').toUpperCase() === 'ADMIN'
const isHost  = ['HOST','BOTH','ADMIN'].includes((session?.role || '').toUpperCase())
const isDriver = ['DRIVER','BOTH','ADMIN'].includes((session?.role || '').toUpperCase())
const userName = session?.name ? session.name.split(' ')[0] : 'My Account'
return `
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
          <button id="notif-btn" class="relative p-2 text-gray-400 hover:text-white transition-colors" aria-label="Notifications">
            <i class="fas fa-bell text-lg"></i>
            <span id="notif-badge" class="hidden absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none"></span>
          </button>
          <div id="notif-dropdown" class="hidden absolute right-0 top-12 w-80 glass rounded-2xl border border-white/10 shadow-2xl overflow-hidden z-50">
            <div class="p-4 border-b border-white/10 flex items-center justify-between">
              <h3 class="font-semibold text-white">Notifications</h3>
              <button id="notif-mark-all" class="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">Mark all read</button>
            </div>
            <div id="notif-list" class="max-h-80 overflow-y-auto">
              <div class="p-4 text-center text-gray-500 text-sm">
                <i class="fas fa-spinner fa-spin mr-2"></i>Loading…
              </div>
            </div>
            <div class="p-3 border-t border-white/10 text-center">
              <a href="/dashboard" class="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">View all notifications</a>
            </div>
          </div>
        </div>

        <!-- User Menu -->
        <div class="relative">
          <button id="user-menu-btn" class="flex items-center gap-2 bg-charcoal-100 border border-white/10 rounded-full pl-3 pr-2 py-1.5 hover:border-indigo-500/50 transition-all group">
            <span class="text-sm font-medium text-gray-300 group-hover:text-white hide-mobile">${session ? userName : 'Sign In'}</span>
            <div class="w-7 h-7 gradient-bg rounded-full flex items-center justify-center">
              <i class="fas fa-user text-xs text-white"></i>
            </div>
          </button>
          <div id="user-menu-dropdown" class="hidden absolute right-0 top-12 w-56 glass rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
            <div class="p-4 border-b border-white/10">
              <p class="font-semibold text-white text-sm">${session ? (session.name || 'ParkPeer Account') : 'ParkPeer'}</p>
              <p class="text-xs text-gray-400">${session ? ('Role: ' + (session.role || 'Member')) : 'Sign in to continue'}</p>
            </div>
            <div class="p-2">
              ${(isDriver || !session) ? `<a href="/dashboard" class="flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded-xl text-sm text-gray-300 hover:text-white transition-colors">
                <i class="fas fa-gauge-high w-4 text-center text-indigo-400"></i> Driver Dashboard
              </a>` : ''}
              ${(isHost || !session) ? `<a href="/host" class="flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded-xl text-sm text-gray-300 hover:text-white transition-colors">
                <i class="fas fa-home w-4 text-center text-indigo-400"></i> Host Dashboard
              </a>` : ''}
              <a href="/search" class="flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded-xl text-sm text-gray-300 hover:text-white transition-colors">
                <i class="fas fa-search w-4 text-center text-indigo-400"></i> Find Parking
              </a>
              ${isAdmin ? `<a href="/admin" class="flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded-xl text-sm text-gray-300 hover:text-white transition-colors">
                <i class="fas fa-shield-halved w-4 text-center text-indigo-400"></i> Admin Panel
              </a>` : ''}
              <div class="border-t border-white/10 my-2"></div>
              ${session ? `<button onclick="signOut(event)" class="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-red-500/10 rounded-xl text-sm text-red-400 hover:text-red-300 transition-colors text-left">
                <i class="fas fa-right-from-bracket w-4 text-center"></i> Sign Out
              </button>` : `<a href="/auth/login" class="flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded-xl text-sm text-gray-300 hover:text-white transition-colors">
                <i class="fas fa-right-to-bracket w-4 text-center text-indigo-400"></i> Sign In
              </a>`}
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
        ${(isHost || !session) ? `<a href="/host" class="px-3 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 rounded-xl transition-colors">
          <i class="fas fa-home mr-2 text-indigo-400"></i> ${session ? 'Host Dashboard' : 'List Your Space'}
        </a>` : ''}
        ${(isDriver || !session) ? `<a href="/dashboard" class="px-3 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 rounded-xl transition-colors">
          <i class="fas fa-gauge-high mr-2 text-indigo-400"></i> Driver Dashboard
        </a>` : ''}
        ${isAdmin ? `<a href="/admin" class="px-3 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 rounded-xl transition-colors">
          <i class="fas fa-shield-halved mr-2 text-indigo-400"></i> Admin Panel
        </a>` : ''}
        ${session ? `<button onclick="signOut(event)" class="w-full text-left px-3 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl transition-colors">
          <i class="fas fa-right-from-bracket mr-2"></i> Sign Out
        </button>` : `<a href="/auth/login" class="px-3 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 rounded-xl transition-colors">
          <i class="fas fa-right-to-bracket mr-2 text-indigo-400"></i> Sign In
        </a>`}
      </div>
    </div>
  </div>
</nav>
`}

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
          <li><a href="/host" class="text-gray-400 hover:text-white text-sm transition-colors">List Your Space</a></li>
          <li><a href="/host" class="text-gray-400 hover:text-white text-sm transition-colors">Host Dashboard</a></li>
          <li><a href="/legal/host-agreement" class="text-gray-400 hover:text-white text-sm transition-colors">Host Agreement</a></li>
          <li><a href="/legal/cancellation-policy" class="text-gray-400 hover:text-white text-sm transition-colors">Cancellation Policy</a></li>
          <li><a href="/host" class="text-gray-400 hover:text-white text-sm transition-colors">Host Protection</a></li>
        </ul>
      </div>
      <!-- Company -->
      <div>
        <h4 class="font-semibold text-white mb-4 text-sm uppercase tracking-wider">Company</h4>
        <ul class="space-y-2.5">
          <li><a href="#" class="text-gray-400 hover:text-white text-sm transition-colors">About Us</a></li>
          <li><a href="#" class="text-gray-400 hover:text-white text-sm transition-colors">Careers</a></li>
          <li><a href="/legal/tos" class="text-gray-400 hover:text-white text-sm transition-colors">Terms of Service</a></li>
          <li><a href="/legal/privacy" class="text-gray-400 hover:text-white text-sm transition-colors">Privacy Policy</a></li>
          <li><a href="/legal/cancellation-policy" class="text-gray-400 hover:text-white text-sm transition-colors">Cancellation Policy</a></li>
          <li><a href="mailto:legal@parkpeer.com" class="text-gray-400 hover:text-white text-sm transition-colors">Legal</a></li>
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
