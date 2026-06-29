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

## One-time founder setup (flips the whole thing on)

The deploy half is built (`.github/workflows/staging.yml`, dormant) and the
audit half is built (`.github/workflows/realism-audit.yml`, dormant). To enable:

```bash
fly apps create acreos-staging                     # + a staging Postgres w/ pgvector
gh variable set FLY_STAGING_APP --body "acreos-staging"
fly secrets set -a acreos-staging KEY=… …          # all keys in .env.staging.example
gh secret set CLERK_SIGN_IN_TICKET                 # from a Clerk TEST instance (authed layer)
gh secret set DATABASE_URL_STAGING                 # staging DB R/W (IDOR + load layers)
```

After that, every push to main deploys staging and the realism audit runs
automatically (public value-path check now; authed + DB layers as their secrets
are added). Until then both workflows skip cleanly (amber, not red).

## Status: staging is LIVE (Layer A verified)

`acreos-staging` is provisioned and serving:

| | |
|---|---|
| App | `acreos-staging` (`fly.staging.toml`, no-op release_command) |
| URL | https://acreos-staging.fly.dev |
| DB | `acreos-staging-pgv` — custom `pgvector/pgvector:pg16` app (`fly.pgvector.staging.toml`), schema via `db:push` |
| Health | DB healthy; "degraded" only reflects optional redis/stripe being unconfigured |
| **Layer A (public value path)** | ✅ **VERIFIED** — `/api/public/parcel-check` returns REAL federal data (FEMA NFHL + USGS 3DEP + USDA SSURGO + USFWS NWI + US Census ACS, `fromCache:false`) |
| **Real integrations** | ✅ Cloned prod→staging (safe set, via `clone-prod-secrets-to-staging.sh`). Health: **Regrid healthy**, **OpenRouter/Pax healthy**, **Clerk wired**. (Send-side — Lob/Twilio/SES/Stripe — deliberately not copied; they stay "unconfigured".) |
| **Auth funnel wired** | ✅ Protected APIs return **401** unauthenticated (Clerk gate enforced); `/sign-in` returns **200** (Clerk frontend wired). |
| Regrid bug found + fixed | ✅ Audit surfaced Regrid `degraded — Status 404` on staging **and prod**: 3 call sites pinged a bare `/api/v2/parcels` (404) / wrong host. Fixed to `/api/v2/parcels/address` (commit `237110ca`). Includes the broken `validate-regrid` settings feature (was always `valid:false`). |
| **Layer C (IDOR + load)** | ✅ Green locally this session (8/8 cross-tenant isolate, no read/write breach; 5k-lead 40-way load held). Valid home is local — the persona-cookie bypass is Fly-disabled, so it can't run against staging. |
| Layer B (full logged-in walk) | ✅ **VERIFIED on PROD (read-only).** A real Clerk ticket sign-in (`@clerk/testing`) established a live session on `acreos.io`; all four customer doors (`/today /maps /deals /money`) rendered behind real auth (no bounce), and authed read-APIs returned 200 (`/api/auth/user`, `/api/leads`). Used the existing founder account — no writes, no new users/orgs. **Could NOT run on staging:** staging serves `pk_live` → `clerk.acreos.io`, origin-locked to `acreos.io`, so a browser session can't form on `acreos-staging.fly.dev` (cookies scoped to acreos.io; the ticket bounces). To run Layer B *on staging*, use a Clerk **Development instance** with `acreos-staging.fly.dev` as an allowed origin (steps above) — then `realism-audit.yml` runs it in CI. |

### Remaining founder-only flips (require durable secrets I must not fabricate)

These are deliberately NOT automated, because they need a durable, founder-owned
staging Fly token (the session token used to provision is temporary/rotated) and
a real Clerk **test** instance (the persona-cookie bypass is Fly-disabled by
design, so Layers B/C cannot authenticate against staging without one):

1. **Durable staging deploy token** — set CI's `FLY_API_TOKEN` to an org-scoped
   (or `acreos-staging`-scoped) token so the staging-deploy workflow can reach
   the app.
2. **The flip** — `gh variable set FLY_STAGING_APP --body "acreos-staging"`.
   This wakes `staging.yml` (auto-deploy on push) + `realism-audit.yml`. Layer A
   runs immediately (URL is derived from the app name, no token needed).
3. **Layer B (authed)** — stand up a Clerk TEST instance; set
   `gh secret set CLERK_SIGN_IN_TICKET` (+ `CLERK_PUBLISHABLE_KEY`) and the
   matching `CLERK_SECRET_KEY`/`VITE_CLERK_PUBLISHABLE_KEY` Fly secrets on
   `acreos-staging` (currently dummy keys).
4. **Layer C (IDOR/load)** — `gh secret set DATABASE_URL_STAGING` (the staging
   DB URL) so the seeders can run.
5. **Real test-mode integration keys** — the value paths below.

### Enabling Layer B — the Clerk domain unblock (founder, ~10 min)

The blocker (proven): staging serves `pk_live` → `clerk.acreos.io` (prod Clerk,
origin-locked to `acreos.io`), so no browser session can form on
`acreos-staging.fly.dev`. Use a **dedicated Clerk Development instance** (the
clean fix — keeps prod auth untouched):

1. **Clerk Dashboard → your app → top-left instance switcher → "Development".**
   Dev instances accept `localhost` + any added origin and don't bot-block test
   automation. (Avoid satellite domains on the prod instance — heavier, and it
   mixes prod auth with staging.)
2. **Add the staging origin:** Dev instance → **Configure → Domains** (and
   **Paths / Allowed origins**) → add `https://acreos-staging.fly.dev`.
3. **Copy that instance's keys** (`pk_test_…`, `sk_test_…`) and set them on
   staging **yourself** (never through me — credential rule):
   ```bash
   fly secrets set -a acreos-staging \
     CLERK_PUBLISHABLE_KEY=pk_test_… VITE_CLERK_PUBLISHABLE_KEY=pk_test_… \
     CLERK_SECRET_KEY=sk_test_…
   ```
   Staging redeploys automatically on `secrets set`.
4. **Tell me** — I'll mint a sign-in ticket against the dev instance and drive
   the full logged-in JTBD walk (the harness in `auth-clerk-ticket.setup.ts` +
   the Playwright walk already exist; only the domain was blocking).

CI alternative: once the dev keys are on staging, set the GitHub secrets
(`CLERK_SIGN_IN_TICKET`, `CLERK_PUBLISHABLE_KEY`) + the repo `FLY_STAGING_APP`
variable and `realism-audit.yml` runs Layer B in CI, where `CLERK_SECRET_KEY`
lives as a secret — never on a dev box.

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
