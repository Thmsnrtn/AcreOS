-- Tahoe Tess — persisted apiTelemetry follow-on: distinct_orgs on samples.
--
-- The durable api_telemetry_samples table (L14) counts per-route requests +
-- latency per flush window, and the nightly rollup folds those into
-- api_telemetry_rollup_monthly. The rollup table already has a distinct_orgs
-- column, but it was hard-coded to 0 in the aggregator because the source
-- samples carried no org dimension — i.e. a dead field.
--
-- This adds distinct_orgs to api_telemetry_samples. The live middleware
-- (server/middleware/apiTelemetry.ts) now tracks a Set<organizationId> per
-- route bucket and writes the set size at flush; the rollup SUMs it into
-- api_telemetry_rollup_monthly.distinct_orgs. The column is non-null with a
-- 0 default so existing rows + unauthenticated/pre-org routes stay valid.
--
-- Idempotent — safe to re-run.

ALTER TABLE "api_telemetry_samples"
  ADD COLUMN IF NOT EXISTS "distinct_orgs" integer NOT NULL DEFAULT 0;
