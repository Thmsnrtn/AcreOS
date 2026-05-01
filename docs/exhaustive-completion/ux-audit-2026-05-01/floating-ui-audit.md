# Floating / Sticky UI Audit — 2026-05-01

**Auditor framing:** Senior UX lead. Founder reports "too many floating buttons, makes it feel cluttered."
**Verdict up front:** the founder is right. AcreOS currently mounts **9 always-on floating elements** for every authenticated user on every route, plus 2 stacked top banners, plus the rail, plus the topbar, plus dialogs. On a 375 × 667 iPhone screen this eats ~55% of the viewport before any product content loads. Several elements are redundant (two notification bells, FAB + ⌘K + new-item menu all do the same job, help button duplicates what ⌘K already exposes). Three components are imported but never mounted (dead code).

The cleanup is mostly delete and route-gate, not redesign.

---

## 1. Total floating-element inventory

Mounted in `client/src/App.tsx` (the global app shell), in mount order:

| # | Name | Path | Always-on? | Position | z-index | Mobile? | Desktop? |
|---|------|------|------------|----------|---------|---------|----------|
| 1 | `EarlyAccessBanner` | `client/src/components/early-access-banner.tsx:32` | until dismissed (localStorage) | inline top, mx-4 mb-2 | n/a (in-flow) | yes | yes |
| 2 | `TrialBanner` | `client/src/components/trial-banner.tsx:27` | when org has trial | inline top, mx-4 mb-2 | n/a (in-flow) | yes | yes |
| 3 | `FloatingActionButton` | `client/src/components/floating-action-button.tsx:102` | **yes (no hide conditions)** | `fixed bottom-[88px] md:bottom-4 right-4 md:right-16` | `z-50` | yes | yes |
| 4 | `ConversationTray` | `client/src/components/conversation-tray.tsx:577,600,610` | yes | `fixed bottom-[160px] md:bottom-24 right-4 md:right-16` | `z-[49]` | yes | yes |
| 5 | `FloatingHelpButton` | `client/src/components/floating-help-button.tsx:36` | yes | `fixed bottom-[232px] md:bottom-[176px] right-4 md:right-16` | `z-[48]` | yes | yes |
| 6 | `CommandPalette` (⌘K) | `client/src/components/command-palette.tsx` | open-on-keypress | full-screen modal | z-50 | yes (kbd shortcut hidden) | yes |
| 7 | `NewItemMenu` | `client/src/components/new-item-menu.tsx:108,122` | open-on-keypress | full-screen modal | `z-50` | yes | yes |
| 8 | `MobileBottomNav` | `client/src/components/mobile/MobileBottomNav.tsx:29` | mobile only (`isMobile && !isKeyboardOpen`) | `fixed bottom-0 left-0 right-0` | `z-50` | yes | no |
| 9 | `OnboardingWizard` | `client/src/components/onboarding/OnboardingWizard.tsx:749` | when `org.onboardingCompletedAt` null | `fixed inset-0` | `z-50` | yes | yes |
| 10 | `PaxCopilotRail` | `client/src/components/pax-copilot-rail.tsx:983,990` | desktop only, hidden on `/ai` | `fixed right-0 top-0 h-screen` (w-[360px] open / w-12 closed) | `z-40` | no (returns null mobile) | yes |
| 11 | `DynamicIsland` | `client/src/components/dynamic-island.tsx:89` | yes (transient pill, but mount is always-on) | `fixed inset-x-0 top-4` | `z-[9998]` | yes | yes |
| 12 | `NotificationBanner` (bell + transient banner) | `client/src/components/notification-banner.tsx:99,140,167` | yes | `fixed top-4 right-4 md:right-16` (bell) and `top-16` (banner + tray) | `z-40` / `z-50` | yes | yes |
| 13 | `NpsDialog` | `client/src/components/nps-dialog.tsx` | conditional (NPS schedule) | dialog overlay | dialog z (`z-50`) | yes | yes |
| 14 | `PWAInstallPrompt` | `client/src/components/pwa-install-prompt.tsx:49,83` | conditional (install eligibility) | `fixed bottom-4 left-4 right-4 md:right-4 md:w-96` | `z-50` | yes | yes |
| 15 | `OfflineIndicator` | `client/src/components/offline-indicator.tsx:39,50` | when offline / reconnecting | `fixed top-0 left-0 right-0` | `z-[100]` | yes | yes |
| 16 | `Toaster` (radix) | `client/src/components/ui/toast.tsx:17` | when toasted | `fixed top-0 right-0 sm:top-4 sm:right-4` | `z-[100]` | yes | yes |
| 17 | `CookieConsentBanner` | `client/src/components/cookie-consent-banner.tsx:45` | first visit | `fixed bottom-0 left-0 right-0` | `z-50` | yes | yes |
| 18 | `KeyboardShortcutsModal` | `client/src/components/keyboard-shortcuts-dialog.tsx` | open-on-keypress | dialog | `z-50` | yes | yes |
| 19 | `DealModalsHost` | (host) | conditional | dialog | `z-50` | yes | yes |
| 20 | `BetaActivationDetector` | (toast trigger, no UI) | conditional | n/a | n/a | yes | yes |

