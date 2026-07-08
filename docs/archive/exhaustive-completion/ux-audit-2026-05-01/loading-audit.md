# Loading-State Audit — 2026-05-01

Scope: every place AcreOS can hang or stall on data, every page that defers
rendering until full data lands, every bundle hot-spot that delays first
paint. Read the codebase as it sits today; do not fix.

## 1. Executive summary

### Top 3 indefinite-spinner risks (most likely cause of "indefinite at points")

1. **`<ProtectedRoute>` → `<Suspense>` → `useAuth().isLoading` chain in
   `client/src/App.tsx:276-297, 367-373, 380-384`.** Three serialised
   loaders with no global timeout. If `/api/auth/user` hangs or
   `__session` cookie refresh is mid-flight, the user sees the AcreOS
   `PageLoader` forever — `useAuth.isLoading` stays true while a
   `cookiePresent && !isFetched` race is in progress
   (`client/src/hooks/use-auth.ts:96`). There is no escape hatch, no
   "still loading? try refreshing." after N seconds.
2. **`portfolio.tsx:269` gates the entire page on
   `summaryLoading || delinquencyLoading || projectionsLoading`.** Three
   independent inline-`queryFn` queries (`portfolio.tsx:179-204`) — if
   any one hangs, the whole page is a stack of `Skeleton` until it
   resolves. Those inline `queryFn`s also bypass the global 401 retry
   in `lib/queryClient.ts:236-244`, so an expired session manifests as
   a permanent loading state instead of the auto-refresh-and-retry path
   the rest of the app uses.
3. **`founder-dashboard.tsx:1900-1911` returns a full-screen Skeleton
   gated on `isLoading` from `/api/admin/dashboard` alone**, even though
   the page has 29 other queries. One slow admin endpoint blocks the
   entire 7,452-line surface from rendering. Same anti-pattern repeated
   at lines 6144, 6369, 6964, 7199, each gating a sub-surface on a
   single query without a timeout fallback.

### Top 3 bundle-bloat issues

1. **`pages/founder-dashboard.tsx` is 7,452 lines in one chunk** with
   29 `useQuery` calls, 15 `refetchInterval` polls, and recharts via
   `dashboard/MRRTrajectory`, `dashboard/PredictiveInsights`,
   `cash-flow-waterfall`, etc. It's lazy-loaded at the route level
   (App.tsx:175) but ships as a single ~600KB-equivalent chunk on
   first hit, blocking founder TTI.
2. **Eager cross-page imports defeat route-level lazy splitting.**
   `pages/money.tsx:13` does `import FinancePage from "@/pages/finance"`
   (1,824 lines + recharts). `pages/pipeline.tsx:24` does
   `import DealsPage from "@/pages/deals"` (2,234 lines). `pages/pax.tsx:30`
   does `import CommandCenterPage from "@/pages/command-center"`
   (2,264 lines). The user navigating to `/money` synchronously
   downloads Finance + Recharts + 4 sibling lazy chunks' worth of
   imports before paint. Same for `/pipeline` and `/ai`.
3. **23 pages import `recharts` at module top-level** (grep:
   `client/src/pages/*.tsx | xargs grep recharts`). Recharts is
   roughly 90KB gzipped + d3 deps. Pages that show charts only on a
   non-default tab (`portfolio.tsx`, `finance.tsx`, `analytics.tsx`,
   `dashboard.tsx`, `freedom-meter.tsx`, `marketplace-analytics.tsx`,
   `data-moat-dashboard.tsx`, `reseller-dashboard.tsx`, `va-dashboard.tsx`)
   pay the full recharts cost on first paint regardless.

## 2. Default queryClient config review

File: `client/src/lib/queryClient.ts:284-319`.

| Setting | Value | Verdict | Recommendation |
|---|---|---|---|
| `staleTime` | `STALE_TIMES.medium` = 2 min | Reasonable global default | Keep |
| `gcTime` | `CACHE_TIMES.medium` = 5 min | Fine | Keep |
| `refetchInterval` | `false` | Good — opt-in only | Keep |
| `refetchOnWindowFocus` | `false` | Reasonable | Keep |
| `retry` | 1 max via `shouldRetry` (`error-utils.ts:57-72`) | **Good** — caps tail latency at ~3.5s on transient failure | Keep |
| `retryDelay` | `min(500 * 2^n, 3000)` | Fine | Keep |
| **Network timeout** | **None** — `fetch()` has no per-request `AbortSignal` | **MISSING** | Add a default `signal: AbortSignal.timeout(30_000)` to `getQueryFn` (`queryClient.ts:251-268`) and to `apiRequest` (`queryClient.ts:226-244`). Today a stalled connection to a Fly.io server hangs forever — that is the single biggest source of "load times are super long or just indefinite." |
| `onError` toast suppression | 401/403/404 silenced | Good | Keep |

