-- SCP v2: Structured Memory System & Evolution Tracking
-- Adds SPO triples for semantic memory, procedural memory,
-- golden suite, shared memory, and evolution metrics.

-- Semantic Memory v2 — SPO (Subject-Predicate-Object) triples
CREATE TABLE IF NOT EXISTS scp_semantic_facts (
  id SERIAL PRIMARY KEY,
  fact_id TEXT NOT NULL UNIQUE,
  agent_codename TEXT NOT NULL,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  natural_language TEXT NOT NULL,
  source_episode_ids JSONB NOT NULL DEFAULT '[]',
  confidence INTEGER NOT NULL DEFAULT 50,
  valid_from TIMESTAMP NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMP,
  version INTEGER NOT NULL DEFAULT 1,
  previous_version_id TEXT,
  category TEXT NOT NULL DEFAULT 'domain_knowledge',
  tags JSONB NOT NULL DEFAULT '[]',
  org_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ssf_agent_idx ON scp_semantic_facts(agent_codename);
CREATE INDEX IF NOT EXISTS ssf_subject_idx ON scp_semantic_facts(subject);
CREATE INDEX IF NOT EXISTS ssf_category_idx ON scp_semantic_facts(category);
CREATE INDEX IF NOT EXISTS ssf_confidence_idx ON scp_semantic_facts(confidence);
CREATE INDEX IF NOT EXISTS ssf_valid_idx ON scp_semantic_facts(valid_until);

-- Procedural Memory — learned procedures with steps
CREATE TABLE IF NOT EXISTS scp_procedures (
  id SERIAL PRIMARY KEY,
  procedure_id TEXT NOT NULL UNIQUE,
  agent_codename TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  trigger TEXT NOT NULL,
  steps JSONB NOT NULL DEFAULT '[]',
  preconditions JSONB NOT NULL DEFAULT '[]',
  postconditions JSONB NOT NULL DEFAULT '[]',
  parameters JSONB NOT NULL DEFAULT '{}',
  source_episode_ids JSONB NOT NULL DEFAULT '[]',
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMP,
  confidence INTEGER NOT NULL DEFAULT 50,
  version INTEGER NOT NULL DEFAULT 1,
  org_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sp_agent_idx ON scp_procedures(agent_codename);
CREATE INDEX IF NOT EXISTS sp_name_idx ON scp_procedures(name);
CREATE INDEX IF NOT EXISTS sp_confidence_idx ON scp_procedures(confidence);

-- Golden Suite — permanent regression test cases
CREATE TABLE IF NOT EXISTS scp_golden_cases (
  id SERIAL PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE,
  agent_codename TEXT NOT NULL,
  description TEXT NOT NULL,
  lesson TEXT NOT NULL,
  session_id TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}',
  org_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sgc_agent_idx ON scp_golden_cases(agent_codename);
CREATE INDEX IF NOT EXISTS sgc_session_idx ON scp_golden_cases(session_id);

-- Cross-Agent Shared Memory
CREATE TABLE IF NOT EXISTS scp_shared_memory (
  id SERIAL PRIMARY KEY,
  memory_id TEXT NOT NULL UNIQUE,
  written_by_agent TEXT NOT NULL,
  category TEXT NOT NULL,
  subject TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 70,
  validated_at TIMESTAMP,
  validation_gates_passed JSONB NOT NULL DEFAULT '[]',
  read_by_agents JSONB NOT NULL DEFAULT '[]',
  org_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ssm_agent_idx ON scp_shared_memory(written_by_agent);
CREATE INDEX IF NOT EXISTS ssm_category_idx ON scp_shared_memory(category);

-- Evolution Metrics — per-agent v2 tracking
CREATE TABLE IF NOT EXISTS scp_evolution_metrics (
  id SERIAL PRIMARY KEY,
  agent_codename TEXT NOT NULL,
  total_sessions INTEGER NOT NULL DEFAULT 0,
  success_rate INTEGER NOT NULL DEFAULT 0,
  correction_rate INTEGER NOT NULL DEFAULT 0,
  override_rate INTEGER NOT NULL DEFAULT 0,
  escalation_accuracy INTEGER NOT NULL DEFAULT 0,
  golden_suite_size INTEGER NOT NULL DEFAULT 0,
  current_version INTEGER NOT NULL DEFAULT 1,
  evolution_cadence TEXT NOT NULL DEFAULT 'aggressive',
  last_evolved_at TIMESTAMP,
  last_rollback_at TIMESTAMP,
  rollback_count INTEGER NOT NULL DEFAULT 0,
  org_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sem_agent_idx ON scp_evolution_metrics(agent_codename);
