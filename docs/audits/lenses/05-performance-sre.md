# Lens 5 -- Performance & Reliability (SRE Audit)

**Auditor:** Claude Opus 4.6 (SRE persona)
**Date:** 2026-04-15
**Scope:** Bundle sizes, caching, DB pool, query efficiency, health checks, error recovery, Fly.io config, compression, memory patterns

---

## Executive Summary

AcreOS has solid infrastructure foundations -- compression enabled, circuit breakers on external services, health check probes, graceful shutdown, Sentry integration, and content-hashed static assets with immutable cache headers. However, the server process is dangerously bloated: 44 `setInterval` background jobs run in every instance, unbounded `SELECT *` queries fetch entire tables into memory for core entities (leads, properties, deals), a 477 KB shared schema chunk is shipped to the client, and the `redis` npm package is missing from `package.json` (causing the health check to report degraded). The DB connection pool comment promises `statement_timeout: 30s` but the setting is never applied, leaving runaway queries unchecked. The Chromium binary in the production Docker image adds ~400 MB of attack surface and image bloat for a feature used by two services.

---

## Findings

### SRE-01: Unbounded entity queries fetch entire tables into memory
**Severity:** P0
**Description:** `storage.getLeads(orgId)`, `storage.getProperties(orgId)`, `storage.getDeals(orgId)`, and `storage.getNotes(orgId)` issue `SELECT * FROM <table> WHERE org_id = ?` with no LIMIT clause. These are called from the dashboard, analytics, MCP server, AI agents, and import/export routes. For any organization with thousands of leads or properties, each call pulls the entire dataset into Node.js heap memory.
**Evidence:**
- `server/storage.ts:1261-1270` -- `getLeads()` has no limit
- `server/storage.ts:1571-1575` -- `getProperties()` has no limit
- `server/storage.ts:1667` -- `getDeals()` has no limit
- Called from: `server/routes-dashboard.ts:43-45`, `server/mcp/index.ts:420-547`, `server/mcp-server.ts:92-140`, `server/ai/vaService.ts:756-758`, `server/routes-analytics.ts:171-172`, `server/routes-micro-features.ts:119-342`
**Remediation:** Replace unbounded calls with paginated equivalents (`getLeadsPaginated`, `getPropertiesPaginated`, `getDealsPaginated`) which already exist in the storage interface. For aggregation use cases (dashboard, analytics), add dedicated count/aggregate queries.

---

### SRE-02: 44 `setInterval` background jobs in every process instance
**Severity:** P0
**Description:** `server/index.ts` registers 44 separate `setInterval` timers on startup. With `min_machines_running: 2` in `fly.toml`, every job runs on both instances simultaneously. Although a `withJobLock` mechanism exists, not all jobs use it -- many fire-and-forget intervals at lines 600-1927 call functions directly without locking. This creates duplicate work, unpredictable DB pool exhaustion, and makes the process unkillable during shutdown (44 timers none of which are cleared by `gracefulShutdown`).
**Evidence:**
- `server/index.ts` -- 44 occurrences of `setInterval` (lines 580-1927)
- `DISABLE_BACKGROUND_JOBS` env var exists (line 462) but the gate only covers a subset; many jobs are registered unconditionally after the gate closes at line 730
- Graceful shutdown (lines 736-756) closes the HTTP server but never clears any `setInterval` timers
**Remediation:** Extract background jobs into a dedicated worker process or use BullMQ (already a dependency) for all scheduled work. At minimum, store all interval handles and clear them in `gracefulShutdown`. Ensure all jobs use `withJobLock`.

---

### SRE-03: `statement_timeout` documented but never configured
**Severity:** P1
**Description:** The comment block in `server/db.ts` (lines 1-11) claims `statement_timeout: 30s` but the Pool configuration (lines 27-32) does not set it. Any runaway query will hold a connection indefinitely until the 30s Express request timeout fires, but the DB connection itself is never released by Postgres.
**Evidence:**
- `server/db.ts:8` -- comment says "statement_timeout: 30s (kill runaway queries at the DB level)"
- `server/db.ts:27-32` -- Pool config has `max: 20`, `idleTimeoutMillis: 60_000`, `connectionTimeoutMillis: 10_000` but no `statement_timeout` option
**Remediation:** Add `statement_timeout` to the Pool's `options` or run `SET statement_timeout = '30s'` on each connection via the `connect` event.

