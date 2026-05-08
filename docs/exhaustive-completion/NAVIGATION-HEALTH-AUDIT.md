# Navigation Health Audit

**Host:** https://acreos.io
**Mode:** AUTH (storageState=`storageState.json`)
**Date:** 2026-05-08T00:03:49.138Z
**Routes audited:** 192

## Summary

| Category | Count |
|----------|-------|
| HEALTHY | 8 |
| AUTH_REDIRECT | 37 |
| DEGRADED | 28 |
| BLANK | 19 |
| TIMEOUT | 100 |
| ERROR | 0 |

## ⚠ Run-quality caveat — rate limits polluted this run

**This run was authenticated, but the audit triggered the production
`apiLimiter` (300 req/min keyed by user-id, see `server/index.ts:356`).**
192 route navigations × ~10 API calls per page-bootstrap = ~1,920 API
calls in ~30 minutes. Sustained burst rates briefly exceeded the
300/min ceiling. Once the bucket overflows, `/api/auth/user` and other
bootstrap endpoints return 429, the SPA shows the "Loading AcreOS..."
splash indefinitely (or eventually treats the session as invalid and
redirects to `/auth`).

**What this means for the categories above:**

- **HEALTHY (8) + DEGRADED (28)** — trustworthy. These routes rendered
  before rate-limit pressure built, or rendered despite it. Take the
  counts at face value.
- **TIMEOUT (100)** — largely false-positive. The 15s splash-clear wait
  expired because the page's auth bootstrap was throttled, not because
  the route is broken.
- **AUTH_REDIRECT (37)** — also largely false-positive on
  PROTECTED/FOUNDER routes. Session storageState was valid; what
  likely happened is `/api/auth/user` returned 429 and the client
  treated it as "no session" and redirected to `/auth`.
- **BLANK (19)** — likely real. The SPA rendered but the page is
  genuinely empty/minimal — could be intentional empty-state for an
  account with no data, or a missing-data render bug. Worth eyeballing
  the screenshots in `auth-screenshots/_nav-audit-<slug>.png`.

**Recommendation:** treat HEALTHY + DEGRADED + BLANK as actionable.
Treat TIMEOUT + AUTH_REDIRECT as "needs cleaner re-run with inter-route
throttle." The audit script (`scripts/navigation-health-audit.mjs`) was
updated this session to wait for the "Loading AcreOS..." splash to
disappear and emit a separate TIMEOUT category — but it does NOT yet
add a per-route delay. A future run should add `INTER_ROUTE_DELAY_MS=5000`
(or similar) before trusting the TIMEOUT/AUTH_REDIRECT counts.

A real schema-drift incident was discovered in the process of getting
this audit running — see [STABILIZATION-COMPLETE.md "Patched 2026-05-07"]
(./STABILIZATION-COMPLETE.md). That outcome was the most durable value
of this F.1 attempt.

---

## Original coverage caveat (template — kept for historical context)

