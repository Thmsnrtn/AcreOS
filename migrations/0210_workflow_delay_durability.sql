-- ============================================================================
-- 0210 — Durable workflow `delay` (Wave B "Wire the engine", 2026-07-29)
-- ----------------------------------------------------------------------------
-- The workflow engine's `delay` action slept in-process with
-- `Math.min(delayMinutes * 60_000, 60_000)`. Two lies followed:
--   1. A step configured "wait 2 days" resumed after 60 SECONDS.
--   2. The wait lived only in one Node process's event loop — a deploy,
--      crash, or machine swap dropped the workflow on the floor mid-run,
--      with the run row left forever in status "running".
--
-- The wake time is now persisted on the run itself. A run that parks goes to
-- status 'waiting' with resume_at + resume_state (next action index and the
-- interpolation variables accumulated so far); the workflow_delay_resume job
-- (server/jobs/workflowDelayResume.ts, every minute under a job lock) picks up
-- every due run and continues it from where it stopped — in whichever process
-- happens to be alive.
--
-- No new table: this is two nullable columns plus a partial index on the
-- existing workflow_runs. Mirrors shared/schema.ts (workflowRuns,
-- WORKFLOW_RUN_STATUSES, WorkflowRunResumeState) + scripts/migrate.mjs.
-- Additive + idempotent (IF NOT EXISTS) — safe to re-run.
-- ============================================================================

ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "resume_at" timestamp;
ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "resume_state" jsonb;

-- Partial index: the resume sweep only ever asks for parked-and-due runs, and
-- parked runs are a vanishing fraction of the table.
CREATE INDEX IF NOT EXISTS "workflow_runs_waiting_resume_idx"
  ON "workflow_runs" ("resume_at")
  WHERE "status" = 'waiting';
