-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0013: Payment-Booking Integrity Audit
-- ═══════════════════════════════════════════════════════════════════════════
-- PURPOSE:
--   Adds infrastructure for ghost-booking detection, orphan-payment recovery,
--   and periodic integrity checks across the payment pipeline.
--
--   1. orphan_payments   — Stripe charges with no matching confirmed booking
--   2. integrity_log     — Timestamped audit log of each integrity scan run
--   3. Indexes for fast integrity queries on bookings + payments
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. orphan_payments ───────────────────────────────────────────────────────
-- Written by the /api/admin/integrity endpoint when it detects a Stripe PI
-- that succeeded but has no corresponding confirmed booking row.
-- Admin reviews these and either manually creates the booking or issues refund.
CREATE TABLE IF NOT EXISTS orphan_payments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_pi_id      TEXT NOT NULL UNIQUE,
  amount_cents      INTEGER NOT NULL,
  driver_email      TEXT,
  listing_id        INTEGER,
  hold_id           INTEGER REFERENCES reservation_holds(id),
  detected_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolution        TEXT NOT NULL DEFAULT 'pending'
                    CHECK (resolution IN ('pending','recovered','refunded','false_positive','manual_required')),
  resolved_at       DATETIME,
  resolved_by       TEXT,
  notes             TEXT
);

CREATE INDEX IF NOT EXISTS idx_orphan_resolution
  ON orphan_payments(resolution, detected_at);

CREATE INDEX IF NOT EXISTS idx_orphan_pi
  ON orphan_payments(stripe_pi_id);

-- ── 2. integrity_log ─────────────────────────────────────────────────────────
-- One row per integrity scan run (triggered by admin or cron).
CREATE TABLE IF NOT EXISTS integrity_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  triggered_by      TEXT NOT NULL DEFAULT 'admin',    -- 'admin' | 'cron' | 'webhook'
  bookings_checked  INTEGER NOT NULL DEFAULT 0,
  payments_checked  INTEGER NOT NULL DEFAULT 0,
  holds_checked     INTEGER NOT NULL DEFAULT 0,
  orphans_found     INTEGER NOT NULL DEFAULT 0,
  orphans_resolved  INTEGER NOT NULL DEFAULT 0,
  recovery_items    INTEGER NOT NULL DEFAULT 0,       -- rows in payment_recovery_log pending
  duration_ms       INTEGER,
  status            TEXT NOT NULL DEFAULT 'ok'
                    CHECK (status IN ('ok','issues_found','error')),
  summary           TEXT
);

CREATE INDEX IF NOT EXISTS idx_integrity_run_at
  ON integrity_log(run_at);

-- ── 3. Additional indexes for fast integrity queries ─────────────────────────

-- Speed up "find bookings without matching payment" query
CREATE INDEX IF NOT EXISTS idx_bookings_status_pi
  ON bookings(status, stripe_payment_intent_id);

-- Speed up "find payments without confirmed booking" query
CREATE INDEX IF NOT EXISTS idx_payments_pi_status
  ON payments(stripe_payment_intent_id, status);

-- Speed up hold expiry cleanup
CREATE INDEX IF NOT EXISTS idx_holds_user_status
  ON reservation_holds(user_id, status, created_at);