This template was for the unauthenticated default. The actual run above
*was* authenticated:

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
| `/auth` | PUBLIC | DEGRADED | 200 | 3072 | 6 | 2 failed XHR |
| `/terms` | PUBLIC | HEALTHY | 200 | 2042 | 0 |  |
| `/privacy` | PUBLIC | HEALTHY | 200 | 2127 | 0 |  |
| `/pricing` | PUBLIC | HEALTHY | 200 | 1987 | 0 |  |
| `/why` | PUBLIC | HEALTHY | 200 | 1894 | 0 |  |
| `/status` | PUBLIC | HEALTHY | 200 | 1972 | 0 |  |
| `/changelog` | PUBLIC | HEALTHY | 200 | 2026 | 0 |  |
| `/security` | PUBLIC | HEALTHY | 200 | 2050 | 0 |  |
| `/glossary` | PROTECTED | HEALTHY | 200 | 1951 | 0 |  |
| `/portal` | PROTECTED | DEGRADED | 200 | 1898 | 1 |  |
| `/sign/:docId` | PROTECTED | DEGRADED | 200 | 1910 | 1 |  |
| `/portal/:accessToken` | PROTECTED | DEGRADED | 200 | 1887 | 1 |  |
| `/onboarding-v2` | PROTECTED | DEGRADED | 200 | 1946 | 1 |  |
| `/welcome-back` | PROTECTED | DEGRADED | 200 | 1941 | 1 |  |
| `/` | PROTECTED | DEGRADED | 200 | 1999 | 10 |  |
| `/today` | PROTECTED | DEGRADED | 200 | 2025 | 10 |  |
| `/dashboard` | PROTECTED | DEGRADED | 200 | 2065 | 10 |  |
| `/pipeline` | PROTECTED | DEGRADED | 200 | 1968 | 2 |  |
| `/money` | PROTECTED | DEGRADED | 200 | 1963 | 2 |  |
| `/ai` | PROTECTED | DEGRADED | 200 | 1948 | 7 |  |
| `/pax` | PROTECTED | DEGRADED | 200 | 1953 | 7 |  |
| `/leads` | PROTECTED | DEGRADED | 200 | 2021 | 2 |  |
| `/leads/dedupe` | PROTECTED | DEGRADED | 200 | 8065 | 6 |  |
| `/leads/:id` | PROTECTED | DEGRADED | 200 | 2050 | 2 |  |
| `/properties` | PROTECTED | DEGRADED | 200 | 2054 | 2 |  |
| `/parcels/:id` | PROTECTED | DEGRADED | 200 | 1990 | 2 |  |
| `/deals` | PROTECTED | TIMEOUT | 200 | 16791 | 4 |  |
| `/deals/:id` | PROTECTED | DEGRADED | 200 | 1993 | 4 |  |
| `/tasks` | PROTECTED | TIMEOUT | 200 | 16799 | 4 |  |
| `/team-dashboard` | PROTECTED | TIMEOUT | 200 | 16772 | 4 |  |
| `/team/dashboard` | PROTECTED | TIMEOUT | 200 | 16791 | 4 |  |
| `/team/offer-approvals` | PROTECTED | TIMEOUT | 200 | 16776 | 4 |  |
| `/settings/lead-assignment` | PROTECTED | TIMEOUT | 200 | 16768 | 4 |  |
| `/settings/integrations` | PROTECTED | TIMEOUT | 200 | 16775 | 4 |  |
| `/team` | PROTECTED | TIMEOUT | 200 | 16780 | 4 |  |
| `/team-inbox` | PROTECTED | TIMEOUT | 200 | 16847 | 4 |  |
| `/automation` | PROTECTED | TIMEOUT | 200 | 16821 | 4 |  |
| `/workflows` | PROTECTED | TIMEOUT | 200 | 16781 | 4 |  |
| `/activity` | PROTECTED | TIMEOUT | 200 | 16793 | 4 |  |
| `/analytics` | PROTECTED | TIMEOUT | 200 | 16784 | 4 |  |
| `/finance` | PROTECTED | TIMEOUT | 200 | 16789 | 4 |  |
| `/notes` | PROTECTED | TIMEOUT | 200 | 16863 | 4 |  |
| `/portfolio` | PROTECTED | TIMEOUT | 200 | 16853 | 4 |  |
| `/campaigns` | PROTECTED | TIMEOUT | 200 | 16789 | 4 |  |
| `/ab-tests` | PROTECTED | TIMEOUT | 200 | 16850 | 4 |  |
| `/sequences` | PROTECTED | TIMEOUT | 200 | 16801 | 4 |  |
| `/counties` | PROTECTED | TIMEOUT | 200 | 16778 | 4 |  |
| `/offers` | PROTECTED | TIMEOUT | 200 | 16779 | 4 |  |
| `/offers/batches` | PROTECTED | TIMEOUT | 200 | 16805 | 4 |  |
| `/listings` | PROTECTED | TIMEOUT | 200 | 16779 | 4 |  |
| `/documents` | PROTECTED | TIMEOUT | 200 | 16871 | 4 |  |
| `/tools` | PROTECTED | TIMEOUT | 200 | 16780 | 4 |  |
| `/command-center` | PROTECTED | TIMEOUT | 200 | 16777 | 4 |  |
| `/agents` | PROTECTED | TIMEOUT | 200 | 16791 | 4 |  |
| `/ai-team` | PROTECTED | TIMEOUT | 200 | 16842 | 4 |  |
| `/support` | PROTECTED | TIMEOUT | 200 | 16836 | 4 |  |
| `/settings` | PROTECTED | TIMEOUT | 200 | 16787 | 4 |  |
| `/my-letter` | PROTECTED | TIMEOUT | 200 | 16853 | 4 |  |
| `/settings/email` | PROTECTED | TIMEOUT | 200 | 16784 | 4 |  |
| `/settings/mail` | FOUNDER | TIMEOUT | 200 | 16866 | 4 |  |
| `/inbox` | FOUNDER | TIMEOUT | 200 | 16795 | 4 |  |
| `/help` | FOUNDER | TIMEOUT | 200 | 16832 | 4 |  |
| `/admin/support` | FOUNDER | TIMEOUT | 200 | 16869 | 4 |  |
| `/founder-dashboard` | FOUNDER | AUTH_REDIRECT | 200 | 8042 | 5 |  |
| `/founder-home` | FOUNDER | AUTH_REDIRECT | 200 | 8117 | 5 |  |
| `/founder` | FOUNDER | AUTH_REDIRECT | 200 | 8088 | 5 |  |
| `/founder/ai-observatory` | FOUNDER | AUTH_REDIRECT | 200 | 8121 | 5 |  |
| `/founder/feature-flags` | FOUNDER | AUTH_REDIRECT | 200 | 7984 | 5 |  |
| `/founder/features` | FOUNDER | AUTH_REDIRECT | 200 | 8101 | 5 |  |
| `/founder/integrations` | FOUNDER | AUTH_REDIRECT | 200 | 8088 | 5 |  |
| `/founder/ai-costs` | FOUNDER | AUTH_REDIRECT | 200 | 8083 | 5 |  |
| `/founder/observability-cost` | FOUNDER | AUTH_REDIRECT | 200 | 8128 | 5 |  |
| `/founder/cost-optimizer` | FOUNDER | AUTH_REDIRECT | 200 | 8034 | 5 |  |
| `/founder/unit-economics` | FOUNDER | AUTH_REDIRECT | 200 | 8186 | 5 |  |
| `/founder/dsar` | FOUNDER | AUTH_REDIRECT | 200 | 8159 | 5 |  |
| `/founder/legal-holds` | FOUNDER | AUTH_REDIRECT | 200 | 7984 | 5 |  |
| `/founder/sub-processors` | FOUNDER | AUTH_REDIRECT | 200 | 8124 | 5 |  |
| `/founder/recovery-console` | FOUNDER | AUTH_REDIRECT | 200 | 8004 | 5 |  |
| `/founder/activation` | FOUNDER | AUTH_REDIRECT | 200 | 8192 | 5 |  |
| `/founder/ml-snapshots` | FOUNDER | AUTH_REDIRECT | 200 | 8165 | 5 |  |
| `/founder/etl` | FOUNDER | AUTH_REDIRECT | 200 | 7979 | 5 |  |
| `/founder/prompt-versions` | FOUNDER | AUTH_REDIRECT | 200 | 8140 | 5 |  |
| `/founder/title-partners` | FOUNDER | AUTH_REDIRECT | 200 | 7999 | 5 |  |
| `/marketplace` | FLAGGED | BLANK | 200 | 1971 | 1 |  |
| `/land-credit` | PROTECTED | BLANK | 200 | 2023 | 4 |  |
| `/radar` | PROTECTED | BLANK | 200 | 2037 | 4 |  |
| `/portfolio-optimizer` | PROTECTED | BLANK | 200 | 2002 | 4 |  |
| `/avm` | PROTECTED | BLANK | 200 | 2020 | 4 |  |
| `/maps` | PROTECTED | TIMEOUT | 200 | 16919 | 7 |  |
| `/negotiation` | PROTECTED | BLANK | 200 | 1951 | 1 |  |
| `/cash-flow` | PROTECTED | TIMEOUT | 200 | 16886 | 7 |  |
| `/deal-hunter` | FLAGGED | BLANK | 200 | 1880 | 1 |  |
| `/vision-ai` | FLAGGED | BLANK | 200 | 2026 | 4 |  |
| `/capital-markets` | FLAGGED | BLANK | 200 | 2041 | 4 |  |
| `/market-intelligence` | FLAGGED | BLANK | 200 | 2036 | 4 |  |
| `/compliance` | FOUNDER | BLANK | 200 | 2028 | 4 |  |
| `/tax-researcher` | FOUNDER | BLANK | 200 | 1991 | 4 |  |
| `/document-intelligence` | FOUNDER | BLANK | 200 | 2006 | 4 |  |
| `/admin/beta` | FOUNDER | TIMEOUT | 200 | 2387 | 10 | 2 failed XHR |
| `/admin/safety-gates` | FOUNDER | TIMEOUT | 200 | 2492 | 10 | 1 failed XHR |
| `/admin/decisions` | PROTECTED | TIMEOUT | 200 | 16871 | 5 |  |
| `/decision-queue` | FOUNDER | DEGRADED | 200 | 2054 | 23 |  |
| `/admin/ops` | FOUNDER | TIMEOUT | 200 | 2367 | 10 | 2 failed XHR |
| `/admin/beta-intake` | FOUNDER | TIMEOUT | 200 | 2428 | 10 | 1 failed XHR |
| `/founder/beta-analytics` | FOUNDER | TIMEOUT | 200 | 2517 | 10 | 2 failed XHR |
| `/founder/agents` | FOUNDER | TIMEOUT | 200 | 2471 | 10 | 1 failed XHR |
| `/founder/daily-digest` | FOUNDER | TIMEOUT | 200 | 2483 | 10 | 1 failed XHR |
| `/founder/decisions` | FOUNDER | TIMEOUT | 200 | 2291 | 10 | 2 failed XHR |
| `/founder/letter` | FOUNDER | TIMEOUT | 200 | 2423 | 9 | 2 failed XHR |
| `/founder/settings` | FOUNDER | DEGRADED | 200 | 8145 | 7 |  |
| `/founder/preview` | FOUNDER | DEGRADED | 200 | 2038 | 2 |  |
| `/founder/tools` | FOUNDER | AUTH_REDIRECT | 200 | 8083 | 8 |  |
| `/founder/prompt-evolutions` | FOUNDER | AUTH_REDIRECT | 200 | 8119 | 5 |  |
| `/founder/prompt-history` | FOUNDER | AUTH_REDIRECT | 200 | 8076 | 5 |  |
| `/founder/traces` | FOUNDER | AUTH_REDIRECT | 200 | 8060 | 5 |  |
| `/founder/strategy` | FOUNDER | AUTH_REDIRECT | 200 | 8149 | 5 |  |
| `/founder/trends` | FOUNDER | AUTH_REDIRECT | 200 | 8088 | 5 |  |
| `/founder/onboarding` | FOUNDER | AUTH_REDIRECT | 200 | 8080 | 5 |  |
| `/founder/expansion` | FOUNDER | AUTH_REDIRECT | 200 | 8075 | 5 |  |
| `/founder/experiments` | FOUNDER | AUTH_REDIRECT | 200 | 8092 | 5 |  |
| `/founder/providers` | FOUNDER | AUTH_REDIRECT | 200 | 8223 | 5 |  |
| `/founder/todo` | FOUNDER | AUTH_REDIRECT | 200 | 8011 | 5 |  |
| `/executive-dashboard` | FOUNDER | AUTH_REDIRECT | 200 | 8096 | 5 |  |
| `/deal-underwriting` | PROTECTED | TIMEOUT | 200 | 16808 | 4 |  |
| `/deal-feed` | PROTECTED | TIMEOUT | 200 | 16870 | 4 |  |
| `/market-data` | PROTECTED | TIMEOUT | 200 | 16822 | 4 |  |
| `/team-kpi` | PROTECTED | TIMEOUT | 200 | 16787 | 4 |  |
| `/forecasting` | PROTECTED | TIMEOUT | 200 | 16783 | 4 |  |
| `/portfolio-health` | PROTECTED | TIMEOUT | 200 | 16813 | 4 |  |
| `/portfolio-pnl` | PROTECTED | TIMEOUT | 200 | 16780 | 4 |  |
| `/exchange-1031` | PROTECTED | TIMEOUT | 200 | 16848 | 4 |  |
| `/tax-optimizer` | PROTECTED | TIMEOUT | 200 | 16785 | 4 |  |
| `/tax-delinquent` | PROTECTED | TIMEOUT | 200 | 16779 | 4 |  |
| `/bookkeeping` | FOUNDER | TIMEOUT | 200 | 16866 | 4 |  |
| `/depreciation` | FOUNDER | TIMEOUT | 200 | 16870 | 4 |  |
| `/closing-costs` | FOUNDER | TIMEOUT | 200 | 16785 | 4 |  |
| `/property-tax` | FOUNDER | TIMEOUT | 200 | 16791 | 4 |  |
| `/fee-dashboard` | FOUNDER | AUTH_REDIRECT | 200 | 8098 | 5 |  |
| `/avm-bulk` | FLAGGED | BLANK | 200 | 1874 | 1 |  |
| `/market-watchlist` | FLAGGED | BLANK | 200 | 1961 | 4 |  |
| `/price-optimizer` | PROTECTED | BLANK | 200 | 1997 | 4 |  |
| `/seller-intent` | PROTECTED | BLANK | 200 | 2010 | 4 |  |
| `/deal-patterns` | PROTECTED | BLANK | 200 | 2037 | 4 |  |
| `/conscious-organization` | FOUNDER | TIMEOUT | 200 | 16907 | 7 |  |
| `/anticipatory-enterprise` | FOUNDER | AUTH_REDIRECT | 200 | 7985 | 5 |  |
| `/real-runtime` | PROTECTED | TIMEOUT | 200 | 16886 | 4 |  |
| `/agent-command-center` | PROTECTED | TIMEOUT | 200 | 16842 | 4 |  |
| `/zoning` | PROTECTED | TIMEOUT | 200 | 16783 | 4 |  |
| `/title-search` | PROTECTED | TIMEOUT | 200 | 16797 | 4 |  |
| `/property-enrichment` | PROTECTED | TIMEOUT | 200 | 16806 | 4 |  |
| `/skip-tracing` | PROTECTED | TIMEOUT | 200 | 16793 | 4 |  |
| `/direct-mail` | PROTECTED | TIMEOUT | 200 | 16871 | 4 |  |
| `/syndication` | PROTECTED | TIMEOUT | 200 | 16773 | 4 |  |
| `/syndication-status` | PROTECTED | TIMEOUT | 200 | 16792 | 4 |  |
| `/commissions` | PROTECTED | TIMEOUT | 200 | 16777 | 4 |  |
| `/team-leaderboard` | PROTECTED | TIMEOUT | 200 | 16842 | 4 |  |
| `/kpis` | PROTECTED | TIMEOUT | 200 | 16832 | 4 |  |
| `/cohort-analysis` | PROTECTED | TIMEOUT | 200 | 16776 | 4 |  |
| `/audit-log` | PROTECTED | TIMEOUT | 200 | 16780 | 4 |  |
| `/data-export` | PROTECTED | TIMEOUT | 200 | 16782 | 4 |  |
| `/import` | PROTECTED | TIMEOUT | 200 | 16794 | 4 |  |
| `/model-training` | PROTECTED | TIMEOUT | 200 | 16859 | 4 |  |
| `/investor-network` | PROTECTED | TIMEOUT | 200 | 16796 | 4 |  |
| `/regulatory-intel` | PROTECTED | TIMEOUT | 200 | 16835 | 4 |  |
| `/settings/privacy` | PROTECTED | TIMEOUT | 200 | 16925 | 4 |  |
| `/settings/tax-identity` | PROTECTED | TIMEOUT | 200 | 16791 | 4 |  |
| `/settings/accessibility` | PROTECTED | TIMEOUT | 200 | 16818 | 4 |  |
| `/usage` | PROTECTED | TIMEOUT | 200 | 16821 | 4 |  |
| `/goals` | PROTECTED | TIMEOUT | 200 | 16861 | 4 |  |
| `/webhooks` | PROTECTED | TIMEOUT | 200 | 16781 | 4 |  |
| `/dodd-frank` | PROTECTED | BLANK | 200 | 1885 | 1 |  |
| `/state-documents` | PROTECTED | TIMEOUT | 200 | 17091 | 7 |  |
| `/dunning` | PROTECTED | TIMEOUT | 200 | 16867 | 4 |  |
| `/freedom-meter` | FOUNDER | TIMEOUT | 200 | 16830 | 4 |  |
| `/blind-offer-wizard` | FOUNDER | DEGRADED | 200 | 2065 | 20 |  |
| `/night-cap` | FOUNDER | TIMEOUT | 200 | 16896 | 5 |  |
| `/evening-review` | FOUNDER | DEGRADED | 200 | 2026 | 5 |  |
| `/founder/v13` | FOUNDER | TIMEOUT | 200 | 2412 | 10 | 2 failed XHR |
| `/founder/agents/:codename` | FOUNDER | TIMEOUT | 200 | 2558 | 10 | 1 failed XHR |
| `/admin/beta-analytics` | FOUNDER | TIMEOUT | 200 | 2487 | 10 | 2 failed XHR |
| `/admin/queues` | FOUNDER | TIMEOUT | 200 | 2684 | 10 | 3 failed XHR |
| `/admin/integrations-health` | FOUNDER | TIMEOUT | 200 | 2293 | 10 | 2 failed XHR |
| `/admin/monitor` | FOUNDER | TIMEOUT | 200 | 16850 | 5 |  |
| `/reseller` | FOUNDER | DEGRADED | 200 | 2029 | 2 |  |
| `/data-moat` | FOUNDER | TIMEOUT | 200 | 2581 | 10 | 1 failed XHR |
| `/sovereign` | FOUNDER | TIMEOUT | 200 | 2433 | 9 | 2 failed XHR |
| `/board-of-directors` | FOUNDER | DEGRADED | 200 | 8601 | 13 |  |
| `/agent-performance` | FOUNDER | DEGRADED | 200 | 8405 | 6 |  |
| `/memory-browser` | FOUNDER | DEGRADED | 200 | 2379 | 35 |  |
| `/event-log` | FOUNDER | AUTH_REDIRECT | 200 | 8174 | 8 |  |
| `/job-health` | FOUNDER | AUTH_REDIRECT | 200 | 8366 | 5 |  |
| `/agent-collaboration` | FOUNDER | AUTH_REDIRECT | 200 | 8199 | 5 |  |

