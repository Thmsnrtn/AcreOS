# RESUME HERE — Unified Build, autonomous run

**Run mode: fully autonomous through Phase 10.** Operator authorized auto-fire deploys, pushes, smoke tests, migrations. End the loop only at 85% context or genuinely unresolvable Gate B ambiguity.

The full canonical prompt lives at `docs/unified-build/UNIFIED-BUILD-PROMPT.md`.

## Where the build stands

Phase 0–2A deployed at https://acreos.io (latest deploy: GH Actions run 24961611010, commit 3de9356).
Phase 2A.1 sidebar visual: ✅ commit `1bca3f3`
Phase 2A.2 palette + toaster: ✅ commits `7309858`, `8d6862e`
Phase 2A.3 public landing: ✅ complete
- Hero (commit `fcb1143`) — Fraunces serif headline, parcel-grid backdrop, 3 floating agent cards
- HowItWorks (commit `68dcbdd`) — 3-step grid, brand-tinted numerals
- Agents (commit `4506e79`) — tabbed UI with 3 agent panels
- DayInLife (commit `e9dad98`) — Before/With AcreOS timeline
- Features (commit `2c1ea95`) — 12-card grid with inline SVG glyphs
- Quotes (commit `a333639`) — 6 testimonials
- FounderNote (commit `9f1b8ab`) — portrait + serif body + signature
- Pricing + FAQ + FinalCTA + Footer + legacy cleanup (commit `fa37629`)
- Homestead top nav (commit `8e53c1b`) — pill brand mark, 4 anchor links, Sign in + Start free trial

Phase 2A.4 onboarding port: ✅ substantively complete
- CSS scoped port (commit `379e3c2`) — homestead `.ob-*` styles in `client/src/components/onboarding/onboarding.css`
- Wizard outer shell refactor (commit `79b2bdd`) — Dialog → full-viewport `.ob` layout, segmented `.ob-progress`, `.ob-btn` footer
- Per-step visual treatment (commit `ebed41a`) — italic Fraunces welcome + reveal, eyebrow/title pattern for steps 1–3, `.ob-cards` action grids

Phase 2A.5 deploy + smoke: ✅ deployed and live (operator gave explicit "push and deploy" approval 2026-04-26). Smoke results: all 11 landing sections render, mobile nav collapses correctly, two non-blocking warnings logged (Fraunces font ERR_FAILED in Playwright env — verify in real browser; pre-existing `/api/white-label/config` 401). See `phase-2a.5-smoke.md`.

## Next action: Phase 3 — Tier 1 Pipeline Core

Per UNIFIED-BUILD-PROMPT.md §385. Four canonical surfaces, port one at a time, commit per surface, deploy + smoke at end of phase.

| Sub-phase | Prototype source | Production target | LOC |
|-----------|------------------|-------------------|-----|
| 3.1 Command Center | `acreos/command-center.jsx` (366 LOC) + inline CSS at end | `client/src/pages/today.tsx` (1360 LOC) | large |
| 3.2 Pipeline | `acreos/pages-tier1.jsx` (Pipeline component) | `client/src/pages/pipeline.tsx` (310 LOC + tabs to leads/properties/deals/outreach) | medium |
| 3.3 Parcel Detail | `acreos/tier-b.jsx` (`ParcelDetailB`, 309–998) | `client/src/pages/properties.tsx` | TBD |
| 3.4 Inbox | unclear — likely `acreos/tier-c.jsx` (174 LOC) + supporting | `client/src/pages/inbox.tsx` (1107 LOC) | large |
| 3.5 Deploy + smoke | — | — | — |

**Per-surface workflow (per build prompt §397):**
1. Implement with TS, shadcn primitives, homestead Tailwind tokens
2. Replace data literals from `data.jsx` with Tanstack Query against real APIs (production already does this; preserve)
3. All states: loading skeleton (matching final layout, not spinner), empty-zero (first-run with CTA), empty-filtered, error
4. Build shared `<EmptyState>` and `<ErrorState>` design-system components on first need; reuse thereafter
5. Mobile responsive 320/375/414/768/1024/1440
6. Tour anchors per HANDOFF.md §7
7. AI output quality (Atlas/Pax) — apply prototype voice; preserve production business logic

