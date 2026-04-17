# Lens 1 -- Principal Architect Audit

**Auditor:** Claude Opus 4.6 (1M context)
**Date:** 2026-04-15
**Scope:** Overall system architecture, modularity, separation of concerns, scalability patterns, and technical debt

---

## Executive Summary

AcreOS is an ambitious TypeScript monorepo (Express + React + Drizzle) deploying a full-spectrum land investment SaaS on Fly.io. The codebase has grown to 429 database tables, 926 API endpoints, and 391 service files without corresponding architectural guardrails. The build works only because esbuild skips type-checking; the canonical `tsc` reports 1,815+ errors, and the dedicated `tsconfig.check.json` has `noResolve: true` which means `npm run check` cannot actually resolve any imports -- it is functionally a no-op. There is no working CI gate (TypeScript, tests, or lint) blocking broken code from reaching production. The schema, routes, and server entrypoint are all monolithic files that exceed reasonable maintainability thresholds by 5--15x.

---

## Findings

### ARCH-001: tsconfig.check.json uses `noResolve: true` -- type-checking is a no-op
**Severity:** P0
**Description:** The `npm run check` command runs `tsc -p tsconfig.check.json`, but that config sets `noResolve: true`. This tells the TypeScript compiler not to resolve any import/require statements, which means it cannot follow module graphs, cannot verify cross-file types, and will silently accept nearly anything. Combined with the `include` array that only lists `server/types/shims.d.ts`, this effectively checks zero application code.
**Evidence:** `/tsconfig.check.json` lines 13--17: `"noResolve": true`, `"include": ["server/types/shims.d.ts"]`. Meanwhile the main `tsconfig.json` has `strict: true` and includes the full codebase, but `tsc --noEmit` using it produces 1,815+ errors (per orientation doc).
**Remediation:** Remove `noResolve`, expand the `include` to match the main tsconfig, and fix TypeScript errors in batches until `npm run check` passes. Gate CI on this.

---

### ARCH-002: No functional CI pipeline gates deployments
**Severity:** P0
**Description:** GitHub Actions workflows exist (`.github/workflows/ci.yml`, `test.yml`, `deploy.yml`) but the deploy pipeline gates on `npx tsc --noEmit` which fails with 1,815+ errors. Since the orientation doc reports "no tests running" and "no passing suite," the test gate in `deploy.yml` will also fail. In practice, deploys are likely done manually via `flyctl deploy`, bypassing all quality gates.
**Evidence:** `.github/workflows/deploy.yml` line 49: `npx tsc --noEmit` (known to fail). `.github/workflows/ci.yml` lines 93--94: build job `needs: [unit-tests, integration-tests, e2e-tests]` but those jobs are not defined in the file -- the CI will error. The orientation doc confirms "No CI pipeline" as a known issue.
**Remediation:** Create a minimal passing CI gate: (1) fix or exclude enough TS errors for `tsc` to pass, (2) get at least the critical-path unit tests passing, (3) wire the actual `flyctl deploy` to require CI green.

---

### ARCH-003: Monolithic schema.ts -- 14,883 lines, 428 tables, 1,439 exports
**Severity:** P1
**Description:** The entire database schema lives in a single file (`shared/schema.ts`). At nearly 15K lines with 428 `pgTable()` definitions and 1,439 exports, this file is beyond any reasonable maintainability threshold. It exports every table, relation, insert schema, and inferred type from a single module. Any change to any table requires loading and parsing the entire file. IDE performance degrades, merge conflicts are frequent, and it is impossible to enforce ownership boundaries between domains.
**Evidence:** `shared/schema.ts` -- 14,883 lines, 428 `pgTable()` calls, 1,439 export statements. Only 2 models (`auth.ts`, `chat.ts` totaling 81 lines) have been extracted to `shared/models/`.
**Remediation:** Split into domain-aligned modules (e.g., `schema/crm.ts`, `schema/billing.ts`, `schema/agents.ts`, `schema/campaigns.ts`) with a barrel `schema/index.ts` re-exporting everything for backwards compatibility. This is a mechanical refactor that can be done incrementally.

