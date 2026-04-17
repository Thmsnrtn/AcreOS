# Lens 23 -- Accessibility Designer Audit

**Auditor perspective:** Cognitive accessibility, reading order, touch target sizing, error prevention, destructive action safety, color-only information, and inclusive design patterns.
**Date:** 2026-04-15
**Scope:** Client-side React/TypeScript/Tailwind/shadcn codebase -- critical user paths (onboarding, leads, deals, properties, offers, settings, founder dashboard) plus shared components. Findings here complement but do not duplicate Lens 08 (engineering accessibility).

---

## Executive Summary

AcreOS has structural design-level accessibility gaps that create cognitive barriers on critical paths. The onboarding flow hardcodes a dark color palette that cannot adapt to user system preferences, uses a non-semantic progress bar, and presents motivation scores with color as the sole differentiator. Across the application, 11 destructive actions (delete offer, delete template, delete task, remove webhook, remove marketplace listing, delete goal, and others) fire immediately on click with no confirmation dialog, meaning a single mis-tap permanently destroys data. The founder dashboard -- the primary operational surface -- uses a custom tab bar without ARIA tab semantics and packs 7,286 lines of UI into a single view with 30+ state variables, creating overwhelming cognitive load. Status indicators throughout the application rely on small colored dots (2px-3px circles) as the sole means of conveying agent status, deal health, and system state, failing users with color vision deficiencies.

---

## Findings

### AD-01: Destructive Actions Without Confirmation on 11 Surfaces
| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Principle** | Error prevention (Nielsen heuristic 5), WCAG 3.3.4 Error Prevention (Legal, Financial, Data) |
| **Location** | `offers.tsx:427`, `documents.tsx:541`, `tasks.tsx:624`, `webhooks.tsx:220`, `marketplace.tsx:1013`, `settings.tsx:2071`, `market-watchlist.tsx:320`, `listings.tsx:630`, `tax-optimization.tsx:379` |

**Description:** Eleven destructive actions across the application execute immediately on a single click with no confirmation step. The core CRM pages (deals, leads, properties) properly use `ConfirmDialog` or `SafeBulkDeleteDialog` before deletion, but secondary pages do not. A single accidental tap on mobile -- or a misclick on desktop -- permanently destroys data.

**Evidence:**
- `offers.tsx:427`: Individual offer delete calls `deleteOfferMutation.mutate(offer.id)` directly in `onClick` -- no confirmation dialog
- `documents.tsx:541`: Template delete calls `deleteTemplateMutation.mutate(template.id)` directly -- no confirmation
- `tasks.tsx:624`: Task delete calls `deleteMutation.mutate(task.id)` directly -- no confirmation
- `webhooks.tsx:220`: Webhook endpoint removal calls `removeEndpoint(ep.url)` directly -- no confirmation
- `marketplace.tsx:1013`: Listing removal calls `removeMutation.mutate(listing.id)` directly -- no confirmation
- `settings.tsx:2071`: Goal delete calls `deleteGoal.mutate(goal.id)` directly -- no confirmation
- `market-watchlist.tsx:320`: Watchlist entry removal -- no confirmation
- `listings.tsx:630`: Listing delete -- no confirmation
- `tax-optimization.tsx:379`: Tax strategy delete -- no confirmation

**Contrast with good pattern:** `deals.tsx:809-829` uses `ConfirmDialog` with a clear title, description mentioning irreversibility, loading state, and destructive variant. `privacy-settings.tsx:156-188` requires typing "DELETE MY DATA" for account deletion -- the strongest confirmation pattern in the codebase. `leads.tsx` uses `SafeBulkDeleteDialog` with a preview of affected records.

**Impact:** On mobile, where touch targets are close together and mis-taps are common, a user browsing their offer list could accidentally delete an offer with no way to recover it. The offers page is a critical path page (deal lifecycle step 3 in the orientation doc).

---

### AD-02: Color-Only Status Dots for Agent, Deal Health, and System State
| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Principle** | WCAG 1.4.1 Use of Color (A), Cognitive accessibility |
| **Location** | `command-center.tsx:360,536`, `deals.tsx:749`, `founder-dashboard.tsx:749,6063,6289,6357,6904,7146`, `team-inbox.tsx:78`, `today.tsx:504`, `pax.tsx:285` |

