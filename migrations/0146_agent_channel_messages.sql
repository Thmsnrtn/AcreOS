-- ============================================================================
-- 0146 — Iris (CTO) — agent_channel_messages (Sovereign Company Protocol bus)
-- ----------------------------------------------------------------------------
-- Reconciles the long-standing `agent_messages` TWO-DESIGN COLLISION.
--
-- Two unrelated features were declared against the SAME physical table name:
--
--   A. Typed-channel BROADCAST BUS — from_agent / to_channel / data /
--      read_by_agents / requires_response / respond_by. Declared 2026-03-18
--      (Sovereign Company Protocol) in shared/schema.ts. NO migration ever
--      created this table, so every broadcast threw "column to_channel does
--      not exist" at runtime. Consumers: server/services/agentComms.ts,
--      server/services/companyMind.ts, server/routes-sovereign-integration.ts.
--
--   B. Correlation-based inter-agent DM — from_agent_role / to_agent_role /
--      correlation_id / in_reply_to_message_id / sent_at / read_at. Created
--      2026-06-03 (phase B L2.5) via scripts/migrate.mjs. THIS is the
--      agent_messages table that physically exists in prod. Consumer:
--      server/services/solene/agentMessages.ts.
--
-- They are distinct features that collided on one name. Design B keeps the
-- live `agent_messages` name; Design A's broadcast bus moves to its own
-- `agent_channel_messages` table, created here. NO prod data is moved or
-- dropped — Design A's table never existed.
--
-- Not org-scoped: this is an internal AI-team bus with no org_id column.
-- Idempotent (IF NOT EXISTS). Mirrors the agent_channel_messages declaration
-- in shared/schema.ts and the matching block in scripts/migrate.mjs.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "agent_channel_messages" (
  "id" serial PRIMARY KEY,
  "from_agent" text NOT NULL,
  "to_channel" text NOT NULL,
  "priority" text NOT NULL DEFAULT 'medium',
  "subject" text NOT NULL,
  "body" text NOT NULL,
  "data" jsonb,
  "requires_response" boolean DEFAULT false,
  "respond_by" timestamp,
  "read_by_agents" jsonb DEFAULT '[]'::jsonb,
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "agent_channel_messages_channel_idx" ON "agent_channel_messages" ("to_channel");
CREATE INDEX IF NOT EXISTS "agent_channel_messages_from_idx" ON "agent_channel_messages" ("from_agent");
CREATE INDEX IF NOT EXISTS "agent_channel_messages_priority_idx" ON "agent_channel_messages" ("priority");
CREATE INDEX IF NOT EXISTS "agent_channel_messages_created_idx" ON "agent_channel_messages" ("created_at");
