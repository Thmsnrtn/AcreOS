# Mobile Parity Audit (375×812 touch-only)

Reference device: iPhone 13 mini, viewport 375×812, safe-area-inset-bottom ≈ 34px (home indicator), safe-area-inset-top ≈ 50px (notch). All findings derived by code reading; nothing rendered in an authenticated browser.

## Summary

| Surface | Blocking | Painful | Cosmetic | Top issue |
|---|---|---|---|---|
| /today | 1 | 4 | 2 | Dense `text-xs` micro-stats; bottom of page clipped under MobileBottomNav |
| /pipeline | 0 | 2 | 1 | 5-tab TabsList scrolls horizontally but no scroll affordance |
| /inbox | 1 | 3 | 0 | Reply Textarea + send button is hidden behind 72px MobileBottomNav |
| /properties | 1 | 4 | 1 | `Dialog` for Add Property + CSV import = centered modal, not Sheet; CSV import preview Table overflows |
| /deals | 1 | 3 | 1 | Negotiation `Dialog max-w-2xl` overflows 375 viewport; deal-package drag-handle exists desktop-only |
| /tasks | 0 | 3 | 1 | Edit/Create dialogs use `max-w-lg` (centered) on mobile; filters use fixed `w-[150px]` selects |
| /leads | 1 | 4 | 1 | Score-details `Dialog max-w-[500px]`; mobile filter Sheet is good but bulk action bar absent |
| /money | 0 | 2 | 1 | Header h1+description+Import button collides at 375 (no `flex-wrap`) |
| /ai (Pax) | 0 | 3 | 1 | Tabs scroll OK; "AcreOS Assistant" CommandCenter under it likely has its own collisions |
| /settings | 1 | 3 | 1 | 17-tab horizontal scroll TabsList with no jump menu — 17 taps to reach last tab |
| /onboarding-v2 | 1 | 2 | 1 | `min-h-screen bg-gray-950` overrides theme + skip nav at top-right is below safe-area |
| /auth | 0 | 1 | 1 | Clerk widget width ~360px on 375px screen — fine; "Back to home" link below fold |
| / (landing) | 0 | 2 | 1 | Hero floating cards correctly hidden <1100px; sticky LandingNav not measured for safe-area-top |

## Per-surface findings

### /today
**Blocking**
- Last visible cards (Activity stream, Pax Suggestions, etc.) clipped behind 72px+34px MobileBottomNav. `PageShell` adds only `pb-8` and no mobile-specific bottom padding — `client/src/components/page-shell.tsx:86`. current: `pb-8` always; fix: `pb-8 md:pb-8 pb-[calc(theme(spacing.20)+env(safe-area-inset-bottom))] md:pb-8` or apply `mobile-safe-content` utility (already defined in `client/src/index.css:1093`). S

**Painful**
- Dense `text-xs` micro-stats in business-pulse 4-column grid · `client/src/pages/today.tsx:750-793` · 10px uppercase labels + 12px values cram into ~85px columns at 375 width. fix: stack to 2-col on mobile (already `grid-cols-2 sm:grid-cols-4`) but the inner labels use `text-[10px]` — bump to `text-xs` and tighten icon+label spacing. M
- "Start here today" priority cards have `Button asChild size="sm"` shrink-0 on right with `text-xs` — at 375 the title truncates aggressively · `today.tsx:836-852`. fix: stack action below text on mobile. S
- "Welcome back" / agent-activity row uses `grid-cols-3 gap-3` with `text-lg font-bold` numerals + 3 columns at 375px ≈ 100px each — readable but the link wrapping the middle column has no visual focus state on touch. `today.tsx:687-709`. M
- "Show full dashboard" toggle is an unstyled `<button>` with `underline` only — fails 44×44 tap target. `today.tsx:722-729`. fix: wrap in `<Button variant="link" size="sm" className="min-h-11">`. S

**Cosmetic**
- `acr-cc-greeting-soft` runs long ("…Here's what's on the horizon.") and wraps awkwardly at 375. `today.tsx:644-651`. M
- Decision-queue capsule chip uses 14px `Clock` + small badge; fine but eats top thumb-zone real estate. `today.tsx:656`. M

