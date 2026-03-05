import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'
import { landingPage } from './routes/landing'
import { searchPage } from './routes/search'
import { listingPage } from './routes/listing'
import { bookingPage } from './routes/booking'
import { driverDashboard } from './routes/driver-dashboard'
import { hostDashboard } from './routes/host-dashboard'
import { authPages } from './routes/auth'
import { adminPanel } from './routes/admin'
import { adminAuth } from './routes/admin-auth'
import { apiRoutes } from './routes/api'
import { legalPages } from './routes/legal'
import agreementRoutes from './routes/agreements'
import { securityHeaders } from './middleware/security'

const app = new Hono()

// ── Global security headers on EVERY response ─────────────────────────────
// HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
// Permissions-Policy, X-XSS-Protection, COOP, server fingerprint removal.
app.use('/*', securityHeaders())

// ── CORS — only allow same-origin API calls in production ─────────────────
// Stripe webhooks come from stripe.com; we verify the signature server-side.
app.use('/api/*', cors({
  origin: (origin) => {
    // Allow same-origin, Cloudflare Pages preview URLs, and Stripe webhooks
    if (!origin) return origin                          // server-side calls
    if (origin.endsWith('.parkpeer.pages.dev')) return origin
    if (origin === 'https://parkpeer.pages.dev') return origin
    if (origin === 'https://js.stripe.com') return origin
    // Block everything else
    return null
  },
  allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
  maxAge: 600,
}))

app.use('/static/*', serveStatic({ root: './' }))

// ── Page Routes ───────────────────────────────────────────────────────────
app.route('/', landingPage)
app.route('/search', searchPage)
app.route('/listing', listingPage)
app.route('/booking', bookingPage)
app.route('/dashboard', driverDashboard)
app.route('/host', hostDashboard)
app.route('/auth', authPages)
app.route('/legal', legalPages)
app.route('/api/agreements', agreementRoutes)
// Admin auth (login/logout) MUST be mounted BEFORE the protected admin panel
app.route('/admin', adminAuth)
app.route('/admin', adminPanel)
app.route('/api', apiRoutes)

export default app
