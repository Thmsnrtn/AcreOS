-- 0257 — one customer intent to mail = one shipment. The composer's
-- Idempotency-Key, held across retries, is stored on the shipment; a lost
-- response followed by another click finds the existing shipment instead of
-- debiting and queuing a second one. NULL for rows queued before this.
ALTER TABLE "mail_shipments" ADD COLUMN IF NOT EXISTS "operation_key" text;
CREATE UNIQUE INDEX IF NOT EXISTS "mail_shipments_org_operation_uidx" ON "mail_shipments" ("organization_id", "operation_key");
