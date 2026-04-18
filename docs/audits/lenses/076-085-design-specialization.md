# Lenses 076-085 -- Design Specialization Audit

**Lenses**: 076 (Data Visualization), 077 (Form Design), 078 (Table Design), 079 (Modal/Dialog), 080 (Empty States), 081 (Error Messages), 082 (Onboarding Micro-copy), 083 (Marketing/Public Pages), 084 (Iconography), 085 (Loading Skeletons)
**Tier**: 2
**Date**: 2026-04-18

---

## Executive Summary

AcreOS has solid design infrastructure in several of these specializations -- a well-designed `EmptyState` component with actionable CTAs, a `QueryErrorState` component with error-type classification, a `PageShell` that provides per-page error boundaries and loading skeleton support, and a consistent icon library (lucide-react used exclusively across 250 files with only 1 file importing `react-icons`). The shadcn/ui `Form` primitive correctly wires `aria-invalid`, `aria-describedby`, and `role="alert"` on validation messages. However, two areas have genuine craft gaps: (1) the 84 Recharts-powered charts use hardcoded hex colors instead of CSS variables, making them invisible to dark mode and inaccessible to color-blind users; and (2) only 9 of 156 page files use `QueryErrorState`, meaning the majority of data-fetching pages silently swallow errors or show blank content. Most findings here are P2 craft improvements rather than workflow-blocking issues.

---

## Findings

### 076 -- Data Visualization

#### DV-01: Hardcoded Hex Colors in 84 Chart Files
- **Severity**: P2
- **Description**: Recharts components across the codebase use hardcoded hex colors like `fill="#22c55e"`, `stroke="#ef4444"`, `fill="#0088FE"`, `stroke="#3b82f6"` instead of CSS custom properties or theme tokens. This means charts do not adapt to dark mode (a `#f0f0f0` grid line disappears against a dark background) and rely solely on hue to differentiate data series, which fails WCAG 1.4.1 for users with color vision deficiency.
- **Evidence**: `client/src/pages/forecasting.tsx` lines 189-222 (`stroke="#f0f0f0"`, `fill="#22c55e"`, `fill="#ef4444"`, `stroke="#3b82f6"`). `client/src/components/analytics-content.tsx` lines 180-182 (`stroke="#0088FE"`, `stroke="#00C49F"`). `client/src/pages/freedom-meter.tsx` lines 106, 472-555 (9 hardcoded hex values). `client/src/components/cohort-analytics.tsx` lines 180-182 (`fill="#60a5fa"`, `fill="#f59e0b"`, `fill="#22c55e"`). At least 30 files contain hardcoded chart colors.
- **Remediation**: The codebase already has a `ChartContainer` component in `client/src/components/ui/chart.tsx` that supports theme-aware colors via CSS variables (`--color-{key}`). Migrate all direct Recharts usage to use `ChartContainer` with `ChartConfig` objects that map to `hsl(var(--primary))`, `hsl(var(--accent))`, etc. For color-blind safety, add pattern fills or shape markers to differentiate data series beyond color alone.

#### DV-02: Charts Lack Accessible Labels
- **Severity**: P2
- **Description**: None of the 84 chart instances provide `role="img"` or `aria-label` attributes on their container elements. Screen readers encounter silent SVG content with no description of what the chart represents.
- **Evidence**: Searched all Recharts usage for `role="img"` or `aria-label` -- zero matches. `ResponsiveContainer` renders a bare `<div>` wrapping an SVG with no accessible name.
- **Remediation**: Wrap each chart in a container with `role="img"` and a descriptive `aria-label` (e.g., "Monthly cash flow chart showing income and expenses over the last 12 months"). Alternatively, provide a visually-hidden `<table>` or summary text as an accessible alternative.

#### DV-03: Some Charts Use Direct Recharts Instead of ChartContainer
- **Severity**: P2
- **Description**: The `client/src/components/ui/chart.tsx` file provides a well-designed `ChartContainer` wrapper with theme support, tooltips, and legends. However, most pages import `ResponsiveContainer` directly from `recharts` rather than using the project's own `ChartContainer`. This bypasses theme-aware styling.
- **Evidence**: Direct `ResponsiveContainer` imports in `client/src/pages/cash-flow.tsx`, `client/src/pages/finance.tsx`, `client/src/pages/forecasting.tsx`, `client/src/pages/freedom-meter.tsx`, and many more. The `ChartContainer` from `chart.tsx` is underutilized.
- **Remediation**: Gradually migrate chart instances to use `ChartContainer` with `ChartConfig`. This centralizes color management, tooltip styling, and responsive behavior.