---

### ARCH-004: server/index.ts is a 1,934-line startup file with 44 `setInterval` calls
**Severity:** P1
**Description:** The server entrypoint file orchestrates HTTP server setup, middleware registration, route registration, Stripe initialization, MCP setup, CSP reporting, Sentry setup, and -- most critically -- 44 `setInterval`-based background jobs all running in the same Node.js process. These timers run concurrently with request handling, compete for the database connection pool (20 connections), and cannot be scaled independently.
**Evidence:** `server/index.ts` -- 1,934 lines. `grep -c setInterval server/index.ts` returns 44. Jobs include: lead nurturing (15 min), campaign optimization (hourly), API queue (10s), sequence processor (60s), deal hunter scraping, county assessor ingest, autonomous deal machine, health monitor, digest, event mesh drain (10s), delegation checks, consensus execution, and many more.
**Remediation:** Extract all background jobs into a separate worker process (or use BullMQ which is already a dependency). Run workers as a separate Fly.io process group. The `withJobLock` pattern already exists for distributed locking -- leverage it fully in a dedicated worker.

---

### ARCH-005: Route registration is a 1,778-line monolith with inline handlers
**Severity:** P1
**Description:** `server/routes.ts` manually imports and registers 90+ route modules, includes inline route handlers for leads, deals, tasks, and admin endpoints, and contains duplicated job-locking logic. Beyond this file, there are 122 separate `routes-*.ts` files (52K total LOC) with inconsistent patterns -- some use `Router()`, others use `registerXRoutes(app)` function patterns.
**Evidence:** `server/routes.ts` -- 1,778 lines. Two different route registration patterns observed: (1) Express Router objects mounted with `app.use()` (e.g., `marketplaceRouter`), (2) Registration functions that receive `app` (e.g., `registerAdminRoutes(app)`). The `routes.ts` file itself contains ~800 lines of inline route handlers that should be in separate files.
**Remediation:** Move all inline handlers out of `routes.ts` into domain route files. Standardize on one registration pattern (Router-based is cleaner). Consider a route auto-loader that scans the `routes/` directory.

---

### ARCH-006: Routes mounted without authentication middleware
**Severity:** P0
**Description:** Several route modules are mounted in `routes.ts` without the `isAuthenticated` or `getOrCreateOrg` middleware at the mount point, and rely on the individual route files to apply auth internally. While some of these files do apply auth at the router level, this is inconsistent and creates risk of unprotected endpoints.
**Evidence:**
- Line 960: `app.post('/api/mcp/execute', mcpHandler)` -- no `isAuthenticated`, though `mcp-server.ts` does its own bearer-token auth. However, this is a separate auth system that bypasses the standard middleware chain.
- Line 988: `app.use('/api/deal-feed', dealFeedRouter)` -- no auth at mount. The router file applies auth internally, but this is inconsistent with adjacent lines.
- Line 989: `app.use('/api/properties', visionScanRouter)` -- no auth at mount. `routes-vision-scan.ts` applies `isAuthenticated` and `getOrCreateOrg` internally.
- Line 990: `app.use('/api/comments', commentsRouter)` -- no auth at mount. Internal auth applied.
- Line 970: `app.use('/api/regulatory', regulatoryRouter)` -- no `getOrCreateOrg` at mount. Router applies `isAuthenticated` internally but no org context.
- Line 967: `app.use('/api/beta', betaRouter)` -- no auth at mount. Partially public by design, but no documentation of which routes are public vs protected.
**Remediation:** Apply `isAuthenticated, getOrCreateOrg` at every mount point. For routes that genuinely need public access (webhooks, beta waitlist), document the exceptions explicitly and ensure auth is applied to all non-public sub-routes.

---

