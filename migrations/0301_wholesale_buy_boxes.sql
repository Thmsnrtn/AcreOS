-- 0301 — Wholesale package Leg 2: the operator's buy box, versioned.
--
-- The ONE table the wholesale package pre-named, approved 2026-11-05 by the
-- coordinator under the founder's full-readiness directive
-- (docs/company/founder-decisions-2026-11-05-wholesale-buy-box.md). No other
-- schema change rides along.
--
-- A buy box is the operator's OWN criteria for which of their OWN candidates
-- they would wholesale. It holds no sourcing data, no owner, no list: it is
-- read against properties the org already has.
--
-- APPEND-ONLY, ORG-PRIVATE. Every save is a NEW row with the next version; the
-- reader takes the highest. UPDATE and TRUNCATE are refused by trigger; a
-- DELETE is allowed only inside the organization's ON DELETE CASCADE, so an
-- organization stays erasable while its history cannot be rewritten.
CREATE TABLE IF NOT EXISTS "wholesale_buy_boxes" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "version" integer NOT NULL CHECK ("version" >= 1),
  "criteria" jsonb NOT NULL,
  "created_by" text NOT NULL CHECK (length(trim("created_by")) > 0),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "wholesale_buy_boxes_org_version_uq" UNIQUE ("organization_id", "version")
);
CREATE INDEX IF NOT EXISTS "wholesale_buy_boxes_org_version_idx" ON "wholesale_buy_boxes" ("organization_id", "version");

CREATE OR REPLACE FUNCTION wholesale_buy_boxes_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "organizations" WHERE "id" = OLD."organization_id") THEN
      RAISE EXCEPTION 'wholesale_buy_boxes rows leave only with their organization (save a new version instead)'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'wholesale_buy_boxes is append-only (% denied)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS wholesale_buy_boxes_no_update ON "wholesale_buy_boxes";
CREATE TRIGGER wholesale_buy_boxes_no_update BEFORE UPDATE ON "wholesale_buy_boxes"
  FOR EACH ROW EXECUTE FUNCTION wholesale_buy_boxes_guard();
DROP TRIGGER IF EXISTS wholesale_buy_boxes_delete_with_org ON "wholesale_buy_boxes";
CREATE TRIGGER wholesale_buy_boxes_delete_with_org BEFORE DELETE ON "wholesale_buy_boxes"
  FOR EACH ROW EXECUTE FUNCTION wholesale_buy_boxes_guard();
DROP TRIGGER IF EXISTS wholesale_buy_boxes_no_truncate ON "wholesale_buy_boxes";
CREATE TRIGGER wholesale_buy_boxes_no_truncate BEFORE TRUNCATE ON "wholesale_buy_boxes"
  FOR EACH STATEMENT EXECUTE FUNCTION wholesale_buy_boxes_guard();
