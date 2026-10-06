-- 0260 — payments.transaction_id: a full UNIQUE constraint, not a partial index.
--
-- 0023 made the column unique with a PARTIAL index
-- (`... WHERE "transaction_id" IS NOT NULL`). Every writer of `payments`
-- inserts with `ON CONFLICT ("transaction_id") DO NOTHING` and no predicate,
-- and PostgreSQL cannot infer a partial index from a bare conflict target, so
-- on a database built from these migrations every payment insert failed with
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification". A database built by `drizzle-kit push` had the full
-- constraint shared/schema.ts declares (`transactionId: text(...).unique()`),
-- which is why the two builds disagreed.
--
-- A plain UNIQUE constraint keeps manual payments legal: PostgreSQL treats
-- NULLs as distinct, so any number of rows may carry no transaction id. The
-- name is the one drizzle gives `.unique()`, so both builds end identical.
--
-- Idempotent, and one statement so the drop and the add commit together.
-- The drop takes any bare index of that name (0023's partial one, or a plain
-- one made by hand), since the constraint cannot be added while it exists.
-- Mirrored in scripts/migrate.mjs (the Fly release_command).
DO $mig0260$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
     WHERE i.indrelid = 'public.payments'::regclass
       AND c.relname = 'payments_transaction_id_unique'
       AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid AND k.contype IN ('u', 'p'))
  ) THEN
    DROP INDEX "payments_transaction_id_unique";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.payments'::regclass
       AND conname = 'payments_transaction_id_unique'
  ) THEN
    ALTER TABLE "payments" ADD CONSTRAINT "payments_transaction_id_unique" UNIQUE ("transaction_id");
  END IF;
END $mig0260$;
