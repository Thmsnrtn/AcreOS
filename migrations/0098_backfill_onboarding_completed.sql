-- Backfill organizations.onboarding_completed so the new W5-7
-- OnboardingGate stops force-redirecting legacy customers to
-- /onboarding-v2 on every page load.
--
-- Pre-W5-7, three different code paths recorded onboarding completion:
--   1. organizations.onboarding_completed (the new canonical column)
--   2. organizations.settings ->> 'onboardingCompleted'  (legacy)
--   3. organizations.onboarding_step > 0  (any progress)
--   4. organizations.onboarding_data ->> 'businessType' (step 0 done)
--
-- W5-7's gate only checks #1, so every org that completed via paths
-- 2-4 was being treated as un-onboarded. This migration flips #1 to
-- match the true state.
--
-- Idempotent: only updates rows where onboarding_completed = false
-- AND at least one legacy signal is present. Re-runs are no-ops.
-- Orgs that genuinely haven't started onboarding are left alone.

UPDATE organizations
SET onboarding_completed = true,
    updated_at = now()
WHERE onboarding_completed = false
  AND (
    onboarding_step > 0
    OR (settings ->> 'onboardingCompleted')::boolean = true
    OR onboarding_data ? 'businessType'
  );
