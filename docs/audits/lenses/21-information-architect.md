# Lens 21 -- Information Architect

Auditor: Information Architecture Specialist
Date: 2026-04-15
Scope: Navigation structure, route organization, content hierarchy, naming conventions, feature discoverability

---

## Executive Summary

AcreOS has 140 unique route paths and 156 React page files, but only 30 routes are
reachable from the sidebar and 24 from the command palette. That means **76 user-facing
routes are discoverable from neither the sidebar nor the command palette** -- they exist
as hidden pages accessible only by typing a URL directly. The router in `App.tsx` also
contains ~39 duplicate route declarations with conflicting protection levels and at least
one conflicting redirect target. The breadcrumb component exists in the UI library but is
imported by zero pages. There is no back-navigation pattern and no breadcrumb trail
anywhere in the application.

---

## Findings

### F21-01 -- 76 routes unreachable from primary navigation (P1)

**Files:** `client/src/App.tsx`, `client/src/components/layout-sidebar.tsx`, `client/src/components/command-palette.tsx`

The sidebar exposes 30 routes. The command palette exposes 24 routes. Together they cover
only 33 unique routes out of 109 authenticated non-admin user-facing routes. The remaining
76 routes include important user-facing features:

- `/tasks` -- Task management (no sidebar entry, not in command palette)
- `/today` -- The default authenticated landing page (not a sidebar entry; sidebar uses `/` which redirects to it)
- `/money` -- Financial overview hub (not in sidebar despite being a DEFAULT_MOBILE_ITEMS target)
- `/pipeline` -- Pipeline hub page (not in sidebar; exists only in mobile nav defaults)
- `/offers` -- Offer tracking (not in sidebar, not in command palette)
- `/team-dashboard`, `/team-inbox`, `/team-leaderboard`, `/team-kpi`, `/commissions` -- The entire Team module
- `/automation`, `/workflows` -- Automation engine (sidebar has no entry)
- `/bookkeeping`, `/closing-costs`, `/depreciation`, `/property-tax`, `/exchange-1031`, `/tax-optimizer`, `/tax-delinquent` -- Finance sub-tools (none in sidebar)
- `/forecasting`, `/portfolio-health`, `/portfolio-pnl`, `/portfolio-optimizer` -- Portfolio analytics
- `/goals` -- Goals and OKRs
- `/webhooks`, `/usage` -- Settings sub-pages
- `/ab-tests` -- A/B testing (not in sidebar; only accessible via hash route on Campaigns)
- `/zoning`, `/title-search`, `/property-enrichment`, `/skip-tracing` -- Property research tools
- `/market-watchlist`, `/deal-feed`, `/deal-patterns`, `/deal-underwriting`, `/seller-intent`, `/price-optimizer` -- Intelligence features
- `/evening-review` / `/night-cap` -- End-of-day review

Users must know the exact URL to access these features. No in-app link or menu reveals them.

### F21-02 -- 39 duplicate route declarations with inconsistent protection (P1)

**File:** `client/src/App.tsx`

The `Router` component defines routes in two separate blocks. The first block (lines ~310-540)
uses a mix of `ProtectedRoute` and `FlaggedRoute`. The second block (lines ~544-670) re-declares
many of the same paths using plain `ProtectedRoute`, bypassing feature flags. Since `wouter`'s
`<Switch>` renders the first match, the second block is dead code -- but it creates confusion
about which protection level is intended and makes maintenance error-prone.

Duplicate paths detected (39 total): `/inbox`, `/campaigns`, `/finance`, `/portfolio`, `/cash-flow`,
`/capital-markets`, `/avm`, `/radar`, `/negotiation`, `/deal-hunter`, `/vision-ai`, `/land-credit`,
`/market-intelligence`, `/document-intelligence`, `/tax-researcher`, `/command-center`, `/maps`,
`/automation`, `/workflows`, `/tools`, `/syndication`, `/team-dashboard`, `/team`, `/analytics`,
`/settings`, `/settings/email`, `/settings/mail`, `/help`, `/support`, `/founder`, `/founder/ai-observatory`,
`/founder/feature-flags`, `/founder/agents`, `/founder/daily-digest`, `/executive-dashboard`,
`/admin/beta`, `/admin/safety-gates`, `/admin/decisions`, `/admin/ops`, plus others.

