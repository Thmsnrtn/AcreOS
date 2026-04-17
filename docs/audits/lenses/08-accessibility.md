# Lens 8 -- Accessibility Audit

**Auditor perspective:** WCAG 2.1 AA compliance, keyboard navigation, screen reader support, focus management, color contrast, and ARIA usage.
**Date:** 2026-04-15
**Scope:** Client-side React/TypeScript/Tailwind/shadcn codebase -- key pages (auth, today, leads, deals, properties, settings, founder-dashboard) plus shared components, layout, and animations.

---

## Executive Summary

AcreOS has a partial accessibility foundation: a skip link exists, the sidebar has `aria-label` and `aria-current`, the `form.tsx` component correctly wires `aria-describedby`, `aria-invalid`, and `role="alert"`, and a global `focus-visible` ring is set via CSS. However, **173 of 199 icon-only buttons (87%) lack `aria-label`**, the skip link target `#main-content` does not exist on any element, framer-motion animations do not respect `prefers-reduced-motion`, and multiple search/filter inputs have no programmatic label. These issues collectively mean keyboard-only and screen reader users cannot reliably operate the core CRM workflows (leads, deals, offers, founder dashboard).

---

## Findings

### A11Y-01: Skip Link Target Missing -- Skip Link Is Non-Functional
| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **WCAG** | 2.4.1 Bypass Blocks (A) |
| **Location** | `client/src/App.tsx:750`, `client/src/components/page-shell.tsx:53` |

**Description:** The app renders `<a href="#main-content" className="skip-to-content">` and it is correctly styled to appear on focus (`client/src/index.css:441-448`). However, no element in the application has `id="main-content"`. The `<main>` element in `page-shell.tsx` lacks an `id` attribute entirely. The skip link therefore navigates nowhere.

**Evidence:**
- `App.tsx:750`: `<a href="#main-content" ...>Skip to content</a>`
- `page-shell.tsx:53`: `<main className="flex-1 p-4 ..." >` -- no `id` attribute
- Grep for `id="main-content"` across `client/src/` returns zero matches outside the anchor href itself.

**Remediation:** Add `id="main-content"` and `tabIndex={-1}` to the `<main>` element in `page-shell.tsx`. Also add it to the standalone `<main>` elements in `inbox.tsx`, `campaigns.tsx`, `command-center.tsx`, and other pages that bypass `PageShell`.

---

### A11Y-02: 173 Icon-Only Buttons Without `aria-label`
| Field | Value |
|-------|-------|
| **Severity** | P0 |
| **WCAG** | 1.1.1 Non-text Content (A), 4.1.2 Name, Role, Value (A) |
| **Location** | 85 files across `client/src/pages/` and `client/src/components/` |

**Description:** Of 199 `<Button size="icon">` instances in the codebase, only 26 (13%) have an `aria-label` or are wrapped in a tooltip with screen-reader-accessible text. The remaining 173 render as unlabeled buttons to assistive technology. Screen reader users hear only "button" with no indication of purpose.

**Evidence (sample of high-traffic pages):**
- `today.tsx:724` -- dismiss alert button (X icon), no `aria-label`
- `deals.tsx:541` -- clear selection button, no `aria-label`
- `deals.tsx:1169` -- delete deal button (Trash icon), no `aria-label`
- `deals.tsx:1172` -- close drawer button (X icon), no `aria-label`
- `offers.tsx:415` -- send offer button, no `aria-label`
- `offers.tsx:425` -- delete offer button, no `aria-label`
- `inbox.tsx:166` -- star email button, no `aria-label`
- `inbox.tsx:328` -- back to list button, no `aria-label`
- `properties.tsx:947` -- delete property button, no `aria-label`
- `properties.tsx:959` -- download deed button, no `aria-label`
- `properties.tsx:1051` -- open calculator button, no `aria-label`
- `status.tsx:51` -- refresh services button, no `aria-label`
- `automation.tsx:351,387,554,559` -- all CRUD icon buttons, none labeled
- `documents.tsx:522,532,540,665` -- version history, edit, delete, all unlabeled
- `founder-dashboard.tsx` -- 10 icon buttons for acknowledge, resolve, test, diagnose, delete, toggle, validate, approve, reject -- none have `aria-label`

**Positive note:** `leads.tsx` is notably better -- most of its icon buttons have `aria-label` values. `deals.tsx` stage-navigation buttons also have labels. `floating-help-button.tsx` and `theme-toggle.tsx` are properly labeled.

