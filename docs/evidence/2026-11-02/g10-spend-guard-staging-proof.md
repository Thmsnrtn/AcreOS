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

## Update — 2026-11-02 evening EST (runs 2026-11-03 00:19–00:41 UTC): all three legs RUN live

Third attempt, by a terminal-capable agent, after Fix A landed (staging
release v67, `CLERK_JWT_KEY` = the dev instance's public PEM) and a browser
session confirmed the dev user's sign-in sticks on /today. Method: a driver
script ran **inside** the single started staging app machine
(`7815642c33e248`; the other app machine is stopped, so per-instance
counting is unambiguous). It minted 60-second session tokens from the dev
user's already-active Clerk session via the Clerk Backend API (the route
the session-bounce diagnosis used; token values never printed or logged)
and called the app on `127.0.0.1:5000` with the `__session` cookie, plus
the app's double-submit CSRF pair (primed from `GET /api/today`).

Setup created on the staging proof org (id 79, bootstrapped by the dev
user's first authenticated request): property 1015 (`G10-PROOF-001`,
Travis TX) via `POST /api/properties`, and a documented 2,000¢ credit
balance grant (see §2 note — the org's 500¢ trial Pax allowance was
consumed by this proof's own earlier calls).

Pre-flight, all live: `GET /api/auth/user` → 200 (Thomas Norton,
thmsnrtn@gmail.com); `GET /api/org/ai-quota` → 200, cap $50/day (the
`checkQuota` gate is armed: cap > 0); single `POST /api/realtime/ask`
(aiSpendGuard path, orgId passed) → 200 in ~1.0s with a real provider
reply; single `POST /api/properties/1015/analyze` (routeAITask path) →
200 in ~15.8s, and the quota read afterward showed the call metered
($0.0154, `property_analysis_chat`, 1 call). Staging health read
"degraded" throughout (the known redis-unconfigured steady state); the
app itself served every proof call.

### 1. Staging demo — RUN. Cap enforcement PASS; refusal contract FAIL. Quota refusal behaviour PASS; its contract FAIL.

**Concurrency cap (shared counter, aiSpendGuard surface).** Burst of 8
concurrent `POST /api/realtime/ask` for org 79: exactly **5 admitted**
(200, real provider replies, 1.4–2.1s) and **3 refused in 248–266ms** —
before any provider call. Repeat burst of 6: exactly **5 admitted**,
**1 refused in 96ms**. A single ask immediately after each burst → 200
(slots are released; the second burst admitting exactly 5 again shows no
slot leakage across successes or refusals). The bound itself works live,
at exactly the designed value of 5.

**But the refusals do not carry the designed contract.** Every refused
request returned **500 `INTERNAL_ERROR`** ("Something broke on our end…")
with no `Retry-After` header — not the spec's 429
`AI_CONCURRENCY_EXCEEDED` with `Retry-After: 2`. Cause, from the code at
main `40462db3`: `/api/realtime/ask` (and `/api/properties/:id/analyze`)
catch their errors and funnel them through `Errors.internal()`, which
special-cases `NO_AI_PROVIDER`, `AI_ALLOWANCE_BYOK_REQUIRED`,
`FOUNDER_ORG_UNRESOLVED` and a few others — but **not**
`AI_CONCURRENCY_EXCEEDED` or `AI_QUOTA_UNAVAILABLE` — so designed AI
refusals are flattened to a generic 500. The designed shape exists only
in `terminalErrorHandler`, which fires solely for errors a route lets
escape uncaught. Identification of the 500s as cap refusals rests on:
exactly-cap admission counts (5, twice), refusal latency ~0.1–0.27s vs
1.4–2.1s provider calls, and clean recovery after drain. (Server stdout
logs were not reachable from this session to quote the
`[aiConcurrency] … cap hit` warning directly.)

**Quota gate (503).** Staged backend fault, as this record's first
attempt anticipated: on staging only, `ai_usage_daily` was renamed aside
(`ALTER TABLE … RENAME`, ~15-second window) so the metering read fails,
and one analyze call was fired. It was **refused in 94ms** — before the
provider, no spend — versus ~16s for a normal analyze. The table was
renamed back immediately; quota state afterward was intact (4 analyze
calls, $0.0348 used) and a follow-up analyze returned 200 in 17.3s. The
client-visible shape was again **500 `INTERNAL_ERROR`**, not the designed
503 `AI_QUOTA_UNAVAILABLE` with `Retry-After: 30` — same flattening, same
root cause. The spec's "message must contain no SQL / database
internals" holds trivially: the production 500 copy is generic.

**Verdict (a): PARTIAL.** Enforcement of both guards is proven live on
staging — the spend bound and the metering-outage refusal both fire, at
the designed thresholds, with no spend on refusal. The designed HTTP
contract for those refusals (429/503 + `AI_*` code + `Retry-After`) is
**not** delivered on the exercised AI surfaces. That is a real defect
this proof surfaces, in `Errors.internal()`'s missing cases (any route
that funnels AI errors through it is affected). No code was changed in
this assignment; a fix package is the follow-up.

### 2. k6 burst re-run — RUN (real k6). PASS, with the comparison re-read as this record prescribed.

