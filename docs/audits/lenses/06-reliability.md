# Lens 6 -- Reliability Engineer Audit

**Auditor persona:** Reliability Engineer -- evaluates error recovery, circuit breakers, graceful degradation, timeout handling, retry logic, health checks, and operational resilience.

**Date:** 2026-04-15
**Codebase snapshot:** commit ff7b154 (main)

---

## Executive Summary

AcreOS has a solid *foundation* for reliability: a well-designed circuit breaker utility, health check service, Sentry integration, graceful shutdown skeleton, and Fly.io liveness probes. However, the foundation is largely **unused by the actual service code**. The circuit breaker for OpenAI exists but zero of the 40+ OpenAI call sites use it. The Twilio circuit breaker is defined but never called. Dozens of external `fetch()` calls to Lob, Land.com, Dropbox Sign, Meta, Google, PropStream, and BatchLeads lack timeouts, retries, and circuit breakers. The graceful shutdown does not close the database pool or WebSocket server. The health check Redis probe imports a package (`redis`) that is not installed, guaranteeing a "degraded" status on every check.

---

## Findings

### REL-01: OpenAI circuit breaker exists but is never used

**Severity:** P1
**Category:** Missing circuit breaker on external call

`server/utils/circuitBreaker.ts` defines `openAICircuitBreaker` and `server/utils/openaiClient.ts` exports `callWithCircuitBreaker()`. However, scanning all 40+ call sites that invoke `openai.chat.completions.create(...)` reveals **zero** use `callWithCircuitBreaker`. Every AI call bypasses the circuit breaker entirely.

**Evidence:**
- `server/utils/openaiClient.ts:35` -- `callWithCircuitBreaker` is defined
- `server/routes-deals.ts:654`, `server/routes-academy.ts:154`, `server/routes-admin.ts:3325`, `server/ai/vaService.ts:639`, `server/ai/supportAgent.ts:2960`, `server/services/aiOfferService.ts:215`, `server/services/negotiationCopilot.ts:257`, `server/services/founderDigest.ts:127`, `server/services/leadNurturer.ts:180`, `server/services/supportBrain.ts:70`, `server/services/visionAI.ts:69`, etc. -- all call `openai.chat.completions.create()` directly.
- `callWithCircuitBreaker` has exactly 2 references in the codebase, both in `openaiClient.ts` itself (definition + export).

**Remediation:** Wrap all OpenAI API calls via `callWithCircuitBreaker`. A lint rule or wrapper function that *replaces* direct `openai.chat.completions.create` usage would prevent regression.

---

### REL-02: Twilio circuit breaker defined but never invoked

**Severity:** P1
**Category:** Missing circuit breaker on external call

`server/utils/circuitBreaker.ts:202` defines `twilioCircuitBreaker` with threshold 3 and 30s reset. Neither `server/services/smsProvider.ts` nor `server/services/smsService.ts` imports or calls it. Both services make raw `fetch()` calls to `api.twilio.com` with no timeout, no retry, and no circuit breaker.

**Evidence:**
- `server/services/smsProvider.ts:123` -- `await fetch(url, { ... })` to Twilio with no `signal`, no timeout, no circuit breaker.
- `server/services/smsService.ts:86` -- identical pattern.
- `twilioCircuitBreaker.call` returns zero grep matches.

**Remediation:** Wire `twilioCircuitBreaker` into both SMS services. Add `signal: AbortSignal.timeout(10_000)` to Twilio fetch calls.

---

### REL-03: Stripe circuit breaker only protects createCustomer

**Severity:** P1
**Category:** Inconsistent circuit breaker coverage

`stripeCircuitBreaker.call()` is used exactly once -- for `createCustomer` (line 14). All other Stripe operations -- `createCheckoutSession`, `createCreditPurchaseCheckout`, `createCustomerPortalSession`, `listProducts`, `listProductsWithPrices`, `getProduct` -- call the Stripe SDK directly without the circuit breaker.

**Evidence:**
- `server/stripeService.ts:57` -- `stripe.checkout.sessions.create(sessionConfig, ...)` outside circuit breaker.
- `server/stripeService.ts:73` -- `stripe.checkout.sessions.create(...)` outside circuit breaker.
- `server/stripeService.ts:96` -- `stripe.billingPortal.sessions.create(...)` outside circuit breaker.
- `server/stripeService.ts:113` -- `stripe.products.list(...)` outside circuit breaker.

