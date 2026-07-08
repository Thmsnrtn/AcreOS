-- 0190 — SMS response capture + TCPA quiet-hours truth (roadmap W1.4/W1.5).
-- 1) unattached_inbound_messages: inbound SMS from numbers matching no lead
--    used to be silently DISCARDED (a hot seller reply, lost). They now land
--    here for attach-to-lead / create-lead triage, replay-deduped on the
--    carrier message id.
-- 2) leads.timezone: IANA zone for TCPA quiet hours — area-code inference is
--    unreliable after number porting; null → area-code fallback.
-- Additive + idempotent.
CREATE TABLE IF NOT EXISTS "unattached_inbound_messages" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL,
  "channel" text NOT NULL,
  "from_address" text NOT NULL,
  "to_address" text,
  "body" text NOT NULL,
  "external_id" text,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "resolution" text,
  "resolved_lead_id" integer,
  "resolved_at" timestamptz,
  "resolved_by" text
);
CREATE INDEX IF NOT EXISTS "unattached_inbound_org_idx"
  ON "unattached_inbound_messages" ("organization_id", "received_at");
CREATE UNIQUE INDEX IF NOT EXISTS "unattached_inbound_external_uq"
  ON "unattached_inbound_messages" ("external_id") WHERE "external_id" IS NOT NULL;

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "timezone" text;
