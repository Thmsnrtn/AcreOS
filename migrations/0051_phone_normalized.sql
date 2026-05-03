-- Phase 3 Week 14 (Anaïs §2): phone normalization for fuzzy search
--
-- Problem: when a user types "555-123-4567" the FTS tokenizer splits on
-- the dashes and the trigram index matches poorly. Land Investors also
-- save phones in mixed formats — "(555) 123-4567", "+15551234567",
-- "5551234567" — so we want "555-123-4567" to match all of them.
--
-- Solution: a generated column on `leads` containing the digits-only
-- form (E.164 stripped of "+"). Anaïs's search normalizes the query
-- the same way and matches against this column with a trigram GIN
-- index, so search "555-123-4567" → digits "5551234567" → indexed.
--
-- We use a STORED generated column so reads are free; writes pay the
-- regex cost once at insert/update time.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS phone_normalized text
  GENERATED ALWAYS AS (regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) STORED;

CREATE INDEX IF NOT EXISTS leads_phone_normalized_trgm_idx
  ON leads USING GIN (phone_normalized gin_trgm_ops);

-- Same treatment on the borrower contact-info table so payment ops can
-- find a borrower by phone regardless of formatting.
ALTER TABLE borrower_payment_profiles
  ADD COLUMN IF NOT EXISTS phone_normalized text
  GENERATED ALWAYS AS (regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) STORED;

CREATE INDEX IF NOT EXISTS borrower_payment_profiles_phone_normalized_trgm_idx
  ON borrower_payment_profiles USING GIN (phone_normalized gin_trgm_ops);
