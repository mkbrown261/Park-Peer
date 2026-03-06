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
| Database | Cloudflare D1 (✅ Production — 33 tables, **14 migrations** applied, `host_availability_schedule` added) |

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
- [x] **Cloudflare D1 persistence** — 33+ tables, 14 migrations, full booking/payment lifecycle in D1
- [x] **Production-grade booking pipeline** — holds-first flow, atomic D1 batch, recovery logging, integrity audit
- [x] **Full time-based reservations** — 15-min time grid, 14-day date strip, multi-day bookings, in-range highlighting, quick duration chips
- [x] **Host availability schedule** — Mon–Sun open/close hours, closed days; server-enforced on validate-slot + holds
- [x] **15-min increment pricing** — aligned across validate-slot, /api/holds, create-intent; minimum 15-min booking
- [x] **Mobile-first booking UI** — scroll-snap date strip, large touch targets, auto-scroll to first available slot
- [x] **Smart error messages** — SLOT_BOOKED / SLOT_HELD / HOST_CLOSED_DAY / OUTSIDE_HOST_HOURS / LISTING_UNAVAILABLE / TOO_SHORT
- [x] **Hold countdown timer** — live 10-min countdown in payment panel; auto-invalidates Stripe on expiry
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

## ⏱️ Recent Fixes (2026-03-06) — Full Time-Based Reservation System v2

### Booking UI Overhaul
| Feature | Detail |
|---|---|
| **14-day scrollable date strip** | Scroll-snap, auto-selects first open day, host-closed days greyed out |
| **15-minute time grid** | 96 slots/day (00:00–23:45), colour-coded: available / booked / held / closed / past |
| **In-range highlighting** | All 15-min slots between start and end glow indigo when selecting end time |
| **Quick duration chips** | 30min / 1h / 2h / 3h / 4h / 8h — only shown if end slot is actually available |
| **Multi-day support** | If end time ≤ start time, end-date strip auto-appears; user picks next-day (or +N days) |
| **Mobile UX** | Min 36–42px touch targets, scroll-snap date strip, auto-scroll to first available slot on open |
| **Hold countdown** | Live `M:SS` pill in payment panel; turns red and invalidates Stripe on expiry |
| **Success modal** | Shows `PP-YYYY-XXXX` booking reference, full date range, start–end times |

### Backend / Pricing Fixes
| Fix | Detail |
|---|---|
| **15-min increment pricing** | `Math.ceil(rawMins / 15) * 15` — all 3 endpoints aligned (validate-slot, /holds, create-intent) |
| **2h example** | 2h → `$24.00 subtotal + $3.60 fee = $27.60 total` (verified in tests) |
| **15-min minimum** | `TOO_SHORT` code returned if < 15 min; minimum bookable unit = `0.25h = $3.00` |
| **Host schedule enforcement** | `OUTSIDE_HOST_HOURS` / `HOST_CLOSED_DAY` returned by validate-slot AND /holds |
| **Overlap detection** | `start1 < end2 && start2 < end1` — checked against confirmed/active bookings AND active holds |

### Migration 0014 — `host_availability_schedule`
```sql
CREATE TABLE host_availability_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
  is_available INTEGER NOT NULL DEFAULT 1,
  open_time TEXT NOT NULL DEFAULT '07:00',
  close_time TEXT NOT NULL DEFAULT '22:00',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(listing_id, day_of_week)
);
```
Default seeded: all 7 days, 07:00–22:00 open for existing listings.

### API Endpoints for Time-Based Reservations
| Method | Route | Description |
|---|---|---|
| GET | `/api/listings/:id/time-slots?date=YYYY-MM-DD` | 96 × 15-min slots with status (available/booked/held/closed/past) |
| POST | `/api/listings/:id/validate-slot` | Server-side check before hold; returns pricing if valid |
| GET | `/api/listings/:id/availability-schedule` | Host's 7-day weekly schedule |
| PUT | `/api/listings/:id/availability-schedule` | Host updates their schedule (authenticated) |
| POST | `/api/holds` | Acquire 10-min slot hold before Stripe PI |
| GET | `/api/holds/:token` | Poll hold status (valid/expired/converted) |

### Verification Test Results
```
✓ 96 slots/day (15-min grid, 0:00–23:45)
✓ 15-min pricing: 6 duration cases (0.25h–2.5h) all match
✓ Host hours: before-open → OUTSIDE_HOST_HOURS, after-close → OUTSIDE_HOST_HOURS  
✓ TOO_SHORT: < 15 min rejected with correct code
✓ LISTING_UNAVAILABLE: nonexistent listing rejected
✓ Rate limiting: 429 fires on burst > 20/min
✓ Admin integrity requires auth (HTTP 401)
✓ Webhook rejects missing signature
✓ 7-day host schedule returns correctly
✓ 23/23 UI elements present in booking page
```

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

## 📱 Contact Verification System (v2.1)

### Overview
Full email + phone OTP verification built for the checkout flow. Supports guest checkout (no account login required) using session-scoped verification tokens.

### API Endpoints

| Method | Route | Description |
|---|---|---|
| POST | `/api/verify/phone/send` | Send 6-digit OTP via Twilio SMS |
| POST | `/api/verify/phone/confirm` | Verify phone OTP — marks verified_contacts row |
| POST | `/api/verify/email/send` | Send 6-digit OTP via Resend email |
| POST | `/api/verify/email/confirm` | Verify email OTP — marks verified_contacts row |
| GET  | `/api/verify/status` | Check session verification state |

### Checkout UI Features
- **Predictive email input** — real-time format hints, progressive error messages, disposable domain rejection
- **Auto-format phone** — US 10-digit auto-formatted to `(555) 123-4567`; international `+` numbers accepted
- **OTP modal** — 6 individual digit boxes with keyboard nav, paste support, wrong-answer shake animation
- **Verified badges** — green checkmarks appear on both fields after successful OTP
- **Resend timer** — 60-second cooldown before resend is allowed
- **Hold token reuse** — `session_token` (= `checkoutToken`) is the same token used for slot holds, so verification and hold are tied to the same checkout session

### Post-Payment Messaging
| Trigger | Channel | Contents |
|---|---|---|
| Payment success | Email | Booking confirmation + QR code image (200×200 PNG) + check-in link |
| Payment success | Email | Separate payment receipt with last-4 card digits |
| Payment success | SMS | Booking summary + QR check-in URL (`/checkin?t=TOKEN&b=BOOKING_ID`) |
| Both | — | Only sent to **verified** contacts; unverified contacts fall back to raw body values |

### Security
- OTPs hashed with PBKDF2-SHA-256 (10,000 iterations + random salt)
- Constant-time comparison to prevent timing attacks
- Verified contacts expire 2 hours after verification
- Single-use: `used = 1` after `payments/confirm` reads them (replay prevention)
- Rate limits: 3 OTPs per contact per 10 minutes; 5 per IP per minute; 5 confirm attempts per session per 15 minutes

### DB Tables Added (migration 0017)
- `email_otp_codes` — stores hashed email OTP codes
- `otp_codes` extended — adds `session_token`, `type`, `ip_address`, `attempts` columns
- `verified_contacts` — session-scoped verification state (email/phone per session)

### Last Deployed
2026-03-06 · https://1d9fc520.parkpeer.pages.dev
