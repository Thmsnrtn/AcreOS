# AcreOS Frontend Performance Audit — 2026-05-01

Stack: React 18 + Vite + TanStack Query + wouter + Tailwind. Symptom: "load times super long or just indefinite at points."

---

## 1. Executive Summary

### Top 3 perf wins available (high-impact, low-effort)

1. **Lazy-load the floating-UI chrome.** App.tsx eagerly imports ~6,100 lines of components that render only when authenticated and are rarely used on first paint: `pax-copilot-rail` (1,765 LOC), `onboarding-wizard` (900), `command-palette` (814), `conversation-tray` (628). All four are imported at module-top in App.tsx:23–46. Splitting them into `React.lazy()` should remove ~150–250 KB from the entry chunk and unblock first contentful paint.
2. **Tighten the polling fleet.** 50+ `refetchInterval` sites; 14 fire ≤ 10 s (see §6). Several are mounted globally (conversation-tray, layout-sidebar) so they run on every page even when the user is on, e.g., `/portfolio`. The 5 s interval at `conversation-tray.tsx:270` and 5 s `WorkflowMonitor.tsx:149` and `AgentDebatePanel.tsx:159` keep a steady drip of XHR going.
3. **Split `founder-dashboard.tsx` (7,452 LOC, 75 useStates, 14 `new Date(...)` in render path).** This is one component. It is the founder's home; every render walks the tree. Extracting tab panels into separate `React.lazy()` chunks eliminates the worst bottleneck on the founder side.

### Top 3 chronic issues

1. **Eager root-tree weight.** App.tsx wraps `<Router>` in 9 nested providers (ErrorBoundary → MotionConfig → ThemeProvider → SidebarProvider → PaxRailProvider → DynamicIslandProvider → QueryClientProvider → FeatureFlagsProvider → TooltipProvider → HintsProvider → KeyboardShortcutsProvider) plus 18+ floating components (KeyboardShortcutsModal, NewItemMenu, OnboardingWizard, PWAInstallPrompt, ConversationTray, OfflineIndicator, DealModalsHost, FloatingActionButton, FloatingHelpButton, EarlyAccessBanner, CommandPalette, FounderCommandPaletteProvider, BetaActivationDetector, PaxCopilotRail, DynamicIsland, TrialBanner, NotificationBanner, NpsDialog). Every page pays for all of them.
2. **No `React.lazy()` boundary on `<PaxCopilotRail />`.** It mounts on every authenticated page (App.tsx:1028) and contains 3+ live queries plus framer-motion. It is the single largest globally-mounted component in the app.
3. **Default queryClient cacheTime (`gcTime`) is 5 min.** Combined with `staleTime: 2 min`, navigating away and back within 5 min hits the network again. Tab switching is the founder's main motion; this rate-limits it.

---

## 2. Bundle Splitting Analysis

### App.tsx provider stack (App.tsx:1043–1074)
9 nested providers wrap `<Router>`. Setup order is roughly:
- `ErrorBoundary` → `MotionConfig` → `ThemeProvider` → `SidebarProvider` → `PaxRailProvider` → `DynamicIslandProvider` → `QueryClientProvider` → `FeatureFlagsProvider` → `TooltipProvider` → `HintsProvider` → `KeyboardShortcutsProvider`.

Each is fine individually; cumulative cost is the unbatched re-render risk when state in one parent flips and trickles through children. `PaxRailProvider` and `DynamicIslandProvider` are the highest-risk because their context values are consumed by many descendants.

### Lazy boundaries
**Good:** Every routed page uses `React.lazy()` (App.tsx:55–246). 100+ pages split into chunks. Eagerly imported pages: `AuthPage`, `LandingPage`, `NotFound` (App.tsx:48–51) — correct (these need to render before any chunk loads).

**Bad — eagerly imported "floating" components that ship to every first-paint:**
| Component | LOC | Notes |
|---|---|---|
| `pax-copilot-rail.tsx` | 1,765 | Imports framer-motion, has 3 useQuery hooks, mounts globally |
| `onboarding-wizard.tsx` | 900 | Only relevant for new users, but ships always |
| `command-palette.tsx` | 814 | Only opens on ⌘K — should render on demand |
| `conversation-tray.tsx` | 628 | Polls every 5 s and 10 s, ships always |
| `founder-command-palette` | 289 | Founder-only |
| `notification-banner.tsx` | 237 | Has useQuery, runs always |
| `nps-dialog.tsx` | 186 | 3 s post-load delay — but module ships eagerly |
| `new-item-menu.tsx` | 183 | Only opens via FAB |
| `keyboard-shortcuts.tsx` | 178 | Modal — only needed on ⌘? |
| `dynamic-island.tsx` | 146 | Always mounted |
| `error-boundary.tsx` | 147 | Correctly eager |
| `floating-action-button.tsx` | 139 | Always mounted (correct) |
| `pwa-install-prompt.tsx` | 131 | Always mounted |
| `floating-help-button.tsx` | 99 | Always mounted (correct) |
| `trial-banner.tsx` | 85 | Always mounted, has useQuery |
| `early-access-banner.tsx` | 60 | Always mounted (cheap) |
| `beta-activation-detector.tsx` | 57 | Always mounted (cheap) |