**Description:** Agent status, deal health, pipeline pulse, and system state are conveyed solely through small colored dots (2px-3px circles) with no accompanying text label, icon, or pattern. A user with deuteranopia (red-green color blindness, ~8% of males) cannot distinguish between a green "active" dot and a red "stalled" dot, or between "healthy" (emerald) and "warning" (amber).

**Evidence:**
- `command-center.tsx:360`: Agent status shown as `<div className="w-2 h-2 rounded-full ${getAgentStatusColor(agent.status)}" />` -- active=green, idle=amber, disabled=gray. No text, no tooltip, no pattern.
- `deals.tsx:89-93`: `HEALTH_DOT` maps `healthy` to `bg-emerald-500`, `warning` to `bg-amber-400`, `stalled` to `bg-red-500` -- these are 2px dots with no label.
- `founder-dashboard.tsx:6063,6289`: System status dots use the same color-only pattern.
- `founder-dashboard.tsx:6904`: Decision urgency dots: green/amber/red with no text label.
- `today.tsx:504`: Pipeline pulse indicator is a single 2px dot that is either green+pulsing or gray.

**Contrast with good pattern:** `deals.tsx:1160` uses `Badge` with both color AND text label for deal status (e.g., "Offer Sent" in blue, "Cancelled" in red). The `getStatusColor` function in `command-center.tsx:177` is used for Badge backgrounds which include text -- only the small dot version omits text.

**Impact:** The founder dashboard and command center are high-traffic operational surfaces where misreading a status dot could mean ignoring a stalled deal or a disabled agent.

---

### AD-03: Onboarding Progress Bar Is Non-Semantic (No ARIA Role)
| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Principle** | WCAG 4.1.2 Name, Role, Value (A), Cognitive accessibility |
| **Location** | `onboarding-v2.tsx:1098-1103` |

**Description:** The onboarding flow's progress indicator is a raw `<div>` with a width percentage, not the Radix `<Progress>` component used elsewhere in the app. It has no `role="progressbar"`, no `aria-valuenow`, no `aria-valuemin`, no `aria-valuemax`, and no accessible label. A screen reader user has no indication of how far through onboarding they are.

**Evidence:**
```
<div className="h-1 bg-gray-900">
  <div
    className="h-1 bg-emerald-500 transition-all duration-500"
    style={{ width: `${progress}%` }}
  />
</div>
```
The "Step X of Y" text at line 1109 is visual-only and not programmatically associated with the progress bar.

**Contrast with good pattern:** The `<Progress>` component in `components/ui/progress.tsx` uses `@radix-ui/react-progress` which automatically provides `role="progressbar"` and ARIA value attributes.

**Impact:** Onboarding is the first experience for every new user. A screen reader user literally cannot tell where they are in the flow.

---

### AD-04: Onboarding Hardcodes Dark Palette -- Ignores System Theme Preference
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Principle** | Inclusive design, WCAG 1.4.3 Contrast (Minimum) |
| **Location** | `onboarding-v2.tsx` (81 instances of raw gray-*/emerald-*/blue-* Tailwind classes) |

**Description:** The onboarding-v2 page hardcodes a dark-mode-only color scheme using classes like `bg-gray-950`, `text-white`, `bg-gray-900`, `text-gray-400`, `border-gray-700`, etc. These 81 raw color references do not respect the application's theme system or the user's `prefers-color-scheme` setting. A user with a light theme preference, or one who needs high contrast, is forced into a dark palette with no option to change it.

**Evidence:**
- `onboarding-v2.tsx:1096`: `<div className="min-h-screen bg-gray-950 flex flex-col">` -- forces dark background
- `onboarding-v2.tsx:211,214,228,257,274,278,305,314,315`: Text uses `text-gray-400`, `text-gray-500`, `text-gray-600` -- these mid-grays on a dark background may pass contrast but do not adapt to light mode
- `onboarding-v2.tsx:408`: `border-2 border-dashed border-gray-700` -- invisible in light mode
- `onboarding-v2.tsx:556,563`: Form inputs use `bg-gray-900 border-gray-700 text-white` -- not theme-aware

