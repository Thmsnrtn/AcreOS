-- 0258 — one "record this payment" = one ledger row (quality directive
-- 2026-09-29). The client's Idempotency-Key, held across retries, is stored on
-- the payment; a lost response followed by another click finds the recorded
-- payment instead of posting the money twice. NULL for rows recorded before.
ALTER TABLE "rent_payments" ADD COLUMN IF NOT EXISTS "operation_key" text;
CREATE UNIQUE INDEX IF NOT EXISTS "rent_payments_org_operation_uidx" ON "rent_payments" ("organization_id", "operation_key");
ALTER TABLE "note_payments" ADD COLUMN IF NOT EXISTS "operation_key" text;
CREATE UNIQUE INDEX IF NOT EXISTS "note_payments_org_operation_uidx" ON "note_payments" ("organization_id", "operation_key");
