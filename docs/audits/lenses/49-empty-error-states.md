# Lens 49 -- Empty State / Loading State / Error State Audit

**Auditor:** Automated (Claude)
**Date:** 2026-04-15
**Scope:** Top 20+ data-dependent pages by importance
**Standard:** Every `useQuery`-backed view must handle three states: loading (skeleton/shimmer), error (retry-capable message), and empty (purposeful CTA). Per CLAUDE.md: use `Skeleton` for loading, `QueryErrorState` for errors, `EmptyState` for zero-data.

---

## State Coverage Table

| # | Page | File | Has Loading | Has Error | Has Empty | Issues |
|---|------|------|:-----------:|:---------:|:---------:|--------|
| 1 | Today | `pages/today.tsx` | Partial | **NO** | Partial | Skeletons for sub-sections only; no top-level error handler; no `QueryErrorState`; empty states inline but not using `EmptyState` component |
| 2 | Leads | `pages/leads.tsx` | YES | YES | YES | Full coverage: `ListSkeleton`, `QueryErrorState`, `LeadsEmptyState`, `InlineError` |
| 3 | Properties | `pages/properties.tsx` | YES | YES | YES | Full coverage: `ListSkeleton`, `QueryErrorState`, `PropertiesEmptyState`, `InlineError` |
| 4 | Deals | `pages/deals.tsx` | YES | YES | YES | Full coverage: `ListSkeleton`, `QueryErrorState`, `DealsEmptyState`, `InlineError` |
| 5 | Maps | `pages/maps.tsx` | Partial | **NO** | YES | Uses spinner instead of `Skeleton`; no error state if `/api/properties` fails -- page silently shows empty map; no `QueryErrorState` |
| 6 | Campaigns (content) | `components/campaigns-content.tsx` | YES | Partial | YES | `ListSkeleton` + `CampaignsEmptyState` used; error state is a manual div, not `QueryErrorState` (no retry button) |
| 7 | Campaigns (shell) | `pages/campaigns.tsx` | **NO** | **NO** | **NO** | Shell page has zero data fetching itself -- delegates to sub-components; no Suspense fallback for tab content |
| 8 | Inbox | `pages/inbox.tsx` | YES | **NO** | YES | `ListSkeleton` and `EmptyState` present; no error state -- if queries fail, page shows nothing with no retry |
| 9 | Finance (Notes) | `pages/finance.tsx` | YES | YES | YES | Full coverage: `Skeleton`-based loading, `QueryErrorState`, `EmptyState` for notes list |
| 10 | Documents | `pages/documents.tsx` | YES | **NO** | YES | `ListSkeleton` for templates/documents/packages; `EmptyState` for each tab; no `QueryErrorState` -- API errors are toast-only, no page-level error fallback |
| 11 | Founder Dashboard | `pages/founder-dashboard.tsx` | YES | **NO** | Partial | Top-level `Skeleton` grid on load; no `QueryErrorState` for the main `isLoading` query; many sub-sections have inline "no data" text but no formal `EmptyState` component; 7286-line file with 15+ queries and no centralized error boundary |
| 12 | Settings | `pages/settings.tsx` | YES | Partial | Partial | `Skeleton` used extensively for org/team/products/usage; referral tab has `isError` check; most tabs lack page-level error states; goals/developer/webhook tabs check `length === 0` but don't use `EmptyState` |
| 13 | Marketplace | `pages/marketplace.tsx` | YES | **NO** | Partial | Custom `CardSkeleton` and `Skeleton` for loading; inline "No listings" text for empty; no error state at all -- failed fetches produce blank sections silently |
| 14 | Portfolio | `pages/portfolio.tsx` | YES | **NO** | Partial | Extensive `Skeleton` usage; alerts section checks `length === 0`; no `QueryErrorState` -- if any of the 5 queries fail, page renders broken/partial data |
| 15 | Forecasting | `pages/forecasting.tsx` | Partial | **NO** | YES | Uses `Loader2` spinner (not `Skeleton`); `!summary` shows empty-state text with CTA; no error handling -- failed query shows nothing |
| 16 | Dashboard | `pages/dashboard.tsx` | YES | YES | Partial | `Skeleton` for main loading; `QueryErrorState` for `orgError`; aging leads and campaigns sections have `length === 0` checks but no `EmptyState` component for main content |
| 17 | Pipeline | `pages/pipeline.tsx` | Partial | **NO** | Partial | Uses `animate-pulse` text "Loading..." (not `Skeleton`); no error state; `leads.length === 0 && deals.length === 0` returns null silently |
| 18 | Money | `pages/money.tsx` | Partial | **NO** | **NO** | Container page with `Suspense` fallback (`animate-pulse` text); no error boundary; delegates entirely to sub-pages |
| 19 | Cash Flow | `pages/cash-flow.tsx` | **NO** | **NO** | YES | No loading skeleton or spinner while queries fetch; no error state; has empty state ("No forecast data yet") but only after loading completes |
| 20 | Bookkeeping | `pages/bookkeeping.tsx` | Partial | **NO** | **NO** | `Loader2` spinner during load (not `Skeleton`); no error handling at all; no empty state when no notes exist -- shows $0 values |
| 21 | Tasks | `pages/tasks.tsx` | YES | **NO** | YES | `ListSkeleton` for loading; `TasksEmptyState` for empty; no error state -- query failures show nothing |
| 22 | Activity | `pages/activity.tsx` | Partial | YES | YES | `Loader2` spinner (not `Skeleton`); inline error message (not `QueryErrorState`); inline empty text (not `EmptyState`); functionally complete but does not use standard components |

