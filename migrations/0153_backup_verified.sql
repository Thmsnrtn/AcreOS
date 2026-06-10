-- 0153 — Tier 1E (elevation blueprint) — backup restore-verification ledger.
--
-- A backup that has never been restored is a hope, not a backup. The weekly
-- backup_restore_verify job (server/jobs/backupRestoreVerify.ts) downloads the
-- latest pg_dump from DB_BACKUP_S3_BUCKET, restores it into a scratch
-- database, asserts row-count parity on the crown-jewel tables against live
-- production counts (within tolerance), then drops the scratch DB and writes
-- one row here. The deadman watches the job's liveness via job_health_logs;
-- this table is the durable PROOF trail (and the row the deadman/founder
-- surfaces can read to answer "when did a restore last actually work?").
--
-- status: 'verified' | 'failed' | 'skipped_config' (config-dormant run).
-- tables_checked: jsonb array of { table, prodCount, scratchCount, ok }.

CREATE TABLE IF NOT EXISTS "backup_verified" (
  "id" serial PRIMARY KEY,
  "backup_key" text NOT NULL,
  "backup_size_bytes" bigint,
  "status" text NOT NULL,
  "tables_checked" jsonb,
  "max_drift_pct" real,
  "error" text,
  "duration_ms" integer,
  "verified_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "backup_verified_at_idx"
  ON "backup_verified" ("verified_at");
