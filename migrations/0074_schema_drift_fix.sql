-- Migration 0074: Schema drift fix
--
-- Production probe (2026-05-10) vs shared/schema.ts revealed only ONE genuine
-- drift among the four candidates the founder flagged:
--
--   sessions               — ALIGNED  (id, user_id, created_at)              shared/schema.ts:13251
--   sequence_enrollments   — ALIGNED  (next_step_scheduled_at exists)        shared/schema.ts:4208
--   scheduled_tasks        — ALIGNED  (next_run_at exists)                   shared/schema.ts:7219
--   autonomous_decisions   — MISSING  (referenced by autonomousHealthMonitor.ts:23 audit-trail spec; never defined in schema.ts nor any migration file)
--
-- Root cause: scripts/migrate.mjs (the Fly release_command per fly.toml:16)
-- deliberately bypasses the Drizzle migrator and applies a hand-curated list
-- of idempotent ALTER/CREATE statements. autonomous_decisions was never
-- added to that list, and no shared/schema.ts pgTable definition exists for
-- it either — only a documentation comment in
-- server/jobs/autonomousHealthMonitor.ts L23 promises this audit trail.
--
-- This migration creates the audit-trail table that the self-healing
-- watchdog is supposed to write to, so the documented "complete audit trail
-- of what the system did on its own" actually has a destination.
--
-- All statements are idempotent. Safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────
-- autonomous_decisions: audit log for every self-healing / self-governing
-- decision the platform makes on its own behalf. Written by
-- autonomousHealthMonitor and any future autonomy worker.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "autonomous_decisions" (
  "id"             serial PRIMARY KEY,
  "organization_id" integer REFERENCES "organizations"("id") ON DELETE SET NULL,
  "actor"          text NOT NULL,           -- e.g. 'autonomous_health_monitor', 'ai_cost_guardian'
  "decision_type"  text NOT NULL,           -- e.g. 'requeue_job', 'downgrade_model_tier', 'prune_cache'
  "subject_type"   text,                    -- e.g. 'background_job', 'ai_provider'
  "subject_id"     text,                    -- free-form id of the affected entity
  "rationale"      text NOT NULL,           -- human-readable why
  "input"          jsonb DEFAULT '{}'::jsonb NOT NULL,   -- inputs the decision was based on
  "outcome"        text NOT NULL DEFAULT 'pending',      -- pending | success | failure | reverted
  "outcome_detail" text,
  "reverted_at"    timestamp,
  "reverted_by"    text,
  "metadata"       jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at"     timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "autonomous_decisions_org_created_idx"
  ON "autonomous_decisions" ("organization_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "autonomous_decisions_actor_created_idx"
  ON "autonomous_decisions" ("actor", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "autonomous_decisions_type_created_idx"
  ON "autonomous_decisions" ("decision_type", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "autonomous_decisions_outcome_idx"
  ON "autonomous_decisions" ("outcome")
  WHERE "outcome" IN ('pending', 'failure');

-- ─────────────────────────────────────────────────────────────────────────
-- Defensive no-op fences for the three "drift" candidates that were
-- actually aligned. Including them here as IF NOT EXISTS so any environment
-- (staging, dev, branch DBs) that DID lag the source-of-truth schema gets
-- patched in lockstep with prod. In prod these are pure no-ops.
-- ─────────────────────────────────────────────────────────────────────────

-- sessions (shared/schema.ts:13251) — id / user_id / created_at
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "user_id"    integer;
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now();

-- sequence_enrollments (shared/schema.ts:4208) — next_step_scheduled_at,
-- last_step_sent_at, pause_reason, updated_at
ALTER TABLE "sequence_enrollments" ADD COLUMN IF NOT EXISTS "last_step_sent_at"      timestamp;
ALTER TABLE "sequence_enrollments" ADD COLUMN IF NOT EXISTS "next_step_scheduled_at" timestamp;
ALTER TABLE "sequence_enrollments" ADD COLUMN IF NOT EXISTS "pause_reason"           text;
ALTER TABLE "sequence_enrollments" ADD COLUMN IF NOT EXISTS "updated_at"             timestamp DEFAULT now();

-- scheduled_tasks (shared/schema.ts:7219) — next_run_at, last_run_at, updated_at
ALTER TABLE "scheduled_tasks" ADD COLUMN IF NOT EXISTS "next_run_at" timestamp;
ALTER TABLE "scheduled_tasks" ADD COLUMN IF NOT EXISTS "last_run_at" timestamp;
ALTER TABLE "scheduled_tasks" ADD COLUMN IF NOT EXISTS "updated_at"  timestamp DEFAULT now();
