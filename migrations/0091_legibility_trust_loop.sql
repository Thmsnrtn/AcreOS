-- Lens 46 — AI Autonomy Trust-Loop Legibility
--
-- Adds the columns required to reconstruct WHY an agent took an action,
-- not just WHAT it did. The audit checklist's "decision-record shape"
-- requirement (Tom, 2026-05-27): every autonomous action row must let
-- a human reconstruct (a) the inputs the model saw, (b) the alternatives
-- it considered, (c) the model's stated reason, (d) the confidence,
-- (e) the upstream observation that triggered the chain, (f) which model
-- tier actually answered.
--
-- agent_action_log already carries: input, output, reasoning, confidence,
-- outcome, durationMs. Missing: alternatives_considered, the upstream
-- observation pointer, and the cascade trail (haiku→sonnet→opus).
--
-- pax_observations is read by customer-facing surfaces. Currently it
-- carries description + metadata.suggestedAction but no first-class
-- reasoning, inputs, or alternatives. Adding those fields lets the
-- "Why Pax did this" component render the trust-loop without a JSON dive.

-- ── agent_action_log enrichment ──────────────────────────────────────────────

ALTER TABLE agent_action_log
  ADD COLUMN IF NOT EXISTS alternatives_considered jsonb,
  ADD COLUMN IF NOT EXISTS triggered_by_observation_id integer,
  ADD COLUMN IF NOT EXISTS tiers_tried jsonb,
  ADD COLUMN IF NOT EXISTS model_used text,
  ADD COLUMN IF NOT EXISTS correlation_id text;

-- Soft FK so a deleted observation doesn't cascade-orphan an action_log row.
-- The action_log is the system of record; the observation can disappear.
CREATE INDEX IF NOT EXISTS agent_action_log_obs_idx
  ON agent_action_log (triggered_by_observation_id)
  WHERE triggered_by_observation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_action_log_correlation_idx
  ON agent_action_log (correlation_id)
  WHERE correlation_id IS NOT NULL;

-- ── pax_observations enrichment ──────────────────────────────────────────────

ALTER TABLE pax_observations
  ADD COLUMN IF NOT EXISTS reasoning text,
  ADD COLUMN IF NOT EXISTS inputs jsonb,
  ADD COLUMN IF NOT EXISTS alternatives_considered jsonb,
  ADD COLUMN IF NOT EXISTS model_used text;

-- ── decisions_inbox_items: tier + alternatives surfacing ────────────────────
-- The inbox already carries sophie_analysis + sophie_confidence_score +
-- recommended_action. We surface the cascade trail + alternatives in
-- context_bundle (jsonb) — no new column — but we DO want a queryable
-- pointer to the action_log row that resolved the item, so the
-- /audit-log/explain endpoint can hop the join.

ALTER TABLE decisions_inbox_items
  ADD COLUMN IF NOT EXISTS resolved_by_action_log_id integer;

CREATE INDEX IF NOT EXISTS decisions_inbox_resolved_action_idx
  ON decisions_inbox_items (resolved_by_action_log_id)
  WHERE resolved_by_action_log_id IS NOT NULL;