### ARCH-007: Duplicated `logger` shadow variable in route files
**Severity:** P1
**Description:** Multiple route files import the structured `logger` from `server/utils/logger.ts` and then immediately re-declare a local `const logger` that wraps it in a different format, shadowing the import and defeating the structured logging system.
**Evidence:**
- `server/routes-admin.ts` lines 34--38: imports `logger` then redeclares `const logger = { info: ..., warn: ..., error: ... }` that wraps `logger.info(JSON.stringify(...))` -- calling `logger.info` inside `logger.info` creates recursive/double-encoded output.
- `server/routes-borrower.ts` lines 40--43: identical pattern, and the import on line 9 (`import { logger }`) is shadowed.
**Remediation:** Remove the local `logger` redeclarations. Use the canonical `logger` from `server/utils/logger.ts` directly, which already supports structured metadata.

---

### ARCH-008: 8,286-line storage.ts -- God object data access layer
**Severity:** P1
**Description:** `server/storage.ts` is a single 8,286-line file that serves as the data access layer for the entire application. It imports schemas for dozens of entities and exports methods like `getLeadsByIds`, `getDashboardStats`, `mergeLeads`, `cleanExpiredBorrowerSessions`, etc. This is a classic God Object anti-pattern -- it couples all domains together and makes it impossible to reason about data access boundaries.
**Evidence:** `server/storage.ts` -- 8,286 lines. Imports 100+ schema entities. Contains CRUD methods for leads, deals, properties, payments, campaigns, support cases, borrower sessions, audit log, feature flags, and more in a single file.
**Remediation:** Split into domain-specific repositories (e.g., `repositories/leads.ts`, `repositories/deals.ts`, `repositories/billing.ts`) that each own their queries. `storage.ts` can become a thin barrel that re-exports for backwards compatibility.

---

### ARCH-009: Migration sequence number collisions
**Severity:** P1
**Description:** The `migrations/` directory contains 36 migration files, but 12 sequence numbers have duplicates (e.g., `0003_enrichment_columns.sql` and `0003_robust_namora.sql`, `0007_composite_indexes.sql` and `0007_password_reset_tokens.sql`). Drizzle Kit uses these sequence numbers for ordering. Collisions mean migration execution order is non-deterministic for colliding pairs, and depending on filesystem sort order, different environments may apply migrations differently.
**Evidence:** `ls migrations/ | sed 's/_.*//' | sort | uniq -d` returns: 0003, 0007, 0008, 0009, 0010, 0011, 0012, 0013, 0015, 0016, 0017, 0018.
**Remediation:** Re-sequence migrations to have unique ordinal numbers. Since these have already been applied in production, create a consolidation migration or manually verify that the Drizzle migration metadata table tracks by filename (not sequence number) and that both files in each pair have been applied.

---

### ARCH-010: 7,286-line founder-dashboard.tsx -- largest client component
**Severity:** P1
**Description:** The Founder Dashboard is a single React component file at 7,286 lines. It handles Overview, Agents, Operations, Growth, and Infrastructure tabs all in one file with dozens of inline queries, state variables, and UI blocks. The file alone produces a 382KB JS chunk, which degrades parse time on lower-end devices.
**Evidence:** `client/src/pages/founder-dashboard.tsx` -- 7,286 lines. Next largest page: `properties.tsx` at 2,893 lines. The orientation doc confirms this is the largest JS chunk at 382KB.
**Remediation:** Extract each tab panel into its own component/file. Use React.lazy for tab panels not visible on initial load. The shared state (org context, query client) can be lifted to a shared context or custom hook.

---

### ARCH-011: Build skips type-checking entirely
**Severity:** P1
**Description:** The production build (`script/build.ts`) uses esbuild for the server, which does not perform type-checking. Combined with ARCH-001 (the check script being a no-op), there is zero type-safety enforcement anywhere in the pipeline. TypeScript errors compile silently into runtime bugs.
**Evidence:** `script/build.ts` line 50: `await esbuild({ entryPoints: ["server/index.ts"], ... })`. esbuild documentation explicitly states it does not perform type-checking. The Vite client build similarly uses `@vitejs/plugin-react` which strips types without checking.
**Remediation:** Add `npx tsc --noEmit` as a pre-build step (once ARCH-001 is fixed). Or use `tsc --noEmit &` in parallel with the esbuild step to avoid increasing build time.

---

