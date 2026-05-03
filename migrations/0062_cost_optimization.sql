-- 0062_cost_optimization.sql
-- Self-Tuning Cost Optimizer (Wave 8)
--
-- Nightly job that analyses platform spend (AI + Fly + per-customer comms)
-- against MRR and either auto-applies safe optimisations (prompt-cache
-- toggles, log-volume tuning) or writes a recommendation row for the
-- founder to review at /founder/cost-optimizer.
--
-- One row per nightly run. Append-only — we keep the trail so the founder
-- can see how the platform tuned itself over time. The two jsonb columns
-- carry the structured recommendation + auto-applied-action lists; the
-- summary text is a plain-English paragraph the founder reads in
-- /founder-home and the weekly digest email.
--
-- Idempotency: the optimiser may be retried; we don't dedupe at the DB
-- level because every run captures a different snapshot in time. The
-- weekly digest reads MAX(run_at) for "latest summary".

CREATE TABLE IF NOT EXISTS "cost_optimization_runs" (
    "id" SERIAL PRIMARY KEY,
    "run_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "total_ai_cost_usd" NUMERIC(12, 4) NOT NULL DEFAULT 0,
    "total_fly_cost_usd" NUMERIC(12, 4) NOT NULL DEFAULT 0,
    "customer_count" INTEGER NOT NULL DEFAULT 0,
    "mrr_usd" NUMERIC(12, 2) NOT NULL DEFAULT 0,
    "profit_margin_pct" NUMERIC(6, 2) NOT NULL DEFAULT 0,
    "recommendations" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "auto_applied_actions" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "summary" TEXT NOT NULL DEFAULT ''
);

-- Used by the founder dashboard to fetch the last 30 days fast.
CREATE INDEX IF NOT EXISTS "cost_optimization_runs_run_at_idx"
    ON "cost_optimization_runs" ("run_at" DESC);