k6 v0.54.0 (official static binary) ran **inside** the staging machine
against `127.0.0.1:5000`, so the session token never left the machine.
The repo scenario (`tests/load/k6-baseline.js`, spike = sudden 100 VUs)
cannot be replayed verbatim against this surface: its raw request rate
trips the app's own rate limiters (per-IP floor 1,000/min; per-user
300/min) long before concurrency matters. Disclosure: the initial
unpaced attempts did exactly that — one measured ~37.5k requests at
~1,250/s, all 429 "Too many requests" — and a further attempt found the
proof org's
500¢ trial Pax allowance exhausted by this proof's earlier legs
(402 `PAX_CREDITS_REQUIRED`), which is why the 2,000¢ balance grant in
the setup above was made (a staging test-data top-up, documented here;
the exhaustion itself is the credit gate working).

The re-run therefore used the spike's shape at a paced rate the
limiters admit: **12 VUs, 40s, `POST /api/realtime/ask`, 2s sleep
between iterations** (synchronized opening volley = 12 concurrent
attempts against a cap of 5). Results: **167 requests; 114 admitted
(200); 53 refused fast (500, <600ms — the §1 cap signature); 0
rate-limited; 0 other errors; checks 100%.** Successful-call latency
avg 1.40s, p95 2.08s (the 2,000ms AI SLO is marginally exceeded at p95;
the load generator shared the single small staging box, which inflates
latency — noted, not hidden).

Comparison vs the original G10 failing baseline: pre-fix there was no
per-org bound, so a burst fanned out to as many concurrent provider
calls as clients could open (12 here, 100 in the repo spike) and spend
scaled with the burst. Post-fix, instantaneous per-org concurrency is
bounded at 5, excess work is refused in ~50–250ms instead of consuming
provider spend, and admitted work completes normally. 429s under burst
would be the guard working, per the first attempt's note — on this
surface they arrive as the §1 fast-500 shape instead, which is the
contract defect recorded there, not a guard failure.

**Verdict (b): PASS** — bounded fan-out and bounded spend under burst,
demonstrated with the repo's own tool; methodology deviations (pacing,
VU count, in-machine placement) disclosed above.

### 3. G10 adversarial re-run — RUN in part; each case stated plainly.

- **Shared counter across both metered paths — PASS, live.** Mixed
  burst: 3 concurrent analyzes (routeAITask path) with 4 asks
  (aiSpendGuard path) launched into their in-flight window. Result: 3
  analyzes 200 (11.5–12.5s), 2 asks 200, **2 asks refused in 68ms**.
  The asks alone (4 ≤ 5) could never trip a counter of their own; they
  were refused only because analyze-held slots count against the same
  budget. Two independent counters would have admitted all 7.
- **Cap trips at 5; the 6th is refused; slots freed on success and on
  refusal — PASS, live** (§1: bursts of 8 and 6 admitted exactly 5;
  post-burst singles 200; the second burst admitted exactly 5 again —
  no leakage).
- **Ceiling unreadable → customer calls fail OPEN — PASS, live.**
  Staged fault: `ai_telemetry_events` renamed aside (~10s window);
  a customer ask still returned 200 with a real reply in ~1.0s. Table
  restored; no other effect observed.
- **Ceiling unreadable → background calls fail CLOSED at the 70%
  bucket — NOT RUN live.** No on-demand background-origin AI trigger
  was available in this window (jobs run on their own schedules). Its
  proof remains the #430 unit gates (`aiCostCeilingFailOpen.test.ts`).
- **Quota read unavailable → 503 refusal — behaviour PASS, contract
  FAIL** (§1: refused pre-provider in 94ms, surfaced as 500 not 503).
- **Org-less callers not bounded — NOT RUN live.** The org-less surface
  is founder chat (`meteredChatCompletion` called with no orgId);
  6 concurrent `POST /api/founder/chat/stream` all returned 404 —
  `requireFounder` hides the route because the staging deployment does
  not recognise the dev user as a founder identity. Blocked by staging
  founder config, not by the guard. Unit proof stands.
- **Different org unaffected — NOT RUN live.** Only one dev user / org
  exists on the staging instance; creating a second tenant was out of
  this assignment's scope. Unit proof stands (the cap test's
  different-org case).
- **BYOK path through the same counter — NOT RUN live.** The proof org
  has no BYOK key configured; by construction the slot wraps
  `routeAITask`/`meteredChatCompletion` before the BYOK branch, and
  the unit gates cover it. Configuring a customer AI key on the
  staging org was out of scope.

**Verdict (c): PASS for the cases live-runnable from outside**
(shared counter, cap value, slot release, ceiling fail-open);
**NOT RUN** for background fail-closed, org-less, cross-org and BYOK,
each for the stated reason — none of them a contradiction of the code,
all of them still owed if a fully-live G10 re-proof is ever required.

### Overall

The post-merge live proof of PR #430 is now **established for
enforcement**: on production-shaped staging traffic, one org cannot
hold more than 5 concurrent AI tasks across either metered path,
metering outages refuse before spend, and ceiling outages fail open
for customers — exactly the G10 failure mode (unbounded concurrency /
spend) closed. **One defect is owed a fix**: designed AI refusals are
flattened to 500 `INTERNAL_ERROR` by `Errors.internal()` on routes
that catch their AI errors, so clients never see the 429/503 +
`AI_CONCURRENCY_EXCEEDED` / `AI_QUOTA_UNAVAILABLE` + `Retry-After`
contract the package designed and the terminal handler implements.
Left on staging as proof residue (all documented above): org 79 with
property 1015 and a 2,000¢ credit balance (partly consumed), the dev
user's bootstrapped `users` row, and this record. No production system
was touched; no app code was changed; both staged DB faults were
reverted within seconds and verified restored.