---

### SRE-04: Primary DB pool error handler missing
**Severity:** P1
**Description:** The replica pool has `replicaPool.on("error", ...)` (line 55) but the primary `pool` has no error handler. An unhandled `error` event on the primary pool will crash the Node.js process.
**Evidence:**
- `server/db.ts:55-57` -- replica pool has error handler
- `server/db.ts:27-32` -- primary pool has no `.on("error")` handler
**Remediation:** Add `pool.on("error", (err) => logger.error("[db:primary] Pool error", err));`.

---

### SRE-05: `redis` npm package not installed -- health check crashes
**Severity:** P1
**Description:** `server/services/healthCheck.ts:222` dynamically imports the `redis` package (`import('redis')`), but `redis` is not listed in `package.json` dependencies. The health check for Redis always throws `Cannot find package 'redis'`, reporting the service as degraded. The rest of the codebase correctly uses `ioredis` (a transitive dependency of `bullmq`), but `ioredis` itself is also not an explicit dependency.
**Evidence:**
- `server/services/healthCheck.ts:222` -- `const { createClient } = await import('redis') as any;`
- `server/routes-setup.ts:322` -- also imports `redis` instead of `ioredis`
- `package.json` -- neither `redis` nor `ioredis` listed in dependencies
- `ioredis` is available only as a transitive dep of `bullmq`
**Remediation:** Add `ioredis` as an explicit dependency. Rewrite `healthCheck.ts:checkRedis()` and `routes-setup.ts:322` to use `ioredis` consistently.

---

### SRE-06: 477 KB `schema` chunk shipped to client bundle
**Severity:** P1
**Description:** The shared `@shared/schema.ts` (14,883 lines, 429 Drizzle table definitions) is imported by 20+ client files for TypeScript types AND runtime Zod validators. Vite tree-shakes types but bundles the Zod schemas, resulting in a 477 KB `schema-BijKS9R_.js` chunk. This is the 3rd largest chunk in the build.
**Evidence:**
- `dist/public/assets/schema-BijKS9R_.js` -- 477,350 bytes
- Client imports include runtime values: `client/src/pages/properties.tsx:17` imports `insertPropertySchema`, `client/src/pages/leads.tsx:17` imports `insertLeadSchema`, `client/src/pages/counties.tsx:7` imports `insertTargetCountySchema`
- Total JS bundle: 7.6 MB across 552 chunks
**Remediation:** Split `@shared/schema.ts` into separate type-only and runtime-validation modules. Create a lightweight `@shared/validators.ts` with only the Zod schemas the client actually needs, or move validation to the server and use simpler client-side validation.

---

### SRE-07: Vendor-map chunk is 1.7 MB (Mapbox GL JS)
**Severity:** P1
**Description:** `vendor-map-Cb93B-Ox.js` is 1,703,417 bytes (1.7 MB). It is loaded as a manual chunk meaning it is fetched as soon as any map-using page is loaded. Even with compression (~400 KB gzipped), this significantly impacts time-to-interactive for map pages.
**Evidence:**
- `dist/public/assets/vendor-map-Cb93B-Ox.js` -- 1,703,417 bytes
- `vite.config.ts:37` -- `'vendor-map': ['mapbox-gl']` in manualChunks
**Remediation:** Mapbox GL JS supports dynamic import. Wrap map components in a lazy boundary so the chunk is only loaded when a map page is actually visited. Consider Mapbox GL JS's CSS being loaded eagerly too.

---

### SRE-08: `index-CBWbs6Lz.js` entry chunk is 736 KB
**Severity:** P1
**Description:** The main entry chunk (containing eagerly imported components from `App.tsx` lines 19-49) is 736 KB. This includes sidebar, command palette, onboarding wizard, floating action buttons, conversation tray, and numerous UI scaffolding components that are not needed for initial paint.
**Evidence:**
- `dist/public/assets/index-CBWbs6Lz.js` -- 736,206 bytes
- `client/src/App.tsx:19-49` -- 30+ eagerly imported components including `CommandPalette`, `ConversationTray`, `FloatingActionButton`, `FloatingHelpButton`, `DynamicIsland`, `PaxCopilotRail`, `BetaFeedbackWidget`, etc.
**Remediation:** Lazy-load non-critical shell components (`CommandPalette`, `ConversationTray`, `FloatingActionButton`, `PaxCopilotRail`, `DynamicIsland`, `BetaFeedbackWidget`) behind `React.lazy`. They are interactive overlays that do not need to block first paint.

