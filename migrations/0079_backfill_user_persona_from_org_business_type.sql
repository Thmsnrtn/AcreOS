-- Backfill users.persona from organizations.business_type for existing
-- accounts.
--
-- Onboarding now derives users.persona at step 0 (client +
-- server-side mirror in routes-onboarding.ts /complete) — but every
-- user who finished onboarding BEFORE that wiring landed has
-- persona='land_investor' (the column default) regardless of what
-- their org actually does. That left every wholesaler / fix-flipper /
-- tax-delinquent / note-investor / landlord persona-specific surface
-- silently inert for the entire customer base.
--
-- This one-shot UPDATE walks every user whose persona is still the
-- default and looks at their org's business_type (which onboarding
-- DID write correctly). The mapping mirrors `derivePersona()` in
-- client/src/components/onboarding/OnboardingWizard.tsx + the
-- server-side mirror.
--
-- Idempotent: re-running this only touches users with the default
-- persona AND a derivable org business_type. Users who explicitly set
-- their persona later (via PUT /api/me/persona) are skipped because
-- the WHERE persona = 'land_investor' guard.

-- Note: users.organization_id does NOT exist. The user→org relation
-- is `team_members(organization_id, user_id)`. A user may be on
-- multiple teams; we take their FIRST owner-role team (by joinedAt)
-- as the source of truth for persona derivation. Users with no
-- team_members row are left untouched.

UPDATE users
SET persona = sub.derived,
    updated_at = now()
FROM (
  SELECT DISTINCT ON (tm.user_id)
    tm.user_id AS user_id,
    CASE o.business_type
      WHEN 'note_investor'           THEN 'note_investor'
      WHEN 'residential_wholesaler'  THEN 'wholesaler'
      WHEN 'fix_and_flip'            THEN 'fix_flipper'
      WHEN 'buy_and_hold'            THEN 'landlord'
      WHEN 'short_term_rental'       THEN 'landlord'
      WHEN 'multifamily'             THEN 'landlord'
      WHEN 'mobile_home'             THEN 'landlord'
      WHEN 'subdivider'              THEN 'subdivider'
      WHEN 'developer'               THEN 'subdivider'
      WHEN 'tax_lien_deed'           THEN 'tax_delinquent'
      ELSE NULL
    END AS derived
  FROM team_members tm
  JOIN organizations o ON o.id = tm.organization_id
  WHERE tm.is_active = true
  ORDER BY tm.user_id,
           CASE WHEN tm.role = 'owner' THEN 0 ELSE 1 END,
           tm.joined_at NULLS LAST,
           tm.invited_at NULLS LAST
) AS sub
WHERE users.id = sub.user_id
  AND sub.derived IS NOT NULL
  AND users.persona = 'land_investor';
