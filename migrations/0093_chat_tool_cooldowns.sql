-- Lens 13 / Kareem §2: persist Tier-3 chat-tool cooldown across restarts.
--
-- server/services/founder-chat/executor.ts used to keep the
-- "last-confirmed-at" timestamp in a process-local Map. A Fly machine
-- restart, deploy, or scale-event wiped the map and the 5-minute cooldown
-- silently reset to zero — Tom could re-fire a Tier-3 destructive op
-- without the second confirmation challenge.
--
-- This table persists the cooldown so it survives restarts and is shared
-- across worker/web process groups.

CREATE TABLE IF NOT EXISTS chat_tool_cooldowns (
  user_id           text NOT NULL,
  tool_name         text NOT NULL,
  last_confirmed_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tool_name)
);

CREATE INDEX IF NOT EXISTS chat_tool_cooldowns_last_confirmed_idx
  ON chat_tool_cooldowns (last_confirmed_at);

COMMENT ON TABLE chat_tool_cooldowns IS
  'Lens 13: persistent Tier-3 chat-tool re-confirmation cooldowns. Replaces an in-memory Map that did not survive Fly restarts. Old rows can age out via cron.';
