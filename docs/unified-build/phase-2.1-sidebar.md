## Phase 2.1 — Sidebar: surgical overlay

Per resume note ("the build applies design as a layer over existing components") and per CLAUDE.md ("Don't add features beyond what the task requires"), Phase 2.1 made minimal targeted changes rather than a wholesale rewrite of the 1310-line production sidebar.

### Production sidebar already meets the prototype's structural requirements

| Requirement (mega prompt §2.1) | Production status |
|---|---|
| Use shadcn/ui primitives where applicable | ✅ `Sheet`, `Button`, `Tooltip`, `Popover`, `Badge` |
| Tailwind with extracted tokens | ✅ shadcn `--sidebar-*` HSL tokens (warm earth palette aligned with `--acr-sidebar-bg`) |
| All states (idle, hover, focus, active) | ✅ `nav-item-active` (Tahoe-capsule pill from elite-refinement), hover, focus-visible |
| Mobile drawer <768px | ✅ `Sheet` with `md:hidden` trigger |
| Persistent ≥768px | ✅ `hidden md:flex` desktop sidebar |
| Keyboard navigation, ARIA | ✅ `<nav aria-label="Main navigation">`, `aria-current="page"`, `aria-label` on icon buttons |
| Founder section gated internally | ✅ `useAuth().isFounder` filters `NAV_MODULES` and renders the mobile founder-home link conditionally; the auth surface honors `FOUNDER_USER_IDS` from Phase 1.4 |
| Sidebar collapsed state persisted server-side | ✅ via `SidebarContext` + user preferences |
| 44px touch targets on mobile | ✅ `min-h-[44px]` on every nav row |

### What this commit changed

Added `data-tour-nav={module.id}` (or `="founder-business"` for the mobile founder-home shortcut) to all five sidebar nav surfaces so the guided tour from Phase 1.3 (`useTour()`) can anchor steps:

1. `layout-sidebar.tsx:734` — desktop expanded module row wrapper
2. `layout-sidebar.tsx:1168` — collapsed mode, no-children Link
3. `layout-sidebar.tsx:1206` — collapsed mode, has-children popover trigger button
4. `layout-sidebar.tsx:986` — mobile expanded module row wrapper
5. `layout-sidebar.tsx:954` — mobile founder-home shortcut

The attribute name matches the prototype's `data-tour-nav={item.id}` convention from `acreos/shell.jsx:29`.

### What was deliberately NOT changed

**Active state styling.** Production has the elite-refinement Tahoe-capsule (`nav-item-active` in `index.css:704-721`) — a rounded pill with primary tint and inset glass specular. The prototype uses a flat 2px brand-colored left indicator pip. These are different visual languages. Per the resume note ("Don't undo any existing `[elite-refinement]` slice work"), the Tahoe capsule stays. Both treatments share the same intent (clear active affordance with brand color); the production treatment is the more refined evolution.

**Sidebar palette tokens.** The shadcn `--sidebar-*` HSL tokens already produce a warm earth palette close to `--acr-sidebar-bg`. Flipping every component over to the `--acr-*` namespace would risk breaking surfaces that depend on shadcn semantic tokens. Tokens stay parallel — the `--acr-*` namespace is for new prototype-specific surfaces; the shadcn namespace stays the truth for existing components.

**PaxNotificationBadge, NotificationCenter, ThemeToggle, AcreosLogo wiring.** All elite-refinement work. Untouched.

### Verification

- `npm run check` → clean
- 5 `data-tour-nav` anchors confirmed via grep
- No structural changes that could regress mobile drawer, collapse, or founder gating
