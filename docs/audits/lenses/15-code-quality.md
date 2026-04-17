# Lens 15 -- Code Quality & Maintainability Audit

Auditor: Code Quality Reviewer
Date: 2026-04-15
Scope: Dead code, duplication, naming conventions, file organization, comment quality, import patterns

---

## Executive Summary

The codebase has severe maintainability problems driven by three root causes: (1) massive files that concentrate too much logic in single modules, (2) a flat `server/services/` directory with 383 files -- 65 of which are dead code never imported anywhere -- and (3) inconsistent conventions across naming, import paths, export styles, error handling, and data access patterns. The total dead service code alone accounts for approximately 20,384 lines. Combined with 44 versioned service files (V8 through V15) and 8 versioned route files (founder-v6 through founder-v14), the codebase carries significant archaeological baggage that obscures the living code.

---

## P1 -- Unmaintainable / Causes Active Confusion

### 1.1 God Files (>3000 LOC)

| File | LOC | Problem |
|------|-----|---------|
| `shared/schema.ts` | 14,883 | 429 Drizzle tables + 1,430 exports in a single file. Impossible to navigate, causes IDE slowdowns. |
| `server/storage.ts` | 8,286 | 646 async methods. Classic god-object anti-pattern. Every domain's data access funneled through one class. |
| `client/src/pages/founder-dashboard.tsx` | 7,286 | Single React component file. Already noted in orientation but remains unfactored. |
| `server/ai/supportAgent.ts` | 5,455 | AI agent with all tool definitions, prompt templates, and execution logic in one file. |
| `server/routes-admin.ts` | 4,898 | Admin route handler with inline business logic that should be in services. |
| `client/src/components/property-map.tsx` | 3,279 | Map component with data fetching, rendering, event handling, and UI all colocated. |

### 1.2 Dead Services (65 files, ~20,384 LOC)

65 service files are never imported anywhere in the codebase. They compile, ship in the bundle, but execute no code paths. This is not "future code" -- many overlap with active services, creating confusion about which implementation is canonical.

**Largest dead services (>500 LOC):**

| File | LOC | Notes |
|------|-----|-------|
| `agentOrchestration.ts` | 1,329 | Superseded but not removed |
| `aiAdvisorTeamV15.ts` | 706 | Versioned file, never wired |
| `agentTriggerMonitor.ts` | 661 | |
| `autonomyGuardrails.ts` | 644 | Has TODO comments referencing future schema columns |
| `scpCustomerLifecycle.ts` | 616 | |
| `agentEvolutionEngine.ts` | 605 | |
| `scpIntegrationFabric.ts` | 580 | |
| `commissionService.ts` | 482 | |
| `autonomousSalesPipeline.ts` | 461 | |
| `scpDynamicTools.ts` | 461 | |
| `scpExperimentEngine.ts` | 439 | |
| `scpOutboundExecution.ts` | 430 | |
| `productEvolutionEngine.ts` | 418 | |
| `modelTraining.ts` | 413 | |
| `scpFinancialAutonomy.ts` | 409 | |
| `scpStrategicIntelligence.ts` | 394 | |
| `learningAnalytics.ts` | 387 | |
| `dealHandoffService.ts` | 389 | |
| `scpSelfProvisioning.ts` | 359 | |
| `quizGrading.ts` | 359 | |
| `negotiationPipeline.ts` | 356 | |
| `transactionFeeService.ts` | 353 | |
| `portfolioIntelligence.ts` | 347 | |
| `aiTutor.ts` | 345 | |
| `atlasContextInjector.ts` | 344 | |
| `delegationDepthV9.ts` | 335 | |
| `spendAutonomyV9.ts` | 324 | |
| `agentInitiativeV9.ts` | 319 | |
| `modelServing.ts` | 308 | |
| `causalReasoningV9.ts` | 305 | |
| `playbookEvolutionV9.ts` | 302 | |
| `tenantMetering.ts` | 300 | |
| `computerVision.ts` | 293 | |

**Additionally dead "Enhancement" bolt-on files (6 files, ~580 LOC total):**
- `dealFeedEnhancements.ts` (127)
- `integrationEnhancements.ts` (70)
- `marketplaceEnhancements.ts` (72)
- `mobileEnhancements.ts` (96)
- `propertyIntelligenceEnhancements.ts` (109)
- `securityEnhancements.ts` (106)

### 1.3 Versioned File Proliferation Without Cleanup

44 service files carry version suffixes (V8 through V15). 8 are confirmed dead (never imported). The rest are wired in but their non-versioned predecessors were never removed, leaving developers uncertain which is canonical.

**Example: agent initiative has three files simultaneously:**

| File | LOC | Status |
|------|-----|--------|
| `agentInitiatives.ts` | 221 | Original |
| `agentInitiativeEngine.ts` | 281 | Replacement? |
| `agentInitiativeV9.ts` | 319 | Dead (never imported) |

**Founder routes span 8 versioned files (v6 through v14), totaling 2,667 LOC:**
All are imported and registered in `routes.ts`. Each adds endpoints for a new "SCP version" but none deprecate or remove prior versions. The URL namespace is fragmented across `/api/founder/v6/*`, `/api/founder/v7/*`, etc. with no API versioning strategy.

