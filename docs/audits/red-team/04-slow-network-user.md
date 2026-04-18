# Red Team Audit 04 -- Slow Network User

**Persona**: Rural real estate professional on unreliable 3G/Edge connectivity (200-400 Kbps, 500ms+ RTT, frequent drops)
**Auditor**: Performance & Resilience Review
**Date**: 2026-04-18
**Codebase SHA**: `27a7ea0`

---

## Executive Summary

AcreOS has strong architectural foundations for poor-connectivity scenarios -- service worker with offline queue, IndexedDB-backed data caching, connection-state UI indicators, and proper code splitting across 100+ route chunks. However, the **critical-path bundle weight is a concern** for 3G users: approximately 470 KB gzipped must download before any meaningful paint, and the primary "Today" page fires 13 parallel API queries on mount. Image handling lacks lazy-loading and responsive-image discipline. Overall verdict: **usable on slow networks with caveats**, but several targeted fixes would dramatically improve the experience.

| Area | Verdict |
|------|---------|
| 1. Bundle Size | CONCERN |
| 2. Initial Load | CONCERN |
| 3. API Resilience | PASS |
| 4. Offline Support | PASS |
| 5. Image Optimization | FAIL |
| 6. Caching Strategy | PASS |
| 7. Request Waterfall | CONCERN |
| 8. Progressive Rendering | PASS |
| 9. Data Efficiency | CONCERN |
| 10. Connection Awareness | PASS |

**PASS**: 5 | **CONCERN**: 4 | **FAIL**: 1

---

## 1. Bundle Size

**Verdict: CONCERN**

The Vite build uses manual chunk splitting (`vite.config.ts:26-44`) to separate vendor libraries:

| Chunk | Raw | Gzipped |
|-------|-----|---------|
| `index.js` (app shell + eagerly-imported components) | 716 KB | 212 KB |
| `vendor-react.js` (React, React DOM, wouter, TanStack Query) | 49 KB | 16 KB |
| `vendor-ui.js` (12 Radix primitives) | 288 KB | 89 KB |
| `vendor-charts.js` (Recharts) | 424 KB | 121 KB |
| `index.css` | 224 KB | 33 KB |
| **Critical-path total** | **~1,701 KB** | **~471 KB** |

The `chunkSizeWarningLimit` is set to 500 KB (`vite.config.ts:21`). The `index.js` entry chunk (716 KB) and `vendor-charts.js` (424 KB) are both near or above this threshold.

**Key finding**: `vendor-charts.js` (Recharts, 121 KB gzipped) is eagerly loaded into the critical path because `stat-card.tsx` does `import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts"` (line 4), and `StatCard` is imported directly by `today.tsx` (line 3). This means every page load -- including auth -- pays for the full Recharts library.

At 200 Kbps (25 KB/s), downloading 471 KB takes approximately **19 seconds** before any JS can execute. With Brotli (server supports it via `server/middleware/compression.ts`), this drops to roughly 350-400 KB, but that is still a 14-16 second wait.

**Positives**:
- 100+ lazy-loaded route chunks via `React.lazy()` (`App.tsx:53-218`), so page-specific code loads on demand.
- `vendor-map` (Mapbox GL, 1.6 MB raw) is correctly excluded from the critical path and only loaded when the map component is used.
- Build uses content-hash filenames for long-term caching.

**Recommendations**:
- Move `recharts` imports behind a `React.lazy()` boundary -- either lazy-load `StatCard` or use a lightweight sparkline alternative for the always-visible stat cards.
- Consider splitting `index.js` (716 KB) further: the Clerk SDK, Framer Motion, and the 30+ eagerly-imported shell components (`App.tsx:19-44`) all contribute to this monolith.

---

## 2. Initial Load

**Verdict: CONCERN**