## Common patterns (3+ routes)

- **470× routes:** `Failed to load resource: the server responded with a status of 429 ()`
- **325× routes:** `Failed to load resource: the server responded with a status of 401 ()`
- **118× routes:** `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js`
- **13× routes:** `Failed to load resource: the server responded with a status of 404 ()`
- **10× routes:** `[Query Error] Error: 429: Rate limit exceeded. Maximum 120 requests per 60 secon`
- **9× routes:** `[Query Error] Error: Failed to load organizations
    at queryFn (https://acreos`
- **3× routes:** `[Query Error — suppressed toast] Error: 404: Not found
    at Lh (https://acreos`

## Common failed network requests

- **19× routes:** `/__clerk/v1/client/sessions/sess_3DPqEE19XvYlhPpoI0Sq3eHbBI3/touch`
- **10× routes:** `/today`

## Per-route detail (non-HEALTHY)

### `/auth` — DEGRADED

- **Kind:** PUBLIC
- **Final URL:** https://acreos.io/today
- **HTTP:** 200
- **TTI:** 3072ms
- **Render:** main=0c body=103c spinner=true loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Failed requests (top 5):**
  - `https://acreos.io/__clerk/v1/client/sessions/sess_3DPqEE19XvYlhPpoI0Sq3eHbBI3/touch?__clerk_api_version=2025-11-10&_clerk_js_version=6.7.4` (net::ERR_ABORTED)
  - `https://acreos.io/__clerk/v1/client/sessions/sess_3DPqEE19XvYlhPpoI0Sq3eHbBI3/touch?__clerk_api_version=2025-11-10&_clerk_js_version=6.7.4` (net::ERR_ABORTED)
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-auth.png`

### `/portal` — DEGRADED

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/portal
- **HTTP:** 200
- **TTI:** 1898ms
- **Render:** main=374c body=482c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-portal.png`

