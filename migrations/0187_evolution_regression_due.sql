-- 0187 — Persisted Stage-6 regression due-time (step-away gap #6).
-- The evolution pipeline's 30-minute post-deploy regression check used an
-- in-process setTimeout: lost on redeploy, and never armed at all in PR mode.
-- Stage 5 now stamps a due-time; the evolution_regression_scan job fires the
-- check durably (and detects merged evolution PRs to arm it in PR mode).
-- Additive + idempotent.
ALTER TABLE "evolution_history"
  ADD COLUMN IF NOT EXISTS "regression_check_due_at" timestamptz;
