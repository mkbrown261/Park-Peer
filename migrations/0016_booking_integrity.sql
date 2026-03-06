-- ════════════════════════════════════════════════════════════════════════════
-- Migration 0016: Booking Integrity — Double-Booking Prevention + Reservation
--                 Lock System
--
-- Changes:
--   1. Add a `reservation_locks` table with status='locked' (5-min TTL) to
--      prevent ghost bookings. A lock is acquired BEFORE the Stripe PI is
--      created; it is promoted to 'confirmed' atomically in payments/confirm.
--
--   2. Add performance indexes on bookings and reservation_holds for fast
--      range-conflict queries (start_time / end_time overlap checks).
--
--   3. Add a partial unique index on bookings to prevent two confirmed/active
--      rows with the same listing_id + exact start_time + end_time combination.
--      (Full range-overlap is enforced at query time; this catches exact dups.)
--
--   4. Add an index on reservation_locks for fast lookup by listing + time range.
--
-- NOTE: SQLite does not support multi-column exclusion constraints or
--       range-overlap constraints natively. The application layer enforces
--       overlap checks via SELECT…LIMIT 1 before every INSERT.  These indexes
--       make those checks fast even with thousands of rows.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Reservation Locks table ──────────────────────────────────────────────
--   Lifecycle: pending → locked → confirmed | expired | released
--   A 'locked' row blocks the slot for 5 minutes while Stripe processes.
--   On success → confirmed.  On abandonment → expired (TTL sweep) or released.
CREATE TABLE IF NOT EXISTS reservation_locks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id      INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  session_token   TEXT NOT NULL,                   -- same token as the hold
  hold_id         INTEGER REFERENCES reservation_holds(id),
  start_time      DATETIME NOT NULL,
  end_time        DATETIME NOT NULL,
  lock_expires_at DATETIME NOT NULL,               -- created_at + 5 min
  status          TEXT NOT NULL DEFAULT 'locked'
                  CHECK (status IN ('locked','confirmed','expired','released')),
  booking_id      INTEGER REFERENCES bookings(id), -- set when confirmed
  stripe_pi_id    TEXT,                            -- set on PI creation
  idempotency_key TEXT UNIQUE,                     -- checkout_token
  ip_address      TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── 2. Indexes on reservation_locks ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rlocks_listing_time
  ON reservation_locks (listing_id, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_rlocks_session
  ON reservation_locks (session_token);

CREATE INDEX IF NOT EXISTS idx_rlocks_status_expires
  ON reservation_locks (status, lock_expires_at);

-- ── 3. Partial unique index on bookings (exact-duplicate prevention) ─────────
--   Prevents two confirmed/active bookings for the EXACT same slot.
--   Range-overlap is caught at query time; this is a last-resort guard.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_bookings_confirmed_slot
  ON bookings (listing_id, start_time, end_time)
  WHERE status IN ('confirmed', 'active');

-- ── 4. Performance indexes on bookings for range queries ────────────────────
CREATE INDEX IF NOT EXISTS idx_bookings_listing_status_times
  ON bookings (listing_id, status, start_time, end_time);

-- ── 5. Performance indexes on reservation_holds for range queries ────────────
CREATE INDEX IF NOT EXISTS idx_holds_listing_status_times
  ON reservation_holds (listing_id, status, start_time, end_time);

-- ── 6. Auto-expire stale reservation_locks ──────────────────────────────────
UPDATE reservation_locks
SET    status     = 'expired',
       updated_at = datetime('now')
WHERE  status     = 'locked'
  AND  datetime(lock_expires_at) <= datetime('now');
