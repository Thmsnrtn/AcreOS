-- Migration 0010: Referral program
-- Adds referral_code to users, referral_credits to organizations,
-- and a referrals table to track invites and conversions.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_code" varchar(16) UNIQUE;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "referral_credits" integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "referrals" (
  "id"             serial PRIMARY KEY,
  "referrer_id"    varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "referee_id"     varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "code"           varchar(16) NOT NULL UNIQUE,
  "status"         text NOT NULL DEFAULT 'pending', -- pending, signed_up, converted
  "credit_amount"  integer NOT NULL DEFAULT 0,      -- cents awarded to referrer
  "credited_at"    timestamp,
  "created_at"     timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "IDX_referrals_referrer" ON "referrals" ("referrer_id");
CREATE INDEX IF NOT EXISTS "IDX_referrals_code"     ON "referrals" ("code");
CREATE INDEX IF NOT EXISTS "IDX_referrals_referee"  ON "referrals" ("referee_id");