---

### 077 -- Form Design

#### FD-01: Form Primitives Are Well-Designed
- **Severity**: N/A (positive finding)
- **Description**: The `client/src/components/ui/form.tsx` component correctly implements accessibility patterns: `FormControl` sets `aria-describedby` and `aria-invalid`, `FormMessage` renders with `role="alert"` and `aria-live="polite"`, and includes an `AlertCircle` icon alongside error text for visual differentiation beyond color. Forms using `react-hook-form` with `zodResolver` (14 files) get proper inline validation.
- **Evidence**: `client/src/components/ui/form.tsx` lines 107-126 (`FormControl` with aria bindings), lines 146-172 (`FormMessage` with `role="alert"`). Core CRM forms in `leads.tsx`, `properties.tsx`, `deals.tsx`, `finance.tsx` all use `Form`/`FormField`/`FormMessage` correctly.

#### FD-02: Lead Form Has Good Validation Messages
- **Severity**: N/A (positive finding)
- **Description**: The lead creation form uses specific, actionable validation messages like "Please enter a valid email address (e.g., name@example.com)" and "Please enter a valid 10-digit US phone number" rather than generic "Invalid input" messages.
- **Evidence**: `client/src/pages/leads.tsx` lines 39-56, the `leadFormSchema` with `.refine()` validators providing example-based error messages.

#### FD-03: Non-Core Forms Skip Structured Validation
- **Severity**: P2
- **Description**: The 14 files using `react-hook-form` + `zodResolver` represent only the core CRM forms. Many secondary pages (settings sections, configuration panels, wizard steps) use uncontrolled `<Input>` elements with manual `onChange` handlers and no inline validation. Errors are only surfaced after submission via toast notifications.
- **Evidence**: `client/src/components/onboarding/OnboardingWizard.tsx` line 402-408: the organization name input uses raw `<Input>` with `onChange` and no validation feedback if the name is empty. `client/src/components/mail-settings-content.tsx` uses raw inputs for email settings without inline validation.
- **Remediation**: For low-traffic settings forms, the current approach is acceptable. Prioritize adding `FormField`/`FormMessage` wrappers on the onboarding wizard since it is the first form every user encounters.

---

### 078 -- Table Design

#### TD-01: Core Tables Have Good Infrastructure
- **Severity**: N/A (positive finding)
- **Description**: The leads, properties, deals, and documents tables are well-implemented with: column sorting via `ArrowUpDown` indicators, bulk selection via `Checkbox`, `VirtualTable` for large datasets (via `@tanstack/react-virtual`), a `useTablePreferences` hook for persistent column visibility/order, and `MobileCardList` as an alternative rendering mode for mobile viewports.
- **Evidence**: `client/src/hooks/use-table-preferences.ts` (107-line hook with localStorage persistence), `client/src/components/VirtualTable.tsx` (virtualized row rendering with 10-item overscan), `client/src/components/MobileCardList.tsx` (responsive card fallback with `useIsMobile` hook).

#### TD-02: Tables Lack Horizontal Scroll Indicator on Mobile
- **Severity**: P2
- **Description**: Several table-heavy pages wrap tables in `overflow-x-auto` for horizontal scrolling, but provide no visual cue (fade gradient, scroll shadow, or scroll indicator) that more columns exist off-screen. Users may not realize they can scroll right.
- **Evidence**: `client/src/pages/deals.tsx` line 770 uses `overflow-x-auto` with gradient indicators (lines 794-795), which is the correct pattern. However, `client/src/pages/audit-log.tsx` line 173, `client/src/pages/deal-hunter.tsx` line 263, and `client/src/components/cohort-retention-dashboard.tsx` line 261 use `overflow-x-auto` without scroll indicators.
- **Remediation**: Apply the gradient-fade pattern from `deals.tsx` (left/right edge gradients with `pointer-events-none`) to all horizontally-scrollable tables. Alternatively, add a CSS scroll-shadow utility.

