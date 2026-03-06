-- Migration 0015: Payment integrity & ghost booking prevention
-- 1. Cancel all 'pending' bookings older than 30 minutes (orphaned, never paid)
UPDATE bookings
SET status = 'cancelled',
    cancel_reason = 'Auto-cancelled: payment not completed within 30 minutes',
    updated_at = datetime('now')
WHERE status = 'pending'
  AND datetime(created_at) < datetime('now', '-30 minutes');

-- 2. Release all reservation holds that have expired but were never marked expired
UPDATE reservation_holds
SET status = 'expired',
    updated_at = datetime('now')
WHERE status = 'active'
  AND datetime(hold_expires_at) <= datetime('now');

-- 3. Add index for fast pending-booking cleanup queries
CREATE INDEX IF NOT EXISTS idx_bookings_status_created
  ON bookings(status, created_at);

-- 4. Add index for fast hold expiry cleanup
CREATE INDEX IF NOT EXISTS idx_holds_status_expires
  ON reservation_holds(status, hold_expires_at);

-- 5. Track when a booking was last status-checked (for audit)
-- (bookings table already has updated_at so no new column needed)

-- 6. Verify: count orphaned records fixed
SELECT 'Cancelled pending bookings' as action,
       COUNT(*) as affected
FROM bookings
WHERE status = 'cancelled'
  AND cancel_reason LIKE 'Auto-cancelled%';
