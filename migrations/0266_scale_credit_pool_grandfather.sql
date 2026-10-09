-- 0266 — Scale credit pool 8,000 → 3,000 for NEW Scale customers
-- (founder decision 2026-10-08, docs/company/founder-decisions-2026-10-08.md).
--
-- Orgs already on Scale keep 8,000 until their next renewal. The grandfathered
-- pool lives on the org row; credit_pool_grandfather_ends_at is stamped from the
-- Stripe subscription period by the webhook, and a renewal ends it.
--
-- The backfill runs ONCE, guarded by a founder_settings marker row, because
-- migrate.mjs re-runs every statement on every deploy and a re-run would
-- grandfather customers who joined Scale after the decision.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "credit_pool_grandfather" integer;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "credit_pool_grandfather_ends_at" timestamp with time zone;

DO $$
DECLARE n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "founder_settings" WHERE "key" = 'billing.backfill.scale_credit_pool_2026_10_08') THEN
    UPDATE "organizations"
       SET "credit_pool_grandfather" = 8000,
           "credit_pool_grandfather_ends_at" = NULL
     WHERE lower("subscription_tier") IN ('scale', 'empire')
       AND "subscription_status" IN ('active', 'trialing', 'past_due')
       AND "credit_pool_grandfather" IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO "founder_settings" ("key", "value", "value_type", "description", "category")
    VALUES ('billing.backfill.scale_credit_pool_2026_10_08', n::text, 'number',
            'One-time marker: orgs grandfathered at the 8,000-credit Scale pool (founder decision 2026-10-08). Do not delete — its presence stops the backfill re-running.',
            'billing_migration');
    RAISE NOTICE 'scale credit pool grandfather backfill: % org(s)', n;
  END IF;
END $$;