### ARCH-012: `(req as any)` used 73 times across 27 files -- bypasses type safety
**Severity:** P1
**Description:** Despite having a well-defined `AuthenticatedRequest` type and helper functions (`getOrganization`, `getUserId`, `getOrganizationId`), 73 instances of `(req as any)` exist across 27 files. Each cast silently discards type information and could mask null/undefined bugs at runtime.
**Evidence:** `grep '(req as any)' -r server/` -- 73 occurrences in 27 files. Notable concentrations: `routes-admin.ts` (16), `routes-2fa.ts` (8), `middleware/fieldEncryption.ts` (5), `middleware/piiMasking.ts` (4).
**Remediation:** Replace each `(req as any)` with properly typed access using `AuthenticatedRequest` and the helper functions. This is a mechanical fix per the CLAUDE.md coding standards.

---

### ARCH-013: No database connection pool sizing for background jobs
**Severity:** P1
**Description:** The primary database pool is configured with `max: 20` connections. With 2 Fly.io instances, that is 40 connections total. With 44 `setInterval`-based background jobs running concurrently alongside web requests, pool exhaustion under load is likely. The `connectionTimeoutMillis` was already bumped from 3s to 10s (visible in the code comment), suggesting this has been a problem.
**Evidence:** `server/db.ts` lines 27--32: `max: 20`, `connectionTimeoutMillis: 10_000` with comment "increased from 3s -- cloud DBs can be slow to acquire". Fly.io Postgres is `shared-cpu-2x, 1GB RAM` (from orientation doc) which likely has a `max_connections` of ~25--50 per database.
**Remediation:** (1) Move background jobs to a dedicated worker process with its own pool. (2) Audit the Fly Postgres `max_connections` setting. (3) Consider PgBouncer as a connection multiplexer (Fly.io supports this natively).

---

### ARCH-014: Dockerfile copies entire app including `node_modules`
**Severity:** P2
**Description:** The Dockerfile `COPY --from=build /app /app` copies the entire `/app` directory from the build stage, including the full `node_modules` after `npm prune --omit=dev`. This is standard but the initial `npm install` deletes the lockfile first (`rm -f package-lock.json`) before running `npm install`, which means builds are not reproducible -- dependency versions can drift between builds.
**Evidence:** `Dockerfile` line 23: `RUN rm -f package-lock.json && npm install --include=dev --legacy-peer-deps`. The comment says "Lock file generated on macOS -- fresh install ensures linux platform binaries," but `npm ci` with `--legacy-peer-deps` would be the correct approach.
**Remediation:** Use `npm ci --legacy-peer-deps` instead of deleting the lockfile. If platform-specific binaries are the concern, `npm ci` handles this correctly by rebuilding native modules for the current platform.

---

### ARCH-015: Duplicate rate limiter definitions
**Severity:** P2
**Description:** Rate limiters are defined twice in the middleware pipeline. `server/index.ts` lines 257--299 define `authLimiter`, `aiLimiter`, `webhookLimiter`, `importLimiter` and apply them. Then `server/routes.ts` lines 591--601 applies `aiLimiter`, `authLimiter`, `webhookLimiter`, `importLimiter` again on overlapping paths. Both the `index.ts` and `routes.ts` definitions of `authLimiter` are separate `rateLimit()` instances with separate counters, effectively doubling the allowed rate.
**Evidence:** `server/index.ts` lines 257--280 (4 limiters applied). `server/routes.ts` lines 591--601 (same 4 limiters re-applied). The `routes.ts` imports `rateLimiters` from the middleware module but also has the `index.ts` limiters already applied upstream.
**Remediation:** Consolidate rate limiting to a single location. Apply at the middleware level in `index.ts` or in `routes.ts`, not both.

---

### ARCH-016: Inconsistent error response patterns
**Severity:** P2
**Description:** Despite having standardized `Errors.*` helpers in `server/utils/errors.ts`, many route handlers still use raw `res.status(X).json({ message: ... })` responses. This means the API returns two different error shapes depending on which handler is hit -- some return `{ error, message, statusCode }` and others return `{ message }`.
**Evidence:** `server/routes.ts` uses raw `res.status(400).json({ message: ... })` throughout (lines 664, 740, 906, etc.). `server/routes-billing.ts` uses `Errors.internal(res, error)` consistently. `server/routes-admin.ts` mixes both patterns.
**Remediation:** Replace all raw error responses with `Errors.*` helpers. Add an ESLint rule or custom lint check to flag `res.status(4xx|5xx).json(` patterns.