Total eagerly-shipped non-essential UI: **~6,100 LOC** before tree-shaking, of which roughly half is genuinely on-demand surfaces (modals, palettes, founder-only).

### Heavy library imports (module-top vs in-component)
- `recharts` — imported at module-top in 36 files (pages and components). vite.config.ts:46 puts it in `vendor-charts` chunk so it co-loads with any first chart-bearing page rendered. Acceptable.
- `framer-motion` — imported at module-top in 53 files including App.tsx:16 and dynamic-island.tsx:2 (always-mounted). Manual chunk `vendor-motion` exists (vite.config.ts:48). Because it's used in App.tsx itself, the chunk is in the entry critical path on every initial load. Hard to defer; the cost is ~50 KB gz minimum.
- `mapbox-gl` — only `client/src/components/property-map.tsx:2`. Manual chunk `vendor-map` (vite.config.ts:47). Good — only loads on `/maps` and parcel detail.
- `jspdf` — only `client/src/pages/borrower-portal.tsx:19`. Manual chunk `vendor-pdf`. Good.
- No `monaco`, `codemirror`, `three`, `lottie`, `html2canvas`, `qrcode` modules found. Clean.

### Namespace / star imports
Reviewed top hits (`grep "import \* as"`); all are either `import * as React` (idiomatic) or radix primitive re-exports (`AlertDialogPrimitive`, `RechartsPrimitive`, etc.). Tree-shakable. **No bloat from namespace imports.**

### Vite chunking
vite.config.ts:24–55 has a sensible `manualChunks` already: `vendor-react`, `vendor-ui`, `vendor-charts`, `vendor-map`, `vendor-motion`, `vendor-pdf`, `vendor-sanitize`, `vendor-clerk`, `vendor-date`. Gap: **no `vendor-icons` chunk for `lucide-react`**, which is imported in basically every component. Lucide is per-icon tree-shaken at the named-import level, but a manual chunk would let the browser cache it across page nav.

---

## 3. Initial-Load Critical Path

Every page (after auth) renders this tree, in order:
```
ErrorBoundary
  MotionConfig
    ThemeProvider          (theme-context.tsx — applies CSS vars to <html>)
      SidebarProvider
        PaxRailProvider
          DynamicIslandProvider
            QueryClientProvider
              FeatureFlagsProvider  (useFeatureFlags hook fires /api/feature-flags)
                TooltipProvider
                  HintsProvider
                    KeyboardShortcutsProvider
                      OfflineIndicator
                      Toaster
                      CookieConsentBanner
                      <AppContent>
                        EarlyAccessBanner    (if user)
                        TrialBanner          (if user, useQuery /api/billing/trial, refetchInterval 60s)
                        <Router>             (Suspense boundary, then route page)
                        FloatingActionButton (if user)
                        ConversationTray     (if user — useQuery x3, refetchInterval 5s + 10s)
                        FloatingHelpButton   (if user)
                        CommandPalette       (if user — 814 LOC)
                        FounderCommandPaletteProvider
                        NewItemMenu          (if user)
                        MobileBottomNav      (if user)
                        OnboardingWizard     (if user — 900 LOC, useQuery /api/onboarding/status)
                        BetaActivationDetector
                        PaxCopilotRail       (if user, NOT on /ai — 1,765 LOC, 3 useQuery)
                        DynamicIsland
                        NotificationBanner   (if user — useQuery)
                        NpsDialog            (if user, conditional)
                        PWAInstallPrompt
                      KeyboardShortcutsModal
                      DealModalsHost
```

**Estimated rough costs (gz, before route chunk loads):**
- React + react-dom + wouter + tanstack: ~50 KB (vendor-react chunk)
- Radix UI primitives (vendor-ui): ~40 KB
- framer-motion (used by App.tsx + dynamic-island): ~50 KB
- Clerk (vendor-clerk): ~80 KB
- date-fns: ~10 KB (tree-shaken, but still always-on)
- lucide-react (icons across always-mounted UI): ~15–25 KB
- App.tsx + AppContent + always-mounted floating components: ~80–120 KB
- **Estimated initial JS download (entry only) before route chunk: ~325–375 KB gz**

