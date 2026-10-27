-- 0292 — V-Notes-1 N1: per-field observations for acquired notes, and the
-- first-class yield fields (founder-approved +1 table, 2026-10-27).
--
-- acquired_notes gains the yield fields a note tape states and Napier's maths
-- needs: balloon amount, balloon date, remaining term. NULLABLE on purpose —
-- missing is null, never 0, and never derived.
ALTER TABLE "acquired_notes" ADD COLUMN IF NOT EXISTS "balloon_amount_cents" bigint;
ALTER TABLE "acquired_notes" ADD COLUMN IF NOT EXISTS "balloon_date" date;
ALTER TABLE "acquired_notes" ADD COLUMN IF NOT EXISTS "remaining_term_months" integer;

-- note_field_observations: every value any source ever stated for a note
-- field, with its provenance (source, the file row and cell it came from,
-- as-of, confidence, decay) — and the recorded ABSENCES: kind
-- 'searched_none' is a search that ran and found nothing (a verified
-- absence with its own provenance), distinct from a field with no row at all
-- (never searched = unknown). Nothing here is ever resolved, averaged or
-- overwritten: a later import that disagrees adds a row beside the earlier
-- one (N4 surfaces both).
--
-- ORG-PRIVATE: customer-contributed data. organization_id NOT NULL; every
-- reader filters on it. No FK to organizations (rows leave with their note).
--
-- APPEND-ONLY: UPDATE and TRUNCATE are refused outright. A DELETE is allowed
-- only when the note itself is gone — i.e. inside the ON DELETE CASCADE from
-- acquired_notes, which is how a note or an organization is erased. A direct
-- DELETE while the note exists is refused with foreign_key_violation (an
-- observation depends on its note), which is also what lets
-- deleteOrganization's FK-ordered multi-pass sweep remove these rows through
-- the note cascade instead of stopping on them.
CREATE TABLE IF NOT EXISTS "note_field_observations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL,
  "note_id" uuid NOT NULL REFERENCES "acquired_notes"("id") ON DELETE CASCADE,
  "field" text NOT NULL CHECK ("field" ~ '^[a-zA-Z][a-zA-Z0-9_.]*$'),
  "kind" text NOT NULL CHECK ("kind" IN ('value', 'searched_none')),
  "value" jsonb,
  "source" text NOT NULL CHECK ("source" IN ('note_tape', 'operator_correction', 'warehouse')),
  "source_ref" jsonb NOT NULL,
  "as_of" date,
  "confidence" text NOT NULL CHECK ("confidence" IN ('high', 'medium', 'low')),
  "confidence_basis" text NOT NULL CHECK (length(trim("confidence_basis")) > 0),
  "decay_class" text NOT NULL CHECK ("decay_class" IN ('stable', 'years', 'about_a_year', 'months', 'continuous', 'event')),
  "import_id" uuid,
  "recorded_by" text NOT NULL CHECK (length(trim("recorded_by")) > 0),
  "observed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "note_field_observations_value_iff_kind" CHECK (("kind" = 'value') = ("value" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS "note_field_observations_org_note_idx" ON "note_field_observations" ("organization_id", "note_id", "field", "observed_at");

CREATE OR REPLACE FUNCTION note_field_observations_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "acquired_notes" WHERE "id" = OLD."note_id") THEN
      RAISE EXCEPTION 'note_field_observations rows leave only with their note (delete the note, not its history)'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'note_field_observations is append-only (% denied)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS note_field_observations_no_update ON "note_field_observations";
CREATE TRIGGER note_field_observations_no_update BEFORE UPDATE ON "note_field_observations"
  FOR EACH ROW EXECUTE FUNCTION note_field_observations_guard();
DROP TRIGGER IF EXISTS note_field_observations_delete_with_note ON "note_field_observations";
CREATE TRIGGER note_field_observations_delete_with_note BEFORE DELETE ON "note_field_observations"
  FOR EACH ROW EXECUTE FUNCTION note_field_observations_guard();
DROP TRIGGER IF EXISTS note_field_observations_no_truncate ON "note_field_observations";
CREATE TRIGGER note_field_observations_no_truncate BEFORE TRUNCATE ON "note_field_observations"
  FOR EACH STATEMENT EXECUTE FUNCTION note_field_observations_guard();
