# Red Team Audit #10 -- Future Maintainer

**Persona**: A new developer who just joined the team, tasked with understanding, debugging, and extending the codebase.

**Date**: 2026-04-18

---

## 1. Code Organization

**Verdict: CONCERN**

The top-level structure is clean: `client/`, `server/`, `shared/`, `tests/`, `docs/`, `scripts/`. The monorepo layout with a shared types directory is immediately understandable.

However, the sheer scale raises serious navigability concerns:

- **615 server-side `.ts` files**, including 121 `routes-*.ts` files and 391 items under `server/services/`.
- **`shared/schema.ts`** is a single 14,892-line file containing 429 `pgTable` definitions. A new developer cannot hold even a fraction of this in their head. There is no directory-level splitting (e.g., `schema/crm.ts`, `schema/marketplace.ts`).
- **`server/storage.ts`** is 8,536 lines -- a single class with hundreds of methods covering every data access operation. There is no repository pattern or domain-level decomposition.
- **`server/index.ts`** is 1,961 lines, mixing Express setup, background job scheduling, Stripe initialization, and graceful shutdown into one file.
- **`server/routes-admin.ts`** is 4,892 lines -- the largest route file.
- **`client/src/pages/founder-dashboard.tsx`** is 7,301 lines -- the largest client component.

Multiple files exceed the 2,000-line threshold where comprehension degrades. A new developer looking for "where does deal creation happen" would need to check `routes-deals.ts`, `routes.ts`, `storage.ts`, and at least one service file.

**Evidence**:
```
shared/schema.ts             14,892 lines   (429 tables)
server/storage.ts             8,536 lines   (single class)
founder-dashboard.tsx         7,301 lines
server/index.ts               1,961 lines
routes-admin.ts               4,892 lines
routes-founder-intelligence.ts 2,460 lines
routes-va-engine.ts           1,941 lines
```

---

## 2. Documentation

**Verdict: PASS**

Documentation is surprisingly thorough for a codebase of this size:

- **`CLAUDE.md`** provides clear coding standards: which request types to use, which error helpers exist, UI component patterns, accessibility rules. This is the single most valuable file for onboarding.
- **`docs/developer-guide.md`** covers local setup, key service map, schema overview, and API patterns.
- **`docs/deployment.md`** is a complete deployment runbook with rollback procedures.
- **`docs/architecture/`** contains 8 Architecture Decision Records (ADRs) explaining the TypeScript+Express stack, Drizzle over Prisma, provider abstraction, credit-based metering, etc.
- **`SECURITY.md`** documents vulnerability reporting and security measures.
- **`fly-secrets.example`** provides a comprehensive annotated template for all required environment variables with inline generation commands.
- **`server/db.ts`** has excellent doc comments explaining pool tuning, slow query monitoring, and transaction helpers.
- **`server/tracing.ts`** documents all OTEL export modes and required env vars.

Inline code comments are present in critical files: `server/middleware/security.ts` explains CSP nonce generation, `server/index.ts` documents job locking, and `server/utils/errors.ts` has JSDoc on every export.

Minor gap: the developer guide mentions "Auth: Express sessions (postgres-backed)" but the codebase actually uses Clerk. This is stale documentation.

---

## 3. Naming Conventions

**Verdict: PASS**

Naming is consistent and descriptive across the codebase:

- **Services** use camelCase: `leadScoringService`, `propertyEnrichmentService`, `healthCheckService`
- **Schema tables** use consistent snake_case for DB columns, camelCase for TypeScript fields via Drizzle conventions: `organizationId` maps to `organization_id`
- **Route files** follow `routes-{domain}.ts` pattern uniformly
- **Middleware** uses descriptive names: `getOrCreateOrg`, `isAuthenticated`, `securityHeaders`, `piiMasking`
- **Helper functions** are self-documenting: `validateOfferAmounts()`, `triggerDealEnrichmentAsync()`, `isFounderEmail()`
- **Constants** use UPPER_SNAKE: `MIN_OFFER_AMOUNT`, `MAX_OFFER_AMOUNT`, `FOUNDER_EMAILS`
- **Types** use PascalCase with the `Insert` prefix convention from Drizzle-Zod: `Lead`, `InsertLead`, `Deal`, `InsertDeal`