### `/sign/:docId` — DEGRADED

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/sign/demo-doc
- **HTTP:** 200
- **TTI:** 1910ms
- **Render:** main=290c body=398c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-sign-docid.png`

### `/portal/:accessToken` — DEGRADED

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/portal/demo-token
- **HTTP:** 200
- **TTI:** 1887ms
- **Render:** main=189c body=297c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-portal-accesstoken.png`

### `/onboarding-v2` — DEGRADED

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/onboarding-v2
- **HTTP:** 200
- **TTI:** 1946ms
- **Render:** main=741c body=849c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-onboarding-v2.png`

### `/welcome-back` — DEGRADED

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/welcome-back
- **HTTP:** 200
- **TTI:** 1941ms
- **Render:** main=2205c body=2313c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-welcome-back.png`

### `/` — DEGRADED

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/today
- **HTTP:** 200
- **TTI:** 1999ms
- **Render:** main=1268c body=1527c spinner=true loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 404 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-root.png`

### `/today` — DEGRADED

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/today
- **HTTP:** 200
- **TTI:** 2025ms
- **Render:** main=2446c body=2705c spinner=true loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 404 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-today.png`

### `/dashboard` — DEGRADED

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/today
- **HTTP:** 200
- **TTI:** 2065ms
- **Render:** main=2446c body=2705c spinner=true loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 404 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-dashboard.png`

### `/pipeline` — DEGRADED

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/deals
- **HTTP:** 200
- **TTI:** 1968ms
- **Render:** main=1375c body=1483c spinner=true loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-pipeline.png`

