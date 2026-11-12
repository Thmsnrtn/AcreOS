# CJ4 front-door evidence — #460 close-out (2026-11-09)

Run: customer-journey-audit **42741695577**, dispatched by
`workflow_dispatch` against main
**311c74221381ee9cd0e5f7dc06a0e5992b19c7e1** (the PR #534 squash — the
CJ4 spec auth fix). Overall conclusion: **SUCCESS**.

Staging was verified serving that exact build before the run, three
ways: staging.yml run 42736591973 for head 311c7422 completed SUCCESS
(deploy, then the chained reconcile and census on the new image); the
Fly Machines API showed every acreos-staging machine on image
`deployment-01M71K3ADNWJK3NS21K3G0EHS0` with image label
`GH_SHA = 311c74221381ee9cd0e5f7dc06a0e5992b19c7e1`; the served client
bundle is byte-identical to the prior build, as expected — #534 changed
only a test file.

## CJ4 results — `tests/e2e-customer-journey/front-door-evidence.spec.ts`

- **desktop-macbook-1440-light — CLEAN PASS.** One attempt (19,648 ms),
  zero retries. The full leg ran: authenticated needs-onboarding probe
  → wizard path → /today title → pinned FirstValueCta → note-tape
  import → /ai first sight.
- **mobile-iphone-12-light — FLAKY PASS. This is not a clean pass.**
  Attempt 1 FAILED (7,605 ms); retry #1 PASSED the complete flow
  (19,462 ms). Attempt-1 error, verbatim:

  > `page.goto: Navigation to "https://acreos-staging.fly.dev/today" is interrupted by another navigation to "https://acreos-staging.fly.dev/money"` — `front-door-evidence.spec.ts:144`, the `page.goto("/today")` opening the pinned-CTA step.

  The failure snapshot showed the app shell in "Loading AcreOS…"
  state — not the onboarding wizard, not a Clerk sign-in page.

Playwright verdict line for the run:
`tests_ran=20 (expected=19 unexpected=0 flaky=1 skipped=52)`;
"19 passed (6.7m)". CJ4 is skipped by design on the other 16 projects.
CJ1 (`signup-to-first-value.spec.ts`) passed clean on all 18 projects
with zero retries.

## The two diagnosed bugs did not recur

The pre-fix failures (runs 42714113512 and 42717201660) were traced to
two harness/spec bugs; the product behaved correctly throughout:

1. **Unauthenticated probe.** The spec probed
   `/api/me/needs-onboarding` via `page.request`, which does not pass
   through the context.route auth-header injection → 401 → the 401 body
   parsed as JSON, so `needsOnboarding` read falsy → the spec believed
   the persona was onboarded and never walked the wizard, while the
   (correct) OnboardingGate redirected every /today load and the static
   title never appeared. **Absent in this run** — no title wait-for
   timeout anywhere; both projects rendered /today in their passing
   attempts.
2. **WebKit service-worker bounce.** CJ4 did not block service workers
   (CJ1 did); on the second load the SW ate the token header →
   `/api/auth/user` 401 → ProtectedRoute bounced to the Clerk sign-in
   page. **Absent in this run** — the mobile session never bounced to
   /auth.

## New signature — under watch

The mobile attempt-1 failure is a **new, single-occurrence signature**:
a /today↔/money navigation race — the app navigated to /money while the
spec issued `goto /today`. It belongs to neither diagnosed class. The
immediate retry passed the complete flow. No fix is attempted in this
PR; the signature is under watch in the scheduled customer-journey
runs, and a recurrence is a new defect report, not noise.

## Screenshots filed here

From run 42741695577's artifact `customer-journey-audit-report`
(id 13730190499) — the Playwright attachments of the passing attempts
(the mobile set comes from retry #1). Each file's SHA-1 was verified
against the hash-named file inside the artifact's HTML report.

| File | Bytes | SHA-1 (prefix) |
|---|---|---|
| `evidence-today-fresh-note-investor--desktop-macbook-1440-light.png` | 365,081 | `5738d1485bd6…` |
| `evidence-today-fresh-note-investor--mobile-iphone-12-light.png` | 327,482 | `6702c993366c…` |
| `evidence-note-tape-import--desktop-macbook-1440-light.png` | 290,784 | `7f0a6f20d643…` |
| `evidence-note-tape-import--mobile-iphone-12-light.png` | 428,044 | `649e22005f55…` |
| `evidence-ai-first-sight--desktop-macbook-1440-light.png` | 341,235 | `dad49fb7b184…` |
| `evidence-ai-first-sight--mobile-iphone-12-light.png` | 361,247 | `d2f743232e52…` |

## What this does and does not establish

Establishes: the #534 spec fix works end-to-end against the staging
build of main 311c7422; CJ4 completes its full journey on both target
projects; the FirstValueCta leg for a fresh note investor is exercised
and passing for the first time; the three front-door evidence
screenshots #460's close-out requires now exist, for both projects.

Does not establish: CJ2/CJ3 behaviour (skipped in this workflow, by
design); anything about real-user (non-harness) sessions beyond what
the diagnosis already proved. The mobile leg is a flaky pass — this
note does not upgrade it to a clean one.