The only inconsistency: some route files export a function (`registerVAEngineRoutes`) while others export a router object (`marketplaceRouter`). Both patterns work, but a new developer has to check imports in `routes.ts` to determine which pattern a given file uses.

---

## 4. Error Messages

**Verdict: CONCERN**

The `Errors.*` helpers in `server/utils/errors.ts` produce clean, standardized responses (`{ error, message, details, statusCode }`). The helpers are well-designed:

```typescript
Errors.notFound(res, "Lead")       // { error: "NOT_FOUND", message: "Lead not found", statusCode: 404 }
Errors.internal(res, error)         // Auto-logs, strips message in production
Errors.limitExceeded(res, details)  // 429 with upgrade context
```

However, adoption is incomplete:

- **2,248 occurrences** of raw `res.status(X).json(...)` across route files
- **1,105 occurrences** of `Errors.*` helpers across route files
- This means roughly **67% of error responses bypass the standardized format**

Example of non-standard response (from `routes-va-engine.ts` line 27):
```typescript
res.status(500).json({ message: error.message || "Failed to fetch marketing lists" });
```
This omits `error`, `statusCode`, and `details` fields that the client-side `queryClient.ts` expects.

The client-side error handling in `queryClient.ts` tries to parse the standardized `ApiErrorBody` but falls back to raw text, so the mismatch does not crash -- but it produces inconsistent user-facing messages.

Actionable errors exist in critical paths: `validateEnv()` tells you exactly which env var is missing and how to generate it. The `getOrganization()` helper throws with specific middleware context: "is getOrCreateOrg middleware applied?"

---

## 5. Testing

**Verdict: PASS**

Test coverage is extensive:

- **171 test files** totaling 43,796 lines of test code
- **~100 unit tests** covering services, middleware, security, validation, and business logic
- **18 integration tests** covering deal lifecycle, multi-tenant isolation, Stripe webhooks, campaign lifecycle, and more
- **16 E2E tests** (Playwright) for auth, billing, accessibility, navigation, and core CRUD flows
- **12 load tests** (k6) for baseline, concurrent users, websocket, soak, chaos, and database stress
- **5 simulation tests** with persona-based scenarios (first-timer, note investor, scaling operator, etc.)

Notable test quality signals:
- `multiTenantIsolation.test.ts` explicitly tests cross-tenant data access prevention (IDOR)
- `promptInjection.test.ts` tests AI prompt injection vectors
- `fieldEncryptionMiddleware.test.ts` tests PII encryption
- `securityHeaders.test.ts` validates CSP, HSTS, and X-Frame-Options
- Dedicated `test:security` script aggregates security-focused tests

The pre-commit hook (`~3000` legacy type errors acknowledged) runs tsc filtered to staged files only -- a pragmatic approach documented clearly.

Minor concern: no test file found for `storage.ts` (the largest file in the codebase). The integration tests use mocked storage functions rather than testing the storage layer directly against a database.

---

## 6. Dependencies

**Verdict: CONCERN**

The `package.json` shows 142 production dependencies and 25 dev dependencies. Notable observations:

**Positive signals**:
- Modern stack: Express 5.2.1, React 18, TypeScript 6.0.2, Vite 7.3.0, Vitest 4.0.18
- `engines` field locks Node >= 22
- Security-relevant deps present: `@sentry/node`, `isomorphic-dompurify`, `zod` for validation
- `npm ci` used in Dockerfile and CI (deterministic installs)

**Concerns**:
- **`--legacy-peer-deps`** is used in the Dockerfile build step, suppressing peer dependency conflicts. This masks potential compatibility issues.
- **`@types/` packages in `dependencies`** rather than `devDependencies`: `@types/cookie-parser`, `@types/mapbox-gl`, `@types/multer`, `@types/pdfkit`, `@types/puppeteer-core`. These ship to production unnecessarily.
- **package name is `rest-express`** -- a generic placeholder name, not `acreos`. While cosmetic, it would confuse a new developer reviewing process lists or npm scripts.
- **No `npm audit` output was reviewed**, but the `audit:security` script is defined.
- **No lockfile integrity check** in CI -- `npm ci` handles this, but there is no explicit `npm audit` step in the CI workflow.

