-- 0039_email_events_suppressions.sql
-- Hessam §2.3 + Pelle G/H/I + Eleonora §1: SendGrid event-webhook ingestion
-- and per-recipient suppression list. Also: invite-token hardening fields.
--
-- Three concerns in one migration because they share a single PR scope:
--   1. email_events       — append-only stream of every SendGrid event
--                           (delivered/open/click/bounce/dropped/spamreport/
--                           unsubscribe/deferred). Persisted so we can answer
--                           "did this address ever bounce?" without round-
--                           tripping SendGrid.
--   2. email_suppressions — single-row-per-address blocklist. Populated on
--                           hard bounce, spam report, or unsubscribe. Every
--                           outbound send path checks this table first.
--   3. invite-token hardening — adds invite_token_hash + invite_token_last4
--                           columns to organization_invitations. Plaintext
--                           token column kept temporarily for tolerant
--                           legacy-row matching; rotated out via lazy
--                           migration on next access.

-- ── email_events ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "email_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "email" text NOT NULL,
    "event" text NOT NULL,
    "sg_event_id" text UNIQUE,
    "sg_message_id" text,
    "timestamp" timestamptz,
    "reason" text,
    "status" text,
    "response" text,
    "metadata" jsonb,
    "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_email_events_email_created"
    ON "email_events" ("email", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_email_events_sg_event_id"
    ON "email_events" ("sg_event_id");

-- ── email_suppressions ──────────────────────────────────────────────────────
-- Primary key on email guarantees idempotency: repeat events for the same
-- address simply return ON CONFLICT DO NOTHING in the webhook handler.
CREATE TABLE IF NOT EXISTS "email_suppressions" (
    "email" text PRIMARY KEY,
    "reason" text NOT NULL,
    "suppressed_at" timestamptz DEFAULT now() NOT NULL,
    "source" text
);

CREATE INDEX IF NOT EXISTS "idx_email_suppressions_source"
    ON "email_suppressions" ("source");

-- ── organization_invitations: token hardening ───────────────────────────────
-- We keep the existing `token` column (legacy plaintext rows) and add
-- `invite_token_hash` + `invite_token_last4`. The accept path tries the
-- hash first; on miss it falls back to plaintext for legacy rows and
-- rehashes them on the spot (lazy migration). New rows only ever store
-- the hash — plaintext is sent in the email/URL once, never persisted.
ALTER TABLE "organization_invitations"
    ADD COLUMN IF NOT EXISTS "invite_token_hash" text;

ALTER TABLE "organization_invitations"
    ADD COLUMN IF NOT EXISTS "invite_token_last4" text;

-- Drop NOT NULL on legacy `token` so new rows can leave it NULL (plaintext
-- never persisted). Existing rows keep their plaintext for tolerant matching.
ALTER TABLE "organization_invitations"
    ALTER COLUMN "token" DROP NOT NULL;

-- Index lookups by hash. Not unique (yet) because legacy rows still have
-- NULL here; once the lazy migration completes, a follow-up migration can
-- enforce UNIQUE + drop the plaintext column.
CREATE INDEX IF NOT EXISTS "idx_org_invitations_token_hash"
    ON "organization_invitations" ("invite_token_hash");
