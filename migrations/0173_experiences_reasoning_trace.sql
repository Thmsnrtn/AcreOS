-- 0173 — glass-box: persist the full reasoning trace per autopilot action
-- (senses → options → forecast → gate → outcome + narrative). Additive + idempotent.
ALTER TABLE "autopilot_experiences" ADD COLUMN IF NOT EXISTS "reasoning_trace" jsonb;