**Impact:** The onboarding flow is the very first screen a new user sees. Forcing a dark palette excludes users who rely on light mode for readability (e.g., users with certain visual impairments, photosensitivity in reverse, or simply preference).

---

### AD-05: Motivation Score on Onboarding Uses Color as Sole Severity Indicator
| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Principle** | WCAG 1.4.1 Use of Color (A), Cognitive accessibility |
| **Location** | `onboarding-v2.tsx:262-275` |

**Description:** The "Instant Deal Hunt" step -- described as the "#1 aha moment" in code comments -- displays motivation scores with color as the only way to distinguish severity. Scores >= 80 are red, >= 65 are yellow, and below are gray. There is a letter grade (A/B/C) next to the number which partially mitigates this, but the deal card borders also use color-only encoding: the first card has a red border, the second yellow, the third gray, with no label explaining why.

**Evidence:**
- `onboarding-v2.tsx:240-248`: Card border colors (`border-red-500/50`, `border-yellow-500/30`, `border-gray-700`) distinguish deal priority. No text label like "Highest priority" or "Hot" accompanies the second or third cards.
- `onboarding-v2.tsx:262-270`: Score text color changes based on value but the letter grade partially compensates.
- `onboarding-v2.tsx:251`: Only the first card has a "Hot Deal" badge -- the ranking of subsequent cards is conveyed only by border color and position.

**Impact:** A colorblind user seeing three cards with indistinguishable borders and similar number scores has no way to understand the prioritization. This is the moment designed to hook new users.

---

### AD-06: Founder Dashboard Custom Tab Bar Lacks ARIA Tab Semantics
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Principle** | WCAG 4.1.2 Name, Role, Value (A), WAI-ARIA Tabs pattern |
| **Location** | `founder-dashboard.tsx:1965-1979` |

**Description:** The founder dashboard's tab navigation is built with plain `<button>` elements in a `<div>`. It has no `role="tablist"` on the container, no `role="tab"` on the buttons, no `aria-selected` reflecting the active tab, and no `role="tabpanel"` on the content sections. All other tabbed interfaces in the app use the Radix `<Tabs>` component (via `components/ui/tabs.tsx`) which provides these semantics automatically. The founder dashboard is the only page that reimplements tabs manually without ARIA.

**Evidence:**
- `founder-dashboard.tsx:1965`: `<div className="flex items-center gap-1 border-b mb-6 overflow-x-auto pb-px">` -- no `role="tablist"`
- `founder-dashboard.tsx:1967-1978`: Each tab is a plain `<button>` with visual styling for active state but no `role="tab"` or `aria-selected`
- Content sections at lines 2024-2144 use `className` toggling with `hidden` -- no `role="tabpanel"` or `aria-labelledby`

**Impact:** Screen reader users navigating the founder dashboard hear "button, button, button, button, button" instead of "tab, selected, Overview; tab, Agents; tab, Operations; tab, Growth; tab, Infrastructure" -- losing all context about the navigation pattern.

---

### AD-07: `window.confirm()` Used for Destructive Actions on Two Critical Paths
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Principle** | Error prevention, Cognitive accessibility, Consistent interaction patterns |
| **Location** | `deals.tsx:1754`, `leads.tsx:1092` |

**Description:** Two critical-path interactions use the browser's native `window.confirm()` dialog instead of the app's `ConfirmDialog` component. The native dialog is unstyled, cannot be customized for clarity, breaks the visual design language, and varies in appearance across browsers and assistive technologies. It also blocks the main thread.

**Evidence:**
- `deals.tsx:1754`: `if (confirm('This will replace the current checklist. Continue?'))` -- replacing a deal checklist is potentially destructive and should use `ConfirmDialog` with a description of what will be lost
- `leads.tsx:1092`: `window.confirm('You have unsaved changes. Discard them?')` -- discarding form changes. While less critical than data deletion, this breaks pattern consistency

**Impact:** Users encounter two different confirmation UI patterns (native browser dialog vs. styled AlertDialog) for similar severity actions, increasing cognitive overhead. Screen reader users may find the native dialog announced differently from the app's accessible AlertDialog.

---

