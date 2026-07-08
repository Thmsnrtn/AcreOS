-- 0174 — Founder Autopilot runtime settings (DB-backed master switches, so the
-- founder flips the autopilot from the Control Center instead of a Fly secret).
-- Singleton row (id=1); null columns fall back to the env default. Additive + idempotent.
CREATE TABLE IF NOT EXISTS "autopilot_settings" (
  "id" integer PRIMARY KEY DEFAULT 1,
  "dispatch_enabled" boolean,
  "publish_enabled" boolean,
  "updated_at" timestamp DEFAULT now(),
  "updated_by" text
);