### `/money` — DEGRADED

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/money
- **HTTP:** 200
- **TTI:** 1963ms
- **Render:** main=1597c body=1705c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-money.png`

### `/ai` — DEGRADED

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/ai
- **HTTP:** 200
- **TTI:** 1948ms
- **Render:** main=1754c body=2009c spinner=true loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: Rate limit exceeded. Maximum 120 requests per 60 seconds allowed.
    at Lh (https://acreos.io/assets/index-CAqWKXK0.js:23:28675)
    at async https://acreos.io/assets/index-CAqWKXK0.js:23:31649`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-ai.png`

### `/pax` — DEGRADED

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/ai
- **HTTP:** 200
- **TTI:** 1953ms
- **Render:** main=1754c body=2009c spinner=true loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: Rate limit exceeded. Maximum 120 requests per 60 seconds allowed.
    at Lh (https://acreos.io/assets/index-CAqWKXK0.js:23:28675)
    at async https://acreos.io/assets/index-CAqWKXK0.js:23:31649`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-pax.png`

### `/leads` — DEGRADED

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/leads
- **HTTP:** 200
- **TTI:** 2021ms
- **Render:** main=2123c body=2231c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-leads.png`

### `/leads/dedupe` — DEGRADED

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/leads/dedupe
- **HTTP:** 200
- **TTI:** 8065ms
- **Render:** main=673c body=868c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 400 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-leads-dedupe.png`

### `/leads/:id` — DEGRADED

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/leads/1
- **HTTP:** 200
- **TTI:** 2050ms
- **Render:** main=887c body=995c spinner=true loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-leads-id.png`

