# Elite-Team Refinement — Resume Point

**Last session:** 2026-04-23 (session 2 of N)
**Last completed surface:** `EmptyState` (cross-cutting, commit `50624fb`)
**Phase 1 inventory:** ✅ committed at `11d0e8c`

## How to continue

Paste the original Elite-Team prompt into a fresh Claude Code session. The
session will:

1. Read `docs/refinement/surface-inventory.md` — the ordered list of ~500
   surfaces with known issues and priority.
2. Read `docs/refinement/progress.md` — log of surfaces already signed-off.
3. Read this file for the immediate next surface.
4. Continue the walk.

## Progress summary

### Completed this pass (8 surfaces)
- `/` landing — hero responsive, CTAs stack, pricing teaser grid
- `/not-found` — warmer copy, secondary recovery path, muted tone
- `/auth` — aerial backdrop, Clerk `colorPrimary` branded, a11y tap
  target on back-link
- `/onboarding-v2` — brand-color CTAs (13 instances), dollar-cell
  overflow fix, primary header color
- `PageLoader` (cross-cutting) — branded A-tile loader replaces bare
  spinner
- `ThemeSettings` (cross-cutting, `/settings`) — responsive preset
  grid, "Reset to Desert" escape hatch, aria-pressed
- `QueryErrorState` (cross-cutting) — role="alert" a11y announce,
  warmer copy
- `EmptyState` (cross-cutting) — action icon opt-out, real list
  semantics, a11y

### Major cross-cutting gains
- Root-level Clerk `colorPrimary` override kills default purple on
  every Clerk widget across auth.
- Global 404/403 toast suppression in `queryClient.ts` (from earlier
  session) means no more red error spam.
- Branded loader replaces every tiny-spinner-on-empty-background moment.

## Next surface to refine

**`/leads`** — table-heavy, core authenticated workflow.

Likely refinement targets (from inventory + code scan):
- Mobile: ~2000-line file with complex table; verify horizontal
  overflow handling, filter drawer on 375px, bulk-select row UX.
- Status badges already recolored in earlier pass; verify other
  interactive elements still on-brand.
- Empty state uses the new `EmptyState` primitive — verify it reads
  well with the refinements.
- Detail drawer: Radix `<Sheet>`? Verify it takes full-screen on mobile.
- Bulk actions bar: tap target sizing.

## Queue after `/leads`

In inventory order:
1. `/leads/dedupe`
2. `/properties` (map + list split — notorious mobile complexity)
3. `/deals` (kanban — verify on 375px)
4. `/finance`
5. `/settings` (1700 lines; tabs and forms)
6. `/campaigns`
7. `/inbox`
8. `/documents`
9. `/dashboard`

## Session hygiene reminders

- Commit per surface (or tight batch). One commit = one logical unit.
- Re-run 9-lens after each edit, not just at start/end.
- Verify via Playwright MCP at 375px AND 1440px where appropriate.
- Update `docs/refinement/progress.md` with every sign-off.
- Stop at ~85% context; rewrite this file before ending.
- **Playwright auth expires fast.** If the session was using a
  user-signed-in Playwright state and cookies die, fall back to
  code-only refinement of authenticated pages and ask the user to
  re-sign the Playwright browser.

## Known in-flight issues

- **Purple-on-Safari** — addressed via:
  - Clerk `colorPrimary` (main.tsx)
  - Violet/purple → primary on today/leads/deals/onboarding
  - `ThemeSettings` "Reset to Desert" escape hatch
  If user reports purple persists, they're probably on `midnight`
  preset in Safari's `localStorage['acreos-theme-config']`. The
  Reset link now fixes it in one tap.
- **Red error notifications** — 404/403 suppressed globally. Real
  500s still surface.
- **Fly deploy leases** can linger ~90s after a failure; retry if the
  lease-held error appears.

## Expected HEAD after session 2 deploy

`50624fb` or later.