Mounted further down the tree (in layout / routes):

| # | Name | Path | Where | Position | z-index |
|---|------|------|-------|----------|---------|
| 21 | `Sidebar` (`LayoutSidebar`) | `client/src/components/layout-sidebar.tsx` | app shell wrap | left rail, fixed/collapsible | implicit |
| 22 | `PageTopbar` | `client/src/components/page-topbar.tsx:107` | inside `PageShell` (most app routes) | `sticky top-0` | `z-30` |
| 23 | `DevBanner` | `client/src/components/dev-banner.tsx:8` | inside sidebar, line `1155` | inline | n/a |
| 24 | Founder dashboard **Autopilot status bar** | `client/src/pages/founder-dashboard.tsx:6514` | only on `/founder-dashboard` | `fixed bottom-0 left-0 right-0` | `z-40` |
| 25 | Founder dashboard **section nav** | `client/src/pages/founder-dashboard.tsx:6606` | only on `/founder-dashboard` | `sticky top-0` | `z-30` |
| 26 | `field-scout` page floating action stack | `client/src/pages/field-scout.tsx:1417,1452` | `/field-scout` only | `fixed bottom-6 right-4` and `fixed top-16 left-0 right-0` | implicit |
| 27 | `field-scout` page header | `client/src/pages/field-scout.tsx:727` | `/field-scout` | `sticky top-0` | `z-50` |
| 28 | Pricing page nav | `client/src/pages/pricing.tsx:108` | `/pricing` (logged-out) | `sticky top-0` | `z-50` |
| 29 | Borrower portal mobile bar | `client/src/pages/borrower-portal.tsx:1375` | `/borrower-portal` mobile | `fixed bottom-0 left-0 right-0` | implicit |
| 30 | `BulkActionBar` | `client/src/components/bulk-action-bar.tsx:62` | conditional on selection | `fixed bottom-6 left-1/2 -translate-x-1/2` | `z-50` |
| 31 | `FieldWorkToolbar` | `client/src/components/field-work-toolbar.tsx:29` | (not currently mounted in shell) | `fixed bottom-0 left-0 right-0` | `z-50` |
| 32 | `PaxMemoryPanel` | `client/src/components/pax-memory-panel.tsx:241` | opened from rail | `fixed inset-y-0 right-0` | `z-50` |
| 33 | `OnboardingWalkthrough` | `client/src/components/founder/OnboardingWalkthrough.tsx` | founder-only | overlay | `z-50` |
| 34 | `ProductTour` | `client/src/components/onboarding/ProductTour.tsx:207,216` | conditional | `fixed inset-0` | `z-[9998]` / `z-[9999]` |
| 35 | `LiveDemoMode` | `client/src/components/live-demo-mode.tsx` | demo mode | high z | `z-50` |

**Dead-code (exported, no caller):**

