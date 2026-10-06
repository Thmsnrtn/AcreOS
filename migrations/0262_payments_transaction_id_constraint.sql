-- 0262 — payments.transaction_id is a full UNIQUE constraint, so
-- INSERT … ON CONFLICT (transaction_id) resolves.
--
-- 0023 created "payments_transaction_id_unique" as a PARTIAL unique index
-- (WHERE transaction_id IS NOT NULL), while shared/schema.ts declares the
-- column `.unique()`. Postgres infers a partial index as an ON CONFLICT arbiter
-- only when the statement repeats the index predicate. The payment writers —
-- borrower portal posting (server/services/borrower/portalPaymentPosting.ts)
-- and ACH settlement + reversal (server/services/achAutopay.ts) — name the
-- column alone, so on a database built from these migrations every one of
-- those inserts failed with "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification".
--
-- A UNIQUE constraint treats NULLs as distinct, exactly as the partial index
-- did, so payments recorded without a transaction id are unaffected.
--
-- Idempotent across the three states a database can be in:
--   (a) the 0023 partial index      → replaced by the constraint (same name);
--   (b) the constraint already      → nothing to do;
--   (c) neither                     → the constraint is added. If non-null
--       duplicates exist the migration stops and names their count; payment
--       rows are never deleted here.
-- Mirrored in scripts/migrate.mjs (the release_command).
DO $mig0262$
DECLARE
  dupes bigint;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.payments'::regclass
       AND conname = 'payments_transaction_id_unique'
       AND contype = 'u'
  ) THEN
    RETURN;
  END IF;

  SELECT count(*) INTO dupes
    FROM (
      SELECT transaction_id
        FROM "payments"
       WHERE transaction_id IS NOT NULL
       GROUP BY transaction_id
      HAVING count(*) > 1
    ) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION 'payments.transaction_id has % non-null value(s) recorded more than once; the unique constraint cannot be added until they are resolved by hand', dupes;
  END IF;

  DROP INDEX IF EXISTS "payments_transaction_id_unique";
  ALTER TABLE "payments" ADD CONSTRAINT "payments_transaction_id_unique" UNIQUE ("transaction_id");
END
$mig0262$;
