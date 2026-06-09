-- ============================================================================
-- 0145 — Beatrice (CRO) — audit_events HASH CHAIN (crown-jewel tamper-evidence)
-- ----------------------------------------------------------------------------
-- TAMPER-EVIDENCE, NOT LEGAL PROOF.
--
-- migration 0143 pinned the audit_log SHA-256 hash chain. But the MOST
-- sensitive events — login, MFA-disable, ownership-transfer, refunds,
-- DSAR-erasure — are written to a DIFFERENT table, `audit_events` (via
-- server/utils/auditLog.ts), which was previously UN-chained. This migration
-- extends the same tamper-evidence scheme to `audit_events`.
--
-- How it differs from audit_log's chain (0143)
-- ────────────────────────────────────────────
--   * GLOBAL chain, not per-org. audit_events is intentionally org-less
--     (cross-org targets: account-wide 2FA resets, ownership transfers), so the
--     chain is one single global sequence, ordered by the new `seq` bigserial
--     column (the UUID PK is random and cannot order a chain).
--   * Hash computed BEFORE insert; the fully-chained row is written in a SINGLE
--     INSERT. audit_events already carries a blanket append-only UPDATE-deny
--     trigger (migration 0049 — `audit_events_no_update`), so audit_log's
--     insert-then-UPDATE chaining pattern is impossible here. The chaining
--     writer (server/utils/auditEventsChain.ts) therefore never UPDATEs a row.
--
-- Columns added
-- ─────────────
--   * seq        BIGSERIAL — monotonic global ordering key for the chain walker.
--                 NOT part of the canonical hash payload.
--   * prev_hash  TEXT — previous chained row's row_hash (global max-seq), or
--                 'GENESIS'. Nullable for pre-chain backfill rows.
--   * row_hash   TEXT — SHA-256(prev_hash || '\n' || canonical(payload)).
--
-- What it is NOT
-- ──────────────
--   * NOT legal proof that any particular event did or did not occur.
--   * NOT a notarization or third-party-attested timestamp.
--   * It is tamper-EVIDENCE: a reviewer can DETECT after the fact that the log
--     was altered, deleted, or had rows inserted out of band. It cannot by
--     itself prevent a sufficiently privileged operator from rewriting history.
--
-- Verification entry point: verifyAuditEventsChain() in
-- server/utils/auditEventsChain.ts.
--
-- Mirrors shared/schema.ts (auditEvents.seq / prevHash / rowHash) +
-- scripts/migrate.mjs. Idempotent (IF NOT EXISTS). Safe to re-run.
-- ============================================================================

ALTER TABLE "audit_events" ADD COLUMN IF NOT EXISTS "seq" bigserial;
ALTER TABLE "audit_events" ADD COLUMN IF NOT EXISTS "prev_hash" text;
ALTER TABLE "audit_events" ADD COLUMN IF NOT EXISTS "row_hash" text;

-- Chain walker reads the latest chained row (max seq where row_hash IS NOT
-- NULL) and walks ascending by seq.
CREATE INDEX IF NOT EXISTS "audit_events_seq_chain_idx"
  ON "audit_events" ("seq");

-- NOTE: the append-only UPDATE/DELETE-deny triggers on audit_events already
-- exist (migration 0049 — audit_events_no_update / audit_events_no_delete) and
-- need no change. INSERT of a fully-chained row is permitted; the chaining
-- writer never issues an UPDATE against a chained row.
