-- 0160_tenant_event_streams_retirement.sql
--
-- The S4 rider for item 0017 (founder ruling 2026-11-17, adopting the
-- s4-0017 dossier's Option A rider). tenant_event_streams was created
-- only by migrations/0017_v12_real_runtime.sql and superseded by
-- lifecycle_events, which IS modelled. Unlike its 0017 siblings
-- (saga_instances dropped by 0243; trust_enforcement_log and
-- tenant_agent_config dropped by 0246) it was dropped by NOTHING —
-- no OD-8 batch, no other migration, no migrate.mjs statement — so
-- "do nothing" and "retired" were different physical statements for
-- exactly this one table: any accidental creation (a manual .sql
-- application, a db:build-from-repo promotion) would persist
-- forever with no machinery that ever removes it.
--
-- This file gives it the OD-8 conditional-drop treatment, verbatim
-- in shape: dropped only when it exists AND holds 0 rows; a
-- populated survivor is left in place and logged loudly for a
-- founder decision, never force-dropped. Mirrored statement-for-
-- statement in scripts/migrate.mjs (// 0160 — block).
--
-- The table also joins the 0247 OD-8 ledger's re-check list in the
-- same PR, so future release logs report its state.

DO $mig0160$
DECLARE
  t text;
  n bigint;
  dropped text[] := '{}';
  absent text[] := '{}';
  survivors text[] := '{}';
  tables text[] := ARRAY[
    'tenant_event_streams'
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
      RAISE WARNING '[od8-0160] % HOLDS % ROW(S) — LEFT IN PLACE for founder review before any drop', t, n;
    END IF;
  END LOOP;
  RAISE NOTICE '[od8-0160-summary] dropped=% absent=% survivors=%',
    array_to_string(dropped, ','), array_to_string(absent, ','),
    COALESCE(NULLIF(array_to_string(survivors, ','), ''), 'none');
END $mig0160$;
