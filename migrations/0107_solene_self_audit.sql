-- ============================================================================
-- 0107 — Solene (COO) self-audit ledger.
-- ----------------------------------------------------------------------------
-- Detection-only operating-discipline audit. Mirrors
-- shared/schema/solene-audit.ts and scripts/migrate.mjs (CI guardrail
-- enforces parity).
-- ============================================================================

-- solene_decisions: one row per Solene-initiated action.
CREATE TABLE IF NOT EXISTS "solene_decisions" (
  "id" serial PRIMARY KEY,
  "decided_at" timestamp with time zone NOT NULL DEFAULT now(),
  "decision_type" text NOT NULL,
  "context_summary" text NOT NULL,
  "rationale" text NOT NULL,
  "response_text" text,
  "outcome" text,
  "capital_impact_usd" numeric(10,4)
);
CREATE INDEX IF NOT EXISTS "solene_decisions_decided_idx" ON "solene_decisions" ("decided_at");
CREATE INDEX IF NOT EXISTS "solene_decisions_type_idx" ON "solene_decisions" ("decision_type", "decided_at");

-- solene_audit_runs: one row per (cron tick × scope).
CREATE TABLE IF NOT EXISTS "solene_audit_runs" (
  "id" serial PRIMARY KEY,
  "run_started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "run_ended_at" timestamp with time zone,
  "scope" text NOT NULL,
  "decisions_examined" integer NOT NULL DEFAULT 0,
  "drift_count" integer NOT NULL DEFAULT 0,
  "finding_count" integer NOT NULL DEFAULT 0,
  "drift_signal_emitted" boolean NOT NULL DEFAULT false,
  "skip_reason" text
);
CREATE INDEX IF NOT EXISTS "solene_audit_runs_started_idx" ON "solene_audit_runs" ("run_started_at");
CREATE INDEX IF NOT EXISTS "solene_audit_runs_scope_idx" ON "solene_audit_runs" ("scope", "run_started_at");

-- solene_audit_findings: one row per (decision × detector) match.
CREATE TABLE IF NOT EXISTS "solene_audit_findings" (
  "id" serial PRIMARY KEY,
  "run_id" integer NOT NULL REFERENCES "solene_audit_runs"("id") ON DELETE CASCADE,
  "decision_id" integer REFERENCES "solene_decisions"("id") ON DELETE SET NULL,
  "pattern" text NOT NULL,
  "severity" text NOT NULL,
  "citation" text NOT NULL,
  "excerpt" text NOT NULL,
  "matched_patterns" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "fired_at" timestamp with time zone NOT NULL DEFAULT now()
);
-- NULLS NOT DISTINCT keeps the unique constraint honest for findings
-- that aren't tied to a specific decision (e.g. session-wide brief
-- staleness). Postgres 15+; falls back gracefully on older versions.
CREATE UNIQUE INDEX IF NOT EXISTS "solene_audit_findings_unique"
  ON "solene_audit_findings" ("run_id", "decision_id", "pattern") NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS "solene_audit_findings_run_idx" ON "solene_audit_findings" ("run_id");
CREATE INDEX IF NOT EXISTS "solene_audit_findings_severity_idx" ON "solene_audit_findings" ("severity", "fired_at");
CREATE INDEX IF NOT EXISTS "solene_audit_findings_pattern_idx" ON "solene_audit_findings" ("pattern", "fired_at");
