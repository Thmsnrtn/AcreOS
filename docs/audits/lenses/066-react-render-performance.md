# Lens 066 -- React Rendering Performance Audit

Auditor: React Rendering Performance Specialist (Tier 2)
Date: 2026-04-18
Scope: `client/src/` -- pages, contexts, components
Focus: unnecessary re-renders, missing memoization, render-path bottlenecks

---

## Distinct-Value Declaration

**Concern this lens covers that no Tier-1 core lens would catch:**
Context provider value objects that are re-created on every render, causing full subtree re-renders even when the underlying state has not changed. Tier-1 lenses (frontend architecture, performance/SRE, accessibility) audit bundle size, loading states, and code structure, but none systematically trace how a single state change in a context provider propagates through the React reconciler to force unnecessary work across the entire component tree.

---

## Executive Summary

The AcreOS React client has **zero usage of `React.memo`** across 166K lines of component code. Context provider value objects are re-allocated on every render. The heaviest page (founder-dashboard, 7,291 LOC) creates 30+ state variables, 20+ mutations, and 15+ queries in a single component body -- meaning every state change triggers a full re-render of the entire 7K-line JSX tree. Derived data arrays on the deals and finance pages are recomputed on every render without `useMemo`. Virtual list components exist but are never imported by any page.

**Impact Rating: HIGH** -- On a data-heavy page like leads (2,555 LOC) or deals (1,961 LOC), a single checkbox click triggers reconciliation across the entire page tree including every table row, every badge, and every tooltip.

---

## Finding 1: Zero `React.memo` Usage Across the Entire Client

**Severity: HIGH**
**Files: all 156+ page components and all shared components**

A global search for `React.memo` across `client/src/` returns **zero results**. Not a single component in the codebase is wrapped with `React.memo`.

This means every child component re-renders whenever its parent re-renders, regardless of whether its props actually changed. In a 7,291-line page like `founder-dashboard.tsx` that defines 15+ inner components (`SwipeDecisionsSection`, `GreetingHeader`, `SophieActivityPreview`, `SystemActivityPanel`, `JobHealthPanel`, `ChurnRiskPanel`, `PaxEyesPanel`, `FounderBriefingTrigger`, `CompanyBriefingPanel`, `AgentTeamPanel`, `LaunchReadinessSection`, `FounderNavBar`, etc.), every state change in the parent `FounderDashboard` forces reconciliation of every sub-component even if they receive identical props.

**Recommendation:**
- Wrap stable, prop-driven sub-components with `React.memo` -- especially list-item components like `SwipeDecisionCard`, `JobStatusDot`, table row components in leads/deals/properties, and the 30+ founder sub-components.
- Priority targets: any component rendered inside a `.map()` loop.

---

## Finding 2: Context Provider Values Not Memoized

**Severity: HIGH**
**Files:**
- `client/src/contexts/theme-context.tsx` (lines 109-121)
- `client/src/contexts/pax-rail-context.tsx` (lines 83-91)
- `client/src/components/layout-sidebar.tsx` (lines 439-442)

### ThemeProvider (theme-context.tsx)
The `value` prop passed to `<ThemeContext.Provider>` is a fresh object literal on every render:
```tsx
<ThemeContext.Provider
  value={{
    themeConfig,
    setThemeConfig,
    theme: legacyTheme,
    setTheme,
    toggleTheme,
    resolvedMode,
  }}
>
```
`setThemeConfig`, `setTheme`, and `toggleTheme` are all inline closures that are re-created on every render. Since the value object identity changes, **every consumer of `useTheme()` re-renders on every ThemeProvider render**, even if theme state is unchanged.

Additionally, line 63 forces a no-op state update to trigger a re-render when system preference changes:
```tsx
setThemeConfigState((c) => ({ ...c }));
```
This is a functional update that creates a new object even when nothing changed, which will cause reconciliation of every theme consumer.

### PaxRailProvider (pax-rail-context.tsx)
The `toggle` callback (line 51) depends on `isOpen` state:
```tsx
const toggle = useCallback(() => setOpen(!isOpen), [isOpen, setOpen]);
```
This means `toggle` is re-created every time `isOpen` changes, which changes the provider value object, which re-renders all consumers. The keyboard shortcut handler (lines 72-80) also depends on `isOpen`, creating the same cascade.

