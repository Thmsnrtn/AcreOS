-- 0291 — D2c: APIDs, APN validity windows and lineage events (tables approved
-- 2026-10-25; docs/land-data/INTEGRATION-D2c.md §4, whose DDL defines exactly
-- these three tables).
--
-- parcel_apids         one row per APID ever minted — never deleted, never
--                      re-assigned. status moves active → retired | held as a
--                      release ends it (the one mutable fact about an APID).
-- parcel_apn_windows   which APN named which APID over release ordinals,
--                      half-open [valid_from, valid_to); valid_to NULL = open.
-- parcel_lineage_events the non-`same` lineage events of each applied release
--                      (split / merge / renumber / condo / retired / new /
--                      ambiguous) with their overlap evidence. Append-only.
-- All three are GLOBAL (no organization_id): they describe land, from the
-- platform's public-record parcel releases.
--
-- Deviations from the §4 DDL, each deliberate:
--   - parcel_apids gains parents / candidate_parents (text[]): the ledger
--     (shared/landData/apid.ts ApidRecord) carries them and the DDL omitted
--     them.
--   - No btree_gist EXCLUDE constraints: CREATE EXTENSION is not guaranteed on
--     the production Postgres, and a failed extension fails the deploy. The
--     §4 fallback is used instead — partial unique indexes allow at most ONE
--     open window per APN and per APID — and the writer runs
--     ledgerViolations() (historical non-overlap) before every commit
--     (server/services/landData/apidStore.ts).
CREATE TABLE IF NOT EXISTS "parcel_apids" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "apid" text NOT NULL UNIQUE CHECK ("apid" ~ '^APID-[A-Z]{2}-[0-9]{5}-[0-9]{7,}$'),
  "state" char(2) NOT NULL,
  "county_fips" char(5) NOT NULL,
  "seq" bigint NOT NULL CHECK ("seq" >= 1),
  "status" text NOT NULL CHECK ("status" IN ('active', 'retired', 'held')),
  "provisional" boolean NOT NULL DEFAULT false,
  "parents" text[] NOT NULL DEFAULT '{}',
  "candidate_parents" text[] NOT NULL DEFAULT '{}',
  "minted_in_release" text NOT NULL,
  "ended_in_release" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("state", "county_fips", "seq"),
  CHECK (("status" = 'active') = ("ended_in_release" IS NULL))
);

CREATE TABLE IF NOT EXISTS "parcel_apn_windows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "apid_id" uuid NOT NULL REFERENCES "parcel_apids"("id"),
  "state" char(2) NOT NULL,
  "county_fips" char(5) NOT NULL,
  "apn" text NOT NULL,
  "valid_from" integer NOT NULL,
  "valid_to" integer,
  "valid_from_release" text NOT NULL,
  "valid_to_release" text,
  CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from"),
  CHECK (("valid_to" IS NULL) = ("valid_to_release" IS NULL))
);
CREATE INDEX IF NOT EXISTS "parcel_apn_windows_county_idx" ON "parcel_apn_windows" ("state", "county_fips");
-- At most one open window per APN and per APID (the §4 fallback for EXCLUDE).
CREATE UNIQUE INDEX IF NOT EXISTS "parcel_apn_windows_one_open_per_apn"
  ON "parcel_apn_windows" ("state", "county_fips", "apn") WHERE "valid_to" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "parcel_apn_windows_one_open_per_apid"
  ON "parcel_apn_windows" ("apid_id") WHERE "valid_to" IS NULL;

CREATE TABLE IF NOT EXISTS "parcel_lineage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "state" char(2) NOT NULL,
  "county_fips" char(5) NOT NULL,
  "release_id" text NOT NULL,
  "release_ordinal" integer NOT NULL,
  "kind" text NOT NULL CHECK ("kind" IN ('same', 'renumber', 'split', 'merge', 'condo', 'retired', 'new', 'ambiguous')),
  "basis" text NOT NULL CHECK ("basis" IN ('geometry', 'id_only')),
  "reason" text,
  "previous_apids" text[] NOT NULL,
  "next_apids" text[] NOT NULL,
  "previous_apns" text[] NOT NULL,
  "next_apns" text[] NOT NULL,
  "evidence" jsonb NOT NULL,
  "resolved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CHECK (("kind" = 'ambiguous') = ("reason" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS "parcel_lineage_events_county_idx" ON "parcel_lineage_events" ("state", "county_fips", "release_ordinal");

CREATE OR REPLACE FUNCTION parcel_lineage_events_deny_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'parcel_lineage_events is append-only (UPDATE/DELETE/TRUNCATE denied)'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS parcel_lineage_events_no_update ON "parcel_lineage_events";
CREATE TRIGGER parcel_lineage_events_no_update BEFORE UPDATE ON "parcel_lineage_events"
  FOR EACH ROW EXECUTE FUNCTION parcel_lineage_events_deny_mutation();
DROP TRIGGER IF EXISTS parcel_lineage_events_no_delete ON "parcel_lineage_events";
CREATE TRIGGER parcel_lineage_events_no_delete BEFORE DELETE ON "parcel_lineage_events"
  FOR EACH ROW EXECUTE FUNCTION parcel_lineage_events_deny_mutation();
DROP TRIGGER IF EXISTS parcel_lineage_events_no_truncate ON "parcel_lineage_events";
CREATE TRIGGER parcel_lineage_events_no_truncate BEFORE TRUNCATE ON "parcel_lineage_events"
  FOR EACH STATEMENT EXECUTE FUNCTION parcel_lineage_events_deny_mutation();

-- The lineage job (server/services/etlHandlers.ts
-- acreosParcelsLineageApplyEtlHandler): applies the CURRENT release's
-- lineage to each county's APID ledger. Seeded INACTIVE (no release exists yet).
INSERT INTO "etl_jobs" ("job_name", "provider_name", "source_url", "watermark_column", "schedule", "is_active", "soft_delete_on_missing", "config")
VALUES
  ('acreos_parcels_lineage_apply', 'acreos_parcels_lineage_apply', 'internal://dataset_release_pointer', NULL, '*/1440 * * * *', false, false, '{}'::jsonb)
ON CONFLICT ("job_name") DO NOTHING;
