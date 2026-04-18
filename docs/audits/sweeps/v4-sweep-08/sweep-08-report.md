# Convergence Sweep 8 Report

**Date:** 2026-04-18
**Scope:** Rate limiting, WebSocket security, error response format, graceful shutdown, provider cache, font loader
**Auditor:** Claude Opus 4.6 (1M context)
**Verdict:** 1 new P1, 2 new P2s found

---

## 1. Rate Limiting

**Files reviewed:** `server/index.ts` lines 267-327

**Findings: PASS**

Five distinct rate-limit tiers are correctly defined and applied to route prefixes:

| Tier | Window | Max | Applied to |
|------|--------|-----|------------|
| Auth | 15 min | 20 | `/api/auth`, `/api/login`, `/api/register` |
| AI | 1 min | 60 | `/api/ai`, `/api/pax`, `/api/chat`, `/api/executive`, `/api/document-generation` |
| Webhook | 1 min | 200 | `/api/webhooks` |
| Import | 15 min | 10 | `/api/import`, `/api/leads/import`, `/api/properties/import` |
| General API | 1 min | 300 | `/api` (catch-all, keyed by session user ID) |

All limiters use `standardHeaders: true`, `legacyHeaders: false`. The general API limiter uses a `keyGenerator` that keys by authenticated userId (falling back to IP), preventing a single power-user behind shared NAT from exhausting the per-IP bucket. `trust proxy` is set to 1 for Fly.io.

No issues found.

---

## 2. WebSocket Security

**File reviewed:** `server/websocket.ts` (full file, 357 lines)

**Findings: 1 P1, 1 P2**

### PASS: Session-based auth on connection

`validateWsSession()` verifies the `connect.sid` cookie against the `session` table, checks expiration, and confirms `passport.user` matches the claimed `userId`. Connections are rejected with code 4003 if invalid. Connection cap (`MAX_WS_CONNECTIONS`, default 1000) prevents resource exhaustion.

### PASS: Org-scoped channel subscriptions (DEFECT-0022 fix confirmed)

`isAllowedChannel()` enforces that entity channels (`deal:`, `listing:`, `negotiation:`) require the client's own `organizationId` as a prefix. Market channels are public. This correctly prevents cross-org data leakage on the subscription side.

### P1-NEW-01: Negotiation/listing broadcast channel mismatch (functional breakage)

The broadcast helpers use **un-scoped** channel names, but `isAllowedChannel` requires **org-scoped** channel names. This means broadcasts are silently dropped because no client can subscribe to the channel the server broadcasts on:

- `broadcastNegotiationUpdate(sessionId)` broadcasts on `negotiation:${sessionId}` (e.g., `negotiation:42`)
- But `isAllowedChannel` only allows `negotiation:${orgId}:...` (e.g., `negotiation:7:42`)
- Same mismatch for `broadcastListingEvent(listingId)` -- broadcasts on `listing:${listingId}` but subscriptions require `listing:${orgId}:...`

**Impact:** Real-time negotiation coaching updates and marketplace listing events (new bids, accepted offers) are silently dead. No client will ever receive these events.

**Fix:** Either (a) change the broadcast helpers to include `organizationId` in the channel name, or (b) change `isAllowedChannel` to accept bare entity IDs. Option (a) is safer since it preserves org isolation.

### P2-NEW-01: `founder:activity` channel has no founder check

`isAllowedChannel` returns `true` for `channel === 'founder:activity'` for **any** authenticated user, not just founders. Any org user can subscribe to the `founder:activity` channel and receive agent events, briefing readiness notifications, and event mesh activity that should be founder-only.

**Impact:** Information disclosure of founder-level operational data to non-founder users.

**Fix:** Add `client.isFounder` check (or equivalent org-role check) to the `founder:activity` guard in `isAllowedChannel`.

---

## 3. Error Response Format

**Files spot-checked:**
- `server/routes-dunning.ts` -- uses `Errors.*` helpers throughout (9 usages). **PASS.**
- `server/routes-deal-hunter.ts` -- uses raw `res.status(N).json({ error: ... })` in all 9 error paths. Zero `Errors.*` usage. **FAIL.**
- `server/routes-marketplace.ts` -- uses raw `res.status(N).json({ error: ... })` in all 30 error paths. Zero `Errors.*` usage. **FAIL.**

### Aggregate analysis

Across all route files:
- **1,123** usages of `Errors.*` helpers (31 files)
- **855** usages of raw `res.status().json()` (50 files)

This means roughly **43% of error responses bypass the standardized format**. Raw responses return `{ error: "..." }` instead of the contract `{ error, message, details?, statusCode }`. This is inconsistent but not a security issue since error messages are still present. Classified as **existing P2** (code quality / API consistency) -- not a regression.

