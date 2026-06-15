-- 0164 — Persist voice-call outcome + intent on the call row
--
-- The POST /api/voice/calls/:id/outcome endpoint could only record the outcome
-- to agent_events, and GET .../summary returned null outcome/intent because the
-- voice_calls row had nowhere to store them. Add the columns so the outcome
-- lives on the call (and the summary surfaces it). Additive + idempotent.

ALTER TABLE "voice_calls" ADD COLUMN IF NOT EXISTS "outcome"       text;
ALTER TABLE "voice_calls" ADD COLUMN IF NOT EXISTS "outcome_notes" text;
ALTER TABLE "voice_calls" ADD COLUMN IF NOT EXISTS "intent"        text;
ALTER TABLE "voice_calls" ADD COLUMN IF NOT EXISTS "updated_at"    timestamp;
