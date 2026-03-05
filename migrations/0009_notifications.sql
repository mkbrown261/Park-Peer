-- ════════════════════════════════════════════════════════════════════════════
-- Migration 0009: Notifications System
-- ════════════════════════════════════════════════════════════════════════════

-- ── Core notifications table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id               INTEGER  PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER  NOT NULL,
  user_role        TEXT     NOT NULL DEFAULT 'driver', -- driver | host | admin
  type             TEXT     NOT NULL,                  -- booking_request | booking_confirmed | booking_cancelled |
                                                       -- booking_reminder | payout_processed | review_received |
                                                       -- new_registration | new_listing | dispute_opened |
                                                       -- refund_processed | security_alert | system
  title            TEXT     NOT NULL,
  message          TEXT     NOT NULL,
  related_entity   TEXT,    -- JSON: {type:'booking',id:123} or {type:'listing',id:5}
  read_status      INTEGER  NOT NULL DEFAULT 0,        -- 0 = unread, 1 = read
  delivery_inapp   INTEGER  NOT NULL DEFAULT 1,
  delivery_email   INTEGER  NOT NULL DEFAULT 0,
  delivery_sms     INTEGER  NOT NULL DEFAULT 0,
  email_sent       INTEGER  NOT NULL DEFAULT 0,
  sms_sent         INTEGER  NOT NULL DEFAULT 0,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id     ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read_status ON notifications(user_id, read_status);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at  ON notifications(created_at DESC);

-- ── Notification preferences per user ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id              INTEGER  PRIMARY KEY,
  booking_inapp        INTEGER  NOT NULL DEFAULT 1,
  booking_email        INTEGER  NOT NULL DEFAULT 1,
  booking_sms          INTEGER  NOT NULL DEFAULT 1,
  payout_inapp         INTEGER  NOT NULL DEFAULT 1,
  payout_email         INTEGER  NOT NULL DEFAULT 1,
  payout_sms           INTEGER  NOT NULL DEFAULT 1,
  review_inapp         INTEGER  NOT NULL DEFAULT 1,
  review_email         INTEGER  NOT NULL DEFAULT 1,
  review_sms           INTEGER  NOT NULL DEFAULT 0,
  system_inapp         INTEGER  NOT NULL DEFAULT 1,
  system_email         INTEGER  NOT NULL DEFAULT 1,
  system_sms           INTEGER  NOT NULL DEFAULT 0,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