---

## Findings

### P1 -- Critical (missing state on core page)

**F1. today.tsx -- No error state**
- Severity: **P1**
- The landing page after login has ~12 `useQuery` calls and zero error handling. If the API is down or the user's session is invalid, every section silently renders default/fallback values (`"-"`, `0`, empty arrays). The user sees a page that looks functional but contains no real data, with no indication anything failed and no retry option.
- File: `client/src/pages/today.tsx`

**F2. maps.tsx -- No error state**
- Severity: **P1**
- The maps page fetches properties and deals via `useQuery` but destructures no `error` or `isError`. If the property fetch fails, the page shows the "No properties with coordinates" empty state, misleading users into thinking they have no data rather than that the API failed.
- File: `client/src/pages/maps.tsx`

**F3. inbox.tsx -- No error state**
- Severity: **P1**
- Email and SMS queries have no error handling. A failed fetch results in an empty inbox with the `EmptyState` component shown, indistinguishable from actually having no messages. Users cannot retry.
- File: `client/src/pages/inbox.tsx`

**F4. cash-flow.tsx -- No loading state, no error state**
- Severity: **P1**
- Five `useQuery` calls with no loading indicator whatsoever. While `summaryLoading` is checked for the empty-state guard, nothing visible is rendered during the initial load -- the page appears blank. No error handling exists.
- File: `client/src/pages/cash-flow.tsx`

**F5. documents.tsx -- No error state**
- Severity: **P1**
- Three primary queries (templates, documents, packages) have no page-level error handling. Mutation errors appear as toasts, but a failed list fetch shows the `EmptyState` component as if there are simply no documents, with no retry.
- File: `client/src/pages/documents.tsx`

**F6. deals.tsx pipeline board -- Loading state uses ListSkeleton inside stage columns only**
- Severity: **P1** (partial -- the error and empty states are properly handled)
- Note: Deals page is actually well-implemented with `QueryErrorState`, `DealsEmptyState`, and `ListSkeleton`. Included for completeness as a positive example.

### P1 -- Critical (founder-facing)

**F7. founder-dashboard.tsx -- No error state for a 7286-line page with 15+ queries**
- Severity: **P1**
- The single largest page in the app has no `QueryErrorState` or error boundary. If the main dashboard data query fails, the page renders with `isLoading=true` skeleton indefinitely (since error keeps `isLoading` false but no error branch exists). Sub-components (decisions inbox, auto-resolutions, churn rescue, agent queue) each have their own queries with no error handling.
- File: `client/src/pages/founder-dashboard.tsx`

### P2 -- Secondary pages

**F8. marketplace.tsx -- No error state**
- Severity: **P2**
- Browse listings, my listings, and my bids queries have no error handling. Failed fetches show blank sections.
- File: `client/src/pages/marketplace.tsx`

**F9. portfolio.tsx -- No error state**
- Severity: **P2**
- Five queries (summary, delinquency, projections, alerts, compliance rules) with no error handling. The page renders Skeleton during load but has no fallback if any query errors.
- File: `client/src/pages/portfolio.tsx`

**F10. forecasting.tsx -- Uses spinner instead of Skeleton, no error state**
- Severity: **P2**
- Uses `Loader2` spinner rather than content-shaped `Skeleton` components. No error state -- a failed query leaves the page showing the spinner indefinitely or a blank area.
- File: `client/src/pages/forecasting.tsx`

