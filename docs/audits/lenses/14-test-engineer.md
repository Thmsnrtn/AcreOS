# Lens 14 -- Test Engineer Audit

Generated: 2026-04-15
Auditor: Claude (automated)
Scope: Test infrastructure, coverage, quality, CI integration, critical-path verification

---

## Executive Summary

AcreOS has a surprisingly large test suite (171 test files, 3059 tests, 142/146 files passing) given the orientation doc's claim of "no tests running." The infrastructure uses **Vitest** for unit/integration tests, **Playwright** for E2E, and **k6** for load tests. However, the tests are fundamentally shallow: most "integration" tests are pure-logic state machine simulations with no actual server or database interaction. Of 121 server route files, **110 have zero corresponding test coverage**. The five critical paths identified in the orientation doc (auth, lead workflow, deal lifecycle, billing, founder ops) all have significant gaps. CI runs tests but the pre-commit hook and TypeScript checks are effectively disabled.

**Overall test confidence: LOW.** The suite catches logic regressions in isolated helpers but provides near-zero assurance that API endpoints, database operations, or authentication flows work correctly end-to-end.

---

## 1. Test Infrastructure

### 1.1 Frameworks & Configuration

| Layer | Tool | Config File | Status |
|-------|------|-------------|--------|
| Unit/Integration | Vitest 4.x | `vitest.config.ts` | Running, 4 failures |
| E2E | Playwright 1.49 | `playwright.config.ts` | Config present, requires live app + credentials |
| Load | k6 | `tests/load/` (13 scripts) | Manual execution only |
| Simulation | Playwright-based | `tests/simulation/` | Manual execution only |
| Coverage | @vitest/coverage-v8 | `vitest.config.ts` | Configured, 50% line threshold |
| HTTP testing | supertest 7.x | devDependency | Used in exactly 1 test file |

### 1.2 Test Setup (`tests/setup.ts`)

Sets hardcoded env vars including `DATABASE_URL` pointing to `localhost:5432/acreos_test`. Comment says "Actual DB calls should be mocked in individual tests," confirming the suite was designed to avoid real DB interaction.

### 1.3 Coverage Configuration

```
thresholds: { lines: 50 }
include: ["server/**/*.ts", "shared/**/*.ts"]
```

The 50% line threshold is aspirational -- coverage is not enforced because `npm run test:coverage` is only called in one CI job (`ci.yml` lint-and-typecheck) and that job has structural issues (see Section 4).

---

## 2. Test Inventory

### 2.1 File Counts

| Category | Files | Lines (approx) | Tests |
|----------|-------|-----------------|-------|
| Unit tests (`tests/unit/`) | ~130 (112 items in dir, incl. `agents/` subdir with 19 files) | ~29,000 | ~2,700 |
| Integration tests (`tests/integration/`) | 16 | ~6,000 | ~350 |
| E2E tests (`tests/e2e/`) | 18 spec + 2 setup | ~2,700 | unknown (not run) |
| Load tests (`tests/load/`) | 13 k6 scripts | N/A | manual |
| Simulation tests (`tests/simulation/`) | 7 spec files | N/A | manual |

### 2.2 Current Pass/Fail (Vitest)

```
Test Files:  4 failed | 142 passed (146)
Tests:       5 failed | 3054 passed (3059)
Duration:    26.77s
```

**Failing tests:**
- `tests/unit/sequenceOptimizer.test.ts` -- date calculation off-by-one
- `tests/unit/taxDelinquent.test.ts` -- 2 tests with year calculation errors (expects 2026, gets 2025; expects 2025, gets 2024)
- 2 other files (shown in truncated output)

These failures have not been addressed, indicating tests are not regularly monitored.

### 2.3 Skipped/Disabled Tests

