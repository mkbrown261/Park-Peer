-- ════════════════════════════════════════════════════════════════════════════
-- Migration 0018: Payout Distribution Audit
--
-- Changes:
--   1. payments table:
--        - Add updated_at column (for transfer stamp timestamp)
--        - Add transfer_status virtual/derived column via index
--   2. payment_recovery_log:
--        - Recreate table without the restrictive CHECK on recovery_status
--          so that 'payout_pending' and 'payout_failed' values are accepted
--          (SQLite does not support ALTER TABLE … DROP CONSTRAINT)
--   3. Add payout_audit_log table for long-term distribution ledger
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. payments: add updated_at if missing ──────────────────────────────────
ALTER TABLE payments ADD COLUMN updated_at DATETIME;
UPDATE payments SET updated_at = created_at WHERE updated_at IS NULL;

-- ── 2. payment_recovery_log: add payout status values ──────────────────────
-- SQLite cannot DROP/MODIFY a CHECK constraint.
-- Strategy: create a shadow table with wider CHECK, copy, drop old, rename.

CREATE TABLE IF NOT EXISTS payment_recovery_log_v2 (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_pi_id     TEXT NOT NULL UNIQUE,
  amount_cents     INTEGER NOT NULL,
  hold_id          INTEGER REFERENCES reservation_holds(id),
  booking_id       INTEGER REFERENCES bookings(id),
  recovery_status  TEXT NOT NULL DEFAULT 'pending'
                   CHECK (recovery_status IN (
                     'pending',
                     'recovered',
                     'refunded',
                     'manual_required',
                     'payout_pending',
                     'payout_failed',
                     'resolved'
                   )),
  attempts         INTEGER NOT NULL DEFAULT 0,
  last_attempt_at  DATETIME,
  resolved_at      DATETIME,
  error_detail     TEXT,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO payment_recovery_log_v2
  (id, stripe_pi_id, amount_cents, hold_id, booking_id,
   recovery_status, attempts, last_attempt_at, resolved_at, error_detail, created_at)
SELECT
  id, stripe_pi_id, amount_cents, hold_id, booking_id,
  recovery_status, attempts, last_attempt_at, resolved_at, error_detail, created_at
FROM payment_recovery_log;

DROP TABLE IF EXISTS payment_recovery_log;
ALTER TABLE payment_recovery_log_v2 RENAME TO payment_recovery_log;

CREATE INDEX IF NOT EXISTS idx_recovery_status
  ON payment_recovery_log(recovery_status, created_at);

CREATE INDEX IF NOT EXISTS idx_recovery_pi
  ON payment_recovery_log(stripe_pi_id);

-- ── 3. payout_audit_log — immutable ledger row per payout attempt ───────────
CREATE TABLE IF NOT EXISTS payout_audit_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id          INTEGER NOT NULL REFERENCES bookings(id),
  payment_id          INTEGER REFERENCES payments(id),
  host_id             INTEGER NOT NULL REFERENCES users(id),
  driver_id           INTEGER REFERENCES users(id),
  -- Dollar amounts (stored as REAL for human readability; cents also stored)
  total_charged       REAL NOT NULL,
  platform_fee        REAL NOT NULL,
  host_payout         REAL NOT NULL,
  subtotal            REAL NOT NULL,
  -- Expected values for anomaly detection
  expected_subtotal   REAL NOT NULL,
  expected_platform_fee REAL NOT NULL,
  expected_host_payout  REAL NOT NULL,
  -- Drift flags
  fee_delta           REAL NOT NULL DEFAULT 0,
  split_delta         REAL NOT NULL DEFAULT 0,
  -- Stripe IDs
  stripe_pi_id        TEXT NOT NULL,
  stripe_charge_id    TEXT,
  stripe_transfer_id  TEXT,
  -- Status
  payout_status       TEXT NOT NULL DEFAULT 'pending'
                      CHECK (payout_status IN ('pending','dispatched','settled','failed','manual_required')),
  audit_status        TEXT NOT NULL DEFAULT 'ok'
                      CHECK (audit_status IN ('ok','warning','error')),
  notes               TEXT,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  settled_at          DATETIME
);

CREATE INDEX IF NOT EXISTS idx_payout_audit_booking
  ON payout_audit_log(booking_id);

CREATE INDEX IF NOT EXISTS idx_payout_audit_host
  ON payout_audit_log(host_id, created_at);

CREATE INDEX IF NOT EXISTS idx_payout_audit_status
  ON payout_audit_log(payout_status, audit_status, created_at);

CREATE INDEX IF NOT EXISTS idx_payout_audit_pi
  ON payout_audit_log(stripe_pi_id);

-- ── 4. payments: index for transfer reconciliation ──────────────────────────
CREATE INDEX IF NOT EXISTS idx_payments_charge_id
  ON payments(stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_transfer_id
  ON payments(stripe_transfer_id)
  WHERE stripe_transfer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_pi_type
  ON payments(stripe_payment_intent_id, type);