**F11. pipeline.tsx -- No error state, minimal loading**
- Severity: **P2**
- Container page uses `animate-pulse` text for loading (not `Skeleton`). The pipeline intelligence header fetches leads and deals but has no error handling. Returns `null` if both are empty -- user sees nothing.
- File: `client/src/pages/pipeline.tsx`

**F12. bookkeeping.tsx -- No error state, no empty state**
- Severity: **P2**
- Shows `Loader2` spinner during load, then renders data with `report ? fmt(...) : "---"` fallback. No error handling and no empty state when there are no notes to report on.
- File: `client/src/pages/bookkeeping.tsx`

**F13. tasks.tsx -- No error state**
- Severity: **P2**
- Has `ListSkeleton` and `TasksEmptyState` but no error handling for the tasks query.
- File: `client/src/pages/tasks.tsx`

**F14. money.tsx -- No error boundary for lazy-loaded children**
- Severity: **P2**
- Container uses `Suspense` with a text fallback but no `ErrorBoundary`. If a lazy-loaded child page throws during render, the entire page crashes with the React default error screen.
- File: `client/src/pages/money.tsx`

### P3 -- Admin / low-traffic pages

**F15. settings.tsx -- Inconsistent error handling across tabs**
- Severity: **P3**
- Only the referral tab has an `isError` check. Organization, billing, team, and usage tabs use `Skeleton` for loading but have no error fallback. If Stripe APIs fail, the payments tab renders broken.
- File: `client/src/pages/settings.tsx`

### Pattern Violations (applies to multiple pages)

**F16. Spinner instead of Skeleton -- 6 pages**
- Severity: **P2**
- Pages using `Loader2` spinner or `animate-pulse` text instead of content-shaped `Skeleton` components: `forecasting.tsx`, `maps.tsx`, `bookkeeping.tsx`, `activity.tsx`, `pipeline.tsx`, `cash-flow.tsx`. This violates the CLAUDE.md standard: "Loading states: Use Skeleton components matching the content shape, not spinners."

**F17. Inline text empty states instead of EmptyState component -- 8 pages**
- Severity: **P3**
- Pages using ad-hoc inline text for empty states instead of the `EmptyState` component: `today.tsx`, `maps.tsx`, `forecasting.tsx`, `activity.tsx`, `bookkeeping.tsx`, `portfolio.tsx`, `marketplace.tsx`, `pipeline.tsx`. This produces inconsistent UX.

**F18. Error states as toasts only -- 4 pages**
- Severity: **P2**
- Pages where mutation errors show toasts but query errors are completely unhandled: `documents.tsx`, `marketplace.tsx`, `portfolio.tsx`, `cash-flow.tsx`. Users see a toast for action failures but get no indication when the initial data load fails.

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Pages audited | 22 |
| Pages with complete loading state (Skeleton) | 10 (45%) |
| Pages with partial loading (spinner/text) | 8 (36%) |
| Pages with no loading state | 1 (5%) |
| Pages with loading delegated to children | 3 (14%) |
| Pages with error state (QueryErrorState or equivalent) | 5 (23%) |
| Pages with no error state at all | 15 (68%) |
| Pages with partial error handling (toasts only or one section) | 2 (9%) |
| Pages with proper empty state (EmptyState component) | 10 (45%) |
| Pages with partial empty handling (inline text) | 8 (36%) |
| Pages with no empty state | 4 (18%) |
| Total findings | 18 |
| P1 findings | 7 |
| P2 findings | 8 |
| P3 findings | 3 |

### Key Takeaway

**68% of audited pages have no error state at all.** This is the most critical gap. When the API fails (auth expiry, network error, server crash), most pages silently render in a "looks empty" state indistinguishable from genuinely having no data. The user has no indication of failure and no retry mechanism. Only 5 pages (leads, properties, deals, finance, dashboard) use `QueryErrorState` properly. The loading and empty state coverage is better but still inconsistent, with many pages using spinners instead of content-shaped skeletons.

### Recommended Priority

1. Add `QueryErrorState` to every page that fetches data (15 pages missing)
2. Add `React ErrorBoundary` wrappers around lazy-loaded route children in `money.tsx`, `pipeline.tsx`, and `campaigns.tsx`
3. Replace `Loader2`/`animate-pulse` loading indicators with `Skeleton` components (6 pages)
4. Replace inline empty text with `EmptyState` component for consistency (8 pages)
5. Add error/loading/empty state coverage to new page checklist in PR template
