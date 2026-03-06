-- ════════════════════════════════════════════════════════════════════════════
-- Migration 0017: Contact Verification System
--
-- Adds infrastructure for:
--   1. Full phone OTP verification (overhauls existing otp_codes table)
--   2. Email OTP verification (new table — 6-digit code via Resend)
--   3. verified_contacts: session-scoped table that marks an email/phone as
--      verified for a checkout session without requiring account login.
--      The payments/confirm endpoint checks this before firing post-payment
--      messages, so unverified contacts never receive real emails/SMS.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Overhaul otp_codes (phone) ────────────────────────────────────────────
--   Add session_token so guest (non-logged-in) checkout users can verify.
--   Add type column to distinguish sms/call.
--   Add ip_address for rate-limit forensics.
--   Preserve backward-compat: user_id still nullable.
ALTER TABLE otp_codes ADD COLUMN session_token TEXT;
ALTER TABLE otp_codes ADD COLUMN type          TEXT NOT NULL DEFAULT 'sms'
  CHECK (type IN ('sms','call'));
ALTER TABLE otp_codes ADD COLUMN ip_address    TEXT;
ALTER TABLE otp_codes ADD COLUMN attempts      INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_otp_codes_session
  ON otp_codes (session_token, used, expires_at);

CREATE INDEX IF NOT EXISTS idx_otp_codes_phone_expires
  ON otp_codes (phone, expires_at);

-- ── 2. Email OTP codes table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_otp_codes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL,
  session_token TEXT    NOT NULL,
  code_hash     TEXT    NOT NULL,           -- PBKDF2 hash of 6-digit code
  expires_at    DATETIME NOT NULL,          -- created_at + 10 min
  used          INTEGER NOT NULL DEFAULT 0,
  attempts      INTEGER NOT NULL DEFAULT 0, -- wrong guesses, max 5
  ip_address    TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_otp_session
  ON email_otp_codes (session_token, used, expires_at);

CREATE INDEX IF NOT EXISTS idx_email_otp_email_expires
  ON email_otp_codes (email, expires_at);

-- ── 3. verified_contacts — session-scoped verification state ─────────────────
--   Lifecycle: created when OTP verified → read by payments/confirm → expired
--   after 2 hours (single-use: one checkout window).
--   contact_type: 'email' | 'phone'
--   This is NOT tied to user accounts — it supports guest checkout.
CREATE TABLE IF NOT EXISTS verified_contacts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_token TEXT    NOT NULL,
  contact_type  TEXT    NOT NULL CHECK (contact_type IN ('email','phone')),
  contact_value TEXT    NOT NULL,           -- normalized email or E.164 phone
  verified_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at    DATETIME NOT NULL,          -- verified_at + 2 hours
  used          INTEGER NOT NULL DEFAULT 0, -- 1 after payments/confirm reads it
  ip_address    TEXT,
  UNIQUE (session_token, contact_type)      -- one email + one phone per session
);

CREATE INDEX IF NOT EXISTS idx_verified_contacts_session
  ON verified_contacts (session_token, contact_type, expires_at);

-- ── 4. Sweep: auto-expire stale verification records ─────────────────────────
UPDATE email_otp_codes
SET    used = 1
WHERE  used = 0
  AND  datetime(expires_at) <= datetime('now');

UPDATE verified_contacts
SET    used = 1
WHERE  used = 0
  AND  datetime(expires_at) <= datetime('now');
