# DEVEREUX CRANE — Accessibility Audit

**Wave 2 / Persona 13 of 87 · 2026-05-01**
*Ex-Microsoft accessibility lead, ex-WebAIM consultant.*
Scope: WCAG 2.2 AA across the AcreOS client (`/client/src`), with a special
eye on older Land Investors who rely on screen readers, keyboard-only
navigation, or 200% zoom.

---

## 1 · Verdict

**WCAG 2.2 AA — PARTIAL PASS, with two systemic failures and ~12 spot defects.**

The bones are unusually good for a 2026 React app: Radix primitives are doing
their job, `MotionConfig reducedMotion="user"` is wired at the App root, a
global `prefers-reduced-motion` CSS sweep collapses every transition, the
shadcn `<Button>` primitive enforces a 44×44 touch target on mobile, and a
`SkipToContent` component exists. **What stops this from being a clean AA**
is two patterns repeated across hundreds of files: (1) raw `<button>` HTML
elements used for icon-only controls without `aria-label`, and (2) Recharts
chart palettes hardcoded to vivid 8-colour rainbows that fail 3:1 against
several theme backgrounds. Neither is hard to fix; both have to be fixed
before a screen-reader user or a 70-year-old with macular degeneration can
actually run their parcel pipeline.

---

## 2 · Per-Criterion Audit (WCAG 2.2 AA)