### AD-08: Cognitive Overload on Founder Dashboard -- 30+ State Variables, 7,286 LOC
| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Principle** | Cognitive accessibility, Progressive disclosure, Recognition over recall |
| **Location** | `founder-dashboard.tsx` (entire file) |

**Description:** The founder dashboard is a single 7,286-line component with 30+ `useState` calls, 15+ queries loading simultaneously (throttled by `activeTab`), and 5 major tab panels that each contain multiple subsections with their own cards, tables, and interactive elements. The "Overview" tab alone renders revenue metrics, agent status, growth stats, MRR goal progress, pipeline health, system health checks, and a briefing section. While a "focus mode" exists (line 1107), it is discoverable only via the keyboard shortcut "F" -- there is no visible toggle for it until activated, and it is not documented in the UI.

**Evidence:**
- Lines 1080-1113: Over 30 state variables declared in a single function body
- Lines 1163-1421: 15 queries, many enabled simultaneously depending on tab
- Lines 2024-2655: Overview + Growth tabs render a combined 600+ lines of dense metric cards
- Focus mode toggle (line 1958) only appears after pressing "F" -- it is not discoverable through normal browsing
- The keyboard shortcuts helper (line 1105, `showShortcuts`) requires pressing "?" -- also not discoverable through the UI

**Impact:** Users with attention disorders (ADHD), cognitive disabilities, or even neurotypical users experiencing decision fatigue face an overwhelming interface. The lack of progressive disclosure means all complexity is presented at once. The hidden keyboard shortcuts for focus mode mean the one mitigation is essentially invisible.

---

### AD-09: Touch Targets Below 44x44px on Secondary Action Buttons
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Principle** | WCAG 2.5.8 Target Size (Minimum) (AA), Mobile usability |
| **Location** | `settings.tsx:2070`, `webhooks.tsx:219`, `marketplace.tsx:1011`, `agent-command-center.tsx:264` |

**Description:** While the core CRM pages (leads, deals, properties) consistently apply `min-h-[44px] min-w-[44px]` to icon buttons on mobile, secondary pages use smaller touch targets. Settings page goal delete buttons are `h-7 w-7` (28x28px). Webhook remove buttons are `h-8 w-8` (32x32px). Marketplace listing delete buttons are `h-8 w-8` (32x32px). These fall below the WCAG 2.5.8 minimum of 44x44 CSS pixels.

**Evidence:**
- `settings.tsx:2070`: `className="h-7 w-7 text-muted-foreground hover:text-destructive"` -- 28x28px delete button for goals
- `webhooks.tsx:219`: `className="h-8 w-8"` -- 32x32px remove button for webhook endpoints
- `marketplace.tsx:1011`: `className="text-destructive hover:text-destructive h-8 w-8"` -- 32x32px delete button
- `agent-command-center.tsx:264`: Badges with `text-[10px] px-1.5 py-0` -- interactive-looking status badges that may be tap targets

**Positive note:** `deals.tsx` consistently uses `min-h-[44px] min-w-[44px]` on all icon buttons and tab triggers. `leads.tsx:1099` uses `min-h-[44px]` on the Add New Lead button.

---

### AD-10: Inline Error Component Lacks `role="alert"` for Screen Reader Announcement
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Principle** | WCAG 4.1.3 Status Messages (AA) |
| **Location** | `components/inline-error.tsx:6` |

**Description:** The `InlineError` component (used on leads, deals, and properties pages) renders error messages without `role="alert"` or `aria-live`. When a page load fails and the inline error appears, screen reader users are not automatically notified -- they must manually navigate to discover the error.

**Evidence:**
- `inline-error.tsx:6`: `<div className="p-3 border rounded-md bg-destructive/5 ..." data-testid={...}>` -- no `role="alert"`, no `aria-live`

**Contrast with good pattern:** The `FormMessage` component in `ui/form.tsx:163-164` correctly uses `role="alert"` and `aria-live="polite"` for form validation errors.

---

### AD-11: Text at 10px Font Size on Data-Dense Pages
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Principle** | WCAG 1.4.4 Resize Text (AA), Cognitive accessibility, Readability |
| **Location** | `agent-command-center.tsx` (15 instances), `today.tsx` (8 instances), `pipeline.tsx` (6 instances), `founder-dashboard.tsx` (5 instances) |

