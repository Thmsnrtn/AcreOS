-- ============================================================================
-- ⚠ STALE — DO NOT RUN AGAINST A FRESH DB.
-- ============================================================================
-- This file ALTERs field_scout_photos to add the photo-hash columns and
-- creates a (organization_id, image_hash) index. But the original 0003
-- CREATE TABLE for field_scout_photos NEVER added an organization_id column
-- — so against a freshly-bootstrapped DB this file's CREATE INDEX would
-- error: column "organization_id" does not exist.
--
-- In prod this works because scripts/migrate.mjs (lines 1309-1329 as of
-- 2026-05-06) recreates field_scout_photos with the canonical shape
-- (organization_id present), derived from shared/schema.ts. migrate.mjs is
-- the authoritative apply path; this .sql file is preserved for history.
--
-- See: shared/schema-migration-guide.md → "Drift catalog" for full context.
-- Do not edit in place — Drizzle journal alignment.
-- ============================================================================

-- ============================================================================
-- Field-scout photo pipeline — Phase 8 Mo 12 (Yara §1).
-- ============================================================================
--
-- Why this exists
-- ───────────────
-- Field-scout photo uploads previously stored only `url`. The Yara EXIF /
-- photo-hash pipeline introduces:
--
--   • image_hash       — SHA-256 of the post-EXIF-strip bytes. Used for
--                        reverse-image dedup (same content uploaded twice =>
--                        single stored object) and as a forensic trail.
--   • thumbnail_url    — 200×200 cover variant for grid views.
--   • card_url         — 800×600 inside-fit variant for detail cards.
--   • full_url         — 1920×1440 inside-fit variant for the lightbox.
--
-- The original `url` column is preserved as the canonical "best" URL the
-- client should display when a more specific variant URL isn't requested.
--
-- Backfill:
--   Existing rows have NULL hash + variant URLs. The ingest path now writes
--   them on every new upload; old rows can be backfilled offline by running
--   the resize/hash pipeline against their stored bytes.
--
-- Additive-only: every column is nullable; existing INSERTs continue to work.
-- ============================================================================

ALTER TABLE field_scout_photos
  ADD COLUMN IF NOT EXISTS image_hash    VARCHAR(64),
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS card_url      TEXT,
  ADD COLUMN IF NOT EXISTS full_url      TEXT,
  ADD COLUMN IF NOT EXISTS bytes         INTEGER,
  ADD COLUMN IF NOT EXISTS mime          VARCHAR(64);

COMMENT ON COLUMN field_scout_photos.image_hash IS
  'SHA-256 hex of the post-EXIF-strip image bytes. Per-org dedup key + forensic trail.';
COMMENT ON COLUMN field_scout_photos.thumbnail_url IS
  '200×200 cover variant. Surface APIs return this for grid views.';
COMMENT ON COLUMN field_scout_photos.card_url IS
  '800×600 inside-fit variant. Surface APIs return this for cards / detail headers.';
COMMENT ON COLUMN field_scout_photos.full_url IS
  '1920×1440 inside-fit variant. Surface APIs return this for the lightbox / download.';

-- Per-org dedup index — looking up "have we seen this exact image for this
-- org before?" must be O(log n). NOT unique because the same hash can
-- legitimately appear in different orgs (workflow templates, stock imagery
-- shared across tenants).
CREATE INDEX IF NOT EXISTS fsp_org_hash_idx
  ON field_scout_photos (organization_id, image_hash)
  WHERE image_hash IS NOT NULL;