### F21-03 -- Conflicting redirect for `/founder` (P1)

**File:** `client/src/App.tsx`, lines 448-449 and 640

The first declaration redirects `/founder` to `/founder-dashboard`. The second (dead code)
redirects `/founder` to `/founder-home`. These are different pages. If the first declaration
were ever removed, the redirect target would silently change.

### F21-04 -- Breadcrumb component exists but is never used (P2)

**File:** `client/src/components/ui/breadcrumb.tsx`

A full Breadcrumb component set (`Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`,
`BreadcrumbLink`, `BreadcrumbPage`, `BreadcrumbSeparator`, `BreadcrumbEllipsis`) is defined
but imported by zero pages. With 140 routes and deeply nested content (e.g., a specific
deal inside deals, a property inside properties), there is no way for users to understand
where they are in the hierarchy or navigate upward.

### F21-05 -- No back-navigation pattern (P2)

**Files:** `client/src/components/page-shell.tsx`, `client/src/App.tsx`

There is no programmatic back-navigation. No page implements a "Back to [parent]" link.
The `PageShell` component provides sidebar + main content but no breadcrumb or back button.
The only way to navigate backward is the browser back button or clicking a sidebar item.
Pages like `/settings/email` have no visible path back to `/settings`.

### F21-06 -- Mobile bottom nav silently loses "Pax" item (P1)

**Files:** `client/src/lib/nav-items.ts` (lines 104-105), `client/src/hooks/use-nav-preferences.ts`, `client/src/components/mobile/MobileBottomNav.tsx`

`DEFAULT_MOBILE_ITEMS` is `["today", "pipeline", "money", "pax"]`, but `ALL_NAV_ITEMS` has
no entry with `id: "pax"` (the correct ID is `"ai-hub"`). The validation logic in
`use-nav-preferences.ts` filters out unrecognized IDs, so `"pax"` is silently dropped.
This means first-time mobile users get only 3 bottom nav items instead of the intended 4.
The AI Hub -- a marquee feature -- is missing from the mobile nav bar.

Similarly, `DEFAULT_SIDEBAR_ITEMS` includes `"pax"` and loses it, leaving 4 of 5 intended
items. This affects the customizable sidebar feature.

### F21-07 -- URL structure is flat and inconsistent (P2)

**File:** `client/src/App.tsx`

140 routes are almost entirely flat (single segment), with nesting used only for
`/settings/*`, `/founder/*`, `/admin/*`, and `/portal/*`. Logically related features use
prefix-dash naming instead of hierarchy:

- `/team-dashboard`, `/team-inbox`, `/team-kpi`, `/team-leaderboard` -- should be `/team/*`
- `/portfolio-health`, `/portfolio-optimizer`, `/portfolio-pnl` -- should be `/portfolio/*`
- `/market-intelligence`, `/market-watchlist`, `/market-data` -- should be `/market/*`
- `/deal-feed`, `/deal-hunter`, `/deal-patterns`, `/deal-underwriting` -- should be `/deals/*`
- `/tax-optimizer`, `/tax-delinquent`, `/tax-researcher` -- should be `/tax/*`
- `/avm-bulk` -- should be `/avm/bulk`
- `/syndication-status` -- should be `/syndication/status`

This makes the URL bar uninformative for wayfinding. A user at `/portfolio-pnl` cannot
tell they are in the Portfolio section or navigate to `/portfolio` by editing the URL.

### F21-08 -- Naming confusion: multiple names for the same concept (P2)

**File:** `client/src/App.tsx`

Several features use multiple URL aliases or inconsistent naming:

