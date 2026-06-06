-- Tahoe E11 — cancellation 4th rung: subscription pause + product-feedback surface.
--
-- Adds an org-elected pause flag + window + reason to organizations so the
-- mutation-route 402 gate has authoritative state, and extends
-- cancellation_surveys with offered/accepted-pause columns so the founder
-- surface at /founder/customers/cancellation-reasons can aggregate
-- save-rate (the typical 5-15% the dialog actually catches).
--
-- All ALTERs are IF NOT EXISTS — safe to re-run.

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "subscription_paused" boolean NOT NULL DEFAULT false;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "subscription_paused_at" timestamp;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "subscription_pause_ends_at" timestamp;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "subscription_pause_reason" text;

-- Composite index for the resumeExpiredPauses worker: filter on the flag,
-- order by end-time. Leading column is the flag so the partial-style
-- planner can short-circuit on the false majority.
CREATE INDEX IF NOT EXISTS "idx_organizations_pause_resume"
  ON "organizations" ("subscription_paused", "subscription_pause_ends_at");

ALTER TABLE "cancellation_surveys" ADD COLUMN IF NOT EXISTS "offered_pause" boolean DEFAULT false;
ALTER TABLE "cancellation_surveys" ADD COLUMN IF NOT EXISTS "accepted_pause" boolean DEFAULT false;
ALTER TABLE "cancellation_surveys" ADD COLUMN IF NOT EXISTS "pause_days" integer;

-- Aggregation index for /founder/customers/cancellation-reasons. The
-- founder surface group-bys reason + org and filters by createdAt window.
CREATE INDEX IF NOT EXISTS "idx_cancellation_surveys_org_created"
  ON "cancellation_surveys" ("organization_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_cancellation_surveys_reason_created"
  ON "cancellation_surveys" ("reason", "created_at" DESC);