- `FloatingAssistant` — `client/src/components/floating-assistant.tsx:171` — never imported. Aside w/ `fixed bottom-20 right-4`.
- `QuickCaptureFab` — `client/src/components/quick-capture-fab.tsx:18` — never imported. `fixed bottom-20 right-4 z-50`.
- `QuickActionsMenu` — `client/src/components/quick-actions-menu.tsx:103` — never imported. `fixed bottom-20 right-4 z-50`.
- `BetaFeedbackWidget` — `client/src/components/beta-feedback-widget.tsx:37` — never imported. `fixed bottom-4 right-4 z-50`.
- `FieldWorkToolbar` — `client/src/components/field-work-toolbar.tsx:29` — never imported.

These are landmines. Any future careless import re-introduces a stack collision at `bottom-20 right-4`, which is exactly where the ConversationTray (`bottom-[160px] right-4`) and FAB live.

---

## 2. Stacking analysis — what shows simultaneously

### Mobile (375 × 667 iPhone SE), authenticated, fresh first-load on `/dashboard`

Top of viewport (in z-order, top to bottom in document):
1. `OfflineIndicator` (only if offline) — 36 px tall.
2. `EarlyAccessBanner` — ~52 px (rounded card with X dismiss).
3. `TrialBanner` — ~52 px (only first 30 days).
4. `PageTopbar` — 56 px (h-14, sticky, z-30).
5. `DynamicIsland` — pill ~32 px overlaying top-4 (z-9998).
6. `NotificationBanner` bell — 40 px round at top-4 right-4 (z-40), **duplicate of bell already in PageTopbar at line 175**.
7. `NotificationBanner` transient banner — when active, top-16 right-4, ~80 px tall.
8. `Toaster` — top-0 right-0 (z-100).

Bottom of viewport:
1. `FloatingActionButton` — 56 px circle at bottom-[88px] right-4.
2. `ConversationTray` — 56 px circle at bottom-[160px] right-4.
3. `FloatingHelpButton` — 56 px circle at bottom-[232px] right-4.
4. `MobileBottomNav` — 72 px bar at bottom-0 (z-50).
5. `CookieConsentBanner` — first visit, bottom-0 (z-50). **Stacks on top of MobileBottomNav.**
6. `PWAInstallPrompt` — bottom-4 left-4 right-4 (z-50). **Also stacks on top of MobileBottomNav.**

**Worst-case mobile stack height (first-time visitor on mobile, online, with trial + early-access + cookie consent + PWA prompt):**

Top: 52 + 52 + 56 = **160 px** of vertical space gone before content (banners + topbar). Add 40 px duplicate notification bell hovering at top-right.
Bottom: 72 (mobile nav) + 96 (cookie banner) + 96 (PWA prompt) = **264 px** stacked at bottom (cookie + PWA both `z-50` and `bottom-4` → they overlap each other).
Right rail of bottom: 56 (FAB) + 56 (tray) + 56 (help) = three circles vertically stacked over ~232 px, occupying right side of the bottom half.

**Total chrome on first-load mobile = 160 + 264 = 424 px out of 667 = 64% of the viewport.** 236 px left for product content. This matches the founder's "cluttered" report.

Even on the steady state (cookie dismissed, PWA dismissed, banners dismissed, no toast): topbar 56 + mobile nav 72 + 3 stacked FABs eating right side = chrome consumes ~25% of mobile viewport plus most of the bottom-right corner.

### Desktop (1440 × 900), authenticated, on `/dashboard`

Top: 56 (topbar) + ~52 (early-access banner if active) + ~52 (trial banner if active) = 160 px.
Right: PaxCopilotRail closed = 48 px; open = 360 px.
Bottom-right corner: FAB + tray + help stacked vertically (3 × 56 px buttons + gaps = ~232 px). FAB at `right-16` (64 px) **collides with PaxCopilotRail when rail is open at 360 px** — the three FABs are sitting on top of the rail.
Top-right: NotificationBanner bell at `right-16` (64 px) + Toaster at `right-4` + DynamicIsland centered. Bell duplicates the bell in PageTopbar.

### Founder on `/founder-dashboard`, desktop

Layered chrome unique to this route:
- App `PageTopbar` (sticky, z-30).
- Founder section nav (sticky, z-30, line 6606).
- Autopilot status bar (fixed bottom-0, z-40, line 6514).
- Plus all globals (FAB, tray, help, rail, dynamic island, notification bell).

