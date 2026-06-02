-- ============================================================================
-- 0108 — Solene (COO) capital event ledger.
-- ----------------------------------------------------------------------------
-- Per-session + per-day spend tracker. Mirrors shared/schema/solene-capital.ts
-- and scripts/migrate.mjs (CI guardrail enforces parity).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "solene_capital_events" (
  "id" serial PRIMARY KEY,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  "event_type" text NOT NULL,
  "cost_usd" numeric(10,4) NOT NULL,
  "context_summary" text NOT NULL,
  "session_token" text
);
CREATE INDEX IF NOT EXISTS "solene_capital_events_occurred_idx" ON "solene_capital_events" ("occurred_at");
CREATE INDEX IF NOT EXISTS "solene_capital_events_type_occurred_idx" ON "solene_capital_events" ("event_type", "occurred_at");
CREATE INDEX IF NOT EXISTS "solene_capital_events_session_idx" ON "solene_capital_events" ("session_token", "occurred_at");
