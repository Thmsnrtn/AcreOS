-- 0252 — import job payload lives in the database (DEFECT-0130).
-- The uploaded file was written to the local /tmp of the app machine that
-- received it, while the separate worker machine could claim the job and not
-- find the file. The database is the one store every machine shares.
-- heartbeat_at lets the tick fail a job whose worker died mid-run.
ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "payload_bytes" bytea;
ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "heartbeat_at" timestamp;
