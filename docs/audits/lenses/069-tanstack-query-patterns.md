# Lens 069 -- Client-Side Data Fetching Patterns (TanStack Query)

**Auditor perspective:** React Query / TanStack Query correctness, caching, error handling, stale data
**Date:** 2026-04-18
**Scope:** `client/src/` -- 301 files using useQuery/useMutation across hooks, pages, and components

## Distinct-Value Declaration

This audit reveals a **critical gap in query-level error handling**: the `handleQueryError` function is defined in `queryClient.ts` but never wired into the QueryClient defaults, leaving failed queries silently returning undefined data with no user notification. Mutations are covered by a global `onError` handler, but queries are not. This asymmetry means every page that renders query data without explicit error UI (145+ of 156 pages) fails silently on network errors.

---

## 1. QueryClient Configuration (GOOD)

**File:** `client/src/lib/queryClient.ts`

The global QueryClient setup is thoughtfully configured:

- `staleTime: STALE_TIMES.medium` (2 min) prevents excessive refetches -- reasonable default
- `gcTime: CACHE_TIMES.medium` (5 min) -- sensible garbage collection window
- `refetchOnWindowFocus: false` -- correct for a productivity app; users won't expect data to jump
- `refetchInterval: false` -- correct default; polling is opt-in per query
- Retry logic skips 401/403 errors, uses exponential backoff -- correct
- `STALE_TIMES` and `CACHE_TIMES` constants are exported and used consistently by hooks

The default `queryFn` uses `queryKey.join("/")` as the URL, which is a clever convention that works well when query keys are structured as URL path segments (e.g., `["/api/deals", 42]` becomes `/api/deals/42`).

## 2. CRITICAL: Query Error Handler Defined but Unused

**Severity: P1**
**File:** `client/src/lib/queryClient.ts`, lines 59-87

```ts
function handleQueryError(error: unknown): void {
  // ... full toast-based error handler
  console.error("[Query Error]", err);
}
```

This function is **defined but never referenced** -- not exported, not passed to QueryClient defaults, not used anywhere. The QueryClient `defaultOptions.queries` block has no `onError` callback. Meanwhile `defaultOptions.mutations.onError` is wired to `handleMutationError`.

**Impact:** When a query fails (network error, 500, timeout), the query enters an error state silently. If the component does not explicitly check `isError`/`error` and render an error UI, the user sees a blank or loading-forever state with no feedback.

**Fix:** Either wire `handleQueryError` into the global QueryClient defaults via the `QueryCache` constructor, or adopt the `throwOnError` approach with ErrorBoundary. The `QueryCache` approach:
```ts
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: handleQueryError,
  }),
  defaultOptions: { ... }
});
```

## 3. CRITICAL: Only 11 of ~156 Pages Handle Query Errors

**Severity: P1**

Files using `QueryErrorState` or checking `isError`/`error` with retry support:
- `dashboard.tsx`, `leads.tsx`, `properties.tsx`, `deals.tsx`, `finance.tsx`
- `executive-dashboard.tsx`, `pax.tsx`, `founder-home.tsx`, `onboarding-v2.tsx`
- `settings.tsx` (partial), `activity.tsx` (partial)

The remaining ~145 pages destructure `{ data }` from `useQuery` and render it directly. When the query fails, `data` is `undefined`, and these pages either crash on `.map()` of undefined, show permanent loading skeletons, or render empty states that mislead the user into thinking there is no data.

**Fix:** Combine the global `QueryCache.onError` handler (for toast notifications) with a `PageShell`-level error boundary or a wrapper that checks `isError` and renders `QueryErrorState`.

## 4. HIGH: Mutations Returning Raw `Response` Objects

**Severity: P1**

Many mutations using `apiRequest()` return the raw `Response` object instead of parsed JSON:

| File | Mutation |
|------|----------|
| `pages/listings.tsx` | `createMutation`, `deleteMutation`, `publishMutation`, `unpublishMutation` |
| `pages/documents.tsx` | `createTemplateMutation`, `updateTemplateMutation`, `deleteTemplateMutation`, `generateDocMutation`, `sendForSignatureMutation`, 5 more |
| `pages/offers.tsx` | `createBatchMutation`, `sendOfferMutation`, `deleteOfferMutation`, `createTemplateMutation`, `updateTemplateMutation`, `deleteTemplateMutation` |
| `components/custom-fields.tsx` | 4 mutations |
| `components/saved-views-selector.tsx` | 3 mutations |
| `components/workspace/WorkspaceManager.tsx` | 2 mutations |
| `components/deal-feed/daily-deal-feed.tsx` | 2 mutations |
| `components/offer-wizard.tsx` | 1 mutation |

When `onSuccess` tries to use `data`, it receives a `Response` object, not parsed data. In `documents.tsx` line 297, `data?.message` on a Response object evaluates to `undefined`. The `generateAllDocsMutation` onSuccess handler has `(data: any) => { ... data?.message }` which never shows the server's message.

**Fix:** Always call `.json()` on the response in the `mutationFn` before returning.

## 5. HIGH: Dead `res.ok` Checks After `apiRequest()`

**Severity: P2 (dead code, not a bug)**

`apiRequest()` calls `throwIfResNotOk(res)` internally, so it never returns a non-OK response. Several mutations check `res.ok` after `apiRequest()`, creating dead branches:

- `hooks/use-deals.ts` lines 210-213 (`useBulkStageUpdate`)
- `hooks/use-deals.ts` lines 240-243 (`useBulkStageUndo`)
- `hooks/use-deals.ts` line 126 (`useDeleteDeal`)
- `hooks/use-organization.ts` lines 234-237 (`useUpdateTeamMemberRole`)
- `hooks/use-onboarding.ts` lines 91-92

This is not a runtime bug but is confusing for maintenance -- developers may think non-OK responses reach the branch.

## 6. HIGH: `use-saved-filters.ts` Missing `credentials: "include"`

**Severity: P1 (auth bug)**
**File:** `client/src/hooks/use-saved-filters.ts`

All four `fetch()` calls in this hook omit `credentials: "include"`:
- Line 48: `fetch(\`/api/saved-views?entityType=${entityType}\`)`
- Line 64: `fetch("/api/saved-views", { method: "POST", ... })`
- Line 83: `fetch(\`/api/saved-views/${id}\`, { method: "DELETE" })`
- Line 94: `fetch(\`/api/saved-views/${id}/default\`, { method: "PATCH" })`

Without `credentials: "include"`, Clerk session cookies are not sent, and these requests will fail with 401 on deployed environments (where the API is on a different port or subdomain). The hook falls back to localStorage silently on failure, masking the bug.

**Fix:** Add `credentials: "include"` to all fetch calls, or use `apiRequest()` for the POST/DELETE/PATCH calls.

## 7. MEDIUM: Aggressive Polling on `sovereign-v13.tsx`

**Severity: P2**
**File:** `client/src/pages/sovereign-v13.tsx`

This single page runs **9 concurrent polling queries**:
- 2 queries at 15-second intervals
- 5 queries at 30-second intervals
- 1 query at 20-second intervals
- 1 query at 60-second intervals

When a user has this page open, it generates ~24 API requests per minute to the server. None of these queries use `refetchIntervalInBackground: false`, so they continue polling even when the tab is inactive.

Similarly, `pages/real-runtime.tsx` has queries at 5-second intervals, and `pages/agent-command-center.tsx` polls at 10-15 second intervals across multiple queries.

**Fix:** Add `refetchIntervalInBackground: false` to all polling queries. Consider using WebSocket/SSE for real-time data instead of aggressive polling.

## 8. MEDIUM: Legacy `useDeals()` Fetches 1000 Records

**Severity: P2**
**File:** `client/src/hooks/use-deals.ts`, line 48

```ts
const res = await fetch('/api/deals?page=1&pageSize=1000', { credentials: "include" });
```

The legacy `useDeals()` hook fetches up to 1000 deals in a single request. The paginated `useDealsPaginated()` exists but is not used everywhere. Pages like `today.tsx` (line 215) also fetch all deals via the default queryFn for `["/api/deals"]`.

