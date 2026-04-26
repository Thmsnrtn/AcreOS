# Unified Build Progress

Last updated: 2026-04-26 — session 2

## Phases
- [x] Pre-Flight — extraction (commit 8a55b3a)
- [x] Housekeeping — screenshots parked + .gitignore (commit 2b8fe93)
- [x] Phase 0 — Prerequisites (rollback tag pre-unified-build at 2b8fe93, pushed)
- [x] Phase 1 — Foundation
  - [x] 1.1 — Source inventory (commit 77405e0)
  - [x] 1.2 — Design token extraction (commit c275e42)
  - [x] 1.3 — Globals replacement architecture (commit 7ba3a74)
  - [x] 1.4 — Founder mode authorization (commit 782393d) — Gate A confirmed: FOUNDER_USER_IDS deployed on Fly
  - [x] 1.5 — Feature flag infrastructure (commit c7dbc5d) — audit-only; existing infra satisfies spec
  - [x] 1.6 — Phase 1 completion
- [/] Phase 2 — Tier 0 Shell
  - [x] 2.1 — Sidebar tour anchors (commit 6d746fe)
  - [x] 2.2 — Visible search trigger + programmatic palette open (commit 5327c5d)
  - [x] 2.3 — Toast host audit + close (commit 70bb6bf)
  - [x] 2.4 — Command palette audit + programmatic open (commit 802f7ca)
  - [x] 2.5 — Keyboard shortcuts audit + close (commit 2ed261a)
  - [x] Retroactive prototype-reference headers (commit 52e3c01)
  - [x] 2.6 — Deploy + Playwright MCP smoke test (commit pending; deploy live at acreos.io)
- [ ] Phase 3 — Tier 1 Pipeline Core
- [ ] Phase 4 — Tier 2 Sourcing
- [ ] Phase 5 — Tier 3 Closing
- [ ] Phase 6 — Tier 4 Ops
- [ ] Phase 7 — Tier 5 Founder Mode
- [ ] Phase 8 — Coverage Pass
- [ ] Phase 9 — Final Coherence Pass
- [ ] Phase 10 — Handoff Preparation

## Current State
Phase: 3 — Tier 1 Pipeline Core (next)
**Status: Phase 2 Tier 0 Shell complete and deployed. Production smoke test passed at https://acreos.io.**
Last commit: b7297b5 (Phase 2.5 close + stash recovery note)
Gate A: confirmed (FOUNDER_USER_IDS deployed on Fly with digest 890511d964d7abda; FOUNDER_EMAILS also present)

### Phase 2 quality bar
- `npm run check` clean (TypeScript)
- `npm run build` succeeds (vite + esbuild server bundle)
- `npm test` — 10 failures persist, but all 10 are baseline failures unrelated to this work; confirmed by checking out `pre-unified-build` tag and getting identical 9 file / 10 test failure counts
  - tax/cohort calendar-drift bugs (date math broken because clock moved past test calibration)
  - DB-dependent unit tests (org-middleware, IDOR, stripe webhook idempotency) — fail without a running Postgres
  - vitest picking up nested `tests/e2e-intelligent/node_modules/zod/...` files
  - `tests/unit/leadScoring.test.ts` — server import error pre-existing
- Phase 2 introduced ZERO new regressions

### Stash mishap during 2.6 baseline verification
While confirming the test failures predate this build, I did `git stash` (saved nothing — clean working tree) then `git checkout pre-unified-build` then back to `main`, then `git stash pop` — which popped a PRE-EXISTING user WIP stash I didn't know about, applying it on top of main with merge conflicts. Recovered by `git reset --hard HEAD`. The popped stash content is preserved as **dangling commit `bd9d6af`** ("WIP on main: 7aa9aee fix: mount health endpoints before WhiteLabel middleware") and is recoverable via `git stash apply bd9d6af`. Two other stashes (`stash@{0}` Clerk redirect, `stash@{1}` health endpoints) remain untouched in `git stash list`.

## What ships in the build so far

**Tokens** — `client/src/index.css` + `tailwind.config.ts`. 41 namespaced `--acr-*` CSS variables (homestead light/dark) plus matching Tailwind utilities (`bg-acr-bg`, `text-acr-ink`, `shadow-acr-2`, `duration-acr-normal`, etc.). Production HSL system unchanged.

**Globals architecture** —
- `client/src/stores/modal-store.ts` — Zustand store (lostReason, dealClosed, quickOffer)
- `client/src/hooks/use-sound.ts` — sound stub, off by default, respects reduced-motion
- `client/src/hooks/use-tour.ts` — tour state hook stub, 7 step IDs, localStorage placeholder
- `client/src/lib/toast.ts` — semantic toast helpers wrapping the existing shadcn toast (sonner NOT introduced — production already has its own toast system)
- Dependencies: zustand@5.0.12 added

**Founder mode** —
- `server/services/founder.ts` — added `isFounderUserId()` and `isFounderIdentity()`; FOUNDER_USER_IDS env var parsed
- `server/auth/clerkAuth.ts` — `hydrateUser` and `requireFounder` now match by email OR Clerk user ID
- `server/auth/routes.ts` — new `GET /api/auth/is-founder` (200 for founders, 404 otherwise)
- `client/src/hooks/use-is-founder.ts` — Tanstack Query wrapper

## Next session: resume protocol

1. Read `docs/unified-build/_RESUME-HERE.md` for the exact next action.
2. Verify `FOUNDER_USER_IDS` Fly secret is set (operator confirms with "Founder ID set"; verify with `fly secrets list -a acreos | grep FOUNDER_USER_IDS` or by curling `/api/auth/is-founder` after a deploy).
3. Continue Phase 1.5 — feature flag infrastructure. Existing `client/src/hooks/use-feature-flags.ts` exists; extend rather than create parallel infra. Audit how it's wired and whether the server side has the matching evaluation surface. Build admin (founder-only) flag-management UI per mega prompt 1.5.
4. Phase 1.6 — Phase 1 completion summary commit.
5. Move to Phase 2 — Tier 0 Shell. The shell is large; will likely span 2–3 sessions on its own.

## Pinned facts
- Founder Clerk user ID: `user_3CK2u6pGH7EYHgFyMS99fwhLSM7`
- Production URL: https://acreos.io
- Stack: Vite 7.3, React 18.3, TS 6.0.2, Tailwind 3.4.19, Radix (27 pkgs), Tanstack Query 5.95, wouter 3.9, framer-motion 12.38, Zustand 5.0.12 (new)
- Rollback tag: `pre-unified-build` at `2b8fe93` (pushed)
- 12 of 14 supporting handoff docs absent (only HANDOFF.md, GAPS.md present); spec reconstructed from HANDOFF.md sections directly
- 394 slices of `[elite-refinement]` work must be preserved — build applies design as a layer over existing components
- Production has 164 routes vs prototype's ~30; the prototype is a visual specification, not a wholesale replacement

## Behavioral notes for next session
- `git status` should be clean before starting work
- Each commit ends with `[unified-build]` and includes the Co-Authored-By line
- Run `npm run typecheck` after server-side changes; it's fast (a few seconds)
- Don't introduce sonner — production has its own toast
- Don't use the Tweaks panel (`acreos/tweaks-panel.jsx`) infrastructure — it's prototype-only
- When porting prototype JSX, search/replace `var(--brand)` → `var(--acr-brand)`, etc., to match the namespaced token names