111 occurrences of `describe.skip`, `it.skip`, or `test.skip` across 26 files. Notable:
- `tests/unit/aiRouter.test.ts`: 25 skipped tests
- `tests/e2e/layout-intelligence.spec.ts`: 13 skipped
- `tests/e2e/behavioral-intelligence.spec.ts`: 13 skipped
- `tests/e2e/perceptual-intelligence.spec.ts`: 11 skipped
- `tests/e2e/leads.spec.ts`: 5 skipped
- `tests/e2e/deals.spec.ts`: 3 skipped

---

## 3. Test Quality Analysis

### 3.1 P0 -- "Integration" Tests Are Pure Logic Simulations

**This is the most critical finding.** All 16 files in `tests/integration/` redefine types and business logic inline rather than importing and exercising actual server code. Examples:

- **`dealLifecycle.test.ts`**: Defines its own `DealStatus` type, `VALID_TRANSITIONS` map, `createMockDeal()`, and `transitionDeal()` -- none imported from the server. Tests the test's own state machine, not the application's.
- **`subscriptionLifecycle.test.ts`**: Defines `SubscriptionTier`, `TIER_LIMITS`, `createSubscription()`, `upgradeTier()`, `cancelSubscription()` etc. inline. Zero imports from server code. Tests never touch Stripe or database logic.
- **`campaignLifecycle.test.ts`**: Same pattern -- inline `CAMPAIGN_TRANSITIONS` map and local helper functions.
- **`multiTenantIsolation.test.ts`**: Defines its own in-memory arrays of orgs/leads/deals and tests `Array.filter()` operations against them.
- **`onboardingLifecycle.test.ts`**: Defines its own `STEPS_BY_PATH`, `createOrganization()`, `advanceStep()` inline.
- **`marketplace.test.ts`**: Mocks `../../server/db` entirely, then defines pure local functions `createListing()`, `placeBid()`, etc.

Only 2 integration test files actually import anything from server code:
- `autonomyPipeline.test.ts` (imports `checkHardGuardrails`)
- `providerPipeline.test.ts`

Only 1 file in the entire test suite uses `supertest` to make HTTP requests (`tests/unit/securityMiddleware.test.ts`), and even that mocks auth.

**Impact:** If the actual server's deal state machine, subscription logic, or campaign transitions diverge from the test's inline definitions, tests still pass. These tests prove nothing about production behavior.

### 3.2 P0 -- Unit Tests Also Frequently Redefine Logic

Many unit tests follow the same antipattern. Example:
- **`encryption.test.ts`**: Re-implements `encryptCredentials()` and `decryptCredentials()` with inline AES-256-GCM logic rather than importing from `server/services/encryption`. Tests the test's own crypto implementation.

### 3.3 P0 -- No HTTP Request Testing of API Endpoints

Despite 926 API endpoints and `supertest` being in devDependencies, only 1 test file makes actual HTTP requests. There is zero automated verification that:
- Route handlers return correct status codes
- Request validation (Zod schemas) works
- Middleware chains (auth -> org -> handler) execute correctly
- Error responses follow the `Errors.*` format
- Pagination, filtering, and sorting work

### 3.4 P0 -- No Database Integration Tests

Despite CI workflows (`test.yml`, `deploy.yml`, `staging.yml`) provisioning a PostgreSQL service, no test file connects to a real database. The `tests/setup.ts` explicitly says "Actual DB calls should be mocked." There are no tests verifying:
- Drizzle ORM queries produce correct SQL
- Schema migrations apply cleanly
- Foreign key constraints are enforced
- Multi-tenant `organizationId` scoping in actual queries
- Transaction rollback behavior

### 3.5 E2E Tests -- Reasonable but Unrunnable

