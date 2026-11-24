# Leaving onboarding for Today lands on Today: browser-level proof

This follows up on the stop-condition finding in
`docs/evidence/2026-11-03/p0-front-door/README.md` (PR #460). The fix itself
is **PR #473** (merged 2026-11-08, `966d882b`), which changes
`OnboardingGate` and the server's completion ordering. Its proof is unit tests
(`onboardingGateStaleCache`, `onboardingWizardReleasesCompletedOrg`,
`onboardingCompleteFlipsBeforeSeeding`). This record adds the **browser-level**
proof: what a brand-new user's click actually does in a real WebKit and
Chromium.

## The defect, measured before #473 (main `0abcce7`)

Setup: a staging-shaped local build with a brand-new tenant per run. The probe
is `onboarding-exit-bounce-probe.cjs`; it records every `pushState` and
`replaceState` after the click.

| Exit | Phone | Desktop |
|---|---|---|
| "Go to Today instead" (final step) | `pushState /today` → `pushState /onboarding-v2`, ends on step 1 | same |
| "Skip" (header, every step) | `pushState /today` → `pushState /onboarding-v2`, ends on step 1 | same |

That is 4 of 4 bounced. **Skip bounced too**, so the wizard's always-available
skip never actually let a new user skip.

## The regression spec

`tests/e2e-mobile/onboarding-exit-lands-on-today.spec.ts` runs on iPhone 14
(WebKit) and Pixel 5 (Chromium), covering both exits. It never navigates after
the click. It asserts that the user:

- is on `/today` and Today's title is shown;
- is still there 2.5 seconds later, with no wizard;
- was never sent to `/onboarding…` by the app.

| Build | Result (`--retries=0`) |
|---|---|
| `0abcce7` (before #473) | **4 failed**: Today's title never appears, because the user was bounced |
| `6b8240f` (current main, with #473) | **4 passed** |

## Transitions

Leaving onboarding was the live source of a browser-skipped view transition
under `view-transitions.ts`: on `0abcce7`, 3 transitions started and 1 was
skipped (`@/today`). The measurement in `onboarding-exit-nav-after-fix.json`
was taken with an equivalent client-side cache fix applied locally, before
#473 landed:

- 2 transitions started, 0 skipped;
- 0 page errors.

The only remaining skipped transitions come from the probe's deliberate
back-to-back navigations 30ms apart, which a browser is supposed to skip.
