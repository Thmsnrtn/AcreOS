-- ============================================================================
-- 0303 — E2 slice 1 (Pax core), leg 2: the morning brief archive.
--
-- GET /api/today composes a sectioned morning brief from real state — what
-- changed, what needs you, what Pax prepared (server/services/
-- morningBriefSections.ts). This table keeps one row per org per local day so
-- today's card can be dismissed and past briefs reopened from /today.
-- Dismissal is a stamp (dismissed_at), never a deletion; rows go with the org
-- (ON DELETE CASCADE), like today_queue_state (0141).
--
-- Unique (organization_id, brief_date): the day's row is upserted, and the
-- archive list is a single per-tenant index probe
-- (scripts/check-org-leading-index.mjs).
--
-- Mirrors shared/schema/pax-morning-briefs.ts (paxMorningBriefs) + scripts/migrate.mjs STATEMENTS.
-- Idempotent (IF NOT EXISTS) — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "pax_morning_briefs" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations" ("id") ON DELETE CASCADE,
  "brief_date" text NOT NULL,
  "headline" text,
  "sections" jsonb NOT NULL,
  "dismissed_at" timestamp,
  "dismissed_by" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "pax_morning_briefs_org_date_idx"
  ON "pax_morning_briefs" ("organization_id", "brief_date");
