-- ParkPeer D1 Schema — Migration 004: Host Agreement & Cancellation Policy Enforcement
-- ─────────────────────────────────────────────────────────────────────────────
-- Tracks: host agreement acceptance (all versions), driver cancellation ack,
--         forced re-acceptance on version bump, full IP/UA audit trail.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. agreement_acceptances — primary audit table ───────────────────────────
-- One row per (user, document_type, version). Never deleted (legal record).
CREATE TABLE IF NOT EXISTS agreement_acceptances (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type       TEXT    NOT NULL,
  -- Values:
  --   'host_agreement'         — ParkPeer Host Agreement (hosts/both)
  --   'cancellation_policy'    — ParkPeer Cancellation Policy (drivers/both)
  --   'terms_of_service'       — General TOS (all users, handled separately)
  --   'privacy_policy'         — Privacy Policy (all users)

  document_version    TEXT    NOT NULL DEFAULT '1.0',
  -- Semantic version e.g. '1.0', '1.1', '2.0'

  -- Acceptance context
  acceptance_source   TEXT    NOT NULL DEFAULT 'web',
  -- Values: 'registration' | 'host_onboarding' | 'listing_creation'
  --         | 'version_update_modal' | 'checkout' | 'api' | 'admin_override'

  -- Full audit trail (legal protection)
  ip_address          TEXT,
  user_agent          TEXT,
  accepted_at         DATETIME NOT NULL DEFAULT (datetime('now')),

  -- Optional reference to the triggering entity
  reference_id        INTEGER,   -- booking_id, listing_id, etc.
  reference_type      TEXT,      -- 'booking' | 'listing' | 'account'

  -- Metadata
  platform            TEXT DEFAULT 'web',  -- 'web' | 'ios' | 'android' | 'api'
  notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_agrmt_user         ON agreement_acceptances(user_id);
CREATE INDEX IF NOT EXISTS idx_agrmt_type_ver     ON agreement_acceptances(document_type, document_version);
CREATE INDEX IF NOT EXISTS idx_agrmt_user_type    ON agreement_acceptances(user_id, document_type);
CREATE INDEX IF NOT EXISTS idx_agrmt_accepted_at  ON agreement_acceptances(accepted_at);


-- ── 2. Add agreement tracking columns to users ───────────────────────────────
-- Denormalized fast-path: avoids JOIN on every API call.
-- These are updated atomically with each insert into agreement_acceptances.

-- Host: current accepted version of Host Agreement
ALTER TABLE users ADD COLUMN host_agreement_version     TEXT DEFAULT NULL;
-- e.g. '1.0' — NULL means never accepted
ALTER TABLE users ADD COLUMN host_agreement_accepted_at DATETIME DEFAULT NULL;

-- Driver: current accepted version of Cancellation Policy
ALTER TABLE users ADD COLUMN cancel_policy_version      TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN cancel_policy_accepted_at  DATETIME DEFAULT NULL;

-- General: forced re-acceptance flag (set by admin on version bump)
-- 1 = user must re-accept before next protected action
ALTER TABLE users ADD COLUMN agreement_reaccept_required INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN agreement_reaccept_doc      TEXT DEFAULT NULL;
-- Which document needs re-acceptance: 'host_agreement' | 'cancellation_policy' | 'both'


-- ── 3. Add cancellation acknowledgment to bookings ───────────────────────────
-- Captures driver explicit ack of the cancellation policy at checkout.
ALTER TABLE bookings ADD COLUMN cancellation_acknowledged      INTEGER DEFAULT 0;
-- 1 = driver checked the checkbox at checkout
ALTER TABLE bookings ADD COLUMN cancellation_ack_version       TEXT DEFAULT NULL;
-- The policy version they acknowledged (e.g. '1.0')
ALTER TABLE bookings ADD COLUMN cancellation_ack_at            DATETIME DEFAULT NULL;
ALTER TABLE bookings ADD COLUMN cancellation_ack_ip            TEXT DEFAULT NULL;


-- ── 4. agreement_version_log — admin-controlled version change log ───────────
-- When ParkPeer bumps a document version, an admin inserts a row here.
-- The system reads the latest row to know the current required version.
CREATE TABLE IF NOT EXISTS agreement_versions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  document_type    TEXT NOT NULL,
  version          TEXT NOT NULL,
  effective_date   DATETIME NOT NULL DEFAULT (datetime('now')),
  summary_of_changes TEXT,
  requires_reaccept  INTEGER NOT NULL DEFAULT 1,
  -- 1 = existing users must re-accept; 0 = informational bump only
  created_by       INTEGER REFERENCES users(id),
  created_at       DATETIME DEFAULT (datetime('now')),
  UNIQUE(document_type, version)
);

CREATE INDEX IF NOT EXISTS idx_agrmt_ver_type ON agreement_versions(document_type);
CREATE INDEX IF NOT EXISTS idx_agrmt_ver_eff  ON agreement_versions(document_type, effective_date DESC);

-- Seed: current versions as of launch
INSERT OR IGNORE INTO agreement_versions (document_type, version, summary_of_changes, requires_reaccept)
VALUES
  ('host_agreement',      '1.0', 'Initial ParkPeer Host Agreement', 0),
  ('cancellation_policy', '1.0', 'Initial ParkPeer Cancellation & Refund Policy', 0),
  ('terms_of_service',    '1.0', 'Initial Terms of Service', 0),
  ('privacy_policy',      '1.0', 'Initial Privacy Policy', 0);
