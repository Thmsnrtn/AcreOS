-- 0259 — one campaign send = one mailing order (audit of 224a5c0). The
-- client's Idempotency-Key is claimed on the order before any credit is
-- debited, so a retry that arrives while the first send is still printing
-- finds that order instead of opening a second one (new piece keys, a second
-- printing). NULL for orders opened before.
ALTER TABLE "mailing_orders" ADD COLUMN IF NOT EXISTS "operation_key" text;
CREATE UNIQUE INDEX IF NOT EXISTS "mailing_orders_org_operation_uidx" ON "mailing_orders" ("organization_id", "operation_key");
