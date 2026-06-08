-- 0140 — Rafe (CCO) — the Recourse Loop draft ledger.
--
-- Every NEGATIVE customer signal (detractor NPS ≤6, low support rating ≤2/5,
-- cancellation) becomes a DRAFTED, personal, same-hour human reply sitting in
-- one founder queue, one-click to edit-and-send, with the sent reply persisted
-- back so the loop is auditable. This table is the persistence layer.
--
-- Mirrors shared/schema/recourse-drafts.ts and the migrate.mjs 0140 block.

CREATE TABLE IF NOT EXISTS "recourse_drafts" (
  "id"                 serial PRIMARY KEY,
  "organization_id"    integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "signal_type"        text NOT NULL,
  "signal_ref_type"    text NOT NULL,
  "signal_ref_id"      integer,
  "recipient_user_id"  text,
  "recipient_email"    text,
  "customer_verbatim"  text,
  "context_summary"    text,
  "draft_body"         text,
  "draft_model"        text,
  "sent_body"          text,
  "status"             text NOT NULL DEFAULT 'draft',
  "sent_at"            timestamptz,
  "email_status"       text,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_at"         timestamptz NOT NULL DEFAULT now()
);

-- L3 lint — leading on organization_id; per-org open-queue shape.
CREATE INDEX IF NOT EXISTS "recourse_drafts_org_status_created_idx"
  ON "recourse_drafts" ("organization_id", "status", "created_at");

-- Dedupe: at most one draft per source signal.
CREATE UNIQUE INDEX IF NOT EXISTS "recourse_drafts_signal_ref_idx"
  ON "recourse_drafts" ("signal_ref_type", "signal_ref_id");
