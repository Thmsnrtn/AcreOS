# Platform UX audit

**Date:** 2026-04-21

Triggered by founder observation: "buttons in the lower right hand
corner are rendered on top of each other and that is just an example.
this app should be held to the highest standard like a best in class
mac/ios/apple app."

## What was caught + shipped

### UX-1: Floating-dock chaos
Eight independently-positioned floating components in the lower-right.
Three collision pairs confirmed:

| Component | Original position | Overlap |
|---|---|---|
| FloatingActionButton | `bottom-4 right-4 z-50` | BetaFeedbackWidget (same) |
| BetaFeedbackWidget | `bottom-4 right-4 z-50` | FAB (same) |
| FloatingHelpButton | `bottom-6 right-6` | FAB on small screens |
| QuickCaptureFAB | `bottom-20 right-4 z-50` | QuickActions, ConvoTray, Feedback |
| QuickActionsMenu | `bottom-20 right-4 z-50` | QuickCapture, ConvoTray, Feedback |
| ConversationTray | `bottom-20 right-4 z-40` | QuickCapture, QuickActions, Feedback |
| FeedbackButton | `bottom-20 right-6 z-40` | all of the above |
| NotificationBanner (mobile) | `bottom-20 right-4 z-40` | all |

**Fix:** canonical slot system in `client/src/lib/floating-slots.ts`.
Vertical stack at 72px intervals, right-aligned consistently,
descending z-index. Removed `QuickActionsMenu` (duplicate of FAB) and
`BetaFeedbackWidget` (duplicate of FeedbackButton).

### UX-2: 13 orphan founder pages
Founder pages shipped without sidebar nav. `FounderHomePage` was
imported but never routed (`/founder` redirected to the legacy
7362-line dashboard).

**Fix:** new "Founder business" sidebar module (founderOnly, default
expanded) with 13 children: Todo, Letter, Decisions, Preview, Trends,
Strategy, Expansion, Onboarding, Experiments, Prompt evolutions,
Tools, Providers, Founder settings. `/founder` now serves the clean
home. Legacy dashboard preserved at `/founder-dashboard`.

### UX-3: Dock under MobileBottomNav
`MobileBottomNav` is `fixed bottom-0 h-[72px]`. Every dock button at
`bottom-4` rendered UNDER it on phones.

**Fix:** responsive offsets — mobile values push up 72px to clear the
nav. Desktop values unchanged.

### UX-4: Dock under PaxCopilotRail
`PaxCopilotRail` is `fixed right-0` with `w-12` (48px) collapsed.
Dock at `right-4` sat BEHIND the collapsed rail on desktop.

**Fix:** `md:right-16` on every dock item (64px = 48 rail + 16 gap).
Mobile stays at `right-4` since the rail isn't rendered small.

### UX-5: Duplicate "attention queue" on /founder
Home showed both the new P-9 "What needs you" card AND the legacy
AttentionQueue section. Two cards, same job.

**Fix:** removed the legacy section. P-9 aggregates 7 inbox sources
and strictly supersedes the single-source original.

### UX-housekeeping
- `FounderDecisionsPage` was the only founder page not using
  PageShell — now wrapped for consistent sidebar + error boundary.
- Mobile sidebar "Founder Dashboard" link + label aligned with
  desktop: now points to `/founder` with label "Founder home."

## What was NOT caught (requires judgment or live visual)

Items I looked at but deemed not clearly-broken-without-seeing:

- **Max-width consistency across founder pages.** Different pages
  genuinely need different widths (charts wider than narrative), so
  the mix of 4xl/5xl/6xl is defensible.
- **Today page fetches 9+ endpoints on load.** Performance concern,
  not UX; and staleTime caches mitigate.
- **Toast position.** `z-[100]` overlaps dock visually when a toast
  is up, but toasts are transient.
- **Dark mode pass.** My founder pages include dark-mode color pairs
  (`dark:bg-*` etc); a visual pass would verify but no obvious gaps.
- **Pax rail width on phones.** Rail doesn't check `isMobile`; on a
  narrow screen, 360px open rail covers most of the layout. This is a
  design decision (keep rail universal vs desktop-only) that's your
  call.

## Suggested next passes — RESOLVED (founder delegated; executed with judgment)

### UX-6 shipped (resolves all 5 items above)

1. **Pax rail mobile** → hidden on mobile (<768px). Rail was 360px
   wide on a 390px phone — a takeover, not a rail. Mobile chat:
   /ai, conversation tray in dock, command palette.
2. **Help consolidation** → FloatingHelpButton sheet is the single
   primary surface. Sheet now hosts HelpPanel + "Send feedback" +
   "Open full help center →" link to /help.
3. **Feedback discovery** → folded into the help sheet above. Dock
   slot retired. FeedbackButton component is a no-op shim for
   backwards-compatible imports.
4. **Onboarding wizard timing** → sessionStorage guard ensures it
   opens at most once per tab. Dismissed users aren't re-prompted
   until a fresh browser session.
5. **Notification placement** → bell + banner both top-right on all
   screen sizes (macOS/iOS convention). Bell at top-4, tray+banner
   at top-16 so they coexist cleanly.

### Final floating dock roster

| Slot | Component | Notes |
|---|---|---|
| 0 (bottom) | FloatingActionButton | primary "new ..." CTA |
| 1 (stacked) | ConversationTray | chat with agents |
| 2 (stacked) | FloatingHelpButton | help + feedback + help-center link |
| — | NotificationBanner bell | moved to top-right |

Went from 8 components fighting 4 positions → 3 components in
deterministic slots.

## Commits

```
19267c1  UX-1 unify floating dock, kill duplicates, PageShell decisions
b1a30a4  UX-2 wire 13 founder pages to sidebar + activate FounderHomePage
54d713d  UX-3 mobile dock clears the 72px MobileBottomNav
8697147  UX-4 dock clears PaxCopilotRail on desktop
41ea449  UX-5 remove duplicate Attention Queue from /founder home
6cadd37  UX-6 resolve all 5 judgment calls (rail hide, help merge, onboarding once, notif top-right)
```

6 commits of structural UX cleanup. Not cosmetic — all were actually
broken layouts or architectural dead weight.
