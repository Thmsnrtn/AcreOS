# Unified Build Progress

Last updated: 2026-04-25 — end of session 1

## Phases
- [x] Pre-Flight — extraction (commit 8a55b3a)
- [x] Housekeeping — screenshots parked + .gitignore (commit 2b8fe93)
- [x] Phase 0 — Prerequisites (rollback tag pre-unified-build at 2b8fe93, pushed)
- [/] Phase 1 — Foundation (Gate A pending operator)
  - [x] 1.1 — Source inventory (commit 77405e0)
  - [x] 1.2 — Design token extraction (commit c275e42)
  - [x] 1.3 — Globals replacement architecture (commit 7ba3a74)
  - [x] 1.4 — Founder mode authorization code (commit 782393d) — ⚠ Gate A pending
  - [ ] 1.5 — Feature flag infrastructure
  - [ ] 1.6 — Phase 1 completion
- [ ] Phase 2 — Tier 0 Shell
- [ ] Phase 3 — Tier 1 Pipeline Core
- [ ] Phase 4 — Tier 2 Sourcing
- [ ] Phase 5 — Tier 3 Closing
- [ ] Phase 6 — Tier 4 Ops
- [ ] Phase 7 — Tier 5 Founder Mode
- [ ] Phase 8 — Coverage Pass
- [ ] Phase 9 — Final Coherence Pass
- [ ] Phase 10 — Handoff Preparation

## Current State
Phase: 1.4 → 1.5
**Status: Gate A pending — operator must set Fly secret FOUNDER_USER_IDS**
Last commit: 782393d (Phase 1.4 founder mode authorization)

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
