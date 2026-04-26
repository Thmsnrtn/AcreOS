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

Phase 3 first-pass: ✅ shipped to acreos.io (run 24962048731).
- 3.1 Today: CSS scaffold + hero + 5-col metric strip (commits 705023f, ce57920)
- 3.2 Pipeline: editorial header (commit ff3bbb1)
- 3.3 Properties: editorial header (commit 6bafba5)
- 3.4 Inbox: editorial header (commit 6bafba5)
- 3.5 Deploy + smoke: green; auth-gated bodies need manual operator smoke (see phase-3.5-smoke.md)

**Phase 3 deeper-pass follow-ups (deferred):** Within each Tier 1 surface, the body sections still use the existing production styling. These can be iterated incrementally without phase blocking — pull from this list when ready:
- /today: AI suggestions cards → `.acr-sugg`; hot deals table → `.acr-deal-row`; activity feed → `.acr-activity-list`; agent activity card refresh
- /pipeline: funnel card + velocity pills → homestead palette; tab triggers → `.acr-cc-metrics` style chips
- /properties: list rows → homestead row pattern; map/list toggle → `.acr-pills`
- /inbox: thread list → `.acr-deal-row` adaptation; conversation pane → reading-room treatment

## Next action: Phase 4 — Tier 2 Sourcing

Per UNIFIED-BUILD-PROMPT.md §410. Same workflow as Phase 3.

Surfaces: Buy Boxes (`BuyBoxes`), Lists, Campaigns, Campaign Performance (`CampaignPerf`).

Likely production targets:
- `client/src/pages/buy-boxes.tsx` (or similar)
- Lists — possibly part of `client/src/pages/leads.tsx` or campaigns subroute
- `client/src/pages/campaigns.tsx`
- `client/src/pages/campaign-performance.tsx` (or aggregated within campaigns)

Start with route inventory (`grep -rn "Route.*path.*buy-box\|Route.*path.*campaign" client/src/App.tsx`) to confirm production targets, then read corresponding prototype sources in `acreos/` (likely scattered across `tier-a.jsx`, `tier-b.jsx`, `pages-tier2345.jsx`).

**Same first-pass strategy:** apply the homestead editorial header pattern to each surface for immediate visual coherence with Tier 1, then layer body-level treatment in subsequent passes.

## Phase 5+ outline

- Phase 5 — Tier 3 Closing (Offers, Documents, Seller Finance, Dispositions; modals incl. Quick Offer ⌘N)
- Phase 6 — Tier 4 Ops (Agents, Automations, Audit Log, Settings, Team, Billing, Integrations, Contacts, Calendar)
- Phase 7 — Tier 5 Founder Mode (`FounderHomeC`, `AtlasRunC`, `FounderTenants`, etc.)
- Phase 8 — Coverage Pass (uncovered routes: legal, 404/500, niche states)
- Phase 9 — Final Coherence (visual + voice + interaction audits; reconcile gaps including Fraunces font load + /api/white-label/config 401)
- Phase 10 — Handoff (`docs/unified-build/COMPLETE.md`, design system docs)

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
