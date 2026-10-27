-- 0290 — D2b: immutable, content-addressed dataset releases + the release pointer
-- (tables approved 2026-10-25; docs/land-data/INTEGRATION-D2b.md §2a).
--
-- dataset_releases: one row per release. release_id is sha256 over the
-- canonical manifest (server/services/landData/releases/releaseManifest.ts),
-- so a row cannot be edited without breaking its own id; it is never updated,
-- deleted or truncated (triggers below).
-- dataset_release_pointer: the append-only history of which release is
-- current. Promotion and rollback are both an INSERT. (dataset, seq) is the
-- primary key and the concurrency guard: two concurrent moves both try
-- seq = n+1 and exactly one wins.
-- Both tables are GLOBAL (no organization_id): a release is the platform's
-- public-record dataset, like the owned parcel rows it is loaded into.
-- Unlike purpose_ledger there is no bypass GUC: rolling back needs every
-- release to exist, so nothing is ever pruned.
CREATE TABLE IF NOT EXISTS "dataset_releases" (
  "release_id" text PRIMARY KEY CHECK ("release_id" ~ '^sha256:[0-9a-f]{64}$'),
  "dataset" text NOT NULL CHECK ("dataset" = 'acreos-parcels'),
  "manifest_format" text NOT NULL,
  "manifest" jsonb NOT NULL,
  "county_count" integer NOT NULL CHECK ("county_count" > 0),
  "parcel_count" bigint NOT NULL CHECK ("parcel_count" >= 0),
  "artifact_bytes" bigint NOT NULL CHECK ("artifact_bytes" > 0),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "created_by" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "dataset_release_pointer" (
  "dataset" text NOT NULL,
  "seq" integer NOT NULL CHECK ("seq" >= 1),
  "action" text NOT NULL CHECK ("action" IN ('promote', 'rollback')),
  "release_id" text NOT NULL REFERENCES "dataset_releases"("release_id"),
  "release_name" text NOT NULL CHECK ("release_name" ~ '^acreos-parcels v[0-9]{4}\.(0[1-9]|1[0-2])\.[1-9][0-9]*$'),
  "previous_release_id" text REFERENCES "dataset_releases"("release_id"),
  "at" timestamp NOT NULL,
  "actor" text NOT NULL CHECK (length(trim("actor")) > 0),
  "reason" text NOT NULL CHECK (length(trim("reason")) > 0),
  PRIMARY KEY ("dataset", "seq")
);
-- A name is minted once; a release is promoted (first-made-current) once.
CREATE UNIQUE INDEX IF NOT EXISTS "dataset_release_pointer_name_once"
  ON "dataset_release_pointer" ("dataset", "release_name") WHERE "action" = 'promote';
CREATE UNIQUE INDEX IF NOT EXISTS "dataset_release_pointer_promote_once"
  ON "dataset_release_pointer" ("dataset", "release_id") WHERE "action" = 'promote';

CREATE OR REPLACE FUNCTION dataset_release_deny_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (UPDATE/DELETE/TRUNCATE denied)', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dataset_releases_no_update ON "dataset_releases";
CREATE TRIGGER dataset_releases_no_update BEFORE UPDATE ON "dataset_releases"
  FOR EACH ROW EXECUTE FUNCTION dataset_release_deny_mutation();
DROP TRIGGER IF EXISTS dataset_releases_no_delete ON "dataset_releases";
CREATE TRIGGER dataset_releases_no_delete BEFORE DELETE ON "dataset_releases"
  FOR EACH ROW EXECUTE FUNCTION dataset_release_deny_mutation();
DROP TRIGGER IF EXISTS dataset_releases_no_truncate ON "dataset_releases";
CREATE TRIGGER dataset_releases_no_truncate BEFORE TRUNCATE ON "dataset_releases"
  FOR EACH STATEMENT EXECUTE FUNCTION dataset_release_deny_mutation();
DROP TRIGGER IF EXISTS dataset_release_pointer_no_update ON "dataset_release_pointer";
CREATE TRIGGER dataset_release_pointer_no_update BEFORE UPDATE ON "dataset_release_pointer"
  FOR EACH ROW EXECUTE FUNCTION dataset_release_deny_mutation();
DROP TRIGGER IF EXISTS dataset_release_pointer_no_delete ON "dataset_release_pointer";
CREATE TRIGGER dataset_release_pointer_no_delete BEFORE DELETE ON "dataset_release_pointer"
  FOR EACH ROW EXECUTE FUNCTION dataset_release_deny_mutation();
DROP TRIGGER IF EXISTS dataset_release_pointer_no_truncate ON "dataset_release_pointer";
CREATE TRIGGER dataset_release_pointer_no_truncate BEFORE TRUNCATE ON "dataset_release_pointer"
  FOR EACH STATEMENT EXECUTE FUNCTION dataset_release_deny_mutation();

-- Every served answer records its release (null = a pre-release lane, never a
-- guess). Plain text, no FK: provider_lookup_log is high-volume telemetry; the
-- id is validated in code (isReleaseId).
ALTER TABLE "provider_lookup_log" ADD COLUMN IF NOT EXISTS "served_release_id" text;

-- The release assembly job (server/services/etlHandlers.ts
-- acreosParcelsReleaseAssembleEtlHandler): reads the latest successful build of
-- each statewide job and stores a release from the INGESTED ones. Seeded
-- INACTIVE: today every wave-1 build is a dry run, so it would honestly store
-- nothing.
INSERT INTO "etl_jobs" ("job_name", "provider_name", "source_url", "watermark_column", "schedule", "is_active", "soft_delete_on_missing", "config")
VALUES
  ('acreos_parcels_release_assemble', 'acreos_parcels_release_assemble', 'internal://etl_runs/statewide_cadastral', NULL, '*/1440 * * * *', false, false, '{}'::jsonb)
ON CONFLICT ("job_name") DO NOTHING;
