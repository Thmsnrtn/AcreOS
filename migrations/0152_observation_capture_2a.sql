-- 0152_observation_capture_2a.sql
-- Tier 2A (elevation blueprint 2026-06-10) — observation capture: feed the
-- compounding machines.
--
-- land_credit_scores.apn/state/county — scores were reachable only through the
-- org-owned property row, which made network cohort benchmarks impossible
-- without walking org structure. Parcel identity on the score row lets cohorts
-- ("all scored parcels in this state") be assembled with no org linkage in the
-- cohort path; the privacy floor (k >= 5, mirroring marketNetworkContributor)
-- is enforced in code. Nullable: pre-0152 rows stay NULL and are excluded.
--
-- model_calibration_log — the LCS calibrator (server/services/lcsCalibrator.ts)
-- kept its EMA-adjusted per-org dimension weights in in-memory Maps, so every
-- deploy erased everything the calibration loop had learned. Each adjusted run
-- appends one row; the latest row per (org, model) is the live weight set
-- loaded on first use after a deploy. Append-only by convention — the history
-- doubles as the calibration audit trail.
--
-- provider_lookup_log.cache_lane/avoided_cost_cents — cache hits early-returned
-- before any telemetry write (provider-registry.ts ~190), making the hit rate
-- and the dollars the cache saves invisible. cache_lane names which of the four
-- cache lanes served the hit (provider_cache | provider_cache_stale |
-- parcel_snapshots | cached_lookups); avoided_cost_cents is the provider cost
-- the hit avoided, recorded only when the original cost is actually KNOWN
-- (0 otherwise — never an invented number).
--
-- Idempotent (IF NOT EXISTS throughout); self-contained block.

ALTER TABLE "land_credit_scores" ADD COLUMN IF NOT EXISTS "apn" text;
ALTER TABLE "land_credit_scores" ADD COLUMN IF NOT EXISTS "state" text;
ALTER TABLE "land_credit_scores" ADD COLUMN IF NOT EXISTS "county" text;
CREATE INDEX IF NOT EXISTS "land_credit_scores_state_county_idx"
  ON "land_credit_scores" ("state", "county", "apn");

CREATE TABLE IF NOT EXISTS "model_calibration_log" (
  "id" serial PRIMARY KEY,
  "organization_id" integer REFERENCES "organizations"("id") ON DELETE CASCADE,
  "model_name" text NOT NULL DEFAULT 'lcs_calibrator',
  "weights" jsonb NOT NULL,
  "correlations" jsonb,
  "sample_size" integer NOT NULL DEFAULT 0,
  "adjusted" boolean NOT NULL DEFAULT false,
  "reason" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "model_calibration_log_org_idx"
  ON "model_calibration_log" ("organization_id", "model_name", "created_at");

ALTER TABLE "provider_lookup_log" ADD COLUMN IF NOT EXISTS "cache_lane" text;
ALTER TABLE "provider_lookup_log" ADD COLUMN IF NOT EXISTS "avoided_cost_cents" integer DEFAULT 0;
CREATE INDEX IF NOT EXISTS "provider_lookup_cache_lane_idx"
  ON "provider_lookup_log" ("cache_lane", "created_at");
