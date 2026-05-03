-- Phase 3 Week 7-8 — Background Jobs Hardening
--
-- Adds three tables for the self-rescheduling background-jobs migration:
--
-- 1. outbox            — transactionally-staged outbound effects (webhooks,
--                        emails, billing events). Producers INSERT inside the
--                        same DB transaction as the state change; a drainer
--                        picks them up and dispatches them with at-least-once
--                        semantics. This eliminates the dual-write problem
--                        between the DB and external systems.
--
-- 2. outbox_dlq        — permanently-failed outbox rows. Once an outbox row
--                        exhausts its retry budget it is moved here so the
--                        primary table stays small and operators can replay
--                        or post-mortem failures from a stable surface.
--
-- 3. job_runs          — execution log for self-rescheduling jobs. Captures
--                        startedAt / completedAt / status / error / records
--                        processed for every run, giving us a join target
--                        for SLO dashboards and a stable input to the job
--                        supervisor's stuck-job detector.
--
-- See server/jobs/scheduler.ts for the helper that writes to job_runs and
-- routes failures into outbox_dlq.

CREATE TABLE IF NOT EXISTS "outbox" (
  "id" serial PRIMARY KEY,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'pending', -- pending | sent | failed
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error_at" timestamp,
  "last_error_message" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "sent_at" timestamp
);

CREATE INDEX IF NOT EXISTS "outbox_status_created_idx"
  ON "outbox" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "outbox_event_type_idx"
  ON "outbox" ("event_type");

CREATE TABLE IF NOT EXISTS "outbox_dlq" (
  "id" serial PRIMARY KEY,
  "original_outbox_id" integer,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'failed',
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "failed_at" timestamp NOT NULL DEFAULT now(),
  "failure_reason" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "outbox_dlq_event_type_idx"
  ON "outbox_dlq" ("event_type");
CREATE INDEX IF NOT EXISTS "outbox_dlq_failed_at_idx"
  ON "outbox_dlq" ("failed_at" DESC);

CREATE TABLE IF NOT EXISTS "job_runs" (
  "id" serial PRIMARY KEY,
  "job_name" text NOT NULL,
  "started_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp,
  "status" text NOT NULL DEFAULT 'running', -- running | success | failure | timeout
  "error_message" text,
  "records_processed" integer
);

CREATE INDEX IF NOT EXISTS "job_runs_job_name_started_idx"
  ON "job_runs" ("job_name", "started_at" DESC);
CREATE INDEX IF NOT EXISTS "job_runs_status_idx"
  ON "job_runs" ("status");
