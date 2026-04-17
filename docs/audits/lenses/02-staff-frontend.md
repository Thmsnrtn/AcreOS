# Lens 2 -- Staff Frontend Engineer Audit

**Auditor lens:** Staff frontend engineer (React patterns, component architecture, state management, bundle optimization, rendering performance, code quality)
**Date:** 2026-04-15
**Codebase snapshot:** commit ff7b154 (main)

---

## Executive Summary

AcreOS has a massive 156-page React SPA powered by React 18, Vite, TanStack Query, shadcn/ui, and Framer Motion. The foundations are competent -- lazy loading, a centralized query client, a reusable PageShell, well-typed custom hooks, and a proper ErrorBoundary. However, the codebase has accumulated serious structural debt: App.tsx contains 47 duplicate route declarations that silently shadow each other (with conflicting guard logic between FlaggedRoute and ProtectedRoute for the same paths), the founder-dashboard is a 7,286-line single component with 75 useState calls and zero React.memo usage, and 68 of 156 pages skip the PageShell layout entirely. Only 9 pages out of 156 use the QueryErrorState component. The app will ship, but the frontend is fragile, inconsistent, and slow to iterate on.

---

## Findings

### FE-01: 47 Duplicate Route Declarations in App.tsx
**Severity:** P0
**Description:** `App.tsx` (810 lines) defines 187 `<Route>` elements, of which **47 paths are declared twice**. The `<Switch>` component from wouter renders only the first match, meaning the second block (lines ~544-671) is entirely dead code. Worse, the duplicate blocks use different guard components -- e.g., `/avm` uses `FlaggedRoute` on line 471 but `ProtectedRoute` on line 568; `/compliance` uses `FlaggedRoute` on line 495 but `ProtectedRoute` on line 624. This means feature flags are silently bypassed for those routes because the first declaration (with FlaggedRoute) wins, but future maintainers editing the second block will believe their changes are live.

Additionally, `/founder` redirects to `/founder-dashboard` on line 449 but to `/founder-home` on line 640. Only the first redirect fires.

**Evidence:**
- `/Users/user/AcreOS/AcreOS/client/src/App.tsx` lines 309-672
- Duplicate paths confirmed: `/inbox` (lines 433, 545), `/campaigns` (lines 388, 546), `/finance` (lines 382, 549), `/portfolio` (lines 385, 550), `/settings` (lines 424, 617), `/avm` (lines 471, 568), `/compliance` (lines 495, 624), and 40 more.
- `/founder` redirects to `/founder-dashboard` (line 449) vs `/founder-home` (line 640)

**Remediation:** Delete the duplicate route block (lines ~544-671). Audit the surviving routes to ensure FlaggedRoute vs ProtectedRoute is intentional for each path. Establish a route registry or codegen to prevent future drift.

---

### FE-02: Unprotected Route Renders Authenticated Component
**Severity:** P0
**Description:** The `/market-data` route on line 538 renders `<MarketDataPage />` directly without any ProtectedRoute or FlaggedRoute wrapper, unlike every other data-fetching route. The component makes an authenticated API call to `/api/market-intelligence/public/data`. If this is intended to be public, it should handle 401 gracefully. If not, it is an auth bypass.

**Evidence:**
- `/Users/user/AcreOS/AcreOS/client/src/App.tsx` line 538: `<Route path="/market-data">{() => <MarketDataPage />}</Route>`
- `/Users/user/AcreOS/AcreOS/client/src/pages/market-data.tsx` line 45-47: fetches from authenticated endpoint with no error handling for 401

**Remediation:** Wrap in ProtectedRoute or confirm it is intentionally public and add 401 error handling.

---

### FE-03: Founder Dashboard is 7,286 Lines in a Single File
**Severity:** P1
**Description:** `founder-dashboard.tsx` is a monolithic 7,286-line component containing 75 `useState` calls, 88 `useQuery`/`useMutation` hooks, 5 `useEffect` calls, and inline definitions for at least 20 sub-components and interfaces. The file imports 28 sub-components from `components/founder/` but still inlines thousands of lines of UI logic. This makes the component virtually un-reviewable, impossible to test in isolation, and creates a single massive bundle chunk.

**Evidence:**
- `/Users/user/AcreOS/AcreOS/client/src/pages/founder-dashboard.tsx`: 7,286 lines
- 75 useState hooks detected (grep count)
- 88 useQuery/useMutation hooks detected
- Orientation doc confirms 382KB JS chunk for this page

