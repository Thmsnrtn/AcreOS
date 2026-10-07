-- 0263 — Stage 2 founder controls the autopilot obeys mechanically, and the
-- S13 ask fold.
--
-- autopilot_settings (singleton):
--   paused_domains    domains whose moves the tick suppresses and whose queued
--                     dispatches were cancelled by a founder "pause".
--   ads_enabled       the ad-spend switch. false: run_ad_campaign refuses and
--                     pending ad actions are rejected.
--   pre_stop_snapshot what a panic stop switched off (switches + domain
--                     levels), so the resume can restore it as one confirm.
-- solene_founder_asks:
--   fold_count / last_folded_at — a repeat of an open ask with the same
--                     summary folds into it instead of opening a second row.
--
-- Purely additive; every column is nullable or defaulted.
ALTER TABLE "autopilot_settings" ADD COLUMN IF NOT EXISTS "paused_domains" jsonb;
ALTER TABLE "autopilot_settings" ADD COLUMN IF NOT EXISTS "ads_enabled" boolean;
ALTER TABLE "autopilot_settings" ADD COLUMN IF NOT EXISTS "pre_stop_snapshot" jsonb;
ALTER TABLE "solene_founder_asks" ADD COLUMN IF NOT EXISTS "fold_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "solene_founder_asks" ADD COLUMN IF NOT EXISTS "last_folded_at" timestamp with time zone;
