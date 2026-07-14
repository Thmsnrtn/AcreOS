-- ============================================================================
-- 0204 — Jarvis Phase 1 CP2: successCriteria + generic verify dispatches
-- ----------------------------------------------------------------------------
-- Founder-approved plan: docs/internal/jarvis-phase0-audit.md (Phase 1,
-- "Verified Act-and-Confirm"). CP1 wired verdict consumption; CP2 adds the
-- explicit success-criteria contract and the generic `verify` dispatch type,
-- with the IMPORTS workflow gated first.
--
--   solene_dispatch_queue.success_criteria — nullable jsonb, shape
--     { criteria: [{ id, description, check? }] }: human-readable description
--     + optional machine-checkable hint. On a sourceType='verify' row it holds
--     the criteria BEING verified (audit trail of what the verifier checked).
--
--   import_jobs.verify_status / verify_findings — where a completed import's
--     verification VERDICT lands ('pending' | 'passed' | 'flagged' + the
--     FINDINGS block). NULL = no verify enqueued (pre-CP2 rows, dispatch
--     disabled, enqueue failed).
--
-- Verification dispatches are READ-ONLY observers in CP2 — they never block
-- or fail the import. Blocking / act-and-confirm binding is CP3.
-- All columns nullable + additive; existing rows untouched.
-- Mirrors scripts/migrate.mjs + shared/schema/solene-dispatch.ts + etl.ts.
-- ============================================================================

ALTER TABLE "solene_dispatch_queue" ADD COLUMN IF NOT EXISTS "success_criteria" jsonb;

ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "verify_status" text;
ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "verify_findings" text;
