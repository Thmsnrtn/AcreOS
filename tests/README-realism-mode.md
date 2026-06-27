# Realism mode — running the launch audit for real

The local suites (`README-launch-audit.md`) verify what's runnable in a sandbox:
shell/gating, **cross-tenant isolation (reads + writes)**, **JTBD outcomes on
Chromium AND real WebKit/Safari**, and **load/concurrency/volume**. What they
CANNOT verify locally is the product's actual value paths, because those run
through integrations that were off, and real auth/devices that a sandbox can't
fabricate. This is the runbook to close that gap on **staging**.

> Keystone principle (the red team's #1 fix): **never certify launch-readiness
> with the product's value paths disabled.** Realism mode turns them on and
> inverts the scoring so a 5xx from a *configured* integration is a HARD finding.

## What runs locally today (already done, green)

| Layer | Command | Status |
|---|---|---|
| Shell + persona gating | `npx playwright test --project=customer-personas` | ✅ |
| IDOR reads + writes (8 crown-jewel types, + survival check) | `npx tsx tests/security/idorFuzz.ts` | ✅ no breach |
| JTBD outcomes (Chromium) | `npx playwright test --project=jtbd` | ✅ 3/3 |
| JTBD outcomes (real WebKit/Safari) | `npx playwright test --project=jtbd-webkit` | ✅ 3/3 |
| Load / concurrency / volume | `VOLUME=5000 CONCURRENCY=40 npx tsx tests/perf/loadConcurrency.ts` | ✅ held up |

## Realism mode — needs a staging app (`acreos` staging — a pinned 🔑 item)

### 1. Stand up staging with REAL test-mode keys (the unlock)
Set these on the staging Fly app (test/sandbox modes — no real money/postage/SMS):
```
STRIPE_SECRET_KEY=sk_test_…           STRIPE_PUBLISHABLE_KEY=pk_test_…
REGRID_API_KEY=<dev/sandbox>          LOB_API_KEY=test_…    (prints to dashboard)
TWILIO_ACCOUNT_SID/_AUTH_TOKEN=<test> AWS_SES_… (sandbox)
AI_INTEGRATIONS_OPENROUTER_API_KEY=<cheap model key>
# leave background jobs ON (don't set DISABLE_BACKGROUND_JOBS)
```

### 2. Run the suites against staging with inverted scoring
```
REALISM=1 PLAYWRIGHT_BASE_URL=https://<staging-url> npx playwright test --project=customer-personas
```
With `REALISM=1` the harness treats a 5xx from a configured core integration as
**hard** (see customer-personas.spec.ts) — so the audit can finally FAIL on a
broken parcel lookup / payment / Pax call instead of calling it "honestly off".
Add positive assertions per door (already scaffolded by the JTBD pattern): each
core door must return 2xx **and render real data** (a parcel polygon, a Stripe
product, a Pax token stream, a Lob mail proof).

### 3. Real auth funnel (highest first-user drop-off — not testable locally)
Stand up a Clerk **test/dev instance**; drive the real UI: signup → verification
email (assert it lands via the SES sandbox) → login → password-reset →
session-expiry/refresh, for ≥1 persona per device class. The local test-auth
cookie is fine for the deep walks; this proves the front door every real user
must pass first.

### 4. Real devices (the iOS double-tap class — needs a device cloud)
Point the `jtbd-webkit` / persona projects at **BrowserStack or Sauce Labs real
iOS Safari + Android Chrome**:
```
# add to playwright.config.ts a project with:
#   use: { connectOptions: { wsEndpoint: `wss://cdp.browserstack.com/playwright?caps=…` } }
# secrets: BROWSERSTACK_USERNAME / BROWSERSTACK_ACCESS_KEY
```
Make the iOS double-tap a regression test on real WebKit hardware. Local WebKit
(Playwright's bundled engine) is the closest proxy and already runs green; a real
device confirms touch-gesture behavior the engine can't fully model. (Note: local
WebKit over plain HTTP drops `secure` cookies — staging is HTTPS, so this only
affects the local proxy; see jtbd-outcomes.spec.ts.)

### 5. Failure-injection / resilience (design — build against staging)
Don't turn providers OFF; put **commandable stubs** in front of them (a proxy or
a fault-flag env) that can: timeout, 500, slow-200, drop-after-side-effect.
Matrix = {Stripe, Lob, SES, Twilio, Regrid, AI} × {timeout, 5xx, slow, partial}
× {network-drop mid-POST, slow-DB via pg_sleep}. Assert: no orphaned state, no
double-charge on retry, idempotency keys honored, a real degraded-state UI (not a
white screen). This converts "graceful degradation" from an assumption into pass/fail.

### 6. AI safety/quality eval (design — needs an AI key)
A golden + adversarial prompt set for Pax, the deal-coach, and autopilot publish.
Assert: no hallucinated legal/investment claims, the `claimsGate`/fair-housing
rules reject violations, prompt-injection via a stored lead/note field is
neutralized, per-request cost is capped. Gate autopilot publishing on this eval.

### 7. Expand the IDOR tail
`idorFuzz.ts` covers 8 of ~89 customer org-scoped `:id` routes (it prints the
uncovered list). Add the remaining data-bearing types; consider a static lint
that flags any org-scoped `:id` handler not calling an org-scoped storage method.

## The honest launch gate
Ship only when, on staging with realism mode: every core door returns real data,
the real auth funnel completes, real-device Safari is clean, the failure matrix
degrades without data loss, and the AI eval passes — in addition to the local
green (isolation, JTBD, load) already achieved.
