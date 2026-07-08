-- 0182 — Cognition master switch.
-- The DB-backed switch (like dispatch/publish) that turns the autonomous daily
-- Operator cadence on. null → env COGNITION_ENABLED fallback (default OFF), so
-- the brain stays dormant until the founder flips it. Additive + idempotent.
ALTER TABLE "autopilot_settings"
  ADD COLUMN IF NOT EXISTS "cognition_enabled" boolean;
