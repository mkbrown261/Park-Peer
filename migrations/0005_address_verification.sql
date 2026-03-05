-- ParkPeer D1 Schema — Migration 005: Address Verification & Geocoding
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds verified geocoordinate tracking to listings.
-- place_id       — Mapbox feature ID (e.g. "address.abc123")
-- address_verified — 1 = host selected from autocomplete, 0 = legacy/unverified
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE listings ADD COLUMN place_id         TEXT DEFAULT NULL;
ALTER TABLE listings ADD COLUMN address_verified  INTEGER NOT NULL DEFAULT 0;
-- 1 = address was selected from Mapbox autocomplete and has valid lat/lng
-- 0 = legacy listing or manually entered (read-only, cannot be re-listed)

-- Back-fill existing listings that already have lat/lng as "verified enough"
-- (they were geocoded by the server previously)
UPDATE listings SET address_verified = 1 WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- Index for filtering verified listings only
CREATE INDEX IF NOT EXISTS idx_listings_verified ON listings(address_verified);
