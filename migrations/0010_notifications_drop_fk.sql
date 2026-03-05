-- Migration 0010: Remove FK constraint on notifications.user_id
-- Reason: admin notifications use user_id=0 which violates the FK to users(id)
-- SQLite cannot DROP CONSTRAINT, so we recreate the table without it.

PRAGMA foreign_keys = OFF;

-- Step 1: rename old table
ALTER TABLE notifications RENAME TO notifications_old;

-- Step 2: recreate without the FK
CREATE TABLE notifications (
  id               INTEGER  PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER  NOT NULL,
  user_role        TEXT     NOT NULL DEFAULT 'driver',
  type             TEXT     NOT NULL,
  title            TEXT     NOT NULL,
  message          TEXT     NOT NULL,
  related_entity   TEXT,
  read_status      INTEGER  NOT NULL DEFAULT 0,
  delivery_inapp   INTEGER  NOT NULL DEFAULT 1,
  delivery_email   INTEGER  NOT NULL DEFAULT 0,
  delivery_sms     INTEGER  NOT NULL DEFAULT 0,
  email_sent       INTEGER  NOT NULL DEFAULT 0,
  sms_sent         INTEGER  NOT NULL DEFAULT 0,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Step 3: copy existing rows
INSERT INTO notifications SELECT * FROM notifications_old;

-- Step 4: drop old table
DROP TABLE notifications_old;

-- Step 5: recreate indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id     ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read_status ON notifications(user_id, read_status);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at  ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_admin_role  ON notifications(user_role, read_status);

PRAGMA foreign_keys = ON;