**Remediation:** Wrap all Stripe SDK calls in `stripeCircuitBreaker.call()`.

---

### REL-04: SMS, mail, e-signing, listing syndication fetch calls lack timeouts

**Severity:** P1
**Category:** Missing timeout on external call

Multiple services making outbound HTTP calls to third-party APIs do not set `AbortSignal.timeout()` or any abort controller. If the remote service hangs, the Node.js event loop holds the connection indefinitely, risking pool/thread exhaustion.

**Evidence (no timeout):**
- `server/services/smsProvider.ts:123` -- Twilio fetch, no timeout
- `server/services/smsProvider.ts:154` -- Telnyx fetch, no timeout
- `server/services/smsService.ts:86` -- Twilio fetch, no timeout
- `server/services/mailProvider.ts:214` -- PCM letters fetch, no timeout
- `server/services/mailProvider.ts:279` -- PCM postcards fetch, no timeout
- `server/services/eSigningService.ts:132` -- Dropbox Sign send, no timeout
- `server/services/eSigningService.ts:197` -- Dropbox Sign status, no timeout
- `server/services/eSigningService.ts:303` -- Dropbox Sign cancel, no timeout
- `server/services/eSigningService.ts:324` -- Dropbox Sign remind, no timeout
- `server/services/listingSyndication.ts:480` -- Land.com create, no timeout
- `server/services/listingSyndication.ts:555` -- LandFlip create, no timeout
- `server/services/listingSyndication.ts:613` -- Facebook catalog, no timeout
- `server/services/listingSyndication.ts:736` -- Land.com update, no timeout
- `server/services/listingSyndication.ts:761` -- Land.com delete, no timeout
- `server/services/googleCalendarSync.ts:54` -- Google OAuth exchange, no timeout
- `server/services/googleCalendarSync.ts:85` -- Google Calendar create, no timeout
- `server/services/growthAdService.ts:30` -- Meta Ads GET, no timeout
- `server/services/growthAdService.ts:44` -- Meta Ads POST, no timeout
- `server/services/addressValidation.ts:75` -- Lob verification, no timeout
- `server/services/connectors/executor.ts:269` -- PropStream, no timeout
- `server/services/connectors/executor.ts:281` -- PropStream comps, no timeout
- `server/services/connectors/executor.ts:294` -- BatchLeads, no timeout

**Contrast:** Data-source-broker, parcel service, skip tracing, and due diligence engine correctly use `AbortSignal.timeout()` on almost all calls. The pattern exists in the codebase but was not applied consistently.

**Remediation:** Add `signal: AbortSignal.timeout(10_000)` (or appropriate duration) to every outbound fetch call. Consider a `fetchWithTimeout` wrapper to enforce this globally.

---

### REL-05: Health check Redis probe uses non-installed `redis` package

**Severity:** P1
**Category:** Health check failure mode

`server/services/healthCheck.ts:222` does `await import('redis')`, but the project uses `ioredis` -- not the `redis` npm package. The orientation document confirms this produces `"Cannot find package 'redis'"` in production, forcing the health check to always report Redis as degraded.

Additionally, this health check creates a **new Redis client per invocation** (every 60 seconds via periodic checks). Even if the import worked, this would leak connections if the `disconnect()` call fails or the check times out.

**Evidence:**
- `server/services/healthCheck.ts:222` -- `const { createClient } = await import('redis') as any;`
- `server/utils/redis.ts:34` -- the actual Redis utility uses `import("ioredis")`
- Orientation doc P0 item 4: "Redis package missing -- Health check shows 'Cannot find package redis' in production"

**Remediation:** Rewrite `checkRedis()` to use the shared `getRedisClient()` from `server/utils/redis.ts` (ioredis). Ping the existing shared client instead of creating a new one.

---

### REL-06: Graceful shutdown does not close database pool or WebSocket server

**Severity:** P1
**Category:** Incomplete graceful shutdown

The graceful shutdown handler (`server/index.ts:736-756`) closes the HTTP server and waits 5 seconds, then exits. It does **not** close:
1. The primary database connection pool (`pool` from `server/db.ts`)
2. The replica database connection pool (`replicaPool`)
3. The WebSocket server (`wsServer`)
4. The health check periodic interval

