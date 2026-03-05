-- ParkPeer D1 Schema — Migration 007: Admin Control System
-- ─────────────────────────────────────────────────────────────────────────────
-- FEATURES:
--   1. admin_audit_log    — immutable record of every admin action
--   2. admin_refund_log   — every refund transaction tied to a deletion
--   3. user_deletions     — compliance record of deleted accounts
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. admin_audit_log — immutable action ledger ────────────────────────────
-- One row per significant admin action (delete, suspend, refund, override, etc.)
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id        INTEGER NOT NULL,           -- admin user ID performing the action
  admin_email     TEXT    NOT NULL,           -- snapshot for compliance (admin may later be deleted)
  action          TEXT    NOT NULL,           -- 'delete_user' | 'suspend_user' | 'issue_refund' | 'cancel_booking' | 'deactivate_listing' | 'override'
  target_type     TEXT    NOT NULL,           -- 'user' | 'booking' | 'listing' | 'payment'
  target_id       INTEGER NOT NULL,           -- ID of the affected row
  target_email    TEXT,                       -- snapshot of target user email (for compliance)
  target_role     TEXT,                       -- snapshot of target user role
  details         TEXT,                       -- JSON blob with full context
  reason          TEXT,                       -- human-readable reason entered by admin
  ip_address      TEXT,                       -- request IP for audit trail
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_admin_id   ON admin_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_target_id  ON admin_audit_log(target_id, target_type);
CREATE INDEX IF NOT EXISTS idx_audit_action     ON admin_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON admin_audit_log(created_at);

-- ── 2. admin_refund_log — every money movement tied to admin actions ─────────
CREATE TABLE IF NOT EXISTS admin_refund_log (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_log_id          INTEGER REFERENCES admin_audit_log(id),  -- links back to the audit entry
  user_id               INTEGER NOT NULL,                        -- user being refunded
  user_email            TEXT    NOT NULL,                        -- snapshot
  refund_type           TEXT    NOT NULL,                        -- 'stripe_payment_intent' | 'stripe_charge' | 'manual' | 'credit' | 'zero_balance'
  amount                REAL    NOT NULL DEFAULT 0,              -- USD amount refunded
  currency              TEXT    NOT NULL DEFAULT 'usd',
  stripe_refund_id      TEXT,                                    -- Stripe refund object ID (re_xxx)
  stripe_payment_intent TEXT,                                    -- original PI (pi_xxx)
  stripe_charge_id      TEXT,                                    -- original charge (ch_xxx)
  stripe_customer_id    TEXT,                                    -- customer snapshot
  payment_method_last4  TEXT,                                    -- card last 4 / bank last4
  payment_method_type   TEXT,                                    -- 'card' | 'bank_account' | 'unknown'
  status                TEXT    NOT NULL DEFAULT 'pending',      -- 'pending' | 'succeeded' | 'failed' | 'manual_required' | 'skipped'
  failure_reason        TEXT,                                    -- Stripe error or manual note
  manual_note           TEXT,                                    -- admin note for manual refunds
  refunded_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_refund_user_id     ON admin_refund_log(user_id);
CREATE INDEX IF NOT EXISTS idx_refund_audit_id    ON admin_refund_log(audit_log_id);
CREATE INDEX IF NOT EXISTS idx_refund_status      ON admin_refund_log(status);
CREATE INDEX IF NOT EXISTS idx_refund_stripe_ri   ON admin_refund_log(stripe_refund_id);

-- ── 3. user_deletions — GDPR/compliance record of deleted accounts ───────────
-- Persisted AFTER user row is scrubbed; PII is hashed, not stored in clear text.
CREATE TABLE IF NOT EXISTS user_deletions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  original_user_id    INTEGER NOT NULL UNIQUE,              -- original users.id (kept for FK audit)
  email_hash          TEXT    NOT NULL,                     -- SHA-256 hex of original email (for lookups without storing PII)
  role_snapshot       TEXT    NOT NULL,                     -- DRIVER | HOST | BOTH | ADMIN
  deletion_reason     TEXT    NOT NULL,                     -- reason admin entered
  deleted_by_admin_id INTEGER NOT NULL,
  deleted_by_email    TEXT    NOT NULL,                     -- snapshot
  had_active_listings INTEGER NOT NULL DEFAULT 0,           -- 1 if listings were deactivated
  had_active_bookings INTEGER NOT NULL DEFAULT 0,           -- 1 if bookings were cancelled
  total_refunded      REAL    NOT NULL DEFAULT 0,           -- total USD refunded
  refund_status       TEXT    NOT NULL DEFAULT 'none',      -- 'none' | 'full' | 'partial' | 'manual_required' | 'failed'
  audit_log_id        INTEGER REFERENCES admin_audit_log(id),
  deleted_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deletions_original_id ON user_deletions(original_user_id);
CREATE INDEX IF NOT EXISTS idx_deletions_email_hash  ON user_deletions(email_hash);
CREATE INDEX IF NOT EXISTS idx_deletions_admin_id    ON user_deletions(deleted_by_admin_id);
CREATE INDEX IF NOT EXISTS idx_deletions_deleted_at  ON user_deletions(deleted_at);

-- ── 4. payout_info table (if not already created by prior migration) ─────────
CREATE TABLE IF NOT EXISTS payout_info (
  user_id                 INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_account_id       TEXT,
  bank_account_last4      TEXT,
  bank_routing_last4      TEXT,
  bank_account_encrypted  TEXT,
  bank_routing_encrypted  TEXT,
  updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP
);
