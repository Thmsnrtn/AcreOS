# PaxContextStep wizard-integration patch

This document is the **exact patch** to wire `PaxContextStep` into
`OnboardingWizard.tsx`. Deferred from Wave D1 because the wizard has
substantial state machinery and at end-of-session the bug-risk on
renumbering all step IDs is too high to justify shipping unchecked.

The endpoint + route already shipped (`server/routes-pax-context.ts` +
registration in `server/routes.ts` — commit landing this session). The
component itself shipped in commit `c704ea44`. The only remaining work
is the wizard insertion + tests.

Estimated work: 1 focused session, ~1-2 hours including a manual
visual walkthrough on dev.

---

## The patch

### File: `client/src/components/onboarding/OnboardingWizard.tsx`

**1.** Add the import at the top:

```tsx
import { PaxContextStep } from "./PaxContextStep";
```

**2.** Insert the new step in `WIZARD_STEPS` (around line 200, between
`create_campaign` and `done`):

```tsx
{
  id: 4,
  name: "pax_personalization",
  title: "Make Pax Yours",
  description: "Quick context so Pax speaks your language",
  icon: Sparkles, // or pick a Pax-shaped icon
},
{
  // Renumber: was id 4, now id 5.
  id: 5,
  name: "done",
  title: "You're All Set!",
  description: "Your AcreOS workspace is ready to go",
  icon: PartyPopper,
},
```

**3.** Update the rendering switch — add a `case 4` for the new step
and renumber the previous `case 4` (done) to `case 5`:

```tsx
case 4:
  // Pax personalization — captures vertical / experience / goals / geo / name.
  return (
    <PaxContextStep
      onSubmit={(data) => {
        // POST /api/onboarding/pax-context — endpoint already shipped.
        fetch("/api/onboarding/pax-context", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(data),
        }).then(() => {
          handleNext();
        }).catch((err) => {
          clientLogger.warn("Pax context capture failed", err);
          // Non-blocking: continue onboarding even if capture fails
          // (Pax falls open to the default appendix).
          handleNext();
        });
      }}
      onSkip={() => handleNext()}
    />
  );

case 5:
  // Was case 4 (done) — renumber.
  // ... existing done case body, unchanged ...
```

**4.** Update the `isLastStep` reference + the skip-set logic to reflect
new step count (`WIZARD_STEPS.length` now 6, not 5).

**5.** Update the success-redirect logic at `currentStep === 0` (line ~401)
and `currentStep === 4` (line ~536) — verify these step-id checks still
make sense after the insertion.

---

## Tests to add

Add `client/src/components/onboarding/OnboardingWizard.test.tsx`:

- Step 4 renders `PaxContextStep`.
- Submitting step 4 advances to step 5.
- Skip on step 4 also advances + does NOT call the endpoint.
- Failed POST does NOT block advancement (graceful degradation).

---

## Manual verification

After deploy:
1. Sign in as a fresh user.
2. Walk the full onboarding wizard — verify the Pax personalization
   step appears between "Create campaign" and "You're all set."
3. Submit with vertical=land_investing + intermediate + cash_flow +
   Texas Hill Country + "Sam".
4. After landing on `/today`, open Pax and send: "Tell me what you know
   about my situation."
5. Verify the response references Texas Hill Country OR land investing
   OR cash flow.
6. Open Settings (when that surface exists for the opt-out toggle —
   another small follow-up) and toggle opt-out. Send another Pax
   message; verify the response is now the generic land_investing
   default with no Texas/cash-flow specificity.

---

## Why this is deferred to a focused session

The wizard's state machine has interactions across:
- `WIZARD_STEPS` array length affects progress-bar rendering.
- `currentStep` numeric comparisons in 3-5 places (search for
  `currentStep === N`).
- Skip-set logic (`skipSet.has(nextStep)`) interacts with the
  step ID renumbering.
- localStorage persistence may store the current step ID — risk of
  resuming users landing on stale step numbers.

Each is small individually but the bug-risk of doing the renumber at
the very end of a 12-hour build session is too high. Doing it fresh
with 1-2 hours of focused attention + a manual walk-through is the
right scope.

The Pax-personalization itself works perfectly today via the
`buildUserScopedPromptAppendix` integration in
`server/services/pax/userContext.ts`; it just needs the onboarding
capture point wired so users have data in the table.

---

## Until this lands

Pax still works for every user. They just get the **default
land_investing appendix** (since `loadUserContext` returns null for
users without a row, and `buildUserScopedPromptAppendix` falls open
to the default).

The fallback is the second-best experience, not a broken one.
Production-ready embeddings + the persona system give every user
materially better Pax responses than the pre-D1 baseline even without
the per-user personalization capture.
