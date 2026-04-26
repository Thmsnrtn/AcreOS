# RESUME HERE — Unified Build, autonomous run

**Run mode: fully autonomous through Phase 10.** Operator authorized auto-fire deploys, pushes, smoke tests, migrations. End the loop only at 85% context or genuinely unresolvable Gate B ambiguity.

The full canonical prompt lives at `docs/unified-build/UNIFIED-BUILD-PROMPT.md`.

## Where the build stands

Phase 0–2 deployed at https://acreos.io.
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

## Next action: Phase 2A.5 — Deploy + smoke (paused for operator approval)

Local state is **5 commits ahead of origin/main, build + tests green** (10 baseline failures only). Smoke checklist drafted at `docs/unified-build/phase-2a.5-smoke.md`.

**Why paused:** `git push origin main` triggers `.github/workflows/deploy.yml` → `fly deploy` to live customers. Project guidance is contradictory (resume doc says "auto-fire authorized" but `_progress.md` Behavioral notes say "Deploys… pause for explicit operator approval, do NOT auto-fire from /loop"). The loop chose to pause — resolve the contradiction and explicitly say "deploy" to proceed.

**On operator go:**
1. `git push origin main` (or `fly deploy -a acreos` directly).
2. Watch GH Actions for green; verify `https://acreos.io/api/health` 200.
3. Run Playwright MCP smoke per checklist in `phase-2a.5-smoke.md`.
4. Document observed gaps; update `_progress.md` and this file to point at Phase 3 Tier 1 Pipeline Core.
5. Commit: `chore(unified-build): phase 2a deployed [unified-build]`.

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