---

### SRE-09: N+1 query pattern in support ticket and field scout routes
**Severity:** P1
**Description:** The escalated tickets endpoint issues 3 separate queries per ticket (organization lookup, messages, Pax memory), wrapped in `Promise.all(tickets.map(async ...))`. For 50 escalated tickets this fires 150 individual queries. Similarly, the field scout visits endpoint issues 3 queries per visit (lead, property, photos).
**Evidence:**
- `server/routes-support-tickets.ts:449-468` -- 3 queries per ticket inside `Promise.all(escalatedTickets.map(...))`
- `server/routes-field-scout.ts:283-304` -- 3 queries per visit inside `Promise.all(visits.map(...))`
**Remediation:** Use JOINs or batch-fetch patterns (e.g., `WHERE id IN (...)`) to fetch related data in bulk.

---

### SRE-10: In-memory rate limiting does not work across multi-instance deployment
**Severity:** P1
**Description:** `server/middleware/rateLimiting.ts` uses an in-process `Map<string, WindowEntry>` for rate limiting. With 2+ Fly.io instances, each instance maintains its own counter, effectively doubling every rate limit. The file's own comment (line 5-7) acknowledges this: "falls back gracefully -- each instance enforces its own window, providing a soft limit that scales with replica count." A Redis-backed rate limiter (`server/middleware/redisRateLimit.ts`) exists but is not wired up as the default.
**Evidence:**
- `server/middleware/rateLimiting.ts:53` -- `const store = new Map<string, WindowEntry>();`
- `server/middleware/redisRateLimit.ts` -- Redis-backed alternative exists but is not used by the main middleware
- `server/middleware/idempotency.ts:35` -- idempotency store also uses in-memory `Map` as fallback
**Remediation:** When `REDIS_URL` is available, use the Redis-backed rate limiter as the default store.

---

### SRE-11: Chromium installed in production Docker image
**Severity:** P2
**Description:** The production Dockerfile installs Chromium (`apt-get install chromium chromium-sandbox`) adding ~400 MB to the image. It is used by only 2 services (`server/services/dealHunter.ts` and `server/services/browserAutomation.ts`). The `--max-old-space-size=3584` leaves only ~500 MB of the 4 GB VM for Chromium, OS, and other overhead.
**Evidence:**
- `Dockerfile:32-34` -- `apt-get install --no-install-recommends -y chromium chromium-sandbox`
- `Dockerfile:42` -- `NODE_OPTIONS="--max-old-space-size=3584"` (3.5 GB for Node out of 4 GB VM)
- Only 2 files reference puppeteer: `server/services/dealHunter.ts`, `server/services/browserAutomation.ts`
**Remediation:** Move browser automation to a separate worker process or use a headless browser service. Alternatively, use a multi-stage build that only includes Chromium in a worker image.

---

### SRE-12: No API response caching headers for JSON endpoints
**Severity:** P2
**Description:** API JSON responses do not set `Cache-Control` headers. The response cache middleware (`server/middleware/responseCache.ts`) caches responses in-memory on the server side but does not instruct browsers or CDNs to cache. Every navigation re-fetches all data. The React Query client has `staleTime: 2 minutes` which helps, but browser tab reloads still hit the server.
**Evidence:**
- No `Cache-Control` headers set on API responses (verified by searching for `Cache-Control` in route files -- only found in `server/static.ts` for HTML/static assets)
- `server/middleware/responseCache.ts` sets `X-Cache: HIT/MISS` headers but no `Cache-Control`
**Remediation:** For read-heavy endpoints (dashboard stats, org settings), set `Cache-Control: private, max-age=60` or similar. This reduces server load and improves perceived performance on browser refresh.

---

