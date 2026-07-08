-- ============================================================================
-- 0198 — Reactivation surveys (launch-week WS1, 2026-07-07)
-- ----------------------------------------------------------------------------
-- The welcome-back win-back page has always POSTed the visitor's
-- "what brought you back" reason to /api/subscription/reactivation-survey —
-- an endpoint that never existed (the call is try/catch-swallowed, so the
-- signal silently 404'd). This table + the new route make the signal real.
-- Composite index leads with organization_id (org-leading-index gate).
-- Mirrors shared/schema.ts (reactivationSurveys) + scripts/migrate.mjs.
-- Idempotent (IF NOT EXISTS) — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "reactivation_surveys" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations" ("id") ON DELETE CASCADE,
  "user_id" text,
  "return_reason" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "reactivation_surveys_org_created_idx"
  ON "reactivation_surveys" ("organization_id", "created_at");