---

## 4. Graceful Shutdown

**File reviewed:** `server/index.ts` lines 748-784

**Findings: 1 P2**

### PASS: Core shutdown sequence

The `gracefulShutdown` handler:
1. Clears all tracked background intervals via `__bgIntervals`
2. Calls `httpServer.close()` to stop accepting new connections
3. Drains both `pool` and `replicaPool` database connections via `Promise.allSettled`
4. Waits 5 seconds for in-flight work to complete
5. Force-exits after 30 seconds with `.unref()` to prevent hanging

Uses `process.once()` (not `process.on()`) for SIGTERM/SIGINT to prevent double-shutdown races.

### P2-NEW-02: WebSocket server not shut down during graceful shutdown

`wsServer.shutdown()` is never called in the `gracefulShutdown` handler. The `AcreOSWebSocketServer.shutdown()` method exists and correctly:
- Clears the ping interval
- Closes all client connections
- Clears the client map
- Closes the WSS server

But it is never invoked. When the HTTP server closes, WebSocket connections will be force-terminated without clean close frames, and the 30-second ping interval timer will leak (it is not tracked via `trackInterval`).

### Observation: Bare `setInterval` usage across services

The comment at line 99-101 states: "All setInterval calls for background jobs MUST use trackInterval()." However, at least 20 bare `setInterval` calls exist across:
- `server/routes.ts` (2 cleanup intervals)
- `server/middleware/idempotency.ts` (1 cleanup interval)
- `server/middleware/rateLimiting.ts` (1 cleanup interval)
- `server/middleware/rateLimit.ts` (2 cleanup intervals)
- `server/services/healthCheck.ts`, `server/services/sequenceProcessor.ts`, `server/services/acquisitionRadar.ts`, etc.

These are mostly memory-cleanup timers (not job-critical), so they will not cause functional issues during shutdown. However, they will delay `process.exit` until the 30-second force-exit timeout fires. Classified as a minor observation, not a defect, since the force-exit timeout handles the case.

---

## 5. Provider Cache

**File reviewed:** `server/services/providers/provider-registry.ts` (full file, 413 lines)

**Findings: PASS**

Cache-first lookup is correctly wired in the `lookup()` method (DEFECT-0032 fix verified):

1. `readCache(cacheKey)` is called before the live lookup for each provider candidate
2. Cache hits return immediately with `costCents: 0` (no credit deduction for cached results)
3. Cache misses fall through to the live API call
4. Successful live results are written to cache via fire-and-forget `writeCache()` with a 24-hour TTL
5. Cache read/write failures are non-fatal (caught and logged, execution continues)
6. Cache keys are deterministic via `buildCacheKey()` using provider name, category, and input
7. `writeCache()` uses `onConflictDoUpdate` for upsert semantics

Circuit breaker is correctly implemented: 3 failures in 5 minutes opens the circuit, which auto-closes after the 5-minute window expires (half-open pattern). Candidates are sorted by tier (free first), then cost, then priority.

No issues found.

---

## 6. Font Loader

**File reviewed:** `client/src/lib/font-loader.ts` (full file, 44 lines)

**Findings: PASS**

Non-blocking dynamic font loading is correctly implemented:

1. Fonts are loaded on-demand via `loadGoogleFont()`, not at startup
2. A `Set<string>` tracks already-loaded families to prevent duplicate `<link>` injections
3. The `<link>` element is injected with `media="print"` and switches to `media="all"` on load -- this is the recommended non-render-blocking pattern (equivalent to `rel="preload" as="style"` but with better browser support)
4. `display=swap` is used in the Google Fonts URL to prevent FOIT (Flash of Invisible Text)
5. `preloadWhiteLabelFonts()` accepts an array for batch preloading

No issues found.

---

## Summary of New Findings

| ID | Severity | Area | Description |
|----|----------|------|-------------|
| P1-NEW-01 | P1 | WebSocket | Negotiation/listing broadcast channel names don't match `isAllowedChannel` org-scoped format -- real-time entity updates are silently dead |
| P2-NEW-01 | P2 | WebSocket | `founder:activity` channel allows any authenticated user to subscribe, not just founders |
| P2-NEW-02 | P2 | Shutdown | `wsServer.shutdown()` never called during graceful shutdown; WebSocket ping interval leaks |

### Existing observations (not new defects)

- ~43% of route error responses use raw `res.status().json()` instead of `Errors.*` helpers. This is a long-standing code consistency issue across ~50 route files.
- ~20 bare `setInterval` calls exist outside `trackInterval`, but they are non-critical cleanup timers mitigated by the 30-second force-exit timeout.
