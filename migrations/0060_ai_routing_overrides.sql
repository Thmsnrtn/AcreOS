-- 0060_ai_routing_overrides.sql
-- Wave 8 — AI routing tier rollback table.
--
-- The aiRouter accepts a `taskTier` ("critical" | "standard" | "background")
-- which the founder uses to push non-critical traffic to Haiku 4.5. After a
-- routing change ships, the eval harness scores the new tier against the
-- previous run. If the post-change score < 0.95 of the pre-change score,
-- the quality-gate hook writes a row here that pins the callsite back to
-- the previous tier.
--
-- The router consults this table at routing time (5-minute in-memory cache)
-- and prefers the override if active. This gives us a safe, automatic
-- rollback path without redeploys.
--
-- task_type matches the `taskType` string passed to routeAITask. We keep
-- one active override per task_type — newer rows win. Set active=false to
-- retire an override without deleting the audit trail.

CREATE TABLE IF NOT EXISTS "ai_routing_overrides" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "task_type" text NOT NULL,
    "original_tier" text NOT NULL,        -- 'critical' | 'standard' | 'background'
    "override_tier" text NOT NULL,        -- tier the router should use instead
    "override_model" text,                -- optional: pin a specific model id
    "reason" text NOT NULL,               -- e.g. 'eval_quality_regression:0.91/0.96'
    "previous_eval_score" numeric(5,4),
    "new_eval_score" numeric(5,4),
    "active" boolean NOT NULL DEFAULT true,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "expires_at" timestamptz,             -- null = until manually retired
    CONSTRAINT "ai_routing_overrides_tier_check"
        CHECK ("override_tier" IN ('critical', 'standard', 'background')),
    CONSTRAINT "ai_routing_overrides_orig_tier_check"
        CHECK ("original_tier" IN ('critical', 'standard', 'background'))
);

-- One active override per task_type at a time. Inactive rows form an audit
-- trail and are not part of the unique constraint.
CREATE UNIQUE INDEX IF NOT EXISTS "ai_routing_overrides_active_unique"
    ON "ai_routing_overrides" ("task_type")
    WHERE "active" = true;

CREATE INDEX IF NOT EXISTS "ai_routing_overrides_created_idx"
    ON "ai_routing_overrides" ("created_at" DESC);
