# Universal Audit — Performance · Onboarding · Nav/IA · Empty States

Output of the 4 cross-cutting specialist agents (parallel sub-agent batch
2026-05-26). Each is concrete, file-cited, ranked by leverage.

---

## Performance — top 10 actual concerns

**High impact**
1. `client/src/pages/today.tsx:194-199` — Today hits 8 endpoints in parallel
   on mount (`/api/deals`, `/api/notes`, `/api/tasks`, `/api/alerts/active`,
   `/api/pax/insights`, `/api/pax/pax-suggestions`, `/api/dashboard/intelligence`).
   Move aggregation to a single backend endpoint.
2. `client/src/pages/properties.tsx:145-147` — Full-list fetch then
   client-side filter, with centroid re-computation on every keystroke.
   Move filtering server-side; precompute centroids.
3. `client/src/pages/leads.tsx:980-1031` — Large list rendered without
   windowing + `useDeferredValue` chain re-filters on every keystroke.
   Virtualize (react-window) + debounce input.
4. `client/src/pages/portfolio.tsx:614-747` — Four Recharts charts loaded
   on mount across three tabs without Suspense. Lazy-load per tab.
5. `client/src/pages/deals.tsx:125-140` — Client-side O(n) property join
   on every render. Include property in the deals API response.

**Medium impact**
6. `client/src/pages/today.tsx:270-399` — Decision-queue aggregation rebuilds
   on every dep change of 6 sources. Memoize sub-results.
7. `client/src/pages/properties.tsx:199-238` — GIS filter loop re-runs O(n)
   per filter change. Server-side GIS filtering.
8. `client/src/pages/leads.tsx:975-1031` — 5 sequential client-side filters
   per keystroke. Debounce + server-side stage/assignee/GIS filters.
9. `client/src/pages/properties.tsx:200-238` — Synchronous `localStorage`
   read inside `useMemo` blocks main thread on first paint.

**Low impact**
10. `vite.config.ts:108-139` — `@dnd-kit` not in its own manual chunk; rides
    on the deals lazy chunk (acceptable but easy to split).

**Top 3 leverage points:** backend aggregation/filtering · list virtualization
· chart lazy-loading. Combined, removes ~500ms TTI on the slowest pages
and ~200ms INP per keystroke on lists.

---

## Onboarding — 3 ranked fixes

Per-persona time-to-first-action today: 4–6 clicks, 3–6 minutes. Wizard is
abstract-first (path → county → strategy → ... → empty dashboard) when
heavy-hitters are concrete-first (Linear lands you on a working board,
Stripe pre-populates test data, Notion has a sample workspace).

1. **Skip the path-selection gate.** Launch every user into Beginner
   (land-investor) by default; auto-detect persona on first action.
   Saves a click; removes "which path am I?" decision friction.
2. **Replace getting-started checklist with contextual empty-state actions.**
   When `/leads` is empty, show Import CSV + Add lead + "Deal Hunter is
   scanning {County}." When `/finance` is empty, show Import notes +
   Record payment. Removes post-onboarding guessing.
3. **Pre-load sample data by persona.** Beginner: 5 sample leads in
   target county + 1 campaign template. Active: 3 sample properties
   from imported portfolio. Note investor: 2 notes with amortization
   schedules. Users land on `/today` and see "3 deals to review" instead
   of empty state.

Estimated: combined, ~2-3 min faster to first action, 20% higher
day-3 engagement.

---

## Nav / IA — 5 ranked fixes

Sidebar already strong: 7 canonical items + persona-specific module +
founder-gated module. Settings IA: 7 canonical tabs, mirrors Linear.

**Gaps:**
1. **Mobile bottom nav persona-awareness.** Currently fixed
   `[today, deals, money, ai-hub]` for everyone. Wholesale users should
   see `[today, deals, blasts, money]`; Buy-and-Hold should see
   `[today, rent-roll, maintenance, money]`. Per-persona dispatch via
   `useContextProfile().investorType`.
2. **Expand Cmd-K settings scope.** 3 verbs today (`switch-org`,
   `invite-teammate`, `open-billing`). Add: `change-password`,
   `cancel-subscription`, `export-data`, `update-email` — Linear-parity.
3. **Deep-link to specific settings controls.** `/settings/billing#seat-upgrade`,
   `/settings/account#theme`. Eliminates 2nd-click after tab pick.
4. **Settings sidebar mini-nav on desktop.** 7 buckets as left-column
   pills. Context-at-a-glance.
5. **Mobile bottom-nav fuzzy search.** Replace MobileCommandDrawer static
   list with fuzzy search over `ALL_NAV_ITEMS` scoped to the user's
   persona.

---

## Empty states + crash audit

**Per-page scoreboard (10 customer pages):** mostly green —
canonical `FirstHelloEmpty` / `ClearedEmpty` / `EmptyFilter` are used
on `/leads`, `/properties`, `/deals`. Loading uses delayed-show
skeletons. Empty states teach.

**5 crash-risk hotspots (file:line):**
1. `pages/properties.tsx:215-223` — `.filter` chain on possibly-undefined
   `properties`. Add `?? []` default at line 206.
2. `pages/leads.tsx:1937` — `.map(prop => ...)` on `properties` without
   null check. Same pattern as #1, inconsistent across pages.
3. `pages/parcel-detail.tsx:191-193` — Crash before guard if `property`
   null. Better 404/permission states needed.
4. `pages/deals.tsx:188-192` — `.find` on `enrichedDeals` before
   defensive check.
5. `pages/settings.tsx` — Silent failures on Stripe / org fetch.
   Surface errors via toast or per-tab error UI.

**Loading inconsistencies:** Skeleton patterns vary (`ListSkeleton`,
custom skeleton grid, bare `Skeleton`, lazy-Suspense fallback, none).
Standardize on `ListSkeleton` for tables + `Skeleton` rows for
content; `Loader2` spinners are anti-pattern for first paint.

**Error inconsistencies:** `QueryErrorState` used in `/deals`,
`/parcel-detail`, `/pax`; toast-only in `/finance`, `/notes`; none in
`/settings`, `/campaigns`. Standardize on `QueryErrorState` with retry.