**Remediation:** Extract the 8+ tab panels (Overview, Agents, Operations, Growth, Infrastructure, etc.) into separate lazy-loaded components. Move the ~20 inline interfaces to a shared types file. Consider splitting queries into dedicated hooks (e.g., `useFounderMetrics`, `useFounderAgentStatus`).

---

### FE-04: Zero React.memo Usage Across Entire Codebase
**Severity:** P1
**Description:** A grep for `React.memo` across the entire client/src directory returns **zero matches**. The codebase has 187 components and 156 pages. While React 19's compiler may eventually make memo unnecessary, the app is on React 18.3.1, which does not have the compiler. Combined with the AnimatePresence re-render on every route change (App.tsx line 681) and 75 useState calls in the founder dashboard, this means extensive unnecessary re-rendering throughout the app.

**Evidence:**
- `grep React.memo client/src/` -- 0 results
- `package.json`: react ^18.3.1 (no React compiler)
- `useMemo`/`useCallback` usage: 316 occurrences across 73 files (reasonable but concentrated in hooks/contexts, sparse in pages)

**Remediation:** Add React.memo to stable child components rendered in lists and tabs, especially within the founder dashboard and any component rendered inside the AnimatePresence PageWrapper. Consider migrating to React 19 with the compiler, or at minimum add memo to list row components, stat cards, and tab panels.

---

### FE-05: 68 of 156 Pages Skip PageShell Layout
**Severity:** P1
**Description:** The project has a well-designed `PageShell` component that provides sidebar layout, per-page ErrorBoundary, loading skeleton, and usage-limit banner. However, 68 out of 156 pages (44%) do not use it. These pages must re-implement sidebar layout and error boundaries ad-hoc, or they simply lack them.

Pages like `cash-flow.tsx`, `avm.tsx`, `capital-markets.tsx`, `command-center.tsx` all skip PageShell and implement their own layout (or none). This means no per-page ErrorBoundary, no loading skeleton, and no consistent sidebar margin handling.

**Evidence:**
- 68 pages lack `PageShell` import (confirmed via `grep -L 'PageShell' pages/*.tsx | wc -l`)
- Notable offenders: `cash-flow.tsx`, `avm.tsx`, `borrower-portal.tsx`, `command-center.tsx` (2,259 lines), `field-scout.tsx` (1,422 lines), `marketplace.tsx` (1,208 lines)

**Remediation:** Systematically wrap all protected pages in PageShell. For public pages (auth, landing, borrower-portal, terms, pricing), create a `PublicShell` equivalent. Add a lint rule or architectural test to enforce PageShell usage.

---

### FE-06: Only 9 of 156 Pages Use QueryErrorState
**Severity:** P1
**Description:** A well-crafted `QueryErrorState` component exists with error-type detection, animated UI, and retry support. However, only 9 pages use it: `deals`, `leads`, `properties`, `pax`, `founder-home`, `executive-dashboard`, `finance`, `dashboard`, `onboarding-v2`. The remaining 147 pages either crash silently, show a blank screen, or show a raw spinner on API errors.

Similarly, the `EmptyState` component is used in only 12 pages. Most pages have no zero-data handling.

**Evidence:**
- QueryErrorState usage: 9 pages (grep `QueryErrorState` in `pages/`)
- EmptyState usage: 12 pages (grep `EmptyState` in `pages/`)
- Domain-specific empty states exist for Leads, Properties, Deals, Tasks, Campaigns in `components/empty-states/` but are not widely adopted

**Remediation:** Audit all data-fetching pages. Add QueryErrorState for every `useQuery` error path and EmptyState for every zero-data path. Consider a `usePageQuery` wrapper hook that auto-provides error/empty handling via PageShell's `isLoading` prop.

---

### FE-07: AnimatePresence on Every Route Change Re-mounts All Children
**Severity:** P1
**Description:** The `PageWrapper` component (App.tsx line 677) wraps the entire Router in `AnimatePresence` with `mode="wait"`, keyed on `location`. This means every route change triggers an exit animation, unmount, mount, and enter animation cycle for the entire page tree. Combined with no React.memo anywhere, this causes all child components to re-mount and re-fetch their queries on every navigation. This makes navigation feel slow and wastes API calls.

**Evidence:**
- `/Users/user/AcreOS/AcreOS/client/src/App.tsx` lines 677-694: PageWrapper uses `AnimatePresence mode="wait"` with `key={location}`
- Framer Motion imported in 53 files across the codebase

