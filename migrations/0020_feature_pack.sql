-- =============================================================================
-- Migration 0020: Feature Pack — Reviews, Favorites, Referrals, Wallet,
--                 Fraud Flags, Listing Enhancements, Host Trust, Availability
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enhance existing reviews table (already exists, add missing columns)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE reviews ADD COLUMN review_target_id INTEGER;
ALTER TABLE reviews ADD COLUMN reviewer_role TEXT DEFAULT 'driver'; -- 'driver' | 'host'
ALTER TABLE reviews ADD COLUMN is_visible INTEGER DEFAULT 1;
ALTER TABLE reviews ADD COLUMN flagged INTEGER DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Favorites (saved parking spots)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS favorites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  listing_id  INTEGER NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, listing_id),
  FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
  FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_favorites_user    ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_listing ON favorites(listing_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. User wallet (parking credits / referral rewards)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_wallet (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL UNIQUE,
  balance_cents INTEGER NOT NULL DEFAULT 0,  -- stored in cents
  lifetime_earned_cents INTEGER NOT NULL DEFAULT 0,
  lifetime_spent_cents  INTEGER NOT NULL DEFAULT 0,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_wallet_user ON user_wallet(user_id);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  type         TEXT NOT NULL, -- 'credit_referral' | 'credit_promo' | 'debit_booking' | 'credit_refund'
  amount_cents INTEGER NOT NULL,
  description  TEXT,
  booking_id   INTEGER,
  referral_id  INTEGER,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Referral program
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_user_id  INTEGER NOT NULL,
  referred_user_id  INTEGER,          -- NULL until new user registers
  referral_code     TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'registered'|'rewarded'|'expired'
  reward_amount_cents INTEGER NOT NULL DEFAULT 1000, -- $10.00
  reward_booking_id INTEGER,          -- booking that triggered reward
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  rewarded_at       DATETIME,
  FOREIGN KEY (referrer_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code     ON referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_user_id);

-- Add referral_code column to users for quick lookup
ALTER TABLE users ADD COLUMN referral_code TEXT;
ALTER TABLE users ADD COLUMN referred_by_code TEXT;
ALTER TABLE users ADD COLUMN wallet_balance_cents INTEGER NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Fraud flags table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fraud_flags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,   -- 'user' | 'listing' | 'booking'
  entity_id   INTEGER NOT NULL,
  flag_type   TEXT NOT NULL,   -- 'duplicate_listing'|'overlapping_booking'|'spam_account'|'rapid_booking'|'fake_host'|'coordinate_duplicate'
  severity    TEXT NOT NULL DEFAULT 'medium', -- 'low'|'medium'|'high'|'critical'
  description TEXT,
  resolved    INTEGER DEFAULT 0,
  resolved_by INTEGER,
  resolved_at DATETIME,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fraud_entity     ON fraud_flags(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_fraud_resolved   ON fraud_flags(resolved);
CREATE INDEX IF NOT EXISTS idx_fraud_created_at ON fraud_flags(created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Listings enhancements — availability confidence + quality score + lat/lng confirmed
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE listings ADD COLUMN last_booking_at      DATETIME;
ALTER TABLE listings ADD COLUMN booking_frequency    REAL DEFAULT 0;    -- bookings per 30 days
ALTER TABLE listings ADD COLUMN cancellation_rate    REAL DEFAULT 0;    -- 0.0–1.0
ALTER TABLE listings ADD COLUMN availability_confidence TEXT DEFAULT 'medium'; -- 'high'|'medium'|'low'
ALTER TABLE listings ADD COLUMN quality_score        INTEGER DEFAULT 0;  -- 0–100
ALTER TABLE listings ADD COLUMN fraud_flags          INTEGER DEFAULT 0;
ALTER TABLE listings ADD COLUMN instructions         TEXT;               -- parking instructions
ALTER TABLE listings ADD COLUMN walking_distance_m   INTEGER;            -- meters from centroid

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Users enhancements — fraud flags + host trust
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN fraud_flags             INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN host_trust_score        REAL DEFAULT 0;
ALTER TABLE users ADD COLUMN host_verified           INTEGER DEFAULT 0;  -- verified badge
ALTER TABLE users ADD COLUMN rapid_booking_count     INTEGER DEFAULT 0;  -- anti-spam
ALTER TABLE users ADD COLUMN last_booking_attempt_at DATETIME;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Performance indexes on new + existing high-traffic columns
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_listings_quality     ON listings(quality_score);
CREATE INDEX IF NOT EXISTS idx_listings_confidence  ON listings(availability_confidence);
CREATE INDEX IF NOT EXISTS idx_listings_lat_lng     ON listings(lat, lng);
CREATE INDEX IF NOT EXISTS idx_bookings_driver_listing ON bookings(driver_id, listing_id);
CREATE INDEX IF NOT EXISTS idx_reviews_target       ON reviews(review_target_id);
CREATE INDEX IF NOT EXISTS idx_reviews_booking      ON reviews(booking_id);
CREATE INDEX IF NOT EXISTS idx_users_referral_code  ON users(referral_code);
