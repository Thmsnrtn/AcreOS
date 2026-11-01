-- 0296 — V-Tax-1 T2b: the tax calendar (tax_events), where each certificate's
-- redemption deadline came from, and the quiet-title marketability exception;
-- auction_readiness_checklists retired (founder decision 2026-10-28: swap the
-- dead tax tables for purpose-built ones, table count unchanged).
--
-- tax_events: the forward calendar for tax positions — a redemption expiry,
-- a quiet-title filing — each with the RULE IT CITES (the procedure-object
-- field, the encoded preliminary state rule, or the county's own record the
-- operator entered). note_events (0293) cannot hold these: it requires an
-- acquired note. A later registration for the same certificate and type is a
-- NEW row; the reader takes the latest. APPEND-ONLY on the 0293 terms:
-- UPDATE/TRUNCATE refused; a DELETE allowed only inside the certificate's
-- ON DELETE CASCADE. Org-private.
CREATE TABLE IF NOT EXISTS "tax_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL,
  -- uuid, matching tax_certificates.id (uuid in the SQL, in production, and
  -- now in shared/schema; a db:push-built staging converges through
  -- CONVERGE_UUID_ID_FAMILIES in scripts/migrate.mjs before this runs).
  "certificate_id" uuid NOT NULL REFERENCES "tax_certificates"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL CHECK ("event_type" IN ('redemption_expiry', 'quiet_title_filed')),
  "event_date" date NOT NULL,
  "rule_cited" jsonb NOT NULL,
  "detail" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "recorded_by" text NOT NULL CHECK (length(trim("recorded_by")) > 0),
  "recorded_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "tax_events_org_cert_idx" ON "tax_events" ("organization_id", "certificate_id", "event_type", "recorded_at");
CREATE INDEX IF NOT EXISTS "tax_events_org_date_idx" ON "tax_events" ("organization_id", "event_date");

CREATE OR REPLACE FUNCTION tax_events_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "tax_certificates" WHERE "id" = OLD."certificate_id") THEN
      RAISE EXCEPTION 'tax_events rows leave only with their certificate (delete the certificate, not its history)'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'tax_events is append-only (% denied)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tax_events_no_update ON "tax_events";
CREATE TRIGGER tax_events_no_update BEFORE UPDATE ON "tax_events"
  FOR EACH ROW EXECUTE FUNCTION tax_events_guard();
DROP TRIGGER IF EXISTS tax_events_delete_with_certificate ON "tax_events";
CREATE TRIGGER tax_events_delete_with_certificate BEFORE DELETE ON "tax_events"
  FOR EACH ROW EXECUTE FUNCTION tax_events_guard();
DROP TRIGGER IF EXISTS tax_events_no_truncate ON "tax_events";
CREATE TRIGGER tax_events_no_truncate BEFORE TRUNCATE ON "tax_events"
  FOR EACH STATEMENT EXECUTE FUNCTION tax_events_guard();

-- Where a certificate's redemption deadline came from. NULL on rows created
-- before 0296 (unknown). The nightly refresh recomputes only a deadline AcreOS
-- computed — never one the operator entered from the county's records.
ALTER TABLE "tax_certificates" ADD COLUMN IF NOT EXISTS "deadline_source" text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_certificates_deadline_source_check') THEN
    ALTER TABLE "tax_certificates" ADD CONSTRAINT "tax_certificates_deadline_source_check"
      CHECK ("deadline_source" IS NULL OR "deadline_source" IN ('computed_preliminary', 'operator_entered'));
  END IF;
END;
$$;

-- An attorney-reviewed exception to the quiet-title marketability gate:
-- { attorneyName, reason, recordedAt, recordedBy }. Without it, a deed is
-- eligible to market in AcreOS only once its quiet-title petition is filed.
ALTER TABLE "quiet_title_cases" ADD COLUMN IF NOT EXISTS "market_exception" jsonb;

-- Retire auction_readiness_checklists: nothing in the repository reads or
-- writes it. GUARDED and ATOMIC, exactly as 0294/0295.
DO $$
DECLARE
  has_rows boolean;
BEGIN
  IF to_regclass('public.auction_readiness_checklists') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM "auction_readiness_checklists" LIMIT 1)' INTO has_rows;
  ELSE
    has_rows := false;
  END IF;
  IF has_rows THEN
    RAISE EXCEPTION 'auction_readiness_checklists holds rows; nothing is dropped (V-Tax-1 T2 retires it only when empty — escalate to the founder)';
  END IF;
  DROP TABLE IF EXISTS "auction_readiness_checklists";
END;
$$;