### SidebarProvider (layout-sidebar.tsx)
The `SidebarContext.Provider` wraps the entire app at the root level. The value object is not memoized via `useMemo`.

**Recommendation:**
- Wrap each provider value with `useMemo` keyed on the actual state values.
- Use `useCallback` with stable references for `toggle` (use functional updater: `setOpen(prev => !prev)`) to avoid dependency on `isOpen`.
- For ThemeProvider, use `useCallback` for `setThemeConfig`, `setTheme`, `toggleTheme`.

---

## Finding 3: Founder Dashboard -- 30+ State Variables in One Component

**Severity: CRITICAL**
**File: `client/src/pages/founder-dashboard.tsx` (lines 1078-1117)**

The `FounderDashboard` component declares **30+ `useState` hooks**, **20+ `useMutation` hooks**, and **15+ `useQuery` hooks** in a single component body. This means:

1. Any state change (e.g., toggling `focusMode`, opening `goalDialogOpen`, changing `dataSourceFilter`) triggers a full re-render of the entire 7,291-line JSX tree.
2. Every `useMutation` and `useQuery` hook also participates in re-render triggering when their internal state changes (loading, data, error).
3. The tab-based UI does `{activeTab === "X" && (...)}` conditional rendering, but the hooks for inactive tabs still run and trigger state updates (e.g., `refetchInterval` on queries for hidden tabs, though some are gated by `enabled`).

Notable state variables that change frequently and cause full re-renders:
- `testingEndpoints` / `testingDataSources` (Set objects) -- lines 1088-1091
- `endpointTestResults` / `dataSourceTestResults` (Map objects) -- lines 1089-1090
- `lastRefreshed` -- line 1109 (updated on every manual refresh)

**Recommendation:**
- Split into tab-level components: `OverviewTab`, `AgentsTab`, `OperationsTab`, `GrowthTab`, `InfrastructureTab`. Each tab component should own its own state and queries.
- Move the 20+ mutations into the specific tab components that use them.
- The infrastructure-only state (`testingEndpoints`, `endpointTestResults`, `scanDialogOpen`, `discoveredEndpoints`, etc.) alone accounts for ~15 state variables that force re-renders on the overview tab.

---

## Finding 4: Unmemoized Derived Data Arrays in Render Path

**Severity: MEDIUM-HIGH**
**Files:**
- `client/src/pages/deals.tsx` (lines 228-263)
- `client/src/pages/finance.tsx` (lines 103-113)

### deals.tsx
`enrichedDeals` is computed on every render without `useMemo`:
```tsx
const enrichedDeals: DealWithProperty[] = (deals || [])
  .filter(deal => typeFilter === "all" || deal.type === typeFilter)
  .map(deal => ({
    ...deal,
    property: properties.find(p => p.id === deal.propertyId),
  }));
```
This involves an O(n*m) join (deals * properties) on every render. Five additional derivations (`acquisitions`, `dispositions`, `totalPipelineValue`, `closedValue`, `activePipelineDeals`, `stalledCount`, `warningCount`) each re-filter `enrichedDeals` on every render. The `stageDistribution` is correctly wrapped in `useMemo` but depends on `enrichedDeals`, which itself is unstable.

### finance.tsx
`enrichedNotes` (line 103) performs a similar O(n*m) join on every render:
```tsx
const enrichedNotes: NoteWithDetails[] = (notes || []).map(note => ({
  ...note,
  borrower: leads?.find(l => l.id === note.borrowerId),
  property: properties?.find(p => p.id === note.propertyId),
}));
```
This is followed by three `reduce` operations (`totalPortfolio`, `monthlyIncome`, `totalPrincipal`) that also run on every render.

**Recommendation:**
- Wrap `enrichedDeals` in `useMemo` with deps `[deals, properties, typeFilter]`.
- Wrap `enrichedNotes` in `useMemo` with deps `[notes, leads, properties]`.
- Wrap derived aggregations (`totalPipelineValue`, `closedValue`, `activeNotes`, `totalPortfolio`, etc.) in `useMemo` as well, or derive them inside the same memo block.

---

## Finding 5: Inline Arrow Functions in `.map()` Loops

