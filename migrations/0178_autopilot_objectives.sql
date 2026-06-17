-- 0178 — Autopilot objectives (Hands roadmap P5).
-- Structured goals the brain plans toward — "move THESE numbers", not just "do
-- sensible things." The founder declares targets in Your Voice; the planner
-- weights moves by expected objective movement; the daily letter reports
-- progress. `current` is refreshed from real senses (never invented).
-- Additive + idempotent.

CREATE TABLE IF NOT EXISTS "autopilot_objectives" (
  "id" serial PRIMARY KEY,
  "key" text NOT NULL,
  "label" text NOT NULL,
  "target" double precision NOT NULL,
  "current" double precision NOT NULL DEFAULT 0,
  "unit" text NOT NULL DEFAULT 'count',
  "owning_domain" text,
  "deadline" timestamp,
  "active" boolean NOT NULL DEFAULT true,
  "created_by" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "autopilot_objectives_key_uq"
  ON "autopilot_objectives" ("key");
