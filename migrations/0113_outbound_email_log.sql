-- Tahoe E10 — lifecycle email registry → universal outbound substrate (Soren).
--
-- Adds outbound_email_log: the audit trail for every send routed through the
-- single typed registry (server/services/emailRegistry.ts). Each row records
-- the named kind, category (transactional | lifecycle), recipient, subject,
-- and the delivery decision (sent | failed | suppressed | skipped). Lifecycle/
-- marketing sends are suppression-checked before dispatch; the registry writes
-- the row regardless so the founder surface can answer "did we send X to org N".
--
-- All statements are IF NOT EXISTS — safe to re-run.

CREATE TABLE IF NOT EXISTS "outbound_email_log" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer,
  "kind" text NOT NULL,
  "category" text NOT NULL,
  "recipient" text NOT NULL,
  "subject" text NOT NULL,
  "status" text NOT NULL,
  "message_id" text,
  "error" text,
  "error_type" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Leading-org composite per scripts/check-org-leading-index.mjs: the founder
-- audit surface filters by org + kind, ordered by recency.
CREATE INDEX IF NOT EXISTS "idx_outbound_email_log_org_kind_created"
  ON "outbound_email_log" ("organization_id", "kind", "created_at");

CREATE INDEX IF NOT EXISTS "idx_outbound_email_log_recipient_created"
  ON "outbound_email_log" ("recipient", "created_at");