**Remediation:** Add `aria-label` to every `size="icon"` Button. Consider creating a lint rule (e.g. `eslint-plugin-jsx-a11y` `button-has-accessible-name`) to enforce this going forward.

---

### A11Y-03: Search and Filter Inputs Without Programmatic Labels
| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **WCAG** | 1.3.1 Info and Relationships (A), 4.1.2 Name, Role, Value (A) |
| **Location** | `leads.tsx:1177`, `audit-log.tsx:143`, `document-intelligence.tsx:280`, `voice-analytics.tsx:403`, multiple others |

**Description:** Search inputs across the application rely solely on `placeholder` text for their label. Placeholder text disappears on input and is not a valid accessible label per WCAG. These inputs have no `<label>`, `aria-label`, or `aria-labelledby` attribute.

**Evidence:**
- `leads.tsx:1177-1183`: `<Input placeholder="Search leads..." />` -- no label, no id, no `aria-label`
- `leads.tsx:1242-1246`: duplicate mobile search, also unlabeled
- `audit-log.tsx:143-148`: `<Input placeholder="Search actions, users, entities..." />` -- unlabeled
- `document-intelligence.tsx:280`: `<Input placeholder='Search documents...' />` -- unlabeled
- `voice-analytics.tsx:403-408`: `<Input placeholder="Search transcripts..." />` -- unlabeled

**Remediation:** Add `aria-label="Search leads"` (or equivalent) to each search Input, or use a visually-hidden `<Label>` with `htmlFor`.

---

### A11Y-04: Settings Page -- 2FA Code Input and Referral Link Input Missing Labels
| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **WCAG** | 1.3.1 Info and Relationships (A) |
| **Location** | `settings.tsx:1694-1701`, `settings.tsx:1877` |

**Description:** The 2FA verification code input and the referral link read-only input lack any programmatic label.

**Evidence:**
- `settings.tsx:1694`: `<Input placeholder="6-digit code" value={verifyCode} ... />` -- no label element, no id, no `aria-label`
- `settings.tsx:1877`: `<Input readOnly value={referralLink} />` -- no label, no `aria-label`
- `settings.tsx:2017,2021`: Date inputs for goals have a `<Label>` above them but no `htmlFor`/`id` binding

**Remediation:** Add `aria-label="Two-factor verification code"` to the 2FA input, `aria-label="Referral link"` to the referral input, and add `id` attributes to the date inputs that match `htmlFor` on their Label components.

---

### A11Y-05: Framer Motion Animations Ignore `prefers-reduced-motion`
| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **WCAG** | 2.3.3 Animation from Interactions (AAA, but best practice for AA) |
| **Location** | `client/src/lib/animations.ts`, `App.tsx` (AnimatePresence + pageTransition) |

**Description:** The animation library (`lib/animations.ts`) defines spring, fade, slide, and scale animations used across the app via framer-motion. Neither the animation definitions nor the `App.tsx` wrapper call `useReducedMotion()` or apply `MotionConfig reducedMotion="user"`. The CSS-level `@media (prefers-reduced-motion: reduce)` block in `index.css:943-961` only disables CSS animations/transitions on specific class names -- it cannot affect framer-motion JS animations.

**Evidence:**
- `lib/animations.ts`: 180 lines of animation variants with no reduced-motion check
- `index.css:943`: `@media (prefers-reduced-motion: reduce)` targets only `.sidebar-spring`, `.content-spring`, `.page-enter`, `.toast-enter`, `.popover-spring`, `.skeleton-shimmer`, `.badge-pulse`, and glass pseudo-elements -- not framer-motion `<motion.div>` elements
- Grep for `useReducedMotion` and `MotionConfig` across `client/src/` returns zero results
- Page transitions (`pageTransition` variants), stagger animations (`staggerContainer`/`staggerItem`), modal animations (`modalContent`/`modalOverlay`) all run regardless of user preference

**Remediation:** Wrap the app in `<MotionConfig reducedMotion="user">` at the root, or call `useReducedMotion()` in animation-heavy components and conditionally pass `initial={false}` with instant transitions.

---

### A11Y-06: No Focus Management on Route Changes
| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **WCAG** | 2.4.3 Focus Order (A) |
| **Location** | `App.tsx` (Router component), `page-shell.tsx` |