#### TD-03: Many Secondary Tables Are Not Responsive
- **Severity**: P2
- **Description**: While core CRM pages (`leads.tsx`, `deals.tsx`) have explicit mobile card views, secondary pages like `audit-log.tsx`, `cohort-retention-dashboard.tsx`, `fee-dashboard.tsx`, `marketplace.tsx`, and `commissions.tsx` render full HTML tables that are barely usable on mobile viewports. They have no `MobileCardList` fallback.
- **Evidence**: 39 files use `<Table>` components. Only `leads.tsx` and `deals.tsx` implement `useIsMobile()` with `MobileCardList` fallback. The remaining 37 table-using files render desktop tables at all viewports.
- **Remediation**: Prioritize adding mobile card views for the most-visited secondary tables. At minimum, add `min-w-[600px]` on the `<table>` element inside `overflow-x-auto` to prevent column crushing.

---

### 079 -- Modal/Dialog

#### MD-01: Dialog Primitives Are Correct
- **Severity**: N/A (positive finding)
- **Description**: Dialogs use `@radix-ui/react-dialog` which provides built-in focus trapping, Escape-to-close, and body scroll lock via the overlay. The `DialogContent` component includes a close button with `aria-label="Close"`. Sheets use the same Radix primitive. 466 usages of `DialogTitle`/`DialogDescription`/`VisuallyHidden` across 86 files show that accessible labeling is widely applied.
- **Evidence**: `client/src/components/ui/dialog.tsx` uses `DialogPrimitive.Content` (Radix handles focus trap automatically), `DialogPrimitive.Close` with `aria-label="Close"`. `client/src/components/ui/sheet.tsx` also uses Radix Dialog under the hood. The `sr-only` span on Sheet close (line 69) provides an accessible name.

#### MD-02: Dialog Close Button Positioned Left (macOS Convention)
- **Severity**: P2
- **Description**: The dialog close button is positioned at `left-4 top-4` with a "traffic light" class, following macOS window chrome conventions. While this is a deliberate design choice for the macOS-inspired aesthetic, it may confuse users on Windows or mobile who expect close buttons on the right.
- **Evidence**: `client/src/components/ui/dialog.tsx` line 62-63: `className="traffic-light-group traffic-light-close absolute left-4 top-4"`. The Sheet component (line 68) correctly places its close button at `right-4 top-4`, creating an inconsistency between Dialog and Sheet close button positions.
- **Remediation**: Either standardize both to right-positioned (conventional) or both to left-positioned (macOS). The current mix is the worst of both worlds.

#### MD-03: Some Dialogs Could Be Long and Unscrollable
- **Severity**: P2
- **Description**: `DialogContent` has no built-in `max-height` or `overflow-y-auto`. Individual dialogs must add their own scroll handling. Most do (e.g., leads score dialog adds `max-h-[80vh] overflow-y-auto`), but the base component does not enforce this, creating risk for new dialogs that might render tall content.
- **Evidence**: `client/src/components/ui/dialog.tsx` -- `DialogContent` has no `max-h` or overflow class. Compare with `client/src/pages/leads.tsx` line 252 which adds `max-h-[80vh] overflow-y-auto` per-instance.
- **Remediation**: Add `max-h-[85vh] overflow-y-auto` to the base `DialogContent` class so all dialogs are scrollable by default.

---

### 080 -- Empty States

#### ES-01: Empty State Components Are Well-Designed and Actionable
- **Severity**: N/A (positive finding)
- **Description**: The `EmptyState` component (`client/src/components/empty-state.tsx`) accepts an `actionLabel` + `onAction` callback, optional tips, a learn-more link, and test IDs. The domain-specific empty states in `client/src/components/empty-states.tsx` provide contextual tips (e.g., "Import a CSV of county tax-delinquent records") and clear CTAs ("Add a Lead", "Create a Deal"). These are actionable, not decorative. Additionally, the `client/src/components/empty-states/` directory contains enhanced versions with motion animations and pro-tips.
- **Evidence**: `client/src/components/empty-states.tsx` -- 7 domain-specific empty states (Leads, Properties, Deals, Tasks, Campaigns, Finance, Pipeline), each with contextual tips and primary CTA buttons. The `LeadsEmptyState` in `client/src/components/empty-states/LeadsEmptyState.tsx` includes an animated icon, two CTAs (Add Lead + Import CSV), and a pro-tip about lead scoring.

