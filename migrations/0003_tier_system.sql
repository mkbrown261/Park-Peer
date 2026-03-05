-- ParkPeer D1 Schema — Migration 003: Tier & Reward System
-- ─────────────────────────────────────────────────────────────────────────────
-- DRIVER TIERS:  Nomad → Cruiser → Vaulted → Apex
-- HOST TIERS:    Steward → Curator → Prestige → Icon
-- Mechanics:     Rolling-12-month window + lifetime floor protection
-- Recalculation: Event-triggered (on booking complete) + nightly scheduled job
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. user_tier_state — live tier record per user ──────────────────────────
-- One row per user. Created on first booking completion or host listing approval.
CREATE TABLE IF NOT EXISTS user_tier_state (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                 INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role                    TEXT    NOT NULL CHECK (role IN ('DRIVER','HOST')),

  -- Current standing
  current_tier            TEXT    NOT NULL DEFAULT 'nomad',
  -- DRIVER:  nomad | cruiser | vaulted | apex
  -- HOST:    steward | curator | prestige | icon

  tier_since              DATETIME DEFAULT CURRENT_TIMESTAMP,  -- when current tier was achieved

  -- Rolling-12-month metrics (recalculated on each event + nightly)
  r12_completed_bookings  INTEGER NOT NULL DEFAULT 0,
  r12_total_spend         REAL    NOT NULL DEFAULT 0,   -- drivers only
  r12_total_revenue       REAL    NOT NULL DEFAULT 0,   -- hosts only
  r12_avg_rating          REAL    NOT NULL DEFAULT 0,
  r12_cancellation_rate   REAL    NOT NULL DEFAULT 0,   -- pct: 0.0–1.0
  r12_response_rate       REAL    NOT NULL DEFAULT 0,   -- hosts: accepted/(accepted+declined) last 12mo
  r12_avg_response_hours  REAL    NOT NULL DEFAULT 999, -- hosts: avg hrs to respond to requests

  -- Lifetime metrics (never reset — floor protection)
  lifetime_completed      INTEGER NOT NULL DEFAULT 0,
  lifetime_spend          REAL    NOT NULL DEFAULT 0,
  lifetime_revenue        REAL    NOT NULL DEFAULT 0,

  -- Tier progress hint (0.0–1.0 toward next tier; 1.0 = already at max)
  progress_to_next        REAL    NOT NULL DEFAULT 0,

  -- Loyalty credits balance (earned through tier system, spent on fees)
  loyalty_credits         REAL    NOT NULL DEFAULT 0,

  -- Active benefit flags (denormalized for fast reads on booking/search paths)
  fee_discount_pct        REAL    NOT NULL DEFAULT 0,    -- e.g. 0.05 = 5% off platform fee
  priority_access         INTEGER NOT NULL DEFAULT 0,    -- 1 = gets early slot release
  instant_confirm         INTEGER NOT NULL DEFAULT 0,    -- 1 = skip host approval queue
  listing_boost_active    INTEGER NOT NULL DEFAULT 0,    -- hosts: boosted in search results
  featured_eligible       INTEGER NOT NULL DEFAULT 0,    -- hosts: eligible for Featured badge

  -- State flags
  is_protected            INTEGER NOT NULL DEFAULT 0,    -- 1 = in grace period, no demotion
  grace_period_ends       DATETIME,                      -- NULL if not in grace period
  consecutive_months      INTEGER NOT NULL DEFAULT 0,    -- months at current tier (streak)
  demotion_warning_sent   INTEGER NOT NULL DEFAULT 0,    -- 1 = notification sent this cycle

  -- Audit
  last_recalculated       DATETIME DEFAULT CURRENT_TIMESTAMP,
  recalc_trigger          TEXT DEFAULT 'init',
  -- Values: 'booking_complete' | 'booking_cancel' | 'review_posted' | 'nightly_job' | 'admin_override' | 'init'

  created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tier_user       ON user_tier_state(user_id);
CREATE INDEX IF NOT EXISTS idx_tier_role       ON user_tier_state(role);
CREATE INDEX IF NOT EXISTS idx_tier_current    ON user_tier_state(current_tier);
CREATE INDEX IF NOT EXISTS idx_tier_priority   ON user_tier_state(priority_access);
CREATE INDEX IF NOT EXISTS idx_tier_boost      ON user_tier_state(listing_boost_active);


-- ── 2. tier_history — immutable audit log of every tier change ──────────────
CREATE TABLE IF NOT EXISTS tier_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT    NOT NULL,
  from_tier     TEXT    NOT NULL,
  to_tier       TEXT    NOT NULL,
  change_type   TEXT    NOT NULL CHECK (change_type IN ('upgrade','downgrade','init','admin_override','grace_end')),

  -- Snapshot of metrics at the moment of change
  snap_r12_completed     INTEGER,
  snap_r12_spend         REAL,
  snap_r12_revenue       REAL,
  snap_r12_avg_rating    REAL,
  snap_r12_cancel_rate   REAL,
  snap_lifetime          INTEGER,

  trigger_event   TEXT,   -- e.g. 'booking_complete:1234'
  triggered_by    TEXT DEFAULT 'system',   -- 'system' | admin user_id
  note            TEXT,

  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tier_hist_user ON tier_history(user_id);
CREATE INDEX IF NOT EXISTS idx_tier_hist_time ON tier_history(created_at);


-- ── 3. tier_notifications — queued upgrade/warning notifications ─────────────
CREATE TABLE IF NOT EXISTS tier_notifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notif_type    TEXT    NOT NULL,
  -- Types: 'upgrade' | 'downgrade' | 'near_upgrade' | 'grace_warning' | 'credits_earned'
  tier_from     TEXT,
  tier_to       TEXT,
  message       TEXT    NOT NULL,
  credits_delta REAL    DEFAULT 0,   -- if credits were awarded with this event
  read          INTEGER NOT NULL DEFAULT 0,
  sent_email    INTEGER NOT NULL DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tier_notif_user   ON tier_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_tier_notif_unread ON tier_notifications(user_id, read);


-- ── 4. loyalty_ledger — full credits accounting trail ───────────────────────
CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta         REAL    NOT NULL,              -- positive = earned, negative = spent/expired
  balance_after REAL    NOT NULL,
  reason        TEXT    NOT NULL,
  -- Reasons: 'tier_upgrade' | 'booking_streak' | 'review_posted' | 'fee_redemption'
  --          | 'monthly_bonus' | 'referral' | 'expired' | 'admin_adjustment'
  reference_id  INTEGER,                       -- booking_id, review_id, etc.
  reference_type TEXT,                         -- 'booking' | 'review' | 'tier_event'
  expires_at    DATETIME,                      -- NULL = never expires
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ledger_user    ON loyalty_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_expires ON loyalty_ledger(expires_at);


-- ── 5. Seed: Add tier columns to users table (denormalized fast-path read) ───
-- These mirror user_tier_state for JOIN-free lookups on listing search + booking
ALTER TABLE users ADD COLUMN tier_driver TEXT DEFAULT 'nomad';
ALTER TABLE users ADD COLUMN tier_host   TEXT DEFAULT 'steward';
ALTER TABLE users ADD COLUMN tier_badge_visible INTEGER DEFAULT 1;
