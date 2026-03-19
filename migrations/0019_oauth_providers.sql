-- Migration: 0019_oauth_providers
-- Adds OAuth provider support to users table (Google, GitHub, etc.)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(32),
  ADD COLUMN IF NOT EXISTS oauth_provider_id VARCHAR(255);

-- Allow passwordHash to be null for OAuth-only accounts (already nullable, no change needed)

CREATE UNIQUE INDEX IF NOT EXISTS IDX_users_oauth
  ON users (oauth_provider, oauth_provider_id)
  WHERE oauth_provider IS NOT NULL AND oauth_provider_id IS NOT NULL;
