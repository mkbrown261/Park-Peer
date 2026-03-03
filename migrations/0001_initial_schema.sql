-- ParkPeer D1 Schema — Migration 001
-- Full platform schema: users, listings, bookings, payments, reviews, disputes

-- ── Users ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT    UNIQUE NOT NULL,
  username       TEXT    UNIQUE,
  full_name      TEXT    NOT NULL,
  phone          TEXT,
  role           TEXT    NOT NULL DEFAULT 'DRIVER' CHECK (role IN ('DRIVER','HOST','BOTH','ADMIN')),
  avatar_url     TEXT,
  id_verified    INTEGER NOT NULL DEFAULT 0,  -- 0=false, 1=true
  stripe_customer_id TEXT,
  stripe_account_id  TEXT,                   -- for host payouts
  status         TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','pending','banned')),
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── Listings (parking spaces) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT    NOT NULL,
  description    TEXT,
  type           TEXT    NOT NULL DEFAULT 'driveway' CHECK (type IN ('driveway','garage','lot','street','covered')),
  address        TEXT    NOT NULL,
  city           TEXT    NOT NULL,
  state          TEXT    NOT NULL,
  zip            TEXT    NOT NULL,
  country        TEXT    NOT NULL DEFAULT 'US',
  lat            REAL,
  lng            REAL,
  rate_hourly    REAL,
  rate_daily     REAL,
  rate_monthly   REAL,
  max_vehicle_size TEXT DEFAULT 'sedan' CHECK (max_vehicle_size IN ('motorcycle','sedan','suv','truck','rv')),
  amenities      TEXT,  -- JSON array: ["covered","ev_charging","security_camera","gated"]
  photos         TEXT,  -- JSON array of R2 object keys
  available_from TIME,
  available_to   TIME,
  available_days TEXT,  -- JSON array: ["mon","tue","wed","thu","fri","sat","sun"]
  instant_book   INTEGER NOT NULL DEFAULT 1,
  status         TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','archived')),
  review_count   INTEGER NOT NULL DEFAULT 0,
  avg_rating     REAL    NOT NULL DEFAULT 0,
  total_bookings INTEGER NOT NULL DEFAULT 0,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── Bookings ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id          INTEGER NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  driver_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  host_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  start_time          DATETIME NOT NULL,
  end_time            DATETIME NOT NULL,
  duration_hours      REAL,
  vehicle_plate       TEXT,
  vehicle_description TEXT,
  subtotal            REAL NOT NULL DEFAULT 0,
  platform_fee        REAL NOT NULL DEFAULT 0,  -- 15% of subtotal
  host_payout         REAL NOT NULL DEFAULT 0,  -- subtotal - platform_fee
  total_charged       REAL NOT NULL DEFAULT 0,
  stripe_payment_intent_id TEXT,
  stripe_charge_id         TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','confirmed','active','completed','cancelled','refunded','disputed')),
  cancelled_by        TEXT CHECK (cancelled_by IN ('driver','host','admin',NULL)),
  cancel_reason       TEXT,
  refund_amount       REAL DEFAULT 0,
  notes               TEXT,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── Payments ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id          INTEGER NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  driver_id           INTEGER NOT NULL REFERENCES users(id),
  host_id             INTEGER NOT NULL REFERENCES users(id),
  amount              REAL NOT NULL,
  platform_fee        REAL NOT NULL,
  host_payout         REAL NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'usd',
  stripe_payment_intent_id TEXT,
  stripe_charge_id         TEXT,
  stripe_transfer_id       TEXT,   -- payout to host
  stripe_refund_id         TEXT,
  type                TEXT NOT NULL DEFAULT 'charge'
                      CHECK (type IN ('charge','refund','payout','adjustment')),
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','succeeded','failed','refunded','disputed')),
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── Reviews ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id  INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  reviewer_id INTEGER NOT NULL REFERENCES users(id),
  listing_id  INTEGER NOT NULL REFERENCES listings(id),
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  reply       TEXT,   -- host reply
  status      TEXT NOT NULL DEFAULT 'published'
              CHECK (status IN ('published','flagged','removed')),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── Disputes ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS disputes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id  INTEGER NOT NULL REFERENCES bookings(id),
  raised_by   INTEGER NOT NULL REFERENCES users(id),
  against     INTEGER NOT NULL REFERENCES users(id),
  reason      TEXT NOT NULL,
  description TEXT,
  evidence    TEXT,  -- JSON array of R2 object keys
  priority    TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status      TEXT NOT NULL DEFAULT 'open'
              CHECK (status IN ('open','in_progress','resolved','closed')),
  resolution  TEXT,
  resolved_by INTEGER REFERENCES users(id),
  resolved_at DATETIME,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── Availability blocks (blocked dates) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS availability_blocks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  start_time  DATETIME NOT NULL,
  end_time    DATETIME NOT NULL,
  reason      TEXT DEFAULT 'blocked',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_listings_host       ON listings(host_id);
CREATE INDEX IF NOT EXISTS idx_listings_city       ON listings(city);
CREATE INDEX IF NOT EXISTS idx_listings_status     ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_location   ON listings(lat, lng);
CREATE INDEX IF NOT EXISTS idx_bookings_listing    ON bookings(listing_id);
CREATE INDEX IF NOT EXISTS idx_bookings_driver     ON bookings(driver_id);
CREATE INDEX IF NOT EXISTS idx_bookings_host       ON bookings(host_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status     ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_payments_booking    ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_reviews_listing     ON reviews(listing_id);
CREATE INDEX IF NOT EXISTS idx_disputes_booking    ON disputes(booking_id);
CREATE INDEX IF NOT EXISTS idx_users_email         ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status        ON users(status);
