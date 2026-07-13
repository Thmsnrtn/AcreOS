-- ============================================================================
-- 0202 — County employment & wages (Open-Data Program Phase 2.3, keyless leg)
-- ----------------------------------------------------------------------------
-- One PLATFORM-GLOBAL reference table (no organization_id, like
-- marketing_spend) feeding the County Opportunity Score:
--
--   county_employment_wages — BLS QCEW annual averages per county, from the
--     keyless open-data slice
--     https://data.bls.gov/cew/data/api/{year}/a/industry/10.csv
--     (industry 10 = "total, all industries", every area in one CSV).
--     Rows are filtered to own_code=0 + agglvl_code=70 — county, total
--     covered, all ownerships — which excludes national/state/MSA rollups
--     and per-ownership detail. The XX999 "unknown or undefined" pseudo-
--     counties are skipped. Counties suppressed by BLS (disclosure_code 'N',
--     published as zeros) store NULL employment/wage — nulls are honest,
--     never fabricated; establishment counts are published even for
--     suppressed counties and are kept.
--
-- Also seeds the etl_jobs row DISABLED (mirrors 0201's seeding) so an
-- operator flips it on via the founder /etl UI. The upstream is a free,
-- keyless federal CSV — no credentials to configure. Cron is monthly so a
-- newly published year is picked up within a month; the handler no-ops
-- cheaply when the watermark already covers the newest available year.
-- Mirrors shared/schema.ts (countyEmploymentWages) + scripts/migrate.mjs.
-- Idempotent (IF NOT EXISTS) — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "county_employment_wages" (
  "id" serial PRIMARY KEY,
  "state_fips" text NOT NULL,
  "county_fips" text NOT NULL,
  "year" integer NOT NULL,
  "avg_employment" integer,
  "avg_weekly_wage" integer,
  "establishments" integer,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "county_employment_wages_fips_year_idx"
  ON "county_employment_wages" ("state_fips", "county_fips", "year");

INSERT INTO "etl_jobs" ("job_name", "provider_name", "source_url", "watermark_column", "schedule", "is_active", "soft_delete_on_missing")
VALUES
  ('bls_qcew_employment_v1', 'bls_qcew_employment_v1', 'https://data.bls.gov/cew/data/api', 'year', '0 6 1 * *', false, false)
ON CONFLICT ("job_name") DO NOTHING;
