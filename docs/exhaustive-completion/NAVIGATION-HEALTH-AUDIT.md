# Navigation Health Audit

**Host:** https://acreos.io
**Mode:** UNAUTH (no Clerk session)
**Date:** 2026-04-30T02:37:06.252Z
**Routes audited:** 164

## Summary

| Category | Count |
|----------|-------|
| HEALTHY | 0 |
| AUTH_REDIRECT | 154 |
| DEGRADED | 10 |
| BLANK | 0 |
| ERROR | 0 |

## Coverage caveat

This run was **unauthenticated**. Routes protected by `ProtectedRoute` /
`FounderProtectedRoute` redirect to `/auth` and are correctly categorized
as `AUTH_REDIRECT` — but their *authenticated render quality* is not
covered. To extend coverage to auth-gated surfaces tomorrow, founder needs to
provide one of:

- A Clerk-minted sign-in ticket (`POST /v1/sign_in_tokens` against the Clerk
  Backend API with `CLERK_SECRET_KEY`) that the script can redeem via
  `Clerk.client.signIn.create({ strategy: 'ticket', ticket })` in Playwright.
- Or, more practically: a saved `storageState.json` from a logged-in browser
  session (`page.context().storageState({ path: ... })`) that the audit can
  load into a new context. This is the lowest-friction path — founder runs it
  once after signing in, hands back the JSON, audit re-runs against all
  protected routes.

I deliberately did NOT pull `CLERK_SECRET_KEY` from Fly to mint tickets
locally — that's adjacent to the auth-flow modifications the overnight
directive disallows.

## Summary table