**Critical recommendation:** introduce a 20–30s `AbortSignal.timeout`
on every fetch (both `getQueryFn` and `apiRequest`). Combined with the
existing 1-retry cap, the worst-case wall-clock for a hung query
becomes ~60s with a clear error toast, instead of unbounded.

## 3. Indefinite-spinner risk table

| Page | File:line | Symptom | Why it can hang | Fix direction |
|---|---|---|---|---|
| Auth bootstrap | `App.tsx:276-297` (`ProtectedRoute`) | Branded `PageLoader` indefinitely | `useAuth.isLoading` stays true if `/api/auth/user` hangs; no timeout | Add 10s timeout → render `<Redirect to="/auth" />` with a "session expired" toast |
| Auth bootstrap | `App.tsx:367-373` (`HomeRoute`) | PageLoader on `/` | Same chain | Same |
| Flagged routes | `App.tsx:318-333` | Bare spinner if either auth OR flags hang | `useFeatureFlags` has no `enabled` guard (see `hooks/use-feature-flags.ts:9-13`) — fires before user resolves | Gate `useFeatureFlags` on `!!user`; add timeout |
| Portfolio | `pages/portfolio.tsx:269,311+` | Skeleton stack until 3 inline queries resolve | `summaryLoading\|\|delinquencyLoading\|\|projectionsLoading`; inline `queryFn`s bypass 401 retry | Drop inline `queryFn`s, use default; render each card independently with its own loading state |
| Pax /ai | `pages/pax.tsx:180-197` (`InsightsTabContent`) | Tab-level Skeleton on insights | `/api/pax/insights` is an LLM-backed endpoint; no `staleTime` set (default 2 min ok), no timeout | Add `staleTime: 5*60_000` (already cached on /today as 5 min); ensure server has hard timeout |
| Pax /ai | `pages/pax.tsx:461-475` (`AiChatGuard`) | Skeleton h-64 blocks chat UI | Gates entirely on `/api/health/cached`; if the health endpoint stalls, Pax chat is unreachable | Default to "available" optimistically; flip to error on confirmed unconfigured |
| Founder dashboard | `pages/founder-dashboard.tsx:1900` | 7-skeleton full-page block | Gates on `/api/admin/dashboard` alone; 29 other queries irrelevant | Render shell + per-card skeletons that resolve independently |
| Founder dashboard | `pages/founder-dashboard.tsx:6144,6369,6964,7199` | Sub-card skeletons block sub-surfaces | One query per sub-surface, no timeout, no retry-CTA | Same per-card pattern |
| Parcel detail | `pages/parcel-detail.tsx:127` | Page-level skeleton | Single query gate; OK as a child page | Acceptable; add error CTA if missing |
| Blind offer wizard | `pages/blind-offer-wizard.tsx:372-379` | "Calculating your offer…" full-screen `Loader2` (no progress, no timeout) | Server step can take 10-30s (USDA + comps + LLM) | Add progress phases or 45s timeout with retry |
| Tax optimizer | `pages/tax-optimizer.tsx:129-134` | Bare full-page `Loader2 h-8 w-8` | No skeleton, no timeout | Replace with content-shaped skeleton |
| Compliance | `pages/compliance.tsx:106` | Page gates on isLoading | Same | Same |
| Inbox | `pages/inbox.tsx:783-787` | Bare spinner inside `ScrollArea` | `/api/conversations/:id/messages` hang shows a centered Loader2 indefinitely | Use `ListSkeleton` (already imported l.23) and add a "messages slow to load" message after 5s |
| Drip sequences | `pages/drip-sequences.tsx:157` | Inline `Loader2 + "Loading sequences…"` | No skeleton | Use ListSkeleton |
| Listing syndication | `pages/listing-syndication.tsx:156` | Same | Same | Same |
| Property tax | `pages/property-tax.tsx:98` | Same | Same | Same |
| Cohort analysis | `pages/cohort-analysis.tsx:108` | Same | Same | Same |
| Portfolio P&L | `pages/portfolio-pnl.tsx:113` | Same | Same | Same |
| Portfolio health | `pages/portfolio-health.tsx:179` | Same | Same | Same |
| Seller intent | `pages/seller-intent.tsx:273` | Same | Same | Same |
| Daily digest | `pages/founder-daily-digest.tsx:32` | Page-level Skeleton h-96 | Gates on a single query, no error CTA | Add QueryErrorState retry path |
| Founder agents | `pages/founder-agents.tsx:84` | Page gate | Same | Same |
| Beta analytics | `pages/beta-analytics.tsx:72` | Same | Same | Same |
| Decision queue | `pages/decision-queue.tsx:234` | Same | Same | Same |
| KPI dashboard | `pages/kpi-dashboard.tsx:61` | Same | Same | Same |
| Usage quota | `pages/usage-quota.tsx:83` | Same | Same | Same |
| Deal hunter | `pages/deal-hunter.tsx:522,937` | Two cascading gates | Two separate isLoading checks — second only renders if first resolves | Render in parallel |
| Tax-delinquent / Cert-leaderboard / Agent-detail / Webhooks / Tax-optimizer / Goals | various | Full-page `Loader2 h-8 w-8` in lieu of skeleton | Generic spinner anti-pattern (brief §11) | Replace with content-shaped Skeleton |