---

### ARCH-017: Versioned route files without cleanup (founder-v6 through founder-v14)
**Severity:** P2
**Description:** There are 8 versioned founder route files (`routes-founder-v6.ts` through `routes-founder-v14.ts`, 2,667 lines total) plus `routes-founder-intelligence.ts` (2,462 lines). The naming suggests iterative feature development where new versions were added rather than modifying existing files. This is a code archaeology problem -- it is unclear which versions are still active and whether older versions contain dead code.
**Evidence:** `server/routes-founder-v{6,7,8,10,11,12,13,14}.ts` -- 8 files, 2,667 lines combined. No `routes-founder-v9.ts` exists (gap in sequence). All are imported and registered in `routes.ts`.
**Remediation:** Audit which endpoints in v6--v14 are still called by the client. Consolidate active endpoints into logically-named modules. Archive dead versions.

---

### ARCH-018: Provider registry lacks caching integration
**Severity:** P2
**Description:** The orientation doc mentions "Response caching via `provider_cache` table" but the `provider-registry.ts` implementation does not reference any cache table. The registry performs circuit breaking and tier filtering but makes a fresh external API call on every lookup. For a system that charges credits per lookup, caching is essential both for performance and cost management.
**Evidence:** `server/services/providers/provider-registry.ts` -- the `lookup()` method iterates candidates and calls `provider.lookup()` directly. No cache check before the call, no cache write after. The `provider_cache` table exists in the schema but is not referenced in the registry.
**Remediation:** Add a cache-first check in `providerRegistry.lookup()` that queries the `provider_cache` table before calling external providers. Write results to cache after successful lookups.

---

### ARCH-019: Single-region deployment with no disaster recovery plan
**Severity:** P2
**Description:** The Fly.io deployment is configured for a single region (IAD -- Northern Virginia) with 2 machines. The database is also in IAD with `shared-cpu-2x, 1GB RAM`. There is no read replica, no multi-region failover, and no documented backup/restore procedure.
**Evidence:** `fly.toml` line 2: `primary_region = 'iad'`. Orientation doc: "Fly managed, shared-cpu-2x, 1GB RAM". `db.ts` lines 46--53: replica pool falls back to primary URL when `DATABASE_REPLICA_URL` is not set.
**Remediation:** For launch: document the backup strategy (Fly.io does nightly snapshots by default). For post-launch: provision a read replica, consider adding a secondary region.

---

### ARCH-020: `ERR_HTTP_HEADERS_SENT` swallowed as non-fatal
**Severity:** P2
**Description:** The `uncaughtException` handler in `server/index.ts` explicitly catches `ERR_HTTP_HEADERS_SENT` and continues execution instead of crashing. While this prevents process restarts, this error indicates a bug where a route handler tries to send a response after one has already been sent. Swallowing it masks the underlying double-response bug.
**Evidence:** `server/index.ts` lines 54--57: `if ((err as any)?.code === "ERR_HTTP_HEADERS_SENT") { logger.warn("...skipping"); return; }`.
**Remediation:** Fix the root causes (missing `return` statements after `res.json()` calls in route handlers) rather than swallowing the exception. Once root causes are fixed, remove the special case.

---

### ARCH-021: Admin endpoints lack role-based access control beyond founder check
**Severity:** P2
**Description:** Admin routes use a local `isFounderAdmin` middleware that checks `req.organization.isFounder` or `req.isFounder`. There is no RBAC system for team members -- it is binary: founder or not. As the platform scales to multiple organizations with team members, admin/operator/viewer roles will be needed.
**Evidence:** `server/routes-admin.ts` lines 648--660: `isFounderAdmin` checks only `req.organization?.isFounder` and `(req as any).isFounder`.
**Remediation:** Extend the existing `requirePermission()` system to support admin-level permissions. Define an `admin` or `operator` role in the team member schema.