| Path | Kind | Category | HTTP | TTI (ms) | Errors | Notes |
|------|------|----------|------|----------|--------|-------|
| `/auth` | PUBLIC | DEGRADED | 200 | 5754 | 3 | 1 failed XHR |
| `/terms` | PUBLIC | DEGRADED | 200 | 5373 | 2 |  |
| `/privacy` | PUBLIC | DEGRADED | 200 | 5288 | 2 |  |
| `/pricing` | PUBLIC | DEGRADED | 200 | 5352 | 2 |  |
| `/status` | PUBLIC | DEGRADED | 200 | 5292 | 2 |  |
| `/changelog` | PROTECTED | DEGRADED | 200 | 5293 | 2 |  |
| `/portal` | PROTECTED | DEGRADED | 200 | 5293 | 2 |  |
| `/sign/:docId` | PROTECTED | DEGRADED | 200 | 5282 | 2 |  |
| `/portal/:accessToken` | PROTECTED | DEGRADED | 200 | 5288 | 2 |  |
| `/onboarding-v2` | PROTECTED | AUTH_REDIRECT | 200 | 5292 | 3 | 1 failed XHR |
| `/` | PROTECTED | DEGRADED | 200 | 5301 | 2 |  |
| `/today` | PROTECTED | AUTH_REDIRECT | 200 | 5710 | 3 | 1 failed XHR |
| `/dashboard` | PROTECTED | AUTH_REDIRECT | 200 | 5294 | 3 | 1 failed XHR |
| `/pipeline` | PROTECTED | AUTH_REDIRECT | 200 | 5293 | 3 | 1 failed XHR |
| `/money` | PROTECTED | AUTH_REDIRECT | 200 | 5370 | 3 | 1 failed XHR |
| `/ai` | PROTECTED | AUTH_REDIRECT | 200 | 5290 | 3 | 1 failed XHR |
| `/pax` | PROTECTED | AUTH_REDIRECT | 200 | 5293 | 3 | 1 failed XHR |
| `/leads` | PROTECTED | AUTH_REDIRECT | 200 | 5355 | 3 | 1 failed XHR |
| `/leads/dedupe` | PROTECTED | AUTH_REDIRECT | 200 | 5295 | 3 | 1 failed XHR |
| `/properties` | PROTECTED | AUTH_REDIRECT | 200 | 5325 | 3 | 1 failed XHR |
| `/deals` | PROTECTED | AUTH_REDIRECT | 200 | 5353 | 3 | 1 failed XHR |
| `/tasks` | PROTECTED | AUTH_REDIRECT | 200 | 5293 | 3 | 1 failed XHR |
| `/team-dashboard` | PROTECTED | AUTH_REDIRECT | 200 | 5381 | 3 | 1 failed XHR |
| `/team` | PROTECTED | AUTH_REDIRECT | 200 | 5308 | 3 | 1 failed XHR |
| `/team-inbox` | PROTECTED | AUTH_REDIRECT | 200 | 5340 | 3 | 1 failed XHR |
| `/automation` | PROTECTED | AUTH_REDIRECT | 200 | 5289 | 3 | 1 failed XHR |
| `/workflows` | PROTECTED | AUTH_REDIRECT | 200 | 5306 | 3 | 1 failed XHR |
| `/activity` | PROTECTED | AUTH_REDIRECT | 200 | 5286 | 3 | 1 failed XHR |
| `/analytics` | PROTECTED | AUTH_REDIRECT | 200 | 5369 | 3 | 1 failed XHR |
| `/finance` | PROTECTED | AUTH_REDIRECT | 200 | 5305 | 3 | 1 failed XHR |
| `/portfolio` | PROTECTED | AUTH_REDIRECT | 200 | 5291 | 3 | 1 failed XHR |
| `/campaigns` | PROTECTED | AUTH_REDIRECT | 200 | 5287 | 3 | 1 failed XHR |
| `/ab-tests` | PROTECTED | AUTH_REDIRECT | 200 | 5369 | 3 | 1 failed XHR |
| `/sequences` | PROTECTED | AUTH_REDIRECT | 200 | 5294 | 3 | 1 failed XHR |
| `/counties` | PROTECTED | AUTH_REDIRECT | 200 | 5342 | 3 | 1 failed XHR |
| `/offers` | PROTECTED | AUTH_REDIRECT | 200 | 5317 | 3 | 1 failed XHR |
| `/offers/batches` | PROTECTED | AUTH_REDIRECT | 200 | 5293 | 3 | 1 failed XHR |
| `/listings` | PROTECTED | AUTH_REDIRECT | 200 | 5283 | 3 | 1 failed XHR |
| `/documents` | PROTECTED | AUTH_REDIRECT | 200 | 5378 | 3 | 1 failed XHR |
| `/tools` | PROTECTED | AUTH_REDIRECT | 200 | 5303 | 3 | 1 failed XHR |
| `/command-center` | PROTECTED | AUTH_REDIRECT | 200 | 5367 | 3 | 1 failed XHR |
| `/agents` | PROTECTED | AUTH_REDIRECT | 200 | 5280 | 3 | 1 failed XHR |
| `/ai-team` | PROTECTED | AUTH_REDIRECT | 200 | 5297 | 3 | 1 failed XHR |
| `/support` | PROTECTED | AUTH_REDIRECT | 200 | 5291 | 3 | 1 failed XHR |
| `/settings` | PROTECTED | AUTH_REDIRECT | 200 | 5329 | 3 | 1 failed XHR |
| `/my-letter` | PROTECTED | AUTH_REDIRECT | 200 | 5286 | 3 | 1 failed XHR |
| `/settings/email` | PROTECTED | AUTH_REDIRECT | 200 | 5360 | 3 | 1 failed XHR |
| `/settings/mail` | FOUNDER | AUTH_REDIRECT | 200 | 5297 | 3 | 1 failed XHR |
| `/inbox` | FOUNDER | AUTH_REDIRECT | 200 | 5292 | 3 | 1 failed XHR |
| `/help` | FOUNDER | AUTH_REDIRECT | 200 | 5410 | 3 | 1 failed XHR |
| `/admin/support` | FOUNDER | AUTH_REDIRECT | 200 | 5287 | 3 | 1 failed XHR |
| `/founder-dashboard` | FOUNDER | AUTH_REDIRECT | 200 | 5293 | 3 | 1 failed XHR |
| `/founder-home` | FOUNDER | AUTH_REDIRECT | 200 | 5296 | 3 | 1 failed XHR |
| `/founder` | FOUNDER | AUTH_REDIRECT | 200 | 5289 | 3 | 1 failed XHR |
| `/founder/ai-observatory` | FOUNDER | AUTH_REDIRECT | 200 | 5313 | 3 | 1 failed XHR |
| `/founder/feature-flags` | FOUNDER | AUTH_REDIRECT | 200 | 5289 | 3 | 1 failed XHR |
| `/founder/features` | FOUNDER | AUTH_REDIRECT | 200 | 5302 | 3 | 1 failed XHR |
| `/founder/integrations` | FOUNDER | AUTH_REDIRECT | 200 | 5283 | 3 | 1 failed XHR |
| `/marketplace` | FLAGGED | AUTH_REDIRECT | 200 | 5287 | 3 | 1 failed XHR |
| `/land-credit` | PROTECTED | AUTH_REDIRECT | 200 | 5295 | 3 | 1 failed XHR |
| `/radar` | PROTECTED | AUTH_REDIRECT | 200 | 5298 | 3 | 1 failed XHR |
| `/portfolio-optimizer` | PROTECTED | AUTH_REDIRECT | 200 | 5286 | 3 | 1 failed XHR |
| `/avm` | PROTECTED | AUTH_REDIRECT | 200 | 5296 | 3 | 1 failed XHR |
| `/maps` | PROTECTED | AUTH_REDIRECT | 200 | 5292 | 3 | 1 failed XHR |
| `/negotiation` | PROTECTED | AUTH_REDIRECT | 200 | 5299 | 3 | 1 failed XHR |
| `/cash-flow` | PROTECTED | AUTH_REDIRECT | 200 | 5358 | 3 | 1 failed XHR |
| `/deal-hunter` | FLAGGED | AUTH_REDIRECT | 200 | 5296 | 3 | 1 failed XHR |
| `/vision-ai` | FLAGGED | AUTH_REDIRECT | 200 | 5298 | 3 | 1 failed XHR |
| `/capital-markets` | FLAGGED | AUTH_REDIRECT | 200 | 5281 | 3 | 1 failed XHR |
| `/market-intelligence` | FLAGGED | AUTH_REDIRECT | 200 | 5290 | 3 | 1 failed XHR |
| `/compliance` | FOUNDER | AUTH_REDIRECT | 200 | 5285 | 3 | 1 failed XHR |
| `/tax-researcher` | FOUNDER | AUTH_REDIRECT | 200 | 5291 | 3 | 1 failed XHR |
| `/document-intelligence` | FOUNDER | AUTH_REDIRECT | 200 | 5287 | 3 | 1 failed XHR |
| `/admin/beta` | FOUNDER | AUTH_REDIRECT | 200 | 5285 | 3 | 1 failed XHR |
| `/admin/safety-gates` | FOUNDER | AUTH_REDIRECT | 200 | 5301 | 3 | 1 failed XHR |
| `/admin/decisions` | PROTECTED | AUTH_REDIRECT | 200 | 5294 | 3 | 1 failed XHR |
| `/decision-queue` | FOUNDER | AUTH_REDIRECT | 200 | 5300 | 3 | 1 failed XHR |
| `/admin/ops` | FOUNDER | AUTH_REDIRECT | 200 | 5411 | 3 | 1 failed XHR |
| `/admin/beta-intake` | FOUNDER | AUTH_REDIRECT | 200 | 5288 | 3 | 1 failed XHR |
| `/founder/beta-analytics` | FOUNDER | AUTH_REDIRECT | 200 | 5292 | 3 | 1 failed XHR |
| `/founder/agents` | FOUNDER | AUTH_REDIRECT | 200 | 5285 | 3 | 1 failed XHR |
| `/founder/daily-digest` | FOUNDER | AUTH_REDIRECT | 200 | 5290 | 3 | 1 failed XHR |
| `/founder/decisions` | FOUNDER | AUTH_REDIRECT | 200 | 5296 | 3 | 1 failed XHR |
| `/founder/letter` | FOUNDER | AUTH_REDIRECT | 200 | 5366 | 3 | 1 failed XHR |
| `/founder/settings` | FOUNDER | AUTH_REDIRECT | 200 | 5290 | 3 | 1 failed XHR |
| `/founder/preview` | FOUNDER | AUTH_REDIRECT | 200 | 5315 | 3 | 1 failed XHR |
| `/founder/tools` | FOUNDER | AUTH_REDIRECT | 200 | 5294 | 3 | 1 failed XHR |
| `/founder/prompt-evolutions` | FOUNDER | AUTH_REDIRECT | 200 | 5301 | 3 | 1 failed XHR |
| `/founder/prompt-history` | FOUNDER | AUTH_REDIRECT | 200 | 5299 | 3 | 1 failed XHR |
| `/founder/traces` | FOUNDER | AUTH_REDIRECT | 200 | 5296 | 3 | 1 failed XHR |
| `/founder/strategy` | FOUNDER | AUTH_REDIRECT | 200 | 5297 | 3 | 1 failed XHR |
| `/founder/trends` | FOUNDER | AUTH_REDIRECT | 200 | 5295 | 3 | 1 failed XHR |
| `/founder/onboarding` | FOUNDER | AUTH_REDIRECT | 200 | 5282 | 3 | 1 failed XHR |
| `/founder/expansion` | FOUNDER | AUTH_REDIRECT | 200 | 5297 | 3 | 1 failed XHR |
| `/founder/experiments` | FOUNDER | AUTH_REDIRECT | 200 | 5304 | 3 | 1 failed XHR |
| `/founder/providers` | FOUNDER | AUTH_REDIRECT | 200 | 5292 | 3 | 1 failed XHR |
| `/founder/todo` | FOUNDER | AUTH_REDIRECT | 200 | 5293 | 3 | 1 failed XHR |
| `/executive-dashboard` | FOUNDER | AUTH_REDIRECT | 200 | 5287 | 3 | 1 failed XHR |
| `/deal-underwriting` | PROTECTED | AUTH_REDIRECT | 200 | 5314 | 3 | 1 failed XHR |
| `/deal-feed` | PROTECTED | AUTH_REDIRECT | 200 | 5336 | 3 | 1 failed XHR |
| `/market-data` | PROTECTED | AUTH_REDIRECT | 200 | 5289 | 3 | 1 failed XHR |
| `/team-kpi` | PROTECTED | AUTH_REDIRECT | 200 | 5278 | 3 | 1 failed XHR |
| `/forecasting` | PROTECTED | AUTH_REDIRECT | 200 | 5348 | 3 | 1 failed XHR |
| `/portfolio-health` | PROTECTED | AUTH_REDIRECT | 200 | 5273 | 3 | 1 failed XHR |
| `/portfolio-pnl` | PROTECTED | AUTH_REDIRECT | 200 | 5294 | 3 | 1 failed XHR |
| `/exchange-1031` | PROTECTED | AUTH_REDIRECT | 200 | 5292 | 3 | 1 failed XHR |
| `/tax-optimizer` | PROTECTED | AUTH_REDIRECT | 200 | 5288 | 3 | 1 failed XHR |
| `/tax-delinquent` | PROTECTED | AUTH_REDIRECT | 200 | 5292 | 3 | 1 failed XHR |
| `/bookkeeping` | FOUNDER | AUTH_REDIRECT | 200 | 5294 | 3 | 1 failed XHR |
| `/depreciation` | FOUNDER | AUTH_REDIRECT | 200 | 5292 | 3 | 1 failed XHR |
| `/closing-costs` | FOUNDER | AUTH_REDIRECT | 200 | 5499 | 3 | 1 failed XHR |
| `/property-tax` | FOUNDER | AUTH_REDIRECT | 200 | 5305 | 3 | 1 failed XHR |
| `/fee-dashboard` | FOUNDER | AUTH_REDIRECT | 200 | 5301 | 3 | 1 failed XHR |
| `/avm-bulk` | FLAGGED | AUTH_REDIRECT | 200 | 5285 | 3 | 1 failed XHR |
| `/market-watchlist` | FLAGGED | AUTH_REDIRECT | 200 | 5296 | 3 | 1 failed XHR |
| `/price-optimizer` | PROTECTED | AUTH_REDIRECT | 200 | 5283 | 3 | 1 failed XHR |
| `/seller-intent` | PROTECTED | AUTH_REDIRECT | 200 | 5290 | 3 | 1 failed XHR |
| `/deal-patterns` | PROTECTED | AUTH_REDIRECT | 200 | 5289 | 3 | 1 failed XHR |
| `/conscious-organization` | FOUNDER | AUTH_REDIRECT | 200 | 5291 | 3 | 1 failed XHR |
| `/anticipatory-enterprise` | FOUNDER | AUTH_REDIRECT | 200 | 5301 | 3 | 1 failed XHR |
| `/real-runtime` | PROTECTED | AUTH_REDIRECT | 200 | 5286 | 3 | 1 failed XHR |
| `/agent-command-center` | PROTECTED | AUTH_REDIRECT | 200 | 5284 | 3 | 1 failed XHR |
| `/zoning` | PROTECTED | AUTH_REDIRECT | 200 | 5295 | 3 | 1 failed XHR |
| `/title-search` | PROTECTED | AUTH_REDIRECT | 200 | 5282 | 3 | 1 failed XHR |
| `/property-enrichment` | PROTECTED | AUTH_REDIRECT | 200 | 5297 | 3 | 1 failed XHR |
| `/skip-tracing` | PROTECTED | AUTH_REDIRECT | 200 | 5290 | 3 | 1 failed XHR |
| `/direct-mail` | PROTECTED | AUTH_REDIRECT | 200 | 5287 | 3 | 1 failed XHR |
| `/syndication` | PROTECTED | AUTH_REDIRECT | 200 | 5279 | 3 | 1 failed XHR |
| `/syndication-status` | PROTECTED | AUTH_REDIRECT | 200 | 5504 | 3 | 1 failed XHR |
| `/commissions` | PROTECTED | AUTH_REDIRECT | 200 | 5280 | 3 | 1 failed XHR |
| `/team-leaderboard` | PROTECTED | AUTH_REDIRECT | 200 | 5369 | 3 | 1 failed XHR |
| `/kpis` | PROTECTED | AUTH_REDIRECT | 200 | 5301 | 3 | 1 failed XHR |
| `/cohort-analysis` | PROTECTED | AUTH_REDIRECT | 200 | 5285 | 3 | 1 failed XHR |
| `/audit-log` | PROTECTED | AUTH_REDIRECT | 200 | 5281 | 3 | 1 failed XHR |
| `/data-export` | PROTECTED | AUTH_REDIRECT | 200 | 5277 | 3 | 1 failed XHR |
| `/model-training` | PROTECTED | AUTH_REDIRECT | 200 | 5330 | 3 | 1 failed XHR |
| `/investor-network` | PROTECTED | AUTH_REDIRECT | 200 | 5303 | 3 | 1 failed XHR |
| `/regulatory-intel` | PROTECTED | AUTH_REDIRECT | 200 | 5295 | 3 | 1 failed XHR |
| `/settings/privacy` | PROTECTED | AUTH_REDIRECT | 200 | 5304 | 3 | 1 failed XHR |
| `/usage` | PROTECTED | AUTH_REDIRECT | 200 | 5279 | 3 | 1 failed XHR |
| `/goals` | PROTECTED | AUTH_REDIRECT | 200 | 5384 | 3 | 1 failed XHR |
| `/webhooks` | PROTECTED | AUTH_REDIRECT | 200 | 5286 | 3 | 1 failed XHR |
| `/dodd-frank` | PROTECTED | AUTH_REDIRECT | 200 | 5281 | 3 | 1 failed XHR |
| `/state-documents` | PROTECTED | AUTH_REDIRECT | 200 | 5283 | 3 | 1 failed XHR |
| `/dunning` | PROTECTED | AUTH_REDIRECT | 200 | 5291 | 3 | 1 failed XHR |
| `/freedom-meter` | FOUNDER | AUTH_REDIRECT | 200 | 5288 | 3 | 1 failed XHR |
| `/blind-offer-wizard` | FOUNDER | AUTH_REDIRECT | 200 | 5300 | 3 | 1 failed XHR |
| `/night-cap` | FOUNDER | AUTH_REDIRECT | 200 | 5287 | 3 | 1 failed XHR |
| `/evening-review` | FOUNDER | AUTH_REDIRECT | 200 | 5288 | 3 | 1 failed XHR |
| `/founder/v13` | FOUNDER | AUTH_REDIRECT | 200 | 5290 | 3 | 1 failed XHR |
| `/founder/agents/:codename` | FOUNDER | AUTH_REDIRECT | 200 | 5289 | 3 | 1 failed XHR |
| `/admin/beta-analytics` | FOUNDER | AUTH_REDIRECT | 200 | 5289 | 3 | 1 failed XHR |
| `/admin/queues` | FOUNDER | AUTH_REDIRECT | 200 | 5278 | 3 | 1 failed XHR |
| `/admin/integrations-health` | FOUNDER | AUTH_REDIRECT | 200 | 5276 | 3 | 1 failed XHR |
| `/admin/monitor` | FOUNDER | AUTH_REDIRECT | 200 | 5275 | 3 | 1 failed XHR |
| `/reseller` | FOUNDER | AUTH_REDIRECT | 200 | 5270 | 3 | 1 failed XHR |
| `/data-moat` | FOUNDER | AUTH_REDIRECT | 200 | 5276 | 3 | 1 failed XHR |
| `/sovereign` | FOUNDER | AUTH_REDIRECT | 200 | 5276 | 3 | 1 failed XHR |
| `/board-of-directors` | FOUNDER | AUTH_REDIRECT | 200 | 5282 | 3 | 1 failed XHR |
| `/agent-performance` | FOUNDER | AUTH_REDIRECT | 200 | 5266 | 3 | 1 failed XHR |
| `/memory-browser` | FOUNDER | AUTH_REDIRECT | 200 | 5285 | 3 | 1 failed XHR |
| `/event-log` | FOUNDER | AUTH_REDIRECT | 200 | 5278 | 3 | 1 failed XHR |
| `/job-health` | FOUNDER | AUTH_REDIRECT | 200 | 5279 | 3 | 1 failed XHR |
| `/agent-collaboration` | FOUNDER | AUTH_REDIRECT | 200 | 5296 | 3 | 1 failed XHR |