### SRE-13: `ioredis` used as phantom dependency
**Severity:** P2
**Description:** 14 server files dynamically import `ioredis`, but it is not listed in `package.json`. It works in production only because `bullmq` (a listed dependency) depends on it transitively. A `bullmq` upgrade could change this, breaking all Redis functionality.
**Evidence:**
- `server/services/cache.ts:83`, `server/middleware/idempotency.ts:51`, `server/utils/redis.ts:33`, `server/routes-admin.ts:2528/2573/2592`, `server/jobs/dbBackup.ts:122`, `server/services/userAiCostControls.ts:69`, `server/services/realtimeAlerts.ts:62`, `server/services/communicationDeduplication.ts:52`, `server/services/jobQueue.ts:53`
- `package.json` -- `ioredis` not listed in dependencies or devDependencies
**Remediation:** Add `ioredis` as an explicit production dependency.

---

### SRE-14: Health check endpoint calls all external services synchronously
**Severity:** P2
**Description:** `GET /api/health` calls `healthCheckService.checkAll()` which fires health checks to Stripe, OpenAI, Lob, and others in parallel. If any external service is slow, the health check blocks. Fly.io polls `/api/health/cached` (which returns cached results), but the uncached endpoint is still exposed and could be abused to DOS external APIs via health check amplification.
**Evidence:**
- `server/routes.ts:342-349` -- `/api/health` calls `checkAll()` which hits 7 external services
- `server/routes.ts:352-364` -- `/api/health/cached` correctly returns cached results
- `fly.toml:34` -- Fly.io health probe correctly points to `/api/health/cached`
**Remediation:** Rate-limit or require authentication on the uncached `/api/health` endpoint. Consider making it admin-only.

---

### SRE-15: No connection pool drain on graceful shutdown
**Severity:** P2
**Description:** The graceful shutdown handler closes the HTTP server and waits 5 seconds, but never calls `pool.end()` or `replicaPool.end()`. In-flight DB queries may be interrupted, and connections are left dangling until the process is force-killed at 30 seconds.
**Evidence:**
- `server/index.ts:736-756` -- graceful shutdown closes HTTP server, sets 5s delay, but does not close DB pools
- `server/db.ts:27-59` -- pool and replicaPool are exported but never closed in shutdown
**Remediation:** Add `pool.end()` and `replicaPool.end()` to the graceful shutdown sequence after closing the HTTP server.

---

### SRE-16: `compression` middleware does not negotiate Brotli
**Severity:** P2
**Description:** The comment on line 195 of `server/index.ts` says "Enable gzip/brotli compression" but the `compression` npm package only supports gzip/deflate, not Brotli. Brotli provides 15-25% better compression ratios for JavaScript.
**Evidence:**
- `server/index.ts:195-197` -- `import compression from "compression"; app.use(compression({ threshold: 1024 }));`
- The `compression` package (v1.8.1) does not support Brotli encoding
**Remediation:** Use `@fastify/compress` or `shrink-ray-current` for Brotli support, or rely on Fly.io edge / Cloudflare for Brotli compression of static assets.

---

### SRE-17: `index.html` is read synchronously on every SPA request
**Severity:** P2
**Description:** `server/static.ts:60` calls `fs.readFileSync(indexPath, "utf-8")` on every non-API request. For a production server handling hundreds of concurrent requests, synchronous file I/O blocks the event loop.
**Evidence:**
- `server/static.ts:60` -- `let html = fs.readFileSync(indexPath, "utf-8");`
**Remediation:** Read the file once at startup and cache it in memory, or use `fs.promises.readFile` for async I/O.

---

### SRE-18: Founder dashboard chunk is 383 KB
**Severity:** P2
**Description:** `founder-dashboard-CkNVwBsz.js` is 382,980 bytes. This is a single component (7,286 LOC per the orientation doc) that cannot be further code-split because it's one file.
**Evidence:**
- `dist/public/assets/founder-dashboard-CkNVwBsz.js` -- 382,980 bytes
- Orientation doc notes the founder dashboard is 7,286 LOC in a single file
**Remediation:** Refactor the founder dashboard into sub-components per tab, each lazy-loaded. This was partially done (tab nav added) but the monolith remains.

---

### SRE-19: No database query logging or slow query monitoring active
**Severity:** P2
**Description:** The `server/db.ts` comment (line 1) mentions "Slow Query Monitoring" but no slow query logging is implemented. Drizzle ORM does not automatically log slow queries. Without this, there is no visibility into which queries are consuming the most time.
**Evidence:**
- `server/db.ts:1-11` -- comment mentions "Slow query logging" and `SLOW_QUERY_THRESHOLD_MS` but no implementation exists
- No `query` event handler on the pool for duration tracking
**Remediation:** Add a `pool.on('connect')` handler that wraps `client.query` to measure and log queries exceeding a threshold.