**Remediation:** Remove the full-page AnimatePresence wrapper or limit it to content areas within PageShell (below the sidebar). Alternatively, use `layoutId` transitions for shared elements rather than wholesale page transitions. At minimum, ensure queries use appropriate `gcTime` and `staleTime` (currently defaults are reasonable at 2-5 min) so re-mounts don't always hit the network.

---

### FE-08: Side-Effects Run Outside useEffect in AppContent
**Severity:** P1
**Description:** `AppContent` (App.tsx lines 738-746) runs localStorage reads, sets localStorage, and creates `setTimeout` calls directly in the render body, outside of any `useEffect`. This code executes on every re-render of AppContent:

```javascript
if (import.meta.env.DEV && typeof window !== 'undefined') {
    const seen = localStorage.getItem('hint_cmdk_shown');
    if (!seen && user) {
      localStorage.setItem('hint_cmdk_shown', '1');
      setTimeout(() => {
        toast({ title: 'Tip', description: '...' });
      }, 800);
    }
  }
```

While the localStorage write prevents repeat execution, the reads still happen on every render, and the pattern is incorrect -- side effects belong in useEffect.

**Evidence:** `/Users/user/AcreOS/AcreOS/client/src/App.tsx` lines 738-746

**Remediation:** Move to a useEffect with `[user]` dependency.

---

### FE-09: `as any` Casts Prevalent in Client Code
**Severity:** P1
**Description:** There are 126 `as any` casts across 59 client-side files, plus 98 occurrences of `data: any` or `: any[]` in pages and 15 in hooks. Notable offenders include `queryClient.ts` (7 casts for ToastAction), `properties.tsx` (12 casts), `field-scout.tsx` (14 casts), and `documents.tsx` (6 casts). The `use-realtime.ts` hook uses `as any` on the useQuery `onSuccess` callback (line 171-176), which is a deprecated TanStack Query v4 pattern that does not work in v5.

**Evidence:**
- 126 `as any` in 59 client files
- 98 `data: any` / `: any[]` in pages
- `/Users/user/AcreOS/AcreOS/client/src/hooks/use-realtime.ts` line 168-176: deprecated `onSuccess` callback cast as `any`
- `/Users/user/AcreOS/AcreOS/client/src/lib/queryClient.ts` lines 39, 45-46: `ToastAction as any`
- `/Users/user/AcreOS/AcreOS/client/src/hooks/use-leads.ts` line 9: `data: any[]`

**Remediation:** Replace `as any` with proper types. Fix the `use-realtime.ts` hook to use the `select` option or a `useEffect` instead of the deprecated `onSuccess`. For `queryClient.ts`, fix the ToastAction type import rather than casting.

---

### FE-10: Service Worker Registration With No Actual Update Strategy
**Severity:** P2
**Description:** `main.tsx` registers `/sw.js` in production, and the file exists in `client/public/sw.js`. However, there is no update notification, no skip-waiting logic, and no stale-while-revalidate strategy visible. Users may be stuck on stale cached versions with no indication that an update is available. The registration also logs to `console.log` in production.

**Evidence:**
- `/Users/user/AcreOS/AcreOS/client/src/main.tsx` lines 10-19
- `/Users/user/AcreOS/AcreOS/client/public/sw.js` exists
- No `navigator.serviceWorker.addEventListener('controllerchange')` or update prompt

**Remediation:** Either implement a proper SW update strategy (check for updates, show "New version available" banner, call `skipWaiting`) or remove the service worker registration entirely if offline support is not a priority.

---

### FE-11: console.log/warn/error in Production Client Code
**Severity:** P2
**Description:** There are 78 `console.log`, `console.warn`, or `console.error` calls across 30 client-side files. While CLAUDE.md only prohibits these in server code, they leak implementation details in production and clutter the console. Several are in hooks that run on every page load (e.g., `use-pwa.ts`, `useOfflineSync.ts`, `use-native-camera.ts`).

**Evidence:**
- 78 occurrences across 30 files
- Key files: `properties.tsx` (5), `leads.tsx` (4), `finance.tsx` (7), `use-native-geolocation.ts` (4), `usePushNotifications.ts` (7)

**Remediation:** Replace with a structured client-side logger that respects environment (silent in production, verbose in development). Or strip console calls with a Vite plugin in production builds.

---