The 18 Playwright E2E spec files are well-structured and cover real user interactions (auth flows, billing page, critical path navigation, leads/deals CRUD, accessibility). However:
- **Auth setup depends on `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` env vars** -- no test credentials are documented or provisioned
- **No seeded test data** -- tests must handle empty states
- **Many tests use soft passes** (`.catch(() => false)`, `count >= 0`) that never actually fail
- **Firefox disabled** due to Clerk middleware incompatibility
- **CI never runs Playwright** in `test.yml` or `deploy.yml` -- only `ci.yml` includes it, but that workflow has structural issues (references undefined jobs `unit-tests`, `integration-tests`, `e2e-tests` in the build job's `needs`)

---

## 4. CI Integration

### 4.1 Workflow Files

| Workflow | File | Test Steps | Status |
|----------|------|------------|--------|
| `test.yml` | Vitest run | TypeScript check + vitest run | Functional |
| `deploy.yml` | Pre-deploy gate | vitest run (no coverage) | Functional |
| `staging.yml` | Pre-deploy gate | vitest run | Functional |
| `ci.yml` | Full pipeline | tsc + test:coverage + Playwright | **Broken** |
| `security.yml` | Security scanning | npm audit + CodeQL + Trivy | No test steps |

### 4.2 P1 -- `ci.yml` Build Job References Undefined Jobs

```yaml
build:
  needs: [unit-tests, integration-tests, e2e-tests]
```

None of `unit-tests`, `integration-tests`, or `e2e-tests` are defined as jobs in `ci.yml`. The only job is `lint-and-typecheck`. This means the build job in CI never executes.

### 4.3 P1 -- Pre-commit Hook Effectively Disabled

`.githooks/pre-commit` runs `tsc --noEmit` but pipes output to `tail -3` and uses `||` to continue on failure:
```sh
npx tsc --noEmit 2>&1 | tail -3 || {
  echo "Warning: TypeScript warnings present (non-blocking)"
}
```
With 1,815 TypeScript errors, this always "warns" and passes. No tests run in the pre-commit hook.

### 4.4 P2 -- Vitest Failures Do Not Block Deploy

`deploy.yml` runs `npx vitest run` with no `--bail` or failure annotations. The 4 currently failing test files (5 failing tests) apparently do not block deployment, either because they have been failing for a while or because the CI run environment differs.

---

## 5. Critical Path Coverage Analysis

### 5.1 Path 1: New User Signup (Auth)

| Step | Tested? | How |
|------|---------|-----|
| Landing page load | Playwright `auth.spec.ts` | Soft E2E |
| Google OAuth flow | **NO** | Untested. Clerk OAuth is known fragile (P0 #1 in orientation) |
| Clerk session creation | **NO** | No Clerk SDK testing |
| `/api/auth/user` endpoint | **NO** | No HTTP test |
| `hydrateUser` middleware | **NO** | No test |
| `getOrCreateOrg` middleware | **NO** | No test (mocked in 1 file) |
| Onboarding wizard | Pure-logic only | `onboardingLifecycle.test.ts` tests inline simulation |
| `isFounderEmail` | Unit test | `auth.test.ts` -- imports real code, good |
| `requireFounder` middleware | Unit test | `auth.test.ts` -- imports real code with mocked req/res |

### 5.2 Path 2: Lead Workflow

| Step | Tested? | How |
|------|---------|-----|
| CSV import | Unit test | `import.test.ts` -- unknown if imports real code |
| Lead list API | **NO** | No HTTP test for `/api/leads` |
| Lead scoring | Unit test | `leadScoring.test.ts` |
| Campaign creation | Pure-logic | `campaignLifecycle.test.ts` (inline state machine) |
| Campaign send (SES/Twilio) | **NO** | No tests for actual send logic |
| Follow-up sequences | Unit test | `sequenceOptimizer.test.ts` (1 test failing) |

### 5.3 Path 3: Deal Lifecycle

| Step | Tested? | How |
|------|---------|-----|
| Lead to Offer | Pure-logic | `dealLifecycle.test.ts` (inline state machine) |
| Due diligence | **NO** | `routes-due-diligence.ts` has no test |
| Closing | **NO** | `routes-closing.ts` has no test |
| Note servicing | Pure-logic | `noteLifecycle.test.ts` |
| Payment recording | **NO** | No payment processing test |

### 5.4 Path 4: Billing (Stripe)

| Step | Tested? | How |
|------|---------|-----|
| Stripe checkout redirect | **NO** | No test for checkout session creation |
| Webhook: `checkout.session.completed` | Integration mock | `stripeWebhooks.test.ts` (mocks storage + stripe) |
| Webhook: `invoice.payment_failed` | Integration mock | `stripeWebhooks.test.ts` |
| Subscription tier sync | Pure-logic | `subscriptionLifecycle.test.ts` (inline) |
| Credit deduction | **NO** | Only mocked call in webhook test |
| Usage metering | **NO** | `usageLimits.test.ts` exists but tests inline logic |
| Dunning progression | Partial | `dunningService.test.ts` for logic only |

### 5.5 Path 5: Founder Operations

| Step | Tested? | How |
|------|---------|-----|
| Dashboard load (7286 LOC) | **NO** | No test for `/api/founder/*` or dashboard component |
| Briefing generation | **NO** | `routes-founder-intelligence.ts` untested |
| Decision inbox | **NO** | No test |
| Agent monitoring | Partial | `tests/unit/agents/` has 19 test files for SCP agents |
| System health | **NO** | `routes-setup.ts` (`/api/founder/setup/status`) known broken, untested |

---

## 6. Untested Route Files (110 of 121)

The following route files have **zero** test coverage (direct or indirect). This represents ~90% of the API surface:

**Financial/Billing (P0):**
`routes-billing.ts` (873 LOC), `routes-dunning.ts`, `routes-transaction-fees.ts`, `routes-finance.ts`, `routes-bookkeeping.ts`, `routes-cash-flow.ts`, `routes-capital-markets.ts`, `routes-tax-optimization.ts`, `routes-tax-delinquent.ts`, `routes-tax-researcher.ts`, `routes-exchange-1031.ts`

**Auth/Security (P0):**
`routes-2fa.ts`, `routes-sso.ts`, `routes-admin.ts` (4898 LOC), `routes-gdpr.ts`, `routes-investor-verification.ts`, `routes-compliance.ts`

**Core CRM (P0):**
`routes-leads.ts` (1161 LOC), `routes-deals.ts` (1493 LOC), `routes-properties.ts`, `routes-campaigns.ts` (1756 LOC), `routes-onboarding.ts`, `routes-organization.ts`

**AI/Agents (P1):**
`routes-ai.ts` (1796 LOC), `routes-ai-operations.ts`, `routes-autonomous-agent.ts`, `routes-core-ai.ts`, `routes-scp-v2.ts`, `routes-va-engine.ts`, `routes-vision-ai.ts`, `routes-voice.ts`, `routes-voice-learning.ts`

**Documents/Communications (P1):**
`routes-documents.ts`, `routes-doc-system.ts`, `routes-document-intelligence.ts`, `routes-communications.ts`, `routes-inbound-email.ts`, `routes-team-messaging.ts`, `routes-notifications.ts`

**Marketplace/Deals (P1):**
`routes-marketplace.ts`, `routes-negotiation.ts`, `routes-disposition.ts`, `routes-deal-rooms.ts`, `routes-deal-underwriting.ts`, `routes-deal-feed.ts`, `routes-deal-hunter.ts`, `routes-deal-patterns.ts`, `routes-closing.ts`, `routes-due-diligence.ts`

**Founder/Admin (P1):**
`routes-founder-intelligence.ts`, `routes-founder-v6.ts` through `routes-founder-v14.ts` (9 files), `routes-dashboard.ts`, `routes-kpis.ts`, `routes-metrics.ts`, `routes-setup.ts`

**All remaining 50+ route files** -- including enrichment, integrations, import/export, leases, maintenance, white-label, zoning, referral, recording-fees, etc.

---

## 7. Findings Summary

### P0 -- Critical

| # | Finding | Impact |
|---|---------|--------|
| P0-1 | Auth flow (OAuth, session, hydrateUser, getOrCreateOrg) has no automated tests | Sign-in is already fragile (orientation P0 #1); no regression detection |
| P0-2 | Billing/payment endpoints (`routes-billing.ts`) completely untested via HTTP | Stripe checkout, portal, metering could break silently |
| P0-3 | All "integration" tests are pure-logic simulations that don't import or exercise actual server code | False confidence -- tests pass even if production logic diverges |
| P0-4 | No database integration tests despite PostgreSQL provisioned in CI | 429-table schema with zero query verification |
| P0-5 | 110 of 121 route files (90%) have zero test coverage | 926 endpoints with no automated verification |
| P0-6 | `ci.yml` build job references nonexistent jobs (`unit-tests`, `integration-tests`, `e2e-tests`) | CI pipeline is structurally broken |

### P1 -- Significant

| # | Finding | Impact |
|---|---------|--------|
| P1-1 | Pre-commit hook has no test step and TypeScript check is non-blocking | Broken code can be committed freely |
| P1-2 | E2E tests require undocumented credentials and are not run in `test.yml` or `deploy.yml` | Playwright tests are effectively decorative |
| P1-3 | 111 skipped tests across 26 files | Significant coverage holes masked by skip annotations |
| P1-4 | Only 1 test file uses `supertest` for HTTP request testing | `supertest` is in devDependencies but essentially unused |
| P1-5 | 4 test files currently failing (5 tests) with no indication they block deploys | Test failures are normalized/ignored |
| P1-6 | Unit tests for encryption, state machines, etc. frequently redefine logic inline rather than importing server modules | Tests verify their own implementations, not the application |

### P2 -- Moderate

| # | Finding | Impact |
|---|---------|--------|
| P2-1 | Coverage threshold set at 50% but not enforced in deploy pipeline | Coverage can degrade without blocking |
| P2-2 | No mutation testing configured | No verification that tests actually catch bugs |
| P2-3 | Load tests (k6) are manual-only, not integrated into CI | Performance regressions undetected |
| P2-4 | No contract testing between client and server API | Frontend can break if API responses change |
| P2-5 | No snapshot testing for critical UI components | Visual regressions undetected |

### P3 -- Minor

| # | Finding | Impact |
|---|---------|--------|
| P3-1 | E2E tests use many soft-pass patterns (`count >= 0`, `.catch(() => false)`) | Tests rarely fail even when features break |
| P3-2 | No test for service worker registration/deregistration | Console errors in production (orientation #20) |
| P3-3 | No test for rate limiting behavior | Cannot verify rate limit enforcement |
| P3-4 | No test for WebSocket connections (`ws` is a dependency) | Realtime features unverified |
| P3-5 | `tests/setup.ts` uses hardcoded `FOUNDER_EMAIL` value (`thmsnrtn@gmail.com`) | Test setup leaks PII |

---

## 8. Recommendations (Document Only -- Not Implemented)

1. **Rewrite integration tests to import actual server modules** -- the current inline-logic pattern provides zero production assurance
2. **Add HTTP endpoint tests using supertest** against a real Express app with mocked external services (Stripe, Clerk, SES) but real middleware chains
3. **Add database integration tests** -- CI already provisions PostgreSQL; use it to verify Drizzle queries
4. **Fix `ci.yml` job dependencies** -- define the referenced `unit-tests`, `integration-tests`, and `e2e-tests` jobs or update `needs`
5. **Provision E2E test credentials** and run Playwright in at least one CI workflow
6. **Add test step to pre-commit hook** -- at minimum run affected test files
7. **Fix the 5 failing tests** and enable `--bail` to fail fast
8. **Prioritize test coverage for**: auth middleware chain, billing endpoints, lead/deal CRUD, multi-tenant isolation at the query level
