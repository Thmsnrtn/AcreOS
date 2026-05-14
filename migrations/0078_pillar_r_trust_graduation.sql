-- Pillar R — agent trust graduation per (agent, category) +
-- post-merge observation windows for auto-retract.
--
-- See docs/exhaustive-completion/pillar-r-default-to-ship.md.

CREATE TABLE IF NOT EXISTS agent_action_graduations (
  id SERIAL PRIMARY KEY,
  agent_codename TEXT NOT NULL,
  action_category TEXT NOT NULL,
  graduation_tier TEXT NOT NULL DEFAULT 'manual',
  consecutive_accepted INTEGER NOT NULL DEFAULT 0,
  consecutive_retracted INTEGER NOT NULL DEFAULT 0,
  total_accepted INTEGER NOT NULL DEFAULT 0,
  total_retracted INTEGER NOT NULL DEFAULT 0,
  tier_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  founder_override TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_graduation_unique
  ON agent_action_graduations (agent_codename, action_category);
CREATE INDEX IF NOT EXISTS agent_graduation_tier_idx
  ON agent_action_graduations (graduation_tier);

CREATE TABLE IF NOT EXISTS agent_proposal_observations (
  id SERIAL PRIMARY KEY,
  agent_codename TEXT NOT NULL,
  action_category TEXT NOT NULL,
  shipped_ref TEXT NOT NULL,
  shipped_ref_type TEXT NOT NULL,
  shipped_at TIMESTAMPTZ NOT NULL,
  observation_ends_at TIMESTAMPTZ NOT NULL,
  telemetry_baseline JSONB,
  telemetry_current JSONB,
  status TEXT NOT NULL DEFAULT 'observing',
  retract_reason TEXT,
  retracted_at TIMESTAMPTZ,
  retract_commit_sha TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_observations_agent_idx
  ON agent_proposal_observations (agent_codename);
CREATE INDEX IF NOT EXISTS agent_observations_status_idx
  ON agent_proposal_observations (status);
CREATE INDEX IF NOT EXISTS agent_observations_ends_idx
  ON agent_proposal_observations (observation_ends_at);