### Specific risk: `useDashboardStats` polling

`client/src/hooks/use-organization.ts:67-79` sets
`refetchInterval: 30_000` AND `refetchOnWindowFocus: true`. This fires
on every page that calls `useDashboardStats()` (notably `today.tsx:195`).
Combined effect: every 30s a network request, plus another on every
focus event, plus the toast/refetch storm if it fails. Acceptable when
healthy; on a degraded network this is a constant churn that compounds
the perception of slowness.

## 4. Lazy-load opportunities

### A. Eager cross-page imports — break these first

| Importer | Eagerly imported page | Lines | Heavy deps pulled | Recommendation |
|---|---|---|---|---|
| `pages/money.tsx:13` | `FinancePage` | 1,824 | recharts | `lazy(() => import(...))` like the other tabs |
| `pages/pipeline.tsx:24` | `DealsPage` | 2,234 | (large local) | Same — and stop double-rendering on `board` + `deals` tabs |
| `pages/pax.tsx:30` | `CommandCenterPage` | 2,264 | recharts | Same |

These three eager imports each pull a 100-200KB sibling chunk into
the parent route's bundle, defeating the App.tsx lazy split.

### B. Founder dashboard — split internally

`pages/founder-dashboard.tsx` (7,452 lines) is one chunk. Inside it:

- 6 distinct top-level tabs (`overview`, `growth`, `operations`,
  `infrastructure`, `users`, etc.) each with their own queries.
- Recharts via dashboard sub-components.
- AdSense / campaign / templates trees (lines 5332-5400).

Recommendation: extract each tab into its own file under
`components/founder-dashboard/<tab>.tsx` and `lazy()` each. Today,
loading `/founder-dashboard` to view "operations" still ships every
chart, every endpoint discovery dialog, every campaign wizard.

### C. Recharts splitting

23 pages import recharts. `client/src/components/ui/chart.tsx:4`
re-exports `* as RechartsPrimitive`, which means tree-shaking is
ineffective for files that import from `chart.tsx`. Split candidates
(chart only on non-default tab):

| Page | Chart usage | Suggested split |
|---|---|---|
| `pages/dashboard.tsx:14` | PieChart, BarChart, FunnelChart | Lazy `<ChartsCard />` |
| `pages/portfolio.tsx:50` | Multiple charts | Lazy per chart |
| `pages/finance.tsx:28` | AreaChart only | Lazy or move into `<CashFlowChart />` |
| `pages/freedom-meter.tsx:17` | Multiple | Lazy |
| `pages/marketplace-analytics.tsx:14` | Multiple | Lazy |
| `pages/avm.tsx:28` | Multiple | Lazy |
| `pages/voice-analytics.tsx:23` | Multiple | already removed per App.tsx:117 — confirm the page file is also dead |

### D. Other heavy modules

- `date-fns` `format` is imported across many components — that one is
  acceptable (tree-shakable, small per-export) and not a hotspot.
- No `react-pdf` / `three.js` / `moment` found, so those classes of
  bloat aren't present.

## 5. Network waterfall hotspots

### today.tsx — 13 queries on mount

