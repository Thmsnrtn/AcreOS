-- ============================================================================
-- 0097_lead_photos.sql — Drive Mode photo evidence.
-- ============================================================================
--
-- Drive Mode is the mobile driving-for-dollars surface. Investors capture a
-- lead from the curb with one tap (GPS + reverse-geocode) and optionally
-- attach a phone-camera photo for the lead's evidence trail.
--
-- This table is the photo evidence backing surface. It mirrors the shape
-- of rehab_photos (0089) intentionally — same s3 key + caption + capturedAt
-- + lat/lng + capturedBy columns — so the blob-storage driver (Wave 10 per
-- docs/cost/blob-storage-migration.md) only has to learn one row shape.
--
-- ON DELETE:
--   organization_id  CASCADE — org tear-down removes all leads + their photos.
--   lead_id          CASCADE — deleting a lead removes its photos.
--   captured_by      SET NULL — auditor needs the photo to outlive the user.
-- ============================================================================

CREATE TABLE IF NOT EXISTS lead_photos (
  id              varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id         integer NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  s3_key          text NOT NULL,
  caption         text,
  captured_at     timestamp with time zone DEFAULT now(),
  lat             numeric,
  lng             numeric,
  captured_by     varchar REFERENCES users(id) ON DELETE SET NULL
);

-- Gallery path — most-recent first, per lead, per org.
CREATE INDEX IF NOT EXISTS lead_photos_org_lead_captured_idx
  ON lead_photos (organization_id, lead_id, captured_at DESC);
