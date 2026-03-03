import { Hono } from 'hono'

export const apiRoutes = new Hono()

// Health check
apiRoutes.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'ParkPeer API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: '99.98%'
  })
})

// Mock listings API
apiRoutes.get('/listings', (c) => {
  const { q, type, min_price, max_price, lat, lon, limit = '20', offset = '0' } = c.req.query()
  
  const listings = [
    { id: 1, title: 'Secure Covered Garage', type: 'garage', address: '120 S Michigan Ave, Chicago', lat: 41.8819, lon: -87.6278, price_hourly: 12, price_daily: 55, price_monthly: 320, rating: 4.9, review_count: 142, instant_book: true, features: ['cctv', 'covered', 'ev_charging', 'gated'], max_vehicle: 'suv', available: true },
    { id: 2, title: 'Private Driveway — Wrigley', type: 'driveway', address: '3614 N Clark St, Chicago', lat: 41.9484, lon: -87.6553, price_hourly: 8, price_daily: 35, price_monthly: 180, rating: 4.8, review_count: 89, instant_book: false, features: ['gated', 'lighting'], max_vehicle: 'sedan', available: true },
    { id: 3, title: "O'Hare Airport Long-Term", type: 'lot', address: 'Near ORD Terminal 1, Chicago', lat: 41.9742, lon: -87.9073, price_hourly: 14, price_daily: 45, price_monthly: 280, rating: 4.7, review_count: 311, instant_book: true, features: ['shuttle', 'cctv', '24hr'], max_vehicle: 'suv', available: true },
    { id: 4, title: 'Loop District Open Lot', type: 'lot', address: '55 W Monroe St, Chicago', lat: 41.8806, lon: -87.6298, price_hourly: 6, price_daily: 28, price_monthly: 150, rating: 4.5, review_count: 67, instant_book: true, features: ['lighting'], max_vehicle: 'compact', available: true },
    { id: 5, title: 'Navy Pier Gated Spot', type: 'covered', address: '600 E Grand Ave, Chicago', lat: 41.8917, lon: -87.6054, price_hourly: 10, price_daily: 42, price_monthly: 240, rating: 4.9, review_count: 203, instant_book: false, features: ['gated', 'covered', 'lighting'], max_vehicle: 'suv', available: true },
  ]
  
  let filtered = listings
  if (type && type !== 'all') filtered = filtered.filter(l => l.type === type)
  if (min_price) filtered = filtered.filter(l => l.price_hourly >= parseInt(min_price))
  if (max_price) filtered = filtered.filter(l => l.price_hourly <= parseInt(max_price))
  if (q) filtered = filtered.filter(l => l.title.toLowerCase().includes(q.toLowerCase()) || l.address.toLowerCase().includes(q.toLowerCase()))
  
  const start = parseInt(offset)
  const end = start + parseInt(limit)
  
  return c.json({
    data: filtered.slice(start, end),
    total: filtered.length,
    limit: parseInt(limit),
    offset: start,
    has_more: end < filtered.length
  })
})

// Get single listing
apiRoutes.get('/listings/:id', (c) => {
  const id = parseInt(c.req.param('id'))
  return c.json({
    id,
    title: 'Secure Covered Garage',
    type: 'garage',
    address: '120 S Michigan Ave, Chicago, IL 60603',
    lat: 41.8819,
    lon: -87.6278,
    price_hourly: 12,
    price_daily: 55,
    price_monthly: 320,
    rating: 4.9,
    review_count: 142,
    instant_book: true,
    host: { id: 'h1', name: 'Jennifer K.', rating: 4.95, response_time: '< 1 hour', joined: '2023-01-15' },
    features: ['cctv', 'covered', 'ev_charging', 'gated', '24hr', 'lighting'],
    max_vehicle: 'suv',
    cancellation_policy: 'free_1hr',
    description: 'Premium covered garage space in the heart of downtown Chicago.',
    photos: [],
    available: true
  })
})

