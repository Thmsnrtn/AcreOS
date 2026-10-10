-- 0270 — W2 land-data foundation (Tennessee showcase). No new tables (the
-- table-count ratchet only shrinks): the on-demand county pipeline is a
-- second lifecycle on the per-county coverage row (county_discovery_queue),
-- and owned parcels are parcel_snapshots rows with source = 'owned_pipeline'
-- carrying a stable parcel key and the derived facts. Mirrors
-- shared/schema.ts + shared/schema/parcel-data.ts and the matching block in
-- scripts/migrate.mjs. Idempotent.
ALTER TABLE "county_discovery_queue" ADD COLUMN IF NOT EXISTS "owned_status" text;
ALTER TABLE "county_discovery_queue" ADD COLUMN IF NOT EXISTS "owned_refusal_reason" text;
ALTER TABLE "county_discovery_queue" ADD COLUMN IF NOT EXISTS "owned_demand" integer NOT NULL DEFAULT 0;
ALTER TABLE "county_discovery_queue" ADD COLUMN IF NOT EXISTS "owned_next_offset" integer NOT NULL DEFAULT 0;
ALTER TABLE "county_discovery_queue" ADD COLUMN IF NOT EXISTS "owned_parcels_stored" integer NOT NULL DEFAULT 0;
ALTER TABLE "county_discovery_queue" ADD COLUMN IF NOT EXISTS "owned_attempts" integer NOT NULL DEFAULT 0;
ALTER TABLE "county_discovery_queue" ADD COLUMN IF NOT EXISTS "owned_last_error" text;
ALTER TABLE "county_discovery_queue" ADD COLUMN IF NOT EXISTS "owned_started_at" timestamp;
ALTER TABLE "county_discovery_queue" ADD COLUMN IF NOT EXISTS "owned_completed_at" timestamp;
ALTER TABLE "county_discovery_queue" ADD COLUMN IF NOT EXISTS "owned_artifacts" jsonb;
ALTER TABLE "parcel_snapshots" ADD COLUMN IF NOT EXISTS "parcel_key" text;
ALTER TABLE "parcel_snapshots" ADD COLUMN IF NOT EXISTS "facts" jsonb;
ALTER TABLE "parcel_snapshots" ADD COLUMN IF NOT EXISTS "facts_computed_at" timestamp;