**Description:** When a user navigates between pages (e.g., Leads to Deals), focus is not programmatically moved to the new page content. The `Router` component in `App.tsx` uses `wouter` `<Switch>` with `React.Suspense` but does not manage focus after navigation. Screen reader users are left at an ambiguous focus position after route changes, often stuck at the sidebar or the previous page's last-focused element.

**Evidence:**
- `App.tsx:300-399`: `Router()` renders routes inside `<Switch>` with no `useEffect` to move focus after navigation
- `page-shell.tsx`: `<main>` has no `tabIndex={-1}` for programmatic focus
- Grep for `useEffect.*focus` and `.focus()` in page files returns only `pax.tsx` (textarea focus) and `command-center.tsx` (textarea focus) -- no route-level focus management

**Remediation:** Add a route-change effect in `App.tsx` or `PageShell` that calls `mainRef.current?.focus()` when the pathname changes, with `tabIndex={-1}` on the `<main>` element to make it focusable without appearing in the tab order.

---

### A11Y-07: Auth Page Loading Spinner Has No Accessible Status
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **WCAG** | 1.3.1 Info and Relationships (A) |
| **Location** | `auth-page.tsx:22-25` |

**Description:** While the user's Clerk session is loading, the auth page renders a spinning `<div>` with no text, `aria-label`, `role="status"`, or `aria-live` region. Screen reader users hear nothing during this loading state.

**Evidence:**
- `auth-page.tsx:22-25`: `<div className="min-h-screen flex ..."><div className="animate-spin h-8 w-8 border-2 ..." /></div>` -- no accessible attributes

**Positive note:** The `PageLoader` component in `App.tsx:221-227` does include `aria-label="Loading page"` and `aria-hidden="true"` on the spinner icon. This pattern should be extended to `auth-page.tsx`.

**Remediation:** Wrap the auth spinner in a `role="status"` container with `aria-label="Loading"`, or add a visually-hidden text element.

---

### A11Y-08: Floating Action Button Missing `aria-label` and Focus Trap
| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **WCAG** | 4.1.2 Name, Role, Value (A), 2.4.3 Focus Order (A) |
| **Location** | `client/src/components/floating-action-button.tsx:126-135` |

**Description:** The FAB toggle button has no `aria-label`. When open, the expanded action menu is a plain `<div>` with `<button>` elements -- not an `aria-expanded` / `aria-haspopup` pattern. There is no `aria-expanded` attribute reflecting state, and the expanded menu does not trap or manage focus.

**Evidence:**
- `floating-action-button.tsx:126-135`: `<Button size="lg" onClick={...} data-testid="fab-toggle">` -- no `aria-label`, no `aria-expanded`
- `floating-action-button.tsx:106-123`: expanded action items are plain `<button>` elements in a `<div>` without `role="menu"` or `role="listbox"`
- Escape key handler exists (line 81-88) but focus is not returned to the trigger button

**Remediation:** Add `aria-label="Quick actions"` and `aria-expanded={isOpen}` to the FAB button. Add `role="menu"` to the expanded container and `role="menuitem"` to each action button. Return focus to the FAB trigger on Escape/close.

---

### A11Y-09: 188 Hardcoded Hex Colors in Chart/Visualization Pages
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **WCAG** | 1.4.3 Contrast (Minimum) (AA), 1.4.11 Non-text Contrast (AA) |
| **Location** | `voice-analytics.tsx`, `freedom-meter.tsx`, `land-credit.tsx`, `forecasting.tsx`, `buyer-network.tsx`, `cash-flow.tsx`, `negotiation-copilot.tsx`, `fee-dashboard.tsx`, and others |

**Description:** 188 hardcoded hex color values (e.g., `#10b981`, `#ef4444`, `#f59e0b`, `#e5e7eb`, `#6366f1`) are used in Recharts chart components, SVG elements, and inline styles. These colors do not adapt to dark mode and several light-palette colors (e.g., `#e5e7eb` gray on a dark background, `#f59e0b` amber text on white) risk failing the 3:1 non-text contrast ratio.

**Evidence:**
- `freedom-meter.tsx:106`: `stroke="#e5e7eb"` on an SVG circle -- in dark mode this gray-200 is nearly invisible against a dark background
- `voice-analytics.tsx:34-40`: Status color map with hardcoded hex values that do not change for dark mode
- `forecasting.tsx:189`: `stroke="#f0f0f0"` for CartesianGrid -- invisible in dark mode
- `buyer-network.tsx:247-251`: Legend with hardcoded background colors