#### ES-02: Two Competing Empty State Systems
- **Severity**: P2
- **Description**: There are two parallel empty state implementations: (1) `client/src/components/empty-states.tsx` (inline file with 7 entity-specific states using the base `EmptyState` component) and (2) `client/src/components/empty-states/` directory (5 standalone files with richer motion animations). Both exist and both are imported in different places. This creates maintenance confusion.
- **Evidence**: `client/src/pages/leads.tsx` imports from both: `import { EmptyState } from "@/components/empty-state"` (line 66) and `import { LeadsEmptyState } from "@/components/empty-states"` (line 67). The barrel export at `empty-states/index.ts` exports the directory versions, while `empty-states.tsx` is a separate file.
- **Remediation**: Consolidate into the `empty-states/` directory pattern. Move the inline definitions from `empty-states.tsx` into individual files in `empty-states/`, or deprecate the directory versions if the simpler inline approach is preferred.

#### ES-03: Most Pages Lack Empty State Handling
- **Severity**: P2
- **Description**: Only 13 of 156 page files import any `EmptyState` component. The remaining 143 pages either show blank content areas or default "No data" text when the API returns an empty array. Pages like `cash-flow.tsx`, `forecasting.tsx`, `portfolio.tsx`, `analytics.tsx`, and `market-data.tsx` have no graceful zero-data experience.
- **Evidence**: `EmptyState` imports found in: `executive-dashboard.tsx`, `finance.tsx`, `leads.tsx`, `properties.tsx`, `documents.tsx`, `tasks.tsx`, `listings.tsx`, `deals.tsx`, `founder-home.tsx`, `workflows.tsx`, `offers.tsx`, `inbox.tsx`, `counties.tsx`. Absent from all other 143 page files.
- **Remediation**: Prioritize adding empty states to the most-visited pages first: `cash-flow.tsx`, `forecasting.tsx`, `analytics.tsx`. The existing `EmptyState` component makes this straightforward -- each page just needs an icon, title, description, and CTA.

---

### 081 -- Error Messages

#### EM-01: QueryErrorState Provides Type-Specific Guidance
- **Severity**: N/A (positive finding)
- **Description**: The `QueryErrorState` component classifies errors into 5 types (network, server, auth, notFound, generic) and provides type-specific titles, descriptions, icons, and colors. Network errors say "check your internet connection", auth errors say "sign in again", server errors say "try again in a moment". Each variant has a "Try Again" button with loading state.
- **Evidence**: `client/src/components/query-error-state.tsx` lines 20-83: `getErrorType()` classifies by error message, `getErrorConfig()` returns type-specific copy. Compact variant for inline card errors, full variant for page-level errors.

#### EM-02: Only 9 of 156 Pages Use QueryErrorState
- **Severity**: P1
- **Description**: Despite having a well-designed error state component, only 9 page files actually import and render it. The other 147 pages silently fail -- if the API returns an error, the page renders as if no data exists, or in some cases shows a blank area. Core financial pages (`cash-flow.tsx`, `forecasting.tsx`, `portfolio.tsx`) and all analytics pages have no error handling for their data fetches.
- **Evidence**: `QueryErrorState` is used in: `executive-dashboard.tsx`, `finance.tsx`, `leads.tsx`, `properties.tsx`, `deals.tsx`, `dashboard.tsx`, `onboarding-v2.tsx`, `pax.tsx`, `founder-home.tsx`. Not used in `cash-flow.tsx`, `forecasting.tsx`, `portfolio.tsx`, `analytics.tsx`, `today.tsx`, `night-cap.tsx`, `settings.tsx`, `maps.tsx`, and 138 other pages.
- **Remediation**: At minimum, add `QueryErrorState` rendering to every page that calls `useQuery`. The pattern is already established: destructure `error` from `useQuery`, conditionally render `<QueryErrorState error={error} onRetry={refetch} />`. Prioritize `today.tsx` (the home screen) and `cash-flow.tsx`/`forecasting.tsx` (financial decision screens).

