-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0014: Host Availability Schedule (per-weekday time windows)
-- ═══════════════════════════════════════════════════════════════════════════
-- PURPOSE:
--   Hosts define which days of the week and which hours within each day
--   their parking space is available. The booking system enforces these
--   windows server-side before creating holds or bookings.
--
--   Schema follows a simple "one row per day per listing" pattern.
--   day_of_week: 0=Sunday, 1=Monday, ..., 6=Saturday (matches JS getDay())
--   open_time / close_time: stored as "HH:MM" 24-hour strings.
--   is_available: 0 = entire day blocked (host day-off), 1 = available
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS host_availability_schedule (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id     INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  day_of_week    INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_available   INTEGER NOT NULL DEFAULT 1,   -- 0 = closed all day
  open_time      TEXT    NOT NULL DEFAULT '07:00',   -- "HH:MM" 24h
  close_time     TEXT    NOT NULL DEFAULT '22:00',   -- "HH:MM" 24h
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(listing_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_avail_schedule_listing
  ON host_availability_schedule(listing_id);

-- ── Seed default schedule for all existing active listings ───────────────
-- Default: available Mon–Sun 07:00–22:00
-- Uses a CTE to generate days 0-6 without too many UNION ALL terms
-- (D1 SQLite has a 500-term compound SELECT limit, but CTE is safer)
WITH days(day) AS (
  VALUES (0),(1),(2),(3),(4),(5),(6)
)
INSERT OR IGNORE INTO host_availability_schedule
  (listing_id, day_of_week, is_available, open_time, close_time)
SELECT l.id, d.day, 1, '07:00', '22:00'
FROM listings l
JOIN days d
WHERE l.status IN ('active','pending');