### /pipeline
**Painful**
- TabsList uses `w-full sm:w-auto overflow-x-auto flex-nowrap` with 5 tabs × ~90px = ~450px; needs to scroll on 375. `pipeline.tsx:274`. No scroll affordance / fade indicator → users won't discover hidden tabs. fix: add a left/right scroll-mask gradient (the pattern used in `deals.tsx:963-964`). S
- Velocity strip uses `grid-cols-2 sm:grid-cols-4 gap-2` — at 375 each card is ~165px, fine, but `text-xs` labels + `text-[10px]` subtext push sub-readability. `pipeline.tsx:146-198`. M

**Cosmetic**
- ConversionFunnel SVG component rendered inline with `Card p-4` — likely doesn't reflow under 375; couldn't determine without rendering. M

### /inbox
**Blocking**
- Two-pane split layout uses `selectedItem ? "hidden md:block"` to swap list↔detail on mobile. `inbox.tsx:1055,1097`. Pattern is correct, but the detail pane's reply form (Textarea + Send) sits at bottom of the flex column with no `pb-[72px]` to clear MobileBottomNav. The Send button is the most-tapped element in inbox UX; behind a fixed 72px bar = unclickable. fix: detail pane needs `pb-[calc(72px+env(safe-area-inset-bottom))] md:pb-0`. S

**Painful**
- Email/SMS row tap target depends on row internal padding; rows show `MessageRow` / `SMSConversationRow` components — couldn't confirm 44px row height without reading them. M
- Header has channel-filter Tabs ("All / Email / SMS") + status Tabs ("All / Unread / Starred / Archived") stacked. On 375 these can take 96-128px of vertical space before user sees a single message. M
- Search input at `inbox.tsx:971` has `inputMode="search"` — good — but no `autoCapitalize="none"` so iOS will capitalize first char of email queries. S

### /properties
**Blocking**
- Add-Property `<Dialog>` with `sm:max-w-[500px]` is centered on viewport. On 375 it falls back to base which is the Radix default ~max-w-lg + 90vh. Form inside has many fields → keyboard pops, dialog squashes. Should be `<Sheet side="bottom" className="h-[90vh]">`. `properties.tsx:514-537`. M
- CSV Import preview Table at `properties.tsx:801-828` — `<Table>` with N columns × 5 rows inside `DialogContent sm:max-w-[600px]`. On 375, the dialog is < 600 so the table will horizontal-scroll inside a centered modal, then the dialog itself is also clipped. fix: full-screen Sheet on mobile, table → stacked rows. M

**Painful**
- Filter strip at `properties.tsx:550` uses `grid grid-cols-2 gap-2 md:flex` for buttons. `SelectTrigger` w/ `h-8 w-[160px]` (line 615) overrides the grid and forces 160px width — likely overflows the 50% column. fix: `w-full md:w-[160px]`. S
- "Fetch Boundaries" button label is `hidden md:inline` so on mobile it's icon-only — no `aria-label` visible (uses Tooltip). Tooltip is hover-only on mobile. `properties.tsx:506-513`. fix: ensure Button has `aria-label="Fetch boundaries"`. S
- Property card grid uses `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6` — 1-up at 375 is correct. But action buttons on cards use `opacity-100 sm:opacity-0 sm:group-hover:opacity-100` (line 987) which means group-hover. Mobile (no hover) shows them always at 100% — works, but they overlap the image without a backdrop tint. M
- Property detail panel tabs use `<span className="hidden md:inline">Intelligence</span><span className="md:hidden">Intel</span>` — abbreviation pattern works, no issue. (No fix.)

**Cosmetic**
- `text-xs max-w-[150px] truncate` cells in CSV preview table use a hardcoded width that breaks on narrow viewports. `properties.tsx:818`. S

