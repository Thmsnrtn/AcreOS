-- 0272 — W4 forecasting: three append-only stores of what was KNOWN when.
--
--   public_series_vintages         a public series value as known on a date
--                                  (a revision is a new row, never an edit)
--   forecast_ledger                frozen forecasts ('issued') and their later
--                                  scores ('scored'); never edited
--   customer_outcome_observations  closed deals, offer results and outreach
--                                  responses as the monthly recorder saw them
--                                  (prices, timings, results, channels only)
--
-- table-count 727 -> 730; the reasons nothing existing fits are in
-- shared/schema/forecasting.ts. Mirrors scripts/migrate.mjs. Idempotent.
CREATE TABLE IF NOT EXISTS "public_series_vintages" (
  "id" serial PRIMARY KEY,
  "series_id" text NOT NULL,
  "family" text NOT NULL,
  "observation_date" date NOT NULL,
  "vintage_date" date NOT NULL,
  "value" double precision NOT NULL,
  "source" text NOT NULL,
  "recorded_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "public_series_vintages_series_obs_vintage_uk" ON "public_series_vintages" ("series_id", "observation_date", "vintage_date");
CREATE INDEX IF NOT EXISTS "public_series_vintages_family_vintage_idx" ON "public_series_vintages" ("family", "vintage_date");

CREATE TABLE IF NOT EXISTS "forecast_ledger" (
  "id" serial PRIMARY KEY,
  "entry_kind" text NOT NULL,
  "forecast_key" text NOT NULL,
  "engine_id" text NOT NULL,
  "engine_version" text NOT NULL,
  "subject" text NOT NULL,
  "target_date" date NOT NULL,
  "issued_as_of" date NOT NULL,
  "body" jsonb NOT NULL,
  "recorded_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "forecast_ledger_kind_key_uk" ON "forecast_ledger" ("entry_kind", "forecast_key");
CREATE INDEX IF NOT EXISTS "forecast_ledger_engine_kind_issued_idx" ON "forecast_ledger" ("engine_id", "entry_kind", "issued_as_of");

CREATE TABLE IF NOT EXISTS "customer_outcome_observations" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "subject_table" text NOT NULL,
  "subject_id" integer NOT NULL,
  "state" text,
  "county" text,
  "observed_at" timestamp NOT NULL,
  "values" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "recorded_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "customer_outcome_obs_org_kind_subject_uk" ON "customer_outcome_observations" ("organization_id", "kind", "subject_table", "subject_id");
CREATE INDEX IF NOT EXISTS "customer_outcome_obs_org_observed_idx" ON "customer_outcome_observations" ("organization_id", "observed_at");
