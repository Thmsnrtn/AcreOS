-- AI cost ceiling — Phase 3 Week 9.
--
-- Adds:
--   1. organizations.org_ai_quota_daily_usd  — per-org daily USD cap on AI spend
--      (default $50; 0 = unlimited; founder orgs bypass at request layer)
--   2. ai_usage_daily                        — per-org-per-day rollup of AI spend
--      written by routeAITask after each call. Quota check sums totalUsd for
--      (org, today) and compares to the cap above.
--
-- The byFeature jsonb stores {<taskType>: {usd, calls}} so the founder cost
-- dashboard can render the cost-by-feature stacked bar without re-aggregating
-- ai_telemetry_events.

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "org_ai_quota_daily_usd" numeric(10, 2) NOT NULL DEFAULT 50.00;

CREATE TABLE IF NOT EXISTS "ai_usage_daily" (
  "id"              serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "date"            date NOT NULL,
  "total_usd"       numeric(12, 6) NOT NULL DEFAULT 0,
  "call_count"      integer NOT NULL DEFAULT 0,
  "by_feature"      jsonb DEFAULT '{}'::jsonb,
  "updated_at"      timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_usage_daily_org_date_uniq"
  ON "ai_usage_daily" ("organization_id", "date");

CREATE INDEX IF NOT EXISTS "ai_usage_daily_date_idx"
  ON "ai_usage_daily" ("date");
