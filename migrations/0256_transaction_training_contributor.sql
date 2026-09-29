-- 0256 — attribute a customer's closed deal in transaction_training to its
-- org (founder ruling 2026-09-29 #11, DEFECT-0159). NULL = public record
-- (county assessor ingest). Customer rows are comps for their own org only
-- and never enter a cross-org figure; legacy customer rows (written before
-- this column, raw `state|county|…` transaction_hash) cannot be attributed
-- and are used by nobody.
ALTER TABLE "transaction_training" ADD COLUMN IF NOT EXISTS "contributor_org_id" integer;