On Fly.io rolling deploys, this means active DB connections are abruptly terminated rather than drained, which can cause mid-flight queries to fail or leave idle connections in the pool that count against the managed Postgres connection limit (which is constrained on shared-cpu-2x).

**Evidence:**
- `server/index.ts:736-756` -- only calls `httpServer.close()`, then `process.exit(0)`
- `server/db.ts:27` -- `pool` is exported but never `pool.end()` is called
- `server/db.ts:48` -- `replicaPool` same issue
- `fly.toml:17` -- `min_machines_running = 2`, so rolling deploys are frequent

**Remediation:** Before `process.exit(0)`, call `pool.end()`, `replicaPool.end()`, `wsServer.close()`, and `healthCheckService.stopPeriodicChecks()`.

---

### REL-07: Primary database pool has no `pool.on('error')` handler

**Severity:** P1
**Category:** Missing error handler on database pool

The replica pool has `replicaPool.on("error", ...)` (`server/db.ts:55`), but the **primary** pool has no error handler. An unhandled error event on the primary pool (e.g., connection terminated by the server) would emit an uncaught error and potentially crash the process.

**Evidence:**
- `server/db.ts:27-33` -- `pool` is created with no `.on("error", ...)` handler
- `server/db.ts:55-57` -- `replicaPool.on("error", ...)` exists (asymmetry)

**Remediation:** Add `pool.on("error", (err) => { logger.error("[db:primary] Unexpected client error", err); });` immediately after pool creation.

---

### REL-08: `statement_timeout` documented but never configured

**Severity:** P2
**Category:** Missing query timeout

The comment in `server/db.ts:8` claims `statement_timeout: 30s (kill runaway queries at the DB level)` but the actual Pool configuration does not set this. The pool config only specifies `max`, `idleTimeoutMillis`, and `connectionTimeoutMillis`. Any runaway query (e.g., full table scan on a 429-table schema) will hold a connection indefinitely.

**Evidence:**
- `server/db.ts:1-8` -- comment says `statement_timeout: 30s`
- `server/db.ts:27-32` -- actual Pool config has no `statement_timeout` option
- Grep for `statement_timeout` across all `.ts` files returns only the comment

**Remediation:** Add `options: '-c statement_timeout=30000'` to the Pool constructor, or set `statement_timeout` via the connection string.

---

### REL-09: No retry logic on SMS, mail, e-signing, or listing syndication

**Severity:** P2
**Category:** Missing retry on external call

The email service (`server/services/emailService.ts`) has proper retry with exponential backoff. However, the following services have zero retry logic:
- `server/services/smsProvider.ts` -- Twilio and Telnyx calls (fire once, return error)
- `server/services/smsService.ts` -- Twilio calls (fire once)
- `server/services/mailProvider.ts` -- Lob and PCM calls (fire once)
- `server/services/eSigningService.ts` -- Dropbox Sign calls (fire once)
- `server/services/listingSyndication.ts` -- Land.com, LandFlip, Facebook calls (fire once)
- `server/services/googleCalendarSync.ts` -- Google Calendar calls (fire once)

Transient network errors will cause permanent failure for these operations.

**Evidence:** None of these files contain the strings "retry", "backoff", or "attempt" (verified via grep).

**Remediation:** Implement retry with exponential backoff for transient errors (5xx, ECONNRESET, ETIMEDOUT). The `fetchWithRetry` pattern in `server/services/webhookDispatcher.ts:222` is a good model.

---

### REL-10: Health check OpenAI probe uses wrong env var

**Severity:** P2
**Category:** Health check inaccuracy

`server/services/healthCheck.ts:69` checks `process.env.OPENAI_API_KEY`. The actual OpenAI client (`server/utils/openaiClient.ts:8`) uses `process.env.AI_INTEGRATIONS_OPENAI_API_KEY`. This mismatch means:
1. Health check may report OpenAI as "unconfigured" when it actually works (if only `AI_INTEGRATIONS_OPENAI_API_KEY` is set).
2. Health check may report OpenAI as "healthy" when the actual client cannot initialize (if only `OPENAI_API_KEY` is set but the app reads a different var).

**Evidence:**
- `server/services/healthCheck.ts:69` -- `process.env.OPENAI_API_KEY`
- `server/utils/openaiClient.ts:8` -- `process.env.AI_INTEGRATIONS_OPENAI_API_KEY`

**Remediation:** Align the health check to use the same env var (`AI_INTEGRATIONS_OPENAI_API_KEY`) or call `getOpenAIClient()` to check the actual client configuration.