### 1.4 `storage.ts` as God Object

`server/storage.ts` contains 646 async methods serving every domain. It re-exports `db` from `db.ts`, creating a confusing dual-import situation:
- 44 route files import `{ db }` from `./storage`
- 351 files import `{ db }` from `./db`

Both resolve to the same connection pool, but the inconsistency signals unclear ownership of data access.

---

## P2 -- Duplication and Naming Issues

### 2.1 Duplicate Implementations

**Rate limiting -- 3 middleware files doing overlapping work:**

| File | LOC | Approach |
|------|-----|----------|
| `middleware/rateLimit.ts` | 341 | In-memory, used by most routes via `createRateLimiter` |
| `middleware/rateLimiting.ts` | 197 | In-memory per-feature-area sliding window |
| `middleware/redisRateLimit.ts` | 378 | Redis-backed, subscription-tier-aware |

Plus `services/agentRateLimiter.ts` (188 LOC, dead). Four files for rate limiting. Only `rateLimit.ts` is widely used.

**Address validation -- 2 service files with overlapping purpose:**

| File | LOC | Backend |
|------|-----|---------|
| `addressValidation.ts` | 175 | Lob US Verification API (dead -- never imported) |
| `addressVerification.ts` | 175 | USPS Web Tools API (alive) |

Different interfaces (`AddressInput` with `line1` vs `address1`), different external APIs, same conceptual purpose.

**Onboarding -- 4+ client files implementing wizard flows:**

| File | LOC | Location |
|------|-----|----------|
| `components/onboarding-wizard.tsx` | 887 | Dialog-based wizard |
| `components/onboarding/OnboardingWizard.tsx` | 822 | Directory-based duplicate |
| `pages/onboarding-wizard.tsx` | 233 | Page wrapper |
| `pages/onboarding-v2.tsx` | 1,469 | Full-page redesign |
| `components/founder-setup-wizard.tsx` | 1,018 | Founder-specific variant |

Combined: 4,429 LOC across 5 files for onboarding wizards. The naming does not clarify which is active.

**Floating assistant / copilot -- 2 similar chat-like components:**

| File | LOC |
|------|-----|
| `components/floating-assistant.tsx` | 1,677 |
| `components/pax-copilot-rail.tsx` | 1,723 |

Both provide AI chat interfaces embedded in the UI.

**Strategic compass duplicate:**
- `services/strategicCompass.ts` (98 LOC) -- original
- `services/strategicCompassV8.ts` (231 LOC) -- replacement

Both exist. The V8 version is imported; the original is dead.

### 2.2 Naming Convention Inconsistencies

**Server services: mixed camelCase and kebab-case**
- 352 files use camelCase (`agentOrchestration.ts`, `cashFlowForecaster.ts`)
- 10 files use kebab-case (`agent-skills.ts`, `data-source-broker.ts`, `workflow-engine.ts`)
- No convention is documented

**Server middleware: mixed camelCase, kebab-case, and single-word**
- 18 files use camelCase (`fileUploadSecurity.ts`, `getOrCreateOrg.ts`)
- 1 file uses kebab-case (`white-label-domain.ts`)
- 7 files use bare single-word names (`compression.ts`, `telemetry.ts`)

**Client components: mixed PascalCase and kebab-case**
- 365 component files use kebab-case (`floating-assistant.tsx`, `property-map.tsx`)
- 62 component files use PascalCase (`HelpPanel.tsx`, `IRRCalculator.tsx`, `VirtualTable.tsx`)
- All `components/founder/*.tsx` use PascalCase (`AbsenceMode.tsx`, `AgentDebatePanel.tsx`)
- All `components/onboarding/*.tsx` use PascalCase
- Root `components/*.tsx` use kebab-case except 3 files

**Route file export style: two incompatible patterns**
- 76 route files use `export default router` (Express Router pattern)
- 41 route files use `export function registerXRoutes(app)` (registration function pattern)
- Both patterns coexist in the same `routes.ts` import block

### 2.3 Raw Error Responses vs. `Errors.*` Helpers

2,294 instances of `res.status(...)` in route files. The `CLAUDE.md` standard mandates `Errors.*` helpers for all error responses. Many route files (especially `routes-ab-tests.ts`, `routes-academy.ts`, and all default-export router files) use raw `res.status(400).json({ error: "..." })` with inconsistent response shapes. The `Errors.*` convention produces `{ error, message, details?, statusCode }` but raw calls produce `{ error: "string" }` without `statusCode` or `message` fields.

### 2.4 `(req as any)` Unsafe Casts -- 66 Instances

Distributed across 15 files, concentrated in middleware:
- `middleware/piiMasking.ts` -- 4 casts
- `middleware/fieldEncryption.ts` -- 5 casts
- `middleware/telemetry.ts` -- 3 casts
- `middleware/rateLimit.ts` -- 1 cast
- `middleware/roleGuard.ts` -- 3 casts
- `routes-2fa.ts` -- 3 casts (session access)
- `routes-ai.ts` -- 1 cast (file upload)

