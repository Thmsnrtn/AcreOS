-- ============================================================================
-- 0239 — earnest_money_events: append-only by TRIGGER, not by RULE
--        (2026-08-17) — and with it, org deletion works again at all
-- ----------------------------------------------------------------------------
-- migrations/0086 enforced append-only with two rewrite RULEs:
--
--   CREATE RULE emd_events_no_update AS ON UPDATE TO earnest_money_events
--     DO INSTEAD NOTHING;
--   CREATE RULE emd_events_no_delete AS ON DELETE TO earnest_money_events
--     DO INSTEAD NOTHING;
--
-- The intent was right and is preserved below. The mechanism has two failure
-- modes, one cosmetic and one severe.
--
-- ── 1. DO INSTEAD NOTHING IS SILENT ─────────────────────────────────────────
-- An UPDATE or DELETE against this table did not fail. It reported success and
-- changed nothing. Application code trying to tamper got the same answer as
-- code that succeeded, and so did anyone testing whether the guarantee held.
-- A guarantee you cannot observe being enforced is a guarantee you cannot
-- trust.
--
-- ── 2. IT BROKE ORGANIZATION DELETION ENTIRELY ──────────────────────────────
-- This is the severe one. PostgreSQL implements foreign-key checks by running
-- internal queries against the referencing table. A rewrite rule rewrites those
-- too, so the integrity check returns something the planner did not expect and
-- the whole statement aborts:
--
--   ERROR: referential integrity query on "organizations" from constraint
--          "earnest_money_events_organization_id_fkey" on "earnest_money_events"
--          gave unexpected result
--   HINT:  This is most likely due to a rule having rewritten the query.
--
-- MEASURED against PostgreSQL 16: `DELETE FROM organizations WHERE id = 9`
-- fails for an organization with ZERO earnest_money_events rows. The rule does
-- not need matching data to break the check — it breaks the check itself. So
-- the failure is not "orgs with escrow history cannot be deleted", it is
-- NO ORGANIZATION CAN EVER BE DELETED.
--
-- That statement is server/services/orgDeletion.ts:122, which is the GDPR
-- erasure path (gdprService.ts:198 points at it). A right-to-erasure request
-- could not have been honoured for any customer, and would have failed with an
-- error naming a foreign key rather than anything a reader would connect to
-- deletion being blocked.
--
-- ── THE REPLACEMENT ─────────────────────────────────────────────────────────
-- A BEFORE UPDATE trigger that RAISES. Triggers do not rewrite queries, so the
-- referential-integrity machinery is untouched.
--
-- UPDATE stays refused, and now refuses LOUDLY — that was the actual point of
-- 0086: an escrow ledger must not be rewritable in flight, including by a
-- compromised application user.
--
-- DELETE is no longer blocked, deliberately. Erasing a record and rewriting one
-- are different acts: rewriting fakes history, erasing removes it and admits as
-- much. Blocking DELETE here does not preserve an escrow trail — it makes the
-- tenant permanently undeletable, which is a legal liability rather than a
-- control. Retention of escrow records past a customer's departure is a
-- records-retention question about EXPORTED evidence, not a reason to make live
-- rows immortal. Same asymmetry as 0238 on evidence_claims, for the same
-- reason.
--
-- The retention question itself is queued for the owner (OD-6) — it is a legal
-- call, not an engineering one. What is not a legal call is whether GDPR
-- erasure works at all, which is what this restores.

DROP RULE IF EXISTS "emd_events_no_update" ON "earnest_money_events";
DROP RULE IF EXISTS "emd_events_no_delete" ON "earnest_money_events";

CREATE OR REPLACE FUNCTION "emd_events_refuse_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'earnest_money_events is append-only: UPDATE refused on event id=%. Escrow history is corrected by recording a NEW event, never by rewriting an old one.',
    OLD."id";
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "emd_events_no_update_trg" ON "earnest_money_events";
CREATE TRIGGER "emd_events_no_update_trg"
  BEFORE UPDATE ON "earnest_money_events"
  FOR EACH ROW EXECUTE FUNCTION "emd_events_refuse_update"();