---

## 7. Configuration

**Verdict: PASS**

Configuration management is well-structured:

- **`fly-secrets.example`** is the canonical env var reference with clear sections (Core, AI, Stripe, Email, Voice, Maps, Security), inline generation commands, and optional vs. required distinctions.
- **`server/utils/validateEnv.ts`** validates critical env vars at startup and exits with actionable error messages including generation commands. Hard errors (DATABASE_URL, CLERK_SECRET_KEY) crash the process; soft errors (ENCRYPTION_KEY) warn.
- **`server/middleware/secretsValidation.ts`** provides a second validation layer.
- **`fly.toml`** is clean: 2-machine HA, health check endpoint, performance VMs, auto-scaling config.
- **`server/db.ts`** centralizes all database pool configuration with documented tuning rationale and replica routing.

The 396 `process.env.*` references across 139 files are a concern at first glance, but most are guarded by null checks (e.g., `process.env.ATTOM_API_KEY ?? null`) and optional service initialization. The critical path variables are centralized in `validateEnv.ts`.

One genuine concern: `process.env.FOUNDER_EMAIL` is read directly in `middleware/getOrCreateOrg.ts` rather than through a centralized config module. The same email-parsing logic is duplicated in `server/services/founder.ts` (noted in the code comment itself).

---

## 8. Database Schema

**Verdict: CONCERN**

The schema is comprehensive but intimidating:

- **429 tables** in a single `shared/schema.ts` file (14,892 lines)
- Tables are organized with section comments (`// ORGANIZATIONS & TEAM MANAGEMENT`, `// Field Scout`, etc.) which helps somewhat
- Drizzle ORM provides type safety: every table has `$inferSelect` and `$inferInsert` types exported
- `createInsertSchema` generates Zod validation schemas from the Drizzle definitions -- single source of truth for validation
- Indexes are defined inline with descriptive names: `index("fsv_org_idx").on(t.organizationId)`
- Foreign keys use `.references()` for referential integrity
- JSON columns use `.$type<T>()` for typed JSONB fields

**Concerns**:
- A new developer cannot find the table they need without full-text searching a 15K-line file. The `developer-guide.md` lists key table groups but covers maybe 20 of 429 tables.
- No ERD diagram or visual schema reference exists in `docs/`.
- Migration files use auto-generated names (`0000_sleepy_betty_ross.sql`, `0001_brief_giant_man.sql`) from Drizzle Kit -- not descriptive of what they change.
- The `storage.ts` class mirrors the schema monolith: 8,536 lines of data access methods with no domain separation.

---

## 9. Deployment

**Verdict: PASS**

Deployment infrastructure is production-grade:

- **Dockerfile**: Multi-stage build, non-root user (UID 1000), health check, max-old-space-size tuning, Chromium for Puppeteer features. Well-commented with task references.
- **`fly.toml`**: 2-machine minimum, auto-scaling at 70% concurrency, health checks every 30s, force HTTPS.
- **GitHub Actions CI/CD**:
  - `ci.yml`: Lint, type-check, test coverage, build verification, Playwright E2E, CodeQL security scan
  - `deploy.yml`: Pre-deploy gate (TypeScript + tests with Postgres service container), then rolling deploy via Fly.io. Concurrency group prevents parallel deploys.
  - `security.yml` and `staging.yml` exist for additional pipeline stages.
- **`docs/deployment.md`**: Step-by-step runbook with rollback procedure (image rollback or git revert)
- **`docker-compose.yml`** and `docker-compose.test.yml`** for local development and test environments
- **Monitoring**: Prometheus config (`monitoring/prometheus.yml`), Grafana dashboard JSON, alert rules YAML

The deployment pipeline enforces a clear gate: tests must pass before deploy reaches Fly.io. The rolling strategy with `min_machines_running: 2` prevents downtime.

One note: the CI workflow's ESLint step uses `continue-on-error: true`, meaning lint failures do not block deployment. This is pragmatic given the codebase size but means lint regressions can accumulate.

---