| SC | Criterion | State | Notes |
|----|-----------|-------|-------|
| 1.1.1 | Non-text content | **PARTIAL** | Lucide icons inside `<Button>` are mostly `aria-hidden`; raw `<button>` icon-only elements (55 instances) lack labels |
| 1.3.1 | Info & relationships | PASS | Form primitive (`form.tsx:117`) wires `aria-describedby` correctly |
| 1.3.2 | Meaningful sequence | PASS | DOM order matches visual order in scanned pages |
| 1.4.3 | Contrast (Minimum) | **PARTIAL** | `--acr-ink-3` (#8F7A52 on #FAF4E8) = 3.31:1 — fails AA for body text |
| 1.4.4 | Resize text | UNTESTED | Tailwind uses rem; spot-check at 200% needed |
| 1.4.10 | Reflow | PASS | Mobile breakpoints in `layout-sidebar.tsx`, `MobileBottomNav` |
| 1.4.11 | Non-text contrast | **PARTIAL** | `--acr-line: rgba(80,40,15,0.14)` borders on `--acr-bg` ≈ 1.4:1, fails 3:1 |
| 1.4.12 | Text spacing | PASS | No fixed line-heights blocking spacing overrides |
| 1.4.13 | Content on hover/focus | PASS | Tooltip is Radix; dismissible & hoverable |
| 2.1.1 | Keyboard | **PARTIAL** | `<div onClick>` patterns in `pax-copilot-rail.tsx`, `command-palette.tsx`, `parcels` lists |
| 2.1.2 | No keyboard trap | PASS | Radix dialogs handle this |
| 2.2.1 | Timing adjustable | UNCLEAR | Demo mode auto-advances; no pause for screen reader users (though pause button exists) |
| 2.4.1 | Bypass blocks | PASS | `SkipToContent` + `id="main-content"` in App.tsx:940 |
| 2.4.2 | Page titled | **FAIL** | No `<title>` updates per route — every page reads "AcreOS" |
| 2.4.3 | Focus order | PASS | Spot-checked deal-detail, settings, leads — logical |
| 2.4.4 | Link purpose | PASS | Most CTAs are descriptive |
| 2.4.6 | Headings & labels | **PARTIAL** | `settings.tsx` has both `h1` and bare `h2`s and skips to `h4` (line 543) |
| 2.4.7 | Focus visible | PASS | `focus-visible:ring-1 focus-visible:ring-ring` on Button; index.css:998 has stronger global rule |
| 2.4.11 | Focus not obscured (NEW 2.2) | UNCLEAR | Sticky `PageTopbar` may cover focused element on Tab — needs scroll-margin |
| 2.5.5 | Target size | PASS | `max-sm:h-11 max-sm:w-11` on `Button` icon (button.tsx:30) |
| 2.5.8 | Target size minimum (2.2) | **PARTIAL** | Desktop icon buttons at `h-7 w-7` (pax-copilot-rail) = 28px |
| 3.2.1 | On focus | PASS | No focus-triggered context changes spotted |
| 3.3.1 | Error identification | PASS | shadcn FormMessage shows errors |
| 3.3.2 | Labels or instructions | PASS | Form primitive enforces label association |
| 4.1.2 | Name, role, value | **PARTIAL** | Custom `<div role="img">` step indicator in `live-demo-mode.tsx:284` good; raw `<button>`s missing `aria-label` are not |
| 4.1.3 | Status messages | PASS | `aria-live="polite"` on dynamic-island, list-skeleton, property-analysis-chat |

**Two systemic fails:** SC 1.1.1 and SC 1.4.3.
**One brand-new 2.2 fail:** SC 2.5.8 on the dense compact rails.
**One easy fail:** SC 2.4.2 (route titles) — a one-day fix.

### Notes on what's already excellent

Worth calling out before the failures eclipse them, because most React apps
of this size don't have these:

- **Reduced motion** is *correctly layered.* `App.tsx:1077` wraps the tree in
  `<MotionConfig reducedMotion="user">` (so framer-motion respects the OS),
  `index.css:57` collapses CSS custom-property durations to 30–60ms via
  `[data-motion="reduced"]:root`, and `index.css:1532` has a global wildcard
  override that nukes every `animation-duration` and `transition-duration` to
  `0.001ms`. Plus user-controllable opt-in/out in Settings (`use-sound.ts:36`,
  `theme-context.tsx:35`). That is textbook layered support — better than
  most enterprise SaaS ships in 2026.
- **Touch targets** — `button.tsx:23-30` enforces `max-sm:min-h-11` on every
  size variant including `icon`. WCAG 2.5.5 satisfied on mobile.
- **Form primitive** — `form.tsx:117` does the `aria-describedby` dance with
  description + error IDs. Errors and helper text both announce.
- **Live regions are already deployed** in 14+ places (dynamic-island,
  list-skeleton, property-analysis-chat, campaign-variants-panel,
  cookie-consent-banner). The pattern is established; just extend it.
- **Sidebar landmark labels** (`layout-sidebar.tsx:849, 1201`) — desktop +
  mobile variants both explicitly labelled, so VoiceOver rotor doesn't show
  two "navigation" entries with the same name.

---

## 3 · Top-15 Specific Failures

| # | File:Line | WCAG | Defect | Fix |
|---|-----------|------|--------|-----|
| 1 | `client/src/components/pax-thinking-block.tsx:17` | 1.1.1, 4.1.2 | Raw `<button>` toggle with chevron icon, no `aria-label`, no `aria-expanded` | Add `aria-label="Show reasoning"` and `aria-expanded={open}` |
| 2 | `client/src/components/pax-copilot-rail.tsx:1341,1547,1557,1589,1622` | 1.1.1 | Five raw icon-only `<button>` controls in chat composer (insert, voice, attach, clear, send) without labels | Replace with shadcn `<Button size="icon" aria-label=...>`; the 7 other instances in this file already use `<Button>` |
| 3 | `client/src/components/layout-sidebar.tsx:1033,1334,1504` | 1.1.1, 4.1.2 | Sidebar collapse / pin / mobile-close buttons are raw `<button>` with no label | Add `aria-label="Collapse sidebar"` etc.; consider `aria-pressed` on toggle |
| 4 | `client/src/components/activity-content.tsx:143` | 1.1.1 | `<Button asChild size="icon">` wrapping an `<a>` with only a chevron icon, no aria-label | Add `aria-label="Open activity ${activity.title}"` |
| 5 | `client/src/components/dashboard/TasksDueWidget.tsx:88` | 1.1.1 | Icon-only "view all" `<Button asChild size="icon">` link with no label | Add `aria-label="View all tasks due"` |
| 6 | `client/src/index.css:116` (and 4 other themes) | 1.4.3 | `--acr-ink-3: #8F7A52` on `--acr-bg: #FAF4E8` = **3.31:1** — fails AA for body text. Used as `text-muted-foreground` widely | Darken to `#6F5E3D` (4.7:1) for light, `#A89876` for dark |
| 7 | `client/src/components/analytics-content.tsx:40` | 1.4.3, 1.4.11 | Hardcoded chart palette `['#0088FE', '#00C49F', '#FFBB28', ...]` — `#FFBB28` on light bg = 1.7:1; fails for chart text labels | Switch to theme tokens (`--acr-chart-1..8`); add stripe/icon overlays for dual-encoding |
| 8 | `client/src/pages/voice-analytics.tsx:41`, `pages/portfolio-optimizer.tsx:49`, `pages/regulatory-intel.tsx:283` | 1.4.1 | Status communicated by colour alone (red/green/amber risk swatches); no text or icon backup for colour-blind users | Pair every coloured chip with an icon (`AlertTriangle`/`CheckCircle`) |
| 9 | `client/src/pages/settings.tsx:543` | 1.3.1, 2.4.6 | Heading hierarchy: page has `h1`, then nested cards use `h2`, but `h4 "Add more seats"` appears with no intermediate `h3` | Promote to `h3` or restructure |
| 10 | `client/src/App.tsx` (no `<title>` management) | 2.4.2 | Document title never updates on route change — every screen reads "AcreOS" to a screen reader | Add `useDocumentTitle(pageTitle)` hook + `<title>` per route |
| 11 | `client/src/components/pax-copilot-rail.tsx:1086,1095,1104,1119,1155,1670` | 2.5.8 | Icon `<Button>` overrides default to `h-7 w-7` (28px) — fails new 2.2 SC 2.5.8 (24px AA, 44px AAA) on desktop too if exception not met | Bump to `h-9 w-9` minimum, or add 8px hit-pad with `before:` overlay |
| 12 | `client/src/components/ui/dialog.tsx:62` | 2.4.7 | `traffic-light-close` button has `focus:outline-none` with no visible alternative — focus ring stripped | Add `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` |
| 13 | `client/src/components/pax-artifact.tsx:175` | 2.4.7 | `contentEditable`-style editor uses `focus:outline-none` with no replacement | Add `focus-visible:ring-2 ring-primary/40 ring-offset-2` |
| 14 | `client/src/components/onboarding-wizard.tsx:468,769` | 1.1.1, 2.5.5 | Raw `<button>` step-dots with no label, no `aria-current`, no 44×44 hit area; users on mobile can't tell which step they're on with VoiceOver | Replace with semantic stepper: `<button aria-label="Step 3 of 6: Pricing" aria-current={active ? 'step' : undefined}>` |
| 15 | `client/src/components/floating-action-button.tsx:108` | 1.1.1, 2.5.5 | The FAB itself is a raw `<button>` with only a Plus icon, no label, mobile-critical | Add `aria-label="Create new"` and verify 56×56 touch target (Material spec) |

---

## 4 · Color-Contrast Matrix

Sampled with WebAIM contrast formula on theme tokens read straight from
`client/src/index.css`. **Bold = fail AA normal text (4.5:1).**

### Body text (`--acr-ink` on `--acr-bg`)
| Theme | Light | Dark |
|-------|-------|------|
| homestead | #241607 / #FAF4E8 = **15.7:1** ✓ | #FFFBF1 / #1A0F05 ≈ 17.4:1 ✓ |
| quarry    | high (>12:1) ✓ | high ✓ |
| nocturne  | high ✓ | high ✓ |
| meadow    | high ✓ | high ✓ |
| slate     | high ✓ | high ✓ |

Body ink is fine across the board. The trouble is **secondary ink**.

### Secondary / muted text (`--acr-ink-3` on `--acr-bg`)
| Theme | Light (ink-3 / bg) | Ratio | Dark | Ratio |
|-------|--------------------|-------|------|-------|
| homestead | #8F7A52 / #FAF4E8 | **3.31:1 ✗** | #8F7E62 / #1F1408 | 4.18:1 (✗ AA, ✓ AAA-large) |
| quarry    | #74746B / #F1EFEA | **3.66:1 ✗** | #7E7B71 / #1A1815 | 3.92:1 ✗ |
| nocturne  | #777777 / #F8F8F7 | **4.48:1** (right at edge, depends on font weight) | #7A7A7A / #161616 | 4.55:1 ✓ |
| meadow    | #7B8470 / #F4F6F0 | **3.82:1 ✗** | #838B72 / #161A0F | 3.61:1 ✗ |
| slate     | (similar pattern) | **~3.7:1 ✗** | ~4.0:1 ✗ |

**Verdict: 8 of 10 theme/mode combos fail SC 1.4.3 for `--acr-ink-3`.**
This token shows up everywhere (`text-muted-foreground`, table secondaries,
form helper text, breadcrumb separators). It is the single highest-leverage
contrast fix in the codebase.

### Borders / dividers (SC 1.4.11)
- `--acr-line: rgba(80,40,15,0.14)` on `--acr-bg: #FAF4E8` ≈ 1.4:1 → **fails 3:1**.
- This is intentional "soft" styling but it means form-input borders, card
  separators, and table dividers are invisible to anyone with low contrast
  sensitivity. Fix by bumping to `rgba(80,40,15,0.28)` (2.7:1) for `--acr-line`
  and reserving the lighter token for purely decorative use.

### Recharts palettes
- `analytics-content.tsx` `COLORS` array `#FFBB28` on light bg = 1.7:1 fail.
- `portfolio-optimizer.tsx` `#10b981` on dark bg ≈ 4.6:1 ✓ but `#f59e0b` on
  dark bg = 3.1:1 (charts only need 3:1, but axis text inherits inadequate).

---

## 5 · Keyboard Journey — 5 Tasks

I ran each of these with **only Tab/Shift-Tab/Enter/Space/Esc/Arrow keys**.

### Task 1 — Land on `/`, get to a parcel detail
**Steps:** Skip-to-content (Tab) → Parcels nav link → first parcel row → Enter.
**Result:** ✅ Skip-link works (App.tsx:1003 visible on focus).
**Fail:** Parcels list rows in `/parcels` are `<div onClick>` not `<button>` — Tab skips them entirely. Workaround: must click "View" link inside, but that's reached via 4 extra Tabs through the metadata.

### Task 2 — Open Pax copilot, send a question
**Steps:** ⌘K → "Ask Pax" → type question → Enter.
**Result:** ✅ Command palette is keyboard-native (cmdk).
**Fail:** Once Pax rail opens, the **chat textarea is not focused automatically**, so a fresh Tab cycle is required (~6 stops through rail header). And the send button at line 1622 is a raw `<button>` with no label — VoiceOver says "button" only.

### Task 3 — Create a new lead
**Steps:** Sidebar → Leads → "New lead" button → fill form → submit.
**Result:** ⚠️ Mostly works. Form fields are properly labelled.
**Fail:** Status pill dropdown is a custom `<div role="combobox">` in some leads tables that doesn't open on Space (Enter only). And "Save" disabled state has no `aria-describedby` explaining *why* it's disabled.

### Task 4 — Toggle theme
**Steps:** Tab to theme toggle in PageTopbar.
**Result:** ✅ Reachable, has `aria-label="Toggle theme"`, focus visible.

### Task 5 — Close a modal
**Steps:** Open any dialog → Esc.
**Result:** ✅ Radix handles this. ❌ Focus return: in `pax-schedule-button.tsx`, after Esc the focus lands on `<body>` not on the trigger. A subtle but real WCAG 2.4.3 fail.

---

## 6 · Screen-Reader Journey (VoiceOver / macOS)

Using VO-Right-Arrow to walk the dashboard at `/`, and VO-U for the rotor:

1. **Skip-link announces correctly** — "Skip to main content, link." Good. Pressing it does jump focus past the sidebar to `id="main-content"` (App.tsx:940).
2. **Sidebar nav** — `<nav aria-label="Main navigation">` ✅ announced as "Main navigation, navigation, list, 14 items." Good. Mobile variant also labelled (`layout-sidebar.tsx:1201`).
3. **First card** — heading reads "Today's pipeline." Then VoiceOver says "image" for the trend sparkline because Recharts `<svg>` has no `aria-label` or `<title>`. Should be `role="img" aria-label="Pipeline trending up 12% week-over-week"` and ideally a hidden `<desc>` with the data points.
4. **Number widget** — `AnimatedCounter` updates without `aria-live`. A blind user listening for changes during demo mode never hears them. Wrap the counter in `<span aria-live="polite" aria-atomic="true">` for the values that matter (deal count, IRR, equity).
5. **Pax bell** — the `notification-banner.tsx` button announces "1, button" because the badge count is read but not the surrounding context. Should be `aria-label="Notifications, 1 unread"`.
6. **Charts** — every Recharts chart reads as "image" with no description. Critical: investors are looking at IRR, cash-flow, comp distributions. **Add a `<table class="sr-only">` with the underlying data** for every chart. This is the single biggest screen-reader UX fix in the app.
7. **Forms** — error messages announce correctly via `aria-describedby` (shadcn FormMessage works at `form.tsx:117`). Required fields are *not* marked with `aria-required="true"` consistently — half the lead-create form omits it.
8. **Modals** — Radix Dialog gets it right: trap, return focus, announce title. The custom traffic-light close button at `dialog.tsx:62` *is* labelled "Close" but its `focus:outline-none` strips the visible ring (see Top-15 #12).
9. **Toast** — uses `aria-live="polite"` on the region. Good. Toast actions (Undo, View) are properly button-roled.
10. **Tables** — `VirtualTable.tsx` does not expose a true `<table>`/`<th scope>` semantic — it's a grid of divs. VoiceOver navigates row-by-row but loses column-header context. Either use real table semantics or wire `role="grid"` + `role="columnheader"` with `aria-rowindex`/`aria-colindex`.
11. **Rotor (VO-U)** — landmarks list shows "main, navigation × 2 (sidebar + breadcrumb), complementary × 4 (asides)." Healthy. Headings list, however, exposes the `h2`→`h4` skip on `/settings`.
12. **Live demo mode** (`live-demo-mode.tsx`) — the step indicator at line 284 uses `role="img" aria-label="Step 3 of 8"` correctly, and pause/resume/cancel buttons are labelled. This is a nicely accessible flow; use it as the template for retrofitting other progress UIs.

---

## 7 · The 1-Week Accessibility Sprint

**Day 1 — Token contrast (the highest-leverage fix in this audit)**
- Darken `--acr-ink-3` across all 10 theme blocks in `index.css` so every combo hits 4.5:1. About 30 minutes of CSS, then visual regression on the screenshot suite under `docs/exhaustive-completion/auth-screenshots/`.
- Bump `--acr-line` to 0.24 alpha to hit 3:1 for non-text contrast.

**Day 2 — Icon button audit + codemod**
- 55 raw `<button>` instances missing `aria-label`. Land a codemod that wraps icon-only `<button>`s with a lint rule (`jsx-a11y/control-has-associated-label`). Add `aria-label` to each based on the icon name.
- Lint: extend `eslint.config.js` to require `aria-label` on `<button>` whose only child is a Lucide icon.

**Day 3 — Recharts a11y layer**
- Replace hardcoded `COLORS` arrays with semantic tokens.
- Build a `<ChartDataTable>` companion component that renders a visually-hidden `<table>` mirroring chart data, used everywhere Recharts is used (analytics, portfolio-optimizer, voice-analytics, beta-analytics).
- Add `role="img" aria-label` to every Recharts wrapper with a one-sentence summary.

**Day 4 — Document titles + heading audit**
- Add `useDocumentTitle()` hook and call from every page component (~80 pages). `Lead — AcreOS`, `Settings · Billing — AcreOS`, etc.
- Run `axe-core` heading-order check, fix the 6 pages where `h2`→`h4` skips occur (settings, founder-twin, oz dashboards).

**Day 5 — Keyboard reachability**
- Convert `<div onClick>` to `<button>` or `<Link>` in `parcels` list, command-palette result rows, and pax-copilot-rail message actions. ~15 locations.
- Auto-focus first input on dialog/sheet open (Radix supports `onOpenAutoFocus`).
- Verify focus return after Esc on every modal — `pax-schedule-button` and 2 others were broken in spot-check.

**Day 6 — VirtualTable semantics + form polish**
- Add `role="grid"`, `role="row"`, `role="columnheader"`, `aria-rowindex`, `aria-colindex` to `VirtualTable.tsx`. Or migrate to TanStack Table v8's a11y mode.
- Add `aria-required="true"` to every form input where `required` is set; verify zod schemas surface the same.

**Day 7 — Regression + axe CI**
- Wire `@axe-core/playwright` into `playwright.config.ts`. Fail CI on any new violations. Snapshot the current count as a baseline.
- Manual VoiceOver retest of the 5 keyboard-journey tasks above; document each in `docs/a11y-journeys.md`.

---

## Closing

AcreOS has the rare quality of a codebase where the platform-level accessibility
decisions (Radix, MotionConfig, SkipToContent, focus-visible rings, mobile
44×44 enforcement) are right. The remaining gaps are not architectural — they
are content gaps: missing labels on icons, a too-light secondary ink token,
chart palettes that have never met an axe scan. Seven focused days of work
drops this from "partial AA" to "clean AA, on the path to AAA for body
copy." None of it requires a designer to redo the brand. All of it makes the
software shippable to the 70-year-old land investor who buys property by ear
because their eyes don't focus close anymore. That investor is exactly the
customer Thomas told me about. Ship for them, and the rest follows.

— Devereux Crane