---

### REL-11: 465 async route handlers without asyncHandler wrapper

**Severity:** P2
**Category:** Unhandled promise rejection risk

The `asyncHandler` utility (`server/middleware/asyncHandler.ts`) correctly forwards promise rejections to Express error middleware. However, it is only used in 2 route files (39 usages across `routes-marketplace.ts` and `routes-deal-rooms.ts`). The remaining 465+ `async (req, res)` route handlers across 23+ route files rely on manual `try/catch` blocks. Any handler that throws without catching will produce an unhandled promise rejection, which the global handler logs but does not send a response for -- the client will hang until the request timeout middleware fires at 30 seconds.

**Evidence:**
- `asyncHandler` grep returns 39 usages in 2 files
- `app.(get|post|...) ... async (req` grep returns 465 across 23 route files
- `server/index.ts:45` -- unhandled rejection logs but does not respond

**Remediation:** Wrap all async route handlers in `asyncHandler`, or add an Express middleware that automatically wraps all async handlers (e.g., `express-async-errors` or a custom wrapper applied at route registration).

---

### REL-12: 145 empty `catch` blocks silently swallow errors

**Severity:** P2
**Category:** Silent error swallowing

Grep for empty catch blocks (`catch {}`, `catch () {}`, `catch { /* */}`) returns 145 occurrences across 67 files. While some are legitimate (best-effort logging, non-critical cleanup), others may hide real failures in critical paths.

**Evidence:** `server/services/healthCheck.ts:375` -- swallows the error when creating a system alert for a health failure (the alert about the failure... fails silently). Also found in `server/services/autonomyFinalMile.ts` (5 empty catches), `server/services/agentInitiativeEngine.ts` (6), `server/services/outcomeVerificationLoop.ts` (6), `server/services/aiAdvisorTeamV15.ts` (8).

**Remediation:** Audit all empty catch blocks. At minimum, add `logger.warn(...)` to preserve observability. For critical paths, re-throw or propagate the error.

---

### REL-13: Fly.io health probe hits `/api/health/cached` which may run full check

**Severity:** P2
**Category:** Health check cascade risk

`fly.toml:34` configures the liveness probe to hit `/api/health/cached` every 30 seconds with a 5-second timeout. The cached endpoint (`server/routes.ts:352-363`) returns cached results if available, but falls back to `healthCheckService.checkAll()` when the cache is empty (e.g., on fresh deploy, after restart). `checkAll()` runs 7 parallel checks including external API calls to Stripe, OpenAI, Lob, and a Redis connect+ping. If any of these services are slow, the health check exceeds the 5-second Fly.io timeout and the machine is marked unhealthy, potentially causing a restart loop.

**Evidence:**
- `fly.toml:31` -- `timeout = '5s'`
- `server/routes.ts:356-358` -- `if (!result) { const freshResult = await healthCheckService.checkAll(); ... }`
- `server/services/healthCheck.ts:32-47` -- Stripe check does `stripe.balance.retrieve()` (network call)
- `server/services/healthCheck.ts:77` -- OpenAI check does `openai.models.list()` (network call)
- `server/services/healthCheck.ts:157` -- Lob check does `fetch('https://api.lob.com/...')` (no timeout)

**Remediation:** The cached health endpoint should return a synthetic "starting" result instead of falling back to `checkAll()`. Add `AbortSignal.timeout(4000)` to all health check external calls so they cannot exceed the Fly probe timeout.

---

### REL-14: Job queue falls back to in-memory when Redis is unavailable

**Severity:** P2
**Category:** Data loss on restart

`server/services/jobQueue.ts:43-45` warns that without `REDIS_URL`, jobs use an in-memory queue. The orientation doc confirms Redis is not installed in production (P0 item 4). This means all background jobs (email sends, webhook dispatches, payment syncs, notifications) are stored only in memory and **lost on every deploy or restart**. On Fly.io with rolling deploys, this is a near-certain data loss scenario.

**Evidence:**
- `server/services/jobQueue.ts:43-46` -- `"Jobs will not survive server restarts. Set REDIS_URL to enable BullMQ."`
- `fly.toml:14` -- `auto_stop_machines = 'off'` but rolling deploys still restart
- Orientation doc P0 item 4: Redis package missing in production

