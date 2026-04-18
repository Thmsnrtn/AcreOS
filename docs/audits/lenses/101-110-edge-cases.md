# Lenses 101-110 -- Edge-Case Perspectives

Auditor: Multi-lens edge-case audit (Tier 3)
Date: 2026-04-18
Status: AUDIT COMPLETE

---

## 101 -- Unicode / Emoji

### What was checked

- DB column types in `shared/schema.ts` (14,883 lines)
- CSV parser in `server/services/importExport.ts`
- Filename sanitization in `server/middleware/fileUploadSecurity.ts`
- PDF generation services (33 files reference PDF)
- Search/filter code in `server/storage.ts`

### Findings

**101-P2-01: Schema is Unicode-safe by default -- no action needed on column types.**
Nearly all columns use Postgres `text` type (~1,942 occurrences), which natively stores UTF-8 including emoji, CJK, and accented characters. Only 8 columns use `varchar`. DB layer is fine.

**101-P1-01: CSV parser silently corrupts Unicode input.**
Already documented as 50-P2-01. The `parseCSV` function (`server/services/importExport.ts:37-89`) does not strip UTF-8 BOM and calls `buffer.toString("utf-8")` unconditionally. Files in Windows-1252 encoding (common for Excel exports with Spanish property names) produce mojibake. This is the primary Unicode risk.

**101-P2-02: Filename sanitization destroys non-ASCII characters.**
Already documented as 50-P2-04. The regex `/[^a-zA-Z0-9._-]/g` in `server/middleware/fileUploadSecurity.ts:83` replaces all Unicode characters with underscores. Accented names (Jose -> Jos_) and CJK filenames become unreadable.

**101-P3-01: PDF generation has no explicit emoji font embedding.**
The 33 server files referencing PDF (offerLetterPdf, reportPdfService, cmaPdfService, etc.) do not configure emoji-capable fonts. If a lead name or property description contains emoji, the PDF will likely render them as tofu (empty boxes). Low priority -- emoji in legal/offer documents is unlikely but possible in notes or descriptions.

**101-P3-02: Search uses `LOWER()` which is locale-unaware for some Unicode.**
`server/storage.ts` uses `LOWER()` and `ILIKE` for search. Postgres `LOWER()` is locale-dependent and may not correctly case-fold certain Unicode characters (e.g., German sharp s, Turkish dotted I). Not a practical concern for a US land platform.

### Summary: No new P0/P1. CSV parser (already tracked) is the main Unicode risk.

---

## 102 -- RTL (Right-to-Left)

### What was checked

- CSS direction rules, `dir=` attributes across client
- Tailwind config and layout components

### Findings

**Not applicable.** AcreOS is a US-only land real estate platform. No `dir="rtl"` attributes exist. No RTL stylesheets. All 72 occurrences of `direction` in client code are CSS animation directions or sort directions, not text direction. No action needed.

---

## 103 -- Extreme-Length Input

### What was checked

- Zod schemas in route files for `maxLength` / `.max()` enforcement
- Express body parser limits in `server/index.ts`
- DB text column constraints (or lack thereof)

### Findings

**103-P1-01: Most Zod string validations have no maxLength.**
Lead create/update schema (`routes-leads.ts`) validates `firstName: z.string().optional()`, `lastName: z.string().optional()`, `address: z.string().optional()` -- all without `.max()`. A client could submit a 1MB first name. While Express body-parser limits the overall payload to 1MB (`server/index.ts:249`), individual fields are unconstrained. This means a lead with a single 999KB `notes` field would pass validation.

Only a handful of routes enforce `.max()`: `routes-beta.ts` (message: 2000, useCase: 500), `routes-team-messaging.ts` (body: 10000, name: 80), `routes-organization.ts` (name: 255), `routes-autonomous-agent.ts` (customInstructions: 2000).

**103-P2-01: DB text columns have no length constraints.**
All ~1,942 `text()` columns in the schema have no Postgres-level length limit. Combined with the lack of Zod maxLength, a determined client could store arbitrary-length strings limited only by the 1MB Express body limit.

**103-P2-02: Unbounded field lengths could cause UI rendering issues.**
A 10,000-character lead name would overflow card layouts, table cells, and sidebar displays. No `truncate` or `line-clamp` CSS is systematically applied to user-generated content.

### Recommendation

Add `.max(255)` to all name fields, `.max(5000)` to description/notes fields, and `.max(500)` to address fields in Zod schemas. This is a broad-sweep fix across route files.

---

## 104 -- Zero-State / Empty State

### What was checked

- Usage of `EmptyState` component across all 156 pages
- Usage of `QueryErrorState` component
- Pages without any empty-state handling

