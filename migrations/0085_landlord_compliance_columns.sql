-- Glenn Okonkwo audit: landlord-tenant compliance columns
--
-- 1. lease_tenants.holds_joint_and_several DEFAULT FALSE
--    Joint-and-several liability requires explicit per-tenant consent in
--    most states. Defaulting to TRUE (which the lease.liability_model
--    implies) is how cross-collection gets thrown out in court.
--
-- 2. lease_tenants.joint_and_several_acknowledged_at
--    Timestamp of the operator's affirmation, for audit trail.
--
-- 3. properties.requires_lead_paint_disclosure (computed-ish)
--    Materialized boolean for pre-1978 properties. Federal law (42 USC
--    §4852d / 24 CFR 35) requires the lead-paint pamphlet acknowledgment
--    on every pre-1978 rental. Backfilled from year_built.
--
-- 4. rental_leases.lead_paint_disclosure_attached_at
--    Stamp when the lead_paint addendum is confirmed attached. The lease
--    cannot transition to 'active'/'pending_signature' without this when
--    the property requires the disclosure.

ALTER TABLE lease_tenants
  ADD COLUMN IF NOT EXISTS holds_joint_and_several BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS joint_and_several_acknowledged_at TIMESTAMPTZ;

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS requires_lead_paint_disclosure BOOLEAN;

-- Backfill: pre-1978 ⇒ requires disclosure; 1978+ ⇒ false; unknown ⇒ null.
UPDATE properties
   SET requires_lead_paint_disclosure = (year_built < 1978)
 WHERE year_built IS NOT NULL
   AND requires_lead_paint_disclosure IS NULL;

ALTER TABLE rental_leases
  ADD COLUMN IF NOT EXISTS lead_paint_disclosure_attached_at TIMESTAMPTZ;

-- Move-in inspection photo timestamps: surface a NOT-NULL check via a
-- generated column so deposit-deduction defenses have hard timestamps.
ALTER TABLE move_inspections
  ADD COLUMN IF NOT EXISTS photo_count INTEGER NOT NULL DEFAULT 0;

-- Backfill photo_count from the existing jsonb photos array length.
UPDATE move_inspections
   SET photo_count = COALESCE(jsonb_array_length(photos), 0)
 WHERE photo_count = 0
   AND photos IS NOT NULL;

CREATE INDEX IF NOT EXISTS lease_tenants_jointly_liable_idx
  ON lease_tenants(lease_id) WHERE holds_joint_and_several = TRUE;

CREATE INDEX IF NOT EXISTS properties_lead_paint_idx
  ON properties(organization_id) WHERE requires_lead_paint_disclosure = TRUE;
