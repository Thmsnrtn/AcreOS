# RESUME HERE — Unified Build, autonomous run

**Run mode: fully autonomous through Phase 10.** Operator authorized auto-fire deploys, pushes, smoke tests, migrations. End the loop only at 85% context or genuinely unresolvable Gate B ambiguity (rare — default to picking the recommended option, document in `phase-X.Y-decision-<topic>.md`, continue).

The full canonical prompt lives at `docs/unified-build/UNIFIED-BUILD-PROMPT.md`.
Read that first if you don't have full context.

## Where the build stands

Phase 0 prerequisites: ✅ (rollback tag `pre-unified-build` at `2b8fe93`).
Phase 1 foundation: ✅ (tokens, globals, founder auth, flags).
Phase 2 Tier 0 Shell: ✅ structurally — tour anchors on all sidebar nav surfaces, visible search trigger (3 surfaces), command palette + custom event opener, audit closes on toast/palette/shortcuts. Deployed and smoke-tested at https://acreos.io.

**Critical context: Phase 2 was structurally correct but visually under-applied.** Production looks essentially the same as it did before Phase 2 — the prototype's homestead palette, big serif display type, and brand-pip active state didn't visibly land. Root cause: misreading "preserve refinement" as preserving visual treatments. Course correction is in `UNIFIED-BUILD-PROMPT.md` under "Visual Application Mandate" and "Phase 2A".

Operator Gate A: ✅ `FOUNDER_USER_IDS=user_3CK2u6pGH7EYHgFyMS99fwhLSM7` deployed on Fly (digest `890511d964d7abda`).

Operator stash recovery (mishap from session 2): the user WIP that was accidentally popped is preserved as **dangling commit `bd9d6af`** (`WIP on main: 7aa9aee fix: mount health endpoints before WhiteLabel middleware`). Recover with `git stash apply bd9d6af` if/when wanted. Two unrelated stashes (`stash@{0}` Clerk redirect, `stash@{1}` health endpoints) remain in `git stash list` untouched.

## Next action: Phase 2A.2 — Tier 0 visual application (remaining shell)

Phase 2A.1 (sidebar visual treatment) is complete (commit `1bca3f3`). Continue with Phase 2A.2: apply prototype palette and visual treatments across the remaining Tier 0 shell.

**2A.2 work:**

1. **Command palette modal styling** (`client/src/components/command-palette.tsx`).
   Read `acreos/command-palette.jsx` lines 108-130 for `CP_CSS`. Apply:
   - Backdrop: `color-mix(in srgb, var(--acr-bg-sunken) 60%, transparent)` + `backdrop-filter: blur(10px)`
   - Modal: `var(--acr-surface)` bg, `0.5px solid var(--acr-line)`, `border-radius: 14px`, `box-shadow: var(--acr-shadow-3)`
   - Width 560px (currently 640px); `max-height: 70vh`
   - Group titles: `font: 500 10.5px/1`, uppercase, `letter-spacing: 0.08em`, `color: var(--acr-ink-4)`
   - Active item: `var(--acr-brand-soft)` background, brand-color icon
   - **Bottom keyboard-hint footer** (currently absent): `↑↓ navigate · ↵ open · ⌘J ask` per prototype `.cp-foot`
   - Empty state copy: "Ask AcreOS '<query>'" with "Press ↵ to send as a question to AcreOS Intelligence" microcopy
   - Placeholder: "Search or ask AcreOS…" (currently "Search pages, actions, or type a question…")

2. **Toaster kinds** (`client/src/components/ui/toaster.tsx` and/or its variant CSS).
   Apply `var(--acr-pos)`, `var(--acr-warn)`, `var(--acr-neg)` semantic tints to success/warn/error toasts. Hover-check the toast variants exist; if shadcn's default variant only is `destructive`, extend with semantic variants in the toast component.

3. **Keyboard shortcuts modal** (`client/src/components/keyboard-shortcuts.tsx`).
   Apply prototype typography density. Match the prototype's serif headings if any are visible in `acreos/settings.jsx` Help section. Modal background uses `var(--acr-surface)`.

Each component keeps its prototype-reference header; document what was changed.

Commit per logical area:
- `feat(palette): visual treatment per prototype [unified-build]`
- `feat(toaster): semantic kind colors per prototype [unified-build]`
- `feat(shortcuts): visual treatment per prototype [unified-build]`

## After 2A.2

- 2A.3 — Public landing page (`client/src/pages/landing.tsx` per `/acreos-landing/` prototype). Most-visible surface.
- 2A.4 — Public onboarding (`client/src/components/onboarding/` per `/acreos-onboarding/` prototype).
- 2A.5 — `fly deploy -a acreos` (auto-fire authorized) + Playwright MCP smoke against acreos.io. Then continue into Phase 3.

## Loop guidance (autonomous mode)

After each commit:
- **ScheduleWakeup 270s** if more work in the same logical unit, in-cache iteration
- **ScheduleWakeup 1200s** if waiting for a deploy to propagate or external state to settle
- **End the loop** ONLY at 85% context (forced break) or genuinely unresolvable Gate B ambiguity

Auto-fire authorized: `fly deploy`, `git push`, smoke tests, npm install for required deps, schema migrations. Still need operator: force-push, hard-reset to non-HEAD, deleting unmerged branches, modifying Fly secrets / Clerk / Stripe accounts directly, stash pop of operator's WIP.

## Hard reminders

- `[unified-build]` tag on every commit
- Co-Authored-By trailer on every commit
- Don't undo engineering-quality elite-refinement work (a11y, mobile, perf, code organization)
- DO override visual treatments that conflict with the prototype (Visual Application Mandate)
- Run `npm run check` after server-side changes; `npm run build` before deploy
- The 10 pre-existing test failures are baseline (DB-dependent + calendar drift + nested zod) — don't let them block, but don't add new ones either
- Autonomous run: don't ask the operator to confirm deploys, smoke tests, pushes, or visual judgment calls — pick the recommended option and continue, document the choice for Phase 9 review
