-- 0157_county_market_rollups.sql
-- Tier 3F (elevation blueprint 2026-06-10) — cross-org data co-op.
--
-- county_market_rollups — privacy-preserving county-level market aggregates
-- computed monthly from cross-org observations (parcel_observations density,
-- deals/offer_letters pricing, land_credit_scores grades) by the
-- `county_market_rollup` worker job. Privacy model generalized from
-- marketNetworkContributor: NO organization column at all (structural
-- org-null), cohort_size records the k backing each row, rows below k=5 are
-- never materialized (the gate is in the aggregation code, not the read
-- path), and price samples are bucketed to the nearest $500/acre before
-- aggregation.
--
-- county_rollup_runs — run ledger so "the job ran but produced nothing" is
-- detectable: two consecutive zero-rollup runs raise an alert-spine warning.
--
-- market_report_drafts — quarterly public market report artifacts (JSON +
-- markdown) generated from the rollups. Founder-reviewable, NEVER
-- auto-published (status stays 'draft'; witnessed-publish is a follow-up).
--
-- Idempotent (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS);
-- self-contained block. Mirrors scripts/migrate.mjs STATEMENTS.

CREATE TABLE IF NOT EXISTS "county_market_rollups" (
  "id" serial PRIMARY KEY,
  "state" text NOT NULL,
  "county" text NOT NULL,
  "period" text NOT NULL,
  "metrics" jsonb NOT NULL,
  "cohort_size" integer NOT NULL,
  "computed_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "county_market_rollups_state_county_period_uk"
  ON "county_market_rollups" ("state", "county", "period");

CREATE INDEX IF NOT EXISTS "county_market_rollups_state_period_idx"
  ON "county_market_rollups" ("state", "period");

CREATE TABLE IF NOT EXISTS "county_rollup_runs" (
  "id" serial PRIMARY KEY,
  "period" text NOT NULL,
  "rollups_written" integer NOT NULL DEFAULT 0,
  "counties_scanned" integer NOT NULL DEFAULT 0,
  "ran_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "county_rollup_runs_ran_at_idx"
  ON "county_rollup_runs" ("ran_at");

CREATE TABLE IF NOT EXISTS "market_report_drafts" (
  "id" serial PRIMARY KEY,
  "quarter" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "report" jsonb NOT NULL,
  "markdown" text NOT NULL,
  "generated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "market_report_drafts_quarter_uk"
  ON "market_report_drafts" ("quarter");
