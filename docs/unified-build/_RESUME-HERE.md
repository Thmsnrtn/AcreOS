# RESUME HERE — Unified Build, Session 3

The full canonical prompt lives at `docs/unified-build/UNIFIED-BUILD-PROMPT.md`.
Read that first if you don't have full context.

## Where the build stands

Phase 0 prerequisites: ✅ (rollback tag `pre-unified-build` at `2b8fe93`).
Phase 1 foundation: ✅ (tokens, globals, founder auth, flags).
Phase 2 Tier 0 Shell: ✅ structurally — tour anchors on all sidebar nav surfaces, visible search trigger (3 surfaces), command palette + custom event opener, audit closes on toast/palette/shortcuts. Deployed and smoke-tested at https://acreos.io.

**Critical context: Phase 2 was structurally correct but visually under-applied.** Production looks essentially the same as it did before Phase 2 — the prototype's homestead palette, big serif display type, and brand-pip active state didn't visibly land. Root cause: misreading "preserve refinement" as preserving visual treatments. Course correction is in `UNIFIED-BUILD-PROMPT.md` under "Visual Application Mandate" and "Phase 2A".

Operator Gate A: ✅ `FOUNDER_USER_IDS=user_3CK2u6pGH7EYHgFyMS99fwhLSM7` deployed on Fly (digest `890511d964d7abda`).

Operator stash recovery (mishap from session 2): the user WIP that was accidentally popped is preserved as **dangling commit `bd9d6af`** (`WIP on main: 7aa9aee fix: mount health endpoints before WhiteLabel middleware`). Recover with `git stash apply bd9d6af` if/when wanted. Two unrelated stashes (`stash@{0}` Clerk redirect, `stash@{1}` health endpoints) remain in `git stash list` untouched.

## Next action: Phase 2A — Visual Revisit + Public Surfaces

Phase 2A.1 first: **Sidebar visual application.** Read `/acreos/shell.jsx` Sidebar section + `SHELL_CSS` for `.acr-sidebar`, `.acr-nav-item`, `.acr-nav-item-active`. Apply to `client/src/components/layout-sidebar.tsx`:

1. Replace `nav-item-active` (in `client/src/index.css:704`) with the prototype's treatment: subtle `var(--acr-surface)` background + `box-shadow: var(--acr-shadow-1), inset 0 0 0 0.5px var(--acr-line)` + 2px × 14px brand-color pip at `left: -10px` via `::before`. Per `acreos/shell.jsx:195-203`.
2. Switch sidebar background from `bg-sidebar` (shadcn HSL) to `bg-acr-sidebar-bg` (`#F1E7D0` from prototype `theme.jsx`).
3. Match prototype nav-item type: `font: 500 13px/1`, `letter-spacing: -0.005em`.
4. Match prototype nav-group title: `font: 500 10.5px/1`, uppercase, `letter-spacing: 0.07em`, `color: var(--acr-ink-4)`.
5. Active item icon goes brand-color; active badge becomes brand-tinted (`var(--acr-brand-soft)` bg, `var(--acr-brand)` text).
6. Sidebar container padding `14px 10px` per prototype.

Preserve as engineering refinement: all `aria-*` attributes, `min-h-[44px]` mobile touch targets, mobile Sheet pattern, white-label brand name resolution, PaxNotificationBadge / NotificationCenter / ThemeToggle wiring, founder gating via `useAuth().isFounder`, all `data-tour-nav` and `data-tour` anchors from Phase 2.1/2.2, the visible search trigger from Phase 2.2.

Update the prototype-reference comment at the top of `layout-sidebar.tsx` to reflect what changed.

Commit: `feat(shell): sidebar visual treatment per prototype [unified-build]`

After 2A.1, proceed through 2A.2 (other Tier 0 visual application), 2A.3 (landing — `client/src/pages/landing.tsx` per `/acreos-landing/` prototype), 2A.4 (onboarding — `client/src/components/onboarding/` per `/acreos-onboarding/` prototype), 2A.5 (deploy + smoke). See UNIFIED-BUILD-PROMPT.md Phase 2A section for the full breakdown.

## Loop guidance for self-paced runs

After each commit, decide:
- **ScheduleWakeup (270s)** — mid-phase work, more commits in the same logical unit
- **End loop** — phase boundary, gate, ~85% context, before any deploy or risky action

Deploys (`fly deploy`), force-pushes, destructive git, external service writes pause for explicit operator approval — do not auto-fire from the loop.

## Hard reminders

- `[unified-build]` tag on every commit
- Co-Authored-By trailer on every commit
- Don't undo engineering-quality elite-refinement work (a11y, mobile, perf, code organization)
- DO override visual treatments that conflict with the prototype (Visual Application Mandate)
- Run `npm run check` after server-side changes; `npm run build` before deploy
- The 10 pre-existing test failures are baseline (DB-dependent + calendar drift + nested zod) — don't let them block, but don't add new ones either
