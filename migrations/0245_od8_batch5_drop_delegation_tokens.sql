-- OD-8 DROP BATCH 5 — delegation_tokens, retired with stage-4 turn 14,
-- under the founder's "approve with evidence" ruling (2026-08-29).
-- delegationTokensV11's constant deny became an explicit structural
-- escalate in executionEngine.validateSafetyGates, so the table lost its
-- only writer and reader in the same commit as this migration. Created
-- only by migrations/0016 (never applied to production) — 'absent' is the
-- expected verdict; rows would mean a founder curl once granted a token,
-- and such a survivor stays for founder review. Authoritative copy runs
-- from scripts/migrate.mjs.
DO $mig0245$
DECLARE
  n bigint;
  verdict text;
BEGIN
  IF to_regclass('public.delegation_tokens') IS NULL THEN
    verdict := 'absent=delegation_tokens survivors=none';
  ELSE
    EXECUTE 'SELECT count(*) FROM delegation_tokens' INTO n;
    IF n = 0 THEN
      EXECUTE 'DROP TABLE delegation_tokens CASCADE';
      verdict := 'dropped=delegation_tokens survivors=none';
    ELSE
      verdict := format('survivors=delegation_tokens=%s rows', n);
      RAISE WARNING '[od8-batch5] delegation_tokens HOLDS % ROW(S) — LEFT IN PLACE for founder review before any drop', n;
    END IF;
  END IF;
  RAISE NOTICE '[od8-batch5-summary] %', verdict;
END $mig0245$;
