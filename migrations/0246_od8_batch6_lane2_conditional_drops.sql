-- OD-8 DROP BATCH 6 — lane 2's tables, retired with stage-4 turn 15 under
-- the founder's "approve with evidence" ruling (2026-08-29) and Decision D
-- (picker, 2026-08-30: remove the governance Trust-log tab with the lane).
-- trustEnforcementV12 + tenantFabricV12 deleted in the same commit: ledger-
-- only lane, one HTTP call site, zero engine callers, trustFloor/
-- trustCeiling read nowhere live. Same conditional mechanism as 0241-0245;
-- authoritative copy runs from scripts/migrate.mjs.
DO $mig0246$
DECLARE
  t text;
  n bigint;
  dropped text[] := '{}';
  absent text[] := '{}';
  survivors text[] := '{}';
  tables text[] := ARRAY[
    'trust_enforcement_log',
    'tenant_agent_config'
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
      RAISE WARNING '[od8-batch6] % HOLDS % ROW(S) — LEFT IN PLACE for founder review before any drop', t, n;
    END IF;
  END LOOP;
  RAISE NOTICE '[od8-batch6-summary] dropped=% absent=% survivors=%',
    array_to_string(dropped, ','), array_to_string(absent, ','),
    COALESCE(NULLIF(array_to_string(survivors, ','), ''), 'none');
END $mig0246$;
