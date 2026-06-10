-- 0151 — Tier 1A (elevation blueprint 2026-06-10) — the structural approval
-- kernel that makes witnessed-send unbypassable by construction.
--
-- Generalizes the T0-6 pax_drafts draft-bound approve-and-send (0150) to
-- EVERY approval-required tool: when executeTool sees a tool in
-- APPROVAL_REQUIRED_TOOLS without the trusted server-side approval option,
-- it freezes the call as a pending_actions row (tool + frozen args + sha256
-- content hash of the canonicalized args + expiry) and returns a pending
-- artifact instead of executing. The approve endpoint executes THAT row —
-- org-checked, hash-re-verified, idempotent via the guarded
-- pending→approved UPDATE — and records the send in the append-only
-- pax_sends audit. There is no UPDATE path to pax_sends anywhere.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS).
-- Mirrored into scripts/migrate.mjs.

CREATE TABLE IF NOT EXISTS "pending_actions" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL,
  "tool_name" text NOT NULL,
  "args" jsonb NOT NULL,
  "content_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "expires_at" timestamp NOT NULL,
  "created_by_user_id" text,
  "approved_by_user_id" text,
  "executed_at" timestamp,
  "result_summary" jsonb,
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "pending_actions_org_status_idx"
  ON "pending_actions" ("organization_id", "status");
CREATE INDEX IF NOT EXISTS "pending_actions_org_dedupe_idx"
  ON "pending_actions" ("organization_id", "tool_name", "content_hash", "status");

CREATE TABLE IF NOT EXISTS "pax_sends" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL,
  "pending_action_id" integer NOT NULL,
  "tool_name" text NOT NULL,
  "channel" text NOT NULL,
  "recipient_ref" text,
  "content_hash" text NOT NULL,
  "sent_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "pax_sends_org_sent_idx"
  ON "pax_sends" ("organization_id", "sent_at");
CREATE INDEX IF NOT EXISTS "pax_sends_org_action_idx"
  ON "pax_sends" ("organization_id", "pending_action_id");