### FE-12: No Manual Chunk Splitting for Large Page Files
**Severity:** P2
**Description:** The Vite config has manual chunks for vendor libraries (react, radix, recharts, mapbox) but no splitting for application code. All 156 lazy-loaded pages produce individual chunks, but large pages like `founder-dashboard.tsx` (7,286 lines, 28 sub-component imports) produce massive chunks. The orientation doc confirms a 382KB founder-dashboard chunk. Pages that import `recharts` (at least `cash-flow.tsx`, `avm.tsx`, `capital-markets.tsx`, `portfolio-pnl.tsx`) will also be heavy.

**Evidence:**
- `/Users/user/AcreOS/AcreOS/vite.config.ts`: only vendor chunks configured
- `chunkSizeWarningLimit: 500` (500KB) -- quite generous
- `founder-dashboard.tsx`: 7,286 lines + 28 sub-component imports
- At least 10 pages import recharts independently

**Remediation:** Add route-group based manual chunks (e.g., `founder-pages`, `finance-pages`). Split the founder dashboard into sub-routes. Lower `chunkSizeWarningLimit` to 200KB and treat violations as build errors.

---

### FE-13: 12 Overlapping Context Providers Mounted at App Root
**Severity:** P2
**Description:** The App component nests 8 context providers (ErrorBoundary, ThemeProvider, SidebarProvider, PaxRailProvider, DynamicIslandProvider, QueryClientProvider, TooltipProvider, HintsProvider, KeyboardShortcutsProvider), and AppContent additionally mounts ~12 conditional floating components when `user` is truthy. Every state change in any of these providers triggers re-renders through the tree. The PaxRailContext `toggle` callback recreates on every render because it depends on `isOpen` state.

**Evidence:**
- `/Users/user/AcreOS/AcreOS/client/src/App.tsx` lines 782-807: 8 nested providers
- `/Users/user/AcreOS/AcreOS/client/src/App.tsx` lines 757-778: 12 conditional floating components
- `/Users/user/AcreOS/AcreOS/client/src/contexts/pax-rail-context.tsx` line 51: `toggle` depends on `isOpen`, causing new function reference on every state change

**Remediation:** Evaluate whether all providers need to be at the app root. Move feature-specific providers (PaxRail, DynamicIsland, Hints) closer to where they are consumed. Fix the `toggle` callback to use a functional updater: `useCallback(() => setOpen(prev => !prev), [setOpen])`.

---

### FE-14: Deprecated TanStack Query v4 Pattern in use-realtime.ts
**Severity:** P2
**Description:** `useNotificationCount` in `use-realtime.ts` uses the `onSuccess` callback in `useQuery` options (line 171), which was removed in TanStack Query v5. The code casts the options object `as any` to suppress the TypeScript error. The app is on `@tanstack/react-query ^5.95.2`, so this callback is silently ignored at runtime -- the notification badge count from the REST fallback never updates.

**Evidence:**
- `/Users/user/AcreOS/AcreOS/client/src/hooks/use-realtime.ts` lines 167-177
- `package.json`: `@tanstack/react-query ^5.95.2`

**Remediation:** Replace `onSuccess` with a `useEffect` that watches `data`:
```typescript
const { data } = useQuery({ queryKey: [...], refetchInterval: 60_000 });
useEffect(() => { if (typeof data?.count === 'number') setCount(data.count); }, [data]);
```

---

### FE-15: Framer Motion Imported in 53 Files Without Tree-Shaking Strategy
**Severity:** P2
**Description:** Framer Motion (v12.38.0) is imported in 53 client files. It is not included in the Vite `manualChunks` config, so it gets duplicated across page chunks or placed in a generic vendor chunk. The library is ~150KB minified. The `animations.ts` lib centralizes variant definitions well, but individual components still import `motion`, `AnimatePresence`, etc. directly from `framer-motion`.

**Evidence:**
- 53 files import from `framer-motion`
- `/Users/user/AcreOS/AcreOS/vite.config.ts`: framer-motion not in manualChunks
- `package.json`: `framer-motion ^12.38.0`

**Remediation:** Add `'framer-motion'` to the `vendor-ui` manual chunk. Consider using `motion/react` (the lighter entry point) or `m` component from framer-motion for reduced bundle. Evaluate whether full page transitions (AnimatePresence) provide enough UX value to justify the bundle cost.

---