**Severity: MEDIUM**
**Files: founder-dashboard.tsx, leads.tsx, deals.tsx, properties.tsx**

Across the major pages, `onClick` handlers inside `.map()` loops create new function instances on every render:

- `founder-dashboard.tsx`: ~109 inline `onClick={() => ...}` handlers, 83 `.map()` calls. Many are inside iterated list items (alerts, GIS endpoints, data sources, feature requests).
- `deals.tsx`: ~15 inline `onClick` handlers inside kanban card maps.
- `leads.tsx`: Inline handlers on every table row for selection, deletion, editing.

Example from founder-dashboard.tsx line 3168:
```tsx
onClick={() => testGisEndpointMutation.mutate(endpoint.id)}
```
This creates a new function for each of the potentially 100+ GIS endpoint rows on every render.

**Impact:** Without `React.memo` on child components, this is purely cosmetic since children re-render anyway. However, once `React.memo` is added, these inline functions will defeat it.

**Recommendation:**
- After adding `React.memo` to list-item components, extract callbacks using `useCallback` or pass stable identifiers and handle events in the parent.
- Alternatively, use a single handler with data attributes: `onClick={handleEndpointTest}` with `data-endpoint-id={endpoint.id}`.

---

## Finding 6: Virtualization Components Exist But Are Unused

**Severity: MEDIUM**
**Files:**
- `client/src/components/virtual-list.tsx` (exists)
- `client/src/components/VirtualTable.tsx` (exists)

These two components implement list virtualization but are **never imported** by any page component. Searches for `virtual-list` and `VirtualTable` only find the definition files themselves.

Meanwhile, the following pages render potentially large lists without virtualization:
- **founder-dashboard.tsx**: GIS endpoints list (lines 3107-3207), data sources list (lines 3353-3370), system activity stream up to 80 rows (line 718), alerts list, feature requests list.
- **leads.tsx**: Lead table rows (paginated to 25, acceptable).
- **deals.tsx**: Kanban columns with all deals.
- **properties.tsx**: Property list (paginated to 25, acceptable).

The GIS endpoints and data sources lists on the founder dashboard render all items at once with `max-h-96 overflow-y-auto`, creating all DOM nodes upfront.

**Recommendation:**
- Use `VirtualTable` or `VirtualList` for the GIS endpoints, data sources, and system activity lists on the founder dashboard.
- The leads/properties/deals pages use server-side pagination (25 items per page), which mitigates the issue, but the kanban view in deals renders all deals at once.

---

## Finding 7: `new Date()` and `new Intl.NumberFormat()` in Render Path

**Severity: LOW-MEDIUM**
**Files: founder-dashboard.tsx, deals.tsx, finance.tsx**

`founder-dashboard.tsx` creates approximately 30 `new Date()` instances in the render path (for `formatDistanceToNow` calls). The `formatCurrency` helper (line 433) creates a `new Intl.NumberFormat()` instance on every call:

```tsx
function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(cents / 100);
}
```

This function is called ~20 times per render of the founder dashboard. `Intl.NumberFormat` construction is relatively expensive.

**Recommendation:**
- Hoist the `Intl.NumberFormat` instance to module scope:
  ```tsx
  const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
  function formatCurrency(cents: number): string {
    return currencyFormatter.format(cents / 100);
  }
  ```

---

## Finding 8: `useEffect` with Missing/Broad Dependencies

**Severity: MEDIUM**
**File: founder-dashboard.tsx**

Line 1752-1758 -- `useEffect` depends on `validationStatus?.isRunning` but also reads `toast` and `queryClient` without including them in the dependency array:
```tsx
useEffect(() => {
  if (prevValidationRunning.current === true && validationStatus?.isRunning === false) {
    queryClient.invalidateQueries({ queryKey: ['/api/data-sources'] });
    queryClient.invalidateQueries({ queryKey: ['/api/data-sources/stats'] });
    toast({ title: "Validation complete", description: "Data sources have been validated" });
  }
  prevValidationRunning.current = validationStatus?.isRunning;
}, [validationStatus?.isRunning]);
```
While `queryClient` and `toast` are stable references in practice, the missing deps violate the rules of hooks and could cause stale closure bugs if those references ever changed.

