-- 0289 — D2e: the purpose ledger (Amendment 2 §2.3).
--
-- One row per person-adjacent lookup: actor, organization, the permissible-
-- purpose code declared, parcel/lead context, and the metering event it rode
-- on. APPEND-ONLY: UPDATE, DELETE and TRUNCATE raise restrict_violation
-- unless the session sets the GUC acreos.allow_purpose_ledger_mutation = 'on'
-- (retention pruning only). That GUC is an explicit, greppable opt-in, NOT a
-- privilege boundary: any role that can connect can set a custom GUC.
-- organization_id has NO foreign key, by design: the ledger is retained under
-- GDPR Art. 17(3)(b) when its organization is erased (orgDeletion.ts
-- RETAINED_TABLES). An FK would either cascade-delete a compliance record or
-- block deleteOrganization() from removing the organizations row.
CREATE TABLE IF NOT EXISTS "purpose_ledger" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "actor_user_id" text NOT NULL,
  "surface" text NOT NULL,
  "purpose_code" text NOT NULL,
  "justification" text,
  "attestation_version" text,
  "lead_id" integer,
  "skip_trace_id" integer,
  "apid" text,
  "metering_ref" text,
  "metadata" jsonb
);
CREATE INDEX IF NOT EXISTS "purpose_ledger_org_created_idx" ON "purpose_ledger" ("organization_id", "created_at");

CREATE OR REPLACE FUNCTION purpose_ledger_deny_mutation()
RETURNS trigger AS $$
BEGIN
  IF current_setting('acreos.allow_purpose_ledger_mutation', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'purpose_ledger is append-only (UPDATE/DELETE/TRUNCATE denied)'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS purpose_ledger_no_update ON "purpose_ledger";
CREATE TRIGGER purpose_ledger_no_update
  BEFORE UPDATE ON "purpose_ledger"
  FOR EACH ROW
  EXECUTE FUNCTION purpose_ledger_deny_mutation();

DROP TRIGGER IF EXISTS purpose_ledger_no_delete ON "purpose_ledger";
CREATE TRIGGER purpose_ledger_no_delete
  BEFORE DELETE ON "purpose_ledger"
  FOR EACH ROW
  EXECUTE FUNCTION purpose_ledger_deny_mutation();

DROP TRIGGER IF EXISTS purpose_ledger_no_truncate ON "purpose_ledger";
CREATE TRIGGER purpose_ledger_no_truncate
  BEFORE TRUNCATE ON "purpose_ledger"
  FOR EACH STATEMENT
  EXECUTE FUNCTION purpose_ledger_deny_mutation();
