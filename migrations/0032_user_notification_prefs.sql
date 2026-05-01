-- JC#11: persist the richer per-user notification matrix (overrides + global
-- mute + weekly digest settings) in its own jsonb column. The legacy
-- notification_preferences table stays intact for older callers; new UI
-- consumes this column via /api/notifications/preferences.
--
-- Stored shape mirrors UserNotificationPreferences in
-- server/services/notificationPreferences.ts. Null = user has never
-- adjusted; service returns sensible defaults at read time.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "notification_prefs" jsonb;
