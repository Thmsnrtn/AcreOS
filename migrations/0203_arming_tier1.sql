-- ============================================================================
-- 0203 — Arming Checklist Tier 1 (founder decision 2026-07-13)
-- ----------------------------------------------------------------------------
-- The kernel-restructure verification memo
-- (docs/internal/solene-kernel-restructure-verification.md) inventoried 20
-- built-but-dark switches; the founder approved arming Tier 1 as one batch:
-- dispatch, publish, cognition, self-patch (motor still needs GITHUB_TOKEN,
-- founder-supplied), and the three keyless federal ETL jobs. Judges + strict
-- compliance are env-armed in fly.toml in the same commit.
--
-- ONE-SHOT SEMANTICS (critical): scripts/migrate.mjs re-runs every deploy, so
-- this must never override a later founder OFF. Two guards enforce that:
--   1. The whole block is skipped once the platform_settings marker exists.
--   2. Master switches are set ONLY from the never-decided NULL state —
--      panicStop() writes explicit false, which these updates never touch.
-- SOLENE_PANIC_STOP (env, machine-unwritable) still forces everything OFF
-- unconditionally above all of this; every domain still starts at `observe`.
-- Mirrors scripts/migrate.mjs. Idempotent + founder-override-safe.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "platform_settings"
    WHERE "key" = 'arming.tier1.2026_07_13' AND "scope" = 'global'
  ) THEN
    INSERT INTO "autopilot_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

    UPDATE "autopilot_settings" SET "dispatch_enabled"   = true, "updated_by" = 'arming-tier1-2026-07-13'
      WHERE "id" = 1 AND "dispatch_enabled" IS NULL;
    UPDATE "autopilot_settings" SET "publish_enabled"    = true, "updated_by" = 'arming-tier1-2026-07-13'
      WHERE "id" = 1 AND "publish_enabled" IS NULL;
    UPDATE "autopilot_settings" SET "cognition_enabled"  = true, "updated_by" = 'arming-tier1-2026-07-13'
      WHERE "id" = 1 AND "cognition_enabled" IS NULL;
    UPDATE "autopilot_settings" SET "self_patch_enabled" = true, "updated_by" = 'arming-tier1-2026-07-13'
      WHERE "id" = 1 AND "self_patch_enabled" IS NULL;

    UPDATE "etl_jobs" SET "is_active" = true, "updated_at" = now()
      WHERE "job_name" IN ('irs_soi_migration_v1', 'census_bps_permits_v1', 'bls_qcew_employment_v1')
        AND "is_active" = false;

    INSERT INTO "platform_settings" ("key", "scope", "value", "default_value")
      VALUES ('arming.tier1.2026_07_13', 'global', '"executed"'::jsonb, '"executed"'::jsonb);
  END IF;
END $$;