**Remediation:** Replace hardcoded colors with CSS custom properties or Tailwind theme tokens that adapt to dark mode. For Recharts, use `var(--chart-1)` etc. from the shadcn chart color system (already present in `ui/chart.tsx`).

---

### A11Y-10: 234 Instances of Raw Tailwind Color Classes Bypassing Theme System
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **WCAG** | 1.4.3 Contrast (Minimum) (AA) |
| **Location** | 39 page files including `onboarding-v2.tsx` (81 instances), `field-scout.tsx` (62), `night-cap.tsx` (23), `founder-dashboard.tsx` (5), `today.tsx` (3) |

**Description:** Raw Tailwind color utilities like `text-gray-500`, `bg-gray-100`, `text-slate-600` are used instead of semantic theme tokens (`text-muted-foreground`, `bg-muted`, etc.). These colors have fixed values that do not invert or adjust in dark mode, leading to potential contrast failures.

**Evidence:**
- `onboarding-v2.tsx`: 81 instances of `text-gray-*` / `bg-gray-*` -- this page is particularly problematic as it is a critical onboarding flow
- `deal-hunter.tsx:81`: `bg-gray-100 text-gray-600` for status badges -- in dark mode, gray-100 background on dark surface is almost invisible
- `team-leaderboard.tsx:68`: `bg-gray-100 text-gray-600` for rank badges
- `today.tsx:704-708`: Uses `dark:` prefixed overrides for some alert colors but not consistently

**Remediation:** Replace raw color classes with semantic tokens. For cases that need color distinction (like badges), use the `dark:` prefix variants or CSS custom properties.

---

### A11Y-11: Lead and Deal Tooltipped Icon Buttons Missing `aria-label`
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **WCAG** | 4.1.2 Name, Role, Value (A) |
| **Location** | `leads.tsx:1473-1518` |

**Description:** The call, email, and note icon buttons in the leads table are wrapped in `<Tooltip>` components for visual users, but the tooltip text is not exposed as the button's accessible name. Radix Tooltip does not automatically set `aria-label` on the trigger element -- it uses `aria-describedby` (supplementary text) rather than `aria-labelledby` (the name). Buttons that use only an icon with a Tooltip still need an explicit `aria-label`.

**Evidence:**
- `leads.tsx:1473-1486`: Call button wrapped in `<Tooltip>` with `<TooltipContent>Call {lead.phone}</TooltipContent>` but no `aria-label` on the Button
- `leads.tsx:1491-1504`: Email button, same pattern
- `leads.tsx:1507-1518`: Note button, same pattern

**Remediation:** Add `aria-label` to each Button in addition to the Tooltip, e.g., `aria-label={`Call ${lead.phone}`}`.

---

### A11Y-12: Pax Copilot Rail -- 12 Unlabeled Icon Buttons
| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **WCAG** | 4.1.2 Name, Role, Value (A) |
| **Location** | `client/src/components/pax-copilot-rail.tsx` (lines 1060, 1069, 1080, 1092, 1130, 1143, 1153, 1166, 1632, 1647, 1670, 1675) |

**Description:** The Pax Copilot Rail is a primary AI interaction surface. It contains 12 icon-only buttons (knowledge, connectors, projects, memory, settings, new chat, voice, close, attach, send, stop, send-again) -- none have `aria-label`. A screen reader user cannot distinguish any of these controls.

**Evidence:**
- `pax-copilot-rail.tsx:1060`: Knowledge button -- no label
- `pax-copilot-rail.tsx:1069`: Connectors button -- no label
- `pax-copilot-rail.tsx:1166`: Close rail button -- no label
- `pax-copilot-rail.tsx:1670`: Stop generation button -- no label
- `pax-copilot-rail.tsx:1675`: Send message button -- no label

**Remediation:** Add `aria-label` to each icon button in the copilot rail.

---

### A11Y-13: Conversation Tray -- 7 Unlabeled Icon Buttons
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **WCAG** | 4.1.2 Name, Role, Value (A) |
| **Location** | `client/src/components/conversation-tray.tsx` (lines 116, 188, 319, 398, 548, 569, 582) |

**Description:** The conversation tray (email/SMS reply drawer) has 7 icon buttons for navigation, send, attach, and close -- all missing `aria-label`.

**Remediation:** Add `aria-label` to each.

---

### A11Y-14: `aria-live` Regions Sparse -- Status Updates Not Announced
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **WCAG** | 4.1.3 Status Messages (AA) |
| **Location** | Application-wide |