The route chunk for, e.g., `founder-dashboard` adds **easily another 150–300 KB** because of its size and recharts dependency.

**Practical implication:** on a cold load over a slow connection, the user pays ~500 KB before the first useful pixel. Then the API queries fire (often 5–10+ in parallel for the dashboard) and React must reconcile a 7,452-line component. The "indefinite load" symptom is consistent with this profile.

---

## 4. Re-render Hotspots

### A. Globally-mounted polling components

`client/src/components/conversation-tray.tsx:270` — `refetchInterval: 5000` for messages. Mounted on every authenticated page via App.tsx:1015. If the user has any active conversation, this is a network request every 5 s for the entire session.

`client/src/components/conversation-tray.tsx:468` — `refetchInterval: 10000` for conversation list. Also global.

`client/src/components/pax-copilot-rail.tsx:356, 363, 382` — 3 useQuery hooks. The component itself is 1,765 LOC and sits in App.tsx:1028 unless on `/ai`. Each query that resolves triggers a re-render of the whole rail subtree.

### B. Founder-dashboard

`client/src/pages/founder-dashboard.tsx` — 7,452 LOC, **75 useState** hooks, **43 useQuery**, 14 `new Date(...)` calls in render path. Almost certainly:
- Re-renders every state change touch the entire tree (no `React.memo` boundaries between tab panels).
- Tab switching re-runs effects that haven't been deduplicated.
- `new Date()` inside render produces new objects each time, defeating `React.memo` on any child that takes "now" as a prop.

Specific instances at founder-dashboard.tsx:1198, 1203, 1210 — inline `?? {}` fallbacks return a *new* empty object on every render. Children memoized on those props will never hit cache.

### C. PageWrapper key

`App.tsx:925–943` — `<motion.div key={location}>` inside `<AnimatePresence mode="wait">`. Every navigation forces an unmount + animated remount. On large pages (founder-dashboard) this remount is the perceived "loading" delay, even though the data may already be cached.

### D. NPS query in App.tsx:957
`useQuery({ queryKey: ["/api/nps/pending"], enabled: !!user, staleTime: 5*60*1000 })` — fires on every authenticated page mount (5 min stale). Light, but it's another always-on network call that delays browser idle.

### E. Theme-context effects

`client/src/contexts/theme-context.tsx` — has 7 `useEffect` blocks (lines 154, 185, 197, 204, 209, 214, 219) plus a setTimeout patch (line 243). Most apply CSS variables to `document.documentElement`. Risk: a state change in any of the watched values restyles the whole app.

---

## 5. queryClient Config Review

Current (`client/src/lib/queryClient.ts:284–319`):

```ts
defaultOptions: {
  queries: {
    queryFn: getQueryFn({ on401: "throw" }),
    refetchInterval: false,
    refetchOnWindowFocus: false,
    staleTime: STALE_TIMES.medium,    // 2 min
    gcTime: CACHE_TIMES.medium,        // 5 min
    retry: ...,
    retryDelay: ...,
  },
  ...
}
```

**Findings:**
- `staleTime: 2 min` — fine for most data. Reasonable.
- `gcTime: 5 min` — too aggressive. Tabbing away to inbox, talking to a customer, returning to founder-dashboard 6 min later → all queries refetch from scratch.
- `refetchOnWindowFocus: false` — good (matches behavior chosen).
- `refetchOnReconnect` — not set; defaults to true. Fine.
- No `refetchOnMount` override — fine (defaults to true if stale).

**Proposed diff:**

```diff
 defaultOptions: {
   queries: {
     queryFn: getQueryFn({ on401: "throw" }),
     refetchInterval: false,
     refetchOnWindowFocus: false,
-    staleTime: STALE_TIMES.medium,    // 2 min
-    gcTime: CACHE_TIMES.medium,        // 5 min
+    // Keep data "fresh" for 2 min — pages don't refetch on remount.
+    staleTime: STALE_TIMES.medium,
+    // Keep cached data in memory for 30 min so tab-switching is instant.
+    // Memory cost is bounded by React Query's own LRU; founder dashboards
+    // benefit most from this.
+    gcTime: 1000 * 60 * 30,
     retry: ...,
   },
 }
```

If memory is a concern on long sessions, raise `gcTime` to 15 min instead of 30. The current 5 min is too short.

---

## 6. Polling / Interval Audit

