# Lens 052 -- Memory Leak Hunter

Auditor: Memory Leak Hunter (Tier 2)
Date: 2026-04-18
Scope: `server/` and `client/src/` -- all patterns that cause unbounded memory growth in a long-running Node.js process or persistent React SPA.

---

## Executive Summary

AcreOS runs on a 4 GB RAM Fly.io instance. The codebase contains **30+ module-level in-memory Maps/Sets/arrays** that act as caches or registries, many of which grow without bound. At least 7 `setInterval` calls at module scope are never tracked for graceful shutdown. Several "SCP" subsystems use append-only arrays for execution logs that will grow linearly for the entire process lifetime. On the client side, `useKpiStream` opens a **duplicate WebSocket connection** separate from the shared `useRealtime` singleton, and the module-level `listeners` Map in `use-realtime.ts` never prunes empty handler sets.

Severity breakdown:
- **Critical (will OOM in production):** 4 findings
- **High (slow leak, OOM in days/weeks):** 11 findings
- **Medium (bounded but wasteful):** 7 findings
- **Low (cleanup hygiene):** 5 findings

---

## Critical Findings

### C1. Unbounded append-only arrays in SCP subsystems

Multiple "SCP" (Sovereign Capability Platform) service files use module-level arrays that are pushed to on every operation and never trimmed or evicted.

| File | Line | Variable | Growth Rate |
|------|------|----------|-------------|
| `server/services/scpOutboundExecution.ts` | 114 | `executionLog: ExecutionRequest[]` | Every agent execution |
| `server/services/scpOutboundExecution.ts` | 115 | `outcomeLog: ExecutionOutcome[]` | Every execution outcome |
| `server/services/scpOutboundExecution.ts` | 116 | `confirmationQueue: ConfirmationRequest[]` | Every confirmation request |
| `server/services/scpStrategicIntelligence.ts` | 81 | `marketSignals: MarketSignal[]` | Every market signal |
| `server/services/scpCustomerLifecycle.ts` | 99-104 | `ruleExecutionLog: Array<...>` | Every automation rule execution |
| `server/services/scpFinancialAutonomy.ts` | 88-89 | `costLedger: CostEntry[]` / `revenueLedger: RevenueEntry[]` | Every AI cost/revenue event |
| `server/services/abTestEngine.ts` | 77 | `outcomes: AbOutcome[]` | Every A/B test outcome |

**Impact:** These arrays have no `.slice()`, no max-length cap, and no periodic pruning. On a server handling thousands of operations per day, each array will accumulate indefinitely. The `executionLog` and `outcomeLog` are particularly dangerous because every agent action triggers a push. Over weeks, these will consume hundreds of MB.

**Fix:** Add a ring-buffer pattern (`if (arr.length > MAX) arr.splice(0, arr.length - MAX)`) or, better, persist to DB and keep only recent entries in memory.

### C2. MetricsCollector histogram values array grows per unique route

`server/middleware/metrics.ts`, lines 20-28

```typescript
observeHistogram(name: string, value: number, labels: Record<string, string> = {}) {
    const key = this.labelKey(name, labels);
    const bucket = this.histograms.get(key) || { count: 0, sum: 0, values: [] };
    bucket.count++;
    bucket.sum += value;
    bucket.values.push(value);
    if (bucket.values.length > 1000) bucket.values = bucket.values.slice(-500);
    this.histograms.set(key, bucket);
}
```

The `values` array is capped at 1000 entries per unique key, but the **number of keys** is unbounded. Each combination of `{method, route}` creates a new histogram bucket. With 926 API endpoints and dynamic path segments (e.g., `/api/leads/:id`), the `route` label includes the actual `req.path` value (`/api/leads/12345`), not the parameterized pattern. This means every unique lead/property/deal ID creates a new histogram key holding up to 1000 numbers.

**Impact:** With 10K unique resource IDs accessed, this is 10K keys x 1000 floats = ~80 MB. On active production, this will grow much larger.

**Fix:** Use `req.route?.path` consistently (parameterized pattern) and fall back to a normalized path. Add a cap on the total number of histogram keys.

### C3. `errorCounters` Map in routes-metrics.ts is unbounded

`server/routes-metrics.ts`, line 52

```typescript
const errorCounters = new Map<string, number>();
```

Key format is `${path}:${statusCode}`. Because `path` includes dynamic segments, every unique URL that returns an error creates a new entry. Error responses from bot-probing or path-traversal attempts (e.g., `/api/wp-admin`, `/api/../../../etc/passwd`) will all create unique entries. This Map is never pruned.

