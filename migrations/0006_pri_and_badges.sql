-- ParkPeer D1 Schema — Migration 006: PRI, Host Credentials, Driver Savings
-- ─────────────────────────────────────────────────────────────────────────────
-- Tables added:
--   pri_metrics       — Parking Reliability Index per listing
--   host_credentials  — Host identity/performance badges
--   driver_savings    — Per-driver savings vs. garage rates
-- Column added:
--   listings.pri_score — denormalized fast-path PRI for search/sort
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. PRI Metrics — one row per listing, recalculated hourly ────────────────
CREATE TABLE IF NOT EXISTS pri_metrics (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id              INTEGER NOT NULL UNIQUE REFERENCES listings(id) ON DELETE CASCADE,

  -- Component scores (0–100)
  cancellation_score      REAL NOT NULL DEFAULT 0,   -- 100 - (cancels/total*100)
  confirmation_score      REAL NOT NULL DEFAULT 0,   -- based on avg hours to confirm
  responsiveness_score    REAL NOT NULL DEFAULT 0,   -- based on avg message response mins
  consistency_score       REAL NOT NULL DEFAULT 0,   -- inverse of rating variance

  -- Raw inputs (for tooltip display)
  total_bookings          INTEGER NOT NULL DEFAULT 0,
  cancel_count            INTEGER NOT NULL DEFAULT 0,
  avg_confirm_hours       REAL    NOT NULL DEFAULT 0,
  avg_response_minutes    REAL    NOT NULL DEFAULT 0,
  rating_variance         REAL    NOT NULL DEFAULT 0,

  -- Final weighted score
  pri_score               REAL    NOT NULL DEFAULT 0,  -- 0–100

  -- Lifecycle
  calculated_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pri_listing  ON pri_metrics(listing_id);
CREATE INDEX IF NOT EXISTS idx_pri_score    ON pri_metrics(pri_score);

-- ── 2. Add pri_score to listings for JOIN-free search/sort ───────────────────
ALTER TABLE listings ADD COLUMN pri_score REAL DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_listings_pri ON listings(pri_score);

-- ── 3. Host Credentials — badges per host ────────────────────────────────────
CREATE TABLE IF NOT EXISTS host_credentials (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id             INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  -- Tier 1: Identity Verified (id_verified = 1 on users table)
  tier1_verified      INTEGER NOT NULL DEFAULT 0,
  tier1_verified_at   DATETIME,

  -- Tier 2: Secure Location (manually awarded by admin or checklist)
  tier2_secure        INTEGER NOT NULL DEFAULT 0,
  tier2_secure_at     DATETIME,

  -- Tier 3: High-Performance Host (PRI >= 95)
  tier3_performance   INTEGER NOT NULL DEFAULT 0,
  tier3_performance_at DATETIME,

  -- Tier 4: Founding Host (account before launch date)
  tier4_founding      INTEGER NOT NULL DEFAULT 0,
  tier4_founding_at   DATETIME,

  -- Lifecycle
  last_checked        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_creds_host       ON host_credentials(host_id);
CREATE INDEX IF NOT EXISTS idx_creds_verified   ON host_credentials(tier1_verified);
CREATE INDEX IF NOT EXISTS idx_creds_perf       ON host_credentials(tier3_performance);

-- ── 4. Driver Savings — cumulative savings vs. garage parking ────────────────
CREATE TABLE IF NOT EXISTS driver_savings (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id               INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  total_bookings          INTEGER NOT NULL DEFAULT 0,
  total_amount_paid       REAL    NOT NULL DEFAULT 0,
  total_garage_equivalent REAL    NOT NULL DEFAULT 0,  -- what garage would have cost
  total_savings           REAL    NOT NULL DEFAULT 0,  -- garage_equivalent - amount_paid

  -- Breakdown JSON: [{ city, zip, bookings, paid, garage_equiv, savings }]
  neighborhood_breakdown  TEXT    DEFAULT '[]',

  -- Milestone flags
  milestone_100           INTEGER NOT NULL DEFAULT 0,  -- $100 saved
  milestone_250           INTEGER NOT NULL DEFAULT 0,  -- $250 saved
  milestone_500           INTEGER NOT NULL DEFAULT 0,  -- $500 saved
  milestone_1000          INTEGER NOT NULL DEFAULT 0,  -- $1000 saved

  updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_savings_driver ON driver_savings(driver_id);
CREATE INDEX IF NOT EXISTS idx_savings_total  ON driver_savings(total_savings);

-- ── 5. Seed host_credentials for existing hosts from users.id_verified ───────
INSERT OR IGNORE INTO host_credentials (host_id, tier1_verified, tier1_verified_at)
SELECT id,
       CASE WHEN id_verified = 1 THEN 1 ELSE 0 END,
       CASE WHEN id_verified = 1 THEN created_at ELSE NULL END
FROM users
WHERE role IN ('HOST','BOTH','ADMIN');

-- ── 6. Seed driver_savings rows for existing drivers ─────────────────────────
INSERT OR IGNORE INTO driver_savings (driver_id, total_bookings, total_amount_paid,
                                       total_garage_equivalent, total_savings)
SELECT u.id,
       COUNT(b.id),
       COALESCE(SUM(b.total_charged), 0),
       -- avg garage rate $18/hr equivalent (conservative US estimate)
       COALESCE(SUM(b.duration_hours * 18.0), 0),
       COALESCE(SUM(b.duration_hours * 18.0) - SUM(b.total_charged), 0)
FROM users u
LEFT JOIN bookings b ON b.driver_id = u.id AND b.status = 'completed'
WHERE u.role IN ('DRIVER','BOTH')
GROUP BY u.id;