The legacy `useLeads()` and `useProperties()` have the same pattern but cap at 100, which is more reasonable.

## 9. MEDIUM: Direct `queryClient` Import vs. `useQueryClient()`

**Severity: P2**

30+ files import the singleton `queryClient` directly from `@/lib/queryClient` instead of using the `useQueryClient()` hook. While functionally equivalent in a single-QueryClient app, this pattern:

- Bypasses React's context system and component tree
- Makes testing harder (can't swap in a test QueryClient)
- Creates tight coupling to the module-level singleton

Notable files: `use-onboarding.ts`, `use-playbooks.ts`, `use-checklists.ts`, `pages/today.tsx`, `pages/founder-dashboard.tsx`, `pages/documents.tsx`, `pages/offers.tsx`, and ~25 others.

## 10. LOW: `prefetchCommonRoutes()` Defined but Never Called

**Severity: P3**
**File:** `client/src/lib/queryClient.ts`, lines 215-218

```ts
export function prefetchCommonRoutes() {
  const routes = ['/api/leads', '/api/properties', '/api/deals', '/api/notes'];
  routes.forEach(route => prefetchRoute(route));
}
```

This function is exported but never imported or called anywhere. The individual `prefetchRoute` function is used (in sidebar hover and command palette), but the batch prefetch is dead code.

## 11. OBSERVATION: Well-Designed Patterns Worth Preserving

Several patterns in the codebase are well-designed and should be kept as-is:

- **`STALE_TIMES` / `CACHE_TIMES` constants** -- consistent, well-named, used across hooks
- **`keepPreviousData` for paginated queries** -- `useLeadsPaginated`, `useDealsPaginated`, `usePropertiesPaginated` all use this correctly to avoid layout shifts during pagination
- **`enabled` guards on detail queries** -- `useLead(id)`, `useDeal(id)`, `useCampaign(id)`, `useAIDossier(dossierId)`, etc. all properly guard with `enabled: !!id`
- **Mutation invalidation patterns** -- CRUD hooks in `use-leads.ts`, `use-deals.ts`, `use-properties.ts` correctly invalidate list queries on create/update/delete
- **`apiRequest` utility** -- centralized error handling with structured error parsing, 429 upgrade prompt, consistent credentials
- **Hover-based route prefetching** -- sidebar and command palette prefetch API data on hover, reducing perceived latency
- **Conditional polling** -- `gis-health-dashboard.tsx` and `founder-dashboard.tsx` use function-based `refetchInterval` that stops polling when not needed
- **`useInfiniteScroll` hook** -- well-implemented infinite query with IntersectionObserver integration

---

## Summary

| # | Finding | Severity | Files |
|---|---------|----------|-------|
| 2 | `handleQueryError` defined but never wired | P1 | `queryClient.ts` |
| 3 | 145+ pages lack query error handling | P1 | Most pages |
| 4 | Mutations return raw `Response` instead of parsed data | P1 | ~30 mutations across 8+ files |
| 5 | Dead `res.ok` checks after `apiRequest()` | P2 | `use-deals.ts`, `use-organization.ts`, `use-onboarding.ts` |
| 6 | `use-saved-filters.ts` missing `credentials: "include"` | P1 | 1 file, 4 fetch calls |
| 7 | Aggressive polling without background pause | P2 | `sovereign-v13.tsx`, `real-runtime.tsx`, `agent-command-center.tsx` |
| 8 | Legacy hooks fetch oversized payloads (1000 records) | P2 | `use-deals.ts` |
| 9 | Direct `queryClient` import instead of `useQueryClient()` | P2 | 30+ files |
| 10 | `prefetchCommonRoutes` is dead code | P3 | `queryClient.ts` |

**Top 3 actions:**
1. Wire `handleQueryError` into `QueryCache.onError` -- instant safety net for all 300+ queries
2. Fix `use-saved-filters.ts` credentials -- silent auth failure on production
3. Audit mutations returning raw `Response` -- `onSuccess` handlers receive wrong data type
