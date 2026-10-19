-- 0282 — how a mail shipment is paid for (founder decisions 2026-10-17/18,
-- AcreOS house mail). Recorded at queue time so the flusher sends a shipment
-- only through the provider and lane it was funded for, and never bills a
-- piece twice or prints one nobody paid for. NULL for rows queued before this.
ALTER TABLE "mail_shipments" ADD COLUMN IF NOT EXISTS "funding_lane" text;