#### EM-03: Toast Error Messages Often Lack Actionable Guidance
- **Severity**: P2
- **Description**: Many error toasts use generic titles like "Error" with raw `err.message` as the description. When a server returns a technical error message, users see unhelpful text like "Error: Internal Server Error" with no guidance on what to do next. Some error toasts omit the description entirely.
- **Evidence**: `client/src/pages/fee-dashboard.tsx` line 203: `toast({ title: "Error", description: e.message, variant: "destructive" })`. `client/src/pages/deal-hunter.tsx` lines 349-629: six error handlers all using `title: "Error"`. `client/src/pages/usage-quota.tsx` line 87: `toast({ title: "Reset failed", variant: "destructive" })` with no description.
- **Remediation**: Replace generic "Error" titles with action-specific titles ("Couldn't save your changes", "Export failed"). Add a standard fallback description: "Please try again. If the problem persists, contact support." Consider a `showErrorToast(action, error)` helper that standardizes this pattern.

---

### 082 -- Onboarding Micro-copy

#### OB-01: Onboarding Wizard Copy Is Clear and Motivating
- **Severity**: N/A (positive finding)
- **Description**: The `OnboardingWizard` component has well-crafted step titles and descriptions: "Welcome to AcreOS -- The operating system for real estate professionals", "Get Started with Data -- Load sample data to explore or import your own", "Add Your First Leads -- Import from CSV or add a lead manually". The welcome step includes three value-prop bullets with icons. The business type selector shows 14 investor types with concise descriptions.
- **Evidence**: `client/src/components/onboarding/OnboardingWizard.tsx` lines 100-135 (step definitions), lines 382-398 (value prop bullets), lines 66-81 (14 investor types with descriptions).

#### OB-02: Onboarding Step Micro-copy Could Better Set Expectations
- **Severity**: P2
- **Description**: While step titles are good, the wizard lacks time estimates ("This takes about 2 minutes"), progress context ("Step 2 of 5"), and skip-step reassurance ("You can always do this later from Settings"). The skip button exists but says just "Skip" with no reassurance that the feature remains available later.
- **Evidence**: `client/src/components/onboarding/OnboardingWizard.tsx` -- the Progress bar shows visual progress, but no "Step X of Y" text. The skip handler (line 312) has no confirmation or reassurance copy. The dismiss handler (line 332) offers "Don't show again" but does not explain how to return to the wizard.
- **Remediation**: Add "Step {n} of {total}" text next to the progress bar. Change "Skip" to "Skip for now -- you can set this up later in Settings". Add an estimated time ("~2 min") on the welcome step.

#### OB-03: Sample Data Option Is Well-Positioned
- **Severity**: N/A (positive finding)
- **Description**: The "Load Sample Data" option on step 1 is prominently displayed with a green border and sparkle icon, with secondary options for CSV import and manual add. This is smart onboarding design -- it lets users explore the product immediately without requiring their own data.
- **Evidence**: `client/src/components/onboarding/OnboardingWizard.tsx` lines 468-489: sample data card is visually elevated with `border-2 border-green-500/30 bg-green-500/5`.

---

### 083 -- Marketing/Public Pages

#### MP-01: Landing Page Is Functional but Basic
- **Severity**: P2
- **Description**: The landing page at `/landing` has a clean structure: nav bar, hero with gradient heading, social proof stats, feature cards, pricing teaser, and CTA section. It uses proper semantic sections and responsive grid layouts. However, it lacks visual differentiation from the app itself -- no hero illustration, no screenshots, no testimonials, no demo video. The social proof numbers ("500+ Properties managed") feel like placeholders.
- **Evidence**: `client/src/pages/landing.tsx` -- 200 lines. Hero section (lines 85-115) is text-only. Social proof (lines 51-56) shows "18 Free data sources", "$0 To get started", "14 Day free trial", "500+ Properties managed". No customer quotes, no product screenshots, no animation.
- **Remediation**: Add at least one product screenshot (or animated GIF) in the hero section. Replace placeholder social proof with real metrics or user testimonials. Add a brief demo walkthrough or video embed. These are standard landing page requirements for conversion.

