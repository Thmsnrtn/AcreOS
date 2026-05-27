-- Kareem §1 (SOC 2 CC7.2 / CC7.3): tamper-evident audit_log via SHA-256 hash
-- chain. Every new audit_log row carries:
--   prev_hash : the row_hash of the immediately-preceding row for the same
--               organization (or the literal string 'GENESIS' for the first
--               row in an org).
--   row_hash  : SHA-256( prev_hash || canonical(id,action,actor,target,
--                                                payload,timestamp) )
--
-- Application code (server/utils/auditLogChain.ts) computes the chain and
-- writes both columns inside the same statement that inserts the row. To
-- prevent silent rewrites/deletions invalidating the chain, we install an
-- append-only trigger that rejects UPDATE and DELETE on any row whose
-- row_hash has already been written.
--
-- Backfill: existing rows are left with NULL prev_hash/row_hash. The
-- /api/admin/audit-log/verify endpoint treats those as "pre-chain" and
-- starts verification from the first row whose row_hash is not null.
-- A follow-up offline backfill can populate them retroactively if desired.

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS prev_hash text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS row_hash text;

CREATE INDEX IF NOT EXISTS audit_log_org_id_idx
  ON audit_log (organization_id, id);

-- Lookup helper for "the most recent chained row for this org" used by the
-- application before inserting a new row.
CREATE INDEX IF NOT EXISTS audit_log_org_chain_idx
  ON audit_log (organization_id, id DESC)
  WHERE row_hash IS NOT NULL;

-- Append-only trigger: once row_hash is set, the row is frozen. The chain
-- function NULL-initialises briefly and then UPDATEs in-statement via
-- INSERT ... RETURNING, so we allow updates only when row_hash transitions
-- NULL → non-NULL (chain backfill) but block every other mutation.
CREATE OR REPLACE FUNCTION audit_log_chain_block() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.row_hash IS NOT NULL THEN
      RAISE EXCEPTION 'audit_log row % is chained and cannot be deleted', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Allow NULL → non-NULL backfill of the hash columns. Block everything else.
    IF OLD.row_hash IS NOT NULL THEN
      RAISE EXCEPTION 'audit_log row % is chained and cannot be modified', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    -- Only the two hash columns can flip on this transitional UPDATE.
    IF (NEW.organization_id, NEW.user_id, NEW.action, NEW.entity_type,
        NEW.entity_id, NEW.changes, NEW.ip_address, NEW.user_agent,
        NEW.metadata, NEW.created_at)
       IS DISTINCT FROM
       (OLD.organization_id, OLD.user_id, OLD.action, OLD.entity_type,
        OLD.entity_id, OLD.changes, OLD.ip_address, OLD.user_agent,
        OLD.metadata, OLD.created_at) THEN
      RAISE EXCEPTION 'audit_log row % business columns are immutable', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_chain_block_trg ON audit_log;
CREATE TRIGGER audit_log_chain_block_trg
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_chain_block();

COMMENT ON COLUMN audit_log.prev_hash IS
  'SHA-256 hash of the previous chained row for this organization, or ''GENESIS'' for the first row. Computed in server/utils/auditLogChain.ts.';
COMMENT ON COLUMN audit_log.row_hash IS
  'SHA-256( prev_hash || canonical(id,action,actor,target,payload,timestamp) ). Once set, this row is immutable (enforced via audit_log_chain_block trigger).';
