-- 0273 — W3 acquisition engine. Mirrors shared/schema/creators.ts and the
-- matching block in scripts/migrate.mjs. Idempotent.
--
-- Creator revenue share: AcreOS's OWN money to creators who bring paying
-- customers. Attribution is captured at signup in users.acquisition_utm.ref;
-- a conversion is recorded per PAID invoice; the commission rate ships unset
-- (founder decision) and payouts are founder-approved, paid outside AcreOS.
CREATE TABLE IF NOT EXISTS "creators" (
  "id"           serial PRIMARY KEY,
  "code"         text NOT NULL,
  "display_name" text NOT NULL,
  "contact"      text,
  "status"       text NOT NULL DEFAULT 'active',
  "created_by"   text,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "creators_code_uq" ON "creators" ("code");

CREATE TABLE IF NOT EXISTS "creator_conversions" (
  "id"                serial PRIMARY KEY,
  "creator_id"        integer NOT NULL REFERENCES "creators"("id"),
  "stripe_invoice_id" text NOT NULL,
  "amount_paid_cents" integer NOT NULL,
  "currency"          text NOT NULL DEFAULT 'usd',
  "paid_at"           timestamp with time zone NOT NULL,
  "commission_bps"    integer,
  "commission_cents"  integer,
  "status"            text NOT NULL,
  "payout_batch"      text,
  "approved_by"       text,
  "approved_at"       timestamp with time zone,
  "paid_reference"    text,
  "payout_paid_at"    timestamp with time zone,
  "void_reason"       text,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "creator_conversions_invoice_uq" ON "creator_conversions" ("stripe_invoice_id");
CREATE INDEX IF NOT EXISTS "creator_conversions_creator_status_idx" ON "creator_conversions" ("creator_id", "status");

-- Founding-member yearly offer: OFF until the founder turns it on. The page
-- also refuses while its price is unset (shared/billing/foundingMemberOffer.ts).
INSERT INTO "platform_feature_flags" ("key", "label", "description", "enabled", "state", "controlled_routes")
VALUES ('offer.founding_member_yearly', 'Founding-member yearly offer',
        'Shows the founding-member yearly offer page. The page still refuses until the founder sets the plan and price.',
        false, 'off', '[]'::jsonb)
ON CONFLICT ("key") DO NOTHING;
