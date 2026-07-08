-- 0165 — ensure organizations.last_active_at exists
--
-- The column was declared in the Drizzle schema and read by founder-intelligence
-- (churn/health signals) but was never in migrate.mjs (so prod may have lacked
-- it) and was never WRITTEN — every org read as "no activity" / high churn risk.
-- The activity heartbeat in getOrCreateOrg now stamps it (throttled ~15 min).
-- Additive + idempotent.

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "last_active_at" timestamp;
