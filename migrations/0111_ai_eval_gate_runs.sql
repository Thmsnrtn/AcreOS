-- Tahoe E7 (2026-06-06) — productionize the prompt-change eval gate.
--
-- One row per eval-gate invocation (scripts/eval-gate.mjs): the curated Pax
-- golden set is scored by an LLM judge and the build fails when avg_overall
-- drops below `threshold`. Persisting each verdict turns the gate from
-- ephemeral CI log output into a queryable score trend tied to a git ref.
--
-- System/CI-scoped (a prompt change is a global concern): no organization_id
-- column and therefore no org-leading index — mirrors ai_models /
-- ai_test_cases. CREATE ... IF NOT EXISTS is safe to re-run.

CREATE TABLE IF NOT EXISTS "ai_eval_gate_runs" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "golden_set"          text NOT NULL,
  "pax_prompt_version"  text NOT NULL,
  "model_key"           text NOT NULL,
  "judge_model_key"     text NOT NULL,
  "threshold"           numeric NOT NULL,
  "avg_overall"         numeric NOT NULL,
  "avg_shape"           numeric,
  "avg_topics"          numeric,
  "avg_tone"            numeric,
  "case_count"          integer NOT NULL,
  "passed"              boolean NOT NULL,
  "judge_mode"          text NOT NULL DEFAULT 'live',
  "failures"            jsonb NOT NULL DEFAULT '[]'::jsonb,
  "git_ref"             text,
  "ci_run_id"           text,
  "created_at"          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ai_eval_gate_runs_created_idx"
  ON "ai_eval_gate_runs" ("created_at");
CREATE INDEX IF NOT EXISTS "ai_eval_gate_runs_model_created_idx"
  ON "ai_eval_gate_runs" ("model_key", "created_at");
