-- ============================================================================
-- 0220 — Entity / company tenants (commercial beta, 2026-08)
-- ----------------------------------------------------------------------------
-- The `tenants` table was person-shaped: `first_name` and `last_name` were both
-- NOT NULL. That is correct for a residential landlord, but a COMMERCIAL
-- operator's tenant is very often a company (an LLC, a franchise, a
-- corporation), and there was nowhere to put a company name. Forcing a person
-- name onto a company tenancy would mean storing a fabricated placeholder in a
-- NOT NULL column — exactly the kind of invented data the honesty bar forbids.
--
-- This migration makes entity tenants FIRST-CLASS, additively and
-- backward-compatibly:
--
--   * `is_entity`  boolean NOT NULL DEFAULT false — the discriminator. Every
--     existing row backfills to false (a person tenant) with no rewrite: PG11+
--     does not rewrite the table for ADD COLUMN with a non-volatile DEFAULT.
--   * `company_name` text (nullable) — the company's name, set when
--     is_entity = true. Null for person tenants.
--   * `first_name` / `last_name` — the NOT NULL constraint is DROPPED so an
--     entity tenant may leave them null. This changes NOTHING for existing
--     rows (they already carry both names) and rejects nothing that used to be
--     accepted (a person tenant still supplies both — the requirement now lives
--     in the route's zod refinement, server/routes-rentals.ts, which requires
--     first+last for a person and company_name for an entity).
--
-- Additive + widening only: no column is dropped, no data is touched, and every
-- previously-valid tenant row and insert stays valid. Mirrors
-- shared/schema/rental.ts. Registered in scripts/migrate.mjs (the path that
-- actually runs on deploy as the Fly release_command).
-- ============================================================================

-- New columns — idempotent, safe to re-run every deploy.
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "is_entity" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "company_name" text;

-- Relax the person-name requirement so an entity tenant can carry a company
-- name instead. IF EXISTS makes the DROP a no-op once already applied.
ALTER TABLE "tenants" ALTER COLUMN "first_name" DROP NOT NULL;
ALTER TABLE "tenants" ALTER COLUMN "last_name" DROP NOT NULL;