---

### ARCH-022: Sensitive Clerk proxy hardcodes account domain
**Severity:** P2
**Description:** The Clerk proxy in `routes.ts` hardcodes the Clerk development domain `possible-emu-83.clerk.accounts.dev` throughout the proxy logic. If the Clerk instance changes (e.g., switching from dev to production Clerk), all proxy URLs break.
**Evidence:** `server/routes.ts` lines 230, 255: `possible-emu-83.clerk.accounts.dev` hardcoded in URL construction and Location header rewriting.
**Remediation:** Extract the Clerk domain to an environment variable (e.g., `CLERK_BACKEND_DOMAIN`) and reference it in the proxy.

---

### ARCH-023: `@types/*` packages in production dependencies
**Severity:** P3
**Description:** Several `@types/*` packages (`@types/cookie-parser`, `@types/mapbox-gl`, `@types/multer`, `@types/pdfkit`, `@types/puppeteer-core`) are listed under `dependencies` rather than `devDependencies`. These are compile-time only and add unnecessary weight to the production install.
**Evidence:** `package.json` lines 93--97: type packages under `dependencies`.
**Remediation:** Move all `@types/*` to `devDependencies`.

---

### ARCH-024: Chromium installed in production Docker image
**Severity:** P3
**Description:** The production Docker image installs Chromium (`apt-get install chromium chromium-sandbox`) for puppeteer-core. This adds ~400MB to the image size for a feature (browser automation) that may only be used by a small subset of functionality.
**Evidence:** `Dockerfile` lines 33--35: Chromium install in production stage. `PUPPETEER_EXECUTABLE_PATH` set at line 42.
**Remediation:** If browser automation is infrequently used, move it to a separate service/container. If it must remain, consider using a headless Chrome service (e.g., Browserless) instead of bundling Chromium.

---

## Embarrassment Test

Three things about the current architecture that would embarrass a senior architect:

1. **The type-checking system is theater.** `tsconfig.check.json` has `noResolve: true` and includes only a shim file. `npm run check` does nothing useful. The build uses esbuild which skips types. The CI workflow gates on `tsc --noEmit` which fails with 1,815+ errors. This means the entire TypeScript type system -- the core value proposition of choosing TypeScript -- provides zero safety. The codebase has TypeScript syntax but JavaScript guarantees.

2. **44 background jobs run as `setInterval` timers in the web server process.** There is no job queue, no worker process, no graceful shutdown for long-running jobs. A deploy kills all in-flight timers. If the event loop blocks on a heavy job, all HTTP requests stall. The Fly.io health check could pass while the process is internally dysfunctional from timer overload competing for 20 database connections.

3. **A single 14,883-line schema file exports 1,439 symbols.** This file takes the place of what should be an entire `schema/` directory with domain boundaries. Every team member who touches any database table must parse, understand, and avoid merge conflicts with this single file. It is the architectural equivalent of storing every table in a single `CREATE TABLE` statement.

---

## Pride Test

Three things about the current architecture that would make a senior architect proud:

1. **Well-designed provider registry with circuit breaking and tier-based filtering.** The `server/services/providers/` directory implements a clean abstraction for external data providers with priority-based fallback, per-provider circuit breakers (3 failures in 5 minutes = skip), and subscription-tier gating. This is a genuinely well-architected subsystem that handles the complexity of multiple data sources gracefully.

2. **Structured security middleware stack.** The middleware pipeline includes CSP with per-request nonces, CORS configuration, request timeouts, content type validation, PII masking, prompt injection guards, field encryption, rate limiting per endpoint category, idempotency middleware, and CSRF protection. The security posture is comprehensive and layered -- not an afterthought.

3. **Distributed job locking for multi-instance deployment.** The `withJobLock()` pattern using database-backed locks (with TTL and cleanup) shows awareness of multi-instance deployment challenges. When combined with the `DISABLE_BACKGROUND_JOBS` env flag for small instances and the job health logging table, this demonstrates operational maturity in how background work is managed across horizontally-scaled instances.
