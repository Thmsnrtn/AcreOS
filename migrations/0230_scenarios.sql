-- ============================================================================
-- 0230_scenarios.sql — the economics layer's one table.
-- ----------------------------------------------------------------------------
-- WHAT
-- ────
-- `scenarios` — one row per computed economic hypothesis (BI12, BK24), carrying
-- the ENGINE that produced it, that engine's VERSION, the VERBATIM inputs, and
-- the outputs.
--
-- WHY
-- ───
-- decision_snapshots freezes what was KNOWN (evidence) and what was ASSUMED
-- (assumptions), but had nowhere to point for the ECONOMICS that justified the
-- choice. A snapshot could record "offer $42,000" while the arithmetic behind
-- the number lived nowhere at all — so a year later you can reconstruct what the
-- investor believed about the PARCEL, and not what they believed about the DEAL.
--
-- THE PATTERN THIS COPIES RATHER THAN REINVENTS
-- ─────────────────────────────────────────────
-- `note_payoff_quotes` already persists engine_version (NOT NULL),
-- day_count_convention and engine_input_json — "the verbatim input snapshot so
-- the number can be recomputed and defended years later"
-- (server/services/notePaymentMath.ts). That is BK23's deterministic economics
-- contract, already exemplary in one vertical. This generalises it.
--
-- IMMUTABLE BY CONTRACT
-- ─────────────────────
-- No updated_at column and no UPDATE path in the store. Re-running the maths
-- INSERTs a new scenario. Canonical law 4 requires financial truth to be
-- deterministic, tested AND versioned; a mutable scenario would let improving a
-- formula silently rewrite the meaning of every number the old one produced.
--
-- NO FOREIGN KEY ON subject_id
-- ────────────────────────────
-- A scenario must survive its subject, for the same reason a decision must: the
-- economics of a deal you walked away from are exactly the ones worth still
-- being able to read. organization_id IS a real FK with ON DELETE CASCADE.
--
-- MONEY POSTURE (founder ruling "be the rail, not the provider")
-- ─────────────────────────────────────────────────────────────
-- Nothing here moves, holds, collects or charges a cent. A scenario is
-- arithmetic about a hypothetical.
--
-- MIRRORED
-- ────────
-- Mirrors shared/schema/scenarios.ts. Registered in scripts/migrate.mjs.
-- Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "scenarios" (
  "id"                     serial PRIMARY KEY,
  "organization_id"        integer NOT NULL
                             REFERENCES "organizations"("id") ON DELETE CASCADE,
  "shape_version"          integer NOT NULL DEFAULT 1,

  "subject_type"           text NOT NULL,
  "subject_id"             integer NOT NULL,
  "label"                  text NOT NULL,

  "engine_id"              text NOT NULL,
  "engine_version"         text NOT NULL,

  "strategy_pack_id"       text,
  "strategy_pack_version"  text,

  "inputs"                 jsonb NOT NULL,
  "assumptions"            jsonb NOT NULL DEFAULT '[]'::jsonb,
  "metrics"                jsonb NOT NULL DEFAULT '[]'::jsonb,

  "computed_at"            timestamp NOT NULL DEFAULT now()
);

-- "This property's scenarios, newest first" — org-LEADING per the
-- shard-readiness invariant (scripts/check-org-leading-index.mjs).
CREATE INDEX IF NOT EXISTS "scenarios_org_subject_idx"
  ON "scenarios" ("organization_id", "subject_type", "subject_id", "computed_at");

-- "Every scenario an engine version produced" — the read a formula change needs
-- in order to find what it would have altered.
CREATE INDEX IF NOT EXISTS "scenarios_org_engine_idx"
  ON "scenarios" ("organization_id", "engine_id", "engine_version");

-- ── decision_snapshots gains the economics reference ────────────────────────
-- A decision could record "offer $42,000" with the arithmetic behind the number
-- living nowhere. Each entry carries the engine version and headline metrics so
-- the record stays readable even if the scenario row becomes unreachable.
-- Defaults to '[]' — an empty list is valid and common (a `pass` on a parcel
-- that failed a hard filter runs no economics at all, and says so).
ALTER TABLE "decision_snapshots"
  ADD COLUMN IF NOT EXISTS "scenarios" jsonb NOT NULL DEFAULT '[]'::jsonb;
