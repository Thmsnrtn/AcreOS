-- ============================================================================
-- 0132 — Iyari (Chief of Future) #6 + Lena (CFO/CIO) #3 — paid-data eval runs.
-- ----------------------------------------------------------------------------
-- Audit trail of the paid-data eval harness (server/services/
-- paidDataEvalHarness.ts). Each run reads the persisted free Land Intelligence
-- corpus READ-ONLY (land_intelligence_reports, from migration 0127), asks an
-- injected paid-data provider for the same parcels (MockPaidProvider today;
-- Regrid/Zamplo/PropGrid the day a trial is greenlit), and produces a
-- field-by-field DIVERGENCE report + a DECISION-FLIP report (where the paid
-- value would change a buy/no-buy bucket or a deal-killer flag).
--
-- Persisting each run lets the founder buy-decision surface (/founder/
-- paid-data-eval) render the latest result instantly and compare a real Regrid
-- trial against the mock baseline — so the upgrade decision is data-driven,
-- not vibes: "Regrid would have flipped M decisions across N parcels in the
-- counties our customers worked, for $X projected trial cost."
--
-- Headline metrics (decision_flip_count / _rate, est_trial_cost_cents) are
-- denormalized out of the result JSON for cheap listing + trend without
-- parsing. The verbatim PaidDataEvalResult lives in `result`.
--
-- Index:
--   * (organization_id, created_at) — LEADING-org composite for shard-readiness
--     (per scripts/check-org-leading-index.mjs); tenant routing is one probe,
--     and the surface lists "latest run for this org" by created_at DESC.
--
-- Mirrors shared/schema.ts (paidDataEvalRuns) + scripts/migrate.mjs STATEMENTS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "paid_data_eval_runs" (
  "id" serial PRIMARY KEY,
  "organization_id" integer REFERENCES "organizations" ("id"),
  "provider" text NOT NULL,
  "mode" text NOT NULL,
  "state_filter" text,
  "total_parcels" integer NOT NULL,
  "parcels_compared" integer NOT NULL,
  "errors" integer NOT NULL DEFAULT 0,
  "decision_flip_count" integer NOT NULL DEFAULT 0,
  "decision_flip_rate" numeric,
  "est_trial_cost_cents" integer NOT NULL DEFAULT 0,
  "result" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "paid_data_eval_runs_org_created_idx"
  ON "paid_data_eval_runs" ("organization_id", "created_at");
