-- 0302 — Notes V2 Leg 1: the delinquency ladder is recorded on the note_events
-- spine (no new table).
--
-- note_events gains category 'delinquency' with two event types, each bound to
-- exactly one source, both ways:
--   'delinquency_stage_entered'  source 'aging_engine'      — COMPUTED by the
--        daily aging sweep from the schedule service's days past due; detail
--        carries the full input snapshot. Written once per stage entry.
--   'default_review_recorded'    source 'operator_recorded' — an OPERATOR act,
--        with the actor in recorded_by. No aging run ever writes it (founder
--        decision 2026-11-05, ruling 1).
--
-- This restates 0301 (category 'analysis', type 'workout_analysis_run', source
-- 'workout_engine') because it redefines the same constraints; it must apply
-- after 0301. Only CHECK constraints change. The append-only triggers are
-- untouched, and every earlier shape validates exactly as before. Nothing
-- alerts, schedules, sends or moves money from these rows.
DO $mig0302$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'note_events'::regclass
      AND conname = 'note_events_source_matches_category'
      AND pg_get_constraintdef(oid) LIKE '%aging_engine%'
  ) THEN
    ALTER TABLE "note_events" DROP CONSTRAINT IF EXISTS "note_events_category_check";
    ALTER TABLE "note_events" ADD CONSTRAINT "note_events_category_check"
      CHECK ("category" IN ('outcome', 'calendar', 'analysis', 'delinquency'));
    ALTER TABLE "note_events" DROP CONSTRAINT IF EXISTS "note_events_source_check";
    ALTER TABLE "note_events" ADD CONSTRAINT "note_events_source_check"
      CHECK ("source" IN ('note_tape', 'operator_correction', 'workout_engine', 'aging_engine', 'operator_recorded'));
    ALTER TABLE "note_events" DROP CONSTRAINT IF EXISTS "note_events_type_matches_category";
    ALTER TABLE "note_events" ADD CONSTRAINT "note_events_type_matches_category" CHECK (
      ("category" = 'outcome' AND "event_type" IN ('performance_reported'))
      OR ("category" = 'calendar' AND "event_type" IN ('payment_due', 'maturity', 'balloon', 'rate_adjustment'))
      OR ("category" = 'analysis' AND "event_type" IN ('workout_analysis_run'))
      OR ("category" = 'delinquency' AND "event_type" IN ('delinquency_stage_entered', 'default_review_recorded'))
    );
    ALTER TABLE "note_events" DROP CONSTRAINT IF EXISTS "note_events_source_matches_category";
    ALTER TABLE "note_events" ADD CONSTRAINT "note_events_source_matches_category" CHECK (
      (("category" = 'analysis') = ("source" = 'workout_engine'))
      AND (("event_type" = 'delinquency_stage_entered') = ("source" = 'aging_engine'))
      AND (("event_type" = 'default_review_recorded') = ("source" = 'operator_recorded'))
    );
  END IF;
END
$mig0302$;
