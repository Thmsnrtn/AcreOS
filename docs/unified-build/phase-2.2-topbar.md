## Phase 2.2 — Top bar: architectural divergence + gap closure

### Production has no global top bar — by design

The prototype renders a sticky `<header className="acr-topbar">` with crumbs/title left and AI/notifications/dark-mode right (`acreos/shell.jsx:93-127`). Production took a different architectural path: each page renders its own header via `PageHeader` (`client/src/components/ui/page-header.tsx`), and the sidebar header holds the global controls (brand, notifications, theme).

This is elite-refinement work and has consequences across hundreds of pages. Replacing it with a global top bar would force a coordinated rewrite of every page header. Per the resume note ("the build applies design as a layer over existing components"), the production architecture stays.

### Where the prototype's top-bar features live in production

| Prototype top-bar feature | Production location |
|---|---|
| Page title / crumbs | `<PageHeader>` per page |
| ⌘K search trigger (visible) | **Was missing — added this commit** |
| AI sparkle "Ask" button | `pax-copilot-rail` (right rail, fixed position) + PaxNotificationBadge in sidebar |
| Notifications bell | `NotificationCenter` in sidebar header |
| Theme toggle | `ThemeToggle` in sidebar footer / mobile-nav footer |
| Mobile menu trigger | `Sheet` trigger fixed at top-left (`layout-sidebar.tsx:1098`) |

### Gap this commit closed: visible ⌘K trigger

The global `CommandPalette` (mounted in `App.tsx:968`) listened only for the ⌘K keyboard shortcut. There was no visible trigger — desktop power users knew it; mobile users had no way to invoke search at all.

Changes:

1. **`command-palette.tsx`** — added a `acreos:open-command-palette` CustomEvent listener so any surface can open the palette programmatically without dispatching synthetic keyboard events.

2. **`layout-sidebar.tsx`** — added a visible search trigger in three places, each dispatching the custom event:
   - Desktop expanded sidebar: full-width "Search or jump to…" pill with ⌘K kbd hint, immediately below the brand header (matches the prototype's `acr-search-trigger` placement)
   - Desktop collapsed sidebar: icon-only `Search` button with tooltip showing "Search · ⌘K"
   - Mobile drawer: full-width search row with `min-h-[44px]` touch target; tap closes the drawer (`onNavClick`) and opens the palette

All three carry `data-tour="cmd-palette-trigger"` per mega prompt §2.5 (keyboard shortcuts / tour anchors).

### Verification

- `npm run check` → clean
- 3 visible search triggers across desktop expanded/collapsed and mobile
- Custom event listener does not interfere with the existing ⌘K keyboard binding
- Mobile users can now open the palette by tap; desktop users can discover ⌘K from the visible kbd hint
