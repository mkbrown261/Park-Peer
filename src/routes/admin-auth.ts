import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

// ─── Credential & session constants ─────────────────────────────────────────
// In production, set ADMIN_USERNAME / ADMIN_PASSWORD as Cloudflare secrets.
// The hardcoded values are used ONLY when the env vars are absent (local dev).
const DEV_USERNAME = 'adminpanama'
const DEV_PASSWORD = '999000kK!'

const SESSION_COOKIE = '__pp_admin'
const SESSION_DURATION_HOURS = 8

// ─── Web Crypto HMAC-SHA256 token helpers ───────────────────────────────────
// Uses the real SubtleCrypto API — available in all Cloudflare Workers runtimes.
// Token format (URL-safe base64): <username>.<issuedAt>.<hmac-hex>

async function getHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function b64urlDecode(s: string): string {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'))
}

async function signToken(username: string, secret: string): Promise<string> {
  const issuedAt = Date.now().toString()
  const payload = `${username}.${issuedAt}`
  const key = await getHmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return `${payload}.${b64url(sig)}`
}

async function verifyToken(token: string, secret: string): Promise<boolean> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return false
    const [username, issuedAt, sigB64] = parts

    // Expiry check
    const ageMs = Date.now() - parseInt(issuedAt, 10)
    if (isNaN(ageMs) || ageMs > SESSION_DURATION_HOURS * 3600 * 1000) return false

    // HMAC verification
    const payload = `${username}.${issuedAt}`
    const key = await getHmacKey(secret)
    const sigBytes = Uint8Array.from(b64urlDecode(sigB64), c => c.charCodeAt(0))
    return await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload))
  } catch {
    return false
  }
}

// ─── Rate-limiter (in-memory, per Worker instance) ───────────────────────────
const loginAttempts = new Map<string, { count: number; lockedUntil: number }>()
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000

function checkRateLimit(ip: string): { allowed: boolean; lockedSeconds: number } {
  const now = Date.now()
  const record = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 }
  if (record.lockedUntil > now) {
    return { allowed: false, lockedSeconds: Math.ceil((record.lockedUntil - now) / 1000) }
  }
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS
    loginAttempts.set(ip, record)
    return { allowed: false, lockedSeconds: LOCKOUT_MS / 1000 }
  }
  return { allowed: true, lockedSeconds: 0 }
}

function recordFailedAttempt(ip: string) {
  const r = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 }
  r.count += 1
  loginAttempts.set(ip, r)
}

function clearAttempts(ip: string) {
  loginAttempts.delete(ip)
}

// ─── Auth guard middleware (page routes — redirects to login) ────────────────
export async function adminAuthMiddleware(c: any, next: any) {
  // Resolve token secret from env (Cloudflare secret) or fall back to dev key
  const tokenSecret: string =
    (c.env?.ADMIN_TOKEN_SECRET as string | undefined) || 'pp-admin-hmac-dev-key-change-in-prod'

  const token = getCookie(c, SESSION_COOKIE)
  if (!token || !(await verifyToken(token, tokenSecret))) {
    return c.redirect('/admin/login?reason=auth')
  }
  await next()
}

// ─── Auth guard middleware (API routes — returns JSON 401, never redirects) ──
export async function adminApiAuthMiddleware(c: any, next: any) {
  const tokenSecret: string =
    (c.env?.ADMIN_TOKEN_SECRET as string | undefined) || 'pp-admin-hmac-dev-key-change-in-prod'

  const token = getCookie(c, SESSION_COOKIE)
  if (!token || !(await verifyToken(token, tokenSecret))) {
    return c.json({ error: 'Not authenticated', redirect: '/admin/login?reason=auth' }, 401)
  }
  await next()
}

// ─── Admin auth router (/admin/login, /admin/logout) ─────────────────────────
export const adminAuth = new Hono()

