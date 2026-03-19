-- Sovereign Company Protocol v11: The Anticipatory Enterprise
-- 8 new systems for agent negotiation, revenue attribution, CEO cognitive modeling,
-- temporal knowledge decay, resource governance, decision causality, delegation tokens,
-- and predictive orchestration.

-- 1. Agent Negotiations — structured conflict resolution between agents
CREATE TABLE IF NOT EXISTS agent_negotiations (
  id SERIAL PRIMARY KEY,
  initiator_agent TEXT NOT NULL,
  respondent_agent TEXT NOT NULL,
  conflict_type TEXT NOT NULL,                            -- 'resource_contention' | 'strategy_disagreement' | 'priority_conflict' | 'authority_overlap' | 'data_interpretation'
  subject TEXT NOT NULL,
  initiator_position TEXT NOT NULL,
  initiator_evidence JSONB NOT NULL DEFAULT '[]',
  respondent_position TEXT,
  respondent_evidence JSONB NOT NULL DEFAULT '[]',
  negotiation_rounds JSONB NOT NULL DEFAULT '[]',         -- array of { round, agentCodename, proposal, concessions, reasoning }
  resolution TEXT,
  resolution_type TEXT,                                   -- 'compromise' | 'initiator_wins' | 'respondent_wins' | 'escalated' | 'deadlocked'
  compromise_details JSONB,
  ceo_override TEXT,
  status TEXT NOT NULL DEFAULT 'open',                    -- 'open' | 'negotiating' | 'resolved' | 'escalated' | 'deadlocked'
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS an_status_idx ON agent_negotiations(status);
CREATE INDEX IF NOT EXISTS an_initiator_idx ON agent_negotiations(initiator_agent);
CREATE INDEX IF NOT EXISTS an_respondent_idx ON agent_negotiations(respondent_agent);

-- 2. Revenue Attribution Nodes — causal chain of agent actions to revenue
CREATE TABLE IF NOT EXISTS revenue_attribution_nodes (
  id SERIAL PRIMARY KEY,
  correlation_id TEXT NOT NULL,                           -- links related actions
  agent_codename TEXT NOT NULL,
  action_type TEXT NOT NULL,                              -- 'campaign_launch' | 'email_send' | 'lead_nurture' | 'deal_close' | 'retention_save' | 'upsell'
  action_description TEXT NOT NULL,
  revenue_impact_cents INTEGER,                           -- attributed revenue in cents
  attribution_weight NUMERIC NOT NULL DEFAULT 0,          -- 0-1, % of revenue this action caused
  upstream_node_id INTEGER,                               -- parent in causal chain
  downstream_node_ids JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ran_correlation_idx ON revenue_attribution_nodes(correlation_id);
CREATE INDEX IF NOT EXISTS ran_agent_idx ON revenue_attribution_nodes(agent_codename);
CREATE INDEX IF NOT EXISTS ran_action_idx ON revenue_attribution_nodes(action_type);

-- 3. Revenue Attribution Reports — periodic agent ROI summaries
CREATE TABLE IF NOT EXISTS revenue_attribution_reports (
  id SERIAL PRIMARY KEY,
  report_period TEXT NOT NULL,                            -- 'weekly' | 'monthly'
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  agent_contributions JSONB NOT NULL DEFAULT '[]',        -- array of { agentCodename, totalRevenue, actionCount, avgAttribution, roi }
  top_chains JSONB NOT NULL DEFAULT '[]',                 -- highest-value causal chains
  total_attributed_revenue INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS rar_period_idx ON revenue_attribution_reports(report_period);

-- 4. CEO Cognitive Model — learned model of CEO decision-making
CREATE TABLE IF NOT EXISTS ceo_cognitive_model (
  id SERIAL PRIMARY KEY,
  model_version INTEGER NOT NULL DEFAULT 1,
  decision_category TEXT NOT NULL,                        -- 'pricing' | 'hiring' | 'spending' | 'strategy' | 'agent_trust' | 'customer_escalation'
  learned_preferences JSONB NOT NULL DEFAULT '{}',        -- { riskTolerance, timeHorizon, agentWeighting, domainExpertise }
  decision_patterns JSONB NOT NULL DEFAULT '[]',          -- extracted rules from CEO behavior
  shadow_accuracy NUMERIC NOT NULL DEFAULT 0,             -- % match between model prediction and CEO actual decision
  shadow_predictions INTEGER NOT NULL DEFAULT 0,          -- total shadow predictions made
  shadow_correct INTEGER NOT NULL DEFAULT 0,              -- total correct shadow predictions
  autopilot_eligible BOOLEAN NOT NULL DEFAULT false,      -- true when accuracy >= 90% and sample >= 15
  autopilot_enabled BOOLEAN NOT NULL DEFAULT false,       -- CEO has approved autopilot for this category
  last_trained_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ccm_category_idx ON ceo_cognitive_model(decision_category);
CREATE INDEX IF NOT EXISTS ccm_autopilot_idx ON ceo_cognitive_model(autopilot_eligible);

-- 5. CEO Shadow Predictions — individual model predictions vs CEO actual
CREATE TABLE IF NOT EXISTS ceo_shadow_predictions (
  id SERIAL PRIMARY KEY,
  decision_category TEXT NOT NULL,
  decision_context JSONB NOT NULL DEFAULT '{}',
  model_prediction TEXT NOT NULL,
  model_reasoning TEXT NOT NULL,
  model_confidence INTEGER NOT NULL DEFAULT 50,
  ceo_actual_decision TEXT,
  was_correct BOOLEAN,
  divergence_reason TEXT,                                 -- why model and CEO diverged
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS csp_category_idx ON ceo_shadow_predictions(decision_category);
CREATE INDEX IF NOT EXISTS csp_correct_idx ON ceo_shadow_predictions(was_correct);

-- 6. Knowledge Freshness — temporal decay tracking for institutional memory
CREATE TABLE IF NOT EXISTS knowledge_freshness (
  id SERIAL PRIMARY KEY,
  pattern_id TEXT NOT NULL,                               -- reference to institutional memory pattern
  pattern_name TEXT NOT NULL,
  source_agent TEXT NOT NULL,
  freshness_score NUMERIC NOT NULL DEFAULT 100,           -- 0-100, decays over time
  half_life_days INTEGER NOT NULL DEFAULT 90,
  last_validated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMP,
  usage_count INTEGER NOT NULL DEFAULT 0,
  seasonal_tags JSONB NOT NULL DEFAULT '[]',              -- e.g., ['Q4', 'holiday_season']
  is_zombie BOOLEAN NOT NULL DEFAULT false,               -- stale but still being used
  lineage_parent_id TEXT,                                 -- evolved from which pattern
  status TEXT NOT NULL DEFAULT 'active',                  -- 'active' | 'decaying' | 'stale' | 'revalidating' | 'archived'
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS kf_pattern_idx ON knowledge_freshness(pattern_id);
CREATE INDEX IF NOT EXISTS kf_status_idx ON knowledge_freshness(status);
CREATE INDEX IF NOT EXISTS kf_zombie_idx ON knowledge_freshness(is_zombie);
CREATE INDEX IF NOT EXISTS kf_agent_idx ON knowledge_freshness(source_agent);

-- 7. Agent Resource Quotas — per-agent resource limits and usage
CREATE TABLE IF NOT EXISTS agent_resource_quotas (
  id SERIAL PRIMARY KEY,
  agent_codename TEXT NOT NULL UNIQUE,
  daily_action_limit INTEGER NOT NULL DEFAULT 200,
  daily_actions_used INTEGER NOT NULL DEFAULT 0,
  daily_cost_limit_cents INTEGER NOT NULL DEFAULT 50000,  -- $500
  daily_cost_used_cents INTEGER NOT NULL DEFAULT 0,
  hourly_rate_limit INTEGER NOT NULL DEFAULT 50,
  hourly_actions_used INTEGER NOT NULL DEFAULT 0,
  circuit_breaker_threshold NUMERIC NOT NULL DEFAULT 30,  -- % failure rate to trip
  circuit_breaker_tripped BOOLEAN NOT NULL DEFAULT false,
  circuit_breaker_cooldown_until TIMESTAMP,
  burst_detected BOOLEAN NOT NULL DEFAULT false,
  burst_throttled_until TIMESTAMP,
  last_reset_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS arq_agent_idx ON agent_resource_quotas(agent_codename);
CREATE INDEX IF NOT EXISTS arq_circuit_idx ON agent_resource_quotas(circuit_breaker_tripped);

-- 8. Resource Quota Events — log of quota enforcement actions
CREATE TABLE IF NOT EXISTS resource_quota_events (
  id SERIAL PRIMARY KEY,
  agent_codename TEXT NOT NULL,
  event_type TEXT NOT NULL,                               -- 'quota_hit' | 'circuit_breaker_tripped' | 'burst_detected' | 'cooldown_expired' | 'quota_reset' | 'quota_borrowed'
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS rqe_agent_idx ON resource_quota_events(agent_codename);
CREATE INDEX IF NOT EXISTS rqe_type_idx ON resource_quota_events(event_type);

-- 9. Decision Causality Graph — DAG of decision dependencies
CREATE TABLE IF NOT EXISTS decision_causality_nodes (
  id SERIAL PRIMARY KEY,
  decision_id TEXT NOT NULL UNIQUE,                       -- unique decision identifier
  agent_codename TEXT NOT NULL,
  decision_type TEXT NOT NULL,
  decision_summary TEXT NOT NULL,
  parent_decision_ids JSONB NOT NULL DEFAULT '[]',        -- upstream causes
  child_decision_ids JSONB NOT NULL DEFAULT '[]',         -- downstream effects
  depth INTEGER NOT NULL DEFAULT 0,                       -- chain depth
  blast_radius INTEGER NOT NULL DEFAULT 0,                -- total downstream decisions
  outcome TEXT,                                           -- 'success' | 'failure' | 'pending' | 'rolled_back'
  rollback_eligible BOOLEAN NOT NULL DEFAULT false,
  rolled_back_at TIMESTAMP,
  rollback_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dcn_decision_idx ON decision_causality_nodes(decision_id);
CREATE INDEX IF NOT EXISTS dcn_agent_idx ON decision_causality_nodes(agent_codename);
CREATE INDEX IF NOT EXISTS dcn_outcome_idx ON decision_causality_nodes(outcome);
CREATE INDEX IF NOT EXISTS dcn_depth_idx ON decision_causality_nodes(depth);

-- 10. Delegation Tokens — time-bounded, scope-limited authority grants
CREATE TABLE IF NOT EXISTS delegation_tokens (
  id SERIAL PRIMARY KEY,
  agent_codename TEXT NOT NULL,
  scope TEXT NOT NULL,                                    -- 'refunds' | 'discounts' | 'billing' | 'escalation' | 'hiring' | 'custom'
  authority_level INTEGER NOT NULL DEFAULT 1,             -- 0-3
  spending_limit_cents INTEGER,                           -- max per action
  conditions JSONB NOT NULL DEFAULT '{}',                 -- additional constraints
  granted_by TEXT NOT NULL DEFAULT 'ceo',
  reason TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  is_standing BOOLEAN NOT NULL DEFAULT false,             -- auto-renewable
  auto_renew_days INTEGER,
  actions_taken INTEGER NOT NULL DEFAULT 0,
  actions_succeeded INTEGER NOT NULL DEFAULT 0,
  actions_failed INTEGER NOT NULL DEFAULT 0,
  revoked BOOLEAN NOT NULL DEFAULT false,
  revoked_at TIMESTAMP,
  revocation_reason TEXT,
  status TEXT NOT NULL DEFAULT 'active',                  -- 'active' | 'expired' | 'revoked' | 'suspended'
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dt_agent_idx ON delegation_tokens(agent_codename);
CREATE INDEX IF NOT EXISTS dt_status_idx ON delegation_tokens(status);
CREATE INDEX IF NOT EXISTS dt_scope_idx ON delegation_tokens(scope);
CREATE INDEX IF NOT EXISTS dt_expires_idx ON delegation_tokens(expires_at);

-- 11. Predictive Orchestration — staged anticipatory actions
CREATE TABLE IF NOT EXISTS predictive_staged_actions (
  id SERIAL PRIMARY KEY,
  prediction_source TEXT NOT NULL,                        -- agent or pattern that generated the prediction
  trigger_pattern TEXT NOT NULL,                          -- what signal are we watching for
  trigger_confidence INTEGER NOT NULL DEFAULT 50,         -- 0-100 confidence the trigger will fire
  staged_agent TEXT NOT NULL,                             -- agent who will execute
  staged_action TEXT NOT NULL,                            -- what to do when trigger fires
  staged_action_details JSONB NOT NULL DEFAULT '{}',
  predicted_trigger_window JSONB NOT NULL DEFAULT '{}',   -- { from, to } when we expect the trigger
  status TEXT NOT NULL DEFAULT 'staged',                  -- 'staged' | 'triggered' | 'executing' | 'completed' | 'cancelled' | 'expired'
  trigger_detected_at TIMESTAMP,
  executed_at TIMESTAMP,
  execution_result JSONB,
  cancelled_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS psa_status_idx ON predictive_staged_actions(status);
CREATE INDEX IF NOT EXISTS psa_agent_idx ON predictive_staged_actions(staged_agent);
CREATE INDEX IF NOT EXISTS psa_expires_idx ON predictive_staged_actions(expires_at);

-- 12. Temporal Prediction Patterns — learned cause-effect with time delay
CREATE TABLE IF NOT EXISTS temporal_prediction_patterns (
  id SERIAL PRIMARY KEY,
  cause_signal TEXT NOT NULL,                             -- 'oracle:revenue_dip_5pct'
  cause_agent TEXT NOT NULL,
  effect_signal TEXT NOT NULL,                            -- 'sophie:ticket_spike'
  effect_agent TEXT NOT NULL,
  avg_delay_hours NUMERIC NOT NULL DEFAULT 48,
  correlation_strength NUMERIC NOT NULL DEFAULT 0.5,      -- 0-1
  sample_count INTEGER NOT NULL DEFAULT 0,
  last_triggered_at TIMESTAMP,
  last_correct BOOLEAN,
  accuracy_rate NUMERIC NOT NULL DEFAULT 0,               -- historical accuracy
  auto_stage_enabled BOOLEAN NOT NULL DEFAULT false,      -- auto-create staged actions
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tpp_cause_idx ON temporal_prediction_patterns(cause_signal);
CREATE INDEX IF NOT EXISTS tpp_effect_idx ON temporal_prediction_patterns(effect_signal);
CREATE INDEX IF NOT EXISTS tpp_auto_idx ON temporal_prediction_patterns(auto_stage_enabled);
