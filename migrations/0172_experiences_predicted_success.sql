-- 0172 — calibrated foresight: record the predicted success probability per
-- autopilot action so the system can measure its own calibration (Brier score)
-- against realized outcomes. Additive + idempotent.
ALTER TABLE "autopilot_experiences" ADD COLUMN IF NOT EXISTS "predicted_success" numeric;
