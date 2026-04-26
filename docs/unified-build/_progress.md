# Unified Build Progress

Last updated: 2026-04-26 — session 2 close (v3 prompt + /loop setup)
Canonical prompt: `docs/unified-build/UNIFIED-BUILD-PROMPT.md` (v3)

## Phases

- [x] Pre-Flight — extraction (commit 8a55b3a)
- [x] Housekeeping — screenshots parked + .gitignore (commit 2b8fe93)
- [x] Phase 0 — Prerequisites (rollback tag pre-unified-build at 2b8fe93, pushed)
- [x] Phase 1 — Foundation
  - [x] 1.1 — Source inventory (commit 77405e0)
  - [x] 1.2 — Design token extraction (commit c275e42)
  - [x] 1.3 — Globals replacement architecture (commit 7ba3a74)
  - [x] 1.4 — Founder mode authorization (commit 782393d) — Gate A confirmed
  - [x] 1.5 — Feature flag infrastructure (commit c7dbc5d) — audit-only
  - [x] 1.6 — Phase 1 completion (commit 2eef153)
- [x] Phase 2 — Tier 0 Shell (structural) — visual revisit happens in Phase 2A
  - [x] 2.1 — Sidebar tour anchors (commit 6d746fe)
  - [x] 2.2 — Visible search trigger + programmatic palette open (commit 5327c5d)
  - [x] 2.3 — Toast host audit + close (commit 70bb6bf)
  - [x] 2.4 — Command palette audit + programmatic open (commit 802f7ca)
  - [x] 2.5 — Keyboard shortcuts audit + close (commit 2ed261a)
  - [x] Retroactive prototype-reference headers (commit 52e3c01)
  - [x] 2.6 — Deploy + Playwright MCP smoke test (commit 62b0633; live at acreos.io)
- [x] **Phase 2A — Visual Revisit + Public Surfaces** (deployed 2026-04-26)
  - [x] 2A.1 — Sidebar visual treatment per prototype (commit 1bca3f3)
  - [x] 2A.2 — Tier 0 visual application: palette + toaster (commits 7309858, 8d6862e); shortcuts modal left as-is
  - [/] 2A.3 — Public landing page (per /acreos-landing/)
    - [x] Hero + Fraunces/Inter foundation (commit fcb1143)
    - [x] HowItWorks (commit 68dcbdd)
    - [x] Agents (commit 4506e79)
    - [x] Day in Life (commit e9dad98)
    - [x] Features (commit 2c1ea95)
    - [x] Quotes (commit a333639)
    - [x] Founder note (commit 9f1b8ab)
    - [x] Pricing + FAQ + Final CTA + Footer + legacy cleanup (commit fa37629)
    - [x] Top nav redesign (commit 8e53c1b)
  - [x] 2A.4 — Public onboarding (per /acreos-onboarding/)
    - [x] CSS scoped port (commit 379e3c2)
    - [x] Wizard outer shell — Dialog → .ob layout (commit 79b2bdd)
    - [x] Per-step visual treatment (commit ebed41a)
  - [x] 2A.5 — Deploy + smoke test (run 24961611010 green; see phase-2a.5-smoke.md)
- [/] Phase 3 — Tier 1 Pipeline Core (first-pass headers shipped)
  - [/] 3.1 — Command Center / Today: header + 5-col metric strip shipped (commits 705023f, ce57920); body sections (AI suggestions, hot deals table, activity feed, agent activity card) still on production styling
  - [/] 3.2 — Pipeline: editorial header shipped (commit ff3bbb1); funnel + velocity pills + tabs body still on production styling
  - [/] 3.3 — Properties (Parcel listing): editorial header shipped (commit 6bafba5); list/map grid body still on production styling
  - [/] 3.4 — Inbox: editorial header shipped (commit 6bafba5); thread list + conversation pane still on production styling
  - [x] 3.5 — Tier 1 deploy + smoke (run 24962048731 green; see phase-3.5-smoke.md — auth-gated bodies require manual operator smoke)
