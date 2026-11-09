-- 0307 — Notes V2 Leg 3: note_origination_records, the append-only audit
-- record of the seller-finance counter and ATR activation gate for the
-- ORIGINATED book (the `notes` table).
--
-- PROVISIONAL — Tom-approval pending, stacked on PR #463 and disclosed in its
-- PR. The package's base design (§2.9) assumed no new table; Step 0 proved
-- note_events cannot carry originated-book records (its note_id FK is to
-- acquired_notes), so this table rides the §9.5 blocker as a provisional
-- request (docs/evidence/2026-11-09/notes-v2-leg3-step0.md §9.3, ruling R5).
--
-- WHAT CHANGES: one new table, its two indexes, its guard function and two
-- guard triggers. Five record kinds:
--   'origination_facts'          — the operator's stated origination facts
--   'rmlo_engagement'            — a stated RMLO engagement (completeness of
--                                  the stated fields only; never a licence
--                                  verification)
--   'activation_gate_passed'     — the gate's full input snapshot at activation
--   'threshold_release'          — a founder's recorded creditor-threshold
--                                  release, pointing at a dated decision
--   'atr_determination_written'  — an audit copy of an ATR determination write
-- Corrections are NEW rows that point at the row they supersede.
--
-- WHAT DOES NOT CHANGE: `notes` is untouched (no column, no CHECK, no status
-- trigger — R5 defers it). note_events and its triggers are untouched.
-- Nothing alerts, schedules, sends or moves money from these rows.
--
-- ORG-PRIVATE: organization_id NOT NULL with no FK to organizations (the
-- note_events posture); every reader filters on it.
--
-- RETENTION, NOT CASCADE: note_id is NULLABLE and ON DELETE SET NULL, a
-- deliberate deviation from note_events' CASCADE. §1026.25(c)(3) retention
-- and counter integrity: a hard-deleted activated note must still count, so
-- its records stay, attributable through the note_id_at_record snapshot.
--
-- APPEND-ONLY, on the 0293/0305 trigger pattern: UPDATE, DELETE and
-- TRUNCATE are refused. One UPDATE is not ours to refuse: ON DELETE SET NULL is carried out
-- by the FK machinery as an UPDATE of this table (the RI action trigger on
-- `notes` issues `UPDATE ... SET note_id = NULL`), and a BEFORE UPDATE row
-- trigger fires on it like on any other update. A guard that refused every
-- UPDATE would therefore make every referenced note undeletable. No precedent
-- exists here — 0293 and 0305 cascade, so their FK action is a DELETE, which
-- they admit only once the parent row is gone. The guard below is that same
-- rule transposed to SET NULL: it admits exactly one transition —
--   OLD.note_id IS NOT NULL, NEW.note_id IS NULL,
--   every other column unchanged (compared as the whole row minus note_id, so
--   a column added later is covered without editing this function), AND
--   the referenced note no longer exists
-- — and refuses everything else. The last clause is what makes it the FK
-- action and not an application write: an application cannot null the
-- pointer of a record whose note is still there. OLD/NEW are read only inside
-- the TG_OP = 'UPDATE' branch, never in the statement-level TRUNCATE firing.
-- DELETE has its own trigger on the same function: the FK action on this
-- table is SET NULL (an UPDATE), never a delete, so the delete guard blocks
-- only direct record deletes — §9.3's posture ("DELETE only via the org
-- cascade if one is added, otherwise never"). A future org-erasure path
-- must amend this migration deliberately; that friction is the point.
--
-- SHAPE: flat idempotent statements (IF NOT EXISTS / OR REPLACE / DROP IF
-- EXISTS), as 0293 and 0305 create their tables — not a DO block, which this
-- repo uses for conditional constraint rewrites (0301/0302).
CREATE TABLE IF NOT EXISTS "note_origination_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL,
  "note_id" integer REFERENCES "notes"("id") ON DELETE SET NULL,
  "note_id_at_record" integer NOT NULL,
  "kind" text NOT NULL CHECK ("kind" IN ('origination_facts', 'rmlo_engagement', 'activation_gate_passed', 'threshold_release', 'atr_determination_written')),
  "detail" jsonb NOT NULL,
  "supersedes_id" uuid REFERENCES "note_origination_records"("id"),
  "recorded_by" text NOT NULL CHECK (length(trim("recorded_by")) > 0),
  "recorded_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "note_origination_records_org_kind_idx" ON "note_origination_records" ("organization_id", "kind", "recorded_at");
CREATE INDEX IF NOT EXISTS "note_origination_records_org_note_idx" ON "note_origination_records" ("organization_id", "note_id");

CREATE OR REPLACE FUNCTION note_origination_records_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."note_id" IS NOT NULL
       AND NEW."note_id" IS NULL
       AND (to_jsonb(NEW) - 'note_id') = (to_jsonb(OLD) - 'note_id')
       AND NOT EXISTS (SELECT 1 FROM "notes" WHERE "id" = OLD."note_id") THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'note_origination_records is append-only (% denied; a correction is a new row that supersedes)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS note_origination_records_no_update ON "note_origination_records";
CREATE TRIGGER note_origination_records_no_update BEFORE UPDATE ON "note_origination_records"
  FOR EACH ROW EXECUTE FUNCTION note_origination_records_guard();
DROP TRIGGER IF EXISTS note_origination_records_no_truncate ON "note_origination_records";
CREATE TRIGGER note_origination_records_no_truncate BEFORE TRUNCATE ON "note_origination_records"
  FOR EACH STATEMENT EXECUTE FUNCTION note_origination_records_guard();
DROP TRIGGER IF EXISTS note_origination_records_no_delete ON "note_origination_records";
CREATE TRIGGER note_origination_records_no_delete BEFORE DELETE ON "note_origination_records"
  FOR EACH ROW EXECUTE FUNCTION note_origination_records_guard();
