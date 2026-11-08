-- 0301 — Notes V2 Leg 2: a workout analysis run is recorded on the note_events
-- spine (no new table).
--
-- note_events gains a third category, 'analysis', holding exactly one event
-- type, 'workout_analysis_run': the full input snapshot, engine version and
-- line-item outputs of one workout NPV comparison (server/services/notes/
-- workoutAnalysis.ts, shared/notes/workoutEngine.ts). The row is COMPUTED, and
-- says so: its source is 'workout_engine', and that source is bound to that
-- category both ways — an analysis row cannot claim a tape or an operator as
-- its source, and a tape or operator row cannot be filed as analysis.
--
-- Only CHECK constraints are widened. The append-only triggers (no UPDATE, no
-- direct DELETE, no TRUNCATE) are untouched, and every V1 row validates
-- exactly as before: 'outcome' still admits only 'performance_reported',
-- 'calendar' only its four date types, and the V1 sources only those two
-- categories. Nothing alerts, schedules, sends or moves money from these rows.
DO $mig0301$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'note_events'::regclass
      AND conname = 'note_events_source_matches_category'
  ) THEN
    ALTER TABLE "note_events" DROP CONSTRAINT IF EXISTS "note_events_category_check";
    ALTER TABLE "note_events" ADD CONSTRAINT "note_events_category_check"
      CHECK ("category" IN ('outcome', 'calendar', 'analysis'));
    ALTER TABLE "note_events" DROP CONSTRAINT IF EXISTS "note_events_source_check";
    ALTER TABLE "note_events" ADD CONSTRAINT "note_events_source_check"
      CHECK ("source" IN ('note_tape', 'operator_correction', 'workout_engine'));
    ALTER TABLE "note_events" DROP CONSTRAINT IF EXISTS "note_events_type_matches_category";
    ALTER TABLE "note_events" ADD CONSTRAINT "note_events_type_matches_category" CHECK (
      ("category" = 'outcome' AND "event_type" IN ('performance_reported'))
      OR ("category" = 'calendar' AND "event_type" IN ('payment_due', 'maturity', 'balloon', 'rate_adjustment'))
      OR ("category" = 'analysis' AND "event_type" IN ('workout_analysis_run'))
    );
    ALTER TABLE "note_events" ADD CONSTRAINT "note_events_source_matches_category" CHECK (
      ("category" = 'analysis') = ("source" = 'workout_engine')
    );
  END IF;
END
$mig0301$;
