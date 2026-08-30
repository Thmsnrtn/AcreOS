-- OD-8 LEDGER — read-only, one atomic line carrying the whole program's
-- state. Fly's log stream loses individual notice lines under burst
-- (deploys #35, #42, #43 each dropped different batch summaries), so this
-- re-checks every table the six conditional-drop batches govern and RAISEs
-- a single compact line: 'present=none' is the full clean verdict; any
-- surviving table lists its row count for the founder. Re-prints on every
-- release. Authoritative copy runs from scripts/migrate.mjs.
DO $mig0247$
DECLARE
  t text;
  n bigint;
  present text[] := '{}';
  absent_count int := 0;
  tables text[] := ARRAY[
    'ceo_cognitive_model','ceo_shadow_predictions','knowledge_freshness',
    'agent_resource_quotas','resource_quota_events','decision_causality_nodes',
    'temporal_prediction_patterns','predictive_staged_actions',
    'founder_intents','intent_progress_logs',
    'pre_authorized_tradeoffs','crisis_playbooks','mission_statements',
    'regulatory_feeds','market_adaptations','self_audit_reports',
    'perpetual_ops_checks','communications',
    'saga_instances','reaction_chains',
    'delegation_tokens',
    'trust_enforcement_log','tenant_agent_config'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      absent_count := absent_count + 1;
    ELSE
      EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
      present := present || format('%s(%s rows)', t, n);
    END IF;
  END LOOP;
  RAISE NOTICE '[od8-ledger] absent=%/% present=%',
    absent_count, array_length(tables, 1),
    COALESCE(NULLIF(array_to_string(present, ','), ''), 'none');
END $mig0247$;
