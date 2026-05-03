-- Subscription history audit log (Renoir §1-§2, Phase 2 Week 3-4).
--
-- Records every meaningful subscription lifecycle event for an org so the
-- reactivation flow can answer:
--   - what plan did they last have?
--   - how long were they an active customer? (tenure)
--   - were they on a legacy/grandfathered price?
--   - what changed since they cancelled?
--
-- This complements `subscription_events` (which is a thin from→to tier log
-- used by founder analytics) by capturing the *priced* state of the
-- subscription at each event, including the billing interval and a generic
-- metadata jsonb for Stripe IDs, cancellation reason references, etc.

CREATE TABLE IF NOT EXISTS "subscription_history" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL, -- subscribed | tier_changed | canceled | reactivated
  "tier" text,                -- nullable for canceled events
  "billing_interval" text,    -- monthly | yearly | null
  "price_cents" integer,      -- nullable for cancel events
  "event_at" timestamp DEFAULT now() NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_subscription_history_org_event_at"
  ON "subscription_history" ("organization_id", "event_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_subscription_history_event_type"
  ON "subscription_history" ("event_type");