// Create booking
apiRoutes.post('/bookings', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const { listing_id, start_datetime, end_datetime, vehicle_plate, vehicle_make } = body as any
  
  if (!listing_id || !start_datetime || !end_datetime) {
    return c.json({ error: 'Missing required fields: listing_id, start_datetime, end_datetime' }, 400)
  }
  
  const start = new Date(start_datetime)
  const end = new Date(end_datetime)
  const hours = Math.max(1, Math.round((end.getTime() - start.getTime()) / 3600000))
  const rate = 12
  const base = rate * hours
  const fee = Math.round(base * 0.15 * 100) / 100
  const total = base + fee
  
  const bookingId = 'PP-' + new Date().getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000)
  const qrCode = btoa(bookingId + '|' + listing_id + '|' + start_datetime)
  
  return c.json({
    id: bookingId,
    listing_id,
    start_datetime,
    end_datetime,
    hours,
    vehicle_plate: vehicle_plate || null,
    vehicle_make: vehicle_make || null,
    pricing: {
      base,
      service_fee: fee,
      taxes: Math.round(base * 0.06 * 100) / 100,
      total: Math.round((base + fee + base * 0.06) * 100) / 100
    },
    status: 'confirmed',
    payment_status: 'paid',
    qr_code: qrCode,
    created_at: new Date().toISOString()
  }, 201)
})

// Get user bookings
apiRoutes.get('/bookings', (c) => {
  const { user_id, status, limit = '10' } = c.req.query()
  return c.json({
    data: [
      { id: 'PP-2026-8741', listing_title: 'Secure Covered Garage', start_datetime: new Date().toISOString(), end_datetime: new Date(Date.now() + 4*3600000).toISOString(), status: 'active', total: 58.08 },
      { id: 'PP-2026-8740', listing_title: 'Wrigley Driveway', start_datetime: new Date(Date.now() - 86400000).toISOString(), end_datetime: new Date(Date.now() - 82800000).toISOString(), status: 'completed', total: 32 },
    ],
    total: 2
  })
})

// Reviews
apiRoutes.get('/reviews/listing/:id', (c) => {
  const listing_id = c.req.param('id')
  return c.json({
    data: [
      { id: 'r1', reviewer: 'David L.', rating: 5, comment: 'Exactly as described. Clean, safe, easy to find.', created_at: '2026-02-28T10:00:00Z' },
      { id: 'r2', reviewer: 'Priya S.', rating: 5, comment: 'Best parking in the area for the price.', created_at: '2026-02-20T14:00:00Z' },
      { id: 'r3', reviewer: 'Carlos M.', rating: 4, comment: 'Great spot, easy access.', created_at: '2026-02-15T09:00:00Z' },
    ],
    average_rating: 4.9,
    total: 3,
    breakdown: { 5: 72, 4: 45, 3: 18, 2: 5, 1: 2 }
  })
})

// Earnings estimate
apiRoutes.get('/estimate-earnings', (c) => {
  const { type = 'driveway', hours_per_day = '8', days_per_week = '5' } = c.req.query()
  const rates: Record<string, number> = { driveway: 6, garage: 12, lot: 8, airport: 14 }
  const rate = rates[type] || 6
  const h = parseInt(hours_per_day)
  const d = parseInt(days_per_week)
  const occupancy = 0.65
  const platform_fee = 0.15
  const weekly = rate * h * d * occupancy * (1 - platform_fee)
  const monthly = weekly * 4.33
  return c.json({
    type,
    rate_per_hour: rate,
    hours_per_day: h,
    days_per_week: d,
    weekly_estimate: Math.round(weekly),
    monthly_estimate: Math.round(monthly),
    yearly_estimate: Math.round(monthly * 12)
  })
})

// Admin stats
apiRoutes.get('/admin/stats', (c) => {
  return c.json({
    revenue_mtd: 84320,
    bookings_mtd: 2847,
    active_users: 12441,
    platform_fees_mtd: 14256,
    active_listings: 3280,
    pending_listings: 5,
    open_disputes: 3,
    fraud_alerts: 1,
    cities: 6,
    uptime: 99.98
  })
})

// Check availability
apiRoutes.get('/listings/:id/availability', (c) => {
  const id = c.req.param('id')
  const { start_date, end_date } = c.req.query()
  
  const unavailable_dates = ['2026-03-07', '2026-03-08', '2026-03-14', '2026-03-21', '2026-03-22']
  
  return c.json({
    listing_id: id,
    available_slots: [
      { date: '2026-03-10', start: '08:00', end: '18:00', available: true },
      { date: '2026-03-11', start: '06:00', end: '22:00', available: true },
      { date: '2026-03-12', start: '09:00', end: '17:00', available: true },
    ],
    unavailable_dates
  })
})
