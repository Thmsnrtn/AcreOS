-- 0271 — Founder decision 2026-10-11: AcreOS stops using the Tennessee
-- "Property Boundaries Public Use" service (not for commercial use). Any
-- county_gis_endpoints row pointing at it — the seeded statewide row, or a
-- county row discovery inserted — is deactivated and marked not
-- redistributable. The URL is also refused on every fetch
-- (server/services/providers/blockedOutboundSources.ts). Mirrors the matching
-- block in scripts/migrate.mjs. Idempotent.
UPDATE "county_gis_endpoints" SET "is_active" = false, "redistributable" = 'no' WHERE "base_url" ILIKE '%tennessee_property_boundaries_public_use%';
