-- ============================================================================
-- 0127 — Iyari (Chief of Future) #2 — Persist the Land Intelligence Report.
-- ----------------------------------------------------------------------------
-- The LIS report (generateLandIntelligenceReport) is otherwise a cold recompute
-- against ~8 external APIs on every view. This table persists the computed
-- report + its per-field provenance + a staleAfter policy so a re-opened parcel
-- renders from our store in <100ms and we only recompute once it is stale.
--
-- It also quietly becomes the eval corpus (Iyari #6): a labeled set of
-- free-data reports to diff against paid data when MRR justifies a trial.
--
-- IMPORTANT: this wraps the fusion COMPUTATION (store-read / store-write)
-- WITHOUT changing the fusion math. `report` is the verbatim
-- LandIntelligenceReport JSON the fusion produced.
--
-- Indexes:
--   * (organization_id, parcel_key) — LEADING-org composite for shard-readiness
--     (per scripts/check-org-leading-index.mjs); tenant routing is one probe.
--   * (apn, computed_at)            — longitudinal "score over time" / corpus.
--
-- Mirrors shared/schema.ts (landIntelligenceReports) + scripts/migrate.mjs STATEMENTS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "land_intelligence_reports" (
  "id" serial PRIMARY KEY,
  "organization_id" integer REFERENCES "organizations" ("id"),
  "parcel_key" text NOT NULL,
  "apn" text,
  "state" text NOT NULL,
  "county" text NOT NULL,
  "latitude" numeric,
  "longitude" numeric,
  "acres" numeric,
  "report" jsonb NOT NULL,
  "field_provenance" jsonb,
  "land_intelligence_score" integer,
  "recommendation" text,
  "computed_at" timestamp NOT NULL DEFAULT now(),
  "stale_after" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "land_intelligence_reports_org_key_idx"
  ON "land_intelligence_reports" ("organization_id", "parcel_key");
CREATE INDEX IF NOT EXISTS "land_intelligence_reports_apn_computed_idx"
  ON "land_intelligence_reports" ("apn", "computed_at");
