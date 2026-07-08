-- ============================================================================
-- 0197 — Marketing spend ledger (the CAC numerator, 2026-07-07 cost audit)
-- ----------------------------------------------------------------------------
-- Until this table existed the unit-economics dashboard honestly reported
-- cacAvailable:false ("we never fabricate a metric we can't source") and the
-- autopilot budget ramp computed CAC from AI-dispatch spend alone — real ad
-- dollars had no ledger anywhere. This is that ledger.
--
-- PLATFORM-GLOBAL (no organization_id): AcreOS's own acquisition spend, not
-- tenant data — exempt from the org-leading-index gate. Amounts are ACTUALS;
-- budgets/commitments are never recorded here (a budget is not spend).
--
-- Mirrors shared/schema.ts (marketingSpend) + scripts/migrate.mjs.
-- Idempotent (IF NOT EXISTS) — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "marketing_spend" (
  "id" serial PRIMARY KEY,
  -- "meta" | "google" | "content" | "referral" | "sponsorship" | "other"
  "channel" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "spent_at" timestamp NOT NULL,
  -- "manual" | "ad_provider" | "autopilot"
  "source" text NOT NULL DEFAULT 'manual',
  "campaign_ref" text,
  "note" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "marketing_spend_spent_at_idx"
  ON "marketing_spend" ("spent_at");

CREATE INDEX IF NOT EXISTS "marketing_spend_channel_spent_at_idx"
  ON "marketing_spend" ("channel", "spent_at");
