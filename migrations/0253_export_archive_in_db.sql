-- DEFECT-0142: an export archive lives in the row, not in one machine's /tmp.
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "archive_bytes" bytea;
