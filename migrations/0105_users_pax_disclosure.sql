-- ============================================================================
-- 0105_users_pax_disclosure.sql — Pax first-interaction disclosure consent.
-- ============================================================================
--
-- Phase Zero-Three gating remediation (Beatrice audit 2026-06-01).
--
-- The prior gate was a localStorage key (`pax_greeting_dismissed`) that
-- suppressed the welcome banner on subsequent visits. localStorage is not
-- auditable. Constitution §7 ("disclose AI use clearly at first interaction")
-- + CO SB 24-205 §6-1-1703 (evidentiary trail of consumer disclosure) both
-- require an auditable server-side record.
--
-- This column captures the moment the customer acknowledged the AI-disclosure
-- prompt on the /pax surface. Set once via
--   POST /api/pax/acknowledge-disclosure
-- which is idempotent: re-posting after the column is non-null is a no-op
-- and returns the existing payload. Null until acknowledged.
--
-- The onboarding-entry disclosure (users.ai_disclosed_at) is a separate
-- consent surface; both rows can be queried independently for evidentiary
-- value (the user was disclosed-to at sign-up AND at first Pax visit).
-- ============================================================================

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "pax_disclosure_acknowledged_at" timestamp;