### Sub-30-second polling (network noise)
| File:Line | Interval | Always-on? | Notes |
|---|---|---|---|
| `conversation-tray.tsx:270` | 5 s | Yes (App.tsx:1015) | Messages — high cost |
| `conversation-tray.tsx:468` | 10 s | Yes | Conversation list |
| `founder/WorkflowMonitor.tsx:149` | 5 s | No (founder page) | OK if scoped |
| `founder/AgentDebatePanel.tsx:159` | 5 s | No | OK |
| `founder/ScenarioEngine.tsx:152` | 5 s | No | OK |
| `hooks/use-agent-tasks.ts:13` | 5 s | Wherever consumed | Hook — verify call sites |
| `due-diligence-panel.tsx:109` | 3 s | Conditional (`shouldPollDossier`) | OK |
| `founder/WarRoom.tsx:113` | 3 s | Conditional (`status === active`) | OK |
| `pages/founder-preview.tsx:185` | 250 ms | Page-only | Clock tick — fine |
| `founder/FounderTwin.tsx:140` | 10 s | Founder page | OK |
| `team-general-channel.tsx:53` | 10 s | Wherever rendered | Verify |
| `founder/WorkflowMonitor.tsx:143` | 10 s | Founder page | OK |
| `founder/WarRoom.tsx:231` | 10 s | Founder page | OK |
| `sms-conversation.tsx:37` | 15 s | Page-scoped | OK |

### Always-on but ≥ 30 s (acceptable but cumulative)
- `layout-sidebar.tsx:161` — 2 min, sidebar data
- `layout-sidebar.tsx:694` — 60 s
- `notification-center.tsx:83` — 30 s
- `trial-banner.tsx:18` — 60 s (App.tsx:1004)

### setInterval leaks worth checking
- `client/src/lib/clerk-session-recovery.ts:161` — `setInterval(..., 30_000)` with no clear cleanup; this is module-level so it's "by design", but if HMR re-imports it during dev, intervals stack. Verify cleanup if observed.
- `client/src/hooks/useOfflineSync.ts:307` — `const interval = setInterval(...)`; check that effect returns `clearInterval` cleanup.
- `client/src/components/skip-trace-panel.tsx:67` — `interval = setInterval(...)`; verify it's cleared on success / unmount.
- `client/src/pages/avm-bulk.tsx:59` — progress interval; verify cleanup on success.

---

## 7. Asset / Hydration Issues

### Images without explicit dimensions (CLS risk)
- `client/src/components/content-generation.tsx:114` — h-20 w-20 via Tailwind class only (no `width`/`height` attrs). Class enforces size, so fine in practice — but no `loading="lazy"` either.
- `client/src/components/property-map.tsx:3253, 3287` — `<img>` tags, no width/height.
- `client/src/pages/settings.tsx:1886` — QR code image, fixed Tailwind size.
- `client/src/pages/reseller-dashboard.tsx:561, 672` — logo previews; rely on Tailwind sizing.
- `client/src/pages/founder-dashboard.tsx:5728` — generated images.

In all cases Tailwind classes enforce a fixed box, so layout shift is bounded. Adding `width` and `height` HTML attributes would still help the browser pre-allocate space before CSS resolves.

### Layout shift from charts
175 `ResponsiveContainer` usages. Recharts computes height after measuring the parent — content below chart-heavy panels (analytics, forecasting, founder-dashboard) shifts when data lands. Wrap each chart in a fixed-height container (already done in many places, but verify on the dashboards).

### Theme FOUC
`client/src/contexts/theme-context.tsx` applies CSS vars in a `useEffect` (line 154+). On initial paint the document has the default theme; if the user has chosen a different theme, the page repaints once the effect runs. Mitigation: write a tiny inline `<script>` in `client/index.html` that reads `localStorage` for theme and sets a class on `<html>` before React mounts. This is the standard "no-flash" pattern.

---

## 8. Quick Wins (≤ 30 min each, ranked by impact)

