import { Hono } from 'hono'
import { verifyUserToken } from '../middleware/security'

type Bindings = {
  DB: D1Database
  USER_TOKEN_SECRET: string
}

export const confirmationPage = new Hono<{ Bindings: Bindings }>()

// ════════════════════════════════════════════════════════════════════════════
// GET /booking/confirmation/:booking_id
// Premium confirmation screen shown after a successful booking payment.
// Requires auth; verifies caller is the booking's driver (IDOR protection).
// ════════════════════════════════════════════════════════════════════════════
confirmationPage.get('/:booking_id', async (c) => {
  const bookingId = c.req.param('booking_id')
  const db = c.env?.DB

  // ── Auth guard ────────────────────────────────────────────────────────────
  const session = await verifyUserToken(
    c,
    c.env?.USER_TOKEN_SECRET || 'pp-user-secret-change-in-prod'
  ).catch(() => null)

  if (!session) {
    return c.redirect(`/auth/login?reason=auth&next=${encodeURIComponent('/booking/confirmation/' + bookingId)}`)
  }

  if (!db) return c.text('Service unavailable', 503)

  try {
    // ── Fetch booking + listing + host data ───────────────────────────────
    const row = await db.prepare(`
      SELECT
        b.id, b.listing_id, b.driver_id, b.host_id,
        b.start_time, b.end_time, b.total_charged, b.host_payout,
        b.status, b.notes, b.vehicle_plate, b.vehicle_description,
        l.title       AS listing_title,
        l.address     AS listing_address,
        l.city        AS listing_city,
        l.state       AS listing_state,
        l.lat, l.lng,
        l.instructions AS parking_instructions,
        l.photos,
        u.full_name   AS host_name,
        u.avatar_url  AS host_avatar,
        u.host_verified,
        u.host_trust_score
      FROM bookings b
      LEFT JOIN listings l ON b.listing_id = l.id
      LEFT JOIN users    u ON b.host_id    = u.id
      WHERE b.id = ?
    `).bind(bookingId).first<any>()

    if (!row) return c.redirect('/dashboard?tab=upcoming')

    // ── IDOR: only the driver may view their own confirmation ────────────
    if (String(row.driver_id) !== String(session.id)) {
      return c.redirect('/dashboard')
    }

    // ── Format data ────────────────────────────────────────────────────────
    const startDate = new Date(row.start_time)
    const endDate   = new Date(row.end_time)
    const durationMs = endDate.getTime() - startDate.getTime()
    const durationH  = Math.round(durationMs / 36e5 * 10) / 10
    const fmtOpts: Intl.DateTimeFormatOptions = {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true
    }
    const startFmt = startDate.toLocaleString('en-US', fmtOpts)
    const endFmt   = endDate.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    const totalFmt = '$' + (Number(row.total_charged) / 100).toFixed(2)
    const totalCents = Number(row.total_charged) || 0
    // total_charged in payments is dollars not cents for bookings created without cents conversion
    const totalDisplay = totalCents < 500 ? '$' + Number(row.total_charged).toFixed(2) : '$' + (totalCents / 100).toFixed(2)

    const photos: string[] = (() => { try { return JSON.parse(row.photos || '[]') } catch { return [] } })()
    const coverPhoto = photos[0] || ''
    const bookingRef = 'PP-' + startDate.getFullYear() + '-' + String(row.id).padStart(4, '0')
    const fullAddress = [row.listing_address, row.listing_city, row.listing_state].filter(Boolean).join(', ')
    const endTimeMs = endDate.getTime()
    const hostVerified = row.host_verified ? 1 : 0

    return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Booking Confirmed · ParkPeer</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css">
  <style>
    body { background: #0a0a0f; color: #e2e8f0; font-family: 'Inter', system-ui, sans-serif; }
    @keyframes confetti-fall {
      0%   { transform: translateY(-20px) rotate(0deg); opacity: 1; }
      100% { transform: translateY(120vh) rotate(720deg); opacity: 0; }
    }
    @keyframes pop-in {
      0%   { transform: scale(0.6); opacity: 0; }
      60%  { transform: scale(1.08); }
      100% { transform: scale(1); opacity: 1; }
    }
    @keyframes fade-up {
      from { transform: translateY(20px); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
    @keyframes pulse-ring {
      0%   { box-shadow: 0 0 0 0 rgba(91,46,255,0.4); }
      70%  { box-shadow: 0 0 0 20px rgba(91,46,255,0); }
      100% { box-shadow: 0 0 0 0 rgba(91,46,255,0); }
    }
    .pop-in     { animation: pop-in 0.5s cubic-bezier(.175,.885,.32,1.275) both; }
    .fade-up    { animation: fade-up 0.5s ease both; }
    .fade-up-1  { animation-delay: 0.1s; }
    .fade-up-2  { animation-delay: 0.2s; }
    .fade-up-3  { animation-delay: 0.3s; }
    .fade-up-4  { animation-delay: 0.4s; }
    .fade-up-5  { animation-delay: 0.5s; }
    .pulse-ring { animation: pulse-ring 2s ease infinite; }
    .confetti-piece {
      position: fixed; width: 8px; height: 8px; top: -20px;
      border-radius: 2px; animation: confetti-fall linear forwards;
      pointer-events: none; z-index: 9999;
    }
    .countdown-bar { transition: width 0.5s linear; }
    .glass {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      backdrop-filter: blur(12px);
    }
    .action-btn {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      padding: 14px 20px; border-radius: 14px; font-weight: 700; font-size: 15px;
      cursor: pointer; transition: all 0.2s; text-decoration: none;
      border: none; width: 100%;
    }
    .action-btn:active { transform: scale(0.97); }
    .btn-primary   { background: #5B2EFF; color: #fff; }
    .btn-primary:hover { background: #4a24d4; }
    .btn-secondary { background: rgba(255,255,255,0.06); color: #e2e8f0; border: 1px solid rgba(255,255,255,0.1); }
    .btn-secondary:hover { background: rgba(255,255,255,0.1); }
    .btn-ghost     { background: transparent; color: #94a3b8; border: 1px solid rgba(255,255,255,0.08); }
    .btn-ghost:hover { background: rgba(255,255,255,0.04); }
    .map-modal { display: none; position: fixed; inset: 0; z-index: 1000;
      background: rgba(0,0,0,0.85); align-items: flex-end; padding: 0; }
    .map-modal.open { display: flex; }
    .info-row { display: flex; align-items: flex-start; gap: 12px; padding: 14px 0;
      border-bottom: 1px solid rgba(255,255,255,0.06); }
    .info-row:last-child { border-bottom: none; }
    .info-icon { width: 36px; height: 36px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      background: rgba(91,46,255,0.12); color: #5B2EFF; font-size: 14px; }
  </style>
</head>
<body>

<!-- Confetti container -->
<div id="confetti-container" style="pointer-events:none;position:fixed;inset:0;overflow:hidden;z-index:9999"></div>

<!-- ═══════════════════════════════════════════════════════════════ -->
<!-- MAIN PAGE                                                        -->
<!-- ═══════════════════════════════════════════════════════════════ -->
<div class="min-h-screen" style="max-width:520px;margin:0 auto;padding:0 0 120px;">

  <!-- Header nav -->
  <div class="flex items-center justify-between px-4 pt-5 pb-2">
    <a href="/dashboard?tab=upcoming" class="flex items-center gap-2 text-sm" style="color:#94a3b8;">
      <i class="fas fa-arrow-left"></i> My Bookings
    </a>
    <span class="text-xs font-mono px-3 py-1 rounded-full" style="background:rgba(91,46,255,0.12);color:#a78bfa;">${bookingRef}</span>
  </div>

  <!-- ── SUCCESS HERO ────────────────────────────────────────────────── -->
  <div class="text-center px-4 pt-6 pb-2">
    <div class="pop-in inline-flex items-center justify-center w-20 h-20 rounded-full pulse-ring mb-4"
         style="background:rgba(91,46,255,0.15);border:2px solid #5B2EFF;">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <circle cx="20" cy="20" r="20" fill="#5B2EFF"/>
        <path d="M12 20.5L17.5 26L28 14" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <h1 class="fade-up text-2xl font-black mb-1" style="color:#fff;">Booking Confirmed!</h1>
    <p class="fade-up fade-up-1 text-sm" style="color:#94a3b8;">You're all set. Have a great park!</p>
  </div>

  <!-- ── LISTING COVER ─────────────────────────────────────────────── -->
  ${coverPhoto ? `
  <div class="px-4 mt-4 fade-up fade-up-1">
    <div class="rounded-2xl overflow-hidden" style="height:160px;">
      <img src="${coverPhoto}" alt="${row.listing_title}" style="width:100%;height:100%;object-fit:cover;">
    </div>
  </div>` : ''}

  <!-- ── BOOKING INFO CARD ──────────────────────────────────────────── -->
  <div class="mx-4 mt-4 rounded-2xl p-5 glass fade-up fade-up-2">
    <!-- Listing title + host -->
    <div class="flex items-start justify-between mb-4">
      <div>
        <h2 class="font-bold text-lg leading-tight" style="color:#fff;">${row.listing_title || fullAddress}</h2>
        <p class="text-sm mt-0.5" style="color:#94a3b8;">${fullAddress}</p>
      </div>
      ${hostVerified ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:#5B2EFF;background:rgba(91,46,255,0.1);border:1px solid rgba(91,46,255,0.3);border-radius:20px;padding:3px 8px;white-space:nowrap;flex-shrink:0;margin-left:8px;">
        <i class="fas fa-shield-check" style="font-size:10px"></i>Verified
      </span>` : ''}
    </div>

    <!-- Info rows -->
    <div>
      <div class="info-row">
        <div class="info-icon"><i class="fas fa-calendar-check"></i></div>
        <div>
          <div class="text-xs mb-0.5" style="color:#64748b;">Check-in</div>
          <div class="font-semibold text-sm" style="color:#e2e8f0;">${startFmt}</div>
        </div>
      </div>
      <div class="info-row">
        <div class="info-icon"><i class="fas fa-flag-checkered"></i></div>
        <div>
          <div class="text-xs mb-0.5" style="color:#64748b;">Check-out</div>
          <div class="font-semibold text-sm" style="color:#e2e8f0;">${endFmt}</div>
        </div>
      </div>
      <div class="info-row">
        <div class="info-icon" style="background:rgba(34,197,94,0.12);color:#22c55e;"><i class="fas fa-user-tie"></i></div>
        <div>
          <div class="text-xs mb-0.5" style="color:#64748b;">Host</div>
          <div class="font-semibold text-sm" style="color:#e2e8f0;">${row.host_name || 'Your Host'}</div>
        </div>
      </div>
      <div class="info-row">
        <div class="info-icon" style="background:rgba(234,179,8,0.12);color:#eab308;"><i class="fas fa-dollar-sign"></i></div>
        <div>
          <div class="text-xs mb-0.5" style="color:#64748b;">Total Paid</div>
          <div class="font-bold text-base" style="color:#fff;">${row.total_charged ? '$' + Number(row.total_charged).toFixed(2) : 'N/A'}</div>
        </div>
      </div>
      ${row.vehicle_plate ? `
      <div class="info-row">
        <div class="info-icon" style="background:rgba(59,130,246,0.12);color:#3b82f6;"><i class="fas fa-car"></i></div>
        <div>
          <div class="text-xs mb-0.5" style="color:#64748b;">Vehicle</div>
          <div class="font-semibold text-sm" style="color:#e2e8f0;">${row.vehicle_plate}${row.vehicle_description ? ' · ' + row.vehicle_description : ''}</div>
        </div>
      </div>` : ''}
    </div>

    <!-- Countdown timer -->
    <div id="countdown-section" class="mt-4 p-3 rounded-xl" style="background:rgba(91,46,255,0.08);border:1px solid rgba(91,46,255,0.2);">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-semibold" style="color:#a78bfa;">
          <i class="fas fa-clock mr-1"></i>Time Remaining
        </span>
        <span id="countdown-text" class="text-sm font-bold" style="color:#fff;">--:--:--</span>
      </div>
      <div class="w-full rounded-full h-1.5" style="background:rgba(255,255,255,0.08);">
        <div id="countdown-bar" class="countdown-bar h-1.5 rounded-full" style="background:linear-gradient(90deg,#5B2EFF,#a78bfa);width:100%;"></div>
      </div>
    </div>
  </div>

  <!-- ── PARKING INSTRUCTIONS ───────────────────────────────────────── -->
  ${row.parking_instructions ? `
  <div class="mx-4 mt-3 rounded-2xl p-4 fade-up fade-up-3" style="background:rgba(234,179,8,0.06);border:1px solid rgba(234,179,8,0.2);">
    <div class="flex items-center gap-2 mb-2">
      <i class="fas fa-circle-info" style="color:#eab308;font-size:14px;"></i>
      <span class="font-bold text-sm" style="color:#eab308;">Parking Instructions</span>
    </div>
    <p class="text-sm leading-relaxed" style="color:#d1d5db;">${row.parking_instructions}</p>
  </div>` : ''}

  <!-- ── ACTION BUTTONS ────────────────────────────────────────────── -->

  <!-- START ARRIVAL MODE — primary CTA -->
  <div class="mx-4 mt-4 fade-up fade-up-3">
    <a href="/arrival/${row.id}"
       class="action-btn w-full flex items-center justify-center gap-2 font-black text-base"
       style="background:linear-gradient(135deg,#C6FF00,#a8d900);color:#121212;border-radius:16px;padding:16px;">
      <i class="fas fa-route"></i>
      Start Arrival Mode
    </a>
    <p class="text-center text-xs mt-1.5" style="color:#4b5563;">
      Live GPS navigation to your spot
    </p>
  </div>

  <div class="mx-4 mt-3 grid grid-cols-2 gap-3 fade-up fade-up-3">
    <button onclick="openDirections()" class="action-btn btn-primary">
      <i class="fas fa-location-arrow"></i> Directions
    </button>
    <button onclick="copyAddress()" id="copy-btn" class="action-btn btn-secondary">
      <i class="fas fa-copy" id="copy-icon"></i> <span id="copy-label">Copy Address</span>
    </button>
  </div>

  <div class="mx-4 mt-3 grid grid-cols-2 gap-3 fade-up fade-up-4">
    <a href="/dashboard?tab=upcoming" class="action-btn btn-ghost">
      <i class="fas fa-calendar"></i> My Bookings
    </a>
    <a href="/booking/${row.id}/extend" id="extend-btn" class="action-btn btn-ghost">
      <i class="fas fa-clock-rotate-left"></i> Extend
    </a>
  </div>

  <!-- Share strip -->
  <div class="mx-4 mt-5 fade-up fade-up-5">
    <p class="text-xs text-center mb-2" style="color:#4b5563;">Your parking is confirmed — share with someone if needed</p>
    <button onclick="shareBooking()" class="action-btn btn-ghost text-sm" style="font-size:13px;">
      <i class="fas fa-share-nodes"></i> Share Booking Details
    </button>
  </div>

  <!-- ── REFERRAL NUDGE ────────────────────────────────────────────── -->
  <div class="mx-4 mt-4 rounded-2xl p-4 fade-up fade-up-5"
       style="background:linear-gradient(135deg,rgba(91,46,255,0.15),rgba(167,139,250,0.08));border:1px solid rgba(91,46,255,0.2);">
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
           style="background:rgba(91,46,255,0.2);">
        <i class="fas fa-gift" style="color:#a78bfa;font-size:16px;"></i>
      </div>
      <div class="flex-1 min-w-0">
        <p class="font-bold text-sm" style="color:#fff;">Earn $10 for every friend you refer!</p>
        <p class="text-xs mt-0.5" style="color:#94a3b8;">They get $10 off their first booking too.</p>
      </div>
      <a href="/dashboard?tab=referrals" class="text-xs font-bold px-3 py-1.5 rounded-lg flex-shrink-0"
         style="background:#5B2EFF;color:#fff;">Share</a>
    </div>
  </div>

</div><!-- /main -->


<!-- ═══════════════════════════════════════════════════════════════ -->
<!-- DIRECTIONS MODAL                                                  -->
<!-- ═══════════════════════════════════════════════════════════════ -->
<div id="directions-modal" class="map-modal" onclick="closeDirections(event)">
  <div class="w-full rounded-t-3xl p-6" style="background:#13131a;max-width:520px;margin:0 auto;"
       onclick="event.stopPropagation()">
    <div class="w-10 h-1 rounded-full mx-auto mb-5" style="background:rgba(255,255,255,0.15);"></div>
    <h3 class="font-bold text-lg mb-1" style="color:#fff;">Get Directions</h3>
    <p class="text-sm mb-5" style="color:#94a3b8;">${fullAddress}</p>

    <div class="space-y-3">
      <a href="${row.lat && row.lng ? `https://www.google.com/maps/dir/?api=1&destination=${row.lat},${row.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`}"
         target="_blank" class="action-btn" style="background:#fff;color:#1a1a2e;justify-content:flex-start;gap:14px;">
        <img src="https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/googlemaps.svg" width="22" style="filter:none;">
        <span>Google Maps</span>
        <i class="fas fa-arrow-up-right-from-square ml-auto text-xs" style="color:#94a3b8;"></i>
      </a>
      <a href="${row.lat && row.lng ? `http://maps.apple.com/?daddr=${row.lat},${row.lng}` : `http://maps.apple.com/?q=${encodeURIComponent(fullAddress)}`}"
         target="_blank" class="action-btn" style="background:#fff;color:#1a1a2e;justify-content:flex-start;gap:14px;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="#007AFF"/>
          <circle cx="12" cy="9" r="2.5" fill="white"/>
        </svg>
        <span>Apple Maps</span>
        <i class="fas fa-arrow-up-right-from-square ml-auto text-xs" style="color:#94a3b8;"></i>
      </a>
      <a href="${row.lat && row.lng ? `https://waze.com/ul?ll=${row.lat},${row.lng}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent(fullAddress)}&navigate=yes`}"
         target="_blank" class="action-btn" style="background:#fff;color:#1a1a2e;justify-content:flex-start;gap:14px;">
        <img src="https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/waze.svg" width="22" style="filter:hue-rotate(190deg);">
        <span>Waze</span>
        <i class="fas fa-arrow-up-right-from-square ml-auto text-xs" style="color:#94a3b8;"></i>
      </a>
    </div>

    <button onclick="closeDirections()" class="action-btn btn-ghost mt-4">Cancel</button>
  </div>
</div>

<script>
  // ── Constants ─────────────────────────────────────────────────────────────
  const END_TIME_MS  = ${endTimeMs};
  const START_TIME_MS = ${startDate.getTime()};
  const FULL_ADDRESS = ${JSON.stringify(fullAddress)};
  const BOOKING_REF  = ${JSON.stringify(bookingRef)};
  const BOOKING_ID   = ${row.id};

  // ── Confetti burst ────────────────────────────────────────────────────────
  (function spawnConfetti() {
    const colors = ['#5B2EFF','#a78bfa','#22c55e','#f59e0b','#ec4899','#3b82f6'];
    const container = document.getElementById('confetti-container');
    for (let i = 0; i < 60; i++) {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      el.style.cssText = [
        'left:' + Math.random() * 100 + 'vw',
        'background:' + colors[Math.floor(Math.random() * colors.length)],
        'width:' + (Math.random() * 8 + 4) + 'px',
        'height:' + (Math.random() * 8 + 4) + 'px',
        'border-radius:' + (Math.random() > 0.5 ? '50%' : '2px'),
        'animation-duration:' + (Math.random() * 2 + 2) + 's',
        'animation-delay:' + (Math.random() * 1.5) + 's',
      ].join(';');
      container.appendChild(el);
    }
    setTimeout(() => container.remove(), 5000);
  })();

  // ── Countdown timer ───────────────────────────────────────────────────────
  function updateCountdown() {
    const now = Date.now();
    const remaining = END_TIME_MS - now;
    const total = END_TIME_MS - START_TIME_MS;
    const section = document.getElementById('countdown-section');

    if (remaining <= 0) {
      document.getElementById('countdown-text').textContent = 'Session ended';
      document.getElementById('countdown-bar').style.width = '0%';
      if (section) section.style.borderColor = 'rgba(239,68,68,0.3)';
      return;
    }

    const h = Math.floor(remaining / 3600000);
    const m = Math.floor((remaining % 3600000) / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    document.getElementById('countdown-text').textContent =
      (h > 0 ? h + 'h ' : '') + m + 'm ' + String(s).padStart(2,'0') + 's';

    const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
    document.getElementById('countdown-bar').style.width = pct + '%';

    // Color shift as time runs out
    if (pct < 20) {
      document.getElementById('countdown-bar').style.background = 'linear-gradient(90deg,#ef4444,#f97316)';
      if (section) section.style.borderColor = 'rgba(239,68,68,0.3)';
    } else if (pct < 50) {
      document.getElementById('countdown-bar').style.background = 'linear-gradient(90deg,#f59e0b,#eab308)';
    }
  }

  updateCountdown();
  setInterval(updateCountdown, 1000);

  // ── Directions modal ──────────────────────────────────────────────────────
  function openDirections() {
    document.getElementById('directions-modal').classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeDirections(e) {
    if (!e || e.target === document.getElementById('directions-modal') || e.type === 'click') {
      document.getElementById('directions-modal').classList.remove('open');
      document.body.style.overflow = '';
    }
  }

  // ── Copy address ──────────────────────────────────────────────────────────
  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(FULL_ADDRESS);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = FULL_ADDRESS;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    const btn   = document.getElementById('copy-btn');
    const icon  = document.getElementById('copy-icon');
    const label = document.getElementById('copy-label');
    icon.className  = 'fas fa-check';
    label.textContent = 'Copied!';
    btn.style.background = 'rgba(34,197,94,0.15)';
    btn.style.borderColor = 'rgba(34,197,94,0.3)';
    btn.style.color = '#22c55e';
    setTimeout(() => {
      icon.className = 'fas fa-copy';
      label.textContent = 'Copy Address';
      btn.style.cssText = '';
    }, 2500);
  }

  // ── Share booking ─────────────────────────────────────────────────────────
  async function shareBooking() {
    const data = {
      title: 'ParkPeer — Booking Confirmed',
      text:  BOOKING_REF + ' · ' + FULL_ADDRESS,
      url:   window.location.href,
    };
    if (navigator.share) {
      try { await navigator.share(data); return; } catch (_) {}
    }
    copyAddress();
  }
</script>
</body>
</html>`)
  } catch (e: any) {
    console.error('[confirmation page]', e.message)
    return c.redirect('/dashboard?tab=upcoming')
  }
})

// ════════════════════════════════════════════════════════════════════════════
// GET /booking/confirmation/pending  — 3DS / redirect-based payment return
// Stripe redirects here after 3DS authentication. We look up the booking by
// the payment_intent query param that Stripe appends automatically, then
// forward to the real confirmation page once the booking is confirmed.
// ════════════════════════════════════════════════════════════════════════════
confirmationPage.get('/pending', async (c) => {
  const db = c.env?.DB

  // Auth guard — session cookie must still be valid after the 3DS redirect
  const session = await verifyUserToken(
    c,
    c.env?.USER_TOKEN_SECRET || 'pp-user-secret-change-in-prod'
  ).catch(() => null)

  if (!session) {
    return c.redirect('/auth/login?reason=auth&next=/dashboard?tab=upcoming')
  }

  if (!db) return c.redirect('/dashboard?tab=upcoming')

  // Stripe appends ?payment_intent=pi_xxx&payment_intent_client_secret=...
  // after the 3DS flow completes.
  const piId = c.req.query('payment_intent') || ''
  const holdParam = c.req.query('hold') || ''
  const tokenParam = c.req.query('token') || ''

  try {
    // Try to find a confirmed booking by payment intent ID
    if (piId) {
      const booking = await db.prepare(
        `SELECT id FROM bookings WHERE stripe_payment_intent_id = ? AND driver_id = ? LIMIT 1`
      ).bind(piId, session.id).first<any>()

      if (booking) {
        return c.redirect('/booking/confirmation/' + booking.id)
      }
    }

    // Fallback: find most recent confirmed booking for this driver in last 10 min
    const recent = await db.prepare(
      `SELECT id FROM bookings
       WHERE driver_id = ? AND status IN ('confirmed','active')
       AND created_at >= datetime('now','-10 minutes')
       ORDER BY id DESC LIMIT 1`
    ).bind(session.id).first<any>()

    if (recent) {
      return c.redirect('/booking/confirmation/' + recent.id)
    }

    // If nothing found, redirect to dashboard — booking may still be processing
    return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Processing Payment — ParkPeer</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <meta http-equiv="refresh" content="5;url=/dashboard?tab=upcoming">
</head>
<body class="bg-gray-950 text-white min-h-screen flex items-center justify-center">
  <div class="text-center p-8 max-w-md">
    <div class="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
      <svg class="animate-spin h-8 w-8 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
      </svg>
    </div>
    <h1 class="text-xl font-bold mb-2">Finalising Your Booking…</h1>
    <p class="text-gray-400 text-sm mb-4">Your payment was authorised. We're confirming your reservation — this takes just a moment.</p>
    <p class="text-gray-600 text-xs">You'll be redirected automatically. If nothing happens, <a href="/dashboard?tab=upcoming" class="text-indigo-400 underline">go to your dashboard</a>.</p>
  </div>
  <script>
    // Poll for booking confirmation every 2 seconds for up to 30 seconds
    let attempts = 0;
    const pi = new URLSearchParams(location.search).get('payment_intent') || '';
    async function poll() {
      if (attempts++ > 15 || !pi) { window.location.href = '/dashboard?tab=upcoming'; return; }
      try {
        const r = await fetch('/api/bookings/by-intent?pi=' + encodeURIComponent(pi), { credentials: 'include' });
        if (r.ok) {
          const d = await r.json();
          if (d.booking_id) { window.location.href = '/booking/confirmation/' + d.booking_id; return; }
        }
      } catch(_) {}
      setTimeout(poll, 2000);
    }
    poll();
  </script>
</body>
</html>`)
  } catch (e: any) {
    console.error('[confirmation/pending]', e.message)
    return c.redirect('/dashboard?tab=upcoming')
  }
})

// ════════════════════════════════════════════════════════════════════════════
// GET /booking/confirmation/:booking_id/extend  — placeholder, redirects to booking
// ════════════════════════════════════════════════════════════════════════════
confirmationPage.get('/:booking_id/extend', async (c) => {
  const bookingId = c.req.param('booking_id')
  return c.redirect('/booking/' + bookingId + '?extend=1')
})
