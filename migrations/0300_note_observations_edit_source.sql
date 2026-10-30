-- 0300 — G11 fidelity fix: PATCH /api/notes/:id writes a provenance observation.
--
-- note_field_observations.source gains 'edit': a value an operator changed on
-- the note after import. Before this, an edit changed acquired_notes and left
-- the provenance ledger showing the pre-edit value (the import-time row). The
-- ledger stays append-only (UPDATE/TRUNCATE refused by trigger); an edit adds
-- a row beside the earlier one. No table is added; only the CHECK is widened.
DO $mig0300$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'note_field_observations'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%''edit''%'
  ) THEN
    ALTER TABLE "note_field_observations" DROP CONSTRAINT IF EXISTS "note_field_observations_source_check";
    ALTER TABLE "note_field_observations" ADD CONSTRAINT "note_field_observations_source_check"
      CHECK ("source" IN ('note_tape', 'operator_correction', 'warehouse', 'edit'));
  END IF;
END
$mig0300$;
