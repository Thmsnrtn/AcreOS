-- Sovereign Company Protocol v12: The Real Runtime
-- Fixes the foundation: real agent lifecycle, event mesh, outcome verification,
-- saga transactions, agent versioning, trust enforcement, integration framework,
-- and tenant isolation.

-- 1. Agent Runtime State — persistent agent lifecycle
CREATE TABLE IF NOT EXISTS agent_runtime_state (
  id SERIAL PRIMARY KEY,
  agent_codename TEXT NOT NULL UNIQUE,
  lifecycle_state TEXT NOT NULL DEFAULT 'initializing',   -- 'initializing' | 'ready' | 'thinking' | 'acting' | 'waiting' | 'sleeping' | 'crashed' | 'terminated'
  current_task TEXT,
  current_task_started_at TIMESTAMP,
  waiting_for TEXT,                                       -- what event/response the agent is waiting for
  waiting_since TIMESTAMP,
  persistent_context JSONB NOT NULL DEFAULT '{}',         -- what the agent remembers between cycles
  memory_budget_bytes INTEGER NOT NULL DEFAULT 1048576,   -- 1MB default
  memory_used_bytes INTEGER NOT NULL DEFAULT 0,
  execution_time_limit_ms INTEGER NOT NULL DEFAULT 30000, -- 30s default
  last_heartbeat_at TIMESTAMP NOT NULL DEFAULT NOW(),
  heartbeat_interval_ms INTEGER NOT NULL DEFAULT 30000,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  max_consecutive_failures INTEGER NOT NULL DEFAULT 5,
  supervisor_agent TEXT,                                   -- parent in supervision tree
  restart_policy TEXT NOT NULL DEFAULT 'restart',          -- 'restart' | 'escalate' | 'substitute' | 'ignore'
  restart_count INTEGER NOT NULL DEFAULT 0,
  last_restart_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ars_state_idx ON agent_runtime_state(lifecycle_state);
CREATE INDEX IF NOT EXISTS ars_heartbeat_idx ON agent_runtime_state(last_heartbeat_at);

-- 2. Event Mesh — real pub/sub event log with delivery tracking
CREATE TABLE IF NOT EXISTS event_mesh_events (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL,                                  -- 'agent.{codename}.{event}' | 'system.*' | 'org.{id}.*'
  event_type TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 5,                    -- 1=critical, 5=normal, 10=low
  payload JSONB NOT NULL DEFAULT '{}',
  publisher TEXT NOT NULL,
  org_id INTEGER,                                         -- tenant scope
  requires_ack BOOLEAN NOT NULL DEFAULT false,
  acked_by JSONB NOT NULL DEFAULT '[]',                   -- agents that acknowledged
  dead_lettered BOOLEAN NOT NULL DEFAULT false,
  dead_letter_reason TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS eme_channel_idx ON event_mesh_events(channel);
CREATE INDEX IF NOT EXISTS eme_type_idx ON event_mesh_events(event_type);
CREATE INDEX IF NOT EXISTS eme_priority_idx ON event_mesh_events(priority);
CREATE INDEX IF NOT EXISTS eme_org_idx ON event_mesh_events(org_id);
CREATE INDEX IF NOT EXISTS eme_dead_idx ON event_mesh_events(dead_lettered);
CREATE INDEX IF NOT EXISTS eme_created_idx ON event_mesh_events(created_at);

-- 3. Event Mesh Subscriptions — who listens to what
CREATE TABLE IF NOT EXISTS event_mesh_subscriptions (
  id SERIAL PRIMARY KEY,
  subscriber TEXT NOT NULL,                               -- agent codename or service name
  channel_pattern TEXT NOT NULL,                          -- glob pattern: 'agent.forge_revenue.*'
  filter_conditions JSONB NOT NULL DEFAULT '{}',
  callback_type TEXT NOT NULL DEFAULT 'internal',         -- 'internal' | 'webhook' | 'queue'
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_event_at TIMESTAMP,
  events_processed INTEGER NOT NULL DEFAULT 0,
  events_failed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ems_subscriber_idx ON event_mesh_subscriptions(subscriber);
CREATE INDEX IF NOT EXISTS ems_channel_idx ON event_mesh_subscriptions(channel_pattern);

-- 4. Outcome Verification Contracts — verify real-world outcomes
CREATE TABLE IF NOT EXISTS outcome_verification_contracts (
  id SERIAL PRIMARY KEY,
  action_id TEXT NOT NULL,
  agent_codename TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_description TEXT NOT NULL,
  claimed_outcome TEXT NOT NULL,
  claimed_success BOOLEAN NOT NULL DEFAULT true,
  verification_method TEXT NOT NULL,                      -- 'email_delivery' | 'customer_login' | 'payment_status' | 'api_response' | 'metric_change' | 'manual'
  verification_config JSONB NOT NULL DEFAULT '{}',        -- method-specific config
  verify_after_minutes INTEGER NOT NULL DEFAULT 60,
  verify_stages JSONB NOT NULL DEFAULT '[]',              -- [{stage:'immediate',minutes:0}, {stage:'short_term',minutes:1440}, {stage:'long_term',minutes:43200}]
  current_stage TEXT NOT NULL DEFAULT 'pending',          -- 'pending' | 'immediate' | 'short_term' | 'long_term' | 'verified' | 'failed' | 'discrepancy'
  verified_outcome TEXT,
  verified_success BOOLEAN,
  discrepancy_detected BOOLEAN NOT NULL DEFAULT false,
  discrepancy_details TEXT,
  org_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  next_verification_at TIMESTAMP,
  completed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ovc_agent_idx ON outcome_verification_contracts(agent_codename);
CREATE INDEX IF NOT EXISTS ovc_stage_idx ON outcome_verification_contracts(current_stage);
CREATE INDEX IF NOT EXISTS ovc_next_idx ON outcome_verification_contracts(next_verification_at);
CREATE INDEX IF NOT EXISTS ovc_discrepancy_idx ON outcome_verification_contracts(discrepancy_detected);

-- 5. Sagas — distributed transaction orchestration
CREATE TABLE IF NOT EXISTS saga_instances (
  id SERIAL PRIMARY KEY,
  saga_id TEXT NOT NULL UNIQUE,
  saga_name TEXT NOT NULL,
  initiator_agent TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',                 -- 'running' | 'compensating' | 'completed' | 'rolled_back' | 'partially_compensated' | 'timed_out'
  steps JSONB NOT NULL DEFAULT '[]',                      -- [{order, agent, action, compensatingAction, status, result, compensationResult}]
  current_step INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL,
  timeout_ms INTEGER NOT NULL DEFAULT 300000,             -- 5 min default
  parent_saga_id TEXT,                                    -- for nested sagas
  org_id INTEGER,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  compensated_at TIMESTAMP,
  error TEXT
);
CREATE INDEX IF NOT EXISTS si_status_idx ON saga_instances(status);
CREATE INDEX IF NOT EXISTS si_initiator_idx ON saga_instances(initiator_agent);
CREATE INDEX IF NOT EXISTS si_idempotency_idx ON saga_instances(idempotency_key);
CREATE INDEX IF NOT EXISTS si_parent_idx ON saga_instances(parent_saga_id);

-- 6. Agent Versions — personality/prompt versioning with canary support
CREATE TABLE IF NOT EXISTS agent_versions (
  id SERIAL PRIMARY KEY,
  agent_codename TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  personality_prompt TEXT NOT NULL,
  owned_services JSONB NOT NULL DEFAULT '[]',
  behavior_config JSONB NOT NULL DEFAULT '{}',            -- thresholds, timing, preferences
  change_description TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  canary_weight INTEGER NOT NULL DEFAULT 0,               -- 0-100, % of traffic to this version
  performance_metrics JSONB NOT NULL DEFAULT '{}',        -- tracked after deployment
  regression_test_passed BOOLEAN,
  regression_test_results JSONB,
  deployed_at TIMESTAMP,
  rolled_back_at TIMESTAMP,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS av_agent_idx ON agent_versions(agent_codename);
CREATE INDEX IF NOT EXISTS av_active_idx ON agent_versions(is_active);
CREATE INDEX IF NOT EXISTS av_version_idx ON agent_versions(agent_codename, version_number);

-- 7. Trust Enforcement Log — actual trust gate decisions
CREATE TABLE IF NOT EXISTS trust_enforcement_log (
  id SERIAL PRIMARY KEY,
  agent_codename TEXT NOT NULL,
  action_type TEXT NOT NULL,
  required_trust INTEGER NOT NULL,
  actual_trust INTEGER NOT NULL,
  decision TEXT NOT NULL,                                 -- 'allowed' | 'blocked' | 'pending_approval' | 'approved' | 'denied' | 'timeout_denied'
  approval_requested_at TIMESTAMP,
  approval_resolved_at TIMESTAMP,
  approved_by TEXT,                                       -- 'ceo' | 'timeout' | 'auto'
  action_outcome TEXT,                                    -- 'success' | 'failure' | null (pending)
  trust_delta INTEGER,                                    -- how much trust changed after this action
  org_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tel_agent_idx ON trust_enforcement_log(agent_codename);
CREATE INDEX IF NOT EXISTS tel_decision_idx ON trust_enforcement_log(decision);
CREATE INDEX IF NOT EXISTS tel_org_idx ON trust_enforcement_log(org_id);

-- 8. Integration Credentials — secure credential vault
CREATE TABLE IF NOT EXISTS integration_credentials (
  id SERIAL PRIMARY KEY,
  service_name TEXT NOT NULL,                             -- 'stripe' | 'twilio' | 'sendgrid' | 'lob' | etc.
  credential_type TEXT NOT NULL,                          -- 'api_key' | 'oauth_token' | 'webhook_secret'
  encrypted_value TEXT NOT NULL,                          -- encrypted with FIELD_ENCRYPTION_KEY
  allowed_agents JSONB NOT NULL DEFAULT '[]',             -- which agents can use this credential
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
  rate_limit_used INTEGER NOT NULL DEFAULT 0,
  rate_limit_reset_at TIMESTAMP NOT NULL DEFAULT NOW(),
  circuit_breaker_failures INTEGER NOT NULL DEFAULT 0,
  circuit_breaker_threshold INTEGER NOT NULL DEFAULT 5,
  circuit_breaker_open BOOLEAN NOT NULL DEFAULT false,
  circuit_breaker_reset_at TIMESTAMP,
  last_used_at TIMESTAMP,
  org_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ic_service_idx ON integration_credentials(service_name);
CREATE INDEX IF NOT EXISTS ic_circuit_idx ON integration_credentials(circuit_breaker_open);

-- 9. Integration Execution Log — every external API call tracked
CREATE TABLE IF NOT EXISTS integration_execution_log (
  id SERIAL PRIMARY KEY,
  agent_codename TEXT NOT NULL,
  service_name TEXT NOT NULL,
  method TEXT NOT NULL,                                   -- 'GET' | 'POST' | 'PUT' | 'DELETE'
  endpoint TEXT NOT NULL,
  request_summary TEXT,
  response_status INTEGER,
  response_summary TEXT,
  cost_cents INTEGER NOT NULL DEFAULT 0,                  -- per-call cost tracking
  latency_ms INTEGER,
  success BOOLEAN,
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  rollback_action TEXT,                                   -- undo operation if needed
  rollback_executed BOOLEAN NOT NULL DEFAULT false,
  org_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS iel_agent_idx ON integration_execution_log(agent_codename);
CREATE INDEX IF NOT EXISTS iel_service_idx ON integration_execution_log(service_name);
CREATE INDEX IF NOT EXISTS iel_success_idx ON integration_execution_log(success);

-- 10. Tenant Agent Config — per-tenant agent customization
CREATE TABLE IF NOT EXISTS tenant_agent_config (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL,
  agent_codename TEXT NOT NULL,
  trust_score INTEGER NOT NULL DEFAULT 50,
  trust_floor INTEGER NOT NULL DEFAULT 20,
  trust_ceiling INTEGER NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT true,
  custom_personality_override TEXT,
  custom_quotas JSONB NOT NULL DEFAULT '{}',
  custom_permissions JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, agent_codename)
);
CREATE INDEX IF NOT EXISTS tac_org_idx ON tenant_agent_config(org_id);
CREATE INDEX IF NOT EXISTS tac_agent_idx ON tenant_agent_config(agent_codename);

-- 11. Tenant Event Streams — isolated per-tenant event channels
CREATE TABLE IF NOT EXISTS tenant_event_streams (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL,
  stream_name TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  last_event_at TIMESTAMP,
  quota_events_per_hour INTEGER NOT NULL DEFAULT 1000,
  quota_used_this_hour INTEGER NOT NULL DEFAULT 0,
  quota_reset_at TIMESTAMP NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, stream_name)
);
CREATE INDEX IF NOT EXISTS tes_org_idx ON tenant_event_streams(org_id);
