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
import { apiRoutes } from './routes/api'

const app = new Hono()

app.use('/api/*', cors())
app.use('/static/*', serveStatic({ root: './' }))

// Page Routes
app.route('/', landingPage)
app.route('/search', searchPage)
app.route('/listing', listingPage)
app.route('/booking', bookingPage)
app.route('/dashboard', driverDashboard)
app.route('/host', hostDashboard)
app.route('/auth', authPages)
app.route('/admin', adminPanel)
app.route('/api', apiRoutes)

export default app
