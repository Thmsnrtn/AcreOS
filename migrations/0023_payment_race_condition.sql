-- Fix: Concurrent payment race condition (P0)
-- 1. Add version column to notes for optimistic locking
-- 2. Add unique constraint on payments.transaction_id to prevent double-inserts

ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;

-- Unique constraint prevents duplicate payment records for the same Stripe session
-- Nulls are allowed (manual payments may not have a transaction ID)
CREATE UNIQUE INDEX IF NOT EXISTS "payments_transaction_id_unique" ON "payments" ("transaction_id") WHERE "transaction_id" IS NOT NULL;
