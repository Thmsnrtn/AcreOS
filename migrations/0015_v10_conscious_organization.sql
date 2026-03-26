-- Sovereign Company Protocol v10: The Conscious Organization
-- 10 new tables for organizational self-awareness, closed-loop learning,
-- scenario simulation, self-calibration, decision replay, resilience testing,
-- real-time nervous system, and adaptive CEO surface.

-- 1. Scenario Simulations — multi-agent "what if?" engine
CREATE TABLE IF NOT EXISTS scenario_simulations (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  scenario_type TEXT NOT NULL DEFAULT 'custom',          -- 'pricing' | 'hiring' | 'market_shift' | 'product_launch' | 'cost_cut' | 'custom'
  hypothesis TEXT NOT NULL,
  parameters JSONB NOT NULL DEFAULT '{}',
  agent_projections JSONB NOT NULL DEFAULT '[]',          -- array of { agentCodename, domain, projection, confidence, risks, opportunities }
  consensus_summary TEXT,
  consensus_recommendation TEXT,
  confidence_interval JSONB,                              -- { low: number, mid: number, high: number }
  status TEXT NOT NULL DEFAULT 'running',                 -- 'running' | 'completed' | 'archived'
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ss_status_idx ON scenario_simulations(status);
CREATE INDEX IF NOT EXISTS ss_type_idx ON scenario_simulations(scenario_type);

-- 2. Scenario Outcome Comparisons — predicted vs actual
CREATE TABLE IF NOT EXISTS scenario_outcome_comparisons (
  id SERIAL PRIMARY KEY,
  scenario_id INTEGER NOT NULL REFERENCES scenario_simulations(id),
  comparison_date TIMESTAMP NOT NULL DEFAULT NOW(),
  predicted_outcome JSONB NOT NULL,
  actual_outcome JSONB NOT NULL,
  accuracy_score INTEGER NOT NULL DEFAULT 50,             -- 0-100
  lessons_learned TEXT,
  agent_accuracy JSONB NOT NULL DEFAULT '[]',             -- per-agent accuracy scores
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS soc_scenario_idx ON scenario_outcome_comparisons(scenario_id);

-- 3. Learning Propagations — track cross-agent learning
CREATE TABLE IF NOT EXISTS learning_propagations (
  id SERIAL PRIMARY KEY,
  source_agent TEXT NOT NULL,
  target_agents JSONB NOT NULL DEFAULT '[]',
  learning_type TEXT NOT NULL,                            -- 'timing_insight' | 'audience_pattern' | 'conversion_factor' | 'cost_signal' | 'risk_pattern'
  learning TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]',
  outcome_window_days INTEGER NOT NULL DEFAULT 7,
  original_outcome_id TEXT,                               -- reference to what triggered this learning
  propagation_status TEXT NOT NULL DEFAULT 'pending',     -- 'pending' | 'propagated' | 'confirmed' | 'rejected'
  acceptance_rate INTEGER,                                -- % of target agents that accepted
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  propagated_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS lp_source_idx ON learning_propagations(source_agent);
CREATE INDEX IF NOT EXISTS lp_status_idx ON learning_propagations(propagation_status);
CREATE INDEX IF NOT EXISTS lp_type_idx ON learning_propagations(learning_type);

-- 4. Outcome Calibrations — prediction accuracy per agent
CREATE TABLE IF NOT EXISTS outcome_calibrations (
  id SERIAL PRIMARY KEY,
  agent_codename TEXT NOT NULL,
  action_type TEXT NOT NULL,
  predicted_outcome TEXT NOT NULL,
  predicted_confidence INTEGER NOT NULL,                  -- 0-100
  actual_outcome TEXT,
  actual_success BOOLEAN,
  accuracy_delta INTEGER,                                 -- predicted_confidence - actual_success_rate
  outcome_window_days INTEGER NOT NULL DEFAULT 7,
  outcome_measured_at TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'awaiting_outcome',        -- 'awaiting_outcome' | 'measured' | 'expired'
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS oc_agent_idx ON outcome_calibrations(agent_codename);
CREATE INDEX IF NOT EXISTS oc_status_idx ON outcome_calibrations(status);

-- 5. Org Heartbeat Snapshots — system vital signs over time
CREATE TABLE IF NOT EXISTS org_heartbeat_snapshots (
  id SERIAL PRIMARY KEY,
  snapshot_type TEXT NOT NULL DEFAULT 'hourly',           -- 'hourly' | 'daily' | 'weekly'
  agent_latencies JSONB NOT NULL DEFAULT '{}',            -- { agentCodename: avgMs }
  decision_queue_depth INTEGER NOT NULL DEFAULT 0,
  learning_velocity INTEGER NOT NULL DEFAULT 0,           -- new patterns per period
  trust_trajectory JSONB NOT NULL DEFAULT '{}',           -- { agentCodename: trustDelta }
  escalation_ratio NUMERIC NOT NULL DEFAULT 0,            -- % of decisions needing CEO
  feedback_closure_rate NUMERIC NOT NULL DEFAULT 0,       -- % of outcomes feeding back
  coherence_score INTEGER NOT NULL DEFAULT 100,           -- 0-100, alignment with compass
  anomalies JSONB NOT NULL DEFAULT '[]',                  -- detected system-level anomalies
  health_grade TEXT NOT NULL DEFAULT 'A',                 -- A, B, C, D, F
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ohs_type_idx ON org_heartbeat_snapshots(snapshot_type);
CREATE INDEX IF NOT EXISTS ohs_grade_idx ON org_heartbeat_snapshots(health_grade);
CREATE INDEX IF NOT EXISTS ohs_created_idx ON org_heartbeat_snapshots(created_at);

-- 6. Agent Calibration History — self-calibration events
CREATE TABLE IF NOT EXISTS agent_calibration_history (
  id SERIAL PRIMARY KEY,
  agent_codename TEXT NOT NULL,
  calibration_type TEXT NOT NULL,                         -- 'threshold_adjust' | 'timing_shift' | 'confidence_recalibrate' | 'personality_evolve'
  parameter_name TEXT NOT NULL,
  old_value TEXT NOT NULL,
  new_value TEXT NOT NULL,
  trigger_reason TEXT NOT NULL,
  performance_before JSONB,                               -- metrics before calibration
  performance_after JSONB,                                -- metrics after (filled later)
  status TEXT NOT NULL DEFAULT 'applied',                 -- 'applied' | 'reverted' | 'approved' | 'pending_approval'
  ceo_action TEXT,                                        -- 'approved' | 'reverted' | null
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  measured_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ach_agent_idx ON agent_calibration_history(agent_codename);
CREATE INDEX IF NOT EXISTS ach_type_idx ON agent_calibration_history(calibration_type);
CREATE INDEX IF NOT EXISTS ach_status_idx ON agent_calibration_history(status);

-- 7. CEO Decision Replays — historical decision review and bias detection
CREATE TABLE IF NOT EXISTS ceo_decision_replays (
  id SERIAL PRIMARY KEY,
  original_decision_id TEXT NOT NULL,
  decision_type TEXT NOT NULL,                            -- 'initiative_approval' | 'spend_approval' | 'compass_change' | 'goal_delegation' | 'override'
  decision_summary TEXT NOT NULL,
  original_context JSONB NOT NULL DEFAULT '{}',           -- what data was available at decision time
  agent_recommendations JSONB NOT NULL DEFAULT '[]',      -- what agents recommended
  ceo_choice TEXT NOT NULL,
  outcome_data JSONB,                                     -- what actually happened
  hindsight_assessment TEXT,                              -- AI assessment with benefit of hindsight
  was_optimal BOOLEAN,
  quality_score INTEGER,                                  -- 0-100
  bias_flags JSONB NOT NULL DEFAULT '[]',                 -- detected decision biases
  replay_date TIMESTAMP NOT NULL DEFAULT NOW(),
  original_date TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cdr_type_idx ON ceo_decision_replays(decision_type);
CREATE INDEX IF NOT EXISTS cdr_quality_idx ON ceo_decision_replays(quality_score);
CREATE INDEX IF NOT EXISTS cdr_replay_date_idx ON ceo_decision_replays(replay_date);

-- 8. Resilience Tests — chaos testing results and SPOF detection
CREATE TABLE IF NOT EXISTS resilience_tests (
  id SERIAL PRIMARY KEY,
  test_type TEXT NOT NULL,                                -- 'agent_offline' | 'trust_collapse' | 'ceo_absence' | 'data_loss' | 'load_spike'
  test_description TEXT NOT NULL,
  simulated_conditions JSONB NOT NULL DEFAULT '{}',
  results JSONB NOT NULL DEFAULT '{}',                    -- { impact, degradation, recovery_time, affected_functions }
  single_points_of_failure JSONB NOT NULL DEFAULT '[]',   -- identified SPOFs
  recommendations JSONB NOT NULL DEFAULT '[]',
  resilience_score INTEGER NOT NULL DEFAULT 50,           -- 0-100
  status TEXT NOT NULL DEFAULT 'completed',               -- 'running' | 'completed' | 'failed'
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS rt_type_idx ON resilience_tests(test_type);
CREATE INDEX IF NOT EXISTS rt_score_idx ON resilience_tests(resilience_score);

-- 9. Realtime Event Log — all WebSocket nervous system events for replay/audit
CREATE TABLE IF NOT EXISTS realtime_event_log (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,                               -- 'agent.thinking' | 'agent.action.started' | 'agent.action.completed' | 'agent.escalation' | 'goal.progress' | 'kpi.shifted' | 'briefing.ready' | 'system.heartbeat'
  agent_codename TEXT,
  channel TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS rel_event_type_idx ON realtime_event_log(event_type);
CREATE INDEX IF NOT EXISTS rel_agent_idx ON realtime_event_log(agent_codename);
CREATE INDEX IF NOT EXISTS rel_created_idx ON realtime_event_log(created_at);

-- 10. Dashboard Context States — adaptive CEO surface
CREATE TABLE IF NOT EXISTS dashboard_context_states (
  id SERIAL PRIMARY KEY,
  context_mode TEXT NOT NULL,                             -- 'morning' | 'crisis' | 'deep_work' | 'end_of_week' | 'returning' | 'default'
  active_layers JSONB NOT NULL DEFAULT '[]',              -- which UI layers to show
  suppressed_layers JSONB NOT NULL DEFAULT '[]',          -- which UI layers to hide
  trigger_reason TEXT NOT NULL,
  trigger_data JSONB NOT NULL DEFAULT '{}',
  active_from TIMESTAMP NOT NULL DEFAULT NOW(),
  active_until TIMESTAMP,
  is_current BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dcs_mode_idx ON dashboard_context_states(context_mode);
CREATE INDEX IF NOT EXISTS dcs_current_idx ON dashboard_context_states(is_current);