This is the worst surface. Two sticky tops, one fixed bottom, three FABs on right, rail on right. The Autopilot bar at `bottom-0` is hidden behind the MobileBottomNav on mobile and creates a double-bar at bottom on desktop because there's nothing else in that slot.

---

## 3. Per-element scorecard

Format: **value / clutter / verdict**.

### FloatingActionButton (`floating-action-button.tsx:14`)
- Value: **medium-low.** Quick-create lead/property/deal. Same surface offered by ⌘K command palette and `NewItemMenu` (cmd+N or similar) and the sidebar "+" buttons.
- Clutter: **high** on mobile (top of a 3-FAB tower), **high** on desktop (collides with PaxCopilotRail when open).
- Verdict: **REMOVE on desktop. Keep on mobile only**, or fold into MobileBottomNav as a center "+" tab. Desktop users have ⌘K.

### FloatingHelpButton (`floating-help-button.tsx:31`)
- Value: **low.** Opens a sheet that lists shortcuts + feedback + docs. ⌘K already lists shortcuts; feedback is also in `EarlyAccessBanner`, settings, and the help sheet itself; docs are a link.
- Clutter: **medium** — third FAB in the tower.
- Verdict: **REMOVE.** Fold its three actions (shortcuts, feedback, docs) into ⌘K as command-palette entries. Brief §1.2 "considered, not loud" — a help button you click twice a year is loud.

### ConversationTray (`conversation-tray.tsx:577`)
- Value: **medium.** Real chat with team agents. But on customer side it's the Pax mask, and on founder side this overlaps with `PaxCopilotRail` (the rail IS the conversational entry).
- Clutter: **high** — middle of the FAB tower.
- Verdict: **CONSOLIDATE.** Customer side: rename to "Pax" and merge with whatever Pax-as-a-mask surface they get (the rail is already this). Founder side: kill the tray, the rail is canonical. Net effect: tray dies, rail handles both audiences.

### EarlyAccessBanner (`early-access-banner.tsx:32`)
- Value: **low** post-launch. It's a pre-launch "we'd love feedback" with a feedback CTA.
- Clutter: **medium.** Eats 52 px at the top of every page until dismissed.
- Verdict: **CONDITIONAL.** Dismissed-by-default for paying tiers; show only for `tier === 'free'` or first 14 days of org. Or: kill outright, the feedback link belongs in user menu.

### TrialBanner (`trial-banner.tsx:27`)
- Value: **high during trial.** "X days left" is a real thing.
- Clutter: **medium.** 52 px every page.
- Verdict: **KEEP**, but make it a single-line strip (not a card), and only show in the last 7 days of trial — not the whole 30. Move the "X days left" badge into PageTopbar between breadcrumb and bell for the rest.

### NotificationBanner (`notification-banner.tsx:140`)
- Value: **low as currently shipped.** The "bell" duplicates the bell already in `PageTopbar:175`. The transient banner at `top-16` is fired by the `acreos:notifications:open` event from the topbar bell — but the standalone bell at `top-4 right-4` is its own button, mounted always.
- Clutter: **high** — duplicate bell. Two bells, ~50 px apart on desktop, identical icon.
- Verdict: **REMOVE the standalone bell.** Promote the transient banner + tray-dropdown to be triggered by the PageTopbar bell only. Single source of truth.

### CookieConsentBanner (`cookie-consent-banner.tsx:45`)
- Value: **legally required** in EU/CA jurisdictions, but only first visit.
- Clutter: **high** when shown — bottom-0 stacks on top of MobileBottomNav, no z-index discipline (both `z-50`).
- Verdict: **KEEP, but raise z-index above MobileBottomNav** (move to `z-[60]`) and shift mobile-nav up by banner height while shown. Today they overlap.

