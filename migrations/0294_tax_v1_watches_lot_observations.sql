-- 0294 — V-Tax-1 T1: county watch lists and per-field observations on
-- imported tax lots; the two dead tables they replace are retired (founder
-- decision 2026-10-28: swap the four dead tax tables for four purpose-built
-- ones, table count unchanged — T1 swaps two, T2 the other two).
--
-- tax_sale_listings gains what a tax list states that the table could not
-- hold: the sale date the list states, and the import that wrote the row.
-- total_tax_owed becomes NULLABLE: a list that does not state the amount owed
-- is recorded as not stating it, never as a figure (V-Tax-1 T1: "amount owed
-- where the list states it").
ALTER TABLE "tax_sale_listings" ADD COLUMN IF NOT EXISTS "sale_date" date;
ALTER TABLE "tax_sale_listings" ADD COLUMN IF NOT EXISTS "import_id" uuid;
ALTER TABLE "tax_sale_listings" ALTER COLUMN "total_tax_owed" DROP NOT NULL;

-- tax_county_watches: a watch is COUNTY-SCOPED and carries the county's
-- redemption period, sale type and auction cadence as DATA — each a stated
-- value with its source and as-of, or null (unknown). Never a national
-- default. Org-private: organization_id NOT NULL, every reader filters on it.
CREATE TABLE IF NOT EXISTS "tax_county_watches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL,
  "state" text NOT NULL CHECK ("state" ~ '^[A-Z]{2}$'),
  "county" text NOT NULL CHECK (length(trim("county")) > 0),
  -- { redemptionPeriodMonths?: Stated<number>, saleType?: Stated<string>,
  --   auctionCadence?: Stated<string> }, Stated = { value, source, asOf }.
  -- An absent key is unknown.
  "terms" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by" text NOT NULL CHECK (length(trim("created_by")) > 0),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "tax_county_watches_org_county_uidx" ON "tax_county_watches" ("organization_id", "state", lower("county"));

-- tax_lot_observations: every value a source stated for an imported tax lot's
-- field, with its provenance — and the recorded ABSENCES (kind
-- 'searched_none'): a list column that is blank for the lot, or a parcel
-- search that ran and found nothing. The Notes N1/N4 pattern
-- (note_field_observations, 0292) applied to tax lots: nothing is ever
-- resolved, averaged or overwritten; a later source that disagrees adds a
-- row beside the earlier one.
--
-- APPEND-ONLY on the same terms as 0292: UPDATE and TRUNCATE refused; a
-- DELETE allowed only when the lot itself is gone (its ON DELETE CASCADE),
-- refused with foreign_key_violation otherwise, so organization erasure
-- removes these through the lot.
CREATE TABLE IF NOT EXISTS "tax_lot_observations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL,
  "listing_id" integer NOT NULL REFERENCES "tax_sale_listings"("id") ON DELETE CASCADE,
  "field" text NOT NULL CHECK ("field" ~ '^[a-zA-Z][a-zA-Z0-9_.]*$'),
  "kind" text NOT NULL CHECK ("kind" IN ('value', 'searched_none')),
  "value" jsonb,
  "source" text NOT NULL CHECK ("source" IN ('tax_list', 'operator_correction', 'warehouse', 'auction')),
  "source_ref" jsonb NOT NULL,
  "as_of" date,
  "confidence" text NOT NULL CHECK ("confidence" IN ('high', 'medium', 'low')),
  "confidence_basis" text NOT NULL CHECK (length(trim("confidence_basis")) > 0),
  "decay_class" text NOT NULL CHECK ("decay_class" IN ('stable', 'years', 'about_a_year', 'months', 'continuous', 'event')),
  "import_id" uuid,
  "recorded_by" text NOT NULL CHECK (length(trim("recorded_by")) > 0),
  "observed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tax_lot_observations_value_iff_kind" CHECK (("kind" = 'value') = ("value" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS "tax_lot_observations_org_listing_idx" ON "tax_lot_observations" ("organization_id", "listing_id", "field", "observed_at");

CREATE OR REPLACE FUNCTION tax_lot_observations_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "tax_sale_listings" WHERE "id" = OLD."listing_id") THEN
      RAISE EXCEPTION 'tax_lot_observations rows leave only with their lot (delete the lot, not its history)'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'tax_lot_observations is append-only (% denied)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tax_lot_observations_no_update ON "tax_lot_observations";
CREATE TRIGGER tax_lot_observations_no_update BEFORE UPDATE ON "tax_lot_observations"
  FOR EACH ROW EXECUTE FUNCTION tax_lot_observations_guard();
DROP TRIGGER IF EXISTS tax_lot_observations_delete_with_lot ON "tax_lot_observations";
CREATE TRIGGER tax_lot_observations_delete_with_lot BEFORE DELETE ON "tax_lot_observations"
  FOR EACH ROW EXECUTE FUNCTION tax_lot_observations_guard();
DROP TRIGGER IF EXISTS tax_lot_observations_no_truncate ON "tax_lot_observations";
CREATE TRIGGER tax_lot_observations_no_truncate BEFORE TRUNCATE ON "tax_lot_observations"
  FOR EACH STATEMENT EXECUTE FUNCTION tax_lot_observations_guard();

-- Retire the two dead tables this replaces. Nothing in the repository reads
-- or writes either. GUARDED: if either holds a single row nothing is dropped
-- and the statement fails — customer data is never deleted by a migration
-- (CLAUDE.md hard-stop); a table with rows escalates to the founder.
--
-- The checks and the drops are ONE statement on purpose. scripts/migrate.mjs
-- logs a failed statement and runs the next one, so a guard in its own
-- statement followed by a separate DROP would drop the table anyway.
DO $$
BEGIN
  IF to_regclass('public.tax_sale_alerts') IS NOT NULL AND EXISTS (SELECT 1 FROM "tax_sale_alerts" LIMIT 1) THEN
    RAISE EXCEPTION 'tax_sale_alerts holds rows; nothing is dropped (V-Tax-1 T1 retires it only when empty — escalate to the founder)';
  END IF;
  IF to_regclass('public.lien_search_records') IS NOT NULL AND EXISTS (SELECT 1 FROM "lien_search_records" LIMIT 1) THEN
    RAISE EXCEPTION 'lien_search_records holds rows; nothing is dropped (V-Tax-1 T1 retires it only when empty — escalate to the founder)';
  END IF;
  DROP TABLE IF EXISTS "tax_sale_alerts";
  DROP TABLE IF EXISTS "lien_search_records";
END;
$$;
