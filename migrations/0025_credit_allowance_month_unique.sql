-- DEFECT-0007: Add allowance_month column and unique index to credit_transactions
-- to prevent double-granting monthly allowances under concurrent execution.

ALTER TABLE "credit_transactions" ADD COLUMN "allowance_month" text;

-- Backfill existing allowance records from metadata->>'month'
UPDATE "credit_transactions"
  SET "allowance_month" = "metadata"->>'month'
  WHERE "type" IN ('monthly_allowance', 'allowance')
    AND "metadata"->>'month' IS NOT NULL
    AND "allowance_month" IS NULL;

-- Unique index: only one allowance per org per month
CREATE UNIQUE INDEX "credit_txn_allowance_month_org_uniq"
  ON "credit_transactions" ("organization_id", "allowance_month");
