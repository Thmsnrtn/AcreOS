-- OD-8 DROP BATCH 2 — the permanentSovereignty-cascade tranche, under the
-- founder's "approve with evidence" ruling (2026-08-29 decision picker;
-- OWNER_DECISIONS_PENDING.md OD-8 DECIDED). Same mechanism as 0241: count
-- in place at release time, drop only at zero rows, populated survivors
-- stay and warn loudly, one atomic [od8-batch2-summary] line carries the
-- verdict past Fly's lossy log stream. Authoritative copy runs from
-- scripts/migrate.mjs (production's release command); this file mirrors it.
--
-- Tranche corrections (recorded like batch 1's autonomy pair):
--   war_room_messages OFF — live reader+writer in warRoomService, reached
--   via ceoCommandBridge and attentionOptimizer.
--   canary_deploys / migration_plans / provider_configs OFF — never
--   persisted anywhere (no model, no CREATE in any migration path);
--   they were in-memory constructs of the deleted services.
DO $mig0242$
DECLARE
  t text;
  n bigint;
  dropped text[] := '{}';
  absent text[] := '{}';
  survivors text[] := '{}';
  tables text[] := ARRAY[
    'pre_authorized_tradeoffs',
    'crisis_playbooks',
    'mission_statements',
    'regulatory_feeds',
    'market_adaptations',
    'self_audit_reports',
    'perpetual_ops_checks',
    'communications'
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
      RAISE WARNING '[od8-batch2] % HOLDS % ROW(S) — LEFT IN PLACE for founder review before any drop', t, n;
    END IF;
  END LOOP;
  RAISE NOTICE '[od8-batch2-summary] dropped=% absent=% survivors=%',
    array_to_string(dropped, ','), array_to_string(absent, ','),
    COALESCE(NULLIF(array_to_string(survivors, ','), ''), 'none');
END $mig0242$;
