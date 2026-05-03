-- Tax / 1099 reporting identity columns.
--
-- Background: Form 1099-INT must carry a real payer EIN and a real recipient
-- TIN. Until now bookkeeping.ts emitted hardcoded placeholders ("00-0000000",
-- "000-00-0000") which made every issued 1099-INT invalid. This migration
-- adds the storage so onboarding can capture these values, and the
-- bookkeeping service throws a TaxIdentityError when they are missing
-- instead of silently shipping invalid IRS forms.
--
-- All columns are nullable: legacy organizations and leads pre-date the
-- field. The application layer (server/services/bookkeeping.ts) is the
-- enforcement boundary — it refuses to issue a 1099-INT until the relevant
-- row carries a real EIN/TIN.
--
-- The TIN-bearing columns (organizations.ein, leads.tax_id) hold AES-256-GCM
-- ciphertext produced by server/services/configManager.ts encryptValue().

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "ein" text,
  ADD COLUMN IF NOT EXISTS "tax_id_type" text,
  ADD COLUMN IF NOT EXISTS "tax_address" jsonb,
  ADD COLUMN IF NOT EXISTS "legal_entity_name" text;

ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "tax_id" text,
  ADD COLUMN IF NOT EXISTS "tax_id_type" text;