### /deals
**Blocking**
- Negotiation Script `<Dialog>` with `max-w-2xl max-h-[80vh]` · `deals.tsx:1578-1603`. `max-w-2xl` = 672px > 375. The radix Dialog wrapper does cap to `calc(100% - 32px)` but content inside (DialogTitle with icons + AI strategy text) is long-form reading content. Should be Sheet on mobile. M

**Painful**
- Deal pipeline columns use horizontal scroll — `deals.tsx:963-964` adds left/right gradient masks (`hidden md:block`) — masks themselves are desktop-only, so mobile horizontal scroll has no affordance. M
- Mobile Stage select `min-w-[140px] min-h-[44px]` (line 742) sits on each card — at 375 a card with avatar + title + stage picker likely overflows. M
- "Doc Required" badge `hidden sm:inline-flex` — hidden on mobile, but the icon button `min-h-[44px] min-w-[44px]` adjacent (line 1926) still implies the badge state. Without the badge, mobile users miss the "doc required" signal. S/M
- Negotiation/Edit drawer Close button (line 1395) is correctly `min-h-[44px] min-w-[44px]` with `aria-label="Close drawer"`. (Good.)

**Cosmetic**
- Drag handle (line 1108) `hidden md:block cursor-grab` — desktop-only drag-and-drop is correct (no touch-drag on mobile). The mobile alternative (Stage select) is present, but not visually equivalent in IA. M

### /tasks
**Painful**
- Filter selects `<SelectTrigger className="w-[150px]">` × 2 (status + priority) · `tasks.tsx:506,525`. At 375 with the create-task button these wrap onto 2 rows; each select is fixed 150px. fix: `w-full sm:w-[150px]`. S
- Edit + Create dialogs `<DialogContent className="max-w-lg">` · `tasks.tsx:450,672`. `max-w-lg` = 512px; on 375 Radix caps it but the form (5 fields including textarea + due date picker) needs vertical room. Should be Sheet bottom. M
- Task row tap target — the inline `pencil` edit button (line 647) is icon-only; couldn't verify size from this slice. Likely `size="icon"` default = 36×36, below 44 minimum. M

**Cosmetic**
- Page heading uses standard `text-2xl md:text-3xl` — fine. S

### /leads
**Blocking**
- ScoreDetails `<Dialog>` `sm:max-w-[500px] max-h-[80vh]` · `leads.tsx:255-356`. Long-form content (drivers, breakdowns, recommendations) scrolling inside a centered modal. Should be Sheet on mobile. M

**Painful**
- Create-lead `<Dialog>` `sm:max-w-[425px]` · `leads.tsx:1135-1161`. Same pattern; multi-input form. M
- Mobile filters Sheet/Collapsible (line 1308-1390) is implemented well — search bar `min-h-[44px]`, stage select `min-h-[44px]`, assignee select `min-h-[44px]`. No fix.
- Mobile card view exists at line 1642-1643 (`block md:hidden`) — good. Couldn't audit row touch targets without reading the row component. M
- Bulk-action bar at `leads.tsx:1099,1325` uses `min-h-[44px] min-w-[44px]` — good. But when bulk-selected at 375, the Select+Apply+Clear row stacks; `SelectTrigger w-[150px]` (line 1425) may overflow. S

**Cosmetic**
- Multiple `text-[10px]`/`text-xs` chips on lead cards push body density above mobile readability threshold. M

### /money
**Painful**
- Header row · `money.tsx:63-78`: `<div className="flex items-start justify-between gap-4">` with h1 + description + "Import notes" button. At 375 the button has `shrink-0` but the heading is `text-2xl md:text-3xl` — collision risk; works because `flex-1` text wraps, but the button drops the icon-only fallback that would help on narrow widths. M
- 5-tab TabsList (Notes, Finance, Portfolio, Forecast, Capital) horizontal-scrolls at 375. `money.tsx:82`. Same scroll-mask issue as /pipeline. S

**Cosmetic**
- Tab labels are short single words — the `text-sm md:text-base` description below header tightens vertical rhythm. (No fix.)