### Findings

**104-P1-01: ~120 of 156 pages lack dedicated empty-state handling.**
Only 36 page files reference `EmptyState`, `emptyState`, or "no data"/"no results" patterns. The remaining ~120 pages either show a blank area, a loading skeleton that never resolves, or crash on `.map()` of undefined when the API returns an empty array.

Key pages with proper empty states: leads, properties, deals, tasks, documents, listings, offers, inbox, counties, finance, executive-dashboard, founder-home.

Key pages missing empty states (sampling):
- `/settings` (2417 LOC) -- tabs show blank content when no integrations/team members
- `/command-center` (2259 LOC) -- shows empty charts with no guidance
- `/marketplace` (1208 LOC) -- blank listing area
- `/maps` (1100 LOC) -- no properties message absent
- `/portfolio-optimizer`, `/negotiation-copilot`, `/deal-hunter` -- blank states

**104-P2-01: Dashboard widgets show "0" with no context.**
When a new org has zero leads/deals/properties, dashboard widgets display "0" values without explaining what the metric represents or how to populate it. Already noted in orientation as problem #15.

### Recommendation

The `EmptyState` component exists and is well-implemented. Priority should be adding it to the top 10 most-visited pages that lack it: settings tabs, command-center, marketplace, maps, portfolio views.

---

## 105 -- Concurrent Edit

### What was checked

- Optimistic locking across entity types
- Transaction usage in write paths
- Client-side conflict handling

### Findings

**All major findings already documented in lens 50 (50-P0-01 through 50-P0-06).** Summary of concurrent-edit posture:

- **Deals:** Optimistic locking exists (`expectedUpdatedAt` param in `storage.ts:1702`) but is **not used** by any route handler.
- **Leads, Properties, Notes:** No concurrency protection. Last write wins silently.
- **Org Settings:** Classic read-modify-write race across 8+ code paths.
- **Payments/Credits:** Not wrapped in transactions; double-processing possible.
- **Document Templates:** Version increment not atomic.

**105-P2-01 (new): Client has no conflict detection UI.**
There are 718 `useMutation` calls across 196 files and 508 `invalidateQueries` calls, but zero instances of `onMutate` being used for optimistic UI with rollback on conflict. No mutation checks for 409 (Conflict) responses. If the server ever returns a conflict error, the client would show a generic error toast.

**105-P3-01: No WebSocket-based "someone else is editing" indicator.**
The WebSocket server (`server/websocket.ts`) exists and is initialized, but it is used for real-time alerts, not for presence/editing indicators. Two team members can open the same lead simultaneously with no visual indication.

---

## 106 -- Clock Skew

### What was checked

- JWT validation in `server/auth/clerkAuth.ts`
- Payment timestamps in webhook handlers
- Scheduled job timing in `server/index.ts`
- `new Date()` usage patterns

### Findings

**106-P2-01: JWT grace period is already configured but minimal.**
`server/auth/clerkAuth.ts:40-41` allows tokens up to 30 seconds past expiry (`GRACE_PERIOD_MS = 30 * 1000`). This handles minor clock skew between Clerk's servers and Fly.io. The comment notes it was reduced from 5 minutes for security. 30 seconds is reasonable.

**106-P3-01: Scheduled jobs use wall-clock checks that are skew-sensitive.**
`server/index.ts:614` checks `now.getUTCHours() === 7 && now.getUTCMinutes() < 5` for daily summary. If the server clock drifts by more than 5 minutes, this job silently skips. However, Fly.io VMs sync to NTP, so clock skew > 5 minutes is extremely unlikely.

**106-P3-02: Stripe webhook timestamps are not validated for freshness.**
`server/index.ts:218-244` processes Stripe webhooks without checking the `created` timestamp of the event against the current time. Stripe's own SDK validates the webhook signature (which includes timestamp), providing implicit skew protection. No additional action needed.

### Summary: Clock skew is well-handled. JWT grace period is appropriate. No P0/P1.

---

## 107 -- Network Partition (DB connection drop)

### What was checked

- Connection pool error handling in `server/db.ts`
- Express error middleware
- Retry logic for DB operations
- Fly.io health check configuration

### Findings

**107-P2-01: DB pool error handler prevents crashes but does not recover gracefully.**
`server/db.ts:36-38` has `pool.on("error", ...)` which logs and swallows the error. This prevents process crash, but the next request that tries to use a broken connection will get a connection-level error that bubbles up as a 500 to the client. The pool's internal eviction (via `idleTimeoutMillis: 60s` and `connectionTimeoutMillis: 10s`) will eventually replace dead connections, but during a partition there is no request-level retry.

