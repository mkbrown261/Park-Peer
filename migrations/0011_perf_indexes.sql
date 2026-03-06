-- ── Migration 0011: Performance indexes ─────────────────────────────────────
-- Compound index for race-condition booking guard:
--   SELECT … FROM bookings WHERE listing_id = ? AND status IN (…)
-- Without this, the query does a full-table scan on bookings.
CREATE INDEX IF NOT EXISTS idx_bookings_listing_status
  ON bookings(listing_id, status);

-- Fast lookup of payments by Stripe payment_intent_id (webhook + refund flow)
CREATE INDEX IF NOT EXISTS idx_payments_stripe_pi
  ON payments(stripe_payment_intent_id);

-- Fast lookup of bookings by payment_intent_id (confirm-booking endpoint)
CREATE INDEX IF NOT EXISTS idx_bookings_stripe_pi
  ON bookings(stripe_payment_intent_id);

-- Composite index for the listings geo+status hot query path
-- (status is already indexed; adding type improves type-filtered geo queries)
CREATE INDEX IF NOT EXISTS idx_listings_status_type
  ON listings(status, type);

-- Composite index for the availability_blocks lookup by listing + time range
CREATE INDEX IF NOT EXISTS idx_avail_listing_times
  ON availability_blocks(listing_id, start_time, end_time);

-- Speed up notifications mark-as-read + count queries
CREATE INDEX IF NOT EXISTS idx_notif_user_inapp
  ON notifications(user_id, delivery_inapp, read_status);
