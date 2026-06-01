-- ============================================================================
-- 0104_users_ai_disclosure.sql — AI-disclosure consent capture.
-- ============================================================================
--
-- Constitution §7 requires AcreOS to "Always disclose AI use clearly to
-- every customer at first interaction." Colorado SB 24-205 (effective
-- Feb 1, 2026) independently mandates consumer disclosure before any
-- AI-driven output is rendered. Both rules require AUDITABLE consent —
-- a localStorage flag is not auditable.
--
-- This migration adds two columns to the users table:
--
--   ai_disclosed_at       — timestamp of the customer's first
--                           acknowledgement in AiDisclosureDialog.
--                           Null until the dialog is accepted.
--
--   ai_disclosure_version — the version string (e.g. "v1") of the
--                           disclosure wording in effect at the time
--                           of consent. When Beatrice updates the
--                           disclosure text, AI_DISCLOSURE_VERSION in
--                           AiDisclosureDialog.tsx is bumped; any user
--                           whose stored version differs from the
--                           current constant sees the dialog again and
--                           records a new consent. The prior row is
--                           preserved for evidentiary value.
--
-- Write semantics (server/routes-ai-disclosure.ts):
--   POST /api/me/ai-disclosure/accept is idempotent: it only writes
--   when ai_disclosed_at IS NULL (first-time) or when
--   ai_disclosure_version differs from the posted version (re-consent
--   after wording change). The GET /api/me/ai-disclosure/status
--   endpoint lets the client gate onboarding without a page reload.
-- ============================================================================

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "ai_disclosed_at" timestamp;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "ai_disclosure_version" varchar(32);