`pages/today.tsx:195-352` fires (in render order):

1. `useDashboardStats` (`/api/dashboard/stats`)
2. `useLeads` (`/api/leads?page=1&pageSize=100`)
3. `useProperties` (`/api/properties?page=1&pageSize=100`)
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

These run in parallel (good), but several are computable from a
combined dashboard endpoint. `/api/dashboard/intelligence`,
`/api/dashboard/today-priorities`, `/api/pax/insights`,
`/api/pax/pax-suggestions` overlap — every render re-derives priorities
that the server is already computing. **Recommendation:** add a single
`/api/today/bundle` endpoint that returns `{stats, intelligence,
priorities, paxInsights, paxSuggestions, alerts}` in one round-trip.

Two of those (`/api/founder/*`) are fired on the customer Today page
even for non-founder users — they 404 and are silenced by the global
404 toast suppressor (`queryClient.ts:72-75`), but the network calls
still happen on every Today load. Gate with `enabled: isFounder`.

### founder-dashboard.tsx — 29 queries, no batching

Same anti-pattern at scale. Many queries are correctly gated with
`enabled: activeTab === "operations"` etc., but the overview tab still
fires `/api/admin/dashboard`, `/api/admin/alerts`,
`/api/founder/api-usage`, `/api/founder/intelligence/decisions-inbox`,
`/api/founder/revenue/waterfall`, plus the polling components it hosts.

### Polling intervals — too aggressive

Inventory of intervals < 30s:
- `components/conversation-tray.tsx:270` — `refetchInterval: 5000`
- `components/conversation-tray.tsx:468` — `refetchInterval: 10000`
- `components/team-general-channel.tsx:53` — `10_000`
- `components/sms-conversation.tsx:37` — `15_000`
- `components/founder/AgentDebatePanel.tsx:159` — `5000`
- `components/founder/WarRoom.tsx:113` — `3000` (gated on active room)
- `components/founder/WorkflowMonitor.tsx:143,149` — `10000`, `5000`
- `components/founder/FounderTwin.tsx:140` — `10000`
- `components/founder/ScenarioEngine.tsx:152` — `5000`
- `pages/conscious-organization.tsx:561` — `5000`
- `pages/real-runtime.tsx:26` — `5000`
- `hooks/use-agent-tasks.ts:13` — `5000`
- `hooks/use-organization.ts:76` — `30_000` for `useDashboardStats`

The 5-second polls are particularly costly because none of these
queries set `refetchIntervalInBackground: false`, so they keep firing
when the tab is hidden. Compare `dashboard/ThePulse.tsx:34-35` and
`dashboard/JobQueueHealth.tsx:60-61` which correctly pause in
background.

**Recommendation:** add `refetchIntervalInBackground: false` everywhere
the interval is under 60s. Without it, an idle tab in the background
fires 720 requests/hour at 5s polling.

### Polling without backoff on error

None of the polling components in `client/src/components/founder/*`
back off on failure. A query failing every 5s spams 720 rps/h against
a known-broken endpoint. TanStack Query's `refetchInterval` honors
`retry` (1 retry), but the next interval still fires.

Recommendation: pass `refetchInterval: (query) => query.state.error ?
60_000 : 5_000` to back off to 1 minute on error.

## 6. Skeleton-hygiene gaps

### Generic spinners that should be skeletons

(see table in §3 — same list applies for hygiene.) Common offenders:

- `pages/inbox.tsx:783` (bare spinner inside scroll area for messages)
- `pages/tax-optimizer.tsx:134` (h-8 w-8 spinner)
- `pages/goals.tsx:217` (same)
- `pages/webhooks.tsx:168` (same)
- `pages/team-leaderboard.tsx:199` (same)
- `pages/beta-dashboard.tsx:258` (same, py-12 wrapper)
- `pages/admin-support.tsx:400` (same)
- `pages/investor-directory.tsx:198,282` (same, twice)
- `pages/properties.tsx:1780` (h-5 w-5 spinner)

### Empty-array → spinner instead of EmptyState

- `pages/inbox.tsx:1138-1145` — uses ListSkeleton on load (good) but
  the empty branch is a centered icon block with text, not the
  canonical `EmptyState` component. Acceptable.
- `pages/founder-daily-digest.tsx:44-46` — empty digest renders a bare
  `<p className="text-muted-foreground">No digest available yet…</p>`
  instead of `EmptyState`. Should use EmptyState with a CTA to wait or
  trigger generation.

