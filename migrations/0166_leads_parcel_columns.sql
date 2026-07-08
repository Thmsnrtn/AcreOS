-- 0166 — leads parcel / enrichment columns
--
-- Several features were stubbed because leads had no county / property_address /
-- tax_delinquent / estimated_value / acreage columns: instant-deal-hunt could
-- only filter by state, tax-researcher counts couldn't scope to a county or to
-- tax-delinquent leads, and parcel enrichment had nowhere to land. Add them.
-- Populated from parcel-of-record data (county GIS or Regrid via the provider
-- registry) and tax-delinquent imports. estimated_value is a derived ESTIMATE.
-- Additive + idempotent.

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "county"           text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "property_address" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "tax_delinquent"   boolean;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "estimated_value"  numeric;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "acreage"          numeric;