## Common patterns (3+ routes)

- **328× routes:** `Failed to load resource: the server responded with a status of 401 ()`
- **155× routes:** `Failed to load resource: net::ERR_FAILED`

## Common failed network requests

- **155× routes:** `/static/google.svg`

## Per-route detail (non-HEALTHY)

### `/auth` — DEGRADED

- **Kind:** PUBLIC
- **Final URL:** https://acreos.io/auth
- **HTTP:** 200
- **TTI:** 5754ms
- **Render:** main=239c body=411c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: net::ERR_FAILED`
- **Failed requests (top 5):**
  - `https://img.clerk.com/static/google.svg` (net::ERR_FAILED)
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-auth.png`

### `/terms` — DEGRADED

- **Kind:** PUBLIC
- **Final URL:** https://acreos.io/terms
- **HTTP:** 200
- **TTI:** 5373ms
- **Render:** main=6172c body=6344c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-terms.png`

### `/privacy` — DEGRADED

- **Kind:** PUBLIC
- **Final URL:** https://acreos.io/privacy
- **HTTP:** 200
- **TTI:** 5288ms
- **Render:** main=7280c body=7452c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-privacy.png`

### `/pricing` — DEGRADED

- **Kind:** PUBLIC
- **Final URL:** https://acreos.io/pricing
- **HTTP:** 200
- **TTI:** 5352ms
- **Render:** main=1397c body=1569c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-pricing.png`