**Description:** Only 4 `aria-live` regions exist in the entire app: `dynamic-island.tsx`, `cookie-consent-banner.tsx`, `form.tsx` (error messages), and the toast viewport. Bulk operations (e.g., "3 leads updated"), filter result counts, loading completions, and real-time data refreshes are not announced to screen readers.

**Evidence:**
- Deals page: Bulk update success shows a toast (which is in an `aria-live` region via the toaster -- this works)
- Leads page: Filter result count changes silently -- screen reader users do not know how many results remain
- Founder dashboard: Agent status changes, health checks completing -- no announcements

**Remediation:** Add `aria-live="polite"` to filter result count elements and operation status messages across key pages.

---

### A11Y-15: Auth Page Toggle Button Missing Focus Ring
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **WCAG** | 2.4.7 Focus Visible (AA) |
| **Location** | `auth-page.tsx:43-47` |

**Description:** The "Need an account? Sign up" / "Already have an account? Sign in" toggle is a raw `<button>` with only `hover:text-foreground` styling. The global `focus-visible` ring defined in `index.css:451-453` should apply, but the button's `transition-colors` class and lack of `rounded` may cause the ring to render oddly. This should be verified visually.

**Evidence:**
- `auth-page.tsx:43`: `<button ... className="text-sm text-muted-foreground hover:text-foreground transition-colors">` -- relies on global focus ring but no explicit focus style or rounding

**Remediation:** Add `rounded-md` or use the `Button` component with `variant="ghost"` to ensure consistent focus styling.

---

### A11Y-16: Onboarding Wizard Dialog Not Using DialogTitle in All Steps
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **WCAG** | 4.1.2 Name, Role, Value (A) |
| **Location** | `client/src/components/onboarding-wizard.tsx` |

**Description:** The onboarding wizard uses `<Dialog>` with `<DialogContent>`. Radix Dialog requires a `DialogTitle` for the accessible name. If any wizard step omits `DialogTitle`, the dialog has no accessible name and screen readers announce it generically as "dialog".

**Evidence:** The component imports `DialogTitle` but uses it conditionally per step. Steps that show card grids or action lists may omit the title. This needs manual verification per step.

**Remediation:** Ensure every dialog state includes a `<DialogTitle>` (it can be visually hidden with `className="sr-only"` if needed).

---

---

## Embarrassment Test

> "If a journalist or a blind power-user live-streamed themselves trying to use AcreOS, what would embarrass us?"

1. **The skip link does nothing.** A keyboard user pressing Tab on page load sees "Skip to content" appear, presses Enter, and nothing happens. The page does not scroll or move focus.
2. **87% of icon buttons are silent.** A screen reader user navigating the Deals page hears "button, button, button, button" for delete, close, stage-left, stage-right controls -- with no way to distinguish them.
3. **The Pax AI copilot is unusable.** The primary AI assistant rail has 12 unlabeled buttons -- a screen reader user literally cannot send a message or close the panel.
4. **Animations play for users who opted out.** A user with `prefers-reduced-motion: reduce` still sees framer-motion page transitions, stagger animations, and modal scale-ins.

## Pride Test

> "What would we proudly point to?"

1. **FormMessage component with `role="alert"` and `aria-live="polite"`** -- `form.tsx:158-171` correctly announces validation errors to screen readers with the AlertCircle icon marked `aria-hidden`.
2. **FormControl wires `aria-describedby` and `aria-invalid` automatically** -- `form.tsx:107-126` means any form using the `FormField` pattern gets proper error association for free.
3. **Sidebar has full ARIA support** -- `layout-sidebar.tsx:601` uses `aria-label="Main navigation"`, links use `aria-current="page"`, and the collapse/expand toggle has descriptive `aria-label`.
4. **Global focus-visible ring** -- `index.css:451-453` provides a consistent, visible focus indicator via `ring-2 ring-primary/40` on all focusable elements.
5. **Mobile bottom nav "More" button has `aria-label`** -- `MobileBottomNav.tsx:67` properly labels the overflow button.
6. **Sheet close button has `sr-only` text** -- `sheet.tsx:69-71` uses `<span className="sr-only">Close</span>` -- proper pattern.
7. **Dialog close button has `aria-label="Close"`** -- `dialog.tsx:63` labels the traffic-light close button.
8. **Toast viewport has `aria-live="polite"` and `aria-label="Notifications"`** -- `toaster.tsx:30`.