### /ai (Pax page)
**Painful**
- 5-tab TabsList (Insights, Chat, Activity, Agents, Automation) · `pax.tsx:604`. Same horizontal-scroll-no-affordance pattern. S
- Default tab is Chat; chat tab embeds `<CommandCenterPage />` — inherits whatever desktop bias that page has. Couldn't audit without reading command-center.tsx. L
- `<GreetingBanner />` may sit above the TabsList eating thumb-zone real estate; not measured. S

**Cosmetic**
- Page heading "AI hub" + subtitle is generic; below sits a banner + scrolling tabs. Compresses on mobile. M

### /settings
**Blocking**
- 17-tab horizontal-scroll TabsList · `settings.tsx:791-864`. At 375, each tab ≈ 80-100px, total ≈ 1500px. Reaching tab #17 ("AI tasks") requires multi-swipe scrolling with no jump. Mobile users will not find Privacy/Security/Automations tabs. fix: switch to a `<Select>` jump-menu on mobile (`md:hidden`) + keep TabsList on desktop (`hidden md:flex`). M

**Painful**
- Disable-2FA `<Dialog className="sm:max-w-sm">` · `settings.tsx:1758` — short form, OK on mobile but still centered. S
- Team-members `<Table>` · `settings.tsx:1329-1419` — "Member / Role / Actions" table at 375 is too wide. Each row has avatar+name+email+role-select+actions; table will horizontal-scroll. fix: card layout on mobile. M
- Cancel-subscription confirmation uses `CancellationDialog` (line 948) — couldn't audit, but cancellation flows on mobile commonly hide the cancel CTA below modal fold. M

**Cosmetic**
- Tab icons `hidden sm:inline` so mobile gets text-only — good for thumb pickup, but loses scannability when scrolling 17 tabs. S

### /onboarding-v2
**Blocking**
- Hardcoded `min-h-screen bg-gray-950 flex items-center justify-center p-4` · `onboarding-v2.tsx:1082,1165`. Forces dark gray background regardless of theme/system preference. Path-selection screen has `text-white` content. On a customer's iPhone with system light mode, this fights with everything else in the app. fix: use theme tokens (`bg-background`, `text-foreground`). M
- Path selection cards use Tailwind class concatenation: `border-${color}-700/40 bg-${color}-950/20 hover:border-${color}-500` · `onboarding-v2.tsx:1131-1132`. **Tailwind cannot statically extract these — at runtime these classes won't exist** unless safelisted in `tailwind.config.ts` (they aren't). Cards render with no border/bg color on mobile (or any) browser. S/M

**Painful**
- Skip-setup link is a plain `<button>` with `text-xs` — fails 44×44. `onboarding-v2.tsx:1181-1187`. S
- Header "Step N of M" + "Skip setup" sits at top of viewport without `safe-area-top` padding — collides with iPhone notch. `onboarding-v2.tsx:1175`. S
- CSV preview `<table>` inside import step uses `text-xs text-gray-300` + `max-w-[120px] truncate` cells. At 375 the columns truncate to unreadable. `onboarding-v2.tsx:457-479`. M

**Cosmetic**
- "✓ benefit" pills use `text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded-full` — at small sizes pill density makes the path-selection card very tall (potentially >50% viewport per card). S

### /auth
**Painful**
- Clerk `<SignIn>` widget renders Clerk's native UI; we don't control its sizing. At 375 the widget is reportedly ~360px wide → fits with 8px gutter. Hash-routing (`routing="hash"`) used so SSO callback works. S

**Cosmetic**
- "Back to home" Link `min-h-11` — good. `auth-page.tsx:153-159`. (Already correct.)
- Sign-in/sign-up mode toggle: comment says "Clerk's widget renders 'Don't have an account?' — we don't duplicate". On mobile this is fine; mode is only set via URL `?mode=register`. No issue.

### / (landing)
**Painful**
- LandingNav (`client/src/pages/landing/LandingNav.tsx`, 38 lines) — couldn't audit but typical sticky landing nav doesn't add `safe-area-top`. On notched iPhones content scrolls under the notch unless `padding-top: env(safe-area-inset-top)` is applied. M
- Pricing toggle is two `<button>` elements with no `min-h-11` — `Pricing.tsx:81-97`. Likely below 44px tap target. S

