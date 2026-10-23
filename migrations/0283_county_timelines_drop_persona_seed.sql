-- 0283 — delete the county-timeline rows seeded from an AI review persona
-- ("Brigid"), not from any county (P1 false-claims sweep, 2026-10-20).
-- Two rows cite Brigid by name in "source"; the other four are the same
-- persona seed attributed to planning offices, matched on their exact seeded
-- (state, county, source) so an operator-entered row is never touched.
-- Idempotent; a no-op on a database without the table.
-- Mirrored in scripts/migrate.mjs.
DO $mig0283$
BEGIN
  IF to_regclass('"county_subdivision_timelines"') IS NULL THEN
    RETURN;
  END IF;
  DELETE FROM "county_subdivision_timelines"
   WHERE "source" ILIKE '%brigid%'
      OR ("state", "county_name", "source") IN (
        ('TN', 'Hickman', 'Hickman Co Planning'),
        ('TN', 'Maury', 'Maury Co Planning'),
        ('TN', 'Davidson', 'Metro Nashville Planning Dept'),
        ('TN', 'Marshall', 'Marshall Co Planning estimate'));
END
$mig0283$;
