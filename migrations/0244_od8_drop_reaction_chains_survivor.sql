-- OD-8: founder-authorized drop of the batch-3 populated survivor.
-- reaction_chains survived migration 0243 with 6,510 rows (deploy #38's
-- [od8-batch3-summary] evidence — the ruling's first populated survivor,
-- left in place exactly as prescribed). The founder ruled DROP via the
-- decision picker on 2026-08-30: the rows are machine-reseeded
-- DEFAULT_CHAINS duplicates written by the deleted reactiveOrchestrationV14
-- bootstrap on every boot — no human-authored config, no run history
-- (reaction_chain_runs stays live under autonomyScoreV14). The one
-- deliberate exception to the zero-rows condition; the dropped row count
-- is preserved in the evidence line. Authoritative copy runs from
-- scripts/migrate.mjs.
DO $mig0244$
DECLARE
  n bigint;
BEGIN
  IF to_regclass('public.reaction_chains') IS NULL THEN
    RAISE NOTICE '[od8-batch4-summary] reaction_chains already absent — nothing to drop';
  ELSE
    EXECUTE 'SELECT count(*) FROM reaction_chains' INTO n;
    EXECUTE 'DROP TABLE reaction_chains CASCADE';
    RAISE NOTICE '[od8-batch4-summary] DROPPED reaction_chains WITH % ROWS — founder-authorized populated drop (picker ruling 2026-08-30, OD-8 batch-3 survivor)', n;
  END IF;
END $mig0244$;
