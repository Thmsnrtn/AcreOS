-- 0295 — V-Tax-1 T2a: sourced, dated, versioned state/county procedure
-- objects; county_redemption_rates retired (founder decision 2026-10-28:
-- swap the dead tax tables for purpose-built ones, table count unchanged).
--
-- tax_procedure_objects: one row per VERSION of a county's tax-sale
-- procedure as an organization has recorded it — instrument, bid method,
-- interest or penalty, redemption period, notice requirements,
-- foreclosure / quiet-title path, subsequent-tax rules. Every field carries
-- its source (citation), the source's as-of date, whether it is state law or
-- county practice, and how it was verified. AcreOS never authors a field:
-- each is what the operator recorded from a statute or the county, and the
-- product states its provenance rather than declaring it current law.
--
-- county_verification records the completed county-verification task (who,
-- when, how). A county is biddable in AcreOS only while its current version
-- has a verification under 12 months old and no field whose source is older
-- than 12 months (shared/tax/procedure.ts).
--
-- VERSIONED, NOT EDITED: UPDATE and TRUNCATE are refused — a change is a new
-- version, so what the operator relied on at any date stays on record. DELETE
-- is allowed: organization erasure removes an org's versions with the org.
-- ORG-PRIVATE: organization_id NOT NULL, every reader filters on it; one
-- organization's verification is never shown to another.
CREATE TABLE IF NOT EXISTS "tax_procedure_objects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL,
  "state" text NOT NULL CHECK ("state" ~ '^[A-Z]{2}$'),
  "county" text NOT NULL CHECK (length(trim("county")) > 0),
  "version" integer NOT NULL CHECK ("version" >= 1),
  "fields" jsonb NOT NULL,
  "county_verification" jsonb,
  "recorded_by" text NOT NULL CHECK (length(trim("recorded_by")) > 0),
  "recorded_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "tax_procedure_objects_org_county_version_uidx" ON "tax_procedure_objects" ("organization_id", "state", lower("county"), "version");

CREATE OR REPLACE FUNCTION tax_procedure_objects_guard()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'tax_procedure_objects is versioned, never edited (% denied) — record a new version', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tax_procedure_objects_no_update ON "tax_procedure_objects";
CREATE TRIGGER tax_procedure_objects_no_update BEFORE UPDATE ON "tax_procedure_objects"
  FOR EACH ROW EXECUTE FUNCTION tax_procedure_objects_guard();
DROP TRIGGER IF EXISTS tax_procedure_objects_no_truncate ON "tax_procedure_objects";
CREATE TRIGGER tax_procedure_objects_no_truncate BEFORE TRUNCATE ON "tax_procedure_objects"
  FOR EACH STATEMENT EXECUTE FUNCTION tax_procedure_objects_guard();

-- Retire county_redemption_rates: nothing in the repository reads or writes
-- it. GUARDED and ATOMIC, exactly as 0294: if it holds a single row nothing is
-- dropped and the statement fails (customer data is never deleted by a
-- migration; a table with rows escalates to the founder).
DO $$
BEGIN
  IF to_regclass('public.county_redemption_rates') IS NOT NULL AND EXISTS (SELECT 1 FROM "county_redemption_rates" LIMIT 1) THEN
    RAISE EXCEPTION 'county_redemption_rates holds rows; nothing is dropped (V-Tax-1 T2 retires it only when empty — escalate to the founder)';
  END IF;
  DROP TABLE IF EXISTS "county_redemption_rates";
END;
$$;
