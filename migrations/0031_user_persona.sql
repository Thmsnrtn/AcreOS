-- JC#7: persona primitive — single source of truth for which investor
-- archetype a user is. Drives onboarding path, default sidebar surfaces,
-- and vocabulary substitutions per VERTICAL-EXPANSION-PLAN.md.
--
-- Default 'land_investor' so existing users keep current behavior. Future
-- values: 'note_investor' | 'tax_delinquent' | 'wholesaler' | 'subdivider'
-- | 'fix_flipper' | 'landlord'. Validated client-side against the
-- registry in client/src/lib/personaVocabulary.ts; no DB enum so we can
-- add personas without a migration each time.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "persona" text NOT NULL DEFAULT 'land_investor';
