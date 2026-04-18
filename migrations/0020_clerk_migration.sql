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

-- Safety: Only truncate if no Clerk users exist yet (prevents data loss on re-run)
-- Original migration truncated to start fresh with Clerk auth
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE clerk_user_id IS NOT NULL LIMIT 1) THEN
    TRUNCATE TABLE users CASCADE;
  END IF;
END $$;
