-- 0176 — Founder Autopilot attribution ledger. A signup attributed (off the
-- witnessed marketing_touch chain) to a published artifact. A lower bound;
-- founder-dashboard only. Global. Additive + idempotent.
CREATE TABLE IF NOT EXISTS "autopilot_conversions" (
  "id" serial PRIMARY KEY,
  "artifact_id" integer,
  "play_id" text,
  "anon_id" text,
  "organization_id" integer,
  "event" text NOT NULL,
  "attributed_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "autopilot_conversions_artifact_idx" ON "autopilot_conversions" ("artifact_id");
CREATE UNIQUE INDEX IF NOT EXISTS "autopilot_conversions_dedup_uq" ON "autopilot_conversions" ("artifact_id", "anon_id", "event");
CREATE INDEX IF NOT EXISTS "autopilot_conversions_org_event_idx" ON "autopilot_conversions" ("organization_id", "event");