**Description:** Over 30 instances of `text-[10px]` (10px font size) are used across data-dense pages for labels, badge text, and metadata. At 10px, text is below the generally recommended minimum of 12px for body text and may become illegible on lower-resolution displays or for users with mild vision impairments who have not configured browser zoom.

**Evidence:**
- `agent-command-center.tsx:206,210,214,220,229,264,269,282,695,755,756,763,764,771,772`: Labels and status badges at 10px
- `today.tsx:512,521,526,529,534,539,544,553`: Pipeline micro-metrics at 10px
- `pipeline.tsx:145,170,171,185,194,207`: Funnel chart labels and stage counts at 10px

**Impact:** These pages present critical operational data. Users who rely on this information for decision-making (e.g., "how many deals are stalled?") must read 10px text to get the answer.

---

### AD-12: No Back Navigation in Onboarding Wizard
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Principle** | Error prevention, User control and freedom (Nielsen heuristic 3) |
| **Location** | `onboarding-v2.tsx:972-1118` |

**Description:** The onboarding wizard provides a "Step X of Y" indicator and a "Skip setup" link, but there is no "Back" button to return to a previous step. If a user selects the wrong investor path (beginner/active/enterprise) or enters the wrong county, they must either complete the entire flow or skip setup entirely and start over. The automation wizard in `automation.tsx:454` provides a "Back" button -- the onboarding flow does not follow this pattern.

**Evidence:**
- `onboarding-v2.tsx:1095-1118`: Header area contains "Step X of Y" text and "Skip setup" link, but no back button
- `onboarding-v2.tsx:1002`: `advance()` function only increments `currentStepIndex` -- no `goBack()` equivalent exists
- Contrast: `automation.tsx:454-456`: `{wizardStep > 1 && <Button type="button" variant="outline" onClick={() => setWizardStep(s => s - 1)}>Back</Button>}`

**Impact:** A new user who accidentally selects "Enterprise" instead of "Beginner" (the first choice in the funnel) is funneled into team setup and integration configuration that is irrelevant to them, with no way to go back.

---

## Embarrassment Test

> "If a cognitive accessibility researcher or a user with ADHD live-tested AcreOS, what would embarrass us?"

1. **Deleting an offer takes one tap with no undo.** A user scrolling through their offers list accidentally taps the trash icon and the offer is gone. No confirmation, no undo, no recovery. Meanwhile, deleting a lead pops up a detailed confirmation dialog.
2. **The founder dashboard is a wall of data with a hidden escape hatch.** The only way to reduce the information overload is to press "F" on the keyboard, which is never mentioned in the visible UI. A user with ADHD sees every metric, every agent, every alert at once.
3. **Onboarding forces dark mode.** A user who relies on light mode for readability opens AcreOS for the first time and is hit with a `bg-gray-950` screen they cannot change.
4. **Colored dots are the only way to know if an agent is running.** An 8% of male users with color vision deficiency cannot distinguish the green "active" dot from the red "stalled" dot in the command center.

## Pride Test

> "What would we proudly point to?"

1. **44px touch targets on core CRM pages.** `deals.tsx` consistently uses `min-h-[44px] min-w-[44px]` on icon buttons and tab triggers, even adding `touch-manipulation` for responsive feel.
2. **ConfirmDialog for core deletes.** Deals, leads, properties, finance notes, counties, workflows, and automation rules all use a well-designed `ConfirmDialog` with clear titles, irreversibility warnings, loading states, and destructive styling.
3. **SafeBulkDeleteDialog on leads.** The leads bulk delete shows a preview of exactly which records will be deleted, with name, email, phone, and status visible before the user confirms.
4. **Privacy settings "type to confirm" pattern.** Account data deletion requires typing "DELETE MY DATA" -- the strongest error prevention pattern in the app, appropriate for the severity of the action.
5. **Deals bulk stage update with undo.** `deals.tsx:317-338` provides an "Undo" button in the success toast after bulk stage updates, allowing recovery within the toast duration.
6. **EmptyState components across 20 files.** Zero-data states are handled with purposeful CTAs rather than blank screens, reducing confusion for new users.