Line 5228-5238 -- `useEffect` has deps `[bundleData, wizardStep]` but also uses `toast`, `setBundle`, `setWizardStep`, `setSelectedImageIdx`, `setBundleId` without listing them:
```tsx
useEffect(() => {
  if (bundleData?.status === "ready" && wizardStep === "generating") { ... }
  if (bundleData?.status === "error" && wizardStep === "generating") { ... }
}, [bundleData, wizardStep]);
```

**Recommendation:**
- Add the missing stable references to the dependency arrays, or suppress with an eslint-disable comment explaining why they are intentionally omitted.

---

## Finding 9: AnimatePresence with Route Key Causes Unnecessary Remounting

**Severity: LOW-MEDIUM**
**File: `client/src/App.tsx` (lines 746-763)**

```tsx
function PageWrapper({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div key={location} ...>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
```

Every route change causes the previous page to unmount and the new page to mount with animation. While visually appealing, `mode="wait"` means the exiting page stays mounted while animating out, doubling the rendered component count during transitions. Combined with the large page sizes (7K+ LOC founder dashboard), this creates a significant render spike during navigation.

**Recommendation:**
- Consider `mode="popLayout"` or removing exit animations for heavy pages.
- Ensure lazy-loaded pages are cleaned up properly on unmount (all 15+ queries in founder-dashboard continue fetching during exit animation).

---

## Finding 10: Inline Object/Array Literals in JSX Props

**Severity: LOW**
**Files: founder-dashboard.tsx (6 occurrences), properties.tsx (3), deals.tsx (1)**

Inline `style={{...}}` objects are created fresh on every render:
```tsx
style={{ height: `${Math.max(height, 4)}%` }}
style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
style={{ width: `${score}%` }}
```

Additionally, the `DASHBOARD_TABS` array (founder-dashboard.tsx line 1070) contains inline JSX (`icon: <Crown className="w-4 h-4" />`), creating new React elements on every render.

**Impact:** Low in isolation, but these defeat `React.memo` on children if it were added.

**Recommendation:**
- Hoist `DASHBOARD_TABS` to module scope with string icon identifiers instead of inline JSX, and resolve to components at render time.
- For dynamic styles, use `useMemo` or CSS classes where possible.

---

## Summary Table

| # | Finding | Severity | Pages Affected | Est. Impact |
|---|---------|----------|----------------|-------------|
| 1 | Zero `React.memo` anywhere | HIGH | All 156 pages | Every parent render cascades to all children |
| 2 | Context values not memoized | HIGH | All pages (theme, sidebar, pax-rail wrap entire app) | Every context state change re-renders full subtree |
| 3 | 30+ state vars in one component | CRITICAL | founder-dashboard | Single click re-renders 7K lines of JSX |
| 4 | Unmemoized derived data arrays | MEDIUM-HIGH | deals, finance | O(n*m) joins on every render |
| 5 | Inline functions in `.map()` loops | MEDIUM | founder-dashboard, leads, deals | Defeats future `React.memo` |
| 6 | Virtualization unused | MEDIUM | founder-dashboard (large lists) | All DOM nodes created upfront |
| 7 | `Intl.NumberFormat` in render | LOW-MEDIUM | founder-dashboard, finance | ~20 constructor calls per render |
| 8 | useEffect missing deps | MEDIUM | founder-dashboard | Potential stale closures |
| 9 | AnimatePresence route remounting | LOW-MEDIUM | All route transitions | Double render during navigation |
| 10 | Inline style objects | LOW | founder-dashboard, properties, deals | Minor GC pressure |

---

## Recommended Fix Priority

1. **Split founder-dashboard.tsx into tab-level components** -- eliminates the critical 30+ state variable problem and is prerequisite for all other optimizations on that page.
2. **Memoize context provider values** (ThemeProvider, PaxRailProvider, SidebarProvider) -- single change that benefits every page.
3. **Add `useMemo` to `enrichedDeals` and `enrichedNotes`** -- quick wins with clear performance benefit.
4. **Add `React.memo` to list-item components** used in `.map()` loops (table rows, kanban cards, GIS endpoint rows).
5. **Hoist `Intl.NumberFormat` to module scope** -- trivial fix.
6. **Wire up existing `VirtualTable`/`VirtualList`** for unbounded lists on founder dashboard.
