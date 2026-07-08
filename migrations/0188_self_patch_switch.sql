-- 0188 — Self-patch master switch (founder UX).
-- Moves the immune system's motor switch from a Fly secret (SELF_PATCH_ENABLED)
-- to the same DB-backed pattern as dispatch/publish/cognition: null → env
-- fallback (OFF), flipped from the Control Center. Additive + idempotent.
ALTER TABLE "autopilot_settings"
  ADD COLUMN IF NOT EXISTS "self_patch_enabled" boolean;
