-- ============================================================================
-- 0302 — E2 slice 1 (Pax core), legs 1, 3, 5: business memory, prepared work
-- (packets), rails, and the trust ledger.
--
-- All four are org-scoped (organization_id leads every index; rows go with the
-- org, ON DELETE CASCADE). Full reasoning: shared/schema/pax-core.ts and
-- docs/evidence/2026-11-03/e2-slice1-pax-brief.md.
--
--   pax_business_memory  user-written business memory (+ approved proposals)
--   pax_packets          prepared work: sections with provenance, lifecycle
--   pax_rails            what Pax may prepare unprompted, as data
--   pax_trust_ledger     append-only record; UPDATE refused by trigger (the
--                        0239 pattern). DELETE is left to the org cascade.
--
-- Generated from the Drizzle declarations (scripts/generate-schema-ddl.ts),
-- not hand-transcribed. Mirrors scripts/migrate.mjs STATEMENTS. Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "pax_business_memory" (
    "id" serial PRIMARY KEY,
    "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
    "category" text NOT NULL,
    "content" text NOT NULL,
    "source" text NOT NULL,
    "packet_id" integer,
    "created_by" text NOT NULL,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  );
CREATE INDEX IF NOT EXISTS "pax_business_memory_org_idx" ON "pax_business_memory" ("organization_id", "updated_at");

CREATE TABLE IF NOT EXISTS "pax_packets" (
    "id" serial PRIMARY KEY,
    "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
    "kind" text NOT NULL,
    "title" text NOT NULL,
    "concerns" jsonb NOT NULL,
    "sections" jsonb NOT NULL,
    "payload" jsonb NOT NULL,
    "rail_key" text NOT NULL,
    "status" text NOT NULL DEFAULT 'prepared',
    "decided_at" timestamp,
    "decided_by" text,
    "created_at" timestamp NOT NULL DEFAULT now()
  );
CREATE INDEX IF NOT EXISTS "pax_packets_org_status_idx" ON "pax_packets" ("organization_id", "status", "created_at");

CREATE TABLE IF NOT EXISTS "pax_rails" (
    "id" serial PRIMARY KEY,
    "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
    "rail_key" text NOT NULL,
    "text" text NOT NULL,
    "active" boolean NOT NULL DEFAULT true,
    "updated_by" text,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  );
CREATE UNIQUE INDEX IF NOT EXISTS "pax_rails_org_key_idx" ON "pax_rails" ("organization_id", "rail_key");

CREATE TABLE IF NOT EXISTS "pax_trust_ledger" (
    "id" serial PRIMARY KEY,
    "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
    "event" text NOT NULL,
    "actor" text NOT NULL,
    "subject_type" text,
    "subject_id" integer,
    "shadow" boolean NOT NULL DEFAULT false,
    "detail" jsonb NOT NULL,
    "created_at" timestamp NOT NULL DEFAULT now()
  );
CREATE INDEX IF NOT EXISTS "pax_trust_ledger_org_created_idx" ON "pax_trust_ledger" ("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "pax_trust_ledger_org_event_idx" ON "pax_trust_ledger" ("organization_id", "event", "created_at");

-- Append-only: the ledger is never rewritten.
CREATE OR REPLACE FUNCTION "pax_trust_ledger_refuse_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'pax_trust_ledger is append-only: UPDATE refused on entry id=%. The ledger is corrected by recording a NEW entry, never by rewriting an old one.',
    OLD."id";
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "pax_trust_ledger_no_update_trg" ON "pax_trust_ledger";
CREATE TRIGGER "pax_trust_ledger_no_update_trg"
  BEFORE UPDATE ON "pax_trust_ledger"
  FOR EACH ROW EXECUTE FUNCTION "pax_trust_ledger_refuse_update"();
