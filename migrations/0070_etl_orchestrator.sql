-- Phase 8 Months 11 — Wenzeslaus ETL Orchestrator
--
-- Unified pull-side data pipeline. Replaces ad-hoc fetch code scattered
-- across services with a single orchestrator that owns:
--
--   1. etl_jobs   — durable job catalog: provider, source URL, watermark
--                   column, current watermark value, cron schedule, last
--                   success/error timestamps. The watermark column lets a
--                   handler request only records updated since the last
--                   successful run (incremental sync).
--
--   2. etl_runs   — execution log per run: started/completed timestamps,
--                   status, records read/inserted/updated/deleted/failed,
--                   error message, and the watermark value before+after
--                   the run so an operator can tie a regression to the
--                   exact slice of upstream data that was processed.
--
-- Failed records (within an otherwise-running job) are dead-lettered into
-- the existing `outbox_dlq` table (Wave 7 — see migrations/0046) with a
-- payload that contains the original record + error message + the etl_run
-- id, so the founder /etl UI can replay them one-at-a-time.
--
-- The cron coordinator (server/services/etlOrchestrator.ts) consults
-- etl_jobs.schedule + etl_jobs.lastSuccessAt to decide which jobs are due,
-- and uses withJobLock() so two scheduler instances never run the same
-- job concurrently.

CREATE TABLE IF NOT EXISTS "etl_jobs" (
  "id" serial PRIMARY KEY,
  "job_name" text NOT NULL UNIQUE,
  "provider_name" text NOT NULL,
  "source_url" text,
  "watermark_column" text,
  "watermark_value" text,
  "schedule" text NOT NULL DEFAULT '*/15 * * * *',
  "is_active" boolean NOT NULL DEFAULT true,
  "soft_delete_on_missing" boolean NOT NULL DEFAULT false,
  "last_success_at" timestamp,
  "last_error_at" timestamp,
  "last_error" text,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "etl_jobs_provider_idx"
  ON "etl_jobs" ("provider_name");
CREATE INDEX IF NOT EXISTS "etl_jobs_active_idx"
  ON "etl_jobs" ("is_active", "last_success_at");

CREATE TABLE IF NOT EXISTS "etl_runs" (
  "id" serial PRIMARY KEY,
  "job_id" integer NOT NULL REFERENCES "etl_jobs" ("id") ON DELETE CASCADE,
  "started_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp,
  "status" text NOT NULL DEFAULT 'running', -- running | success | failure
  "records_read" integer NOT NULL DEFAULT 0,
  "records_inserted" integer NOT NULL DEFAULT 0,
  "records_updated" integer NOT NULL DEFAULT 0,
  "records_deleted" integer NOT NULL DEFAULT 0,
  "records_failed" integer NOT NULL DEFAULT 0,
  "error_message" text,
  "watermark_before" text,
  "watermark_after" text
);

CREATE INDEX IF NOT EXISTS "etl_runs_job_started_idx"
  ON "etl_runs" ("job_id", "started_at" DESC);
CREATE INDEX IF NOT EXISTS "etl_runs_status_idx"
  ON "etl_runs" ("status");

-- Seed the two reference jobs that migrate the Regrid + FEMA bulk pull
-- paths onto the orchestrator. Both start `is_active = false` so they
-- don't run until an operator flips them on (and confirms credentials)
-- via the founder UI. Once active they'll show up in the next
-- `runDueJobs()` tick.
INSERT INTO "etl_jobs" ("job_name", "provider_name", "source_url", "watermark_column", "schedule", "is_active", "soft_delete_on_missing")
VALUES
  ('regrid_parcels_v1', 'regrid_parcels', 'https://app.regrid.com/api/v2/parcels', 'updated_at', '*/30 * * * *', false, false),
  ('fema_flood_zones_v1', 'fema_flood_zones', 'https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query', 'mod_date', '0 */6 * * *', false, false)
ON CONFLICT ("job_name") DO NOTHING;
