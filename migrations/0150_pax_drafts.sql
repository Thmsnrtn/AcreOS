-- 0150 — T0-6 (elevation blueprint 2026-06-10) — bind witnessed-send approval
-- to the exact draft + make it idempotent.
--
-- The first-follow-up approve-and-send endpoint (routes-pax-insights.ts) used
-- to accept client-resupplied subject/message — so the human's approval was
-- NOT bound to the draft Pax actually wrote (any payload the client sent got
-- the trusted-send treatment) — and a double-tap sent the email twice.
--
-- pax_drafts persists the draft server-side the moment it is generated:
--   content_hash — sha256(subject + "\n" + message); the approve call must
--     present draftId + this hash, and the server sends the STORED row, never
--     client-supplied content.
--   status       — 'pending' | 'sent'. The pending→sent UPDATE (guarded by
--     WHERE status = 'pending') is the idempotency claim: the second tap finds
--     no pending row, reads the sent row, and returns the first result.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS).
-- Mirrored into scripts/migrate.mjs.

CREATE TABLE IF NOT EXISTS "pax_drafts" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL,
  "lead_id" integer NOT NULL,
  "channel" text NOT NULL DEFAULT 'email',
  "to_address" text NOT NULL,
  "subject" text NOT NULL DEFAULT '',
  "message" text NOT NULL,
  "content_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "sent_at" timestamp,
  "sent_message_id" text,
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "pax_drafts_org_idx" ON "pax_drafts" ("organization_id");
CREATE INDEX IF NOT EXISTS "pax_drafts_lookup_idx"
  ON "pax_drafts" ("organization_id", "lead_id", "channel", "status");