**Cosmetic**
- Hero floating-cards (`HeroVisual`) properly hidden under 1100px via `landing.css:155 @media (max-width:1100px) { ... }`. Good — no fix needed. (Confirmed correct.)
- Hero title uses `font-size: clamp(48px, 7vw, 80px)` — at 375 = 48px, readable. (Confirmed correct.)

## Cross-cutting patterns (3+ surfaces share)

1. **`<Dialog>` used where `<Sheet side="bottom">` is mobile-correct.** Affected: /properties (Add, CSV-import), /deals (Negotiation), /tasks (Edit, Create), /leads (Score-details, Create), /settings (Disable-2FA, Cancellation). Root cause: Tier 1 surfaces were ported visual-first from desktop; Sheet/Dialog choice was never re-audited per-surface. Single-fix sketch: write a `ResponsiveModal` component that renders `<Dialog>` at `md+` and `<Sheet side="bottom">` below; replace site-wide. M.

2. **PageShell omits MobileBottomNav clearance.** Affected: every page wrapped in PageShell (which is most of Tier 1: today, pipeline, money, settings, pax, deals, leads, properties, tasks). `page-shell.tsx:86` uses `pb-8` only. The 72px nav + 34px home indicator = up to 106px of bottom content is visually there but covered. Mobile users will never see the last card on any page. Single-fix: add `pb-[calc(theme(spacing.20)+env(safe-area-inset-bottom))] md:pb-8` to the `<main>` or to the inner `MAX_WIDTH_CLASSES` div. The `mobile-safe-content` utility in `index.css:1093` already exists but isn't applied anywhere. S.

3. **TabsList horizontal scroll has no scroll affordance.** Affected: /pipeline, /money, /pax, /settings (and likely more). Pattern `w-full sm:w-auto overflow-x-auto flex-nowrap` works but mobile users can't see that tabs continue beyond the right edge. Single-fix: add a left/right gradient mask via pseudo-elements on the TabsList wrapper (`deals.tsx` already has this pattern for kanban columns at 963-964). S.

4. **Hardcoded fixed-width Selects (`w-[150px]`, `w-[160px]`, `w-[180px]`) inside flex/grid filter rows.** Affected: /tasks, /leads (bulk bar), /properties (filter), /deals (bulk). At 375 these break the row layout. Single-fix: pattern is already correct in some places (`min-h-[44px] md:min-h-8 w-full md:w-[150px]`); apply consistently. S.

5. **Icon-only buttons without `aria-label` relying on Tooltip.** Affected: /properties (Fetch Boundaries, line 506), /pipeline (icon-only tab labels at <sm), /pax-rail (model selector). Tooltip is hover-only, so on mobile screen-readers + sighted users get nothing. Single-fix: add `aria-label` on every `size="icon"` button — and codify in CLAUDE.md (already there but not enforced). S.

6. **`text-xs` / `text-[10px]` body copy on dashboard tiles.** Affected: /today (business-pulse), /pipeline (velocity), /pax (insights), /deals (cards). At 375 with iPhone default font scaling, 10px is below WCAG SC 1.4.4 reflow comfort. Single-fix: define `text-tiny` = 12px in tailwind config and replace all `text-[10px]` site-wide. M.

## Bottom-rail occlusion check

Slot stack on 375×812 with iOS home indicator (safe-area-inset-bottom = 34px):

```
Viewport bottom (y=812)
  ↓ safe-area home-indicator zone: 778-812 (34px)
  ↓ MobileBottomNav: 706-778 (72px content + inset padding inside)
  ↓ FAB (bottom-[88px], 56px button):  ~668-724  ← OVERLAPS NAV at 706-724
  ↓ ConversationTray (bottom-[160px]): ~596-652
  ↓ FloatingHelpButton (bottom-[232px]): ~524-580
```

