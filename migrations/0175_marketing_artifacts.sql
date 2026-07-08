-- 0175 — Founder Autopilot published marketing artifacts (the stable id every
-- attribution keys against). One row per artifact published to a public owned
-- surface. Global. Additive + idempotent.
CREATE TABLE IF NOT EXISTS "marketing_artifacts" (
  "id" serial PRIMARY KEY,
  "dispatch_id" integer,
  "play_id" text,
  "slug" text NOT NULL,
  "surface" text NOT NULL DEFAULT 'field_note',
  "county" text,
  "state" text,
  "published_at" timestamp,
  "unpublished_at" timestamp,
  "view_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "marketing_artifacts_slug_idx" ON "marketing_artifacts" ("slug");
CREATE INDEX IF NOT EXISTS "marketing_artifacts_dispatch_idx" ON "marketing_artifacts" ("dispatch_id");