`server/types/request.ts` exists with `AuthenticatedRequest` but middleware files do not use it, preferring `(req as any)` to attach ad-hoc properties.

### 2.5 Total `as any` Usage

1,287 instances of `as any` across server and client code. This effectively bypasses the 1,815 TypeScript errors noted in the orientation by casting away type information at call sites.

---

## P3 -- Style and Convention Nits

### 3.1 TODO/FIXME/HACK Comments

Only 4 TODO comments found across the entire codebase (all in `autonomyGuardrails.ts`, a dead file). For a codebase of this scale, this signals either (a) problems are not being tracked inline, or (b) they were never added during rapid feature development. There are zero FIXME and zero HACK comments.

### 3.2 Commented-Out Code

Minimal -- only 11 instances found. Most are in `server/db.ts` (commented usage examples) and `server/services/abTestEngine.ts` (commented DB write). This is a relative positive.

### 3.3 Console Logging in Server Code

`CLAUDE.md` mandates structured `logger` usage. Found 10 instances of `console.log/warn/error` in server code:
- `server/routes.ts:280` -- `console.error` in Clerk proxy
- `server/auth/clerkAuth.ts:44` -- `console.warn` in JWT fallback
- Others are in the logger implementation itself or in comments describing the middleware

These are low-severity but violate the stated standard.

### 3.4 Import Path Inconsistency for Shared Module

- 389 files use the alias `@shared/schema`
- 23 files use relative paths `../shared/schema` or `../../shared/schema`

Both resolve correctly but the inconsistency makes refactoring fragile.

### 3.5 Mixed Data Access Patterns in Route Files

Route files use two competing patterns for database access:
- 1,065 calls to `storage.methodName()` (the storage god-object)
- 308 direct `db.select()`, `db.insert()`, etc. (raw Drizzle queries)

Some files use both in the same handler. There is no guidance on when to use which pattern.

### 3.6 Mixed `fetch` and `apiRequest` in Client

Client pages mix raw `fetch()` calls (481 instances) with the project's `apiRequest()` wrapper (555 instances). Files like `pages/settings.tsx` and `pages/fee-dashboard.tsx` use raw `fetch` for API calls that should go through the centralized client.

### 3.7 Flat Services Directory (383 files)

`server/services/` contains 383 `.ts` files in a single flat directory. While 8 subdirectories exist (`ai/`, `billing/`, `campaigns/`, `connectors/`, `deals/`, `leads/`, `properties/`, `providers/`), the vast majority of services are at the root level. Finding a specific service requires knowing its exact camelCase name.

### 3.8 Environment Variable Scattering

381 `process.env.*` accesses scattered across server files with no centralized config validation beyond the startup secrets check. The `services/configManager.ts` file exists but is not universally used.

### 3.9 `@ts-expect-error` and Lint Suppressions

Low count (5 `@ts-expect-error`, 7 `eslint-disable`), which is reasonable for a codebase this size. Not a concern.

### 3.10 70 Files Over 1,000 Lines

| Category | Count |
|----------|-------|
| Server routes >1000 LOC | 18 |
| Server services >1000 LOC | 22 |
| Server AI modules >1000 LOC | 4 |
| Client pages >1000 LOC | 19 |
| Client components >1000 LOC | 10 |
| Shared files >1000 LOC | 1 |
| Scripts >1000 LOC | 1 |

While not all of these are unmaintainable individually, the systemic pattern of large files indicates insufficient module decomposition discipline.

---

## Recommendations Summary (Do Not Fix -- Document Only)

| Priority | Issue | Impact |
|----------|-------|--------|
| P1 | 65 dead services (~20K LOC) | Confusion about canonical implementations, bloated codebase |
| P1 | `schema.ts` at 14,883 LOC | IDE performance, merge conflicts, onboarding barrier |
| P1 | `storage.ts` god object (646 methods) | Impossible to test, understand, or refactor safely |
| P1 | `founder-dashboard.tsx` at 7,286 LOC | Bundle size, change risk, no isolation |
| P2 | 3 rate-limiting middlewares | Unclear which to use, likely only 1 active |
| P2 | 4+ onboarding wizard implementations | Unclear which is canonical |
| P2 | Mixed export styles in route files (76 default vs 41 named) | Inconsistent registration pattern |
| P2 | Mixed `db` import paths (storage vs db.ts) | Refactoring hazard |
| P2 | 2,294 raw `res.status()` calls bypassing `Errors.*` | Inconsistent API error shapes |
| P2 | 66 `(req as any)` / 1,287 total `as any` | Type safety erosion |
| P2 | 8 versioned founder route files (v6-v14) with no deprecation | API namespace fragmentation |
| P3 | Mixed camelCase/kebab-case in services (352 vs 10) | Minor inconsistency |
| P3 | Mixed PascalCase/kebab-case in client components (62 vs 365) | Convention unclear for subdirs |
| P3 | 23 relative imports for `@shared` alongside 389 alias imports | Refactoring risk |
| P3 | Mixed `fetch`/`apiRequest` in client (481 vs 555) | Inconsistent error/auth handling |
| P3 | 10 `console.log/warn/error` in server code | Violates logging standard |