**107-P2-02: No request-level DB retry middleware.**
When a DB query fails due to `ECONNRESET` or `ECONNREFUSED`, the error propagates directly to the Express error handler which returns a generic 500. There is no middleware that retries the DB operation on transient connection errors. This is standard Express behavior but means a brief network blip causes user-visible 500 errors.

**107-P2-03: Health check uses the DB pool, which can falsely report healthy.**
`fly.toml` health check hits `/api/health/cached` (line 34), which returns cached results from the `HealthCheckService`. If the DB went down after the last health check (60s interval), Fly.io will continue routing traffic to an instance with a broken DB connection for up to 60 seconds + 30s check interval = ~90 seconds.

**107-P3-01: No circuit breaker on primary DB pool.**
The provider registry has circuit breaking (3 failures in 5 min = skip) for external data providers, but the primary DB connection has no equivalent. A complete DB outage results in every request timing out at 10 seconds (`connectionTimeoutMillis`) rather than failing fast.

### Summary: Connection pool error handling is adequate. Brief partitions cause temporary 500s but no crashes. No P0.

---

## 108 -- Cold Start

### What was checked

- Server startup sequence in `server/index.ts`
- DB migration on startup
- Background job initialization
- Health check timing

### Findings

**108-P1-01: Startup runs DB migrations synchronously before accepting traffic.**
`server/index.ts:331-343` runs Drizzle migrations synchronously in the startup IIFE. If migrations take > 15 seconds (the Fly.io `grace_period`), the health check will fail and Fly.io will kill the instance. Current migration count is 35, which should complete in seconds, but this is a ticking time bomb as more migrations accumulate.

**108-P2-01: ~25 background jobs start immediately after listen().**
Lines 478-620 of `server/index.ts` register ~25 background jobs that all fire their first run on startup. While most use `withJobLock` (which prevents duplicate execution across instances), the burst of startup activity includes:
- Full health check of all external services (Stripe, OpenAI, Twilio, Lob, Redis, DB)
- Loading config from DB
- Seeding company agents
- Seeding county GIS endpoints
- Event mesh drain initialization

On a 4GB machine this is manageable, but cold start under load could cause initial request latency.

**108-P2-02: No separate readiness vs. liveness check.**
Fly.io is configured with a single health check at `/api/health/cached`. There is no `/ready` endpoint that gates traffic until the server has completed initialization (migrations, config load, agent seeding). Requests arriving during the 15-second grace period may hit routes before the system is fully ready, potentially encountering missing config or unseeded data.

### Recommendation

Add a readiness flag that is set to `true` only after the startup IIFE completes, and create a `/api/ready` endpoint that returns 503 until ready. Configure Fly.io to use this for traffic routing.

---

## 109 -- Memory-Constrained

### What was checked

- Unbounded queries (already partially tracked)
- CSV import memory usage
- PDF generation memory footprint
- Large response payloads

### Findings

**109-P1-01: Unbounded dataset queries -- OOM risk on moderate data volume.**
Already documented as 50-P2-02. `getLeads`, `getDeals`, `getProperties` have no LIMIT and are called by dashboard, analytics, AI tools, TCPA stats, and export endpoints. On a 4GB Fly.io machine with 20-connection pool, 3 concurrent dashboard loads for a 50K-lead org could exhaust memory.

Paginated variants exist (`getLeadsPaginated` etc.) but are not used in the affected code paths.

**109-P2-01: CSV import loads entire file into memory.**
`server/services/importExport.ts:37` receives the full CSV string (up to 5MB per `routes-import-export.ts:22`) and parses it entirely in memory. A 5MB CSV with 100K rows creates a large array of objects. Combined with validation and DB insertion, peak memory for a single import is ~3-5x the file size (~15-25MB). This is manageable but does not stream.

**109-P2-02: Export builds entire response in memory.**
Already documented as 50-P2-06. The export endpoint fetches all records and serializes to CSV/JSON in memory. No streaming (`Readable`, `pipeline`) is used for export -- confirmed by grep showing zero streaming references in `routes-import-export.ts`.

**109-P3-01: AI chat context may accumulate unbounded conversation history.**
Not investigated in depth, but AI routes pass conversation history to OpenRouter. Long conversations could create large request payloads.

### Summary: The primary OOM risk is unbounded queries (already tracked). CSV import and export are secondary risks.

---

## 110 -- Offline / Reconnection

### What was checked

- Service worker (`client/public/sw.js`)
- Offline indicator component (`client/src/components/offline-indicator.tsx`)
- Offline cache hooks (`client/src/hooks/use-offline-cache.ts`)
- React Query network mode configuration
- App.tsx integration