The HTML shell (`client/index.html`) is lean: no render-blocking stylesheets or font loads. The DEFECT-0033 fix is confirmed -- Google Fonts are loaded dynamically via `client/src/lib/font-loader.ts` using the `media="print"` swap trick (line 29), and the HTML only has `<link rel="preconnect">` tags for fonts.googleapis.com (lines 27-28).

Critical rendering path:
1. HTML shell (~2 KB) with inline dark-mode FOUC prevention script
2. `index.css` (33 KB gzipped) -- single CSS file, loads in parallel with JS
3. `index.js` (212 KB gzipped) -- triggers waterfall loading of `vendor-react`, `vendor-ui`, `vendor-charts`
4. Clerk SDK initialization (`main.tsx:25-26`) -- external fetch to `/__clerk` proxy before React can render

**Concerns**:
- The Clerk `ClerkProvider` wraps the entire app (`main.tsx:30-38`) and must authenticate before protected routes render. On a 500ms+ RTT connection, the Clerk handshake adds 1-2 seconds minimum.
- The app shell (`App.tsx`) eagerly imports ~30 components before any route renders: `SidebarProvider`, `KeyboardShortcutsProvider`, `CommandPalette`, `ConversationTray`, `FloatingActionButton`, `FloatingHelpButton`, `BetaFeedbackWidget`, `DynamicIsland`, `TrialBanner`, `NotificationBanner`, `NpsDialog`, and more. Each adds to the entry chunk weight.
- `AnimatePresence` + `motion` from Framer Motion (`App.tsx:15`) is in the critical path for page transitions.

**Positives**:
- Dark mode is applied before React renders (inline script in `index.html:32-39`), preventing FOUC.
- Service worker is registered only in production and after `window.load` (`main.tsx:10-19`), so it does not block rendering.
- Suspense fallback shows a spinner immediately while lazy chunks load (`App.tsx:304-308`).

---

## 3. API Resilience

**Verdict: PASS**

The query client (`client/src/lib/queryClient.ts`) has a well-structured retry and error handling system:

- **Retry logic**: Uses exponential backoff (`retryDelay: Math.min(1000 * 2^attemptIndex, 10000)`, line 197) with a cap at 10 seconds. Max 3 retries for network/timeout/500 errors only (via `shouldRetry` in `error-utils.ts:57-67`). Auth errors (401/403) are never retried (lines 192-194).
- **Error classification**: The `error-utils.ts` module categorizes errors into network, timeout, auth, permission, rate-limit, and server types -- each with user-friendly messages (lines 1-27).
- **Toast notifications**: Both query and mutation errors show descriptive toasts with "Copy details" actions (`queryClient.ts:59-87, 89-122`).
- **Rate limit handling**: 429 responses show an "Upgrade" CTA with a direct link to billing (`queryClient.ts:30-51`).
- **Stale-while-revalidate**: Default `staleTime` of 2 minutes and `gcTime` of 5 minutes (`STALE_TIMES.medium`, `CACHE_TIMES.medium`, lines 169-174) means cached data is shown immediately while refetching in the background.
- **No refetch on window focus**: `refetchOnWindowFocus: false` (line 188) prevents unnecessary requests when a user switches tabs on a slow connection.
- **Mutation retries**: Mutations also retry with the same backoff strategy (lines 199-209), which is appropriate for idempotent operations.

**One gap**: The `apiRequest` function (`queryClient.ts:124-142`) uses bare `fetch()` with no request timeout (`AbortController`/`signal`). On a very slow connection, a request could hang indefinitely without timing out. This is mitigated by the retry logic but not eliminated.

**QueryErrorState component** (`components/query-error-state.tsx`) provides contextual error UI with distinct states for network, server, auth, not-found, and generic errors -- each with appropriate icon, color, and retry button.

---

## 4. Offline Support

**Verdict: PASS**

AcreOS has a comprehensive multi-layer offline strategy:

**Service Worker** (`client/public/sw.js`):
- Caches static assets on install (lines 9-13, 134-141).
- Implements network-first with cache fallback for API routes `/api/user`, `/api/leads`, `/api/properties`, `/api/deals`, `/api/team-members` (lines 15-21, 195-213).
- Queues offline POST/PUT/PATCH mutations to IndexedDB for `/api/leads` and `/api/activity-feed` (lines 24-27, 164-191), returning a 202 response with `{ offline: true, queued: true }`.
- Replays queued requests when back online (lines 101-132) and notifies clients via `postMessage`.
- Falls back to cached `/` for document navigation when offline (lines 216-219).

**IndexedDB Offline Sync** (`hooks/useOfflineSync.ts`):
- Caches leads, properties, and deals in IndexedDB (lines 164-181).
- Supports mutation queuing with retry counting (max 3 retries, line 241-244).
- Drains mutation queue on reconnect and refreshes cached data (lines 223-262).
- Periodic background sync every 5 minutes when online (lines 306-313).

**LocalStorage Cache** (`hooks/use-offline-cache.ts`):
- 24-hour TTL for cached data (line 9).
- Automatic eviction of oldest 25% of entries when storage is full (lines 72-90).
- Pending actions queue for offline mutations (lines 93-141).

**Capacitor/Native Storage** (`hooks/use-offline-storage.ts`):
- Hybrid strategy: small values go to Capacitor Preferences on native, large values go to IndexedDB (line 30).
- Handles `QuotaExceededError` gracefully (lines 156-163).

**PWA Manifest** (`client/public/manifest.json`):
- Full PWA manifest with proper icons (192x192, 512x512, maskable), shortcuts for Dashboard/Leads/Properties/Deals, standalone display mode.

**UI Indicators**:
- `OfflineIndicator` component (`components/offline-indicator.tsx`) shows a persistent amber banner when offline with dismiss option, and a green "Reconnected! Syncing data..." banner on reconnect.
- `OfflineSyncBanner` for Field Scout (`components/field-scout/offline-sync-banner.tsx`) shows queue count, sync progress bar, and retry button.

---

## 5. Image Optimization

**Verdict: FAIL**

Image handling across the codebase lacks fundamental slow-network optimizations:

- **No `loading="lazy"`**: Out of 20+ `<img>` tags found across the codebase, only 2 instances (in `property-map.tsx:3252, 3280`) use `loading="lazy"`. The rest -- including property photos, QR codes, logo previews, captured images, field scanner photos, and photo galleries -- load eagerly.

- **No responsive images**: Zero usage of `srcset` or `sizes` attributes anywhere in the codebase. All images are served at their original resolution regardless of device screen size or network speed.

- **No WebP/AVIF serving**: While the platform accepts WebP uploads (`command-center.tsx:1504`, `pax-copilot-rail.tsx:225`), there is no server-side image transformation or format negotiation. Images are served in their uploaded format.

- **No image compression pipeline**: User-uploaded photos (property photos, field scout captures, vision AI images) appear to be stored and served at original quality.

**Specific examples**:
```
// settings.tsx:1675 -- 2FA QR code loaded eagerly
<img src={qrCode} alt="2FA QR Code" className="w-40 h-40 border rounded" />

// field-scout/photo-gallery.tsx:117 -- gallery with no lazy loading
<img ... className="w-full h-full object-cover" />

// floating-assistant.tsx:983+ -- AI chat images loaded eagerly
<img ... />
```

For a user on 3G uploading or viewing property photos, this means full-resolution images blocking the viewport with no progressive loading.

---

## 6. Caching Strategy

**Verdict: PASS**

**Static assets** (`server/static.ts`):
- Content-hashed assets (`main.abc123.js`) get `Cache-Control: max-age=1y, immutable` in production (lines 37-38). This is the gold standard -- once downloaded, hashed assets never need revalidation.
- HTML shell served with `Cache-Control: no-cache, no-store, must-revalidate` (lines 42-44, 72-74) to ensure users always get the latest entry point.

