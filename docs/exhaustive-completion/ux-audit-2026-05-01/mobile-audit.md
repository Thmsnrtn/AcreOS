# AcreOS Mobile-Browser UX Audit — 2026-05-01

Auditor target viewport: **iPhone 13 (375 × 812)**. Audit scope: customer daily surfaces, founder daily surfaces, onboarding, auth, layout chassis. Findings cite `file:line` against the `main` branch at the time of audit.

---

## 1. Executive summary

The biggest mobile failure is structural, not stylistic: several daily-driver pages (`/inbox`, `/campaigns`, `/auth`, `/onboarding-v2`, several public surfaces) **bypass `PageShell`**, so they ship without `mobile-safe-content` (no clearance for the 72-px `MobileBottomNav` + iOS home-indicator) and without the sticky `PageTopbar`. On these pages the bottom of the page is permanently eaten by the nav. A second systemic problem is `min-h-screen` / `h-screen` (literally `100vh`) on five+ chrome-style layouts — these break on iOS Safari because the dynamic address bar isn't accounted for, leaving content cut off below the fold.

The third systemic issue is **founder-dashboard.tsx** (7,452 lines). It contains 34 raw `<Dialog>` instances (no `ResponsiveModal`), an `AutopilotStatusBar` fixed to `bottom-0` that sits **directly under MobileBottomNav** (z-fight + occluded content), and ~10 `grid grid-cols-12` table-style layouts that try to render six-column data inside a 343-px content column. It is the worst single file in the codebase from a mobile UX standpoint.

The fourth class is **detail drawers** (lead detail, deal detail) using `fixed top-0 h-full` — they extend past the bottom nav, hiding the last ~96 px of the panel including action buttons.

The customer Tier-1 list pages (`/leads`, `/properties`, `/deals`) **have already done the right thing** — desktop tables are wrapped in `hidden md:block`, with a sibling `md:hidden` mobile card view. That pattern should be canonized and applied to `/finance`, `/portfolio`, and the founder-dashboard tile rows.

Quick wins in section 5 are sub-10-min fixes that will visibly close the "page cut off" complaint.

---

## 2. Systemic issues (5+ pages — fix once, ship once)

