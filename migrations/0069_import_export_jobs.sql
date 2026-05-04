-- Phase 4 Week 15-16 — Migration In/Out Parity
--
-- Adds two tables for the import/export job machinery:
--
-- 1. import_jobs       — tracks 50K-row CSV import jobs, communications-history
--                        imports, and document/ZIP imports. Worker picks up
--                        queued rows in chunks of 500 and updates progress so
--                        the UI can show a progress bar.
--
-- 2. export_jobs       — tracks /api/export/everything single-archive export
--                        jobs. Worker generates a single ZIP per job and stores
--                        the result path so the UI can offer a one-click
--                        download link when status=completed.
--
-- See:
--   server/services/migrationJobs.ts  — worker
--   server/routes-import-export.ts    — endpoints + job creation
--   server/jobs/scheduler.ts          — driver that ticks the worker

CREATE TABLE IF NOT EXISTS "import_jobs" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL,
  -- 'leads' | 'properties' | 'deals' | 'notes' | 'communications' | 'documents'
  "kind" text NOT NULL,
  -- 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  "status" text NOT NULL DEFAULT 'queued',
  "filename" text,
  -- Stored payload reference (filesystem path, s3 key, or inline base64).
  "payload_ref" text,
  -- Optional user-supplied column mapping (CSV header → entity field).
  "field_map" jsonb,
  -- Counters for progress UI.
  "total_rows" integer NOT NULL DEFAULT 0,
  "processed_count" integer NOT NULL DEFAULT 0,
  "success_count" integer NOT NULL DEFAULT 0,
  "error_count" integer NOT NULL DEFAULT 0,
  "duplicates_skipped" integer NOT NULL DEFAULT 0,
  -- First N row errors captured for the UI report; full errors live in result.
  "errors" jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Detailed result blob written by the worker on terminal status.
  "result" jsonb,
  "error_message" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "started_at" timestamp,
  "completed_at" timestamp
);

CREATE INDEX IF NOT EXISTS "import_jobs_org_status_idx"
  ON "import_jobs" ("organization_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "import_jobs_status_created_idx"
  ON "import_jobs" ("status", "created_at");

CREATE TABLE IF NOT EXISTS "export_jobs" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL,
  -- 'everything' | legacy values from older endpoints (kept for back-compat).
  "kind" text NOT NULL DEFAULT 'everything',
  -- 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  "status" text NOT NULL DEFAULT 'queued',
  -- { entityTypes?: string[], dateRange?: { from, to }, includeAttachments?: boolean }
  "params" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Where the resulting archive lives (filesystem path or s3 key).
  "archive_path" text,
  "archive_size_bytes" integer,
  "entity_counts" jsonb,
  "error_message" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "started_at" timestamp,
  "completed_at" timestamp,
  -- Archives expire after 7 days to bound disk usage.
  "expires_at" timestamp
);

CREATE INDEX IF NOT EXISTS "export_jobs_org_status_idx"
  ON "export_jobs" ("organization_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "export_jobs_status_created_idx"
  ON "export_jobs" ("status", "created_at");
