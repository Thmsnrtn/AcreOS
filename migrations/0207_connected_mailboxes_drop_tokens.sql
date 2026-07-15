-- ============================================================================
-- 0207 — connected_mailboxes: drop token columns (Clerk rewire)
-- ----------------------------------------------------------------------------
-- The native inbox now rides Clerk's OAuth token vending (Clerk owns login +
-- OAuth). AcreOS stores NO mailbox tokens — Clerk holds them and we read a
-- fresh one on-demand. Remove the now-unused encrypted-token columns added in
-- 0206. Idempotent. Mirrors shared/schema/connected-mailboxes.ts.
-- ============================================================================

ALTER TABLE "connected_mailboxes" DROP COLUMN IF EXISTS "access_token_encrypted";
ALTER TABLE "connected_mailboxes" DROP COLUMN IF EXISTS "refresh_token_encrypted";
ALTER TABLE "connected_mailboxes" DROP COLUMN IF EXISTS "token_expires_at";
