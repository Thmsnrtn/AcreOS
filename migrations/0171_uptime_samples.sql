-- 0171 — append-only uptime samples. The worker writes one row ~per minute;
-- gaps between consecutive samples are provable downtime. Real uptime % is
-- derived from these. Global. Additive + idempotent.
CREATE TABLE IF NOT EXISTS "uptime_samples" (
  "id" serial PRIMARY KEY,
  "at" timestamp NOT NULL DEFAULT now(),
  "source" text NOT NULL DEFAULT 'worker'
);
CREATE INDEX IF NOT EXISTS "uptime_samples_at_idx" ON "uptime_samples" ("at");
