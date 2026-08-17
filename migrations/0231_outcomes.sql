-- ============================================================================
-- 0231_outcomes.sql — the learning layer's one table.
-- ----------------------------------------------------------------------------
-- WHAT
-- ────
-- `outcomes` — what ACTUALLY happened, referencing the DecisionSnapshot it
-- resulted from. Closes the canonical loop (BI1): REALITY → EVIDENCE →
-- ECONOMICS → DECISION → PLAN → ACTION → WORKFLOW → OUTCOME → LEARNING.
--
-- WHY
-- ───
-- decision_snapshots froze what was known and predicted; scenarios froze the
-- arithmetic. Neither records what the world then did, so an investor's own
-- history was a pile of forecasts nobody ever graded. AA8 names the
-- Decision→Outcome graph as a compounding moat: a competitor can copy a screen
-- but not a customer's calibration.
--
-- LAW 9 IS THE DESIGN CONSTRAINT
-- ──────────────────────────────
-- "Outcomes append learning; they do not rewrite history." This table
-- REFERENCES decision_snapshots; nothing edits one. Variance is deliberately
-- NOT a column — it is computed as a pure projection in
-- shared/outcomes/outcome.ts over the scenario refs the decision already froze.
-- A stored variance would be a third number that can drift from the two it
-- derives from, and "improving" it later would silently restate how good a past
-- decision looked.
--
-- WHY decision_snapshot_id IS A REAL FK
-- ─────────────────────────────────────
-- Unlike the deliberately unconstrained subject_id on evidence_claims,
-- decision_snapshots and scenarios — all of which must survive their subject —
-- an outcome WITHOUT its decision is meaningless: there is nothing to compare it
-- against and nothing it can teach. The FK is correct here for exactly the
-- reason it was wrong there.
--
-- NOT REUSING outcome_telemetry: that table is shaped around AGENT performance
-- (agentActions, messagesSent, responseTime) and carries no decision reference;
-- outcome_calibrations is keyed by agent codename. Both are the agent/founder
-- learning loop (BI76).
--
-- MONEY POSTURE (founder ruling "be the rail, not the provider")
-- ─────────────────────────────────────────────────────────────
-- Nothing here moves, holds, collects or charges a cent.
--
-- MIRRORED
-- ────────
-- Mirrors shared/schema/outcomes.ts. Registered in scripts/migrate.mjs.
-- Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "outcomes" (
  "id"                     serial PRIMARY KEY,
  "organization_id"        integer NOT NULL
                             REFERENCES "organizations"("id") ON DELETE CASCADE,
  "shape_version"          integer NOT NULL DEFAULT 1,
  "decision_snapshot_id"   integer NOT NULL
                             REFERENCES "decision_snapshots"("id") ON DELETE CASCADE,
  "subject_type"           text NOT NULL,
  "subject_id"             integer NOT NULL,
  "kind"                   text NOT NULL,
  "summary"                text NOT NULL,
  "actuals"                jsonb NOT NULL DEFAULT '[]'::jsonb,
  "observed_at"            timestamp NOT NULL,
  "recorded_at"            timestamp NOT NULL DEFAULT now()
);

-- "This decision's outcomes" — the calibration read. Org-LEADING per the
-- shard-readiness invariant (scripts/check-org-leading-index.mjs).
CREATE INDEX IF NOT EXISTS "outcomes_org_decision_idx"
  ON "outcomes" ("organization_id", "decision_snapshot_id", "observed_at");

-- "This property's outcomes, newest first".
CREATE INDEX IF NOT EXISTS "outcomes_org_subject_idx"
  ON "outcomes" ("organization_id", "subject_type", "subject_id", "observed_at");