- [/] Phase 4 — Tier 2 Sourcing (first-pass headers shipped; run 24962390532 green)
  - [/] 4.1 — /campaigns (Marketing hub) header (commit 522f2b2); tabs body unchanged
  - [/] 4.2 — /leads (Leads CRM) header (commit 522f2b2); table + filters body unchanged
  - Buy Boxes / Campaign Performance — no standalone production surface; concerns embedded in campaigns/leads/analytics
- [/] Phase 5 — Tier 3 Closing (first-pass headers; run 24962390532 green)
  - [/] 5.1 — /offers (Offer letters) header (commit 3adc075)
  - [/] 5.2 — /deals (Deal Pipeline) header (commit 3adc075)
  - Documents / Seller Finance / Dispositions / Quick Offer modal — deeper passes
- [/] Phase 6 — Tier 4 Ops (first-pass headers; run 24962390532 green)
  - [/] 6.1 — /finance (Sophie ledger surface) header (commit 3adc075)
  - [/] 6.2 — /settings (workspace settings) header (commit 3adc075)
  - Agents / Automations / Audit Log / Team / Billing / Integrations / Contacts / Calendar — deeper passes
- [x] Phase 5 — Tier 3 Closing (first-pass headers + 3 modals shipped)
  - [x] /offers + /deals editorial headers
  - [x] Quick Offer modal + ⌘O shortcut + sidebar trigger (commit 3dd294d)
  - [x] Lost Reason modal + Deal Closed Celebration modal
- [x] Phase 6 — Tier 4 Ops (first-pass + preferences shipped)
  - [x] /finance + /settings editorial headers
  - [x] Settings → Appearance → Preferences card (sound + replay-tour)
- [/] Phase 7 — Tier 5 Founder Mode (chassis built; 2 of 25 founder routes adopted)
  - [x] FounderPageShell chassis (commit 3626221)
  - [x] /founder home — applied
  - [x] /founder/tools — applied (commit df15ff8)
  - [ ] 23 remaining founder routes — incremental adoption per pattern
- [x] Phase 8 — Coverage Pass (commit a5c9dbc)
  - [x] CoveragePage chassis + NotFoundPage / ServerErrorPage / ForbiddenPage / MaintenancePage
  - [x] ErrorBoundary wired to ServerErrorPage
- [x] Phase 9 — Final Coherence Pass (see phase-9-audit.md)
  - [x] 9.1 Visual: Fraunces self-hosted + rendering live; 0 console errors on landing; 320/1440 responsive verified
  - [x] 9.2 Voice: editorial header pattern audited across 21 surfaces, 0 violations
  - [x] 9.3 Interaction: modals, toasts, focus-on-route, error states all consistent
  - [x] 3 live bugs caught in flight + fixed (font self-host, coverage h1 fallback, duplicate title suffix)
- [x] Phase 10 — Handoff Preparation
  - [x] docs/unified-build/COMPLETE.md
  - [x] docs/unified-build/DESIGN-SYSTEM.md
  - [x] docs/unified-build/phase-9-audit.md

## Current State

Phase: All 10 phases substantively shipped. Vertical-expansion handoff is the next handoff per UNIFIED-BUILD-PROMPT.md §510.
**Status: All 10 customer-facing surfaces + Onboarding + Landing + 4 coverage pages + founder home + founder tools carry the homestead editorial identity. 3 deal-flow modals (Quick Offer / Lost Reason / Deal Closed) shipped + ⌘O wired. Settings sound + tour preferences shipped. Fraunces self-hosted and rendering live. Phase 9 audit completed in-flight (3 bugs caught + fixed). COMPLETE.md + DESIGN-SYSTEM.md + phase-9-audit.md docs published.**
**Deferred / incremental:** 23 founder routes can adopt FounderPageShell on demand; deeper-pass body styling on Tier 1-4 surfaces tracked per surface; auth-gated visual smoke requires manual operator pass. None block close-out.
Last commit: see git log
Gate A: ✅ FOUNDER_USER_IDS deployed on Fly (digest 890511d964d7abda)
Run mode: fully autonomous through Phase 10 (operator authorized via 7d4f318)

## v2 → v3 course correction

The v2 prompt produced commits that satisfied structural intent but did not visibly land the prototype's design identity. By the end of Phase 2, production looked essentially the same as before the build started — homestead palette, brand-pip active state, big serif display type all undone.