## 10. Debugging / Request Traceability

**Verdict: PASS**

Request traceability is well-implemented:

- **Request ID generation**: `requestLoggingMiddleware` generates a unique ID per request and attaches it to the response header (`X-Request-Id`) and the request object.
- **Structured logging**: `server/utils/logger.ts` produces JSON in production (for log aggregators like Datadog/Logtail) and human-readable format in development. Every log entry includes timestamp, level, source, and optional requestId.
- **Request-response correlation**: The logger automatically logs incoming requests and their completion with duration: `GET /api/leads 200 in 42ms`.
- **Error correlation**: The `errorLoggingMiddleware` includes requestId in error logs and forwards 5xx errors to Sentry with request context (method, path, requestId).
- **Sentry integration**: `server/utils/sentry.ts` initializes with PII stripping (cookies, authorization headers removed from events).
- **OpenTelemetry**: `server/tracing.ts` supports OTLP export to Honeycomb/Grafana Tempo/Jaeger, console export for development, and no-op for production without an endpoint.
- **PII masking**: `server/middleware/piiMasking.ts` intercepts all console output to mask phone numbers, emails, SSNs, and credit cards.
- **Health check**: Dedicated health endpoint (`/api/health/cached`) with external service status (Stripe, DB, Redis).

To trace a request from client to DB: the client includes session cookies, the request hits Express middleware (auth, org, rate-limit), gets a requestId, hits the route handler, calls `storage.*` methods which execute Drizzle queries against the pool. The requestId propagates through logs and Sentry. Slow queries are logged by the pool config (30s statement timeout).

Minor concern: the requestId is a simple counter (`Date.now()-N`), not a UUID or ULID. This works for single-instance debugging but could collide in multi-instance deployments since the counter resets on restart. The `instanceId` UUID generated in `index.ts` is not prepended to the request ID.

---

## Summary

| Area | Verdict | Key Finding |
|------|---------|-------------|
| 1. Code Organization | **CONCERN** | Schema (14.9K lines), storage (8.5K lines), and several UI/route files exceed maintainability thresholds. 391 service files with no domain grouping. |
| 2. Documentation | **PASS** | CLAUDE.md, developer guide, ADRs, deployment runbook, and inline comments are thorough. Minor staleness in auth docs. |
| 3. Naming Conventions | **PASS** | Consistent camelCase/PascalCase/snake_case conventions. Minor inconsistency in route export patterns (function vs. router object). |
| 4. Error Messages | **CONCERN** | Standardized `Errors.*` helpers exist but only cover ~33% of error responses. 2,248 raw `res.status().json()` calls remain. |
| 5. Testing | **PASS** | 171 test files across unit, integration, E2E, load, and simulation layers. Security and multi-tenant isolation explicitly tested. |
| 6. Dependencies | **CONCERN** | `--legacy-peer-deps` masks conflicts. `@types/` packages in production deps. Generic package name. |
| 7. Configuration | **PASS** | Centralized env validation at startup with actionable messages. `fly-secrets.example` is comprehensive. |
| 8. Database Schema | **CONCERN** | 429 tables in a single 15K-line file with no visual schema reference. Migration names are auto-generated. |
| 9. Deployment | **PASS** | Multi-stage Dockerfile, rolling deploys, CI gates, monitoring configs, and documented rollback procedures. |
| 10. Debugging | **PASS** | Request ID propagation, structured JSON logging, Sentry with PII stripping, OpenTelemetry support, and health checks. |

## Top 3 Recommendations for the First Sprint

1. **Split `shared/schema.ts`** into domain modules (`schema/crm.ts`, `schema/marketplace.ts`, `schema/ai.ts`, etc.) and create a barrel export. This is the single highest-impact change for developer comprehension.

2. **Migrate remaining `res.status().json()` calls to `Errors.*` helpers** -- prioritize the highest-traffic route files (`routes.ts`, `routes-admin.ts`, `routes-va-engine.ts`). Consider a lint rule to enforce this going forward.

3. **Split `server/storage.ts`** into domain-specific repository modules (`storage/deals.ts`, `storage/leads.ts`, etc.) to match the route file decomposition that already exists.
