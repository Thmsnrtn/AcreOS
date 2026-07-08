-- 0169 — Founder Autopilot: the Experience Log (learning-loop procedural memory).
-- One row per autopilot action; real signals accrete as they land. Global. Additive + idempotent.
CREATE TABLE IF NOT EXISTS "autopilot_experiences" (
  "id" serial PRIMARY KEY,
  "move_kind" text NOT NULL,
  "domain" text NOT NULL,
  "play_id" text,
  "outcome" text NOT NULL,
  "dispatch_id" integer,
  "ask_id" integer,
  "dispatch_success" boolean,
  "eval_score" numeric,
  "founder_verdict" text,
  "resolution" text,
  "satisfaction" integer,
  "cost_usd" numeric,
  "created_at" timestamp DEFAULT now(),
  "resolved_at" timestamp
);
CREATE INDEX IF NOT EXISTS "autopilot_experiences_play_idx" ON "autopilot_experiences" ("play_id");
CREATE INDEX IF NOT EXISTS "autopilot_experiences_dispatch_idx" ON "autopilot_experiences" ("dispatch_id");
CREATE INDEX IF NOT EXISTS "autopilot_experiences_ask_idx" ON "autopilot_experiences" ("ask_id");
