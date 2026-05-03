-- Phase 3 Week 14 — Activation + retention telemetry (Yuna §8, Konstantin §2).
--
-- Four tables ship together as the activation/retention measurement baseline:
--   1. activation_events     — first-occurrence funnel events per (org, eventName)
--   2. retention_events      — cohort assignment + reactivation + churn signals
--   3. cohort_assignments    — A/B onboarding flow assignments
--   4. churn_reasons         — exit-survey + cancellation rationale
--
-- All four are append-only by usage (no UPDATE statements expected) so we keep
-- their schemas narrow. The activation funnel is the load-bearing surface;
-- /founder/activation reads it to compute "% of orgs hitting each canonical
-- event in their first 7/30/90 days."

-- ─── 1. activation_events ──────────────────────────────────────────────────
-- One row per (org, eventName) FIRST occurrence. The recordActivationEvent
-- helper uses ON CONFLICT DO NOTHING on (organization_id, event_name) so the
-- first call wins and re-firings are no-ops.
CREATE TABLE IF NOT EXISTS activation_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT,
  event_name      TEXT NOT NULL,
  event_value     JSONB DEFAULT '{}'::jsonb,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT activation_events_org_event_unique UNIQUE (organization_id, event_name)
);

CREATE INDEX IF NOT EXISTS idx_activation_events_org ON activation_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_activation_events_event ON activation_events(event_name);
CREATE INDEX IF NOT EXISTS idx_activation_events_occurred_at ON activation_events(occurred_at DESC);

-- ─── 2. retention_events ───────────────────────────────────────────────────
-- Multi-row per org. Captures cohort assignment ("assigned"), reactivation
-- ("reactivated"), and churn signals ("churn_warning", "churned").
CREATE TABLE IF NOT EXISTS retention_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT,
  event_type      TEXT NOT NULL,    -- assigned | reactivated | churn_warning | churned | resurrected
  cohort_name     TEXT,
  metadata        JSONB DEFAULT '{}'::jsonb,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_retention_events_org ON retention_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_retention_events_type ON retention_events(event_type);
CREATE INDEX IF NOT EXISTS idx_retention_events_cohort ON retention_events(cohort_name);
CREATE INDEX IF NOT EXISTS idx_retention_events_occurred_at ON retention_events(occurred_at DESC);

-- ─── 3. cohort_assignments ─────────────────────────────────────────────────
-- A/B onboarding flow assignments. One row per (org/user, cohortName).
CREATE TABLE IF NOT EXISTS cohort_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT,
  cohort_name     TEXT NOT NULL,
  variant         TEXT NOT NULL DEFAULT 'control',
  attributes      JSONB DEFAULT '{}'::jsonb,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cohort_assignments_org_cohort_unique UNIQUE (organization_id, cohort_name)
);

CREATE INDEX IF NOT EXISTS idx_cohort_assignments_org ON cohort_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_cohort_assignments_user ON cohort_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_cohort_assignments_name ON cohort_assignments(cohort_name);
CREATE INDEX IF NOT EXISTS idx_cohort_assignments_variant ON cohort_assignments(cohort_name, variant);

-- ─── 4. churn_reasons ──────────────────────────────────────────────────────
-- Exit-survey responses + cancellation rationale.
CREATE TABLE IF NOT EXISTS churn_reasons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT,
  churned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  primary_reason  TEXT NOT NULL,
  free_text       TEXT,
  survey_response JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_churn_reasons_org ON churn_reasons(organization_id);
CREATE INDEX IF NOT EXISTS idx_churn_reasons_primary ON churn_reasons(primary_reason);
CREATE INDEX IF NOT EXISTS idx_churn_reasons_churned_at ON churn_reasons(churned_at DESC);
