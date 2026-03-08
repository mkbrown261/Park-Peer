-- ════════════════════════════════════════════════════════════════════════════
-- Migration 0021 — Arrival Mode · Overstay Protection · ParkPeer for Business
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Arrival Mode: extend bookings table ───────────────────────────────────
ALTER TABLE bookings ADD COLUMN arrival_started_at   DATETIME DEFAULT NULL;
ALTER TABLE bookings ADD COLUMN arrival_confirmed_at DATETIME DEFAULT NULL;
ALTER TABLE bookings ADD COLUMN overstay_flagged_at  DATETIME DEFAULT NULL;
ALTER TABLE bookings ADD COLUMN overstay_resolved_at DATETIME DEFAULT NULL;
ALTER TABLE bookings ADD COLUMN overstay_resolved_by TEXT     DEFAULT NULL;

-- Update status CHECK to include overstayed
-- SQLite cannot ALTER CHECK constraints; we document overstayed as a valid value
-- and enforce it in application code. The existing check allows any text that
-- passes the original constraint; we rely on the app-level guard.

-- ── 2. Timer notifications tracking ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS booking_timer_alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id  INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  alert_type  TEXT    NOT NULL CHECK (alert_type IN ('15min','5min','expired','overstay')),
  sent_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(booking_id, alert_type)
);

CREATE INDEX IF NOT EXISTS idx_timer_alerts_booking ON booking_timer_alerts(booking_id);

-- ── 3. Business Accounts ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_accounts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_name        TEXT    NOT NULL,
  ein                 TEXT    NOT NULL,
  business_email      TEXT    NOT NULL,
  business_phone      TEXT,
  business_address    TEXT,
  business_city       TEXT,
  business_state      TEXT,
  business_zip        TEXT,
  website             TEXT,
  industry            TEXT,
  verification_status TEXT    NOT NULL DEFAULT 'pending'
                      CHECK (verification_status IN ('pending','verified','rejected','suspended')),
  verified_at         DATETIME,
  stripe_account_id   TEXT,
  monthly_budget_cents INTEGER DEFAULT 0,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_business_owner   ON business_accounts(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_business_status  ON business_accounts(verification_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_ein ON business_accounts(ein);

-- ── 4. Business Locations ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_locations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  address     TEXT    NOT NULL,
  city        TEXT    NOT NULL,
  state       TEXT    NOT NULL,
  zip         TEXT    NOT NULL,
  lat         REAL,
  lng         REAL,
  total_spots INTEGER DEFAULT 0,
  active      INTEGER DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bizloc_business ON business_locations(business_id);

-- ── 5. Business Parking Spots ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_spots (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id      INTEGER NOT NULL REFERENCES business_locations(id) ON DELETE CASCADE,
  business_id      INTEGER NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
  listing_id       INTEGER REFERENCES listings(id) ON DELETE SET NULL,
  spot_number      TEXT    NOT NULL,
  spot_type        TEXT    NOT NULL DEFAULT 'standard'
                   CHECK (spot_type IN ('standard','compact','oversized','ev','accessible','reserved')),
  price_hourly     REAL,
  price_daily      REAL,
  price_monthly    REAL,
  availability_rules TEXT, -- JSON: {"days":[1..7],"open":"07:00","close":"22:00"}
  status           TEXT    NOT NULL DEFAULT 'available'
                   CHECK (status IN ('available','occupied','maintenance','reserved')),
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bizspot_location ON business_spots(location_id);
CREATE INDEX IF NOT EXISTS idx_bizspot_business ON business_spots(business_id);
CREATE INDEX IF NOT EXISTS idx_bizspot_listing  ON business_spots(listing_id);

-- ── 6. Business User Roles ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT    NOT NULL DEFAULT 'staff'
              CHECK (role IN ('admin','manager','staff')),
  invited_by  INTEGER REFERENCES users(id),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_bizuser_business ON business_users(business_id);
CREATE INDEX IF NOT EXISTS idx_bizuser_user     ON business_users(user_id);

-- ── 7. Business Analytics Snapshots ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_analytics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id   INTEGER NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
  snapshot_date TEXT    NOT NULL,  -- YYYY-MM-DD
  total_revenue_cents INTEGER DEFAULT 0,
  total_bookings      INTEGER DEFAULT 0,
  occupied_hours      REAL    DEFAULT 0,
  available_hours     REAL    DEFAULT 0,
  utilization_rate    REAL    DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_bizanalytics_biz  ON business_analytics(business_id);
CREATE INDEX IF NOT EXISTS idx_bizanalytics_date ON business_analytics(snapshot_date);

-- ── 8. Performance indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bookings_status_end   ON bookings(status, end_time);
CREATE INDEX IF NOT EXISTS idx_bookings_arrival      ON bookings(arrival_started_at);
CREATE INDEX IF NOT EXISTS idx_bookings_overstay     ON bookings(overstay_flagged_at);