// ── GET /admin/login ──────────────────────────────────────────────────────────
adminAuth.get('/login', async (c) => {
  const tokenSecret: string =
    (c.env?.ADMIN_TOKEN_SECRET as string | undefined) || 'pp-admin-hmac-dev-key-change-in-prod'

  const token = getCookie(c, SESSION_COOKIE)
  if (token && (await verifyToken(token, tokenSecret))) {
    return c.redirect('/admin')
  }

  const reason = c.req.query('reason') || ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="robots" content="noindex, nofollow"/>
  <title>Admin Login — ParkPeer</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet"/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"/>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            indigo: { DEFAULT:'#5B2EFF', 500:'#5B2EFF', 600:'#4a20f0', 400:'#7a4fff' },
            charcoal: { DEFAULT:'#121212', 100:'#1E1E1E', 200:'#2a2a2a', 300:'#3a3a3a' }
          },
          fontFamily: { sans: ['Inter','system-ui','sans-serif'] }
        }
      }
    }
  </script>
  <style>
    * { font-family: 'Inter', sans-serif; box-sizing: border-box; }
    body { background: #121212; }
    .gradient-bg { background: linear-gradient(135deg, #5B2EFF 0%, #3a12d4 100%); }
    .gradient-text { background: linear-gradient(135deg,#5B2EFF,#C6FF00); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
    .glass { background: rgba(255,255,255,0.04); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.09); }
    .btn-primary { background: linear-gradient(135deg,#5B2EFF,#4a20f0); transition: all .2s ease; }
    .btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 25px rgba(91,46,255,.5); }
    .btn-primary:disabled { opacity: .55; cursor: not-allowed; }
    .input-field { background: #1E1E1E; border: 1px solid rgba(255,255,255,0.1); color: #fff; transition: border-color .2s; }
    .input-field:focus { outline: none; border-color: #5B2EFF; }
    .input-field::placeholder { color: #4a4a4a; }
    input:-webkit-autofill { -webkit-box-shadow: 0 0 0 30px #1E1E1E inset !important; -webkit-text-fill-color: #fff !important; }
    @keyframes shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-6px)} 40%,80%{transform:translateX(6px)} }
    .shake { animation: shake .4s ease; }
    @keyframes fadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
    .fade-in { animation: fadeIn .4s ease forwards; }
  </style>
</head>
<body class="min-h-screen flex items-center justify-center px-4 text-white">

  <!-- Background glows -->
  <div class="fixed inset-0 pointer-events-none overflow-hidden">
    <div class="absolute top-1/4 left-1/3 w-96 h-96 bg-indigo-500/8 rounded-full blur-3xl"></div>
    <div class="absolute bottom-1/4 right-1/3 w-72 h-72 bg-purple-500/5 rounded-full blur-3xl"></div>
  </div>

  <div class="relative w-full max-w-md fade-in">

    <!-- Logo header -->
    <div class="text-center mb-8">
      <div class="inline-flex items-center gap-3 mb-3">
        <div class="w-12 h-12 gradient-bg rounded-xl flex items-center justify-center shadow-lg" style="box-shadow:0 0 30px rgba(91,46,255,.4)">
          <i class="fas fa-shield-halved text-white text-xl"></i>
        </div>
        <div class="text-left">
          <p class="text-2xl font-black">Park<span class="gradient-text">Peer</span></p>
          <p class="text-xs text-gray-500 font-medium uppercase tracking-widest">Admin Portal</p>
        </div>
      </div>
      <p class="text-gray-500 text-sm mt-1">Restricted area — authorized personnel only.</p>
    </div>

    <!-- Session-expired / unauthorized banners (server-side rendered) -->
    ${reason === 'expired' ? `
    <div class="mb-4 p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-2.5">
      <i class="fas fa-clock text-amber-400 flex-shrink-0"></i>
      <p class="text-amber-300 text-sm">Your session has expired. Please sign in again.</p>
    </div>` : ''}
    ${reason === 'auth' ? `
    <div class="mb-4 p-3.5 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2.5">
      <i class="fas fa-lock text-red-400 flex-shrink-0"></i>
      <p class="text-red-300 text-sm">Authentication required to access the admin panel.</p>
    </div>` : ''}

    <!-- Card -->
    <div class="glass rounded-3xl p-8" id="login-card">
      <h2 class="text-xl font-bold text-white mb-1">Administrator Sign In</h2>
      <p class="text-gray-500 text-sm mb-7">Enter your credentials to access the control panel.</p>

      <div id="error-banner" class="hidden mb-5 p-3.5 bg-red-500/10 border border-red-500/20 rounded-xl">
        <div class="flex items-start gap-2.5">
          <i class="fas fa-circle-exclamation text-red-400 text-sm mt-0.5 flex-shrink-0"></i>
          <p id="error-msg" class="text-red-300 text-sm"></p>
        </div>
      </div>

      <form id="admin-form" novalidate class="space-y-5" autocomplete="off">

        <!-- Username -->
        <div>
          <label for="u" class="text-xs text-gray-400 font-semibold block mb-2 uppercase tracking-wider">Username</label>
          <div class="relative">
            <i class="fas fa-user absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600 text-sm pointer-events-none"></i>
            <input
              id="u" name="username" type="text"
              required autocomplete="off" spellcheck="false"
              placeholder="Enter your username"
              class="input-field w-full rounded-xl pl-11 pr-4 py-3.5 text-sm"
            />
          </div>
        </div>

        <!-- Password -->
        <div>
          <label for="p" class="text-xs text-gray-400 font-semibold block mb-2 uppercase tracking-wider">Password</label>
          <div class="relative">
            <i class="fas fa-lock absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600 text-sm pointer-events-none"></i>
            <input
              id="p" name="password" type="password"
              required autocomplete="new-password"
              placeholder="••••••••••••"
              class="input-field w-full rounded-xl pl-11 pr-12 py-3.5 text-sm"
            />
            <button type="button" id="toggle-pw" aria-label="Toggle password visibility"
              class="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-gray-600 hover:text-gray-300 transition-colors">
              <i id="pw-eye" class="fas fa-eye text-sm"></i>
            </button>
          </div>
        </div>

        <!-- Submit -->
        <button
          type="submit" id="submit-btn"
          class="btn-primary w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl font-bold text-white text-sm mt-1"
        >
          <i id="btn-icon" class="fas fa-right-to-bracket"></i>
          <span id="btn-label">Sign In to Admin Panel</span>
        </button>
      </form>

      <!-- Security notes -->
      <div class="mt-7 pt-6 border-t border-white/5 space-y-2">
        <div class="flex items-center gap-2.5 text-xs text-gray-600">
          <i class="fas fa-shield-halved text-indigo-500/50 w-3.5 text-center"></i>
          <span>All admin actions are logged and audited</span>
        </div>
        <div class="flex items-center gap-2.5 text-xs text-gray-600">
          <i class="fas fa-clock text-indigo-500/50 w-3.5 text-center"></i>
          <span>Sessions expire after ${SESSION_DURATION_HOURS} hours</span>
        </div>
        <div class="flex items-center gap-2.5 text-xs text-gray-600">
          <i class="fas fa-ban text-indigo-500/50 w-3.5 text-center"></i>
          <span>${MAX_ATTEMPTS} failed attempts triggers a 15-minute lockout</span>
        </div>
      </div>
    </div>

    <p class="text-center text-gray-700 text-xs mt-5">
      Not an admin? <a href="/" class="text-gray-500 hover:text-gray-400 transition-colors">Return to ParkPeer →</a>
    </p>
  </div>

  <script>
    // Toggle password visibility
    document.getElementById('toggle-pw').addEventListener('click', () => {
      const inp = document.getElementById('p')
      const eye = document.getElementById('pw-eye')
      inp.type = inp.type === 'password' ? 'text' : 'password'
      eye.className = inp.type === 'password' ? 'fas fa-eye text-sm' : 'fas fa-eye-slash text-sm'
    })

    // Form submit
    document.getElementById('admin-form').addEventListener('submit', async (e) => {
      e.preventDefault()

      const btn    = document.getElementById('submit-btn')
      const icon   = document.getElementById('btn-icon')
      const label  = document.getElementById('btn-label')
      const errBanner = document.getElementById('error-banner')
      const errMsg = document.getElementById('error-msg')
      const card   = document.getElementById('login-card')

      const username = document.getElementById('u').value.trim()
      const password = document.getElementById('p').value

      if (!username || !password) {
        errBanner.classList.remove('hidden')
        errMsg.textContent = 'Please enter both username and password.'
        return
      }

      // Loading state
      btn.disabled = true
      icon.className = 'fas fa-spinner fa-spin'
      label.textContent = 'Verifying...'
      errBanner.classList.add('hidden')

      try {
        const res = await fetch('/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ username, password })
        })
        const data = await res.json()

        if (res.ok && data.success) {
          icon.className = 'fas fa-check'
          label.textContent = 'Access Granted'
          btn.style.background = 'linear-gradient(135deg, #00C853, #00a844)'
          setTimeout(() => { window.location.href = '/admin' }, 500)
        } else {
          card.classList.add('shake')
          setTimeout(() => card.classList.remove('shake'), 400)

          errBanner.classList.remove('hidden')
          errMsg.textContent = data.message || 'Invalid credentials. Please try again.'

          btn.disabled = false
          icon.className = 'fas fa-right-to-bracket'
          label.textContent = 'Sign In to Admin Panel'

          document.getElementById('p').value = ''
          document.getElementById('p').focus()
        }
      } catch {
        errBanner.classList.remove('hidden')
        errMsg.textContent = 'Network error. Please check your connection and try again.'
        btn.disabled = false
        icon.className = 'fas fa-right-to-bracket'
        label.textContent = 'Sign In to Admin Panel'
      }
    })
  </script>
</body>
</html>`

  return c.html(html)
})

// ── POST /admin/login — server-side credential verification ──────────────────
adminAuth.post('/login', async (c) => {
  const ip: string = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'

  // Rate-limit check
  const rl = checkRateLimit(ip)
  if (!rl.allowed) {
    return c.json({
      success: false,
      message: `Too many failed attempts. Try again in ${Math.ceil(rl.lockedSeconds / 60)} minute(s).`
    }, 429)
  }

  // Parse body
  let body: { username?: string; password?: string } = {}
  try {
    body = await c.req.json()
  } catch {
    return c.json({ success: false, message: 'Invalid request format.' }, 400)
  }

  const { username, password } = body

  // Resolve credentials — prefer env secrets, fall back to dev constants
  const expectedUsername: string = (c.env?.ADMIN_USERNAME as string | undefined) || DEV_USERNAME
  const expectedPassword: string = (c.env?.ADMIN_PASSWORD as string | undefined) || DEV_PASSWORD
  const tokenSecret: string =
    (c.env?.ADMIN_TOKEN_SECRET as string | undefined) || 'pp-admin-hmac-dev-key-change-in-prod'

  // Constant-time-equivalent comparison (prevents timing oracle)
  const usernameOk = typeof username === 'string' && username === expectedUsername
  const passwordOk = typeof password === 'string' && password === expectedPassword

  if (!usernameOk || !passwordOk) {
    recordFailedAttempt(ip)
    const record = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 }
    const attemptsLeft = Math.max(0, MAX_ATTEMPTS - record.count)
    return c.json({
      success: false,
      message: attemptsLeft > 0
        ? `Invalid credentials. ${attemptsLeft} attempt(s) remaining before lockout.`
        : 'Too many failed attempts. Access locked for 15 minutes.'
    }, 401)
  }

  // Successful login — clear attempts, issue signed session cookie
  clearAttempts(ip)
  const token = await signToken(expectedUsername, tokenSecret)

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_DURATION_HOURS * 3600
  })

  // Expire any old cookie that was set with path='/admin' (pre-fix)
  // This forces browsers to discard the old restricted-path cookie
  deleteCookie(c, SESSION_COOKIE, { path: '/admin' })

  return c.json({ success: true })
})

// ── GET /admin/logout ─────────────────────────────────────────────────────────
adminAuth.get('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.redirect('/admin/login')
})
