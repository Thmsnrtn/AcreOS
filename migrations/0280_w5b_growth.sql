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

-- Demo-data marker backfill (W5b audit). Settings → "Add Demo Data" used to
-- create UNMARKED rows, so its two closed acquisitions counted as real
-- closings in the customer outcome metric and the founder Letter aggregate.
-- The seeder now marks rows at creation (server/services/onboarding/
-- demoDataSeeder.ts); this relabels rows it created before, matched on the
-- full fixture fingerprint (apn AND county AND the fixture's exact
-- description / email AND notes), so no customer-entered row can match.
-- Relabel only — nothing is deleted. Idempotent: a relabelled row no longer
-- matches.
UPDATE "properties" SET "apn" = 'SAMPLE-' || "apn", "description" = 'Sample — ' || "description"
 WHERE ("apn", "county", "description") IN (
   ('123-45-678', 'Cochise', 'Beautiful 5+ acre parcel with mountain views near Willcox'),
   ('234-56-789', 'Mohave', '2.5 acre lot in Golden Valley with road access'),
   ('345-67-890', 'Luna', '10 acres of open desert land near Deming'),
   ('456-78-901', 'Navajo', '1.25 acre residential lot in Show Low area'),
   ('567-89-012', 'Pinal', '40 acre ranch parcel with well and power nearby'));
UPDATE "leads" SET "source" = 'sample_data'
 WHERE ("email", "notes") IN (
   ('john.martinez@email.com', 'Inherited property, motivated to sell'),
   ('sarah.t@email.com', 'Moving out of state, needs quick close'),
   ('rchen@email.com', 'Looking for 5-10 acre recreational parcels'),
   ('mgarcia@email.com', 'Initial mailer sent 2 weeks ago'),
   ('dwilson@email.com', 'Pre-approved for $50K, wants AZ or NM'),
   ('jbrown@email.com', 'Responded to online ad'))
   AND coalesce("source", '') <> 'sample_data';
