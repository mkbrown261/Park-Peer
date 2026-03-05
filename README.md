# ParkPeer — P2P Parking Marketplace

> **"Your Space. Their Spot."** — The Airbnb for parking driveways, garages, and lots.

## 🌐 Live URL
**App:** https://parkpeer.pages.dev
**Admin Panel:** https://parkpeer.pages.dev/admin/login

## 🎯 Project Overview
- **Goal:** Peer-to-peer parking marketplace where users list private parking and drivers book affordable spots
- **Target Markets:** Urban downtown areas, airports, stadiums, universities
- **MVP City:** Chicago, IL

## 🎨 Branding
| Token | Value |
|---|---|
| Primary | Electric Indigo `#5B2EFF` |
| Accent | Neon Lime `#C6FF00` |
| Dark Background | Charcoal Black `#121212` |
| Font | Inter |

## 📄 Pages & Routes

| Route | Description |
|---|---|
| `/` | Landing page — hero, how-it-works, calculator, testimonials |
| `/search` | Search page with split map/listings panel |
| `/listing/:id` | Listing detail with photos, reviews, booking widget |
| `/booking/:id` | Checkout flow with Stripe-ready payment UI |
| `/dashboard` | Driver dashboard — active bookings, history, favorites |
| `/host` | Host dashboard — listings, booking requests, earnings |
| `/auth/login` | Login page with social auth options |
| `/auth/signup` | Signup with role selection (Driver / Host) |
| `/admin` | Admin panel — users, listings, bookings, disputes |

## 🔌 API Endpoints

| Method | Route | Description |
|---|---|---|
| GET | `/api/health` | System health check |
| GET | `/api/listings` | Search listings (q, type, min/max price) |
| GET | `/api/listings/:id` | Get single listing detail |
| POST | `/api/bookings` | Create a booking |
| GET | `/api/bookings` | Get user bookings |
| GET | `/api/reviews/listing/:id` | Get listing reviews |
| GET | `/api/estimate-earnings` | Calculate host earnings |
| GET | `/api/listings/:id/availability` | Check availability |
| GET | `/api/admin/stats` | Admin platform statistics |



## 🛡️ Admin User Management System

### Admin Control Panel (`/admin/user-control`)
Full user lifecycle management with compliance, refunds, and auditing.

#### Features Implemented
| Feature | Status |
|---|---|
| Paginated user list with search/filter | ✅ |
| Suspend / Unsuspend accounts | ✅ |
| Delete account with PII scrub (GDPR) | ✅ |
| Blocker enforcement (disputes, active bookings) | ✅ |
| Force-override with admin password re-entry | ✅ |
| Auto-calculate refundable balance | ✅ |
| Stripe refund for driver credits | ✅ |
| Manual refund flag for host earnings | ✅ |
| AdminAuditLog (immutable) | ✅ |
| AdminRefundLog (all money movements) | ✅ |
| User deletions GDPR compliance record | ✅ |
| Sidebar user detail panel | ✅ |
| Real-time toast notifications | ✅ |
| Audit Log viewer (`/admin/audit-log`) | ✅ |
| Refund Log viewer | ✅ |

#### Admin API Endpoints
| Method | Route | Description |
|---|---|---|
| GET | `/api/admin/stats` | Dashboard stats |
| GET | `/api/admin/users` | Paginated user list |
| GET | `/api/admin/users/:id` | User detail + balance + blockers |
| POST | `/api/admin/users/:id/delete` | Full deletion pipeline |
| POST | `/api/admin/users/:id/suspend` | Suspend or unsuspend |
| POST | `/api/admin/users/:id/refund` | Standalone manual refund |
| POST | `/api/admin/verify-password` | Admin password re-confirm |
| GET | `/api/admin/audit-log` | Paginated audit log |
| GET | `/api/admin/refund-log` | Paginated refund log |

#### Deletion Pipeline Steps
1. Verify admin identity via session cookie
2. Check blockers (open disputes, active bookings) — block or force-override
3. Cancel all future bookings (`cancel_reason = 'Account deleted by admin'`)
4. Deactivate all listings (→ `archived`)
5. Calculate refundable balance (driver future credits + host unpaid earnings)
6. Issue Stripe refunds via Payment Intent API (auto-fallback to `manual_required`)
7. Write to `admin_audit_log` (immutable, with full details JSON)
8. Write to `admin_refund_log` (per-refund record)
9. Write to `user_deletions` (GDPR compliance, email SHA-256 hashed)
10. Soft-delete: scrub PII (email → `deleted_{id}@deleted.parkpeer`, name → `[Deleted User]`)

#### Database Tables
| Table | Purpose |
|---|---|
| `admin_audit_log` | Immutable log of every admin action |
| `admin_refund_log` | Every refund/money-movement record |
| `user_deletions` | GDPR compliance records (email hashed) |

## 🧠 Data Models

### Users
`id, first_name, last_name, email, phone, role (HOST/DRIVER/ADMIN), profile_photo, id_verified, rating_avg`

### Listings
`id, host_id, title, description, address, lat/lon, hourly_rate, daily_rate, monthly_rate, type, max_vehicle_size, security_features, instant_book, status`

### Bookings
`id, listing_id, driver_id, start_datetime, end_datetime, total_price, service_fee, payment_status, booking_status, qr_checkin_code`

### Payments
`id, booking_id, stripe_payment_intent_id, amount, platform_fee (15-20%), host_payout_amount, payout_status`

### Reviews
`id, booking_id, reviewer_id, reviewee_id, rating (1-5), comment`

## 💰 Monetization
- **15% service fee** on every booking
- Featured listing upgrades
- Subscription commuter plans (Phase 2)
- Surge pricing for events (Phase 2)

## 🏗 Tech Stack
| Layer | Technology |
|---|---|
| Framework | Hono 4.x (TypeScript) |
| Runtime | Cloudflare Workers / Pages |
| Build | Vite + @hono/vite-build |
| Process Manager | PM2 |
| Styling | Tailwind CSS (CDN) |
| Icons | Font Awesome 6 |
| Payments | Stripe (ready for integration) |
| Database | Cloudflare D1 (ready to add) |

## 🚀 Local Development
```bash
npm install
npm run build
pm2 start ecosystem.config.cjs
```

## 🌍 Deployment to Cloudflare Pages
```bash
npm run build
npx wrangler pages deploy dist --project-name parkpeer
```

## ✅ Features Implemented (MVP)
- [x] Landing page with floating map pins, earnings calculator, city coverage
- [x] Full-featured search with filter sidebar + visual map
- [x] Listing detail page with gallery, reviews, availability calendar, booking widget
- [x] Secure checkout flow with payment methods, QR code confirmation
- [x] Driver dashboard with live countdown timer, booking history, saved spots
- [x] Host dashboard with listing management, booking approvals, revenue chart, calendar
- [x] Sign Up / Login with role selection, password strength meter, social OAuth UI
- [x] Admin panel with fraud alerts, listing moderation, user management, system health
- [x] RESTful API with 9 endpoints
- [x] Mobile-responsive across all pages
- [x] Dark mode design system with Electric Indigo + Neon Lime palette

## 🔜 Phase 2 Roadmap
- [ ] Stripe payment integration
- [ ] Cloudflare D1 database persistence
- [ ] Google Maps / Mapbox real map
- [ ] SMS/Email notifications (Twilio + SendGrid)
- [ ] Surge pricing engine (events)
- [ ] QR code generation
- [ ] Superhost achievement system
- [ ] AI pricing suggestions

---
*Built with Hono + Cloudflare Pages — Deploy to the edge globally in seconds.*
