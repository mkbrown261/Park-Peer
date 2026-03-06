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
| Payments | Stripe (✅ Production-wired — live keys, Stripe.js v3 Payment Element, idempotency) |
| Database | Cloudflare D1 (✅ Production — 33 tables, 13 migrations applied) |

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
- [x] **Stripe payment integration** — live keys, Stripe.js v3 Payment Element, idempotency keys, ghost-booking prevention
- [x] **Cloudflare D1 persistence** — 33 tables, 13 migrations, full booking/payment lifecycle in D1
- [x] **Production-grade booking pipeline** — holds-first flow, atomic D1 batch, recovery logging, integrity audit
- [x] Driver dashboard with live countdown timer, booking history, saved spots
- [x] Host dashboard with listing management, booking approvals, revenue chart, calendar
- [x] Sign Up / Login with role selection, password strength meter, social OAuth UI
- [x] Admin panel with fraud alerts, listing moderation, user management, system health
- [x] **Admin integrity endpoint** — ghost booking detection, orphan payment audit, stale hold cleanup
- [x] RESTful API with full CRUD + Stripe + notifications
- [x] Mobile-responsive across all pages
- [x] Dark mode design system with Electric Indigo + Neon Lime palette

## 🔜 Phase 2 Roadmap
- [ ] Google Maps / Mapbox real map (Mapbox already integrated, real listings needed)
- [ ] SMS/Email notifications (Twilio + Resend secrets already set in Cloudflare)
- [ ] Surge pricing engine (events)
- [ ] QR code generation for check-in
- [ ] Superhost achievement system
- [ ] AI pricing suggestions

---
*Built with Hono + Cloudflare Pages — Deploy to the edge globally in seconds.*

## 🔧 Recent Fixes (2026-03-06) — Stripe + D1 Production Wiring

### Stripe Payment Integration (✅ Complete)
- **Live keys active** — `pk_live_...` / `sk_live_...` / `whsec_...` all set in Cloudflare Pages secrets
- **Checkout page** — full Stripe.js v3 Payment Element replacing static card HTML
- **3-step flow** (holds-first):
  1. `POST /api/holds` → atomic slot lock (10-min TTL, blocks other users)
  2. `POST /api/payments/create-intent` → creates Stripe PI tied to hold; **Stripe Idempotency-Key** = `checkout_token` prevents duplicate PIs on retry
  3. `stripe.confirmPayment()` in browser → on success → `POST /api/payments/confirm`
- **`/api/payments/confirm`** — fully wired to D1:
  - Looks up booking by `stripe_payment_intent_id` (or fallback `booking_id`)
  - `UPDATE bookings SET status='confirmed'`, stamps `stripe_charge_id`
  - `INSERT INTO payments` row (idempotent — skips if PI already recorded)
  - Sends confirmation email + SMS; fires in-app notification async
- **Stripe webhook** (`/api/webhooks/stripe`) — handles `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`
- **Webhook registered** at https://parkpeer.pages.dev/api/webhooks/stripe

### Ghost Booking Prevention (✅ Complete)
| Mechanism | Description |
|---|---|
| **reservation_holds** | 10-min atomic slot lock; overlap query excludes caller's own session |
| **booking_idempotency** | Maps `checkout_token → booking_id`; prevents double-INSERTs on retry |
| **Stripe idempotency key** | Same `checkout_token` passed as `Idempotency-Key` → same PI returned |
| **D1 atomic batch** | Booking + hold-convert + payment INSERT in one `db.batch()` call |
| **payment_recovery_log** | PI success + D1 batch failure → logged; client gets `recovery_pending` status |
| **Admin integrity scan** | `GET /api/admin/integrity` detects orphan payments, unconfirmed bookings, stale holds |

### Cloudflare D1 Persistence (✅ Complete)
- **33 tables** fully applied in production (database_id: `119f9fd4-...`)
- **13 migrations** all confirmed applied remotely
- **5 new tables** (migrations 0012–0013): `reservation_holds`, `payment_recovery_log`, `booking_idempotency`, `orphan_payments`, `integrity_log`
- **Booking lifecycle**: `pending` → `confirmed` → `active` → `completed` / `cancelled` / `refunded` all tracked in D1

### Security & Rate Limiting (✅ Complete)
- `/api/holds` — 20 req/min per IP
- `/api/payments/create-intent` — 10 req/min per IP
- `/api/admin/integrity` — requires admin session
- Structured JSON logging (`logEvent`) on all hold/payment/booking events for `wrangler tail` monitoring
- SQL alias bug fixed in payments idempotency check (`payments.booking_id` not `p.booking_id`)

### Map / UI
- **Popup no longer blocks the walking route pill** — popup offset increased to 72px when a walk route is active; the `#route-info-pill` drops to `1.5rem` from the bottom while the popup is open (`pill-popup-open` class), giving the popup full clearance above the route line
- **Smart auto-pan** — measures actual pin screen position vs pill top and pans by exactly the gap needed (not a fixed constant), so the popup always stays above the pill with ≥16px breathing room
- **Viewport restored on close** — `map.easeTo({offset:[0,0]})` on popup close undoes the temporary pan

### Security
- **XSS: `loadTopHosts`** — all host name / count / rating / id fields now escaped via `escHtml()` before `innerHTML`
- **XSS: Admin audit log table** — all DB-sourced fields (email, action, reason, IP address) escaped via `escapeHtml()` before render
- **XSS: Admin refund log table** — all fields escaped
- **XSS: Admin user detail panel** — `full_name`, `email`, `role`, `status` escaped; `e.message` no longer shown in error HTML
- **XSS: Admin blocker reasons list** — escaped before `innerHTML`
- **`escapeHtml()` fixed** — was missing `&`, `<`, `>` escaping; now full 5-char escape
- **Error detail leak** — `detail: e.message` stripped from ALL 500 responses in `api.ts` (9 routes) and all `admin-api.ts` routes
- **PII in logs** — geocode query strings replaced with `query_len`; geocode coordinates removed from warning log; listing POST body replaced with title-only log; Twilio SMS Body content redacted

### Performance
- **Migration 0011** — 6 new compound indexes: `(listing_id, status)` booking guard, `stripe_payment_intent_id` on payments/bookings, `(status, type)` listings, availability blocks, notifications composite; applied to both local and production D1

### Code Quality
- Removed 2x `console.debug` statements left from walk-route debugging
- Cleaned debug comment on `el._lng` coordinate freeze