**Impact:** In production, bots and scanners generate thousands of unique error paths daily, each creating a permanent entry.

**Fix:** Normalize paths before keying, and add periodic pruning or a max-size cap.

### C4. Duplicate WebSocket connections from `useKpiStream`

`client/src/hooks/use-kpi-stream.ts`, lines 38-89

This hook creates its own independent `new WebSocket(url)` connection to `/ws`. The main `useRealtime` hook at `client/src/hooks/use-realtime.ts` already maintains a global singleton WebSocket connection. Every component using `useKpiStream` opens a **second** persistent connection, doubling server-side connection tracking and memory usage per user.

**Impact:** Each extra WebSocket connection consumes server memory (tracked in the `clients` Map at `server/websocket.ts:106`). With the server-side cap of 1000 connections, this effectively halves the capacity.

**Fix:** Refactor `useKpiStream` to use the shared `useRealtime` hook, subscribing to `kpi.update` events through the existing connection.

---

## High Severity Findings

### H1. Module-level `setInterval` calls not tracked for graceful shutdown

`server/index.ts` lines 99-108 define a `trackInterval()` utility, but many module-level `setInterval` calls bypass it entirely:

| File | Line | Interval | Purpose |
|------|------|----------|---------|
| `server/middleware/rateLimit.ts` | 36 | 1h | rateLimitHits cleanup |
| `server/middleware/rateLimit.ts` | 93 | 1min | rateLimitStore cleanup |
| `server/middleware/rateLimiting.ts` | 57 | 2min | feature rate limit cleanup |
| `server/middleware/idempotency.ts` | 38 | 10min | memStore cleanup |
| `server/services/communicationDeduplication.ts` | 36 | periodic | memKeys cleanup |
| `server/services/founderDigest.ts` | 259 | 1h | digest check |
| `server/services/revenueProtection.ts` | 318 | periodic | revenue scan |
| `server/services/browserAutomation.ts` | 746 | 30s | job processor |
| `server/services/aiAdvisorTeamV15.ts` | 525 | 1h | advisor cycle |
| `server/services/externalStatusMonitor.ts` | 207 | 5min | outage detection |

These intervals continue running during shutdown, preventing the process from exiting cleanly. The 30-second force-exit timeout at `server/index.ts:777` catches this, but it means in-flight DB operations may be interrupted.

### H2. Unbounded in-memory Maps acting as primary data stores

Multiple services use Maps as their sole data store with no eviction policy or size cap:

| File | Line | Variable | Content |
|------|------|----------|---------|
| `server/services/investorVerification.ts` | 12-26 | `verificationStore` | Verification requests with nested document arrays |
| `server/services/modelTraining.ts` | 27 | `jobRegistry` | Training jobs with full config objects |
| `server/services/scpSelfProvisioning.ts` | 64-66 | `capabilityGaps`, `solutions`, `provisioningTasks` | Three Maps growing with every gap/solution/task |
| `server/services/scpCustomerLifecycle.ts` | 97-98 | `customers`, `automationRules` | Customer profiles with signals arrays |
| `server/services/scpExperimentEngine.ts` | 72 | `experiments` | Full experiment objects with variant data |
| `server/services/scpStrategicIntelligence.ts` | 80, 82 | `competitors`, `initiatives` | Competitor profiles and strategic initiatives |
| `server/services/certification.ts` | 60-63 | `certificateStore`, `userCertificates`, `achievementStore`, `userAchievements` | Four Maps, never pruned |
| `server/services/marketWatchlist.ts` | 60-61 | `watchlistEntries`, `marketAlerts[]` | Watchlist entries + append-only alerts array |
| `server/services/notificationPreferences.ts` | 194 | `preferencesStore` | User preferences, one entry per user+org pair |
| `server/services/callRouting.ts` | 43-45 | `agentRegistry`, `callQueue[]`, `activeCalls` | Call routing state |

These Maps are labeled "in-memory store (replace with DB table in production)" in some files, but they are live in the deployed code. Each stores objects that accumulate over the process lifetime. On a long-running server, these collectively can reach tens of MB.

### H3. `compsCache` Map has no max-size cap

`server/services/comps.ts`, line 156

```typescript
const compsCache = new Map<string, { data: CompsSearchResult; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60;
```

Entries have a 1-hour TTL checked on read, but expired entries are never proactively evicted. If the cache receives queries for many unique property locations, entries accumulate and are only cleaned when re-queried after expiry. There is no max-size cap and no periodic cleanup interval.

**Impact:** With unique comp searches across different counties, this Map grows without bound.

### H4. `reportCache` Map has no max-size cap

