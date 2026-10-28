-- 0293 — V-Notes-1 N3: outcome events and forward-calendar dates for acquired
-- notes (the second of the founder-approved +2 tables, 2026-10-27).
--
-- HOOKS ONLY. Rows are written by the note-tape import and read by the note
-- record. Nothing schedules, alerts, sends or starts a clock from them in V1 —
-- that is V-Notes-2, inside the consent rails.
--
--   category 'outcome'  — payment performance as a source reported it
--                         ('performance_reported': status, paid-through date,
--                         balance), kept for V-Notes-2's calibration. No model
--                         reads them yet.
--   category 'calendar' — a dated term a source stated: the next payment due
--                         (monthly on the due day, until maturity), maturity,
--                         balloon, the next rate adjustment. A date the source
--                         did not state is NOT registered — never derived.
--
-- A later registration for the same note and event type is a NEW row beside
-- the earlier one; the reader takes the latest. Nothing is overwritten.
--
-- ORG-PRIVATE and APPEND-ONLY on exactly the terms of note_field_observations
-- (0292): organization_id NOT NULL and filtered by every reader; UPDATE and
-- TRUNCATE refused; a DELETE allowed only inside the note's ON DELETE CASCADE,
-- so a note or an organization is still erasable.
CREATE TABLE IF NOT EXISTS "note_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL,
  "note_id" uuid NOT NULL REFERENCES "acquired_notes"("id") ON DELETE CASCADE,
  "category" text NOT NULL CHECK ("category" IN ('outcome', 'calendar')),
  "event_type" text NOT NULL,
  "event_date" date NOT NULL,
  "recurrence" text CHECK ("recurrence" IS NULL OR "recurrence" = 'monthly'),
  "recurrence_until" date,
  "detail" jsonb NOT NULL,
  "source" text NOT NULL CHECK ("source" IN ('note_tape', 'operator_correction')),
  "source_ref" jsonb NOT NULL,
  "import_id" uuid,
  "recorded_by" text NOT NULL CHECK (length(trim("recorded_by")) > 0),
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "note_events_type_matches_category" CHECK (
    ("category" = 'outcome' AND "event_type" IN ('performance_reported'))
    OR ("category" = 'calendar' AND "event_type" IN ('payment_due', 'maturity', 'balloon', 'rate_adjustment'))
  ),
  CONSTRAINT "note_events_recurrence_shape" CHECK (
    ("recurrence" IS NULL AND "recurrence_until" IS NULL)
    OR ("recurrence" IS NOT NULL AND "event_type" = 'payment_due' AND "recurrence_until" IS NOT NULL AND "recurrence_until" >= "event_date")
  )
);
CREATE INDEX IF NOT EXISTS "note_events_org_note_idx" ON "note_events" ("organization_id", "note_id", "category", "recorded_at");
CREATE INDEX IF NOT EXISTS "note_events_org_calendar_idx" ON "note_events" ("organization_id", "event_date") WHERE "category" = 'calendar';

CREATE OR REPLACE FUNCTION note_events_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "acquired_notes" WHERE "id" = OLD."note_id") THEN
      RAISE EXCEPTION 'note_events rows leave only with their note (delete the note, not its history)'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'note_events is append-only (% denied)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS note_events_no_update ON "note_events";
CREATE TRIGGER note_events_no_update BEFORE UPDATE ON "note_events"
  FOR EACH ROW EXECUTE FUNCTION note_events_guard();
DROP TRIGGER IF EXISTS note_events_delete_with_note ON "note_events";
CREATE TRIGGER note_events_delete_with_note BEFORE DELETE ON "note_events"
  FOR EACH ROW EXECUTE FUNCTION note_events_guard();
DROP TRIGGER IF EXISTS note_events_no_truncate ON "note_events";
CREATE TRIGGER note_events_no_truncate BEFORE TRUNCATE ON "note_events"
  FOR EACH STATEMENT EXECUTE FUNCTION note_events_guard();
