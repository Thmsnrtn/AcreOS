-- Phase D.1 (port directive): feature flag state machine + audience.
--
-- Existing platform_feature_flags table was binary (enabled boolean + label
-- + controlled_routes array). Design-system §8 wants 5 states with audience
-- targeting:
--   off            — invisible everywhere; route 404s, sidebar hides
--   founder-only   — only founder sees / hits
--   beta           — opted-in users (audience.beta_user_ids[])
--   tier:<X>       — subscription-gated (X ∈ free/starter/pro/scale)
--   on             — live for everyone
--
-- `enabled` boolean preserved for back-compat — derived from state at read
-- time by setState helpers. Existing consumers keep working until migrated.

ALTER TABLE "platform_feature_flags"
ADD COLUMN IF NOT EXISTS "state" text;

ALTER TABLE "platform_feature_flags"
ADD COLUMN IF NOT EXISTS "audience" jsonb DEFAULT '{}'::jsonb;

ALTER TABLE "platform_feature_flags"
ADD COLUMN IF NOT EXISTS "changed_by" text;

ALTER TABLE "platform_feature_flags"
ADD COLUMN IF NOT EXISTS "changed_at" timestamp;

-- Backfill state from existing enabled boolean.
UPDATE "platform_feature_flags"
SET "state" = CASE WHEN "enabled" THEN 'on' ELSE 'off' END
WHERE "state" IS NULL;

-- Seed the design-system §8.4 initial flag set if missing.
-- Each row insert is idempotent via ON CONFLICT.
INSERT INTO "platform_feature_flags" ("key", "label", "description", "enabled", "state", "audience", "controlled_routes")
VALUES
  ('module.land-academy', 'Land Academy module', 'Educational content and certifications', false, 'off', '{}'::jsonb, '["/academy"]'::jsonb),
  ('module.marketplace', 'Marketplace module', 'Buyer / seller marketplace', false, 'off', '{}'::jsonb, '["/marketplace"]'::jsonb),
  ('surface.command-palette-v2', 'Command palette v2', 'Refined ⌘K palette with prototype shape', false, 'founder-only', '{}'::jsonb, '[]'::jsonb),
  ('feature.atlas-async-jobs', 'Atlas async jobs', 'Long-running Atlas analyses with notification', false, 'founder-only', '{}'::jsonb, '[]'::jsonb),
  ('feature.autonomy-matrix', 'Autonomy matrix', 'Per-agent × per-action × thresholds permissions', false, 'founder-only', '{}'::jsonb, '["/settings"]'::jsonb)
ON CONFLICT ("key") DO NOTHING;