| Concept | URLs | Notes |
|---------|------|-------|
| Evening Review | `/night-cap`, `/evening-review` | Two paths, same component. "Night cap" is internal jargon |
| Team Inbox | `/team`, `/team-inbox` | Both map to `TeamInboxPage` |
| Dashboard / Today | `/`, `/today`, `/dashboard` | Three paths for the same view |
| AI Hub | `/ai`, `/pax`, `/agents`, `/ai-team`, `/command-center`, `/agent-command-center` | Six paths; four are redirects |
| Founder home | `/founder`, `/founder-home`, `/founder-dashboard` | Three paths, redirect conflicts |

Users who share URLs or bookmark pages may land on different aliases, creating confusion
and preventing consistent analytics.

### F21-09 -- Command palette references deprecated Academy page (P2)

**File:** `client/src/components/command-palette.tsx`, line 131

The command palette lists `{ name: "Academy", path: "/academy" }` but the Academy feature
is deprecated (comments in `App.tsx` confirm: "AcademyPage removed -- Academy feature
deprecated"). Selecting it from the command palette navigates to a route that will 404.

### F21-10 -- 67 pages do not use PageShell; inconsistent layout (P2)

**Files:** `client/src/components/page-shell.tsx`, various pages

Only 89 of 156 pages use the `PageShell` component (which provides sidebar, error boundary,
and consistent spacing). The remaining 67 pages either:

- Have no layout at all (e.g., `cash-flow.tsx` renders content directly with no sidebar)
- Use a different sidebar system (`campaigns.tsx` imports from `@/components/ui/sidebar`,
  a separate shadcn component, not the app's `layout-sidebar.tsx`)
- Are public pages where no layout is expected (auth, landing, terms, privacy)

For the ~40+ authenticated pages that skip PageShell, users lose the sidebar navigation
entirely and must use the browser back button to return to the main app. This is
especially problematic on pages like:

- `/campaigns` -- Core CRM feature, uses its own sidebar
- `/cash-flow` -- Finance tool, no sidebar at all
- `/market-intelligence`, `/compliance`, `/tax-researcher` -- AI features with no sidebar
- `/inbox` -- Communication hub, no sidebar
- `/avm`, `/avm-bulk` -- Valuation tool, no sidebar

### F21-11 -- `/market-data` route has no authentication protection (P1)

**File:** `client/src/App.tsx`, lines 537-539

```tsx
<Route path="/market-data">
  {() => <MarketDataPage />}
</Route>
```

This route renders `MarketDataPage` directly without `ProtectedRoute`, `FlaggedRoute`, or
`FounderProtectedRoute`. Any unauthenticated visitor can access it. This is likely a bug
rather than intentional public access, since all other data pages are protected.

### F21-12 -- Sidebar and command palette define navigation independently (P2)

**Files:** `client/src/components/layout-sidebar.tsx` (NAV_MODULES), `client/src/components/command-palette.tsx` (pages array), `client/src/lib/nav-items.ts` (ALL_NAV_ITEMS)

There are three independent navigation registries:

1. `NAV_MODULES` in `layout-sidebar.tsx` -- 30 items, defines sidebar
2. `pages` array in `command-palette.tsx` -- 24 items, defines command palette
3. `ALL_NAV_ITEMS` in `nav-items.ts` -- 47 items, defines mobile nav and customizable nav

These are not derived from a single source. Adding a new feature requires updating up to
three separate files. Discrepancies are inevitable (and already exist: the command palette
includes Academy but not Tasks; the sidebar includes Compliance but not Workflows; the
nav-items list includes Sovereign pages but neither sidebar nor command palette do).

### F21-13 -- Founder dashboard is a 7,286-line monolith with tab navigation (P2)

**File:** `client/src/pages/founder-dashboard.tsx`

The founder dashboard contains 5 tabs (Overview, Agents, Operations, Growth, Infrastructure)
in a single 7,286-line file. Tab state is stored in localStorage rather than the URL, so:

- Tabs are not linkable (no `/founder-dashboard?tab=agents` or hash-based routing)
- Browser back button does not navigate between tabs
- Sharing a link to a specific tab is impossible
- Content within each tab is not separately addressable

Meanwhile, separate pages like `/founder/agents`, `/founder/ai-observatory`,
`/founder/daily-digest` exist as independent routes, creating ambiguity about where
founder features actually live.

### F21-14 -- Sidebar "Dashboard" links to `/` not `/today` (P3)

**File:** `client/src/components/layout-sidebar.tsx`, line 279

The sidebar "Dashboard" item links to `/` which, for authenticated users, renders `HomeRoute`
which redirects to `/today`. This causes an unnecessary client-side redirect on every
click. More importantly, the active-state highlighting uses `location === "/"` so the
Dashboard item does not highlight when the user is on `/today` (the actual resolved page).

### F21-15 -- No feature grouping headers in sidebar (P3)

**File:** `client/src/components/layout-sidebar.tsx`

The sidebar NAV_MODULES has inline comments organizing items into groups (Core, Outreach,
Intelligence, Finance, Settings) but the rendered sidebar shows no visual group separators
or section headers. All 10+ top-level items appear as an undifferentiated flat list.
Collapsible sub-items provide some hierarchy, but the major functional areas
(CRM vs Intelligence vs Finance) are not visually delineated.

### F21-16 -- Hash-based sub-navigation is not reflected in sidebar (P3)

**File:** `client/src/components/layout-sidebar.tsx`, line 355

The Intelligence section includes `{ label: "Cohort Retention", href: "/analytics#retention" }`
which uses a hash fragment to navigate within the Analytics page. The sidebar `isRouteActive`
function (line 544) checks `location === href || location.startsWith(href + "/")` which
does not account for hash fragments. This means the "Cohort Retention" child item can never
show an active state, even when the user is viewing the retention section of analytics.

### F21-17 -- Feature flags create invisible routes without feedback (P3)

**Files:** `client/src/App.tsx` (FlaggedRoute), `client/src/components/layout-sidebar.tsx` (visibleModules filter)

When a feature flag disables a route, `FlaggedRoute` renders `<NotFound />` and the sidebar
hides the item entirely. There is no messaging like "This feature is not available on your
plan" or "Coming soon." The user simply gets a 404, with no indication the feature exists
or how to enable it.

---

## Route Coverage Matrix

| Navigation Surface | Routes Exposed | Coverage |
|--------------------|---------------|----------|
| Sidebar (NAV_MODULES) | 30 | 22% of 140 |
| Command Palette | 24 | 17% of 140 |
| Mobile Bottom Nav | 3 (due to "pax" bug) | 2% of 140 |
| Combined (deduplicated) | ~33 | 24% of 140 |
| Floating Action Button | 6 quick actions | N/A (actions, not pages) |

---

## Severity Summary

| Severity | Count | Key Issues |
|----------|-------|------------|
| P1 | 4 | 76 unreachable routes, duplicate routes with inconsistent protection, conflicting `/founder` redirect, mobile nav broken by phantom "pax" ID, unprotected `/market-data` |
| P2 | 7 | No breadcrumbs, no back navigation, flat URL structure, naming aliases, stale command palette, inconsistent PageShell usage, 3 independent nav registries, monolithic founder dashboard |
| P3 | 3 | Dashboard link indirection, no sidebar group headers, hash-based active state broken, silent feature-flag 404s |

---

## Recommendations (not implemented, for planning only)

1. **Single navigation registry** -- Derive sidebar, command palette, and mobile nav from one canonical list. This eliminates sync drift.
2. **Hierarchical URL scheme** -- Migrate flat prefix-dash routes to nested paths (`/team/dashboard`, `/portfolio/health`, `/deals/feed`). Enables breadcrumb auto-generation.
3. **Breadcrumb integration** -- Wire the existing `Breadcrumb` component into `PageShell` using the route hierarchy.
4. **Deduplicate App.tsx routes** -- Remove the second block of route declarations entirely. Audit each for intended protection level (FlaggedRoute vs ProtectedRoute).
5. **Fix "pax" -> "ai-hub"** in `DEFAULT_MOBILE_ITEMS` and `DEFAULT_SIDEBAR_ITEMS`.
6. **Require PageShell** for all authenticated pages to ensure consistent navigation.
7. **URL-based tab state** in founder dashboard (query param or nested routes).