### `/status` — DEGRADED

- **Kind:** PUBLIC
- **Final URL:** https://acreos.io/status
- **HTTP:** 200
- **TTI:** 5292ms
- **Render:** main=266c body=438c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-status.png`

### `/changelog` — DEGRADED

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/changelog
- **HTTP:** 200
- **TTI:** 5293ms
- **Render:** main=4992c body=5164c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-changelog.png`

### `/portal` — DEGRADED

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/portal
- **HTTP:** 200
- **TTI:** 5293ms
- **Render:** main=374c body=546c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-portal.png`

### `/sign/:docId` — DEGRADED

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/sign/demo-doc
- **HTTP:** 200
- **TTI:** 5282ms
- **Render:** main=290c body=462c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-sign-docid.png`

### `/portal/:accessToken` — DEGRADED

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/portal/demo-token
- **HTTP:** 200
- **TTI:** 5288ms
- **Render:** main=189c body=361c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-portal-accesstoken.png`

### `/` — DEGRADED

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/
- **HTTP:** 200
- **TTI:** 5301ms
- **Render:** main=8936c body=9108c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-root.png`

## Findings analysis

The audit surfaced **zero ERROR**, **zero BLANK**, and **zero unexpected
AUTH_REDIRECT** results. All 10 DEGRADED entries trace to two structural
issues, both shared across 100% of routes:

### Issue 1 — `Failed to load resource: 401` (328× across 164 routes, 2/route)

These are the **expected unauthenticated state** of two auth-bootstrap API
calls (almost certainly `/api/auth/user` and one CSRF/session probe) that
fire on every page load. They return 401 when there's no session, the SPA
catches the 401 and redirects to `/auth`. Not a bug — the redirect-to-auth
behavior depends on these probes returning 401.

Could be silenced by quieting the fetch error handlers, but doing so risks
hiding real auth bugs. **Not a mechanical fix candidate** — leave as-is.

### Issue 2 — `img.clerk.com/static/google.svg` blocked (155×, 1/route)

Clerk's "Continue with Google" button asset is being blocked at network
level (`net::ERR_FAILED`). This is a **CSP `img-src` policy** issue —
the policy doesn't include `img.clerk.com` as an allowed image origin.

**NOT auto-fixed**: the overnight directive explicitly disallows
modifying CSP. Founder triage required.

### Labeling bug in audit script (cosmetic)

Some routes are labeled `PROTECTED` in the Kind column when they're
actually `PUBLIC` (`/changelog`, `/portal`, `/sign/:docId`, `/`). Cause:
`extractRoutes()` looks ahead 600 chars after each `<Route path="...">`
to detect protection wrappers, but adjacent route entries can match
the NEXT route's wrapper. Doesn't affect the actual category result
(`HEALTHY` / `DEGRADED` / `AUTH_REDIRECT`), which is computed from real
navigation behavior. Worth fixing the script before re-runs, not blocking.

## Recommended fix priority

1. **CSP `img-src` extension for `img.clerk.com`** — single config line in
   `server/middleware/security.ts`, restores the Google branding asset on
   the Clerk sign-in widget. **Not authorized overnight**; founder triage.
2. **Auth coverage** — provide `storageState.json` (sign in once locally,
   `await page.context().storageState({ path })`) so audit can re-run with
   real session against all 154 protected routes. This is the only way
   to catch authenticated render quality, blank states post-auth, and
   data-fetch failures inside protected pages.
3. **Audit-script labeling fix** — make `extractRoutes()` track Route
   nesting properly so Kind labels are accurate. Cosmetic.

## What this audit did NOT cover

- Authenticated render quality of any of the 154 protected routes.
- Founder-mode-specific behavior (every founder route correctly redirected
  to auth, but couldn't observe their post-auth state).
- Per-route data fetches and their failure modes (those happen post-auth).
- The original walkthrough console errors (CSP frame-src, agents/status,
  npm/pending) — those need an authenticated session.
- React Suspense boundaries triggered during real navigation transitions
  between protected routes (the audit creates a fresh page per route).
