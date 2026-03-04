-- ParkPeer D1 Schema — Migration 002: Security Hardening
-- Phase 2 compliance: encrypted PII, password_hash, unverified-user cleanup,
--                     7-year transaction anonymization, host protection hooks,
--                     payout info, legal consent log.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Add security columns to users ────────────────────────────────────────
-- Note: SQLite ALTER TABLE only supports ADD COLUMN (no IF NOT EXISTS).
-- Each column is added individually; ignore errors if columns already exist.
ALTER TABLE users ADD COLUMN password_hash    TEXT;
ALTER TABLE users ADD COLUMN email_verified   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN email_verify_token TEXT;
ALTER TABLE users ADD COLUMN email_verify_expires DATETIME;
ALTER TABLE users ADD COLUMN password_reset_token TEXT;
ALTER TABLE users ADD COLUMN password_reset_expires DATETIME;
ALTER TABLE users ADD COLUMN deleted_at DATETIME;

-- ── 2. payout_info — AES-256-GCM encrypted payout details ───────────────────
CREATE TABLE IF NOT EXISTS payout_info (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  stripe_account_id     TEXT,
  bank_account_encrypted TEXT,
  bank_routing_encrypted TEXT,
  bank_account_last4    TEXT,
  bank_routing_last4    TEXT,
  ssn_encrypted         TEXT,
  ssn_last4             TEXT,
  updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payout_user ON payout_info(user_id);

-- ── 3. legal_consents — TOS acceptance audit trail ──────────────────────────
CREATE TABLE IF NOT EXISTS legal_consents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  document_version TEXT NOT NULL DEFAULT '1.0',
  accepted_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_address    TEXT,
  user_agent    TEXT
);

CREATE INDEX IF NOT EXISTS idx_consents_user ON legal_consents(user_id);
CREATE INDEX IF NOT EXISTS idx_consents_type ON legal_consents(document_type);

-- ── 4. host_protection_claims ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS host_protection_claims (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id     INTEGER NOT NULL REFERENCES bookings(id),
  host_id        INTEGER NOT NULL REFERENCES users(id),
  claim_type     TEXT NOT NULL,
  description    TEXT,
  evidence_keys  TEXT,
  amount_claimed REAL,
  status         TEXT NOT NULL DEFAULT 'submitted',
  resolution     TEXT,
  resolved_by    INTEGER REFERENCES users(id),
  resolved_at    DATETIME,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_claims_host    ON host_protection_claims(host_id);
CREATE INDEX IF NOT EXISTS idx_claims_booking ON host_protection_claims(booking_id);

-- ── 5. otp_codes ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  phone      TEXT,
  code_hash  TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_otp_user ON otp_codes(user_id);

-- ── 6. Indexes for new columns ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_verified ON users(email_verified);
CREATE INDEX IF NOT EXISTS idx_users_deleted  ON users(deleted_at);