### Error states that aren't QueryErrorState

`pages/portfolio.tsx`, `pages/finance.tsx`, `pages/today.tsx`,
`pages/founder-dashboard.tsx` swallow query errors silently
(query-cache `onError` toasts, then UI shows empty/zero state). For
the major pages, no inline `<QueryErrorState onRetry={refetch} />`
fallback. If a key endpoint 500s, the user sees zero-state copy as if
they had no data, which is worse than an error.

Pages that DO use `QueryErrorState` correctly (model these):
- `pages/pax.tsx:199-209` (insights tab)
- `pages/finance.tsx:37` (imported, used for notes error)

## 7. Quick wins (each under 10 minutes)

1. **Add fetch timeout** to `getQueryFn` and `apiRequest` in
   `client/src/lib/queryClient.ts:218-224, 251-268`:
   ```
   const controller = new AbortController();
   const t = setTimeout(() => controller.abort(), 30_000);
   try { return await fetch(url, { ...opts, signal: controller.signal }); }
   finally { clearTimeout(t); }
   ```
   This single change caps every hung request at 30s.

2. **Make `useDashboardStats` less chatty** — drop
   `refetchInterval: 30_000` and `refetchOnWindowFocus: true` from
   `hooks/use-organization.ts:76-77`. The 30s server cache TTL doesn't
   require client polling.

3. **Convert eager cross-page imports to lazy.** Three lines:
   - `pages/money.tsx:13` → `const FinancePage = lazy(() => import("@/pages/finance"))`
   - `pages/pipeline.tsx:24` → same for `DealsPage`
   - `pages/pax.tsx:30` → same for `CommandCenterPage`
   Wrap their first usage in `<Suspense fallback={<TabFallback />}>` (the
   wrapper already exists in each file).

4. **Stop pipeline.tsx from rendering DealsPage twice.**
   `pages/pipeline.tsx:307` (board tab) and `pages/pipeline.tsx:324`
   (deals tab) both render `<DealsPage />`. Pick one — board should
   render the kanban board component, not the full DealsPage list.

5. **Add `enabled: isFounder` guards** to the four founder endpoints
   in `pages/today.tsx:305-316`. Cuts 3-5 silent 404s per Today render
   for the typical (non-founder) user.

6. **Add `refetchIntervalInBackground: false`** to every
   `refetchInterval` < 60s. Bulk find/replace candidate, ~25 lines.

7. **Replace `Loader2 h-8 w-8` page gates with content-shaped
   `Skeleton`s.** ~12 pages (see §6 list). Each is 5-line replace.

8. **Founder dashboard: stop gating the entire page on
   `/api/admin/dashboard`.** Move `pages/founder-dashboard.tsx:1900`'s
   skeleton into the overview tab body so the chrome (sidebar, header,
   tabs) renders immediately.

9. **Portfolio page: drop inline `queryFn`s.** Lines 179-222 of
   `pages/portfolio.tsx` write `queryFn: async () => fetch(...)` for
   every query. Removing these and letting the default `getQueryFn`
   kick in (per `queryClient.ts:293`) gets them the 401 auto-refresh
   for free, which alone explains some "indefinite" symptoms after
   token expiry.

10. **Add `enabled: !!user` to `useFeatureFlags`** at
    `hooks/use-feature-flags.ts:9`. Currently it fires before auth
    resolves on every cold load, racing the auth fetch.

## Appendix — files audited

- `client/src/App.tsx` (route table, Suspense, ProtectedRoute, FlaggedRoute, PersonaRoute, HomeRoute)
- `client/src/lib/queryClient.ts`
- `client/src/lib/error-utils.ts`
- `client/src/hooks/use-auth.ts`
- `client/src/hooks/use-organization.ts`
- `client/src/hooks/use-leads.ts` (representative of -properties, -deals, -notes, -payments)
- `client/src/hooks/use-feature-flags.ts`
- `client/src/pages/today.tsx`, `pipeline.tsx`, `money.tsx`,
  `portfolio.tsx`, `finance.tsx`, `pax.tsx`, `inbox.tsx`,
  `founder-dashboard.tsx`, `parcel-detail.tsx`, `blind-offer-wizard.tsx`,
  `founder-daily-digest.tsx`
- recharts importers: 23 pages enumerated via grep
- refetchInterval inventory: 60+ call sites across `components/` and `pages/`