**API responses**:
- Most API routes have no explicit `Cache-Control` headers, relying on the client-side TanStack Query cache (`staleTime` + `gcTime`) instead. This is acceptable since API data is user-specific and auth-gated.
- AI streaming endpoints correctly set `Cache-Control: no-cache` (`server/routes-ai.ts:326, 1754`).
- Founder intelligence endpoint sets `Cache-Control: max-age=3600` (`server/routes-founder-intelligence.ts:1393`).

**Client-side caching** (`queryClient.ts`):
- `STALE_TIMES`: static (1h), short (30s), medium (2m), long (5m).
- `CACHE_TIMES`: static (1h), short (2m), medium (5m), long (15m).
- Defaults: `staleTime: 2min`, `gcTime: 5min` -- reasonable for CRM data that changes infrequently.

**Response compression** (`server/middleware/compression.ts` + `server/index.ts:208-209`):
- Brotli and gzip compression for all responses > 1 KB.
- Brotli quality set to 4 (line 38) -- good balance of speed vs. compression ratio.
- `compression` npm package also registered (`index.ts:209`) as a fallback.

**Route prefetching** (`hooks/use-next-route-prefetch.ts`):
- Predictive API prefetching based on current route: e.g., on `/leads`, prefetches `/api/properties`, `/api/deals`, `/api/campaigns` data (lines 4-19). This is particularly valuable on slow networks because the data is warm when the user navigates.

---

## 7. Request Waterfall

**Verdict: CONCERN**

The "Today" page (`pages/today.tsx`) -- the default landing page for authenticated users -- fires **13 independent `useQuery` calls** on mount:

1. `/api/dashboard/stats` (via `useDashboardStats`)
2. `/api/leads` (via `useLeads`)
3. `/api/properties` (via `useProperties`)
4. `/api/tasks`
5. `/api/alerts/active`
6. `/api/goals`
7. `/api/dashboard/intelligence`
8. `/api/pax/insights`
9. `/api/pax/pax-suggestions`
10. `/api/deals`
11. `/api/notes`
12. `/api/founder/v12/lifecycle/agents`
13. `/api/autonomous/tasks/pending-approval`
14. `/api/founder/v14/autonomy/score`
15. `/api/dashboard/today-priorities`

These all fire in parallel (which is correct -- they are independent `useQuery` hooks, not sequential `await` chains). However, on a 3G connection with limited concurrent connections (browsers typically allow 6 concurrent HTTP/1.1 connections per origin), this creates a queue of 15 requests with only 6 slots, meaning at least 3 rounds of network requests at 500ms+ RTT each.

**Mitigating factors**:
- TanStack Query's `staleTime` (2-5 minutes per query) means subsequent visits serve cached data instantly.
- Route prefetching (`use-next-route-prefetch.ts`) pre-warms some of these queries.
- Each section uses independent loading skeletons, so content appears incrementally.

**Concerns**:
- Several queries on the Today page are only relevant to founder/admin users (items 12-14: agent lifecycle, pending approvals, autonomy score), but they fire for all users. These should be conditionally enabled.
- The page fetches full `/api/leads` and `/api/properties` datasets in addition to dashboard stats -- potentially redundant data that is only used for computed counts.

---

## 8. Progressive Rendering

**Verdict: PASS**

The application demonstrates good progressive rendering patterns:

- **Skeleton components**: Three purpose-built skeletons -- `SkeletonList` (avatar rows), `SkeletonTable` (column headers + row placeholders), `SkeletonCard` (header + content lines) -- all using `framer-motion` pulse animation. Found across 121 files in the codebase.
- **PageShell with loading state**: The `PageShell` component (`components/page-shell.tsx`) accepts an `isLoading` prop that renders a `PageHeaderSkeleton` instead of blocking (lines 10-11, 47).
- **Independent section loading**: The Today page uses separate loading states for each section (`statsLoading`, `tasksLoading`, `alertsLoading`, `intelligenceLoading`, `paxLoading`, `prioritiesLoading`, `notesLoading`) rather than a single blocking spinner.
- **Suspense boundaries**: `React.Suspense` wraps the entire router (`App.tsx:304-742`) with a spinner fallback, and sub-routes use additional Suspense boundaries (pipeline tabs at `pipeline.tsx:323-343`, pax tabs at `pax.tsx:594-608`, money tabs at `money.tsx:108-116`).
- **Error boundaries**: `ErrorBoundary` component (`components/error-boundary.tsx`) prevents cascade failures -- a crash in one page section does not take down the whole app.

**Minor concern**: The top-level Suspense fallback (`App.tsx:304-308`) is a centered `Loader2` spinner rather than a content-shaped skeleton. For the very first route load on a slow network, the user sees a spinner instead of a skeleton that matches the page layout. This is acceptable since it is only seen once per session.

---

## 9. Data Efficiency

**Verdict: CONCERN**

- **Pagination**: The Leads page implements server-side pagination with a default `pageSize` of 25 (`pages/leads.tsx:642`). This is appropriate for slow networks.
- **Select transforms**: The Goals query uses `select` to filter active goals client-side (`today.tsx:193`), but the full goals array is still fetched from the server.
- **Full dataset fetches**: The Today page fetches `/api/leads` and `/api/properties` via `useLeads()` and `useProperties()` (lines 178-181) -- these appear to be unpaginated fetches of the full dataset, just to compute summary counts. On a slow network with hundreds of leads, this wastes bandwidth.
- **Offline sync fetches large payloads**: The offline sync hook (`useOfflineSync.ts:186-188`) fetches up to `limit=500` leads, `limit=500` properties, and `limit=200` deals. While necessary for offline access, this should be deferred until the user is on a good connection rather than running on every 5-minute interval.
- **No field selection**: API queries fetch entire resource objects. For pages that only need names and IDs (like dropdown selectors), the full object with all fields is transmitted. No evidence of GraphQL or sparse fieldset support.
- **Redundant data**: The Today page fetches both `/api/dashboard/stats` (via `useDashboardStats`) and full `/api/leads`, `/api/properties`, `/api/deals` datasets. The dashboard stats endpoint likely already aggregates the counts that the Today page re-derives from the raw data.

---

## 10. Connection Awareness

**Verdict: PASS**

AcreOS has a multi-layered connection awareness system:

**Network detection** (`hooks/use-native-network.ts`):
- Uses the Capacitor Network plugin on native platforms for accurate connection-type detection (wifi/cellular/none).
- Falls back to `navigator.onLine` + Network Information API on web (lines 86-109).
- Listens for `online`/`offline` events and triggers callbacks.
- Detects connection type via `navigator.connection.effectiveType` where available (Chrome, line 98).

**Offline UI**:
- Global `OfflineIndicator` component (`components/offline-indicator.tsx`) renders a fixed amber banner when offline, with "Syncing data..." feedback on reconnect.
- Field Scout has a dedicated `OfflineSyncBanner` with queue count, progress bar, and manual sync/retry buttons.
- PWA hook (`hooks/use-pwa.ts`) tracks `pendingSyncCount` and `syncedCount` for UI display.

**Online/offline event handling** spans 17 files across the codebase, indicating wide integration.

**Gap**: While the app detects connection type (`wifi` vs `cellular`), it does not adapt behavior based on connection quality. For example:
- No adaptive image quality (e.g., lower resolution on cellular).
- No deferred prefetching when on slow connections.
- No reduced animation/transition on slow connections.
- `navigator.connection.downlink` and `navigator.connection.rtt` are not used to estimate bandwidth.

This gap is noted but does not warrant a FAIL since the core detection infrastructure is in place and the `navigator.connection` API has limited browser support.

---

## Consolidated Recommendations

### High Priority (P0)

