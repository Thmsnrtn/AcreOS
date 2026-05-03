-- Aniyah §2: Indian-Country awareness for property records.
-- Adds a land_status column to properties so that auto-AVM, blind-offer
-- generation, and contract auto-doc can be blocked on tribal trust,
-- individual trust, restricted-fee, fee-within-reservation, and off-
-- reservation trust parcels (25 USC §177, 25 CFR §152).
--
-- Default 'unknown' is intentional: existing rows have not been verified,
-- so they MUST block automation until a human reviews them.
--
-- Allowed values:
--   fee
--   tribal_trust
--   individual_trust
--   restricted_fee
--   fee_within_reservation
--   off_reservation_trust
--   unknown
--
-- TODO(LAR-overlay): Phase B will auto-populate this from the BIA Land Area
-- Representations shapefile overlay. Phase A (this migration) ships a
-- manual-verification workflow only.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS land_status TEXT NOT NULL DEFAULT 'unknown';
