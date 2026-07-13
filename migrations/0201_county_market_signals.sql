-- ============================================================================
-- 0201 — County market signals (Open-Data Program Phase 2.1 + 2.2)
-- ----------------------------------------------------------------------------
-- Two PLATFORM-GLOBAL reference tables (no organization_id, like
-- marketing_spend) feeding the County Opportunity Score:
--
--   county_migration_summary — IRS SOI county-to-county migration totals.
--     One row per (county, filing year). Sourced from the IRS-published
--     "Total Migration-US and Foreign" summary rows (pseudo-state-FIPS 96)
--     in countyinflowYYZZ.csv / countyoutflowYYZZ.csv — NOT summed from the
--     county-pair detail, which is suppressed below 10 returns and would
--     undercount. AGI is in thousands of dollars as published. Suppressed
--     values (-1) are stored as NULL — nulls are honest, never fabricated.
--
--   county_building_permits — Census BPS annual county permit units
--     (co{YYYY}a.txt). single_family = 1-unit structures; multi_family =
--     2 + 3-4 + 5+ unit structures; total = the sum.
--
-- Also seeds the two etl_jobs rows DISABLED (mirrors 0070's seeding) so an
-- operator flips them on via the founder /etl UI. Both upstreams are free,
-- keyless federal CSVs — no credentials to configure. Cron is monthly so a
-- newly published year is picked up within a month; the handlers no-op
-- cheaply when the watermark already covers the newest available file.
-- Mirrors shared/schema.ts (countyMigrationSummary, countyBuildingPermits)
-- + scripts/migrate.mjs. Idempotent (IF NOT EXISTS) — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "county_migration_summary" (
  "id" serial PRIMARY KEY,
  "state_fips" text NOT NULL,
  "county_fips" text NOT NULL,
  "filing_year" text NOT NULL,
  "inflow_returns" integer,
  "inflow_individuals" integer,
  "inflow_agi_thousands" bigint,
  "outflow_returns" integer,
  "outflow_individuals" integer,
  "outflow_agi_thousands" bigint,
  "net_returns" integer,
  "net_agi_thousands" bigint,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "county_migration_summary_fips_year_idx"
  ON "county_migration_summary" ("state_fips", "county_fips", "filing_year");

CREATE TABLE IF NOT EXISTS "county_building_permits" (
  "id" serial PRIMARY KEY,
  "state_fips" text NOT NULL,
  "county_fips" text NOT NULL,
  "year" integer NOT NULL,
  "total_units" integer NOT NULL,
  "single_family_units" integer NOT NULL,
  "multi_family_units" integer NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "county_building_permits_fips_year_idx"
  ON "county_building_permits" ("state_fips", "county_fips", "year");

INSERT INTO "etl_jobs" ("job_name", "provider_name", "source_url", "watermark_column", "schedule", "is_active", "soft_delete_on_missing")
VALUES
  ('irs_soi_migration_v1', 'irs_soi_migration_v1', 'https://www.irs.gov/pub/irs-soi', 'filing_year', '0 4 1 * *', false, false),
  ('census_bps_permits_v1', 'census_bps_permits_v1', 'https://www2.census.gov/econ/bps/County', 'year', '0 5 1 * *', false, false)
ON CONFLICT ("job_name") DO NOTHING;