1. **Lazy-load Recharts from the critical path**. The `stat-card.tsx` component eagerly imports `recharts`, adding 121 KB gzipped to every page load. Either lazy-load the chart sub-component or replace inline sparklines with a lightweight canvas/SVG solution. Estimated savings: ~121 KB gzipped from the critical path.

2. **Add `loading="lazy"` to all below-fold images**. Only 2 of 20+ `<img>` tags use lazy loading. This is a one-line fix per image that prevents bandwidth waste on slow connections.

### Medium Priority (P1)

3. **Conditionally enable founder-only queries on the Today page**. Queries 12-14 (`/api/founder/v12/lifecycle/agents`, `/api/autonomous/tasks/pending-approval`, `/api/founder/v14/autonomy/score`) should use `enabled: isFounder` to avoid unnecessary requests for regular users.

4. **Add request timeouts via AbortController**. The `apiRequest` and `getQueryFn` functions use bare `fetch()` with no timeout. Add a 30-second `AbortController` signal to prevent requests from hanging indefinitely on poor connections.

5. **Replace full-dataset fetches with summary endpoints on Today page**. Instead of fetching all leads/properties/deals to compute counts, create or use existing dashboard summary endpoints that return only aggregated metrics.

6. **Add `srcset`/`sizes` to property and gallery images**. Serve responsive image variants so mobile users on 3G do not download desktop-sized photos.

### Low Priority (P2)

7. **Split the entry chunk further**. At 212 KB gzipped, `index.js` is heavy. Consider lazy-loading shell components that are not needed for first paint: `CommandPalette`, `ConversationTray`, `BetaFeedbackWidget`, `NpsDialog`, `FloatingHelpButton`.

8. **Defer offline sync on slow connections**. The 5-minute sync interval in `useOfflineSync.ts` fetches up to 1,200 records. Consider deferring large syncs until the user is on WiFi or explicitly requests a sync.

9. **Use a content-shaped skeleton for the top-level Suspense fallback** instead of a spinner, so the first route load on a slow network shows a recognizable page shape.

---

## Appendix: File References

| File | Relevance |
|------|-----------|
| `vite.config.ts` | Bundle splitting config |
| `client/index.html` | HTML entry, no render-blocking resources |
| `client/src/main.tsx` | Entry point, Clerk + SW registration |
| `client/src/App.tsx` | Router, lazy loading, Suspense boundaries |
| `client/src/lib/queryClient.ts` | Retry, caching, error handling |
| `client/src/lib/error-utils.ts` | Error classification and retry logic |
| `client/src/lib/font-loader.ts` | Dynamic non-blocking font loading (DEFECT-0033 fix) |
| `client/public/sw.js` | Service worker with offline queue |
| `client/public/manifest.json` | PWA manifest |
| `client/src/hooks/useOfflineSync.ts` | IndexedDB offline sync |
| `client/src/hooks/use-offline-cache.ts` | localStorage offline cache |
| `client/src/hooks/use-offline-storage.ts` | Capacitor + IDB hybrid storage |
| `client/src/hooks/use-native-network.ts` | Connection type detection |
| `client/src/hooks/use-pwa.ts` | PWA install, sync count |
| `client/src/hooks/use-next-route-prefetch.ts` | Predictive API prefetching |
| `client/src/components/offline-indicator.tsx` | Offline banner UI |
| `client/src/components/field-scout/offline-sync-banner.tsx` | Field scout sync UI |
| `client/src/components/query-error-state.tsx` | Contextual error states |
| `client/src/components/ui/skeleton*.tsx` | Loading skeletons |
| `client/src/components/page-shell.tsx` | Page layout with loading support |
| `server/static.ts` | Static asset caching headers |
| `server/middleware/compression.ts` | Brotli/gzip compression |
| `client/src/pages/today.tsx` | Primary landing page, 15 queries |
| `client/src/components/stat-card.tsx` | Eagerly imports recharts |
