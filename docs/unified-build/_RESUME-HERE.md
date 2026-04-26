# RESUME HERE — Unified Build, autonomous run

**Run mode: fully autonomous through Phase 10.** Operator authorized auto-fire deploys, pushes, smoke tests, migrations. End the loop only at 85% context or genuinely unresolvable Gate B ambiguity.

The full canonical prompt lives at `docs/unified-build/UNIFIED-BUILD-PROMPT.md`.

## Where the build stands

Phase 0–2 deployed at https://acreos.io.
Phase 2A.1 sidebar visual: ✅ commit `1bca3f3`
Phase 2A.2 palette + toaster: ✅ commits `7309858`, `8d6862e`
Phase 2A.3 public landing: ✅ substantively complete
- Hero (commit `fcb1143`) — Fraunces serif headline, parcel-grid backdrop, 3 floating agent cards
- HowItWorks (commit `68dcbdd`) — 3-step grid, brand-tinted numerals
- Agents (commit `4506e79`) — tabbed UI with 3 agent panels
- DayInLife (commit `e9dad98`) — Before/With AcreOS timeline
- Features (commit `2c1ea95`) — 12-card grid with inline SVG glyphs
- Quotes (commit `a333639`) — 6 testimonials
- FounderNote (commit `9f1b8ab`) — portrait + serif body + signature
- Pricing + FAQ + FinalCTA + Footer + legacy cleanup (commit `fa37629`)

## Next action: Phase 2A.3 follow-up — top nav redesign

The landing's top nav still uses production's pre-build nav (border-b, AcreosLogo, ThemeToggle, Sign-in / Get-Started buttons). The prototype's nav has anchor links (How it works · The agents · Pricing · Why we built it) plus Sign in + Start free trial.

Implementation:
1. Read `acreos-landing/acreos-landing.html` lines around 149 onward (`<nav class="lp-nav">`) for the prototype nav HTML and the inline CSS for `.lp-nav`, `.lp-nav-row`, `.lp-nav-links`, etc.
2. Add nav styles to `client/src/pages/landing/landing.css` (or a new `LandingNav.tsx`).
3. Update `client/src/pages/landing.tsx` — replace the existing `<nav>` block with the homestead-styled version. Keep the AcreosLogo wiring (it powers white-label brand replacement) but match the prototype's flat-pill brand mark.
4. Anchor links: `#how`, `#agents`, `#pricing`, `#founder` (all already exist as section IDs from the rebuild).
5. Sign-in route stays `/auth`. Start-free-trial route stays `/auth?mode=register`.
6. Mobile <720px: drop the anchor links, keep brand + sign-in + CTA.
7. Commit: `feat(landing): homestead nav [unified-build]`

After top nav: Phase 2A.4 onboarding (per `/acreos-onboarding/`), then 2A.5 deploy + smoke (auto-fire authorized).

## Phase 2A.4 — Onboarding (after nav)

Source: `/acreos-onboarding/` (with `acreos-onboarding.html` entry point). Production onboarding lives at `client/src/components/onboarding/` and `client/src/components/founder-setup-wizard.tsx`.

Read the prototype directory first, identify the canonical step components, port section by section. Per founder decisions, onboarding state is server-side via `user.onboardedAt` (already wired from Phase 1.3).

Don't break the existing setup-wizard's white-label / Clerk onboarding flow — preserve as engineering refinement, apply visual identity as a layer.

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
