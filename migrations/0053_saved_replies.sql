-- Phase 3 Week 13: Customer-support saved-replies + critical-alert acks.
--
-- Two small ops-flow tables that ride together:
--
--   1. support_saved_replies — pre-canned operator responses for common
--      questions. Either global (organizationId NULL) or scoped to a
--      specific customer org (so VIP-specific phrasing can live here too).
--      Operator clicks → text inserts into the reply composer.
--
--   2. critical_alert_acks — per-notification ack tracking for P0/P1
--      alerts. Lets the founder bell show an ack-timer countdown and
--      surface "P0 unacked for X min — escalate now?" without depending
--      on PagerDuty/Opsgenie. We track ack state ourselves; actual paging
--      integrations can plug in later by reading this table.

-- ─── 1. support_saved_replies ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_saved_replies (
  id              SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  -- NULL organization_id = globally-available reply (founder-curated)
  name            TEXT NOT NULL,            -- short label shown in the picker
  body            TEXT NOT NULL,            -- the reply text (plain or markdown)
  created_by      TEXT NOT NULL,            -- Clerk user id of the operator who saved it
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_saved_replies_org
  ON support_saved_replies (organization_id) WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_support_saved_replies_global
  ON support_saved_replies (created_at DESC) WHERE organization_id IS NULL;

COMMENT ON TABLE support_saved_replies IS
  'Pre-canned operator responses. NULL organization_id = globally available. Inserted into reply composer at click time.';

-- ─── 2. critical_alert_acks ─────────────────────────────────────────────────
-- One row per (notification_id, severity) tuple at first ack time. If the
-- timer expires, we record an `escalated_at` rather than mutating the row,
-- so the audit trail of who-saw-what-when is preserved.
CREATE TABLE IF NOT EXISTS critical_alert_acks (
  id              SERIAL PRIMARY KEY,
  notification_id INTEGER REFERENCES notifications(id) ON DELETE CASCADE,
  severity        TEXT NOT NULL CHECK (severity IN ('P0','P1')),
  fired_at        TIMESTAMPTZ NOT NULL,                 -- when the alert was created
  ack_deadline_at TIMESTAMPTZ NOT NULL,                 -- fired_at + threshold (P0=15min, P1=60min default)
  acked_at        TIMESTAMPTZ,
  acked_by        TEXT,                                 -- Clerk user id of acker
  escalated_at    TIMESTAMPTZ,                          -- set when deadline passes without ack
  escalation_target TEXT,                               -- backup contact (informational; actual paging is out of scope)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_critical_alert_acks_unacked
  ON critical_alert_acks (ack_deadline_at)
  WHERE acked_at IS NULL AND escalated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_critical_alert_acks_notification
  ON critical_alert_acks (notification_id);

COMMENT ON TABLE critical_alert_acks IS
  'Founder-side ack tracking for P0/P1 alerts. Drives the /founder-home Critical Alerts view countdown and the "P0 unacked for X min — escalate now?" banner.';