**Critical finding: FAB overlaps top edge of MobileBottomNav.**
- `FLOATING_SLOT.fab = "fixed bottom-[88px] md:bottom-4 right-4 md:right-16 z-50 safe-area-bottom"`. The `bottom-[88px]` is measured from the viewport bottom edge, not from the nav's top. On a phone with 34px home indicator inset, the nav's visible top edge is at 72+34=106px above the viewport bottom. FAB centered at 88+28=116px — only 10px gap above the nav top edge. With z-50 vs nav z-50 (line 29 of `MobileBottomNav.tsx` and FAB container at z-50), they fight; FAB visually clips into the nav.
- `safe-area-bottom` class on the FAB container adds `padding-bottom: env(safe-area-inset-bottom)` *internally* — does NOT push the container up. It's a no-op for collision purposes here. `index.css:1084-1086`.
- Fix: change `FLOATING_SLOT.fab` to `bottom-[calc(88px+env(safe-area-inset-bottom))]` (and propagate to conversation/help slots). S.

**Z-index audit:**
- MobileBottomNav: z-50
- FAB container: z-50
- ConversationTray: z-[49]
- FloatingHelpButton: z-[48]
- DynamicIsland: z-[9998] (top-center, no collision)
- Sidebar mobile sheet trigger: z-50, top-4 left-4 (no collision with right stack)

FAB and bottom-nav both at z-50 → render order tie. In current React tree (`App.tsx`), FAB mounts before MobileBottomNav, so MobileBottomNav wins paint order = FAB hides behind nav at the overlap. S/M.

**PaxCopilotRail correctly hidden on mobile** (`pax-copilot-rail.tsx:983 if (isMobileViewport) return null;`). Confirmed no rail/nav collision.

**Mobile sidebar trigger** (`layout-sidebar.tsx:1245`) — `top-4 left-4 z-50 safe-area-top`. Collides with notch on landscape but acceptable on portrait 375×812. (No fix needed for portrait.)

## Recommended fix priority

1. **PageShell mobile bottom-padding** (S, fixes content clipping on every Tier 1 page) — `page-shell.tsx:86`.
2. **FAB-vs-nav collision** (S, polish-critical) — `floating-slots.ts:25` add safe-area to bottom value.
3. **Inbox detail-pane reply bottom-padding** (S, fixes core Inbox flow) — `inbox.tsx:1097`.
4. **Settings 17-tab → mobile Select jump-menu** (M, gates Privacy/Security/Automations discoverability) — `settings.tsx:791-864`.
5. **Onboarding-v2 dynamic-class color bug** (S, classes silently don't apply) — `onboarding-v2.tsx:1131-1132`.
6. **Onboarding-v2 hardcoded `bg-gray-950`** (M, brand-incoherence + dark-mode override) — `onboarding-v2.tsx:1082,1165`.
7. **`ResponsiveModal` component** (M, fixes 7+ Dialog→Sheet bugs) — new component + replace.
8. **TabsList scroll-mask gradients** (S, mobile users can't see hidden tabs) — pipeline/money/pax/settings.
9. **`text-[10px]` body copy → 12px minimum** (M, readability) — site-wide.
10. **Audit `size="icon"` button list for `aria-label`** (S, a11y compliance) — site-wide grep + CI lint rule.

---

## Notes on what couldn't be determined without rendering authenticated

- Per-row touch-target heights inside `EmailMessageRow`, `SMSConversationRow`, `LeadsCardRow`, deal-card components — not read.
- Whether `CommandCenterPage` (embedded inside `/ai`'s Chat tab and as a standalone) has its own mobile issues.
- Layout shift during initial query loading (need real network timing).
- Real iOS keyboard avoidance behavior for inputs near the bottom of the viewport.
- Whether `LandingNav` adds `safe-area-top` — only saw 38 lines exist, didn't read.
- Behavior of `MobileCommandDrawer` (the "More" tab on bottom nav) — didn't read.
- True column counts on Tables (Settings team table, Properties CSV preview) at 375 — depends on data shape.
