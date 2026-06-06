-- 0120 — Open-data provenance, licensing register, and free-miss telemetry.
-- First-customer readiness keystone (Iris / Lena / Beatrice / Quinn lenses).
--
-- Three changes, all idempotent:
--   1. county_gis_endpoints: per-county license/redistribution columns. Every
--      row defaults redistributable='review-required' so the registry treats
--      un-reviewed counties as live-passthrough only (no bulk cache/redistribute)
--      until a human reads the portal terms and flips it. (Beatrice items 1+2.)
--   2. provider_lookup_log: state/county columns + index for the
--      free-miss-by-county rollup that drives the data-driven paid-data buy
--      decision. (Iris/Lena.)
--   3. No change to provider_cache columns — provenance (source/sourceAsOf/
--      classification) is persisted inside the existing response_data JSONB.

-- 1. county_gis_endpoints licensing register columns
ALTER TABLE "county_gis_endpoints" ADD COLUMN IF NOT EXISTS "license" text DEFAULT 'county-tos';
ALTER TABLE "county_gis_endpoints" ADD COLUMN IF NOT EXISTS "attribution" text;
ALTER TABLE "county_gis_endpoints" ADD COLUMN IF NOT EXISTS "terms_url" text;
ALTER TABLE "county_gis_endpoints" ADD COLUMN IF NOT EXISTS "redistributable" text NOT NULL DEFAULT 'review-required';
ALTER TABLE "county_gis_endpoints" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp;
ALTER TABLE "county_gis_endpoints" ADD COLUMN IF NOT EXISTS "reviewed_by" text;

-- 2. provider_lookup_log free-miss-by-county telemetry
ALTER TABLE "provider_lookup_log" ADD COLUMN IF NOT EXISTS "state" text;
ALTER TABLE "provider_lookup_log" ADD COLUMN IF NOT EXISTS "county" text;
CREATE INDEX IF NOT EXISTS "provider_lookup_county_idx"
  ON "provider_lookup_log" ("state", "county", "category");