### FE-16: White-Label Hook Fetches on Every Page Load Even for Non-White-Label Orgs
**Severity:** P3
**Description:** `useWhiteLabel()` is called unconditionally in AppContent (line 700) for every user, regardless of whether their org has white-label enabled. The hook fetches `/api/white-label/config` on every app load. The 5-minute staleTime prevents rapid re-fetches, but it is still an unnecessary network request for 99%+ of users.

**Evidence:** `/Users/user/AcreOS/AcreOS/client/src/hooks/use-white-label.ts` lines 92-101

**Remediation:** Gate the query behind a feature flag or org property check. Or include white-label config in the initial auth/user response to avoid a separate fetch.

---

### FE-17: useCursorGlass Queries All Glass Elements on Every Mouse Move
**Severity:** P3
**Description:** The `useCursorGlass` hook (App.tsx line 701) attaches a global mousemove listener and, on every frame, runs `document.querySelectorAll` against 4 CSS selectors to find all glass elements. While it uses `requestAnimationFrame` to debounce, the `querySelectorAll` call runs on every mouse move event. On pages with many glass elements, this is wasteful.

**Evidence:** `/Users/user/AcreOS/AcreOS/client/src/hooks/use-cursor-glass.ts` lines 20-22

**Remediation:** Cache the elements list and only re-query on DOM mutations (via MutationObserver) or on route changes. Or use CSS `pointer-events` and `@property` for the effect without JS.

---

### FE-18: Feature Flags Default to "Everything Enabled" While Loading
**Severity:** P2
**Description:** `useFeatureFlags` returns `isRouteEnabled: () => true` while the flags are loading (line 20-21). This means during the initial page load, users briefly see all routes as enabled before the flag response arrives. If a user navigates to a gated route during this window, they will see the page briefly before it potentially disappears or shows NotFound.

**Evidence:** `/Users/user/AcreOS/AcreOS/client/src/hooks/use-feature-flags.ts` lines 19-24

**Remediation:** Return `isRouteEnabled: () => false` while loading (block rather than leak), or show a loading state in `FlaggedRoute` until flags are resolved (which is already partially done on line 276-287 of App.tsx, but only when `flagsLoading` is true -- the hook itself defaults to `true`).

---

## Embarrassment Test

Three things about the current frontend that would embarrass a senior frontend engineer:

1. **47 duplicate routes with conflicting auth guards.** This is not a minor oversight -- it is nearly half the route table declared twice, with the second block completely dead code. Some routes use FlaggedRoute in the first block and ProtectedRoute in the second, meaning the intent is ambiguous. A code reviewer should have caught this immediately. It signals either no code review process or reviewer fatigue from the file's size.

2. **Zero React.memo in a 156-page app on React 18.** Combined with AnimatePresence wrapping the entire router and 75 useState calls in a single component, this means the app re-renders aggressively on every interaction. The absence of memo is not a style choice -- it is a performance gap. On mobile devices (which the orientation doc notes are untested), this will produce visible jank.

3. **Only 9 of 156 pages handle API errors gracefully.** A `QueryErrorState` component exists, is well-designed, and provides contextual error messages with retry -- but 94% of pages ignore it. When the API returns a 500, most pages show an infinite spinner or go blank. This is below the bar for any shipping SaaS product.

---

## Pride Test

Three things that would make a senior frontend engineer proud:

1. **Well-structured custom hooks with consistent patterns.** The 46 custom hooks in `client/src/hooks/` follow consistent naming (`use-*.ts`), use TanStack Query properly with typed responses, centralized cache times, and toast-based error feedback. Hooks like `useLeadsPaginated`, `useDealsPaginated`, and `useInfiniteScroll` demonstrate solid data-fetching architecture with `keepPreviousData`, proper cache invalidation, and paginated cursor support.

2. **Thoughtful error infrastructure.** The error utility layer (`error-utils.ts`, `QueryErrorState`, `ErrorBoundary`, toast-based mutation error handling) is genuinely well-crafted. `QueryErrorState` detects error types (network, auth, server, notFound) and renders appropriate icons and messages. The global QueryClient handles retries with exponential backoff and distinguishes retryable from non-retryable errors. The gap is adoption, not design.

3. **Mature design system foundation.** 53 shadcn/ui primitives, centralized animation variants in `animations.ts`, a `PageShell` component with loading/error boundary support, domain-specific empty states for core entities, `staggerContainer`/`staggerItem` patterns, and consistent use of Tailwind design tokens. The building blocks for a polished UI exist -- they just need to be used consistently.