#### MP-02: Landing Page Uses Correct Terminology
- **Severity**: N/A (positive finding)
- **Description**: The landing page correctly uses "real estate professionals" (not "land investors") and lists 9 business types including Wholesaling, Fix & Flip, Buy & Hold, STR/Airbnb, etc. This aligns with the project directive to avoid narrow positioning.
- **Evidence**: `client/src/pages/landing.tsx` line 94: "real estate professionals". Lines 101-103: strategy badges covering the full breadth.

---

### 084 -- Iconography

#### IC-01: Consistent Icon Library
- **Severity**: N/A (positive finding)
- **Description**: The codebase uses `lucide-react` as its sole icon library across 250 files. Only 1 file (`client/src/components/integrations-settings.tsx`) imports from a different library (`react-icons/si` for brand icons: Twilio, SendGrid). There are zero imports from `@heroicons` or other competing libraries. This is exemplary consistency.
- **Evidence**: 253 total `from "lucide-react"` import occurrences across 250 files. 1 `from "react-icons/si"` import for brand-specific icons (justified -- lucide does not include brand logos).

#### IC-02: Icon Sizes Are Mostly Consistent
- **Severity**: P2
- **Description**: Icons follow a generally consistent sizing pattern: `w-4 h-4` for inline/button icons, `w-5 h-5` for card header icons, `w-10 h-10` for empty state heroes. However, the sidebar (`layout-sidebar.tsx`) mixes `w-3 h-3`, `w-4 h-4`, and `w-5 h-5` within the same visual context (navigation items vs. footer icons), and some pages use `w-6 h-6` for card icons while adjacent cards use `w-5 h-5`.
- **Evidence**: `client/src/components/layout-sidebar.tsx` lines 157, 210, 798, 1015, 1035 show sizes ranging from `w-3 h-3` (close button) to `w-5 h-5` (logout icon in mobile nav). The `w-3 h-3` close icon (line 210) is likely too small for comfortable tap targets.
- **Remediation**: Establish explicit icon sizing tiers in the design system documentation: `w-3.5 h-3.5` (secondary/decorative), `w-4 h-4` (inline actions), `w-5 h-5` (card headers), `w-8 h-8` (section heroes), `w-10 h-10` (empty states). Audit instances that deviate.

---

### 085 -- Loading Skeletons

#### LS-01: Rich Skeleton Component Library
- **Severity**: N/A (positive finding)
- **Description**: The codebase has 5 skeleton components matching different content shapes: `Skeleton` (base primitive), `SkeletonTable` (with configurable rows/columns), `SkeletonCard` (with optional header/footer), `SkeletonList` (with optional avatar/badge), and `ListSkeleton` (with table/card/compact variants plus `TableRowSkeleton`, `StatCardSkeleton`, `PageHeaderSkeleton`). The `PageShell` wrapper provides a default loading skeleton when `isLoading` is passed.
- **Evidence**: `client/src/components/ui/skeleton.tsx`, `client/src/components/ui/skeleton-table.tsx`, `client/src/components/ui/skeleton-card.tsx`, `client/src/components/ui/skeleton-list.tsx`, `client/src/components/list-skeleton.tsx`. `PageShell` (line 61) renders a loading skeleton automatically.

#### LS-02: Some Pages Use Text-Based Loading Instead of Skeletons
- **Severity**: P2
- **Description**: Despite the rich skeleton library, some pages fall back to plain-text loading indicators: `"Loading..."` strings, raw `animate-pulse` divs, or `Loader2` spinners. This contradicts the CLAUDE.md instruction to "Use Skeleton components matching the content shape, not spinners."
- **Evidence**: `client/src/pages/usage-analytics.tsx` line 134: `<div className="h-48 flex items-center justify-center text-muted-foreground">Loading...</div>`. `client/src/pages/analytics.tsx` line 24: `animate-pulse text-muted-foreground text-sm">Loading..."`. `client/src/pages/money.tsx` line 34: same pattern. `client/src/pages/buyer-qualification.tsx` line 239: `<Loader2 className="w-4 h-4 animate-spin" /> Loading...`. `client/src/pages/price-optimizer.tsx` line 388: same pattern.
- **Remediation**: Replace all `"Loading..."` text and `Loader2` spinner fallbacks with appropriate skeleton components. For tab content, use the Suspense fallback pattern from `analytics.tsx` but replace the text with `<SkeletonCard />` or `<SkeletonTable />`. For inline data, use `<Skeleton className="h-4 w-24 inline-block" />`.

