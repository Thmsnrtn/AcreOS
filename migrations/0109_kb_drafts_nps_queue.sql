-- ============================================================================
-- 0109 — Rafe / Krieger — Tahoe E3 customer-support substrate mounts.
-- ----------------------------------------------------------------------------
-- Sub-2: KB auto-publish from resolved tickets. Adds draft-queue columns to
--        knowledge_base_articles so a resolved-and-publishable ticket creates
--        a draft (is_draft=true, draft_status='pending_review') instead of a
--        live article. The /founder/support/kb-drafts surface reviews + flips
--        is_published=true on publish.
-- Sub-3: NPS prompt queue. Daily scheduler enqueues one row per (org,
--        primary_user) when the org-age + recency gates pass; the dialog hook
--        reads + consumes it on login.
-- Mirrors shared/schema.ts and scripts/migrate.mjs.
-- ============================================================================

ALTER TABLE "knowledge_base_articles" ADD COLUMN IF NOT EXISTS "is_draft" boolean DEFAULT false;
ALTER TABLE "knowledge_base_articles" ADD COLUMN IF NOT EXISTS "draft_status" text;
ALTER TABLE "knowledge_base_articles" ADD COLUMN IF NOT EXISTS "source_ticket_id" integer REFERENCES "support_tickets" ("id");
CREATE INDEX IF NOT EXISTS "kb_articles_draft_status_idx" ON "knowledge_base_articles" ("draft_status", "created_at");

CREATE TABLE IF NOT EXISTS "nps_prompt_queue" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations" ("id"),
  "user_id" text NOT NULL,
  "trigger" text NOT NULL,
  "scheduled_for" timestamp NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "shown_at" timestamp,
  "consumed_at" timestamp,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "nps_prompt_queue_org_status_scheduled_idx" ON "nps_prompt_queue" ("organization_id", "status", "scheduled_for");
CREATE INDEX IF NOT EXISTS "nps_prompt_queue_user_status_idx" ON "nps_prompt_queue" ("user_id", "status");
