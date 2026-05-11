-- 2026-05-11 — MMS support for SMS campaigns.
-- Adds campaigns.media_urls (text[]) so the batch-SMS sender can attach
-- public image/video URLs and have Twilio deliver them as MMS. Idempotent
-- so it's safe to re-run via scripts/migrate.mjs.
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "media_urls" text[];
