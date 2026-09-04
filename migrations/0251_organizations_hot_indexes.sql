-- 0251 — index the two columns the product resolves an organization BY.
--
-- `organizations.owner_id` had no index. server/middleware/getOrCreateOrg.ts
-- resolves the caller's organization by owner on nearly every authenticated
-- request (storage.getOrganizationByOwner), so that lookup was a sequential
-- scan of the tenants table on essentially every API call — invisible at a
-- handful of customers and linear in customer count forever after.
--
-- `organizations.stripe_customer_id` had no index either, and every Stripe
-- webhook resolves the organization by it before applying an invoice, a
-- subscription change or a dunning transition.
--
-- CONCURRENTLY is deliberately NOT used: it cannot run inside the transaction
-- the migration runner wraps each step in, and the table is small enough that
-- a brief lock is cheaper than the operational complexity. Both statements are
-- idempotent.
CREATE INDEX IF NOT EXISTS "organizations_owner_id_idx"
  ON "organizations" ("owner_id");

CREATE INDEX IF NOT EXISTS "organizations_stripe_customer_id_idx"
  ON "organizations" ("stripe_customer_id");
