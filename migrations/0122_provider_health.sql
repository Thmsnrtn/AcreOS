-- ============================================================================
-- 0122 — Tess (SRE) — Per-source synthetic-probe health.
-- ----------------------------------------------------------------------------
-- The free county/federal data sources ARE the product, but a 200 OK from a
-- MapServer root does NOT prove a real flood-zone lookup at a known lat/lng
-- still works — schemas drift, layers get renumbered, query params change.
--
-- The dataSourceProbe job (server/jobs/dataSourceProbe.ts, registered in
-- runScheduledJobs.ts on the warm worker every ~30m) runs 3–5 GOLDEN PARCELS
-- through the provider registry and asserts the *expected shape + a plausible
-- value* (a flood zone in the FEMA enum, a soil series string, an elevation in
-- range). Each pass/fail + measured latency is written here. This is the canary
-- that turns "the county changed their API at 9am" from a customer staring at a
-- blank map into a founder alert.
--
-- Global infrastructure table (no organization_id) — the leading-org-index
-- lint (scripts/check-org-leading-index.mjs) correctly skips it.
--
-- Mirrors shared/schema.ts (providerHealth) + scripts/migrate.mjs STATEMENTS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "provider_health" (
  "id" serial PRIMARY KEY,
  "source" text NOT NULL,
  "category" text NOT NULL,
  "probe" text NOT NULL,
  "healthy" boolean NOT NULL,
  "latency_ms" integer,
  "detail" text,
  "checked_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "provider_health_source_idx"
  ON "provider_health" ("source", "checked_at");
CREATE INDEX IF NOT EXISTS "provider_health_checked_idx"
  ON "provider_health" ("checked_at");
