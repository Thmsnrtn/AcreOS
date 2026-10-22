-- 0286 — the parcel facts a county / tax-delinquent list carries, kept on the
-- lead. The county ASSESSED value is a different fact from estimated_value (a
-- market estimate) and gets its own column; the amount owed and the years
-- delinquent are what the list states. Every import path fills them through
-- shared/leads/parcelFacts.ts; NULL means the list did not say (never 0).
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "assessed_value" numeric(14,2);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "tax_delinquent_amount" numeric(12,2);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "tax_delinquent_years" integer;
