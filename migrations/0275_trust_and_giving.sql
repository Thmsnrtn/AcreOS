-- 0275 — W5a trust and giving: owner opt-out requests and the platform-wide
-- owner suppression list (hashed identifiers only), and the founder's giving
-- ledger ($1 per paying member per month, founder decision 2026-10-09):
-- county -> food bank mapping (founder entry), monthly pledges awaiting the
-- founder's approval, and receipts for money paid outside AcreOS.
-- table-count 730 -> 735. Mirrors scripts/migrate.mjs and shared/schema/trust.ts.
-- Idempotent.
CREATE TABLE IF NOT EXISTS "owner_optout_requests" (
  "id" serial PRIMARY KEY,
  "public_ref" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending_verification',
  "verification_method" text NOT NULL,
  "verification_secret_hash" text NOT NULL,
  "verification_expires_at" timestamp NOT NULL,
  "verification_attempts" integer NOT NULL DEFAULT 0,
  "pending_mail_address_enc" text,
  "mail_code_mailed_at" timestamp,
  "identifier_hashes" jsonb NOT NULL,
  "wants_deletion" boolean NOT NULL DEFAULT true,
  "residence_state" text,
  "statutory_days" integer NOT NULL,
  "received_at" timestamp NOT NULL DEFAULT now(),
  "due_at" timestamp NOT NULL,
  "verified_at" timestamp,
  "completed_at" timestamp,
  "deadline_alerted_at" timestamp,
  "org_matches" jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS "owner_optout_requests_public_ref_uk" ON "owner_optout_requests" ("public_ref");
CREATE INDEX IF NOT EXISTS "owner_optout_requests_status_due_idx" ON "owner_optout_requests" ("status", "due_at");
CREATE TABLE IF NOT EXISTS "owner_suppressions" (
  "id" serial PRIMARY KEY,
  "kind" text NOT NULL,
  "identifier_hash" text NOT NULL,
  "request_id" integer REFERENCES "owner_optout_requests"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "owner_suppressions_kind_hash_uk" ON "owner_suppressions" ("kind", "identifier_hash");
CREATE TABLE IF NOT EXISTS "giving_food_banks" (
  "id" serial PRIMARY KEY,
  "state" text NOT NULL,
  "county" text NOT NULL,
  "name" text NOT NULL,
  "website" text,
  "source" text NOT NULL DEFAULT 'founder_entry',
  "entered_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "giving_food_banks_state_county_uk" ON "giving_food_banks" ("state", "county");
CREATE TABLE IF NOT EXISTS "giving_months" (
  "id" serial PRIMARY KEY,
  "month" text NOT NULL,
  "computed_at" timestamp NOT NULL DEFAULT now(),
  "paying_members" integer NOT NULL,
  "members_without_county" integer NOT NULL,
  "lines" jsonb NOT NULL,
  "pledge_cents" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'awaiting_founder',
  "approved_cents" integer,
  "cap_cents_at_approval" integer,
  "decided_at" timestamp,
  "decided_by" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "giving_months_month_uk" ON "giving_months" ("month");
CREATE TABLE IF NOT EXISTS "giving_receipts" (
  "id" serial PRIMARY KEY,
  "month" text NOT NULL,
  "food_bank_id" integer NOT NULL REFERENCES "giving_food_banks"("id") ON DELETE RESTRICT,
  "amount_cents" integer NOT NULL,
  "reference" text NOT NULL,
  "receipt_url" text,
  "paid_on" date NOT NULL,
  "recorded_at" timestamp NOT NULL DEFAULT now(),
  "recorded_by" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "giving_receipts_food_bank_idx" ON "giving_receipts" ("food_bank_id", "paid_on");