Root cause: misreading "preserve refinement work" as preserving visual treatments. **v3 corrects this with the Visual Application Mandate:** "preserve refinement" applies to engineering quality (a11y, mobile, perf, code organization), NOT visual treatment. When the prototype's visual treatment conflicts with an existing refined visual treatment, the prototype wins.

Phase 2A is inserted between Phase 2 and Phase 3 to land the visual identity in the most-visible surfaces (sidebar shell + public landing + public onboarding) before continuing into authenticated app surfaces.

## Phase 2 quality bar

- `npm run check` clean (TypeScript)
- `npm run build` succeeds (vite + esbuild server bundle)
- `npm test` — 10 baseline failures (calendar drift + DB-dependent + nested zod + leadScoring import) confirmed unrelated by `pre-unified-build` tag rerun
- Phase 2 introduced ZERO new regressions

## Stash mishap from session 2 (resolved)

During 2.6 baseline verification, an accidentally-popped pre-existing user WIP stash hit conflicts; recovered by `git reset --hard HEAD`. The stash content is preserved as **dangling commit `bd9d6af`** ("WIP on main: 7aa9aee fix: mount health endpoints before WhiteLabel middleware") — recover via `git stash apply bd9d6af` if/when wanted. Two unrelated stashes (`stash@{0}` Clerk redirect, `stash@{1}` health endpoints) remain in `git stash list` untouched.

## What ships so far

**Tokens** — `client/src/index.css` + `tailwind.config.ts`. 41 namespaced `--acr-*` CSS variables (homestead light/dark) plus matching Tailwind utilities. Production HSL system unchanged. **NOTE: tokens are defined but barely applied in components yet — Phase 2A starts the visible application.**

**Globals architecture** — Zustand modal-store, sound hook (off by default), tour-state hook (localStorage placeholder pending server endpoint), toast lib wrapping existing shadcn toast.

**Founder mode** — server-side `isFounderUserId()` + `isFounderIdentity()` honoring email OR `FOUNDER_USER_IDS`; `/api/auth/is-founder` 200/404 endpoint; `useIsFounder()` Tanstack Query wrapper; `requireFounder` and `isFounderAdmin` middleware.

**Tier 0 Shell structural** — 9 desktop + 10 mobile `data-tour-nav` anchors live; visible "Search or jump to…" trigger on 3 surfaces (desktop expanded, desktop collapsed icon, mobile drawer) all 44px tap targets; `acreos:open-command-palette` CustomEvent listener for programmatic palette open; prototype-reference headers on `layout-sidebar.tsx` and `command-palette.tsx`; audit-close docs for 1.5, 2.3, 2.4, 2.5 with fidelity gaps logged for Phase 9 coherence.

## Pinned facts

- Founder Clerk user ID: `user_3CK2u6pGH7EYHgFyMS99fwhLSM7`
- Production URL: https://acreos.io
- Stack: Vite 7.3, React 18.3, TS 6.0.2, Tailwind 3.4.19, Radix (27 pkgs), Tanstack Query 5.95, wouter 3.9, framer-motion 12.38, Zustand 5.0.12
- Rollback tag: `pre-unified-build` at `2b8fe93` (pushed)
- Stash recovery SHA: `bd9d6af`
- 12 of 14 supporting handoff docs absent (only HANDOFF.md, GAPS.md present); reconstruct from HANDOFF.md sections
- Production has 164 routes vs prototype's ~30; prototype is a visual specification, not wholesale replacement
- 394 slices of `[elite-refinement]` work — preserve ENGINEERING quality, override conflicting VISUAL treatments

## Behavioral notes

- `git status` clean before starting work
- Each commit ends with `[unified-build]` + Co-Authored-By trailer
- Don't introduce sonner — production has its own toast
- Don't use the Tweaks panel infrastructure (prototype-only)
- When porting prototype JSX: `var(--brand)` → `var(--acr-brand)`, `var(--surface)` → `var(--acr-surface)`, etc.
- Loop self-pacing: ScheduleWakeup mid-phase, end loop at phase boundaries / gates / pre-deploy / 85% context
- Deploys, force-pushes, destructive git, external service writes — pause for explicit operator approval, do NOT auto-fire from /loop
