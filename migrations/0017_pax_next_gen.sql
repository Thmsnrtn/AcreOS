-- Migration: 0017_pax_next_gen
-- Adds context compaction, message ratings, and proactive nudges

-- Context compaction summary on conversations
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS context_summary TEXT;

-- User feedback ratings on messages (1 = thumbs up, -1 = thumbs down)
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS rating INTEGER;

-- Proactive Pax nudges table
CREATE TABLE IF NOT EXISTS pax_nudges (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  user_id TEXT,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  priority INTEGER NOT NULL DEFAULT 5,
  action_prompt TEXT,
  dismissed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pax_nudges_org_idx ON pax_nudges (organization_id);
CREATE INDEX IF NOT EXISTS pax_nudges_active_idx ON pax_nudges (organization_id, dismissed_at);