1. **(20 min) Lazy-load `CommandPalette`, `OnboardingWizard`, `NewItemMenu`, `KeyboardShortcutsModal`.** All four are interaction-gated (⌘K, first-run, FAB, ⌘?). Replace the eager imports in App.tsx:23–26 with `React.lazy()` and wrap them in `<Suspense fallback={null}>`. Removes ~2,100 LOC from the entry chunk. **Impact: high** — directly cuts initial JS.
2. **(10 min) Bump `gcTime` from 5 min to 30 min in queryClient.ts:297.** One-line change, makes tab-switching feel instant. **Impact: high.**
3. **(15 min) Raise `conversation-tray.tsx:270` polling from 5 s to 15 s, and `:468` from 10 s to 30 s.** Or move both behind "tray is open" so polling pauses while collapsed. **Impact: medium** (12× reduction in always-on requests).
4. **(15 min) Add a `vendor-icons` manual chunk for `lucide-react` in vite.config.ts:25.** Lets browser cache icon code across navigation. **Impact: low–medium.**
5. **(20 min) Pre-set the theme class via inline script in `client/index.html`** to prevent theme FOUC. **Impact: medium** (perceived load time).
6. **(15 min) Lazy-load `PaxCopilotRail`** with `React.lazy()`, keeping a placeholder div with a fixed width. The 1,765 LOC + 3 queries are deferred until after first paint. **Impact: very high** — single biggest always-on component.
7. **(10 min) Remove the ⌘K dev tip useEffect in App.tsx:988–996.** It runs on every render of `AppContent` in DEV. Cheap, but it's executing localStorage and starting a setTimeout each mount.
8. **(10 min) Audit `founder-dashboard.tsx:1198, 1203, 1210` for `?? {}` inline fallbacks.** Hoist to module-level `const EMPTY = {}` so memoized children stop invalidating.
9. **(20 min) Replace `<motion.div key={location}>` page-transition (App.tsx:925) with a `key`-less variant for routes.** The remount is cosmetic and on large pages is a perceived stall. **Impact: medium** — cuts the "page reloads visually" feeling.

## 9. Multi-Hour Projects Worth Scheduling

1. **Split `founder-dashboard.tsx` (7,452 LOC) into per-tab lazy chunks (~6 hr).** Each tab becomes its own `React.lazy()` import. The shell stays small; only the active tab's code runs. Likely halves the founder TTI. Add `React.memo` boundaries between unrelated tab panels.
2. **Move global polling into a single coordinator (~3 hr).** Today, conversation-tray, layout-sidebar, notification-center, trial-banner, NotificationBanner, and the NPS check each fire their own queries. Replace with one "session refresh" query that returns `{ unreadMessages, unreadConversations, trialStatus, alerts, npsPending }` and have each component select its slice. One request per N seconds instead of 5–6.
3. **Codemod inline-literal props in long lists (~4 hr).** Pages like `leads.tsx` (2,740 LOC), `inbox.tsx` (1,208 LOC), `today.tsx` (1,391 LOC) very likely pass new objects/arrays every render to `<Table>` / virtualized list children. Targeted `useMemo` + `React.memo` rewrites on the row component would eliminate scroll jank.
4. **Batch the 5–10 useQuery storms on founder-dashboard and today (~3 hr).** Today.tsx has 13 `useQuery` calls (including ones at lines 219, 223, 227, 234, 240, 246, 252, 259, 305, 309, 313, 349). On a cold cache that's 13 sequential auth-validated requests. Add a single `/api/today/bootstrap` endpoint that returns all of them, plus a TanStack `select()` per consumer.
5. **Replace recharts on dashboard widgets (~6 hr).** Recharts at 175 callsites is a significant runtime cost. For simple sparklines and bar charts, a custom SVG component is 1–2 KB instead of pulling in the recharts/d3 chunk. Save recharts for the genuine analytics pages.
6. **Add a service-worker precache + route-chunk preload (~4 hr).** main.tsx:18–27 already registers an SW, but it doesn't precache route chunks. With route prefetching driven off `useNextRoutePrefetch`, also `<link rel="modulepreload">` the next-likely route's chunk so transitions are instant.

---

## File index (key citations)

- `client/src/App.tsx:23–46` — eagerly imported floating components
- `client/src/App.tsx:55–246` — lazy page boundaries (good)
- `client/src/App.tsx:925–943` — PageWrapper key-based remount
- `client/src/App.tsx:957` — global NPS useQuery
- `client/src/App.tsx:1043–1074` — 9-deep provider stack
- `client/src/lib/queryClient.ts:284–319` — default config (raise gcTime)
- `client/src/components/pax-copilot-rail.tsx` — 1,765 LOC, mounted on every page
- `client/src/components/conversation-tray.tsx:270, 468` — 5 s / 10 s polling, mounted globally
- `client/src/components/onboarding-wizard.tsx` — 900 LOC, eager
- `client/src/components/command-palette.tsx` — 814 LOC, eager
- `client/src/pages/founder-dashboard.tsx` — 7,452 LOC, 75 useStates, 43 useQuery
- `client/src/pages/today.tsx` — 13 useQuery on first paint
- `vite.config.ts:24–55` — manual chunks (good base; missing icons chunk)
- `client/src/contexts/theme-context.tsx` — theme applied in effect, FOUC risk
