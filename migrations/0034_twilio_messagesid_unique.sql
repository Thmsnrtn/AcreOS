-- Webhook replay defense for Twilio inbound SMS (Hessam §2.2 + §2.4).
--
-- Twilio retries delivery of webhooks until it receives a 2xx, and a malicious
-- replay of a captured webhook payload would otherwise create duplicate rows
-- in `messages` (each Twilio MessageSid is stored in `external_id`). Without
-- a unique constraint, downstream side effects (notifications, autoresponders)
-- double-fire.
--
-- Outbound messages may be inserted before Twilio assigns a SID, so the
-- constraint is a partial unique index on non-NULL values. Existing rows
-- with NULL `external_id` are unaffected.
--
-- CONCURRENTLY so we don't block message inserts during deploy. IF NOT EXISTS
-- so re-running the migration is safe.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS messages_external_id_unique
  ON messages (external_id)
  WHERE external_id IS NOT NULL;
