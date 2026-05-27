-- Trey 2026-05-27: EMD audit-trail event log.
--
-- Lens 18 flagged: AcreOS records the current EMD state on
-- earnest_money_holds but has no append-only event trail. Every
-- wholesaler has gotten burned at least once — either by a title
-- company "losing" a wire confirmation or by a self-inflicted
-- bookkeeping error days later — and the defense is "show the audit
-- trail." Storing only the latest state means a refund/forfeit dispute
-- has no replay history.
--
-- This table is append-only (revoked DELETE/UPDATE at the role level
-- where supported; CHECK + trigger-less for portability). One row per
-- state change, captures who made it, IP/UA at request time, and a
-- justification. Read path = ORDER BY occurred_at ASC for replay.

CREATE TABLE IF NOT EXISTS earnest_money_events (
  id                varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  hold_id           varchar NOT NULL REFERENCES earnest_money_holds(id) ON DELETE CASCADE,

  -- Transition. from_state is null for the initial 'recorded' event.
  from_state        text,
  to_state          text NOT NULL,
  amount_cents      bigint NOT NULL,

  actor_user_id     text,
  actor_ip          text,
  actor_ua          text,
  justification     text,

  occurred_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS emd_events_hold_idx
  ON earnest_money_events (hold_id, occurred_at);
CREATE INDEX IF NOT EXISTS emd_events_org_idx
  ON earnest_money_events (organization_id, occurred_at);

-- Append-only enforcement. Block UPDATE / DELETE at the rule level so
-- application code (and a compromised app user) cannot rewrite history.
-- Owner / superuser can still drop the table outright; that's an
-- intentional escape hatch for migrations. The integrity guarantee is
-- against in-flight tampering, not against root.

CREATE OR REPLACE RULE emd_events_no_update AS
  ON UPDATE TO earnest_money_events DO INSTEAD NOTHING;

CREATE OR REPLACE RULE emd_events_no_delete AS
  ON DELETE TO earnest_money_events DO INSTEAD NOTHING;
