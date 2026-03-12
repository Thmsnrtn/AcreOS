-- Migration 0011: Autonomous Founder Observatory
-- Adds system_activity log, system_meta key-value store,
-- and churn/milestone columns to organizations.

-- System activity log: every meaningful autonomous action the system takes
CREATE TABLE IF NOT EXISTS "system_activity" (
  "id"          serial PRIMARY KEY,
  "org_id"      integer REFERENCES "organizations"("id") ON DELETE SET NULL,
  "job_name"    text NOT NULL,
  "action"      text NOT NULL,
  "summary"     text NOT NULL,
  "entity_type" text,
  "entity_id"   text,
  "metadata"    jsonb,
  "created_at"  timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IDX_sysact_created" ON "system_activity" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "IDX_sysact_org"     ON "system_activity" ("org_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "IDX_sysact_job"     ON "system_activity" ("job_name", "created_at" DESC);

-- System meta: key-value store for operational state (e.g. last briefing sent date)
CREATE TABLE IF NOT EXISTS "system_meta" (
  "key"        text PRIMARY KEY,
  "value"      text,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Churn risk + milestone columns on organizations
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "churn_risk_score"       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "churn_risk_updated_at"  timestamp,
  ADD COLUMN IF NOT EXISTS "churn_rescue_sent_at"   timestamp,
  ADD COLUMN IF NOT EXISTS "milestones_reached"     jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "referral_nudge_sent_at" timestamp;
