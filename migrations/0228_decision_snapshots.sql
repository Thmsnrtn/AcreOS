-- ============================================================================
-- 0228_decision_snapshots.sql — Decision Memory's one table.
-- ----------------------------------------------------------------------------
-- WHAT
-- ────
-- `decision_snapshots` — the durable boundary of the canonical loop (BI20).
-- When a consequential investment decision is made, one row freezes WHAT WAS
-- KNOWN: resolved evidence with the claim ids behind it, assumptions in force,
-- alternatives considered, unknowns accepted, who decided under what authority,
-- and which Strategy Pack version shaped the criteria.
--
-- WHY
-- ───
-- Without it every recorded decision reads against LIVE rows, so a decision
-- silently changes meaning when the data behind it changes. BL3 names the
-- failure exactly: "A prior decision changes meaning when current data or Pack
-- rules change." It was one of only two fitness functions classified fully
-- `unenforced` in shared/architecture/canon.ts.
--
-- IMMUTABLE BY CONTRACT
-- ─────────────────────
-- No updated_at column, and no UPDATE path in
-- server/services/decisions/decisionStore.ts. Later evidence and later outcomes
-- APPEND context; nothing edits a snapshot. That is canonical law 6 (historical
-- decisions preserve what was known at the time) and law 9 (outcomes append
-- learning, they do not rewrite history), enforced structurally rather than by
-- convention — the failure mode is not malice, it is an ordinary
-- `UPDATE ... SET rationale` written by someone fixing a typo two years from
-- now, silently changing what the record says a customer believed.
--
-- NO FOREIGN KEY ON subject_id
-- ────────────────────────────
-- A snapshot must survive its subject. An investor who PASSED on a property and
-- later deleted it still needs the record of why — and a cascade delete would
-- erase precisely the decisions worth keeping. `organization_id` IS a real FK
-- with ON DELETE CASCADE, so customer-data deletion stays complete.
--
-- MONEY POSTURE (founder ruling "be the rail, not the provider")
-- ─────────────────────────────────────────────────────────────
-- Nothing here moves, holds, collects or charges a cent. A snapshot is a record
-- of judgement.
--
-- MIRRORED
-- ────────
-- Mirrors shared/schema/decision-snapshots.ts. Registered in scripts/migrate.mjs
-- (the path that runs on deploy as the Fly release_command). Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "decision_snapshots" (
  "id"                         serial PRIMARY KEY,
  "organization_id"            integer NOT NULL
                                 REFERENCES "organizations"("id") ON DELETE CASCADE,
  "snapshot_version"           integer NOT NULL DEFAULT 1,

  "subject_type"               text NOT NULL,
  "subject_id"                 integer NOT NULL,

  "kind"                       text NOT NULL,
  "choice"                     text NOT NULL,
  "rationale"                  text NOT NULL,

  "actor_type"                 text NOT NULL,
  "actor_ref"                  text NOT NULL,
  "authority"                  text NOT NULL,

  "strategy_pack_id"           text,
  "strategy_pack_version"      text,

  "evidence_as_of"             timestamp NOT NULL,
  "resolution_policy_version"  integer NOT NULL,

  "evidence"                   jsonb NOT NULL DEFAULT '[]'::jsonb,
  "assumptions"                jsonb NOT NULL DEFAULT '[]'::jsonb,
  "alternatives"               jsonb NOT NULL DEFAULT '[]'::jsonb,
  "unknowns"                   jsonb NOT NULL DEFAULT '[]'::jsonb,

  "decided_at"                 timestamp NOT NULL DEFAULT now()
);

-- "This property's decision history, newest first" — org-LEADING per the
-- shard-readiness invariant (scripts/check-org-leading-index.mjs).
CREATE INDEX IF NOT EXISTS "decision_snapshots_org_subject_idx"
  ON "decision_snapshots" ("organization_id", "subject_type", "subject_id", "decided_at");

-- "Everything we decided lately" + the calibration loop's scan.
CREATE INDEX IF NOT EXISTS "decision_snapshots_org_decided_idx"
  ON "decision_snapshots" ("organization_id", "decided_at");

-- "Every pass we made this quarter" — the decision-quality read.
CREATE INDEX IF NOT EXISTS "decision_snapshots_org_kind_idx"
  ON "decision_snapshots" ("organization_id", "kind", "decided_at");
