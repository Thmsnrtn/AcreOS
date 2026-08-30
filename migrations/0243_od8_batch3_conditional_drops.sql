-- OD-8 DROP BATCH 3 — stage-4 item G's currently-eligible slice, under the
-- founder's "approve with evidence" ruling (2026-08-29). Mechanism identical
-- to 0241/0242; authoritative copy runs from scripts/migrate.mjs.
--
-- Only tables whose CODE retirement fully shipped: saga_instances
-- (sagaOrchestratorV12, turn 16) and reaction_chains
-- (reactiveOrchestrationV14 + boot seeding, turn 16). Explicitly OFF:
-- the four V13 memory tables + memory_access_log (cognitiveMemoryV13.ts is
-- still their live writer/reader until turn 13), trust_enforcement_log /
-- tenant_agent_config / delegation_tokens (turns 14-15 not yet executed),
-- reaction_chain_runs (live reader autonomyScoreV14; chain_id is plain
-- text, no FK to the dropped parent), and reaction_chain_links (discovered
-- zero-caller in this batch's census — future tranche candidate, needs its
-- own recorded decision).
DO $mig0243$
DECLARE
  t text;
  n bigint;
  dropped text[] := '{}';
  absent text[] := '{}';
  survivors text[] := '{}';
  tables text[] := ARRAY[
    'saga_instances',
    'reaction_chains'
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
      RAISE WARNING '[od8-batch3] % HOLDS % ROW(S) — LEFT IN PLACE for founder review before any drop', t, n;
    END IF;
  END LOOP;
  RAISE NOTICE '[od8-batch3-summary] dropped=% absent=% survivors=%',
    array_to_string(dropped, ','), array_to_string(absent, ','),
    COALESCE(NULLIF(array_to_string(survivors, ','), ''), 'none');
END $mig0243$;