---

### SRE-20: OpenTelemetry tracing is effectively disabled in production
**Severity:** P3
**Description:** `server/tracing.ts` defaults to `OTEL_EXPORTER=none` when the env var is unset. The orientation doc does not mention any tracing backend being configured. Without distributed tracing, debugging latency issues across 926 endpoints is manual.
**Evidence:**
- `server/tracing.ts:57` -- `const mode = process.env.OTEL_EXPORTER || "none";`
- `server/index.ts:409-413` -- tracing init is wrapped in try/catch and logs "skipped" on failure
**Remediation:** Configure an OTLP endpoint (Honeycomb, Grafana Tempo, or Fly.io's built-in tracing) and set `OTEL_EXPORTER=otlp`.

---

### SRE-21: `esbuild` server bundle skips tree-shaking of unused route files
**Severity:** P3
**Description:** `script/build.ts` bundles the server entry point with `esbuild` in CJS format. Since all 122 route files are imported via `registerRoutes`, they are all bundled even if many endpoints are dead/unused. The 926-endpoint surface area inflates startup time and memory.
**Evidence:**
- `script/build.ts:50-62` -- esbuild bundles `server/index.ts` as single CJS file
- Orientation doc: "926 API endpoints -- Many likely dead/untested"
**Remediation:** Audit and prune unused route files. Consider lazy-loading route modules that are rarely accessed.

---

### SRE-22: Docker build deletes `package-lock.json` before `npm install`
**Severity:** P3
**Description:** `Dockerfile:24` runs `rm -f package-lock.json && npm install` which discards the lockfile and resolves fresh dependency versions on every build. This means builds are not reproducible and could pull in breaking transitive dependency updates.
**Evidence:**
- `Dockerfile:23-24` -- `RUN rm -f package-lock.json && npm install --include=dev --legacy-peer-deps`
- Comment says "Lock file generated on macOS -- fresh install ensures linux platform binaries"
**Remediation:** Use `npm ci` instead, which respects the lockfile and installs platform-specific binaries. If the lockfile has macOS-specific optional deps, regenerate it in CI on a Linux runner.

---

## Embarrassment Test

Three things that would embarrass an SRE reviewing this system:

1. **44 `setInterval` timers in the main process with no cleanup on shutdown.** This is a textbook resource leak. The graceful shutdown handler closes the HTTP server but leaves all 44 background timers running, which continue to fire DB queries and API calls during the drain period. Any SRE would immediately flag this as "process cannot shut down cleanly."

2. **`statement_timeout` documented in a code comment but never actually set.** The `db.ts` file has a detailed comment block promising query-level safeguards that do not exist. A single runaway analytics query could hold a connection for minutes, exhausting the 20-connection pool and causing cascading failures.

3. **Core entity queries (`getLeads`, `getProperties`, `getDeals`) have no LIMIT clause and are called from the dashboard, MCP server, and AI agents.** An organization with 10,000 leads will pull the entire table into Node.js memory on every dashboard load. With 4 GB VM memory and `--max-old-space-size=3584`, this is a path to OOM.

---

## Pride Test

Three things that would make an SRE proud:

1. **Well-implemented circuit breaker pattern.** `server/utils/circuitBreaker.ts` implements a proper three-state circuit breaker (CLOSED/OPEN/HALF_OPEN) with sliding-window failure tracking, configurable thresholds, and pre-configured instances for 7 external services (OpenAI, Stripe, Redis, email, enrichment, county APIs, Twilio). This is production-grade resilience engineering.

2. **Thoughtful static asset caching.** `server/static.ts` correctly serves hashed assets with `max-age=1y, immutable` while serving `index.html` with `no-cache, no-store, must-revalidate`. The Vite build produces content-hashed filenames. This is the correct cache-busting strategy for SPAs.

3. **Health check architecture with tiered caching.** The system exposes `/api/health` (full check), `/api/health/cached` (returns last result), and `/api/health/:service` (per-service). Fly.io is correctly configured to probe the cached endpoint, and periodic background checks populate the cache every 60 seconds. The health check includes pool stats (total/idle/waiting connections), which is invaluable for debugging.