### S1 — [P0] Pages that bypass `PageShell`, losing `mobile-safe-content` + `PageTopbar`
Affected (high-traffic):
- `client/src/pages/inbox.tsx:1020-1023` — uses `Sidebar` directly + `<main … h-screen>`. No bottom-nav clearance, no topbar.
- `client/src/pages/campaigns.tsx:54-86` — uses `SidebarProvider` from `ui/sidebar` (a different shell). No `mobile-safe-content`, no PageTopbar.
- `client/src/pages/auth-page.tsx:106` — `min-h-screen` (allowed for unauth surfaces, but the loader at `:66`, `:92` isn't centered correctly on Mobile Safari due to `100vh`).
- `client/src/pages/founder-ai-observatory.tsx:779`, `:750`, `:758` — own chassis, not PageShell.
- `client/src/pages/command-center.tsx:1822-1824` — `flex min-h-screen` + `h-screen` overflow-hidden main; will hide content under bottom nav.
- `client/src/pages/anticipatory-enterprise.tsx:802` — `flex min-h-screen` (no PageShell).
- `client/src/pages/conscious-organization.tsx:819` — same.

**Fix:** wrap each in `<PageShell label="…">`. Where the page is a chat/two-pane (inbox, command-center), keep the internal layout but place inside PageShell so `mobile-safe-content` clears the bottom nav. For inbox specifically, switch the master/detail into a stacked mobile view (see I1 below).

### S2 — [P0] `min-h-screen` / `h-screen` (= `100vh`) on iOS Safari
Modern fix: use `100dvh` or `100svh` (or a CSS class like `mobile-vh-fix`). On iOS Safari, `100vh` includes the address bar; when the bar collapses on scroll, the bottom of the page is cut off. Found in:
- `client/src/components/page-shell.tsx:76` — `flex min-h-screen` (the chassis itself) — affects every PageShell page.
- `client/src/pages/inbox.tsx:1020`, `:1023` — `min-h-screen` + `h-screen` (the worst case).
- `client/src/pages/auth-page.tsx:66`, `:92`, `:106`.
- `client/src/pages/onboarding-v2.tsx:1066`, `:1154`.
- `client/src/pages/landing.tsx:42`.
- `client/src/pages/borrower-portal.tsx:87`, `:167`, `:183`, `:668`.
- `client/src/pages/changelog.tsx:83`, `client/src/pages/pricing.tsx:105`.
- `client/src/pages/coverage-page.tsx:62`, `client/src/pages/forgot-password.tsx:34`.
- `client/src/pages/field-scout.tsx:725`, `client/src/pages/night-cap.tsx:88`.
- `client/src/pages/command-center.tsx:1822`, `:1824`.
- `client/src/pages/founder-ai-observatory.tsx:750`, `:758`, `:779`.
- `client/src/pages/anticipatory-enterprise.tsx:802`, `client/src/pages/conscious-organization.tsx:819`.

**Fix:** add a Tailwind plugin or replace `min-h-screen` → `min-h-[100dvh]` (Tailwind ≥ 3.4 supports `min-h-dvh`). Or define `.mobile-vh-fix { min-height: 100dvh; }` and codemod.

### S3 — [P0] Raw `<Dialog>` on mobile-painful surfaces (should be `ResponsiveModal`)
The wrapper exists at `client/src/components/ui/responsive-modal.tsx`. Form-heavy modals open as a centered dialog on 375 px viewport — text gets clipped, keyboard pushes it offscreen. Worst offenders:
- `client/src/pages/founder-dashboard.tsx` — **34 Dialog instances**. Specifics:
  - `:1944-1965` shortcuts modal — fine as Dialog.
  - `:1969-2018` goal dialog (`max-w-xs` form) — should be ResponsiveModal.
  - `:3390-3428` bulk-import (`max-w-2xl` upload + select + textarea) — should be ResponsiveModal.
  - `:3802-3835` notes modal (textarea form).
  - `:3839-4202` scan-endpoints (`max-w-4xl max-h-[85vh]` — way too wide for 375).
  - `:4206…` expanded-tile modal (also large).
  - Plus ~28 others; treat all `max-w-2xl` + `max-w-4xl` Dialogs in this file as ResponsiveModal candidates.
- `client/src/pages/finance.tsx:240` — `Create Note` modal (`sm:max-w-[600px]`) wraps `<NoteForm>` (multi-field form). Should be ResponsiveModal.
- `client/src/pages/finance.tsx` (additional 3 Dialogs at later lines in the file).
- `client/src/pages/settings.tsx:1842-1878` — disable-2FA dialog with code input; tolerable but better as ResponsiveModal so the keyboard works.

**Fix:** Replace `<Dialog>` + `<DialogContent>` with `<ResponsiveModal>` + `<ResponsiveModalContent>` on form-heavy modals. Keep raw Dialog only for tiny confirmation modals (≤ 1 button row).

### S4 — [P0] `mobile-safe-content` only padding the bottom — top sticky bars stack on each other
`PageTopbar` (h-14, sticky top-0, z-30, `client/src/components/page-topbar.tsx:107`) plus tab navigations that are also `sticky top-0` create double stacks. Notable:
- `client/src/pages/founder-dashboard.tsx:6606` — secondary tab nav `sticky top-0 z-30` collides with PageTopbar `top-0 z-30`.
- `client/src/pages/founder-dashboard.tsx:3463`, `:3634`, `:4101` — sticky table headers `sticky top-0` also collide. They should be `top-14` (below the topbar) or use a scroll container with its own sticky context.

**Fix:** within PageShell pages, sticky bars need `top-14` not `top-0`. Or put them inside the page content (which scrolls under the topbar) and remove `sticky top-0`.

### S5 — [P1] `grid grid-cols-12` used as a faux-table on small viewports
At 375 px content width, a 12-col grid gives each column ~28 px — too narrow for any text. Founder-dashboard uses this pattern for at least 4 large lists:
- `:3214-3253` GIS endpoints list (6 cols including a URL column).
- `:3463-3500` data sources list.
- `:3634-3680` (similar list).
- `:4101-…` providers list.

**Fix:** wrap in `<div class="overflow-x-auto"><div class="min-w-[720px]"> … </div></div>` or codemod to `grid grid-cols-1 md:grid-cols-12`. The list rows (e.g. line 3225) should stack on mobile.

### S6 — [P1] Floating UI cluster on the right edge collides with right-rail + bottom-nav
Mounted globally in `client/src/App.tsx:1014-1016`:
- `FloatingActionButton` — `fixed bottom-[88px] md:bottom-4 right-4` (`client/src/components/floating-action-button.tsx:102`).
- `FloatingHelpButton` — `fixed bottom-[232px] md:bottom-[176px] right-4 z-[48]` (`client/src/components/floating-help-button.tsx:36`).
- `ConversationTray` toggle — `fixed bottom-[160px] md:bottom-24 right-4 z-[49]` (`client/src/components/conversation-tray.tsx:577`, `:600`).
- `MobileBottomNav` — `fixed bottom-0 z-50` (`client/src/components/mobile/MobileBottomNav.tsx:29`).

**Issue 1:** ConversationTray panel (`:610`) is `w-[360px] h-[500px]` fixed — at 375 px viewport it overflows past the right edge of the screen by `right-4 + 360 - 375 = 5 px`. Plus it's only 500 px tall but can extend beyond the visible viewport when keyboard is open.
**Issue 2:** Three stacked FABs at right-4 occupy a 168-px-tall vertical column on mobile — combined with the bottom-nav, that's `72 + 232 = ~304 px` of right-edge real estate eaten by floating UI on a 812-px viewport.

**Fix:** Mobile-only collapse all three into a single FAB with a popover for sub-actions. Switch `w-[360px]` to `w-[calc(100vw-32px)] sm:w-[360px]`.

### S7 — [P1] Charts hardcoded to `h-64` / `h-72` push other content off-screen
`client/src/pages/portfolio.tsx:609` — pie wrapper `h-64` (256 px). At 375 viewport you've already used the topbar (56) + page padding + hero header (~120), so a 256 px chart leaves the legend below the fold. Also at `:701`, `:737`, `:873`. `client/src/pages/finance.tsx` has multiple chart heights similarly fixed.

**Fix:** add responsive classes — `h-48 md:h-64` — and put the legend above the chart on mobile.

### S8 — [P2] Consistent use of `h-9` / `h-10` icon buttons without 44 px mobile minimum
`PageTopbar` action buttons are `h-9 w-9 min-h-9 min-w-9` (`client/src/components/page-topbar.tsx:158`, `:166`) — that's 36 px, below the 44 px touch target minimum. Same for the Search button at `:143` (`h-8`). Most of the customer pages now use `min-h-11 sm:min-h-9` (e.g. `client/src/pages/finance.tsx:771`, `:784`, `:807`) — make the topbar match.

**Fix:** Update PageTopbar buttons to `h-11 w-11 min-h-11 min-w-11 md:h-9 md:w-9 md:min-h-9 md:min-w-9`.

---

## 3. Per-page findings

### `/today` — `client/src/pages/today.tsx`
**P1**
- `:687` `grid grid-cols-3 gap-3` (Sovereign agents stat row) has no `sm:` breakpoint guard. At 375 px each tile is ~107 px, but the AnimatedCounter labels ("Pending approvals") wrap awkwardly. Use `grid grid-cols-1 sm:grid-cols-3` or shorten labels.
- `:725` `whitespace-nowrap` on "Show full dashboard" link — fine since paired with truncate-on-text-only, but verify it doesn't push the parent flex past 100% width on 375 px.

**P2**
- The "Business Pulse" panel (`:733-...`) uses `bg-gradient-to-br` and absolute-positioned ornamentation; spot-check on dark mode + 375 px to ensure no horizontal scroll bleed.

### `/pipeline` — `client/src/pages/pipeline.tsx`
**P0**
- `:307`, `:312`, `:318`, `:324`, `:330` — embeds full `<DealsPage />`, `<LeadsPage />`, `<PropertiesPage />`, `<CampaignsPage />` inside its own `<PageShell>`. Each of those child pages **also renders `<PageShell>`** (`client/src/pages/leads.tsx:1041`, `properties.tsx:451`, `deals.tsx:458`). This double-wraps Sidebar, PageTopbar, max-width container, error-boundary — visible as duplicated breadcrumb on mobile and 2× max-width clamping. **High-impact fix.**

**Fix:** make those child pages accept an `embedded?: boolean` prop and skip PageShell when true; or split each page into a `*Page` (with shell) + a `*Content` (without) pair, and have pipeline render the content variants.

### `/properties` — `client/src/pages/properties.tsx`
**P1**
- `:811` desktop table wrapped in `overflow-x-auto` — good. Verify the `Table` underneath doesn't have `min-w` larger than 100% causing horizontal scroll on the full page (only the inner div should scroll). Looks correct.
- `:1727` second `overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0` — good pattern, keep.

**P2**
- 3,280-line file; consider whether all the modals are using ResponsiveModal (49 ResponsiveModal references — looks comprehensive).

### `/deals` — `client/src/pages/deals.tsx`
**P0**
- `:1368-1376` `DealDetailDrawer` — `fixed inset-0 z-50` overlay + `fixed right-0 top-0 h-full w-full max-w-2xl` panel. On mobile the panel is `w-full` and `h-full`, which means it extends the full 812 px height — the bottom 72 px (action buttons / "Save" / "Close") will sit under MobileBottomNav. The internal `sticky top-0` header (`:1376`) is OK, but the bottom of the drawer needs `pb-[calc(72px+env(safe-area-inset-bottom))]` or a sticky bottom action row.

**P1**
- `:949` chart row with `overflow-x-auto pb-4 scrollbar-thin` — good.

### `/leads` — `client/src/pages/leads.tsx`
**P0**
- `:2431-2438` `LeadDetailDrawer` — same issue as deals drawer. `fixed h-full w-full max-w-2xl` extends past bottom nav; bottom action row hidden.

**P1**
- `:1464` desktop table is `hidden md:block` and `:1654` has a `block md:hidden` mobile card variant — pattern is correct.
- `:1925` `<ResponsiveModalContent className="sm:max-w-[600px] max-h-[80vh]">` — good.

### `/money` — `client/src/pages/money.tsx`
**P2**
- 135 lines, in PageShell. Spot-check the redirected Money landing — looks fine.

### `/finance` — `client/src/pages/finance.tsx`
**P0**
- `:240` `<Dialog><DialogContent className="sm:max-w-[600px] floating-window">` wrapping `<NoteForm />` — multi-field form modal. **Convert to ResponsiveModal** (S3).
- The other 3 Dialogs in this file likewise.

**P1**
- `:255` `grid grid-cols-1 md:grid-cols-4 gap-4` (KPI tiles) — fine.
- `:338-344` table column min-widths sum to ~640 px (140+140+90+80+100+80+80+50). Wrapped in `Table` — verify the Table primitive is inside an `overflow-x-auto` (search the file).
- `:255-256` glass-panel cards — should render correctly; keep an eye on the `bg-gradient` not overflowing.

**P2**
- `:1305-1310` numeric inputs already use `inputMode="decimal"` — good.

### `/portfolio` — `client/src/pages/portfolio.tsx`
**P1**
- `:302`, `:536`, `:660`, `:770`, `:908` — `dl grid grid-cols-1 md:grid-cols-N` for KPI rows — pattern is correct for stacking on mobile.
- `:609` `<div className="h-64">` chart wrapper — see S7. Add `h-48 md:h-64`.
- `:701`, `:737`, `:873` — same chart-height issue.

**P2**
- `:593` `grid grid-cols-1 lg:grid-cols-2 gap-6` — only goes 2-up at `lg` (1024 px); good.

### `/pax` — `client/src/pages/pax.tsx`
**P2**
- 678 lines, uses PageShell. No raw Dialogs. Spot-check the agent grid for narrow-viewport overflow.

### `/inbox` — `client/src/pages/inbox.tsx`
**P0**
- `:1020-1023` — **does not use PageShell.** Uses `Sidebar` directly with `flex min-h-screen` + `main h-screen`. On mobile this means: (a) no `mobile-safe-content` clearance under the bottom nav, (b) `h-screen` is `100vh` — broken on iOS Safari, (c) no PageTopbar.
- `:1136-1137` master/detail split: `flex-1 flex overflow-hidden` with two children that toggle `hidden md:block` / `hidden md:flex`. The master pane is `w-full md:w-96`. The mobile experience (master OR detail full-width) is correct, but the **outer `h-screen` makes the bottom of the message list scroll-clipped.**
- `:1023` `pt-16 md:pt-0` — manually adds top padding because there's no PageTopbar. Switching to PageShell fixes this.

**P1**
- `:1097-1132` second-level tabs (`Tabs`) — sticky stacking issue if PageTopbar is added without `top-14` adjustment.

**Fix:** wrap in `<PageShell label="Inbox">` and remove the manual `Sidebar` import + `min-h-screen` + `pt-16` workaround. The pane height should be `flex-1 min-h-0` (parent already provides height through PageShell mobile-safe-content).

### `/campaigns` — `client/src/pages/campaigns.tsx`
**P0**
- `:54-86` — uses `<SidebarProvider><Sidebar>` from `ui/sidebar` (the shadcn primitive, NOT the AcreOS sidebar). This is a completely different chassis. **No PageShell, no PageTopbar, no mobile-safe-content, no MobileBottomNav awareness.**
- `:86` `<main className="flex-1 flex flex-col overflow-auto">` — no bottom padding for the bottom nav.

**P1**
- `:104` `<TabsList className="w-full md:w-auto overflow-x-auto flex">` — good for mobile horizontal scrolling.

**Fix:** delete the entire SidebarProvider / Sidebar block at `:55-84`, replace `<main>` with `<PageShell label="Marketing hub">`, drop the `max-w-7xl` div (PageShell already does it).

### `/settings` — `client/src/pages/settings.tsx`
**P1**
- `:1842-1878` 2FA disable Dialog — could be ResponsiveModal but it's tiny (one input + 2 buttons), so acceptable.
- 3,075 lines — verify all forms are paginated by tab. Spot-check that any TabsList is `overflow-x-auto`.

**P2**
- Dense form rows likely render as 1-col on mobile via PageShell's max-width — acceptable.

### `/founder-home` — `client/src/pages/founder-home.tsx`
**P2**
- Uses `FounderPageShell` which wraps `PageShell` — clean.
- `:535` `motion.div … max-w-5xl` — good.
- `:557` `grid gap-4 sm:grid-cols-2 lg:grid-cols-4` — correct responsive pattern.
- `:465-478` AlertDialog for delete — fine as a small confirmation dialog.

### `/founder-dashboard` — `client/src/pages/founder-dashboard.tsx`
**P0**
- `:6510-6540` `AutopilotStatusBar` — `fixed bottom-0 left-0 right-0 z-40`. **Sits directly under MobileBottomNav (z-50, height 72 px).** When expanded (`:6533`), the panel grows upward but the collapse-trigger is *below* the bottom nav. On mobile, this entire component is invisible/unreachable.
- `:3463`, `:3634`, `:4101` sticky table headers `sticky top-0 bg-card` — collide with PageTopbar (`top-0 z-30`). Headers should be `top-14`.
- `:6606` secondary tab nav `sticky top-0 z-30` — same collision.
- `:3214-3253`, `:3463-…`, `:3634-…`, `:4101-…` — `grid grid-cols-12` faux-tables with no `overflow-x-auto` parent; rows literally compress 6 columns into 343 px (S5). Each `col-span-1`/`col-span-2` cell is ~28-56 px wide — text/URLs unreadable.

**P1**
- 34 `<Dialog>` instances; convert form-heavy ones to ResponsiveModal (see S3 for which).
- `:3840` `max-w-4xl max-h-[85vh] overflow-hidden flex flex-col` — `max-w-4xl` (~896 px) is moot at 375 px (will clamp to viewport), but combine with the inner `grid grid-cols-12` and you get unreadable content. Add `overflow-x-auto` inside.
- `:2829` `SelectTrigger className="w-[140px]"` — fixed-width Select inside a row that may not fit at 375.

**P2**
- 7,452 lines in one file; this is a refactor target separate from the mobile fix.
- `:6535` `grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8` — fine.
- `:7382` `max-w-[85%]` on chat bubbles — fine.

**Fix priority for this file:** (1) Hide AutopilotStatusBar on mobile or move it `bottom-[72px]`. (2) Add `overflow-x-auto` to all four `grid-cols-12` lists. (3) Sticky tab nav → `top-14`.

### `/founder-todo`, `/founder-letter`, `/founder-decisions`, `/founder-trends`
**P2**
- All use PageShell (`founder-todo.tsx:172`, `founder-letter.tsx:170`, `founder-decisions.tsx:362`, `founder-trends.tsx:83`). Spot-check that internal grids stack correctly at 375 px.

### `/auth` — `client/src/pages/auth-page.tsx`
**P1**
- `:66`, `:92`, `:106` — `min-h-screen` (S2). On iOS Safari the SignIn widget will be vertically off-center when the address bar collapses on scroll.
- `:106` `px-4 py-12` — fine; `max-w-md` Clerk widget fits 375.

**P2**
- `:155` "Back to home" link uses `min-h-11` — good.

### `/onboarding-v2` — `client/src/pages/onboarding-v2.tsx`
**P1**
- `:1066`, `:1154` — `min-h-screen bg-gray-950` (S2).
- `:1180-1185` content centered with `flex-1 flex items-center justify-center p-6` — on a 375 × 812 viewport with a 1-px progress bar + 56-px header, you get 755 px to vertically center content. Fine, but the long step content (e.g. `:1218 target_county`) will overflow and the parent `flex items-center` will clip it.
- Buttons like `:1209` `className="w-full bg-primary py-3"` — `py-3` is 12 px each = 24 + line-height ~24 = ~48 px effective height; OK for touch.

**Fix:** swap `min-h-screen` → `min-h-[100dvh]`. Switch the centering wrapper to `min-h-0 flex-1 overflow-y-auto py-8` so long steps scroll properly.

**P2**
- Dark theme (`bg-gray-950`) is intentional onboarding aesthetic — out of scope.

### `/landing` — `client/src/pages/landing.tsx`
**P2**
- `:42` `min-h-screen bg-background` — replace with `min-h-[100dvh]`.
- 62-line file; rest of the landing lives in `client/src/pages/landing/`.

---

## 4. Smaller surfaces — quick observations

- `client/src/components/conversation-tray.tsx:610` — `w-[360px]` panel overflows 375-px viewport (S6).
- `client/src/components/founder/AgentTeamChat.tsx:319` — textarea `min-h-[40px] max-h-[120px]` is fine; verify the parent wrapper has `pb-safe` if mounted at the bottom of a page.
- `client/src/components/dynamic-island.tsx:89` — `fixed inset-x-0 top-4 z-[9998]` — sits on top of PageTopbar (z-30). On a 375-viewport with the topbar visible at the same y-position, the island should auto-hide or move to `top-[64px]`.
- `client/src/components/page-topbar.tsx:158`, `:166` — icon-only buttons `h-9 w-9 min-h-9 min-w-9` (36 px) are below 44-px touch-target minimum on mobile (S8).
- Five+ founder/admin surfaces (`audit-log.tsx:179`, `data-export.tsx:188`, `event-log.tsx:191`, `forecasting.tsx:265`, `founder-experiments.tsx:327`, `job-health.tsx:186`, `vision-ai.tsx:219`) use `flex-1 min-w-[200px]` for filter rows — at 375 with two such children + gap, that's `200+200+gap = 416+ px > 375`. Should be `min-w-[160px]` or `flex-1 basis-full sm:basis-auto`.

---

## 5. Quick wins (each ~5–10 min)

1. **PageTopbar touch targets** (`client/src/components/page-topbar.tsx:158`, `:166`) — change `h-9 w-9 min-h-9 min-w-9` to `h-11 w-11 min-h-11 min-w-11 md:h-9 md:w-9 md:min-h-9 md:min-w-9`. Single edit, two buttons.

2. **Hide AutopilotStatusBar on mobile** (`client/src/pages/founder-dashboard.tsx:6514`) — add `hidden md:block` to the `<aside>` className. One token change. Removes the worst founder-dashboard mobile collision.

3. **ConversationTray panel width** (`client/src/components/conversation-tray.tsx:610`) — change `w-[360px]` to `w-[calc(100vw-2rem)] sm:w-[360px]`. One edit.

4. **Replace `min-h-screen` with `min-h-[100dvh]`** in PageShell chassis (`client/src/components/page-shell.tsx:76`). One edit; cascades to every PageShell page on iOS Safari.

5. **Wrap founder-dashboard `grid-cols-12` lists in horizontal scroll** — for each of `:3214`, `:3463`, `:3634`, `:4101`, wrap the parent `<div className="space-y-2 max-h-96 overflow-y-auto">` in `<div className="overflow-x-auto"><div className="min-w-[720px]">…</div></div>`. Four small edits.

6. **Add `pb-[88px]` to lead/deal detail drawers** — `client/src/pages/leads.tsx:2438` and `client/src/pages/deals.tsx:1368` — append `pb-[calc(72px+env(safe-area-inset-bottom)+1rem)]` to the inner panel className.

7. **Convert finance Create-Note Dialog → ResponsiveModal** (`client/src/pages/finance.tsx:234-249`) — copy the import line + replace 4 tag names. Highest-impact single Dialog→ResponsiveModal swap.

8. **Wrap inbox in PageShell** (`client/src/pages/inbox.tsx:1019-1024`) — replace the `<div class="flex min-h-screen">…<Sidebar /><main h-screen pt-16>` outer block with `<PageShell label="Inbox">`. Drop the manual sidebar + h-screen + pt-16.

9. **Wrap campaigns in PageShell** (`client/src/pages/campaigns.tsx:54-87`) — delete the `<SidebarProvider><Sidebar>…</Sidebar>` block, drop the `<main>`'s outer styling, wrap content in `<PageShell label="Marketing hub">`.

10. **Founder-dashboard sticky tab nav top offset** (`:6606`) — change `sticky top-0 z-30` to `sticky top-14 z-20`. Fixes the topbar collision.

11. **Founder-dashboard sticky table headers** (`:3463`, `:3634`, `:4101`) — same change: `sticky top-14` (or use a scroll container with its own sticky context).

12. **Portfolio chart heights** — `client/src/pages/portfolio.tsx:609`, `:701`, `:737`, `:873` — change `h-64` → `h-48 md:h-64`. Four edits, immediate visible improvement on mobile.

---

## 6. Suggested follow-ups (not quick wins, but high-value)

- **A) Pipeline embedded-page double-shell.** Refactor `pipeline.tsx` to render `*Content` variants of leads/properties/deals/campaigns, not the full `*Page` exports. Estimated: 1–2 hours per page.
- **B) Founder-dashboard refactor.** 7,452 lines is unmaintainable. Split into `tabs/<TabName>Tab.tsx` files. The mobile-grid issue then becomes a per-tab fix with smaller blast radius.
- **C) `mobile-vh-fix` utility.** Add `.mobile-vh-fix { min-height: 100dvh; min-height: 100svh; }` to `index.css` and codemod 30+ `min-h-screen` usages.
- **D) Mobile chart story.** Define a `<MobileResponsiveChart>` wrapper that auto-collapses tooltips, raises font sizes, and clamps height to `h-48` on mobile. Apply across `/portfolio`, `/finance`, `/founder-dashboard`.
- **E) Right-edge floating UI consolidation.** Replace `FloatingActionButton + FloatingHelpButton + ConversationTray toggle` stack with a single `MobileFAB` that opens a popover on tap. Saves ~200 px of right-edge real estate.

---

End of audit.