`server/services/reportingEnhancements.ts`, line 77

```typescript
const reportCache = new Map<string, { data: any; expiry: number }>();
```

Same pattern as H3 -- TTL-on-read but no proactive eviction and no size limit. Report data can be large (full financial report payloads).

### H5. `usdaNassService` memCache has no max-size cap

`server/services/usdaNassService.ts`, line 424

```typescript
const memCache = new Map<string, { data: any; expiresAt: number }>();
```

24-hour TTL on read, no proactive eviction, no size cap. Each county snapshot can be a significant object.

### H6. `aiContextAggregator` contextCache stores full system context per org

`server/services/aiContextAggregator.ts`, line 39

```typescript
const contextCache = new Map<number, { context: SystemContext; fetchedAt: number }>();
```

`buildSystemContext` at line 56 does `Promise.all` on `getLeads`, `getProperties`, `getDeals`, etc. -- potentially fetching thousands of records per org. This entire result set is cached in memory. With multiple organizations, the cache holds full lead/deal/property arrays for each one.

### H7. `AI_CACHE` stores response content and token sets without periodic cleanup

`server/services/aiRouter.ts`, lines 23-25

```typescript
const AI_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_SIZE = 500;
```

While `MAX_CACHE_SIZE` of 500 exists, there is no code that enforces it. The cache is checked on read for TTL but entries are never proactively evicted when the size exceeds 500. Additionally, each entry includes a `queryTokens` Set for semantic dedup, which adds memory overhead.

### H8. `gisValidation` jobs Map never prunes completed jobs

`server/services/gisValidation.ts`, line 19

```typescript
const validationJobs = new Map<string, ValidationJob>();
```

Jobs are created with `validationJobs.set(jobId, ...)` but never deleted after completion. The `getAllValidationJobs()` function slices to 10 entries for display, but the Map itself grows forever.

### H9. `previewRateLimits` Map in routes-due-diligence.ts has no cleanup

`server/routes-due-diligence.ts`, line 214

```typescript
const previewRateLimits = new Map<string, { count: number; date: string }>();
```

Entries are keyed by IP or email. Old entries from previous days are never pruned. Under bot traffic, this Map grows linearly with unique IPs.

### H10. `scpOutboundExecution` rollbackRegistry never removes entries

`server/services/scpOutboundExecution.ts`, line 117

```typescript
const rollbackRegistry = new Map<string, () => Promise<void>>();
```

Rollback functions are registered per execution but never removed after use or expiry. Each entry holds a closure that captures the execution context, preventing garbage collection of those objects.

### H11. Module-level `listeners` Map in `use-realtime.ts` never prunes empty Sets

`client/src/hooks/use-realtime.ts`, line 32

```typescript
const listeners = new Map<string, Set<EventHandler>>();
```

When handlers are removed via the cleanup function (lines 142-144), the `delete` call removes the handler from the Set. But if a Set becomes empty, it remains as an empty Set in the Map. With many event types subscribed/unsubscribed over the app lifetime, the Map accumulates empty Sets.

---

## Medium Severity Findings

### M1. `domainCache` and `localCache` in white-label/custom-domain middleware

- `server/middleware/white-label-domain.ts`, line 27: `domainCache` -- no size cap, no periodic cleanup. Only expires on re-read.
- `server/middleware/customDomainRouter.ts`, line 62: `localCache` -- has a cap of 1000 entries (good) but only evicts 1 entry at a time when exceeding the cap, which is an O(1) eviction but could be better.

### M2. `mcp-server.ts` rateLimitMap has no cleanup

`server/mcp-server.ts`, line 27

```typescript
const rateLimitMap = new Map<number, RateLimitBucket>();
```

Entries expire naturally (window resets) but old entries from inactive orgs are never pruned. Bounded by the number of orgs that have ever made an MCP request.

### M3. `refreshTimestamps` Map in routes-deal-feed.ts

`server/routes-deal-feed.ts`, line 21

```typescript
const refreshTimestamps = new Map<number, number>();
```

One entry per org, never cleaned. Bounded by org count but still never pruned.

### M4. `voiceProfileTrigger` newSampleCounts Map

`server/services/voiceProfileTrigger.ts`, line 16

```typescript
const newSampleCounts = new Map<number, { count: number; lastRebuilt: number }>();
```

One entry per org, never cleaned. Similar to M3 -- bounded by org count.

### M5. `contentEvolution` revertTracker grows with unique domains

`server/services/contentEvolution.ts`, line 134

```typescript
const revertTracker = new Map<string, RevertEntry>();
```

