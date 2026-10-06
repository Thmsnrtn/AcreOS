-- Founder-sim database toolkit. Installed into the sim database ONLY
-- (acreos_founder) by simkit.ts; never into a shared or real database.
--
--   simsnap.take()            snapshot every non-empty public table (the
--                             post-boot + seeded baseline)
--   simsnap.restore()         truncate every public table, then restore the
--                             snapshot — a clean world between scenarios
--   simsnap.age_world(iv)     "time passes": subtract `iv` from EVERY
--                             timestamp column of every non-empty public
--                             table. JS Date.now() and SQL now() both stay
--                             real, so code that compares either against a
--                             stored timestamp sees the world exactly `iv`
--                             older — consistent on both sides, unlike a
--                             JS-only clock shim. Triggers are bypassed
--                             (session_replication_role=replica) so
--                             append-only audit triggers don't refuse the
--                             re-stamp. Limits: Redis TTLs and in-process
--                             timers/caches do not age.
CREATE SCHEMA IF NOT EXISTS simsnap;

CREATE OR REPLACE FUNCTION simsnap.take() RETURNS int LANGUAGE plpgsql AS $$
DECLARE r record; n int := 0; has boolean;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'simsnap' LOOP
    EXECUTE format('DROP TABLE simsnap.%I', r.tablename);
  END LOOP;
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', r.tablename) INTO has;
    IF has THEN
      EXECUTE format('CREATE TABLE simsnap.%I AS SELECT * FROM public.%I', r.tablename, r.tablename);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION simsnap.restore() RETURNS int LANGUAGE plpgsql AS $$
DECLARE r record; n int := 0; lst text;
BEGIN
  SET LOCAL session_replication_role = replica;
  SELECT string_agg(format('public.%I', tablename), ', ') INTO lst FROM pg_tables WHERE schemaname = 'public';
  EXECUTE 'TRUNCATE ' || lst || ' RESTART IDENTITY CASCADE';
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'simsnap' LOOP
    EXECUTE format(
      'INSERT INTO public.%I (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM simsnap.%I',
      r.tablename,
      (SELECT string_agg(format('%I', c.column_name), ', ') FROM information_schema.columns c
         WHERE c.table_schema = 'public' AND c.table_name = r.tablename AND c.is_generated <> 'ALWAYS'),
      (SELECT string_agg(format('%I', c.column_name), ', ') FROM information_schema.columns c
         WHERE c.table_schema = 'public' AND c.table_name = r.tablename AND c.is_generated <> 'ALWAYS'),
      r.tablename);
    n := n + 1;
  END LOOP;
  -- Re-sync serial sequences past restored ids.
  FOR r IN
    SELECT c.table_name, c.column_name, pg_get_serial_sequence(format('public.%I', c.table_name), c.column_name) AS seq
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND pg_get_serial_sequence(format('public.%I', c.table_name), c.column_name) IS NOT NULL
      AND c.table_name IN (SELECT tablename FROM pg_tables WHERE schemaname = 'simsnap')
  LOOP
    EXECUTE format('SELECT setval(%L, GREATEST(1, (SELECT COALESCE(MAX(%I),0) FROM public.%I)))', r.seq, r.column_name, r.table_name);
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION simsnap.age_world(iv interval) RETURNS int LANGUAGE plpgsql AS $$
DECLARE t record; c record; has boolean; sets text; n int := 0;
BEGIN
  SET LOCAL session_replication_role = replica;
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', t.tablename) INTO has;
    CONTINUE WHEN NOT has;
    SELECT string_agg(format('%I = %I - %L::interval', col.column_name, col.column_name, iv), ', ') INTO sets
      FROM information_schema.columns col
      WHERE col.table_schema = 'public' AND col.table_name = t.tablename
        AND col.data_type IN ('timestamp with time zone', 'timestamp without time zone', 'date')
        AND col.is_generated <> 'ALWAYS' AND col.is_updatable = 'YES';
    CONTINUE WHEN sets IS NULL;
    EXECUTE format('UPDATE public.%I SET %s', t.tablename, sets);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
