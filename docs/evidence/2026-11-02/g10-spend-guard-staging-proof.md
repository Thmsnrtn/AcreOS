# G10 spend-guard fix — post-merge staging proof (2026-11-02)

Verdict: NOT PROVEN LIVE. The staging demonstration, the k6 burst re-run,
and the G10 adversarial re-run against staging were all blocked before any
authenticated AI request could be made. Nothing below claims a live 429 or
503 was observed. Read-only against production throughout; staging
(https://acreos-staging.fly.dev/) was the only target. No code was changed
in this assignment, per its terms.

## Baseline

- Main at the time of this attempt: `6defa32a1c5a5ce7fd7773b5c9ecf6769d7d1ca2`
  (includes PR #430, merged as `e615d14b`, and PR #437).
- Staging deployment: a deployment comment on PR #437 records commit
  `6defa32` deployed to `acreos-staging.fly.dev`, i.e. staging runs current
  main, including the #430 fix.
- Spec (PR #430 and `docs/evidence/2026-10-30/g10-spend-guard-fix-gates.md`):
  - Shared AI concurrency cap of 5 per org (`server/services/aiConcurrency.ts`,
    `AI_ORG_CONCURRENCY_CAP = 5`); the 6th concurrent task is refused with
    `AIConcurrencyExceeded`, HTTP 429, code `AI_CONCURRENCY_EXCEEDED`,
    `retryAfterSeconds`, and the terminal handler emits `Retry-After: 2`.
  - One counter shared by `routeAITask` (`server/services/aiRouter.ts`) and
    the `aiSpendGuard` raw/provider path, covering background jobs and BYOK;
    org-less callers are not bounded; slots are freed on success and on throw
    (`finally`); counting is per-instance (in-process Map).
  - Quota: `AIQuotaUnavailable`, HTTP 503, code `AI_QUOTA_UNAVAILABLE`,
    `retryAfterSeconds = 30`, thrown when metering (the quota read) is
    unavailable; the message must contain no SQL / database internals.
  - Ceiling gate (`aiCostCeiling`): customer calls fail OPEN (allowed, with
    tier-default fallback $2/day, $20/month) when ceiling config is
    unreadable; autonomous/background calls fail CLOSED at the 70% bucket.
- Pre-merge gates recorded in the #430 evidence file (not re-run here —
  this session has no terminal): `npm run check` exit 0, `npm run build`
  exit 0, focused tests 7 files / 66 tests exit 0, full `npm test` 1,551 files
  passed / 37 skipped with 19,321 tests passed / 187 skipped / 0 failed, G10
  tests alone 2 files / 10 tests exit 0. Falsification recorded there:
  reverting ceiling+quota turned 3 of 5 fail-open tests red; moving slot
  release out of `finally` turned the "slots free on throw" test red.

## 1. Staging demo — NOT RUN (blocked at sign-in)

Attempts, 2026-11-02 (all times UTC; EST = UTC-5):

- `GET /api/health` on staging: 13:50 UTC overall "degraded" with the
  database check unhealthy; 13:57:14 UTC still "degraded" with no checks
  object; fresh check 14:00:35 UTC still
  `{"overall":"degraded","timestamp":"2026-11-02T14:00:35.416Z","version":"1.0.0"}`
  with no checks object. Staging was never observed healthy during this run.
- Unauthenticated staging root shows only the public landing page
  ("Sign in" / "Start free"); app routes require Clerk sign-in at `/auth`.
- `/auth` renders only a branding shell: heading "Sign in to AcreOS",
  the AcreOS logo, tagline "The operating system for property investors",
  the note "Encrypted in transit and at rest. Auth is handled by Clerk;
  we never see your password.", plus "How we protect your data" and
  "Back to home". There are no email/password fields, no social sign-in
  buttons, no CAPTCHA, and no error message — verified by the planner
  directly (reload, 60-second waits, scrolling below the fold, navigating
  to `/today`, which redirected back to `/auth`) and by two independent
  login-agent attempts (13:54–13:59 UTC and 14:00–14:01 UTC), both
  blocked. A bot-challenge attempt also found the same blank widget and
  triggered a browser environment replacement; the widget was still blank
  on the replacement tab. Whether a saved staging login exists could not
  be tested because no form ever appeared. No account was created and no
  settings, data, or subscriptions were changed.
- Consequence: no authenticated session existed, so no AI path on staging
  could be exercised. The cap demo (6 concurrent AI tasks for one org,
  expecting the 6th to return 429 `AI_CONCURRENCY_EXCEEDED` with
  `Retry-After: 2`) and the quota demo (metering unavailable, expecting
  503 `AI_QUOTA_UNAVAILABLE` with no SQL in the message) were NOT
  demonstrated live. A live metering outage also cannot be induced from
  the UI in any case; it would need a staged backend fault.

## 2. k6 burst re-run — NOT RUN (no runner, no auth)

- Scenario identified from the repo: `tests/load/k6-baseline.js` defines
  smoke (5 VUs, 30s), load (ramp to 50 VUs over 2 min, hold 3 min), and
  spike (sudden 100 VUs for 30s), with AI-endpoint SLOs of p95 < 2000ms
  and error rate < 1%. Related scenarios: `tests/load/k6-chaos.js`
  (rate limits, thundering-herd recovery) and `tests/load/k6-multi-tenant.js`
  (org isolation, noisy-neighbor protection). The original G10 failure mode
  was unbounded concurrency/spend: no per-org cap, so a burst could fan out
  AI work without bound.
- Why it could not run here: this session is browser-only — no terminal
  and no `k6` binary — and the scripts require an auth cookie obtained by
  logging in (`tests/load/README.md`), which is unobtainable while the
  staging sign-in form does not render. Staging was also degraded
  (see §1), so any numbers obtained would not have been a clean baseline.
- Comparison note for the eventual re-run: post-#430, 429 responses under
  a burst are the guard working, not failures, so the pre-fix error-rate
  SLO (< 1%) must be re-read with 429s counted separately — a burst that
  yields 429s past 5 concurrent tasks per org and no unbounded spend is
  the passing shape, not a regression.

## 3. G10 adversarial re-run — NOT RUN live (same sign-in block)

The adversarial cases are the ones encoded in the #430 acceptance tests
(`tests/unit/aiCostCeilingFailOpen.test.ts`, real pg pool at a dead
address `postgres://127.0.0.1:1/g10dead`, and
`tests/unit/aiConcurrencyCap.test.ts`, provider stubbed with a held
promise, no spend):

- Cap trips at 5; the 6th concurrent task for the same org is refused
  with 429; a different org is unaffected.
- Shared counter: 3 tasks via `routeAITask` + 2 via the `aiSpendGuard`
  raw path = 5, then the 6th is refused on either path.
- Org-less callers are not bounded (by design, not a bypass — the bound
  is per org).
- Slots are freed on throw, so a failed task cannot leak capacity.
- BYOK and background-job paths go through the same counter.
- Quota read unavailable → 503 `AI_QUOTA_UNAVAILABLE`, message free of
  SQL/database internals; ceiling unreadable → customer calls allowed
  (fail open), background calls refused at the 70% bucket (fail closed).

None of these could be exercised against live staging without a session.
Their code-level proof remains the #430 gates file and its falsification
results quoted above; they were not re-executed in this session.

## What would unblock this proof

1. Fix the staging `/auth` Clerk widget so a sign-in form renders (or
   supply a working hosted Clerk sign-in route), and restore staging
   health out of "degraded".
2. With a signed-in staging session, run: (a) 6 concurrent AI tasks for
   one org and record the 6th response (expect 429
   `AI_CONCURRENCY_EXCEEDED`, `Retry-After: 2`); (b) the quota-outage
   path (expect 503 `AI_QUOTA_UNAVAILABLE`, no SQL in the message);
   (c) `k6 run tests/load/k6-baseline.js` spike scenario against
   staging with 429-aware metrics; (d) the adversarial cases in §3
   against the live app (shared counter across paths, other-org
   isolation, slot release after failure).
3. Record the observed statuses, headers, and counts here; until then,
   the post-merge live proof of PR #430 is outstanding, not established.
## Update — 2026-11-02, second attempt (5:15–5:17 PM EST / 22:15–22:17 UTC): sign-in moved forward, then blocked at the app session

- Clerk state verified first: DEVELOPMENT instance ins_3B29OsfrVfYjJYj3eAfSEvJoJgM; the Google social connection is "Used for sign-in" with shared credentials, and Apple is also listed. No Clerk change was needed, and production ins_3BcnsUIibMuH1u61VGSR6vqjm7f was not touched.
- The widget now renders: https://staging.acreos.io/auth shows Google and Apple buttons plus the Email address field and Continue button, in Development mode.
- Google OAuth itself completed twice: the account Thomas Norton (thmsnrtn@gmail.com) was chosen and consent to "AcreOS" was confirmed. Each time the browser reached /today briefly, then returned to /auth with no error shown; direct navigation to /today also redirected to /auth.
- The Clerk dashboard corroborates the Clerk side: the dev user Thomas Norton (user_3Ba6NjSNJVqy91wtxb9pCUBPLNC, thmsnrtn@gmail.com, Google linked, user since March 28, 2026) shows "Last signed in November 2, 2026" and an active Chrome device "today at 5:14 PM". The failure is therefore downstream of Clerk: the staging app does not retain an authenticated session after a completed OAuth callback.
- Staging health is unchanged and still degraded: https://staging.acreos.io/api/health returned {"overall":"degraded","timestamp":"2026-11-02T22:15:35.827Z","version":"1.0.0"}, and the Fly origin https://acreos-staging.fly.dev/api/health returned the same degraded result at 22:15:55 UTC, so this is not a custom-domain-only issue.
- Per-leg verdicts, unchanged: (a) demo — NOT RUN; (b) k6 burst re-run — NOT RUN; (c) G10 adversarial re-run — NOT RUN. With no authenticated session, no live AI concurrency, quota, k6, or adversarial observation was possible in this session, and no #430 code was changed.
- What unblocks it now: investigate why the staging app redirects an authenticated Clerk user from /today to /auth (app session handling and user/org lookup against the degraded staging backend), rather than re-running the same Google flow.
