-- Migration 0008: Add 'deleted' to users.status allowed values
-- SQLite does not support ALTER TABLE to modify CHECK constraints.
-- We must recreate the table with the updated constraint.
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1: Create a new table with the updated CHECK constraint
CREATE TABLE IF NOT EXISTS users_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT    UNIQUE NOT NULL,
  username       TEXT    UNIQUE,
  full_name      TEXT    NOT NULL,
  phone          TEXT,
  role           TEXT    NOT NULL DEFAULT 'DRIVER' CHECK (role IN ('DRIVER','HOST','BOTH','ADMIN')),
  avatar_url     TEXT,
  id_verified    INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id TEXT,
  stripe_account_id  TEXT,
  status         TEXT    NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','suspended','pending','banned','deleted')),
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  password_hash  TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  email_verify_token TEXT,
  email_verify_expires DATETIME,
  password_reset_token TEXT,
  password_reset_expires DATETIME,
  deleted_at     DATETIME,
  tier_driver    TEXT DEFAULT 'nomad',
  tier_host      TEXT DEFAULT 'steward',
  tier_badge_visible INTEGER DEFAULT 1,
  host_agreement_version     TEXT DEFAULT NULL,
  host_agreement_accepted_at DATETIME DEFAULT NULL,
  cancel_policy_version      TEXT DEFAULT NULL,
  cancel_policy_accepted_at  DATETIME DEFAULT NULL,
  agreement_reaccept_required INTEGER DEFAULT 0,
  agreement_reaccept_doc      TEXT DEFAULT NULL
);

-- Step 2: Copy all data from old table to new table
INSERT INTO users_new SELECT * FROM users;

-- Step 3: Drop old table
DROP TABLE users;

-- Step 4: Rename new table to users
ALTER TABLE users_new RENAME TO users;

-- Step 5: Recreate indexes that may have been lost
CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role      ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status    ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_created   ON users(created_at);
