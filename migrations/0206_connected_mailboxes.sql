-- ============================================================================
-- 0206 — connected_mailboxes: R1c native business inbox (foundation slice)
-- ----------------------------------------------------------------------------
-- Per-(org, operator) customer mailbox connections (Gmail / Outlook / IMAP).
--
-- MINIMAL-CUSTODY POSTURE (reshape doctrine — connect, don't custody): this
-- table stores ONLY the encrypted OAuth tokens + non-secret metadata. Message
-- bodies are NEVER persisted — the native inbox reads mail ON-DEMAND through
-- the customer's own connection. Tokens are AES-256-GCM envelopes in bytea
-- (never TEXT), same discipline as byok_credentials / platform_connections.
--
-- Additive + idempotent. Mirrors shared/schema/connected-mailboxes.ts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "connected_mailboxes" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL,
  "user_id" text NOT NULL,
  "provider" text NOT NULL,
  "email_address" text NOT NULL,
  "access_token_encrypted" bytea,
  "refresh_token_encrypted" bytea,
  "token_expires_at" timestamp,
  "scopes" text,
  "status" text NOT NULL DEFAULT 'connected',
  "last_error" text,
  "settings" jsonb DEFAULT '{}'::jsonb,
  "last_synced_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "revoked_at" timestamp
);

CREATE INDEX IF NOT EXISTS "connected_mailboxes_org_idx"
  ON "connected_mailboxes" ("organization_id");
CREATE INDEX IF NOT EXISTS "connected_mailboxes_user_idx"
  ON "connected_mailboxes" ("user_id");

-- At most one ACTIVE connection per (org, address).
CREATE UNIQUE INDEX IF NOT EXISTS "connected_mailboxes_active_uidx"
  ON "connected_mailboxes" ("organization_id", "email_address")
  WHERE "revoked_at" IS NULL;
