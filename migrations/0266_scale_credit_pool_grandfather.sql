-- 0266 — Scale credit pool 8,000 → 3,000 for NEW Scale customers
-- (founder decision 2026-10-08, docs/company/founder-decisions-2026-10-08.md).
--
-- Orgs already on Scale keep 8,000 until their next renewal. This records the
-- grandfathered pool per org; ends_at is stamped from the Stripe subscription
-- period by the webhook, and a renewal ends it. The backfill runs ONCE (guarded
-- by billing_one_time_backfills), because migrate.mjs re-runs every statement
-- on every deploy and a re-run would grandfather customers who joined Scale
-- after the decision.
CREATE TABLE IF NOT EXISTS "credit_pool_grandfathers" (
  "organization_id" integer PRIMARY KEY NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "credit_pool" integer NOT NULL,
  "ends_at" timestamp with time zone,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "billing_one_time_backfills" (
  "key" text PRIMARY KEY NOT NULL,
  "ran_at" timestamp with time zone DEFAULT now() NOT NULL,
  "rows_affected" integer
);

DO $$
DECLARE n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "billing_one_time_backfills" WHERE "key" = 'scale_credit_pool_2026_10_08') THEN
    INSERT INTO "credit_pool_grandfathers" ("organization_id", "credit_pool", "ends_at", "reason")
    SELECT "id", 8000, NULL, 'founder decision 2026-10-08: Scale pool 8000 -> 3000 for new customers; existing Scale keeps 8000 until next renewal'
    FROM "organizations"
    WHERE lower("subscription_tier") = 'scale'
      AND "subscription_status" IN ('active', 'trialing', 'past_due')
    ON CONFLICT ("organization_id") DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO "billing_one_time_backfills" ("key", "rows_affected") VALUES ('scale_credit_pool_2026_10_08', n);
    RAISE NOTICE 'scale credit pool grandfather backfill: % org(s)', n;
  END IF;
END $$;
