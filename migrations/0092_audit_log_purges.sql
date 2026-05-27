-- Lens 13 / Kareem §1: Audit-log purge sealing.
--
-- Background: server/storage.ts:purgeOldAuditLogs() previously DELETEd rows by
-- (organization_id, created_at < beforeDate). With the SHA-256 hash chain
-- introduced in 0080_audit_log_hash_chain.sql, a naive delete leaves a gap
-- where the next surviving row's prev_hash points at a now-missing row_hash,
-- which makes the chain unverifiable for everything after the gap.
--
-- The fix: every purge writes a *sealing row* into audit_log itself before the
-- delete runs. The sealing row's prev_hash equals the row_hash of the last
-- purged row, its row_hash is the cumulative SHA-256 of every purged row's
-- row_hash (in id order), and its metadata records the purge ID + purged
-- count + purged-through timestamp. After the sealing row is committed and
-- the underlying rows deleted, the chain verifier sees:
--
--   …  row N  (last unaffected pre-purge row, row_hash = H_pre)
--      row S  (sealing row, prev_hash = H_lastPurged, row_hash = H_cum)
--      row M  (next post-purge row, prev_hash = H_cum)
--
-- The verifier consults the sealing row's metadata to confirm the
-- discontinuity is a *documented* purge, not tampering. Chain integrity is
-- preserved because every purged row's row_hash contributed to H_cum.
--
-- audit_log_purges holds the ledger of every purge for compliance evidence.

CREATE TABLE IF NOT EXISTS audit_log_purges (
  id              serial      PRIMARY KEY,
  organization_id integer     NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  purged_before   timestamp   NOT NULL,
  purge_started_at  timestamp NOT NULL DEFAULT now(),
  purge_completed_at timestamp,
  purged_count    integer     NOT NULL DEFAULT 0,
  -- row_hash of the most recent purged row (or NULL if no chained rows were
  -- purged). This is the value the sealing row's prev_hash is set to.
  last_purged_row_hash text,
  -- SHA-256 over every purged row's row_hash, concatenated in ascending id
  -- order with '\n' separators. This is the sealing row's row_hash.
  sealing_hash    text,
  -- Pointer into audit_log for the sealing row this purge created. Lets the
  -- chain verifier resolve discontinuities → "is this a documented purge?".
  sealing_audit_log_id integer REFERENCES audit_log(id) ON DELETE RESTRICT,
  actor_user_id   text,
  -- Free-form metadata (e.g. retention policy that triggered the purge).
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_log_purges_org_idx
  ON audit_log_purges (organization_id, purge_started_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_purges_sealing_idx
  ON audit_log_purges (sealing_audit_log_id);

COMMENT ON TABLE audit_log_purges IS
  'Ledger of audit_log purges. Each row records the purged window, the cumulative hash of purged rows, and the sealing audit_log row that documents the discontinuity for chain verification.';
