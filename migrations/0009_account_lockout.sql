-- Migration 0009: Account lockout columns
-- Task #8: Lock accounts after 5 consecutive failed logins for 30 minutes.
--
-- failed_login_attempts: rolling counter, reset to 0 on successful login
-- locked_until: if non-null and in the future, account is locked

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "failed_login_attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "locked_until" timestamp;

-- Index to quickly find locked accounts (optional but useful for admin tools)
CREATE INDEX IF NOT EXISTS "users_locked_until_idx" ON "users" ("locked_until")
  WHERE "locked_until" IS NOT NULL;