**Remediation:** Either deploy Redis (Fly.io Upstash add-on) or persist the in-memory queue to the database before shutdown. The DB-backed fallback already loads pending jobs (`loadPendingJobsFromDb`) but does not persist new jobs to DB when running in-memory mode.

---

### REL-15: Health check Lob and Stripe probes have no timeout

**Severity:** P3
**Category:** Missing timeout on health check

The Lob health check (`healthCheck.ts:157`) uses `fetch()` with no `signal` or timeout. The Stripe health check (`healthCheck.ts:45`) calls `stripe.balance.retrieve()` with no timeout. The OpenAI health check (`healthCheck.ts:77`) calls `openai.models.list()` with no timeout. These can hang indefinitely, blocking the periodic health check interval and causing stale cached results.

**Evidence:**
- `server/services/healthCheck.ts:157` -- `fetch('https://api.lob.com/v1/addresses', { ... })` -- no signal
- `server/services/healthCheck.ts:45` -- `await stripe.balance.retrieve()` -- no timeout
- `server/services/healthCheck.ts:77` -- `await openai.models.list()` -- no timeout

**Remediation:** Add `signal: AbortSignal.timeout(5000)` to all health check external calls. For SDK clients (Stripe, OpenAI), use `Promise.race` with a timeout.

---

### REL-16: Request timeout middleware responds but does not abort work

**Severity:** P3
**Category:** Incomplete timeout implementation

`server/middleware/security.ts:121-134` sends a 408 response after 30 seconds, but the route handler continues executing. The database query, external API call, or business logic keeps running. This wastes resources and can cause "headers already sent" errors if the handler later tries to respond.

**Evidence:**
- `server/middleware/security.ts:123-134` -- sets `setTimeout` to send 408, but does not abort the underlying operation or signal to the handler.
- `server/index.ts:54` -- ERR_HTTP_HEADERS_SENT is caught and suppressed, confirming this happens in practice.

**Remediation:** Use `AbortController` attached to the request so handlers can check `req.signal.aborted` and bail out.

---

## Embarrassment Test

**Would this codebase embarrass us if a reliability-focused engineer reviewed it?**

Yes, in specific areas. The **gap between defined infrastructure and actual usage** is the primary embarrassment. Having 7 circuit breakers defined but only 2 partially used (Stripe: 1 of 8 calls, email: 1 service) creates a false sense of security. The health check importing a non-installed package (`redis` instead of `ioredis`) that has been broken since deployment is operationally visible to anyone checking the health endpoint. The 22+ external fetch calls without timeouts in user-facing services (SMS, mail, e-signing) represent real user-impacting failure modes where a slow third-party API could hang the entire request for 30 seconds.

## Pride Test

**What reliability patterns can we be proud of?**

1. **Circuit breaker utility is well-designed** (`server/utils/circuitBreaker.ts`) -- supports consecutive-failure counting, sliding-window tracking, half-open state, state-change callbacks, and has unit tests. The architecture is solid; it just needs adoption.
2. **Email service is the gold standard** (`server/services/emailService.ts`) -- retry with exponential backoff, retryable-error classification, circuit breaker integration, structured logging with duration and attempt count, and graceful degradation. Every other external service should be modeled after this.
3. **Data-source-broker has comprehensive timeouts** -- nearly all 60+ fetch calls in `data-source-broker.ts` use `AbortSignal.timeout()`. This is the correct pattern, consistently applied.
4. **Provider registry circuit breaking** -- the `ProviderRegistry` class implements its own circuit breaker with 3-failure threshold and 5-minute window, gracefully falling through to the next provider. This is the right architecture for multi-provider resilience.
5. **Stripe webhook idempotency** -- `server/webhookHandlers.ts` has proper event deduplication via `stripeProcessedEvents` table, signature verification, and always-mark-processed semantics to prevent infinite Stripe retries.
6. **Job supervisor** -- `server/services/jobSupervisor.ts` wraps background jobs with timing, consecutive-failure detection, and alerting after 3 failures. This is good operational observability.
7. **Structured health checks** -- `server/services/healthCheck.ts` checks 7 services, computes overall status, alerts after 5 consecutive failures, and runs on a configurable interval. The design is correct even if the Redis implementation is broken.
8. **Graceful shutdown exists** -- the SIGTERM handler with force-exit safety net (30s) is the right pattern for Fly.io. It needs completion (DB pool, WebSocket), not redesign.
