-- Migration 0008: Add password reset token columns to users table
-- Task #12: Secure password reset flow with time-limited tokens

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "password_reset_token" varchar,
  ADD COLUMN IF NOT EXISTS "password_reset_expires_at" timestamp;

-- Index for fast token lookup
CREATE INDEX IF NOT EXISTS "users_reset_token_idx" ON "users" ("password_reset_token")
  WHERE "password_reset_token" IS NOT NULL;
