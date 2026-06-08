-- ============================================================================
-- 0143 — Beatrice (CRO) — audit_log hash-chain TAMPER-EVIDENCE (confirmation)
-- ----------------------------------------------------------------------------
-- TAMPER-EVIDENCE, NOT LEGAL PROOF.
--
-- The audit_log SHA-256 hash chain (prev_hash / row_hash columns + the
-- append-only trigger) was ORIGINALLY shipped as migration 0080 and is already
-- present in scripts/migrate.mjs (see the "0080 audit_log hash chain" block).
-- This 0143 migration is a deliberately IDEMPOTENT confirmation of that schema
-- so the chain's canonical surface is pinned to a known migration number for
-- the compliance-services wave. It adds nothing new — every statement here is
-- IF NOT EXISTS / CREATE OR REPLACE and is a no-op on an up-to-date database.
--
-- What the chain provides
-- ───────────────────────
--   * Each audit_log row carries prev_hash (the previous chained row's row_hash
--     for the same org, or 'GENESIS') and row_hash = SHA-256(prev_hash || '\n'
--     || canonical(row)).
--   * A Postgres trigger blocks UPDATE/DELETE of business columns on any
--     already-chained row, while still allowing the one-time NULL → non-NULL
--     write of the two hash columns that the chaining writer performs.
--
-- What it is NOT
-- ──────────────
--   * It is NOT legal proof that any particular event did or did not occur.
--   * It is NOT a notarization or a third-party-attested timestamp.
--   * It is tamper-EVIDENCE: it lets a reviewer DETECT after the fact that the
--     log was altered, deleted, or had rows inserted out of band. It cannot by
--     itself prevent a sufficiently privileged operator from rewriting history
--     (e.g. by disabling the trigger). Treat a clean verification as supporting
--     evidence, not as conclusive proof.
--
-- Verification entry point: verifyAuditChain(organizationId) in
-- server/services/compliance/auditChain.ts (re-exports verifyAuditLogChain from
-- server/utils/auditLogChain.ts), surfaced via /api/admin/audit-log/verify.
--
-- Mirrors shared/schema.ts (auditLog.prevHash / auditLog.rowHash) +
-- scripts/migrate.mjs. Safe to re-run.
-- ============================================================================

ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "prev_hash" text;
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "row_hash" text;

CREATE INDEX IF NOT EXISTS "audit_log_org_id_idx"
  ON "audit_log" ("organization_id", "id");
CREATE INDEX IF NOT EXISTS "audit_log_org_chain_idx"
  ON "audit_log" ("organization_id", "id" DESC) WHERE "row_hash" IS NOT NULL;

-- Append-only trigger: block mutation/deletion of chained rows, while allowing
-- the one-time NULL → non-NULL write of the two hash columns.
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
    IF OLD.row_hash IS NOT NULL THEN
      RAISE EXCEPTION 'audit_log row % is chained and cannot be modified', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
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
