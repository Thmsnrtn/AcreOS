-- field_scout_* — reconcile the drifted 0003 shape with the canonical one.
--
-- WHAT WAS WRONG
-- --------------
-- `0003_robust_namora.sql` carries an explicit warning block above these two
-- tables: "⚠ STALE — DO NOT TRUST THIS SHAPE … the CANONICAL shape is created
-- by scripts/migrate.mjs … Do not edit in place — Drizzle journal records this
-- migration as applied."
--
-- The warning is accurate and the instruction is right, but together they left
-- a gap nothing could close: 0003 runs FIRST and creates the tables with the
-- stale shape, so migrate.mjs's canonical `CREATE TABLE IF NOT EXISTS` is a
-- no-op and the missing columns never arrive. A database built from this
-- repository therefore has `field_scout_visits` WITHOUT `organization_id`,
-- while `shared/schema.ts:18052` declares it `notNull()`.
--
-- Measured on PostgreSQL 16, 2026-08-18: after a full rebuild the live columns
-- were `checklist_results created_at duration id latitude lead_id longitude
-- notes property_id visitor_id` — no organization_id, status, started_at,
-- completed_at or updated_at. Two migrate.mjs statements skipped every run
-- because of it:
--
--   SKIPPED: CREATE INDEX fsv_org_idx ON field_scout_visits(organization_id)
--   SKIPPED: CREATE INDEX fsp_org_hash_idx ON field_scout_photos(organization_id, image_hash)
--
-- and `0072_field_scout_photo_hash.sql` failed on the same missing column.
--
-- WHY ADD COLUMN RATHER THAN A CORRECTED CREATE TABLE
-- ---------------------------------------------------
-- 0003 must not be edited (journal hash), and the tables already exist by the
-- time anything else runs. ALTER … ADD COLUMN IF NOT EXISTS is the only shape
-- that converges from BOTH starting points — a fresh rebuild (stale table
-- present) and an existing deployment (canonical table already correct, every
-- statement a no-op).
--
-- WHY organization_id IS NULLABLE HERE
-- ------------------------------------
-- `shared/schema.ts` declares it NOT NULL. Adding a NOT NULL column without a
-- default to a table that already holds rows FAILS, and this migration cannot
-- know whether a given deployment has field-scout rows. It adds the column
-- nullable so the rebuild converges and the indexes apply; tightening to NOT
-- NULL needs a backfill and belongs to whoever can see the row counts. The
-- residual drift is stated rather than papered over — see
-- `schemaMigrationDrift.test.ts`.

ALTER TABLE "field_scout_visits" ADD COLUMN IF NOT EXISTS "organization_id" INTEGER;
ALTER TABLE "field_scout_visits" ADD COLUMN IF NOT EXISTS "status" VARCHAR(50) DEFAULT 'completed';
ALTER TABLE "field_scout_visits" ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMP;
ALTER TABLE "field_scout_visits" ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP;
ALTER TABLE "field_scout_visits" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP NOT NULL DEFAULT NOW();

ALTER TABLE "field_scout_photos" ADD COLUMN IF NOT EXISTS "organization_id" INTEGER;
ALTER TABLE "field_scout_photos" ADD COLUMN IF NOT EXISTS "url" TEXT;
ALTER TABLE "field_scout_photos" ADD COLUMN IF NOT EXISTS "caption" TEXT;
ALTER TABLE "field_scout_photos" ADD COLUMN IF NOT EXISTS "image_hash" VARCHAR(64);
ALTER TABLE "field_scout_photos" ADD COLUMN IF NOT EXISTS "thumbnail_url" TEXT;
ALTER TABLE "field_scout_photos" ADD COLUMN IF NOT EXISTS "card_url" TEXT;
ALTER TABLE "field_scout_photos" ADD COLUMN IF NOT EXISTS "full_url" TEXT;
ALTER TABLE "field_scout_photos" ADD COLUMN IF NOT EXISTS "bytes" INTEGER;
ALTER TABLE "field_scout_photos" ADD COLUMN IF NOT EXISTS "mime" VARCHAR(64);
