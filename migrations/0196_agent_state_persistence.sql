-- ============================================================================
-- 0196 — Agent state persistence (module-state audit, mature-machine H0 §6.3)
-- ----------------------------------------------------------------------------
-- Two autopilot-safety stores move from module-level Maps to Postgres.
-- On 2+ Fly machines the Maps diverged per process:
--
-- 1. authority_delegations — temporary authority elevations ("let Sophie handle
--    support until Friday"). A grant made on the app machine was invisible
--    to the authority gate on the worker (where autonomous execution runs)
--    and vanished on deploy. Active = revoked_at IS NULL AND expires_at>now().
--
-- 2. agent_execution_counts — the autonomous-action rate throttle
--    (100/hr global, 30/hr per agent). Per-process counters made the
--    effective cap N× the configured cap. Single-statement upsert keeps it
--    race-free; buckets older than 2h are opportunistically deleted.
--
-- Both are GLOBAL/platform tables (no organization_id) — they govern
-- platform agents, not org data; exempt from the org-leading-index gate.
--
-- Mirrors shared/schema.ts (authorityDelegations, agentExecutionCounts) +
-- scripts/migrate.mjs. Idempotent (IF NOT EXISTS) — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "authority_delegations" (
  "id" serial PRIMARY KEY,
  "agent_codename" text NOT NULL,
  "elevated_actions" jsonb NOT NULL DEFAULT '["*"]',
  "from_level" integer NOT NULL DEFAULT 2,
  "to_level" integer NOT NULL DEFAULT 0,
  "reason" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "revoked_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "authority_delegations_agent_expires_idx"
  ON "authority_delegations" ("agent_codename", "expires_at");

CREATE TABLE IF NOT EXISTS "agent_execution_counts" (
  "id" serial PRIMARY KEY,
  "agent_key" text NOT NULL,
  "bucket_start" timestamp NOT NULL,
  "count" integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_execution_counts_key_bucket_idx"
  ON "agent_execution_counts" ("agent_key", "bucket_start");
