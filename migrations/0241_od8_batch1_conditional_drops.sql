-- OD-8 DROP BATCH 1 — the stage-2 tranche, under the founder's
-- "approve with evidence" ruling (2026-08-29, decision picker; recorded in
-- docs/autonomous/OWNER_DECISIONS_PENDING.md).
--
-- Mechanism, exactly as ruled: each table is counted IN PLACE at release
-- time. Empty -> dropped, with the evidence logged. Holding rows -> left
-- untouched and logged LOUDLY; the deploy watch reads the release log and
-- hands the founder the one-line summary, and that table waits for its own
-- decision before any second attempt.
--
-- These ten lost their only writers on 2026-08-27 when the six
-- zero-caller V-tower services were deleted (stage-4's predecessor wave);
-- no code has been able to write them since, so a nonzero count here is
-- historical data worth a founder look, never fresh traffic.
DO $mig0241$
DECLARE
  t text;
  n bigint;
  dropped text[] := '{}';
  absent text[] := '{}';
  survivors text[] := '{}';
  tables text[] := ARRAY[
    'ceo_cognitive_model',
    'ceo_shadow_predictions',
    'knowledge_freshness',
    'agent_resource_quotas',
    'resource_quota_events',
    'decision_causality_nodes',
    'temporal_prediction_patterns',
    'predictive_staged_actions',
    'founder_intents',
    'intent_progress_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      absent := absent || t;
      CONTINUE;
    END IF;
    EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
    IF n = 0 THEN
      EXECUTE format('DROP TABLE %I CASCADE', t);
      dropped := dropped || t;
    ELSE
      survivors := survivors || format('%s=%s rows', t, n);
      RAISE WARNING '[od8-batch1] % HOLDS % ROW(S) — LEFT IN PLACE for founder review before any drop', t, n;
    END IF;
  END LOOP;
  -- One atomic summary line: Fly's log stream is lossy under burst (deploy
  -- #35 delivered 1 of 10 per-table lines), so the deploy watch keys on
  -- this single line, which arrives whole or not at all — and re-prints on
  -- every release because this block is idempotent.
  RAISE NOTICE '[od8-batch1-summary] dropped=% absent=% survivors=%',
    array_to_string(dropped, ','), array_to_string(absent, ','),
    COALESCE(NULLIF(array_to_string(survivors, ','), ''), 'none');
END $mig0241$;