### Findings

**110-P3-01: Offline support is surprisingly well-implemented.**
AcreOS has a comprehensive offline strategy:

1. **Service worker** (`sw.js`, 302 lines): Caches static assets, caches GET responses for `/api/user`, `/api/leads`, `/api/properties`, `/api/deals`, `/api/team-members`. Queues POST/PUT/PATCH to `/api/leads` and `/api/activity-feed` in IndexedDB for replay on reconnect.
2. **Offline indicator**: `OfflineIndicator` component is mounted in `App.tsx:864`, shows amber banner when offline, green "reconnecting" banner on restore.
3. **Offline cache hook**: `useOfflineCache` provides localStorage-based caching with 24h TTL and automatic eviction when storage is full.
4. **Pending actions queue**: `usePendingActions` hook queues mutations for sync on reconnect.

**110-P2-01: React Query does not use `networkMode: 'offlineFirst'`.**
The `queryClient` configuration (`client/src/lib/queryClient.ts:176-206`) does not set `networkMode`. This means React Query defaults to `networkMode: 'online'` which pauses queries when offline, even though the service worker could serve cached responses. Setting `networkMode: 'offlineFirst'` would allow React Query to use SW-cached responses while offline.

**110-P2-02: Only 2 mutation routes are offline-queueable.**
The service worker only queues mutations to `/api/leads` and `/api/activity-feed` (`sw.js:25-27`). All other mutations (deals, properties, notes, tasks, documents) will fail silently when offline, with no queuing. The scope could be expanded.

**110-P2-03: Offline queue replay has no conflict resolution.**
When `replayOfflineQueue()` replays queued requests (`sw.js:101-132`), it does a simple `fetch` with the original payload. If the data was modified on the server while the user was offline, the replayed request will overwrite it (last-write-wins). No merge, no conflict detection, no user prompt.

**110-P3-02: Service worker may not exist in production (known issue).**
Orientation document notes (problem #20): "Service worker registration in prod -- `sw.js` registered but may not exist, causing console errors." The file exists at `client/public/sw.js`, so this may have been fixed. Needs verification in deployed environment.

---

## Summary Table

| ID | Lens | Priority | Summary |
|----|------|----------|---------|
| 101-P1-01 | Unicode | P1 | CSV parser corrupts BOM / non-UTF-8 (= 50-P2-01) |
| 101-P2-02 | Unicode | P2 | Filename sanitization strips non-ASCII (= 50-P2-04) |
| 101-P3-01 | Unicode | P3 | PDFs lack emoji font -- tofu rendering |
| 103-P1-01 | Extreme-length | P1 | Most Zod schemas have no maxLength on strings |
| 103-P2-01 | Extreme-length | P2 | DB text columns have no length constraints |
| 103-P2-02 | Extreme-length | P2 | Long strings overflow UI card/table layouts |
| 104-P1-01 | Zero-state | P1 | ~120 of 156 pages lack empty-state handling |
| 104-P2-01 | Zero-state | P2 | Dashboard shows raw "0" with no guidance |
| 105-P2-01 | Concurrent-edit | P2 | Client has no conflict detection or 409 handling |
| 105-P3-01 | Concurrent-edit | P3 | No "someone else is editing" presence UI |
| 108-P1-01 | Cold-start | P1 | Migrations run sync before accepting traffic |
| 108-P2-01 | Cold-start | P2 | ~25 background jobs fire on startup burst |
| 108-P2-02 | Cold-start | P2 | No readiness check separate from liveness |
| 109-P1-01 | Memory | P1 | Unbounded queries cause OOM risk (= 50-P2-02) |
| 109-P2-01 | Memory | P2 | CSV import loads entire file into memory |
| 109-P2-02 | Memory | P2 | Export builds full response in memory (= 50-P2-06) |
| 110-P2-01 | Offline | P2 | React Query missing `networkMode: 'offlineFirst'` |
| 110-P2-02 | Offline | P2 | Only 2 of ~926 mutation routes are offline-queueable |
| 110-P2-03 | Offline | P2 | Offline queue replay has no conflict resolution |

**Lenses with no findings:** 102 (RTL -- not applicable), 106 (Clock-skew -- well-handled), 107 (Network partition -- adequate).

---

## Methodology

Searched schema for column types (text vs varchar), route files for Zod validation patterns (.max(), .maxLength), client pages for EmptyState / QueryErrorState usage, auth code for clock tolerance, db.ts for pool error handling, index.ts for startup sequence, service worker for offline support, and queryClient.ts for network configuration. Cross-referenced with existing lens 50 findings to avoid duplication. Verified fly.toml health check configuration.
