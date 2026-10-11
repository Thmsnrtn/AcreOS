-- 0280 — W5b growth. Mirrors shared/schema/growth.ts, the three new columns in
-- shared/schema.ts (leads, campaigns) and shared/models/auth.ts (users), and
-- the matching block in scripts/migrate.mjs. Idempotent.
--
-- leads.outreach_language*: the language outreach to an owner is written in,
-- set only by the customer or recorded from what the owner said — never
-- inferred (shared/outreach/outreachLanguage.ts).
-- campaigns.language: the language the customer wrote the campaign in.
-- users.pax_language: the user's own setting for the language Pax answers in.
-- sms_a2p_registrations: the org's OWN A2P 10DLC brand/campaign status with
-- its OWN SMS provider, and where that status came from.
-- lead_import_batches: what one import created, so it can be undone.
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "outreach_language" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "outreach_language_source" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "outreach_language_set_at" timestamp;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "language" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pax_language" text;

CREATE TABLE IF NOT EXISTS "sms_a2p_registrations" (
  "id"                     serial PRIMARY KEY,
  "organization_id"        integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "provider"               text NOT NULL,
  "number_kind"            text NOT NULL DEFAULT '10dlc',
  "phone_number"           text,
  "brand_status"           text NOT NULL DEFAULT 'not_started',
  "campaign_status"        text NOT NULL DEFAULT 'not_started',
  "status_source"          text NOT NULL,
  "brand_sid"              text,
  "campaign_sid"           text,
  "messaging_service_sid"  text,
  "provider_detail"        jsonb,
  "checked_at"             timestamp NOT NULL,
  "reported_by"            text,
  "created_at"             timestamp NOT NULL DEFAULT now(),
  "updated_at"             timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "sms_a2p_registrations_org_uq" ON "sms_a2p_registrations" ("organization_id");

CREATE TABLE IF NOT EXISTS "lead_import_batches" (
  "id"                serial PRIMARY KEY,
  "organization_id"   integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "source_format"     text NOT NULL,
  "file_name"         text,
  "row_count"         integer NOT NULL DEFAULT 0,
  "imported_count"    integer NOT NULL DEFAULT 0,
  "skipped_count"     integer NOT NULL DEFAULT 0,
  "suppressed_count"  integer NOT NULL DEFAULT 0,
  "lead_ids"          integer[] NOT NULL DEFAULT '{}'::integer[],
  "created_by"        text,
  "created_at"        timestamp NOT NULL DEFAULT now(),
  "undone_at"         timestamp,
  "undone_by"         text,
  "undo_result"       jsonb
);
CREATE INDEX IF NOT EXISTS "lead_import_batches_org_created_idx" ON "lead_import_batches" ("organization_id", "created_at");
