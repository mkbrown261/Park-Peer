// ════════════════════════════════════════════════════════════════════════════
// ParkPeer — Arrival Mode  /arrival/:booking_id
// Smart parking navigation: live map, GPS, turn-by-turn, I've Arrived CTA
// ════════════════════════════════════════════════════════════════════════════
import { Hono } from 'hono'
import { verifyUserToken } from '../middleware/security'

type Bindings = {
  DB: D1Database
  USER_TOKEN_SECRET: string
  GOOGLE_MAPS_API_KEY?: string
}

export const arrivalPage = new Hono<{ Bindings: Bindings }>()

// ── GET /arrival/:booking_id ─────────────────────────────────────────────────
arrivalPage.get('/:booking_id', async (c) => {
  const bookingId = c.req.param('booking_id')
  const db = c.env?.DB

  const session = await verifyUserToken(
    c,
    c.env?.USER_TOKEN_SECRET || 'pp-user-secret-change-in-prod'
  ).catch(() => null)

  if (!session) {
    return c.redirect(`/auth/login?reason=auth&next=${encodeURIComponent('/arrival/' + bookingId)}`)
  }
  if (!db) return c.text('Service unavailable', 503)

  try {
    const row = await db.prepare(`
      SELECT
        b.id, b.driver_id, b.host_id,
        b.start_time, b.end_time, b.status,
        b.arrival_started_at, b.arrival_confirmed_at,
        l.title        AS listing_title,
        l.address      AS listing_address,
        l.city         AS listing_city,
        l.state        AS listing_state,
        l.lat, l.lng,
        l.instructions AS parking_instructions,
        l.photos,
        u.full_name    AS host_name,
        u.phone        AS host_phone
      FROM bookings b
      JOIN listings l ON b.listing_id = l.id
      JOIN users    u ON b.host_id    = u.id
      WHERE b.id = ?
    `).bind(bookingId).first<any>()

    if (!row) return c.text('Booking not found', 404)

    // IDOR: only the driver for this booking
    if (row.driver_id !== session.userId) {
      return c.redirect('/dashboard?error=access_denied')
    }

    const mapsKey = c.env?.GOOGLE_MAPS_API_KEY || ''
    const lat     = row.lat   || 41.8781
    const lng     = row.lng   || -87.6298
    const addr    = encodeURIComponent(`${row.listing_address}, ${row.listing_city}, ${row.listing_state}`)
    const now     = Date.now()
    const endMs   = new Date(row.end_time).getTime()
    const remainS = Math.max(0, Math.floor((endMs - now) / 1000))

    let photos: string[] = []
    try { photos = JSON.parse(row.photos || '[]') } catch {}

    return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Arrival Mode — ParkPeer</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet"/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet"/>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            indigo:  { DEFAULT:'#5B2EFF', 500:'#5B2EFF', 600:'#4a20f0', 700:'#3a12d4' },
            lime:    { DEFAULT:'#C6FF00', 500:'#C6FF00' },
            charcoal:{ DEFAULT:'#121212', 100:'#1E1E1E', 200:'#2a2a2a', 300:'#3a3a3a' }
          },
          fontFamily: { sans: ['Inter','system-ui','sans-serif'] }
        }
      }
    }
  </script>
  <style>
    body { background:#121212; color:#fff; font-family:'Inter',sans-serif; }
    #map { width:100%; height:100%; }
    .glass {
      background:rgba(30,30,30,0.85);
      backdrop-filter:blur(12px);
      border:1px solid rgba(255,255,255,0.08);
    }
    .btn-primary {
      background:linear-gradient(135deg,#5B2EFF,#7B4FFF);
      color:#fff; border:none; cursor:pointer;
      transition:opacity .2s;
    }
    .btn-primary:hover { opacity:.9; }
    .btn-arrived {
      background:linear-gradient(135deg,#16a34a,#22c55e);
      color:#fff; border:none; cursor:pointer;
      transition:all .2s;
    }
    .btn-arrived:hover { opacity:.9; transform:scale(1.02); }
    .proximity-badge {
      background:rgba(198,255,0,0.15);
      border:1px solid #C6FF00;
      color:#C6FF00;
    }
    @keyframes pulse-ring {
      0%   { transform:scale(1); opacity:.8; }
      100% { transform:scale(1.6); opacity:0; }
    }
    .pulse-dot::after {
      content:''; position:absolute; inset:-4px;
      border-radius:50%; border:2px solid #C6FF00;
      animation:pulse-ring 1.5s ease-out infinite;
    }
    .confetti-piece {
      position:fixed; width:8px; height:8px; border-radius:2px;
      animation:fall 2s ease-in forwards;
    }
    @keyframes fall {
      0%   { transform:translateY(-20px) rotate(0deg); opacity:1; }
      100% { transform:translateY(100vh) rotate(720deg); opacity:0; }
    }
  </style>
</head>
<body class="min-h-screen">

<!-- ── Top Bar ─────────────────────────────────────────────────────────────── -->
<div class="fixed top-0 left-0 right-0 z-50 glass flex items-center justify-between px-4 py-3">
  <a href="/booking/confirmation/${bookingId}" class="text-white/70 hover:text-white transition">
    <i class="fas fa-arrow-left mr-2"></i>Back
  </a>
  <div class="flex items-center gap-2">
    <div class="w-2 h-2 rounded-full bg-lime-500 animate-pulse"></div>
    <span class="text-sm font-semibold text-lime-500">ARRIVAL MODE</span>
  </div>
  <div id="timer-badge" class="text-sm font-mono font-bold text-white bg-indigo-500/20 border border-indigo-500/40 px-3 py-1 rounded-full">
    --:--:--
  </div>
</div>

<!-- ── Map (full background) ──────────────────────────────────────────────── -->
<div class="fixed inset-0 z-0">
  <div id="map"></div>
</div>

<!-- ── Bottom Sheet ───────────────────────────────────────────────────────── -->
<div id="bottom-sheet" class="fixed bottom-0 left-0 right-0 z-40 glass rounded-t-3xl transition-all duration-300"
     style="max-height:75vh; overflow-y:auto;">

  <!-- Handle -->
  <div class="flex justify-center pt-3 pb-2">
    <div class="w-10 h-1 rounded-full bg-white/30 cursor-pointer" onclick="toggleSheet()"></div>
  </div>

  <!-- Spot Info -->
  <div class="px-5 pb-2">
    <div class="flex items-start justify-between">
      <div>
        <h2 class="text-lg font-bold text-white leading-tight">${row.listing_title}</h2>
        <p class="text-sm text-white/60 mt-0.5">
          <i class="fas fa-map-marker-alt text-indigo-400 mr-1"></i>
          ${row.listing_address}, ${row.listing_city}
        </p>
      </div>
      ${row.host_phone ? `
      <a href="tel:${row.host_phone}" class="flex-shrink-0 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition">
        <i class="fas fa-phone text-white/80 text-sm"></i>
      </a>` : ''}
    </div>

    <!-- Proximity Alert (hidden by default) -->
    <div id="proximity-alert" class="hidden proximity-badge rounded-xl px-4 py-2.5 mt-3 flex items-center gap-2">
      <i class="fas fa-location-arrow text-lime-400"></i>
      <span class="text-sm font-semibold">You're near your parking spot!</span>
    </div>
  </div>

  <!-- Navigation Buttons -->
  <div class="grid grid-cols-3 gap-2 px-5 py-3">
    <a id="btn-gmaps"  href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(row.listing_address + ' ' + row.listing_city)}" target="_blank"
       class="flex flex-col items-center gap-1.5 glass rounded-2xl py-3 hover:bg-white/10 transition cursor-pointer text-center">
      <img src="https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/googlemaps.svg" class="w-6 h-6 invert opacity-80" alt="Google Maps"/>
      <span class="text-xs text-white/70 font-medium">Google Maps</span>
    </a>
    <a id="btn-apple"
       href="http://maps.apple.com/?daddr=${addr}&dirflg=d" target="_blank"
       class="flex flex-col items-center gap-1.5 glass rounded-2xl py-3 hover:bg-white/10 transition cursor-pointer text-center">
      <i class="fab fa-apple text-xl text-white/80"></i>
      <span class="text-xs text-white/70 font-medium">Apple Maps</span>
    </a>
    <a id="btn-waze"
       href="https://waze.com/ul?ll=${lat},${lng}&navigate=yes" target="_blank"
       class="flex flex-col items-center gap-1.5 glass rounded-2xl py-3 hover:bg-white/10 transition cursor-pointer text-center">
      <img src="https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/waze.svg" class="w-6 h-6 invert opacity-80" alt="Waze"/>
      <span class="text-xs text-white/70 font-medium">Waze</span>
    </a>
  </div>

  <!-- Instructions -->
  ${row.parking_instructions ? `
  <div class="mx-5 mb-3 bg-white/5 rounded-2xl p-4">
    <div class="flex items-center gap-2 mb-2">
      <i class="fas fa-clipboard-list text-indigo-400"></i>
      <span class="text-sm font-semibold text-white">Parking Instructions</span>
    </div>
    <p class="text-sm text-white/75 leading-relaxed">${row.parking_instructions}</p>
  </div>` : ''}

  <!-- Host Info -->
  <div class="mx-5 mb-3 flex items-center gap-3 glass rounded-2xl px-4 py-3">
    <div class="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
      ${(row.host_name || 'H')[0].toUpperCase()}
    </div>
    <div>
      <p class="text-xs text-white/50 uppercase tracking-wide">Your Host</p>
      <p class="text-sm font-semibold text-white">${row.host_name || 'ParkPeer Host'}</p>
    </div>
  </div>

  <!-- I've Arrived Button -->
  <div class="px-5 pb-8">
    ${row.arrival_confirmed_at ? `
    <div class="w-full py-4 rounded-2xl bg-green-500/20 border border-green-500/40 flex items-center justify-center gap-3">
      <i class="fas fa-check-circle text-green-400 text-xl"></i>
      <span class="font-bold text-green-400 text-lg">Arrived — Enjoy your spot!</span>
    </div>
    ` : `
    <button id="btn-arrived" onclick="markArrived()"
      class="btn-arrived w-full py-4 rounded-2xl flex items-center justify-center gap-3 text-lg font-bold shadow-lg">
      <i class="fas fa-parking"></i>
      I've Arrived
    </button>
    <p class="text-center text-white/40 text-xs mt-2">
      Tap when you're parked to notify your host
    </p>
    `}
  </div>
</div>

<!-- ── Arrived Modal ───────────────────────────────────────────────────────── -->
<div id="arrived-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center px-5" style="background:rgba(0,0,0,0.7)">
  <div class="glass rounded-3xl p-8 max-w-sm w-full text-center">
    <div class="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-green-400">
      <i class="fas fa-check text-green-400 text-3xl"></i>
    </div>
    <h2 class="text-2xl font-black text-white mb-2">You're Parked!</h2>
    <p class="text-white/60 text-sm mb-6">Arrival confirmed. Your host has been notified. Enjoy your parking spot!</p>
    <a href="/dashboard?tab=upcoming" class="btn-primary w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2">
      <i class="fas fa-tachometer-alt"></i>View Dashboard
    </a>
  </div>
</div>

<!-- ── Scripts ─────────────────────────────────────────────────────────────── -->
<script>
  const BOOKING_ID   = ${bookingId}
  const SPOT_LAT     = ${lat}
  const SPOT_LNG     = ${lng}
  const END_TIME_MS  = ${endMs}
  let   remainingSec = ${remainS}
  let   driverLat    = null
  let   driverLng    = null
  let   map          = null
  let   driverMarker = null
  let   spotMarker   = null
  let   sheetOpen    = true

  // ── Timer countdown ────────────────────────────────────────────────────
  function formatTime(s) {
    if (s <= 0) return '00:00:00'
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return [h,m,sec].map(n => String(n).padStart(2,'0')).join(':')
  }

  function tickTimer() {
    const badge = document.getElementById('timer-badge')
    if (!badge) return
    const now  = Date.now()
    const diff = Math.max(0, Math.floor((END_TIME_MS - now) / 1000))
    badge.textContent = formatTime(diff)
    if (diff < 300) {
      badge.classList.remove('bg-indigo-500/20','border-indigo-500/40')
      badge.classList.add('bg-red-500/20','border-red-500/40','text-red-400')
    } else if (diff < 900) {
      badge.classList.remove('bg-indigo-500/20','border-indigo-500/40')
      badge.classList.add('bg-yellow-500/20','border-yellow-500/40','text-yellow-400')
    }
  }
  setInterval(tickTimer, 1000)
  tickTimer()

  // ── Sheet toggle ───────────────────────────────────────────────────────
  function toggleSheet() {
    const sheet = document.getElementById('bottom-sheet')
    sheetOpen = !sheetOpen
    sheet.style.transform = sheetOpen ? 'translateY(0)' : 'translateY(calc(100% - 56px))'
  }

  // ── Geolocation & proximity ────────────────────────────────────────────
  function haversineM(lat1, lng1, lat2, lng2) {
    const R  = 6371000
    const dL = (lat2 - lat1) * Math.PI / 180
    const dG = (lng2 - lng1) * Math.PI / 180
    const a  = Math.sin(dL/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dG/2)**2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  }

  function watchPosition() {
    if (!navigator.geolocation) return
    navigator.geolocation.watchPosition(pos => {
      driverLat = pos.coords.latitude
      driverLng = pos.coords.longitude

      // Update driver marker on map
      if (map && driverMarker) {
        driverMarker.setPosition({ lat: driverLat, lng: driverLng })
      } else if (map && window.google) {
        driverMarker = new google.maps.Marker({
          position: { lat: driverLat, lng: driverLng },
          map,
          title: 'Your Location',
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: '#C6FF00',
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: 2
          }
        })
      }

      // Proximity check: 100 m
      const dist = haversineM(driverLat, driverLng, SPOT_LAT, SPOT_LNG)
      const alert = document.getElementById('proximity-alert')
      if (dist <= 100) {
        alert.classList.remove('hidden')
      } else {
        alert.classList.add('hidden')
      }
    }, null, { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 })
  }

  // ── Google Maps init ───────────────────────────────────────────────────
  function initMap() {
    map = new google.maps.Map(document.getElementById('map'), {
      center: { lat: SPOT_LAT, lng: SPOT_LNG },
      zoom: 17,
      disableDefaultUI: true,
      styles: [
        { elementType:'geometry',        stylers:[{color:'#1e1e1e'}] },
        { elementType:'labels.text.fill',stylers:[{color:'#757575'}] },
        { featureType:'road',            elementType:'geometry', stylers:[{color:'#2a2a2a'}] },
        { featureType:'road',            elementType:'labels.text.fill', stylers:[{color:'#9ca5b3'}] },
        { featureType:'water',           elementType:'geometry', stylers:[{color:'#17263c'}] },
        { featureType:'poi',             stylers:[{visibility:'off'}] },
        { featureType:'transit',         stylers:[{visibility:'off'}] },
      ]
    })

    // Spot marker
    spotMarker = new google.maps.Marker({
      position: { lat: SPOT_LAT, lng: SPOT_LNG },
      map,
      title: 'Parking Spot',
      icon: {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(\`
          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48">
            <path d="M20 0C8.954 0 0 8.954 0 20c0 15 20 28 20 28s20-13 20-28C40 8.954 31.046 0 20 0z" fill="#5B2EFF"/>
            <circle cx="20" cy="20" r="14" fill="#fff" fill-opacity="0.15"/>
            <text x="20" y="25" text-anchor="middle" fill="white" font-size="14" font-weight="bold" font-family="Arial">P</text>
          </svg>\`),
        scaledSize: new google.maps.Size(40, 48),
        anchor: new google.maps.Point(20, 48)
      }
    })

    watchPosition()
  }
  window.initMap = initMap

  // ── I've Arrived ────────────────────────────────────────────────────────
  async function markArrived() {
    const btn = document.getElementById('btn-arrived')
    if (!btn) return
    btn.disabled = true
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Confirming...'

    try {
      const token = localStorage.getItem('pp_token') || sessionStorage.getItem('pp_token') || ''
      const res = await fetch('/api/bookings/${bookingId}/arrived', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: driverLat, lng: driverLng })
      })
      const data = await res.json()
      if (data.success) {
        launchConfetti()
        document.getElementById('arrived-modal').classList.remove('hidden')
      } else {
        btn.disabled = false
        btn.innerHTML = "<i class='fas fa-parking'></i> I've Arrived"
        alert(data.error || 'Could not confirm arrival. Please try again.')
      }
    } catch (e) {
      btn.disabled = false
      btn.innerHTML = "<i class='fas fa-parking'></i> I've Arrived"
    }
  }

  function launchConfetti() {
    const colors = ['#5B2EFF','#C6FF00','#ffffff','#7B4FFF','#a3e635']
    for (let i = 0; i < 40; i++) {
      const el = document.createElement('div')
      el.className = 'confetti-piece'
      el.style.left      = Math.random() * 100 + 'vw'
      el.style.top       = '-20px'
      el.style.background = colors[Math.floor(Math.random() * colors.length)]
      el.style.animationDelay = Math.random() * 1 + 's'
      el.style.animationDuration = (1.5 + Math.random()) + 's'
      document.body.appendChild(el)
      setTimeout(() => el.remove(), 3000)
    }
  }
</script>

${mapsKey ? `<script async defer
  src="https://maps.googleapis.com/maps/api/js?key=${mapsKey}&callback=initMap">
</script>` : `
<!-- Maps API key not configured — static fallback -->
<script>
  window.initMap = function() {
    document.getElementById('map').innerHTML =
      '<div style="width:100%;height:100%;background:#1a1a2e;display:flex;align-items:center;justify-content:center;">' +
      '<div style="text-align:center;color:#fff;opacity:.5;">' +
      '<div style="font-size:3rem;margin-bottom:8px;">📍</div>' +
      '<div style="font-size:.9rem;">Map requires Google Maps API key</div>' +
      '</div></div>'
  }
  initMap()
</script>`}
</body>
</html>`)
  } catch (e: any) {
    console.error('[arrival page]', e.message)
    return c.text('An error occurred loading arrival mode', 500)
  }
})
