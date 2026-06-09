-- 0147 — Iris (CTO) — parcel_observations append-only LOCKDOWN (crown-jewel).
--
-- parcel_observations is the company's longitudinal "balance sheet" of parcel
-- facts (server/services/data-cache/observation-log.ts, shared/schema.ts ~6223):
-- every fact any path sees is written as one immutable row, fire-and-forget via
-- `void recordParcelObservations(...)` (server/services/parcel.ts ~479). It is
-- the unrecoverable system-of-record that feeds lead-alerts and parcel-biography
-- — backfilling lost history is impossible.
--
-- Until now its immutability was enforced ONLY by a code comment. Postgres can't
-- enforce "append-only" from table grants alone (the table owner can always
-- UPDATE/DELETE), so we install the same BEFORE-trigger pattern proven on
-- audit_events in 0049: a function that RAISEs on UPDATE/DELETE for every session
-- except one that has explicitly opted in via a session GUC. The runtime Fly.io
-- role never sets the GUC, so it can ONLY ever INSERT; a DBA doing retention
-- pruning sets `acreos.allow_parcel_observation_mutation = 'on'` for their
-- session and the trigger stands aside.
--
-- INSERT is untouched (BEFORE UPDATE/DELETE triggers never fire on INSERT), so
-- the load-bearing fire-and-forget write path keeps working.
--
-- NOTE: this is triggers only. The SHA-256 hash-chain (mirroring 0143/0145) is a
-- separate follow-up co-designed with Beatrice — intentionally NOT in this change.

CREATE OR REPLACE FUNCTION parcel_observations_deny_mutation()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow the trigger to be silenced during DBA-driven retention pruning by
  -- setting a session GUC. If unset (default), every UPDATE/DELETE raises.
  -- Production Fly.io runtime never sets this.
  IF current_setting('acreos.allow_parcel_observation_mutation', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'parcel_observations is append-only (UPDATE/DELETE denied)'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS parcel_observations_no_update ON parcel_observations;
CREATE TRIGGER parcel_observations_no_update
  BEFORE UPDATE ON parcel_observations
  FOR EACH ROW
  EXECUTE FUNCTION parcel_observations_deny_mutation();

DROP TRIGGER IF EXISTS parcel_observations_no_delete ON parcel_observations;
CREATE TRIGGER parcel_observations_no_delete
  BEFORE DELETE ON parcel_observations
  FOR EACH ROW
  EXECUTE FUNCTION parcel_observations_deny_mutation();
