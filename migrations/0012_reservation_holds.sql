-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0012: Reservation Holds + Ghost Booking Prevention
-- ═══════════════════════════════════════════════════════════════════════════
-- PURPOSE:
--   1. reservation_holds — time-bounded slot locks (5-min TTL) that gate
--      the Stripe Payment Intent creation window. Prevents:
--        • False "slot unavailable" on the user's own pending booking
--        • Race-condition double-bookings between concurrent users
--        • Ghost bookings (charged but no confirmed reservation)
--
--   2. payment_recovery_log — idempotent ghost-booking recovery audit trail.
--      Every PI that succeeded but whose booking row is missing or unconfirmed
--      is logged here and auto-recovered (or auto-refunded) by the webhook.
--
--   3. booking_idempotency — prevents duplicate PI creation for the same
--      checkout attempt (network retries / double-clicks).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. reservation_holds ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reservation_holds (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id       INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  user_id          INTEGER,                          -- NULL for guest checkouts
  session_token    TEXT NOT NULL,                    -- random 32-byte hex, ties hold to browser session
  start_time       DATETIME NOT NULL,
  end_time         DATETIME NOT NULL,
  hold_expires_at  DATETIME NOT NULL,                -- now + 10 minutes
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','converted','expired','released')),
  booking_id       INTEGER REFERENCES bookings(id),  -- set when converted
  stripe_pi_id     TEXT,                             -- set when PI created against this hold
  idempotency_key  TEXT UNIQUE,                      -- prevents duplicate PI creation
  ip_address       TEXT,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Fast overlap-check for active holds on a listing
CREATE INDEX IF NOT EXISTS idx_holds_listing_time
  ON reservation_holds(listing_id, start_time, end_time, status, hold_expires_at);

-- Fast lookup by session token (client polls to check hold still valid)
CREATE INDEX IF NOT EXISTS idx_holds_session
  ON reservation_holds(session_token, status);

-- Fast lookup by stripe PI (webhook converter)
CREATE INDEX IF NOT EXISTS idx_holds_stripe_pi
  ON reservation_holds(stripe_pi_id);

-- Fast cleanup of expired holds
CREATE INDEX IF NOT EXISTS idx_holds_expiry
  ON reservation_holds(hold_expires_at, status);

-- ── 2. payment_recovery_log ──────────────────────────────────────────────
-- Written by webhook when PI succeeds but booking is missing/unconfirmed.
-- Recovery worker reads this and either creates the booking or issues refund.
CREATE TABLE IF NOT EXISTS payment_recovery_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_pi_id     TEXT NOT NULL UNIQUE,
  amount_cents     INTEGER NOT NULL,
  hold_id          INTEGER REFERENCES reservation_holds(id),
  booking_id       INTEGER REFERENCES bookings(id),  -- NULL until recovered
  recovery_status  TEXT NOT NULL DEFAULT 'pending'
                   CHECK (recovery_status IN ('pending','recovered','refunded','manual_required')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  last_attempt_at  DATETIME,
  resolved_at      DATETIME,
  error_detail     TEXT,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_recovery_status
  ON payment_recovery_log(recovery_status, created_at);

CREATE INDEX IF NOT EXISTS idx_recovery_pi
  ON payment_recovery_log(stripe_pi_id);

-- ── 3. booking_idempotency ────────────────────────────────────────────────
-- Maps a client-generated checkout_token → single booking row.
-- Prevents double-booking on network retry / double-click.
CREATE TABLE IF NOT EXISTS booking_idempotency (
  checkout_token  TEXT PRIMARY KEY,         -- UUID sent by client at checkout start
  booking_id      INTEGER UNIQUE REFERENCES bookings(id),
  hold_id         INTEGER REFERENCES reservation_holds(id),
  stripe_pi_id    TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── 4. Add checkout_token column to bookings (if not exists) ─────────────
-- Stores the client idempotency token on the booking row for fast lookup.
ALTER TABLE bookings ADD COLUMN checkout_token TEXT;
CREATE INDEX IF NOT EXISTS idx_bookings_checkout_token
  ON bookings(checkout_token);

-- ── 5. Add hold_id FK to bookings ────────────────────────────────────────
ALTER TABLE bookings ADD COLUMN hold_id INTEGER REFERENCES reservation_holds(id);
