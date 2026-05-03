-- Phase 3 Week 12 — ML training-data instrumentation (Magnus §1).
--
-- Captures labels + feature snapshots so models can be trained later when
-- enough data has accumulated. Model training itself is deferred to month 18+;
-- this table is the *measurement infrastructure* that makes future training
-- possible. Without it, when we eventually want to train a churn / AVM /
-- conversion model we'll be staring at a database that has the *current*
-- state of every entity but no record of what each entity *looked like at
-- the moment a prediction was made* — which is the only thing usable as a
-- training feature row.
--
-- Five outcome types share the same wide table because the columns are the
-- same shape (labels jsonb, features jsonb) and we want a single helper to
-- write to all of them:
--
--   • avm_vs_actual      — AVM estimate vs actual sale price (regression)
--   • deal_outcome       — deal features vs closed-won / closed-lost (classification)
--   • lead_conversion    — lead features vs converted-to-deal / dismissed (classification)
--   • churn_outcome      — org's last-30-day usage vs churn (classification)
--   • offer_acceptance   — offer features vs accepted / declined / expired (classification)
--
-- Idempotency is enforced on (snapshot_type, subject_type, subject_id,
-- decision_at) so re-firing the helper for the same decision is a no-op.

CREATE TABLE IF NOT EXISTS ml_training_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_type   TEXT NOT NULL,
  subject_type    TEXT NOT NULL,
  subject_id      TEXT NOT NULL,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  labels          JSONB NOT NULL DEFAULT '{}'::jsonb,
  features        JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision_at     TIMESTAMPTZ NOT NULL,
  outcome_at      TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Idempotency key: re-firing recordSnapshot() for the same prediction
  -- must be a no-op. The decision moment is part of the key so AVM runs at
  -- different times for the same property each get their own row.
  CONSTRAINT ml_training_snapshots_unique UNIQUE (snapshot_type, subject_type, subject_id, decision_at)
);

-- Founder dashboard reads "by-type / by-org / latest" — these two indexes
-- cover both the per-org rollup and the per-type recent-additions feed.
CREATE INDEX IF NOT EXISTS idx_ml_snapshots_type_org_created
  ON ml_training_snapshots (snapshot_type, organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ml_snapshots_type_decision
  ON ml_training_snapshots (snapshot_type, decision_at DESC);

-- A few additional access paths that are cheap and avoid full-table scans:
CREATE INDEX IF NOT EXISTS idx_ml_snapshots_subject
  ON ml_training_snapshots (subject_type, subject_id);

CREATE INDEX IF NOT EXISTS idx_ml_snapshots_outcome_at
  ON ml_training_snapshots (outcome_at)
  WHERE outcome_at IS NOT NULL;