Entries are pruned within the window per key (line 148), but keys themselves are never removed from the Map even after the `paused` flag is set.

### M6. `dataQualityMonitor` healthHistory capped per key but Map grows with data sources

`server/services/dataQualityMonitor.ts`, line 153

```typescript
const healthHistory: Map<string, SourceHealthRecord[]> = new Map();
```

Individual arrays are capped at 100 entries (line 171: `if (history.length > 100) history.shift()`), which is good. But the Map key space grows with data source names.

### M7. `scpIntegrationFabric` rateLimitCounters not cleaned

`server/services/scpIntegrationFabric.ts`, line 476

```typescript
const rateLimitCounters = new Map<string, { count: number; window_start: number }>();
```

Entries for expired windows remain in memory. No periodic cleanup.

---

## Low Severity Findings

### L1. SSE `obsClients` Map in routes-ai.ts -- properly managed

`server/routes-ai.ts`, lines 1766-1787

The SSE client tracking uses `obsClients` (a `Map<number, Set<Response>>`) with proper cleanup on `req.on("close")` and a cap of 10 clients per org. This is well-implemented.

### L2. WebSocket clients Map -- properly managed

`server/websocket.ts`, lines 106, 183-189

The WebSocket server properly removes clients on `close` and `error` events, and has a connection cap (`MAX_WS_CONNECTIONS`). Well-implemented.

### L3. `idempotency.ts` memStore cleanup runs but creates new Redis connections

`server/middleware/idempotency.ts`, lines 47-59

The `getRedis()` function creates a **new IORedis instance** on every call. This is the idempotency cache lookup path, meaning each request may create a new Redis connection. These connections may not be properly closed, leaking file descriptors.

### L4. Rate limit stores have proper cleanup intervals

`server/middleware/rateLimit.ts` (lines 36-43 and 93-119) and `server/middleware/rateLimiting.ts` (lines 57-69) both have periodic cleanup intervals that prune expired entries. These are well-implemented, though the intervals themselves are not tracked for shutdown (see H1).

### L5. `realtimeAlerts` notification queue is properly bounded

`server/services/realtimeAlerts.ts`, line 138

```typescript
notificationQueues.set(alert.organizationId, queue.slice(0, 100));
```

The queue is capped at 100 entries per org. Good practice.

---

## Recommendations (Priority Order)

1. **Immediately cap all append-only arrays** (C1). Add `if (arr.length > MAX) arr.splice(0, arr.length - MAX)` with a reasonable MAX (e.g., 1000). Better yet, persist to DB and read from there.

2. **Fix metrics label cardinality** (C2, C3). Normalize `route` labels to parameterized patterns. Add a max-key cap to the `MetricsCollector` and `errorCounters`.

3. **Eliminate duplicate WebSocket in `useKpiStream`** (C4). Refactor to subscribe through `useRealtime()`.

4. **Route all `setInterval` calls through `trackInterval()`** (H1). This requires moving the cleanup intervals from module-scope to a function called during server bootstrap.

5. **Add max-size caps and periodic eviction to all cache Maps** (H3-H9). A simple pattern:
   ```typescript
   const MAX_CACHE = 500;
   if (cache.size > MAX_CACHE) {
     const oldest = cache.keys().next().value;
     cache.delete(oldest);
   }
   ```

6. **Replace in-memory-only stores with DB-backed caches** (H2). The SCP subsystems, certification, and watchlist stores all have comments like "replace with DB table in production" -- this needs to happen before scaling.

7. **Fix `aiRouter.ts` MAX_CACHE_SIZE enforcement** (H7). The constant is defined but never checked during insertion.

8. **Fix `idempotency.ts` Redis connection leak** (L3). Cache the Redis client instance rather than creating a new one per call (the `_redis` variable exists but `getRedis()` always creates a new instance).

---

## Memory Budget Estimate (Worst Case, 30-Day Uptime)

| Category | Estimated Growth | Notes |
|----------|-----------------|-------|
| SCP execution/outcome logs (C1) | 50-200 MB | ~10K operations/day x 30 days |
| Metrics histogram keys (C2) | 50-100 MB | 926 endpoints x dynamic IDs |
| Unbounded cache Maps (H3-H9) | 20-80 MB | Depends on query diversity |
| In-memory data stores (H2) | 10-50 MB | Depends on org count and activity |
| Rate limit / dedup stores | 5-10 MB | Properly cleaned, low risk |
| **Total estimated leak** | **135-440 MB** | Out of 4 GB available |

On a 4 GB machine with Node.js default heap (~1.7 GB), these leaks could trigger OOM within 2-4 weeks of continuous uptime without restarts.
