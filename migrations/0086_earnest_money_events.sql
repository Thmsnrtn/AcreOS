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
  hold_id           uuid    NOT NULL REFERENCES earnest_money_holds(id) ON DELETE CASCADE,

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

-- Append-only enforcement. The intent below is unchanged and still right:
-- application code (or a compromised app user) must not be able to rewrite
-- escrow history in flight.
--
-- The two rewrite RULES that used to live here were REMOVED on 2026-08-17 and
-- replaced by a BEFORE UPDATE trigger in
-- migrations/0239_emd_events_append_only_via_trigger.sql. They are not
-- reinstated here, so a database rebuilt from this repository never creates
-- them in the first place; 0239 also DROPs them for any database that already
-- has them.
--
-- They were removed because a rewrite rule rewrites PostgreSQL's OWN
-- foreign-key check queries, not just the caller's. Measured against
-- PostgreSQL 16: `DELETE FROM organizations WHERE id = 9` aborted with
-- "referential integrity query ... gave unexpected result" for an organization
-- with ZERO earnest_money_events rows. That is server/services/orgDeletion.ts,
-- the GDPR erasure path — so no organization could be deleted, ever. The rules
-- also made UPDATE a SILENT no-op, which reports success to a tamperer.
--
-- See tests/unit/evidenceClaimsIntegrity.test.ts, which fails if any migration
-- brings `DO INSTEAD NOTHING` back.