### NpsDialog (`nps-dialog.tsx`)
- Value: **medium** — research signal.
- Clutter: **low** when shown (it's a real dialog, not chrome).
- Verdict: **KEEP** (already gated by `npsData?.shouldShow`).

### PaxCopilotRail (`pax-copilot-rail.tsx:990`)
- Value: **high.** Conversational primary. Hides on mobile (`isMobileViewport return null`), hides on `/ai`.
- Clutter: **medium** desktop — collides with FABs at `right-16`.
- Verdict: **KEEP.** Fix the FAB collision by either (a) killing the desktop FAB tower entirely (preferred), or (b) shifting FAB right-position to `right-[368px]` when rail open. Option (a) is simpler.

### DynamicIsland (`dynamic-island.tsx:89`)
- Value: **medium-high** for transient state. Today it's mounted always; only renders content when context fires.
- Clutter: **low** when empty (pointer-events-none, no visual). Higher when active (z-9998 above everything).
- Verdict: **KEEP.** Already transient by design. Verify the no-message state truly renders zero pixels — the `pointer-events-none fixed inset-x-0 top-4` wrapper is fine.

### MobileBottomNav (`mobile/MobileBottomNav.tsx:29`)
- Value: **high** on mobile (primary nav).
- Clutter: **n/a** desktop (returns null), **medium** mobile (it's chrome but it's also the navigation).
- Verdict: **KEEP.** Add the FAB as a center-tab "+" so the right-side FAB tower can die on mobile too.

### PageTopbar (`page-topbar.tsx:107`)
- Value: **high.** Breadcrumb + ⌘K + bell + theme.
- Clutter: **low** — sticky 56 px is reasonable.
- Verdict: **KEEP.** It is the canonical home for the bell — kill `NotificationBanner`'s duplicate bell.

### Sidebar (`layout-sidebar.tsx`)
- Value: **high.**
- Clutter: irrelevant — it's the nav.
- Verdict: **KEEP.**

### Toaster (`ui/toast.tsx:17`)
- Value: **high** for transient feedback.
- Clutter: **low** (event-driven).
- Verdict: **KEEP.** Reposition to `top-16 right-4` to clear the duplicate bell area, or leave at `top-4` and accept it.

### OfflineIndicator (`offline-indicator.tsx:39`)
- Value: **high** when offline.
- Clutter: **low** (only shown when offline / reconnecting).
- Verdict: **KEEP.** But consider routing through DynamicIsland instead of being its own fixed bar — then it becomes one less component.

### PWAInstallPrompt (`pwa-install-prompt.tsx:49`)
- Value: **medium.**
- Clutter: **medium-high** mobile — stacks at `bottom-4` on top of MobileBottomNav and CookieConsent.
- Verdict: **CONDITIONAL.** Only show in user menu / settings, plus a one-time inline card on `/dashboard`, not a fixed prompt. Or at minimum, raise z-index above MobileBottomNav and add a backoff so it never co-shows with the cookie banner.

### Founder Autopilot status bar (`founder-dashboard.tsx:6514`)
- Value: **medium** — surfaces autopilot run status.
- Clutter: **high** on mobile (overlaps MobileBottomNav at bottom-0; both `z-40`/`z-50`), **medium** desktop.
- Verdict: **CONSOLIDATE** into DynamicIsland or a sidebar card. Stop having a route-specific fixed bottom bar that competes with global chrome.

### Founder section nav (`founder-dashboard.tsx:6606`)
- Value: **high** for that page (six sections, anchor jumps).
- Clutter: **medium** — second sticky-top below PageTopbar.
- Verdict: **KEEP.** Make sure its `top-` offset accounts for the topbar height.

### NewItemMenu (`new-item-menu.tsx`)
- Value: **medium** — alternative quick-create. Activated by keyboard.
- Clutter: **low** (only when triggered).
- Verdict: **CONSOLIDATE into ⌘K.** Quick-create is already in ⌘K. NewItemMenu is a duplicate keyboard surface; if it stays, name its hotkey clearly. If ⌘K covers it, delete this component.

### KeyboardShortcutsModal
- Value: **medium.**
- Clutter: **low** (modal).
- Verdict: **KEEP.**

### Dead-code FABs (FloatingAssistant, QuickCaptureFab, QuickActionsMenu, BetaFeedbackWidget, FieldWorkToolbar)
- Verdict: **DELETE the files.** Each is one careless `<FloatingAssistant />` away from making the cluttered situation worse.

---

## 4. Recommended cleanup plan, ordered by impact-per-effort

| # | Action | Impact | Effort | Risk |
|---|--------|--------|--------|------|
| 1 | **Delete** `FloatingHelpButton` mount in `App.tsx:1016`. Move shortcuts + feedback + docs into ⌘K as command entries. | High (kills a FAB) | 30 min | Low |
| 2 | **Delete** the duplicate notification bell in `NotificationBanner` (lines 140–160). PageTopbar bell becomes canonical; wire `acreos:notifications:open` to open the existing tray dropdown from the topbar bell. | Medium-high (no more two bells) | 30 min | Low |
| 3 | **Hide `FloatingActionButton` on desktop.** Add `hidden md:hidden` or condition on `!isMobile`. On mobile, fold into MobileBottomNav as a center "+" tab. | High (kills 1 FAB desktop, eventually 0 on mobile) | 45 min for MBN integration | Low |
| 4 | **Hide `ConversationTray` when `PaxCopilotRail` is mounted** (i.e., desktop, non-`/ai`). Tray and rail are redundant on desktop. | Medium (kills 1 FAB desktop) | 20 min | Low |
| 5 | **Delete dead-code components**: `floating-assistant.tsx`, `quick-capture-fab.tsx`, `quick-actions-menu.tsx`, `beta-feedback-widget.tsx`, `field-work-toolbar.tsx`. | Medium (prevents future regressions) | 10 min | Low — verify no string refs first |
| 6 | **Make `EarlyAccessBanner` time/tier-gated.** Show only for tier=free or org age < 14 days. | Medium (banner row reclaimed) | 20 min | Low |
| 7 | **Collapse banners into a single rotating strip.** EarlyAccess + Trial + UsageLimit + ProviderReadiness rendered as a single h-10 strip with carousel/dot indicator if multiple are active. Cap visible banners to 1. | Medium-high (worst-case top stack drops from 160 → 110 px) | 2 hours | Medium |
| 8 | **z-index discipline.** Pick one scale: chrome z-30, FABs z-40, modals z-50, transient/island z-60, offline/toast z-70. Today CookieConsent and MobileBottomNav both z-50, FAB z-50, Tray z-49, Help z-48 — these need to become a documented stack. | Medium (no more visual collisions) | 1 hour | Low |
| 9 | **Move CookieConsent above MobileBottomNav** (z-60) and add a body-padding hook so the mobile nav shifts up by banner height while shown. | Medium (visual bug fix) | 30 min | Low |
| 10 | **Founder Autopilot bar → DynamicIsland.** Replace `fixed bottom-0` aside (`founder-dashboard.tsx:6514`) with a DynamicIsland subscriber. | Medium (kills route-local bottom bar) | 2 hours | Medium |
| 11 | **Move TrialBanner content into PageTopbar** as a small badge except in the final 7 days. | Low-medium | 1 hour | Low |
| 12 | **Delete `NewItemMenu` if ⌘K covers it**, else document the hotkey distinction. | Low (one less keyboard surface) | 15 min | Low |

---

## 5. Specific consolidations

### (a) Merge Help into ⌘K palette
The help sheet has three things: Keyboard Shortcuts, Send Feedback, Documentation. ⌘K already exposes shortcuts. Add two commands to `command-palette.tsx`:
- `Send feedback` → opens `FeedbackDialog` (already imported in `floating-help-button.tsx:8`).
- `Open documentation` → links out to `/docs` (or external).
Then delete `FloatingHelpButton`. One row, three commands, zero new chrome.

### (b) Collapse 3 banners into 1 rotating strip
A single sticky strip that carries: `EarlyAccess`, `Trial`, `UsageLimit`, `ProviderReadiness`, in that priority order, only one visible at a time. Multiple-active state shows a `1 of 3` dot indicator. Strip height locked to 36 px (not 52). On mobile, this reclaims the difference. Suggested location: a new `<TopBannerStack />` component slotted between `Skip to content` and `PageWrapper` in `App.tsx:1003`.

### (c) Bell unification
Today: PageTopbar bell (line 175) dispatches `acreos:notifications:open`. NotificationBanner has its own bell (line 140) that opens the tray inline. Wire the topbar bell to manage the same `showTray` state via the event, then delete the NotificationBanner standalone bell. Keep the transient banner content (line 99) as it's distinct from the tray.

### (d) FAB tower → context-driven
Mobile: kill the right-side tower entirely. Center "+" in `MobileBottomNav` covers create. ⌘K covers everything else (mobile users won't use it but mobile users primarily browse, not author).
Desktop: kill the entire tower. ⌘K + sidebar "+" + page-level "New …" buttons handle authoring. PaxCopilotRail (closed = 48 px tab) handles the conversational surface that the tray was for.

### (e) Tray ↔ Rail disambiguation
Per project memory rule (customers see Pax only; founder sees the full agent roster), the rail is the persona-aware conversational surface. The Conversation Tray was added before the rail and now duplicates it. Removing the tray on any surface where the rail mounts is the cleanest fix — and the rail already returns null on mobile, so on mobile, replace the tray with a single "Chat with Pax" entry in MobileBottomNav (or in ⌘K).

---

## 6. Quick wins (under 10 min each)

1. **Delete dead-code files** — `floating-assistant.tsx`, `quick-capture-fab.tsx`, `quick-actions-menu.tsx`, `beta-feedback-widget.tsx`, `field-work-toolbar.tsx`. None are imported. (`grep -r "from \"@/components/floating-assistant\"" client/src` returns nothing — same for the others.) Removes 5 high-z-index landmines.
2. **Comment out `FloatingHelpButton` mount** at `App.tsx:1016`. Instant FAB-tower reduction from 3 → 2. Zero feature loss for users who know ⌘K (the in-product hint already nudges them).
3. **Add `if (!isMobile) return null;`** to `FloatingActionButton` (`floating-action-button.tsx:14`). Desktop drops to 1 FAB (the tray).
4. **Bump `CookieConsentBanner` z-index** from `z-50` to `z-[60]` (`cookie-consent-banner.tsx:45`) so it stops overlapping `MobileBottomNav` (also z-50).
5. **Delete the bell at `notification-banner.tsx:140`** (15 lines, lines 136–160). Replace with a TODO comment that the PageTopbar bell is canonical and should subscribe to the same data.
6. **Tighten `EarlyAccessBanner` localStorage check** so non-dismissers eventually time out — e.g., auto-dismiss after 30 days regardless. One-line change in `early-access-banner.tsx:11`.
7. **Lower `DevBanner` rendering** to `import.meta.env.DEV` only (verify it's not bleeding into prod) — `layout-sidebar.tsx:1155`. Trivial gate.
8. **Document the floating-slot constants.** `App.tsx:1008-1013` already has a comment block describing slots 0/1/2 — add the actual `bottom-` values to a `lib/floating-slots.ts` constants file (referenced by the comment but the file may not exist; verify and create if missing). Future devs stop hardcoding `bottom-[88px]` / `bottom-[160px]` / `bottom-[176px]` magic.

---

## Closing — what should die

If I had to pick the single largest wins by impact-per-keystroke:

1. **`FloatingHelpButton` — delete.** Help is a power-user concern; ⌘K is the right home.
2. **`FloatingActionButton` on desktop — delete.** Sidebar "+" + ⌘K + per-page "New …" cover this.
3. **`ConversationTray` — delete or merge with rail.** Two conversational entry points is one too many.
4. **`NotificationBanner` standalone bell — delete.** PageTopbar already has one.
5. **Dead-code FABs (5 files) — delete.** They are tripwires.

After those five deletes, the FAB tower is gone, the duplicate bell is gone, and the dead code is gone. Mobile reclaims ~170 px of the bottom-right corner. Desktop reclaims the corner that was colliding with the rail. Mobile worst-case top stack drops from 160 → 110 px once banners are also collapsed. The product still does everything it did before.

The founder's instinct ("too many floating buttons") maps directly to the codebase: 9 always-on floating elements is too many. Get to 4 (PageTopbar, Sidebar, MobileBottomNav-with-create-tab, PaxCopilotRail) plus transient (DynamicIsland, Toaster, Offline) and the cluttered feeling goes away without losing capability.
