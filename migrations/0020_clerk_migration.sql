-- Migrate to Clerk for authentication management
-- Clerk owns user identity; we store a clerkUserId reference

-- Add Clerk user ID column
ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_user_id VARCHAR(255) UNIQUE;

-- Remove old auth columns (Clerk manages these now)
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
ALTER TABLE users DROP COLUMN IF EXISTS oauth_provider;
ALTER TABLE users DROP COLUMN IF EXISTS oauth_provider_id;

-- Drop old auth tables (Clerk manages sessions and password resets)
DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS sessions;

-- Truncate users (starting fresh with Clerk — no existing users to migrate)
TRUNCATE TABLE users CASCADE;