#### LS-03: 40 of 156 Pages Use Skeletons -- Good but Incomplete
- **Severity**: P2
- **Description**: 40 page files import skeleton components, which is reasonable coverage for the most-visited pages. However, 116 pages have no skeleton loading states, meaning they either show nothing during load (via `PageShell`'s default skeleton) or render immediately with undefined data.
- **Evidence**: Skeleton imports found in 40 page files (leads, properties, deals, tasks, documents, listings, dashboard, today, settings, founder-dashboard, etc.). Not found in pages like `cash-flow.tsx`, `forecasting.tsx`, `analytics.tsx` (uses text fallback), `portfolio.tsx`, etc.
- **Remediation**: Many of these 116 pages are secondary/admin screens where the `PageShell` default skeleton is adequate. Focus on adding content-matched skeletons to financial pages (`cash-flow.tsx`, `forecasting.tsx`, `portfolio.tsx`) where users expect to see chart-shaped placeholders, not generic rectangles.

---

## Summary Table

| ID | Lens | Finding | Severity |
|----|------|---------|----------|
| DV-01 | 076 Data Viz | Hardcoded hex colors in 84 chart files; dark mode and color-blind issues | P2 |
| DV-02 | 076 Data Viz | Charts lack accessible labels (no role="img" or aria-label) | P2 |
| DV-03 | 076 Data Viz | Most charts bypass the ChartContainer wrapper | P2 |
| FD-01 | 077 Form | Form primitives have correct aria bindings (positive) | -- |
| FD-02 | 077 Form | Lead form has excellent validation messages (positive) | -- |
| FD-03 | 077 Form | Non-core forms skip structured validation | P2 |
| TD-01 | 078 Table | Core tables have good infrastructure (positive) | -- |
| TD-02 | 078 Table | Tables lack horizontal scroll indicators on mobile | P2 |
| TD-03 | 078 Table | Most secondary tables not responsive | P2 |
| MD-01 | 079 Modal | Dialog primitives use Radix correctly (positive) | -- |
| MD-02 | 079 Modal | Dialog/Sheet close button position inconsistency | P2 |
| MD-03 | 079 Modal | DialogContent has no default max-height/scroll | P2 |
| ES-01 | 080 Empty | Empty states are actionable with CTAs and tips (positive) | -- |
| ES-02 | 080 Empty | Two competing empty state systems | P2 |
| ES-03 | 080 Empty | 143 of 156 pages lack empty state handling | P2 |
| EM-01 | 081 Error | QueryErrorState provides type-specific guidance (positive) | -- |
| EM-02 | 081 Error | Only 9 of 156 pages use QueryErrorState | P1 |
| EM-03 | 081 Error | Toast errors use generic "Error" titles | P2 |
| OB-01 | 082 Onboarding | Wizard copy is clear and motivating (positive) | -- |
| OB-02 | 082 Onboarding | Wizard lacks time estimates and skip reassurance | P2 |
| OB-03 | 082 Onboarding | Sample data option well-positioned (positive) | -- |
| MP-01 | 083 Marketing | Landing page is functional but lacks visuals | P2 |
| MP-02 | 083 Marketing | Landing page uses correct terminology (positive) | -- |
| IC-01 | 084 Icons | Consistent lucide-react usage across 250 files (positive) | -- |
| IC-02 | 084 Icons | Minor icon sizing inconsistencies in sidebar | P2 |
| LS-01 | 085 Skeletons | Rich skeleton component library (positive) | -- |
| LS-02 | 085 Skeletons | Some pages use text "Loading..." instead of skeletons | P2 |
| LS-03 | 085 Skeletons | 116 of 156 pages have no content-specific skeletons | P2 |

**P1 count**: 1
**P2 count**: 16
**Positive findings**: 10