**Visual port pattern (proven on landing + onboarding):** read prototype → port scoped CSS to colocated `.css` file with `--brand` → `--acr-brand` translation → refactor JSX in incremental commits → type-check → commit.

**Start with 3.1 Command Center:** read prototype `acreos/command-center.jsx` start-to-finish (incl. inline CSS at bottom), inventory production today.tsx (1360 LOC — heavy business logic, preserve refinement), then layer homestead identity over the existing data-bindings.

## Phase 2A.4 — Onboarding (after nav)

Source: `/acreos-onboarding/` (with `acreos-onboarding.html` entry point — 9 prototype screens: welcome → markets → buybox → goals → autonomy → connections → phone → billing → reveal).

**Canonical production surface (port target):** `client/src/components/onboarding/OnboardingWizard.tsx` (823 LOC), mounted by `client/src/pages/dashboard.tsx:655`. 5 production steps (welcome / import_leads / connect_email / create_campaign / done), supports 14 business types.

**Onboarding state lives at ORG level**, not user — `organizations.onboardingCompleted/Step/Data` (jsonb). There is no `user.onboardedAt` field; earlier resume notes had this wrong. Endpoints: `GET /api/onboarding/status`, `POST /api/onboarding/complete-step`, `POST /api/onboarding/provision`, `POST /api/onboarding/sample-data`, `POST /api/onboarding/complete`.

**Other onboarding surfaces — leave alone:**
- `components/onboarding-wizard.tsx` (Surface #1) — vestigial session-nudge banner; don't apply visuals
- `pages/onboarding-wizard.tsx` (Surface #3) — likely obsolete standalone page
- `components/founder-setup-wizard.tsx` (Surface #4) — founder credential setup, NOT customer onboarding

**Port strategy:** preserve production's 5-step structure + 14-business-type intelligence (engineering refinement). Apply prototype's visual treatment as a layer — homestead palette, serif headings, `.ob-*` shell (header/progress dots/footer with arrow buttons), per-step layouts inspired by prototype `screens-1.jsx` through `screens-4.jsx`. Skip the prototype's Tweaks panel entirely.

Don't break the existing wizard's Clerk + provision-templates flow — preserve as engineering refinement.

## Phase 2A.5 — Deploy + smoke

Auto-fire authorized:
1. `npm run check` — must pass
2. `npm run build` — must pass
3. `npm test` — confirm only the 10 baseline failures
4. `fly deploy -a acreos`
5. Playwright MCP smoke test against acreos.io:
   - Landing page renders with serif "I built this..." headline
   - All 11 sections present
   - Mobile (375px) renders correctly
   - Sidebar (signed-in shell) shows Phase 2A.1 active-state treatment
   - Console error scan
6. Document in `docs/unified-build/phase-2a.5-smoke.md`
7. Update `_progress.md` and `_RESUME-HERE.md` to point at Phase 3 Tier 1 Pipeline Core
8. Commit: `chore(unified-build): phase 2a deployed [unified-build]`

## Loop guidance

After each commit:
- ScheduleWakeup 270s if continuing in-cache
- ScheduleWakeup 1200s if waiting for deploy/external state
- End loop ONLY at 85% context or unresolvable Gate B

## Hard reminders

- `[unified-build]` tag + Co-Authored-By trailer on every commit
- Visual Application Mandate: prototype wins on visual conflicts
- Per-Surface Fidelity Principle: read prototype before each surface
- Pre-existing 10 test failures are baseline — don't block, don't add new
- Autonomous run: don't ask for operator confirmation on visual judgment, deploys, smoke, push
- Stash recovery SHA: `bd9d6af` (only if operator asks)