### `/properties` — DEGRADED

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/properties
- **HTTP:** 200
- **TTI:** 2054ms
- **Render:** main=654c body=901c spinner=true loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: Failed to load organizations
    at queryFn (https://acreos.io/assets/page-shell-By_OxZUR.js:1:945)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-properties.png`

### `/parcels/:id` — DEGRADED

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/parcels/1
- **HTTP:** 200
- **TTI:** 1990ms
- **Render:** main=997c body=1169c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: Failed to load organizations
    at queryFn (https://acreos.io/assets/page-shell-By_OxZUR.js:1:945)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-parcels-id.png`

### `/deals` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/deals
- **HTTP:** 200
- **TTI:** 16791ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-deals.png`

### `/deals/:id` — DEGRADED

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/deals/1
- **HTTP:** 200
- **TTI:** 1993ms
- **Render:** main=807c body=1103c spinner=true loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: Failed to load organizations
    at queryFn (https://acreos.io/assets/page-shell-By_OxZUR.js:1:945)`
  - `Failed to load resource: the server responded with a status of 404 ()`
  - `[Query Error — suppressed toast] Error: Failed to load document packages (404)
    at queryFn (https://acreos.io/assets/deal-detail-BVyltqyG.js:1:6915)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-deals-id.png`

### `/tasks` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/tasks
- **HTTP:** 200
- **TTI:** 16799ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-tasks.png`

### `/team-dashboard` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/team-dashboard
- **HTTP:** 200
- **TTI:** 16772ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-team-dashboard.png`

### `/team/dashboard` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/team/dashboard
- **HTTP:** 200
- **TTI:** 16791ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-team-dashboard.png`

### `/team/offer-approvals` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/team/offer-approvals
- **HTTP:** 200
- **TTI:** 16776ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-team-offer-approvals.png`

### `/settings/lead-assignment` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/settings/lead-assignment
- **HTTP:** 200
- **TTI:** 16768ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-settings-lead-assignment.png`

### `/settings/integrations` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/settings/integrations
- **HTTP:** 200
- **TTI:** 16775ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-settings-integrations.png`

### `/team` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/team
- **HTTP:** 200
- **TTI:** 16780ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-team.png`

### `/team-inbox` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/team
- **HTTP:** 200
- **TTI:** 16847ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-team-inbox.png`

### `/automation` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/automation
- **HTTP:** 200
- **TTI:** 16821ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-automation.png`

### `/workflows` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/workflows
- **HTTP:** 200
- **TTI:** 16781ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-workflows.png`

### `/activity` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/activity
- **HTTP:** 200
- **TTI:** 16793ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-activity.png`

### `/analytics` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/analytics
- **HTTP:** 200
- **TTI:** 16784ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-analytics.png`

### `/finance` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/finance
- **HTTP:** 200
- **TTI:** 16789ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-finance.png`

### `/notes` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/notes
- **HTTP:** 200
- **TTI:** 16863ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-notes.png`

### `/portfolio` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/portfolio
- **HTTP:** 200
- **TTI:** 16853ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-portfolio.png`

### `/campaigns` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/campaigns
- **HTTP:** 200
- **TTI:** 16789ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-campaigns.png`

### `/ab-tests` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/ab-tests
- **HTTP:** 200
- **TTI:** 16850ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-ab-tests.png`

### `/sequences` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/sequences
- **HTTP:** 200
- **TTI:** 16801ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-sequences.png`

### `/counties` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/counties
- **HTTP:** 200
- **TTI:** 16778ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-counties.png`

### `/offers` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/offers
- **HTTP:** 200
- **TTI:** 16779ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-offers.png`

### `/offers/batches` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/offers/batches
- **HTTP:** 200
- **TTI:** 16805ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-offers-batches.png`

### `/listings` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/listings
- **HTTP:** 200
- **TTI:** 16779ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-listings.png`

### `/documents` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/documents
- **HTTP:** 200
- **TTI:** 16871ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-documents.png`

### `/tools` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/tools
- **HTTP:** 200
- **TTI:** 16780ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-tools.png`

### `/command-center` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/ai#chat
- **HTTP:** 200
- **TTI:** 16777ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-command-center.png`

### `/agents` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/ai#agents
- **HTTP:** 200
- **TTI:** 16791ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-agents.png`

### `/ai-team` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/ai#agents
- **HTTP:** 200
- **TTI:** 16842ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-ai-team.png`

### `/support` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/support
- **HTTP:** 200
- **TTI:** 16836ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-support.png`

### `/settings` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/settings
- **HTTP:** 200
- **TTI:** 16787ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-settings.png`

### `/my-letter` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/my-letter
- **HTTP:** 200
- **TTI:** 16853ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-my-letter.png`

### `/settings/email` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/settings/email
- **HTTP:** 200
- **TTI:** 16784ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-settings-email.png`

### `/settings/mail` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/settings/mail
- **HTTP:** 200
- **TTI:** 16866ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-settings-mail.png`

### `/inbox` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/inbox
- **HTTP:** 200
- **TTI:** 16795ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-inbox.png`

### `/help` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/help
- **HTTP:** 200
- **TTI:** 16832ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-help.png`

### `/admin/support` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/admin/support
- **HTTP:** 200
- **TTI:** 16869ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-admin-support.png`

### `/marketplace` — BLANK

- **Kind:** FLAGGED
- **Final URL:** https://acreos.io/marketplace
- **HTTP:** 200
- **TTI:** 1971ms
- **Render:** main=0c body=15c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-marketplace.png`

### `/land-credit` — BLANK

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/land-credit
- **HTTP:** 200
- **TTI:** 2023ms
- **Render:** main=0c body=15c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-land-credit.png`

### `/radar` — BLANK

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/radar
- **HTTP:** 200
- **TTI:** 2037ms
- **Render:** main=0c body=15c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-radar.png`

### `/portfolio-optimizer` — BLANK

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/portfolio-optimizer
- **HTTP:** 200
- **TTI:** 2002ms
- **Render:** main=0c body=15c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-portfolio-optimizer.png`

### `/avm` — BLANK

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/avm
- **HTTP:** 200
- **TTI:** 2020ms
- **Render:** main=0c body=15c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-avm.png`

### `/maps` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/maps
- **HTTP:** 200
- **TTI:** 16919ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-maps.png`

### `/negotiation` — BLANK

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/negotiation
- **HTTP:** 200
- **TTI:** 1951ms
- **Render:** main=0c body=15c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-negotiation.png`

### `/cash-flow` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/cash-flow
- **HTTP:** 200
- **TTI:** 16886ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-cash-flow.png`

### `/deal-hunter` — BLANK

- **Kind:** FLAGGED
- **Final URL:** https://acreos.io/deal-hunter
- **HTTP:** 200
- **TTI:** 1880ms
- **Render:** main=0c body=15c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-deal-hunter.png`

### `/vision-ai` — BLANK

- **Kind:** FLAGGED
- **Final URL:** https://acreos.io/vision-ai
- **HTTP:** 200
- **TTI:** 2026ms
- **Render:** main=0c body=15c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-vision-ai.png`

### `/capital-markets` — BLANK

- **Kind:** FLAGGED
- **Final URL:** https://acreos.io/capital-markets
- **HTTP:** 200
- **TTI:** 2041ms
- **Render:** main=0c body=15c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-capital-markets.png`

### `/market-intelligence` — BLANK

- **Kind:** FLAGGED
- **Final URL:** https://acreos.io/market-intelligence
- **HTTP:** 200
- **TTI:** 2036ms
- **Render:** main=0c body=15c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-market-intelligence.png`

### `/compliance` — BLANK

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/compliance
- **HTTP:** 200
- **TTI:** 2028ms
- **Render:** main=0c body=15c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-compliance.png`

### `/tax-researcher` — BLANK

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/tax-researcher
- **HTTP:** 200
- **TTI:** 1991ms
- **Render:** main=0c body=15c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-tax-researcher.png`

### `/document-intelligence` — BLANK

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/document-intelligence
- **HTTP:** 200
- **TTI:** 2006ms
- **Render:** main=0c body=15c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-document-intelligence.png`

### `/admin/beta` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/today
- **HTTP:** 200
- **TTI:** 2387ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Failed requests (top 5):**
  - `https://acreos.io/today` (net::ERR_ABORTED)
  - `https://acreos.io/__clerk/v1/client/sessions/sess_3DPqEE19XvYlhPpoI0Sq3eHbBI3/touch?__clerk_api_version=2025-11-10&_clerk_js_version=6.7.4` (net::ERR_ABORTED)
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-admin-beta.png`

### `/admin/safety-gates` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/today
- **HTTP:** 200
- **TTI:** 2492ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Failed requests (top 5):**
  - `https://acreos.io/__clerk/v1/client/sessions/sess_3DPqEE19XvYlhPpoI0Sq3eHbBI3/touch?__clerk_api_version=2025-11-10&_clerk_js_version=6.7.4` (net::ERR_ABORTED)
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-admin-safety-gates.png`

### `/admin/decisions` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/admin/decisions
- **HTTP:** 200
- **TTI:** 16871ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-admin-decisions.png`

### `/decision-queue` — DEGRADED

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/admin/decisions
- **HTTP:** 200
- **TTI:** 2054ms
- **Render:** main=539c body=711c spinner=true loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `[Query Error] Error: Failed to load organizations
    at queryFn (https://acreos.io/assets/page-shell-By_OxZUR.js:1:945)`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-decision-queue.png`

### `/admin/ops` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/today
- **HTTP:** 200
- **TTI:** 2367ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Failed requests (top 5):**
  - `https://acreos.io/today` (net::ERR_ABORTED)
  - `https://acreos.io/__clerk/v1/client/sessions/sess_3DPqEE19XvYlhPpoI0Sq3eHbBI3/touch?__clerk_api_version=2025-11-10&_clerk_js_version=6.7.4` (net::ERR_ABORTED)
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-admin-ops.png`

### `/admin/beta-intake` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/today
- **HTTP:** 200
- **TTI:** 2428ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Failed requests (top 5):**
  - `https://acreos.io/__clerk/v1/client/sessions/sess_3DPqEE19XvYlhPpoI0Sq3eHbBI3/touch?__clerk_api_version=2025-11-10&_clerk_js_version=6.7.4` (net::ERR_ABORTED)
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-admin-beta-intake.png`

### `/founder/beta-analytics` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/today
- **HTTP:** 200
- **TTI:** 2517ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Failed requests (top 5):**
  - `https://acreos.io/today` (net::ERR_ABORTED)
  - `https://acreos.io/__clerk/v1/client/sessions/sess_3DPqEE19XvYlhPpoI0Sq3eHbBI3/touch?__clerk_api_version=2025-11-10&_clerk_js_version=6.7.4` (net::ERR_ABORTED)
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-founder-beta-analytics.png`

### `/founder/agents` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/today
- **HTTP:** 200
- **TTI:** 2471ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Failed requests (top 5):**
  - `https://acreos.io/__clerk/v1/client/sessions/sess_3DPqEE19XvYlhPpoI0Sq3eHbBI3/touch?__clerk_api_version=2025-11-10&_clerk_js_version=6.7.4` (net::ERR_ABORTED)
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-founder-agents.png`

### `/founder/daily-digest` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/today
- **HTTP:** 200
- **TTI:** 2483ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Failed requests (top 5):**
  - `https://acreos.io/__clerk/v1/client/sessions/sess_3DPqEE19XvYlhPpoI0Sq3eHbBI3/touch?__clerk_api_version=2025-11-10&_clerk_js_version=6.7.4` (net::ERR_ABORTED)
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-founder-daily-digest.png`

### `/founder/decisions` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/today
- **HTTP:** 200
- **TTI:** 2291ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Failed requests (top 5):**
  - `https://acreos.io/today` (net::ERR_ABORTED)
  - `https://acreos.io/__clerk/v1/client/sessions/sess_3DPqEE19XvYlhPpoI0Sq3eHbBI3/touch?__clerk_api_version=2025-11-10&_clerk_js_version=6.7.4` (net::ERR_ABORTED)
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-founder-decisions.png`

### `/founder/letter` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/today
- **HTTP:** 200
- **TTI:** 2423ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Failed requests (top 5):**
  - `https://acreos.io/today` (net::ERR_ABORTED)
  - `https://acreos.io/__clerk/v1/client/sessions/sess_3DPqEE19XvYlhPpoI0Sq3eHbBI3/touch?__clerk_api_version=2025-11-10&_clerk_js_version=6.7.4` (net::ERR_ABORTED)
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-founder-letter.png`

### `/founder/settings` — DEGRADED

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/founder/settings
- **HTTP:** 200
- **TTI:** 8145ms
- **Render:** main=2243c body=2415c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-founder-settings.png`

### `/founder/preview` — DEGRADED

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/founder/preview
- **HTTP:** 200
- **TTI:** 2038ms
- **Render:** main=907c body=1079c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: Failed to load organizations
    at queryFn (https://acreos.io/assets/page-shell-By_OxZUR.js:1:945)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-founder-preview.png`

### `/deal-underwriting` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/deal-underwriting
- **HTTP:** 200
- **TTI:** 16808ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-deal-underwriting.png`

### `/deal-feed` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/deal-feed
- **HTTP:** 200
- **TTI:** 16870ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-deal-feed.png`

### `/market-data` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/market-data
- **HTTP:** 200
- **TTI:** 16822ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-market-data.png`

### `/team-kpi` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/team-kpi
- **HTTP:** 200
- **TTI:** 16787ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-team-kpi.png`

### `/forecasting` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/forecasting
- **HTTP:** 200
- **TTI:** 16783ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-forecasting.png`

### `/portfolio-health` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/portfolio-health
- **HTTP:** 200
- **TTI:** 16813ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-portfolio-health.png`

### `/portfolio-pnl` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/portfolio-pnl
- **HTTP:** 200
- **TTI:** 16780ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-portfolio-pnl.png`

### `/exchange-1031` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/exchange-1031
- **HTTP:** 200
- **TTI:** 16848ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-exchange-1031.png`

### `/tax-optimizer` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/tax-optimizer
- **HTTP:** 200
- **TTI:** 16785ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-tax-optimizer.png`

### `/tax-delinquent` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/tax-delinquent
- **HTTP:** 200
- **TTI:** 16779ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-tax-delinquent.png`

### `/bookkeeping` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/bookkeeping
- **HTTP:** 200
- **TTI:** 16866ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-bookkeeping.png`

### `/depreciation` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/depreciation
- **HTTP:** 200
- **TTI:** 16870ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-depreciation.png`

### `/closing-costs` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/closing-costs
- **HTTP:** 200
- **TTI:** 16785ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-closing-costs.png`

### `/property-tax` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/property-tax
- **HTTP:** 200
- **TTI:** 16791ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-property-tax.png`

### `/avm-bulk` — BLANK

- **Kind:** FLAGGED
- **Final URL:** https://acreos.io/avm-bulk
- **HTTP:** 200
- **TTI:** 1874ms
- **Render:** main=0c body=15c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-avm-bulk.png`

### `/market-watchlist` — BLANK

- **Kind:** FLAGGED
- **Final URL:** https://acreos.io/market-watchlist
- **HTTP:** 200
- **TTI:** 1961ms
- **Render:** main=0c body=15c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-market-watchlist.png`

### `/price-optimizer` — BLANK

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/price-optimizer
- **HTTP:** 200
- **TTI:** 1997ms
- **Render:** main=0c body=15c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-price-optimizer.png`

### `/seller-intent` — BLANK

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/seller-intent
- **HTTP:** 200
- **TTI:** 2010ms
- **Render:** main=0c body=15c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-seller-intent.png`

### `/deal-patterns` — BLANK

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/deal-patterns
- **HTTP:** 200
- **TTI:** 2037ms
- **Render:** main=0c body=15c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-deal-patterns.png`

### `/conscious-organization` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/conscious-organization
- **HTTP:** 200
- **TTI:** 16907ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-conscious-organization.png`

### `/real-runtime` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/real-runtime
- **HTTP:** 200
- **TTI:** 16886ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-real-runtime.png`

### `/agent-command-center` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/ai#agents
- **HTTP:** 200
- **TTI:** 16842ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-agent-command-center.png`

### `/zoning` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/zoning
- **HTTP:** 200
- **TTI:** 16783ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-zoning.png`

### `/title-search` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/title-search
- **HTTP:** 200
- **TTI:** 16797ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-title-search.png`

### `/property-enrichment` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/property-enrichment
- **HTTP:** 200
- **TTI:** 16806ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-property-enrichment.png`

### `/skip-tracing` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/skip-tracing
- **HTTP:** 200
- **TTI:** 16793ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-skip-tracing.png`

### `/direct-mail` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/direct-mail
- **HTTP:** 200
- **TTI:** 16871ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-direct-mail.png`

### `/syndication` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/syndication
- **HTTP:** 200
- **TTI:** 16773ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-syndication.png`

### `/syndication-status` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/syndication-status
- **HTTP:** 200
- **TTI:** 16792ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-syndication-status.png`

### `/commissions` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/commissions
- **HTTP:** 200
- **TTI:** 16777ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-commissions.png`

### `/team-leaderboard` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/team-leaderboard
- **HTTP:** 200
- **TTI:** 16842ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-team-leaderboard.png`

### `/kpis` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/kpis
- **HTTP:** 200
- **TTI:** 16832ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-kpis.png`

### `/cohort-analysis` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/cohort-analysis
- **HTTP:** 200
- **TTI:** 16776ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-cohort-analysis.png`

### `/audit-log` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/audit-log
- **HTTP:** 200
- **TTI:** 16780ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-audit-log.png`

### `/data-export` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/data-export
- **HTTP:** 200
- **TTI:** 16782ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-data-export.png`

### `/import` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/import
- **HTTP:** 200
- **TTI:** 16794ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-import.png`

### `/model-training` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/model-training
- **HTTP:** 200
- **TTI:** 16859ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-model-training.png`

### `/investor-network` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/investor-network
- **HTTP:** 200
- **TTI:** 16796ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-investor-network.png`

### `/regulatory-intel` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/regulatory-intel
- **HTTP:** 200
- **TTI:** 16835ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-regulatory-intel.png`

### `/settings/privacy` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/settings/privacy
- **HTTP:** 200
- **TTI:** 16925ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-settings-privacy.png`

### `/settings/tax-identity` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/settings/tax-identity
- **HTTP:** 200
- **TTI:** 16791ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-settings-tax-identity.png`

### `/settings/accessibility` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/settings/accessibility
- **HTTP:** 200
- **TTI:** 16818ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-settings-accessibility.png`

### `/usage` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/usage
- **HTTP:** 200
- **TTI:** 16821ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-usage.png`

### `/goals` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/goals
- **HTTP:** 200
- **TTI:** 16861ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-goals.png`

### `/webhooks` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/webhooks
- **HTTP:** 200
- **TTI:** 16781ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-webhooks.png`

### `/dodd-frank` — BLANK

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/dodd-frank
- **HTTP:** 200
- **TTI:** 1885ms
- **Render:** main=0c body=15c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-dodd-frank.png`

### `/state-documents` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/state-documents
- **HTTP:** 200
- **TTI:** 17091ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-state-documents.png`

### `/dunning` — TIMEOUT

- **Kind:** PROTECTED
- **Final URL:** https://acreos.io/dunning
- **HTTP:** 200
- **TTI:** 16867ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-dunning.png`

### `/freedom-meter` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/freedom-meter
- **HTTP:** 200
- **TTI:** 16830ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `[Query Error] Error: 429: 
    at TI (https://acreos.io/assets/index-CAqWKXK0.js:23:38505)`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-freedom-meter.png`

### `/blind-offer-wizard` — DEGRADED

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/blind-offer-wizard
- **HTTP:** 200
- **TTI:** 2065ms
- **Render:** main=1598c body=1770c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `[Query Error] Error: Failed to load organizations
    at queryFn (https://acreos.io/assets/page-shell-By_OxZUR.js:1:945)`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-blind-offer-wizard.png`

### `/night-cap` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/night-cap
- **HTTP:** 200
- **TTI:** 16896ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-night-cap.png`

### `/evening-review` — DEGRADED

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/evening-review
- **HTTP:** 200
- **TTI:** 2026ms
- **Render:** main=630c body=738c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-evening-review.png`

### `/founder/v13` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/today
- **HTTP:** 200
- **TTI:** 2412ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Failed requests (top 5):**
  - `https://acreos.io/today` (net::ERR_ABORTED)
  - `https://acreos.io/__clerk/v1/client/sessions/sess_3DPqEE19XvYlhPpoI0Sq3eHbBI3/touch?__clerk_api_version=2025-11-10&_clerk_js_version=6.7.4` (net::ERR_ABORTED)
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-founder-v13.png`

### `/founder/agents/:codename` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/today
- **HTTP:** 200
- **TTI:** 2558ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Failed requests (top 5):**
  - `https://acreos.io/__clerk/v1/client/sessions/sess_3DPqEE19XvYlhPpoI0Sq3eHbBI3/touch?__clerk_api_version=2025-11-10&_clerk_js_version=6.7.4` (net::ERR_ABORTED)
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-founder-agents-codename.png`

### `/admin/beta-analytics` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/today
- **HTTP:** 200
- **TTI:** 2487ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Failed requests (top 5):**
  - `https://acreos.io/today` (net::ERR_ABORTED)
  - `https://acreos.io/__clerk/v1/client/sessions/sess_3DPqEE19XvYlhPpoI0Sq3eHbBI3/touch?__clerk_api_version=2025-11-10&_clerk_js_version=6.7.4` (net::ERR_ABORTED)
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-admin-beta-analytics.png`

### `/admin/queues` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/today
- **HTTP:** 200
- **TTI:** 2684ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Failed requests (top 5):**
  - `https://acreos.io/today` (net::ERR_ABORTED)
  - `https://acreos.io/__clerk/v1/client/sessions/sess_3DPqEE19XvYlhPpoI0Sq3eHbBI3/touch?__clerk_api_version=2025-11-10&_clerk_js_version=6.7.4` (net::ERR_ABORTED)
  - `https://acreos.io/__clerk/v1/client/sessions/sess_3DPqEE19XvYlhPpoI0Sq3eHbBI3/touch?__clerk_api_version=2025-11-10&_clerk_js_version=6.7.4` (net::ERR_ABORTED)
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-admin-queues.png`

### `/admin/integrations-health` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/today
- **HTTP:** 200
- **TTI:** 2293ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Failed requests (top 5):**
  - `https://acreos.io/today` (net::ERR_ABORTED)
  - `https://acreos.io/__clerk/v1/client/sessions/sess_3DPqEE19XvYlhPpoI0Sq3eHbBI3/touch?__clerk_api_version=2025-11-10&_clerk_js_version=6.7.4` (net::ERR_ABORTED)
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-admin-integrations-health.png`

### `/admin/monitor` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/admin/monitor
- **HTTP:** 200
- **TTI:** 16850ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-admin-monitor.png`

### `/reseller` — DEGRADED

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/reseller
- **HTTP:** 200
- **TTI:** 2029ms
- **Render:** main=252c body=360c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-reseller.png`

### `/data-moat` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/today
- **HTTP:** 200
- **TTI:** 2581ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Failed requests (top 5):**
  - `https://acreos.io/__clerk/v1/client/sessions/sess_3DPqEE19XvYlhPpoI0Sq3eHbBI3/touch?__clerk_api_version=2025-11-10&_clerk_js_version=6.7.4` (net::ERR_ABORTED)
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-data-moat.png`

### `/sovereign` — TIMEOUT

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/today
- **HTTP:** 200
- **TTI:** 2433ms
- **Render:** main=17c body=33c spinner=true loading=true
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Failed requests (top 5):**
  - `https://acreos.io/today` (net::ERR_ABORTED)
  - `https://acreos.io/__clerk/v1/client/sessions/sess_3DPqEE19XvYlhPpoI0Sq3eHbBI3/touch?__clerk_api_version=2025-11-10&_clerk_js_version=6.7.4` (net::ERR_ABORTED)
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-sovereign.png`

### `/board-of-directors` — DEGRADED

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/board-of-directors
- **HTTP:** 200
- **TTI:** 8601ms
- **Render:** main=649c body=821c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-board-of-directors.png`

### `/agent-performance` — DEGRADED

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/agent-performance
- **HTTP:** 200
- **TTI:** 8405ms
- **Render:** main=650c body=758c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 429 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 404 ()`
  - `Failed to load resource: the server responded with a status of 404 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-agent-performance.png`

### `/memory-browser` — DEGRADED

- **Kind:** FOUNDER
- **Final URL:** https://acreos.io/memory-browser
- **HTTP:** 200
- **TTI:** 2379ms
- **Render:** main=949c body=1121c spinner=false loading=false
- **Console errors (top 5):**
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
  - `Failed to load resource: the server responded with a status of 401 ()`
- **Screenshot:** `docs/exhaustive-completion/auth-screenshots/_nav-audit-memory-browser.png`

## Recommended fix priority

1. **ERROR routes (highest)** — broken navigation surfaces; shipping this is
   user-blocking.
2. **BLANK routes on PUBLIC paths** — visible to unauthenticated visitors,
   includes landing/marketing pages.
3. **Common-pattern errors (3+ routes)** — single fix lands wide impact.
4. **DEGRADED routes** — render-but-noisy; lower urgency unless console
   error is itself functional (failed data fetches, not just CSP cosmetic).
5. **BLANK on protected routes** — only confirmable once auth coverage is
   wired up (see "Coverage caveat").
