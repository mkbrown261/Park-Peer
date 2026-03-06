-- ════════════════════════════════════════════════════════════════════════════
-- Migration 0019: Host Cash-Out System (Stripe Connect)
--
-- New tables:
--   1. stripe_connect_accounts  — one row per host's Stripe Express account
--   2. host_payouts             — every payout request + result
--   3. payout_schedule          — per-host automatic payout preferences
--   4. stripe_connect_events    — webhook event log for Connect accounts
--
-- Modified tables:
--   payout_info                 — add connect_account_id, onboarding_status
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. stripe_connect_accounts ───────────────────────────────────────────────
-- Stores each host's Stripe Express account and its onboarding/verification state.
CREATE TABLE IF NOT EXISTS stripe_connect_accounts (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id              INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  stripe_account_id    TEXT    NOT NULL UNIQUE,        -- acct_xxx
  account_type         TEXT    NOT NULL DEFAULT 'express'
                       CHECK (account_type IN ('express','standard','custom')),
  business_type        TEXT    NOT NULL DEFAULT 'individual'
                       CHECK (business_type IN ('individual','company','non_profit','government_entity')),
  email                TEXT,
  country              TEXT    NOT NULL DEFAULT 'US',
  -- Onboarding state
  onboarding_status    TEXT    NOT NULL DEFAULT 'pending'
                       CHECK (onboarding_status IN (
                         'pending',          -- account created, link not yet opened
                         'in_progress',      -- host opened onboarding link
                         'complete',         -- details_submitted = true
                         'restricted',       -- needs more info (requirements.currently_due)
                         'disabled'          -- charges/payouts disabled by Stripe
                       )),
  details_submitted    INTEGER NOT NULL DEFAULT 0,  -- 1 when Stripe confirms KYC done
  charges_enabled      INTEGER NOT NULL DEFAULT 0,
  payouts_enabled      INTEGER NOT NULL DEFAULT 0,
  -- Requirements snapshot (JSON blob from Stripe account.requirements)
  requirements_json    TEXT,
  -- Stripe Express Dashboard login link cache (short TTL, never stored long-term)
  -- Timestamps
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_connect_user      ON stripe_connect_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_connect_stripe_id ON stripe_connect_accounts(stripe_account_id);
CREATE INDEX IF NOT EXISTS idx_connect_status    ON stripe_connect_accounts(onboarding_status);

-- ── 2. host_payouts ──────────────────────────────────────────────────────────
-- Immutable ledger: one row per payout request (manual or scheduled).
CREATE TABLE IF NOT EXISTS host_payouts (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id              INTEGER NOT NULL REFERENCES users(id),
  stripe_account_id    TEXT    NOT NULL,               -- acct_xxx (connected account)
  stripe_payout_id     TEXT    UNIQUE,                 -- po_xxx (from Stripe)
  -- Amounts
  amount               REAL    NOT NULL,               -- dollars
  amount_cents         INTEGER NOT NULL,
  currency             TEXT    NOT NULL DEFAULT 'usd',
  -- Payout status mirrors Stripe's payout.status
  status               TEXT    NOT NULL DEFAULT 'requested'
                       CHECK (status IN (
                         'requested',    -- user clicked "Cash Out", not yet sent to Stripe
                         'pending',      -- Stripe accepted it, not yet in transit
                         'in_transit',   -- Stripe is sending to bank
                         'paid',         -- settled in host's bank account
                         'failed',       -- bank rejected or Stripe error
                         'canceled'      -- cancelled before processing
                       )),
  -- Trigger
  trigger_type         TEXT    NOT NULL DEFAULT 'manual'
                       CHECK (trigger_type IN ('manual','scheduled','admin')),
  -- Stripe arrival date (unix ts)
  arrival_date         INTEGER,
  -- Error info
  failure_code         TEXT,
  failure_message      TEXT,
  -- Retry tracking
  retry_count          INTEGER NOT NULL DEFAULT 0,
  last_retry_at        DATETIME,
  -- 2FA confirmation
  confirmed_at         DATETIME,
  confirmation_ip      TEXT,
  -- Timestamps
  requested_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed_at         DATETIME,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_host_payouts_host     ON host_payouts(host_id, created_at);
CREATE INDEX IF NOT EXISTS idx_host_payouts_stripe   ON host_payouts(stripe_payout_id);
CREATE INDEX IF NOT EXISTS idx_host_payouts_status   ON host_payouts(status, created_at);
CREATE INDEX IF NOT EXISTS idx_host_payouts_account  ON host_payouts(stripe_account_id);

-- ── 3. payout_schedule ───────────────────────────────────────────────────────
-- Per-host automatic payout preferences.
CREATE TABLE IF NOT EXISTS payout_schedule (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id              INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  stripe_account_id    TEXT    NOT NULL,
  interval             TEXT    NOT NULL DEFAULT 'manual'
                       CHECK (interval IN ('manual','daily','weekly','monthly')),
  weekly_anchor        TEXT    DEFAULT 'friday'
                       CHECK (weekly_anchor IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
  monthly_anchor       INTEGER DEFAULT 1   CHECK (monthly_anchor BETWEEN 1 AND 31),
  minimum_payout_cents INTEGER NOT NULL DEFAULT 1000,  -- $10 minimum
  enabled              INTEGER NOT NULL DEFAULT 1,
  last_run_at          DATETIME,
  next_run_at          DATETIME,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payout_schedule_host ON payout_schedule(host_id);
CREATE INDEX IF NOT EXISTS idx_payout_schedule_next ON payout_schedule(next_run_at, enabled);

-- ── 4. stripe_connect_events ─────────────────────────────────────────────────
-- Append-only webhook event log for Connect account events.
CREATE TABLE IF NOT EXISTS stripe_connect_events (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_event_id      TEXT    NOT NULL UNIQUE,        -- evt_xxx
  event_type           TEXT    NOT NULL,               -- account.updated, payout.paid, etc.
  connected_account_id TEXT,                           -- acct_xxx (from account header)
  stripe_payout_id     TEXT,                           -- po_xxx if payout event
  host_id              INTEGER REFERENCES users(id),
  payload_json         TEXT    NOT NULL,               -- full Stripe event JSON
  processed            INTEGER NOT NULL DEFAULT 0,
  error_detail         TEXT,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_connect_events_type    ON stripe_connect_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_connect_events_account ON stripe_connect_events(connected_account_id);
CREATE INDEX IF NOT EXISTS idx_connect_events_payout  ON stripe_connect_events(stripe_payout_id);

-- ── 5. Extend payout_info with connect status ─────────────────────────────────
ALTER TABLE payout_info ADD COLUMN connect_account_id TEXT;
ALTER TABLE payout_info ADD COLUMN onboarding_status  TEXT DEFAULT 'pending';
ALTER TABLE payout_info ADD COLUMN payouts_enabled     INTEGER DEFAULT 0;

-- ── 6. Indexes for earnings queries ──────────────────────────────────────────
-- Fast available-balance calculation: completed bookings not yet cashed out
CREATE INDEX IF NOT EXISTS idx_payments_host_status
  ON payments(host_id, status, created_at)
  WHERE status = 'succeeded';

CREATE INDEX IF NOT EXISTS idx_bookings_host_status
  ON bookings(host_id, status)
  WHERE status IN ('confirmed','active','completed');
