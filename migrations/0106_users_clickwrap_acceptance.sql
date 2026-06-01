-- ============================================================================
-- 0106_users_clickwrap_acceptance.sql — ToS + Privacy clickwrap timestamps.
-- ============================================================================
--
-- Phase Zero-Three gating remediation (Beatrice audit 2026-06-01).
--
-- ToS / Privacy footer links existed; affirmative acceptance did not.
-- Without clickwrap, the limitation-of-liability + arbitration +
-- class-action waiver clauses in the ToS sit on softer ground than they
-- need to. Delaware courts respect browsewrap for commercial parties,
-- but the safer ground is clickwrap.
--
-- New auth-page.tsx gating: a required, default-unchecked checkbox above
-- the Clerk SignUp widget. Until the checkbox is checked, the widget is
-- not rendered (form-level gate, not visual disable — there is no form
-- to submit). The acceptance moment is planted into the client (the
-- consent timestamp), and the first hydrateUser request after sign-up
-- writes both columns onto the user row.
--
-- Why two columns instead of one: ToS and Privacy are separate documents
-- and may version independently. v1.1 may bump Privacy alone (e.g. for
-- an added subprocessor) without re-bumping ToS — separate columns let
-- us track per-document re-acceptance later. For v1.0 they are set
-- simultaneously.
--
-- Columns are nullable: existing pre-clickwrap users are grandfathered.
-- Every NEW user row created via server/auth/clerkAuth.ts is written
-- with non-null values; the server enforces the invariant going forward.
-- ============================================================================

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "tos_accepted_at" timestamp;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "privacy_accepted_at" timestamp;
