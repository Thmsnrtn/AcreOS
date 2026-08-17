-- ============================================================================
-- Devon Park (FF vertical) — rehab_photos.
-- ============================================================================
--
-- Devon §5.1: line items track "category, scope, vendor, budgeted, committed,
-- spent, variance, photos." We already track everything but the photos. This
-- is the photo evidence table that backs:
--
--   1. before / during / after evidence per line item (jobsite proof)
--   2. defect photos for warranty / disputes
--   3. lender_draw photos required for construction draws (FF-6)
--   4. tax photos — basis evidence for §1.263A capitalization
--
-- Tagging is constrained at the DB level (CHECK) because all four use cases
-- depend on the tag being one of a known small set; "freeform tag" would
-- break the lender_draw + tax surfaces silently.
--
-- Soft FK on capturedBy (users.id is varchar uuid in this codebase, not int
-- as the spec line read; following Drizzle types). SET NULL so a deleted
-- user doesn't drop the photo evidence — auditor still wants the row.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rehab_photos (
  id              varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rehab_id        uuid    NOT NULL REFERENCES rehabs(id) ON DELETE CASCADE,
  line_item_id    uuid    REFERENCES rehab_line_items(id) ON DELETE SET NULL,
  s3_key          text NOT NULL,
  caption         text,
  tag             text CHECK (tag IN ('before','during','after','defect','lender_draw','tax')),
  captured_at     timestamp with time zone DEFAULT now(),
  captured_by     varchar REFERENCES users(id) ON DELETE SET NULL,
  lat             numeric,
  lng             numeric,
  metadata        jsonb
);

CREATE INDEX IF NOT EXISTS rehab_photos_org_rehab_captured_idx
  ON rehab_photos (organization_id, rehab_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS rehab_photos_rehab_tag_idx
  ON rehab_photos (rehab_id, tag);
