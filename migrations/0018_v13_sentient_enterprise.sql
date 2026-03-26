-- Sovereign Company Protocol v13: The Sentient Enterprise
-- Six cognitive pillars for agents that remember, adapt, collaborate, heal, comply, and explain

-- ─── Pillar 1: Cognitive Memory Layer ──────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_episodic_memory (
  id SERIAL PRIMARY KEY,
  agent_codename TEXT NOT NULL,
  episode_id TEXT NOT NULL UNIQUE,
  context JSONB NOT NULL DEFAULT '{}',
  action TEXT NOT NULL,
  outcome TEXT NOT NULL,
  outcome_success BOOLEAN NOT NULL DEFAULT true,
  emotional_valence INTEGER NOT NULL DEFAULT 0,
  related_entities JSONB NOT NULL DEFAULT '[]',
  tags JSONB NOT NULL DEFAULT '[]',
  relevance_score INTEGER NOT NULL DEFAULT 100,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TIMESTAMP,
  org_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS aem_agent_idx ON agent_episodic_memory(agent_codename);
CREATE INDEX IF NOT EXISTS aem_relevance_idx ON agent_episodic_memory(relevance_score);
CREATE INDEX IF NOT EXISTS aem_org_idx ON agent_episodic_memory(org_id);
CREATE INDEX IF NOT EXISTS aem_created_idx ON agent_episodic_memory(created_at);

CREATE TABLE IF NOT EXISTS agent_semantic_memory (
  id SERIAL PRIMARY KEY,
  agent_codename TEXT NOT NULL,
  fact_id TEXT NOT NULL UNIQUE,
  fact TEXT NOT NULL,
  category TEXT NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 50,
  source_episodes JSONB NOT NULL DEFAULT '[]',
  reinforcement_count INTEGER NOT NULL DEFAULT 1,
  contradiction_count INTEGER NOT NULL DEFAULT 0,
  decay_score INTEGER NOT NULL DEFAULT 100,
  is_shared BOOLEAN NOT NULL DEFAULT false,
  shared_with_agents JSONB NOT NULL DEFAULT '[]',
  org_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS asm_agent_idx ON agent_semantic_memory(agent_codename);
CREATE INDEX IF NOT EXISTS asm_category_idx ON agent_semantic_memory(category);
CREATE INDEX IF NOT EXISTS asm_confidence_idx ON agent_semantic_memory(confidence);
CREATE INDEX IF NOT EXISTS asm_shared_idx ON agent_semantic_memory(is_shared);
CREATE INDEX IF NOT EXISTS asm_org_idx ON agent_semantic_memory(org_id);

CREATE TABLE IF NOT EXISTS agent_working_memory_v13 (
  id SERIAL PRIMARY KEY,
  saga_id TEXT,
  agent_codename TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  ttl_seconds INTEGER NOT NULL DEFAULT 3600,
  expires_at TIMESTAMP NOT NULL,
  org_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS awm_agent_idx ON agent_working_memory_v13(agent_codename);
CREATE INDEX IF NOT EXISTS awm_saga_idx ON agent_working_memory_v13(saga_id);
CREATE INDEX IF NOT EXISTS awm_expires_idx ON agent_working_memory_v13(expires_at);

CREATE TABLE IF NOT EXISTS memory_access_log (
  id SERIAL PRIMARY KEY,
  agent_codename TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  query TEXT,
  relevance_returned INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mal_agent_idx ON memory_access_log(agent_codename);
CREATE INDEX IF NOT EXISTS mal_type_idx ON memory_access_log(memory_type);

-- ─── Pillar 2: Adaptive Strategy Engine ───────────────────────────────

CREATE TABLE IF NOT EXISTS agent_strategies (
  id SERIAL PRIMARY KEY,
  strategy_id TEXT NOT NULL UNIQUE,
  agent_codename TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  context_weights JSONB NOT NULL DEFAULT '{}',
  trial_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  success_rate NUMERIC NOT NULL DEFAULT 0,
  avg_outcome_value NUMERIC NOT NULL DEFAULT 0,
  thompson_alpha INTEGER NOT NULL DEFAULT 1,
  thompson_beta INTEGER NOT NULL DEFAULT 1,
  min_trials_before_compare INTEGER NOT NULL DEFAULT 10,
  is_active BOOLEAN NOT NULL DEFAULT true,
  parent_strategy_id TEXT,
  mutation_description TEXT,
  org_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS as_agent_idx ON agent_strategies(agent_codename);
CREATE INDEX IF NOT EXISTS as_active_idx ON agent_strategies(is_active);
CREATE INDEX IF NOT EXISTS as_parent_idx ON agent_strategies(parent_strategy_id);
CREATE INDEX IF NOT EXISTS as_org_idx ON agent_strategies(org_id);

CREATE TABLE IF NOT EXISTS strategy_assignments (
  id SERIAL PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  agent_codename TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  context_snapshot JSONB NOT NULL DEFAULT '{}',
  outcome TEXT,
  outcome_value NUMERIC,
  outcome_recorded_at TIMESTAMP,
  org_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sa_strategy_idx ON strategy_assignments(strategy_id);
CREATE INDEX IF NOT EXISTS sa_entity_idx ON strategy_assignments(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS sa_agent_idx ON strategy_assignments(agent_codename);
CREATE INDEX IF NOT EXISTS sa_org_idx ON strategy_assignments(org_id);

CREATE TABLE IF NOT EXISTS strategy_proposals (
  id SERIAL PRIMARY KEY,
  proposal_id TEXT NOT NULL UNIQUE,
  agent_codename TEXT NOT NULL,
  proposed_name TEXT NOT NULL,
  proposed_config JSONB NOT NULL DEFAULT '{}',
  rationale TEXT NOT NULL,
  evidence_episodes JSONB NOT NULL DEFAULT '[]',
  parent_strategy_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT,
  review_notes TEXT,
  org_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS sp_agent_idx ON strategy_proposals(agent_codename);
CREATE INDEX IF NOT EXISTS sp_status_idx ON strategy_proposals(status);
CREATE INDEX IF NOT EXISTS sp_org_idx ON strategy_proposals(org_id);

-- ─── Pillar 3: Agent Collaboration Protocol ───────────────────────────

CREATE TABLE IF NOT EXISTS agent_dialogues (
  id SERIAL PRIMARY KEY,
  dialogue_id TEXT NOT NULL UNIQUE,
  topic TEXT NOT NULL,
  participants JSONB NOT NULL DEFAULT '[]',
  consensus_mechanism TEXT NOT NULL DEFAULT 'majority',
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  related_entity_type TEXT,
  related_entity_id TEXT,
  org_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ad_status_idx ON agent_dialogues(status);
CREATE INDEX IF NOT EXISTS ad_org_idx ON agent_dialogues(org_id);

CREATE TABLE IF NOT EXISTS dialogue_messages (
  id SERIAL PRIMARY KEY,
  dialogue_id TEXT NOT NULL,
  from_agent TEXT NOT NULL,
  message_type TEXT NOT NULL,
  content TEXT NOT NULL,
  evidence JSONB,
  vote TEXT,
  confidence INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dm_dialogue_idx ON dialogue_messages(dialogue_id);
CREATE INDEX IF NOT EXISTS dm_agent_idx ON dialogue_messages(from_agent);
CREATE INDEX IF NOT EXISTS dm_type_idx ON dialogue_messages(message_type);

CREATE TABLE IF NOT EXISTS agent_delegations (
  id SERIAL PRIMARY KEY,
  delegation_id TEXT NOT NULL UNIQUE,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  task TEXT NOT NULL,
  task_context JSONB NOT NULL DEFAULT '{}',
  sla_deadline TIMESTAMP,
  sla_quality_threshold INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  result JSONB,
  quality_score INTEGER,
  org_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS adl_from_idx ON agent_delegations(from_agent);
CREATE INDEX IF NOT EXISTS adl_to_idx ON agent_delegations(to_agent);
CREATE INDEX IF NOT EXISTS adl_status_idx ON agent_delegations(status);
CREATE INDEX IF NOT EXISTS adl_org_idx ON agent_delegations(org_id);

CREATE TABLE IF NOT EXISTS agent_reputation_votes (
  id SERIAL PRIMARY KEY,
  voter_agent TEXT NOT NULL,
  subject_agent TEXT NOT NULL,
  dimension TEXT NOT NULL,
  score INTEGER NOT NULL,
  evidence TEXT,
  dialogue_id TEXT,
  delegation_id TEXT,
  org_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS arv_voter_idx ON agent_reputation_votes(voter_agent);
CREATE INDEX IF NOT EXISTS arv_subject_idx ON agent_reputation_votes(subject_agent);
CREATE INDEX IF NOT EXISTS arv_dimension_idx ON agent_reputation_votes(dimension);
CREATE INDEX IF NOT EXISTS arv_org_idx ON agent_reputation_votes(org_id);

CREATE TABLE IF NOT EXISTS agent_skill_registry (
  id SERIAL PRIMARY KEY,
  agent_codename TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  skill_description TEXT NOT NULL,
  proficiency INTEGER NOT NULL DEFAULT 50,
  avg_latency_ms INTEGER,
  success_rate NUMERIC NOT NULL DEFAULT 0,
  total_invocations INTEGER NOT NULL DEFAULT 0,
  is_advertised BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS asr_agent_idx ON agent_skill_registry(agent_codename);
CREATE INDEX IF NOT EXISTS asr_skill_idx ON agent_skill_registry(skill_name);
CREATE INDEX IF NOT EXISTS asr_proficiency_idx ON agent_skill_registry(proficiency);

-- ─── Pillar 4: Self-Healing Mesh ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_health_baselines (
  id SERIAL PRIMARY KEY,
  agent_codename TEXT NOT NULL,
  metric TEXT NOT NULL,
  p50 NUMERIC NOT NULL DEFAULT 0,
  p95 NUMERIC NOT NULL DEFAULT 0,
  p99 NUMERIC NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 0,
  sample_window TEXT NOT NULL DEFAULT '24h',
  last_calculated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ahb_agent_idx ON agent_health_baselines(agent_codename);
CREATE INDEX IF NOT EXISTS ahb_metric_idx ON agent_health_baselines(metric);

CREATE TABLE IF NOT EXISTS anomaly_detections (
  id SERIAL PRIMARY KEY,
  anomaly_id TEXT NOT NULL UNIQUE,
  agent_codename TEXT NOT NULL,
  metric TEXT NOT NULL,
  expected_value NUMERIC NOT NULL,
  actual_value NUMERIC NOT NULL,
  deviation_percent NUMERIC NOT NULL,
  severity TEXT NOT NULL,
  correlated_events JSONB NOT NULL DEFAULT '[]',
  root_cause_analysis TEXT,
  auto_resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMP,
  org_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS adet_agent_idx ON anomaly_detections(agent_codename);
CREATE INDEX IF NOT EXISTS adet_severity_idx ON anomaly_detections(severity);
CREATE INDEX IF NOT EXISTS adet_resolved_idx ON anomaly_detections(auto_resolved);
CREATE INDEX IF NOT EXISTS adet_org_idx ON anomaly_detections(org_id);

CREATE TABLE IF NOT EXISTS degradation_modes (
  id SERIAL PRIMARY KEY,
  agent_codename TEXT NOT NULL,
  mode_name TEXT NOT NULL,
  capabilities_available JSONB NOT NULL DEFAULT '[]',
  capabilities_disabled JSONB NOT NULL DEFAULT '[]',
  trigger_conditions JSONB NOT NULL DEFAULT '{}',
  is_current_mode BOOLEAN NOT NULL DEFAULT false,
  activated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dgm_agent_idx ON degradation_modes(agent_codename);
CREATE INDEX IF NOT EXISTS dgm_current_idx ON degradation_modes(is_current_mode);

CREATE TABLE IF NOT EXISTS incident_playbooks (
  id SERIAL PRIMARY KEY,
  playbook_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  trigger_pattern JSONB NOT NULL,
  actions JSONB NOT NULL DEFAULT '[]',
  cooldown_minutes INTEGER NOT NULL DEFAULT 30,
  last_triggered_at TIMESTAMP,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ip_enabled_idx ON incident_playbooks(is_enabled);

CREATE TABLE IF NOT EXISTS chaos_experiments (
  id SERIAL PRIMARY KEY,
  experiment_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  experiment_type TEXT NOT NULL,
  target_agent TEXT,
  target_service TEXT,
  config JSONB NOT NULL DEFAULT '{}',
  duration_ms INTEGER NOT NULL DEFAULT 60000,
  status TEXT NOT NULL DEFAULT 'pending',
  impact_observed JSONB,
  recovery_time_ms INTEGER,
  lessons_learned TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ce_status_idx ON chaos_experiments(status);
CREATE INDEX IF NOT EXISTS ce_type_idx ON chaos_experiments(experiment_type);

-- ─── Pillar 5: Governance & Compliance Brain ──────────────────────────

CREATE TABLE IF NOT EXISTS governance_policies (
  id SERIAL PRIMARY KEY,
  policy_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  jurisdiction TEXT,
  rule_dsl TEXT NOT NULL,
  rule_config JSONB NOT NULL DEFAULT '{}',
  severity TEXT NOT NULL DEFAULT 'warning',
  effective_date TIMESTAMP NOT NULL DEFAULT NOW(),
  sunset_date TIMESTAMP,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gp_category_idx ON governance_policies(category);
CREATE INDEX IF NOT EXISTS gp_jurisdiction_idx ON governance_policies(jurisdiction);
CREATE INDEX IF NOT EXISTS gp_active_idx ON governance_policies(is_active);

CREATE TABLE IF NOT EXISTS policy_evaluations (
  id SERIAL PRIMARY KEY,
  evaluation_id TEXT NOT NULL UNIQUE,
  action_id TEXT NOT NULL,
  agent_codename TEXT NOT NULL,
  policies_checked JSONB NOT NULL DEFAULT '[]',
  overall_result TEXT NOT NULL,
  explanation TEXT NOT NULL,
  org_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pe_action_idx ON policy_evaluations(action_id);
CREATE INDEX IF NOT EXISTS pe_agent_idx ON policy_evaluations(agent_codename);
CREATE INDEX IF NOT EXISTS pe_result_idx ON policy_evaluations(overall_result);
CREATE INDEX IF NOT EXISTS pe_org_idx ON policy_evaluations(org_id);

CREATE TABLE IF NOT EXISTS audit_explanations (
  id SERIAL PRIMARY KEY,
  action_id TEXT NOT NULL,
  agent_codename TEXT NOT NULL,
  action_type TEXT NOT NULL,
  human_readable TEXT NOT NULL,
  machine_readable JSONB NOT NULL DEFAULT '{}',
  evidence_chain JSONB NOT NULL DEFAULT '[]',
  model_version TEXT,
  org_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ae_action_idx ON audit_explanations(action_id);
CREATE INDEX IF NOT EXISTS ae_agent_idx ON audit_explanations(agent_codename);
CREATE INDEX IF NOT EXISTS ae_org_idx ON audit_explanations(org_id);

CREATE TABLE IF NOT EXISTS compliance_snapshots (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL,
  period TEXT NOT NULL,
  metrics_by_category JSONB NOT NULL DEFAULT '{}',
  violations JSONB NOT NULL DEFAULT '[]',
  overall_score INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cs_org_idx ON compliance_snapshots(org_id);
CREATE INDEX IF NOT EXISTS cs_period_idx ON compliance_snapshots(period);
CREATE INDEX IF NOT EXISTS cs_score_idx ON compliance_snapshots(overall_score);

CREATE TABLE IF NOT EXISTS regulatory_sandbox_runs (
  id SERIAL PRIMARY KEY,
  sandbox_id TEXT NOT NULL UNIQUE,
  strategy_id TEXT,
  agent_codename TEXT,
  simulated_actions JSONB NOT NULL DEFAULT '[]',
  policy_violations_found JSONB NOT NULL DEFAULT '[]',
  total_simulated INTEGER NOT NULL DEFAULT 0,
  total_violations INTEGER NOT NULL DEFAULT 0,
  recommendation TEXT,
  org_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS rsr_agent_idx ON regulatory_sandbox_runs(agent_codename);
CREATE INDEX IF NOT EXISTS rsr_strategy_idx ON regulatory_sandbox_runs(strategy_id);
CREATE INDEX IF NOT EXISTS rsr_org_idx ON regulatory_sandbox_runs(org_id);

-- ─── Pillar 6: Founder Intelligence Layer ─────────────────────────────

CREATE TABLE IF NOT EXISTS founder_briefings (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL,
  briefing_date TEXT NOT NULL,
  summary TEXT NOT NULL,
  insights JSONB NOT NULL DEFAULT '[]',
  recommendations JSONB NOT NULL DEFAULT '[]',
  agent_highlights JSONB NOT NULL DEFAULT '{}',
  metrics_snapshot JSONB NOT NULL DEFAULT '{}',
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fb_org_idx ON founder_briefings(org_id);
CREATE INDEX IF NOT EXISTS fb_date_idx ON founder_briefings(briefing_date);
CREATE INDEX IF NOT EXISTS fb_read_idx ON founder_briefings(is_read);

CREATE TABLE IF NOT EXISTS simulation_runs (
  id SERIAL PRIMARY KEY,
  simulation_id TEXT NOT NULL UNIQUE,
  org_id INTEGER NOT NULL,
  scenario_name TEXT NOT NULL,
  scenario_config JSONB NOT NULL DEFAULT '{}',
  outcomes JSONB NOT NULL DEFAULT '[]',
  confidence_interval NUMERIC NOT NULL DEFAULT 0.95,
  risk_factors JSONB NOT NULL DEFAULT '[]',
  recommendation TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sr_org_idx ON simulation_runs(org_id);
CREATE INDEX IF NOT EXISTS sr_scenario_idx ON simulation_runs(scenario_name);

CREATE TABLE IF NOT EXISTS strategic_recommendations (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]',
  impact_estimate TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'new',
  acknowledged_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS strec_org_idx ON strategic_recommendations(org_id);
CREATE INDEX IF NOT EXISTS strec_category_idx ON strategic_recommendations(category);
CREATE INDEX IF NOT EXISTS strec_priority_idx ON strategic_recommendations(priority);
CREATE INDEX IF NOT EXISTS strec_status_idx ON strategic_recommendations(status);

CREATE TABLE IF NOT EXISTS founder_interactions (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL,
  feature_used TEXT NOT NULL,
  section TEXT,
  engagement_depth TEXT NOT NULL DEFAULT 'glance',
  session_duration_ms INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fi_org_idx ON founder_interactions(org_id);
CREATE INDEX IF NOT EXISTS fi_feature_idx ON founder_interactions(feature_used);
CREATE INDEX IF NOT EXISTS fi_section_idx ON founder_interactions(section);
