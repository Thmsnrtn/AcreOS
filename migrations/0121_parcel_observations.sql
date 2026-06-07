-- ============================================================================
-- 0121 — Iyari (Chief of Future) — Parcel Observation Log (the acorn).
-- ----------------------------------------------------------------------------
-- Append-only, NEVER updated. Every time any path (lookup, ETL, fusion,
-- customer edit) sees a fact about a parcel, we write one immutable row.
-- `parcel_snapshots` stays the fast "current best view" cache; observations
-- become the longitudinal system-of-record the cache is derived from.
--
-- The strategic bet: longitudinal parcel facts (assessed value, owner, tax
-- status over time) are the one asset you cannot buy retroactively. Capturing
-- them costs one async insert per fact today; backfilling later is impossible.
-- Written fire-and-forget by server/services/data-cache/observation-log.ts —
-- it must never block or fail a parcel response.
--
-- Indexes:
--   * (organization_id, observed_at) — LEADING-org composite for shard-readiness
--     (per scripts/check-org-leading-index.mjs); tenant routing is one probe.
--   * (apn, field, observed_at)      — query path for the future owner-change /
--     tax-status delta detector ("latest N observations per (apn, field)").
--
-- Mirrors shared/schema.ts (parcelObservations) + scripts/migrate.mjs STATEMENTS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "parcel_observations" (
  "id" serial PRIMARY KEY,
  "organization_id" integer REFERENCES "organizations" ("id"),
  "apn" text NOT NULL,
  "state" text NOT NULL,
  "county" text NOT NULL,
  "field" text NOT NULL,
  "value" jsonb,
  "source" text NOT NULL,
  "confidence" real,
  "observed_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "parcel_observations_org_observed_idx"
  ON "parcel_observations" ("organization_id", "observed_at");
CREATE INDEX IF NOT EXISTS "parcel_observations_apn_field_observed_idx"
  ON "parcel_observations" ("apn", "field", "observed_at");
