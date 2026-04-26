# Phase 2A.5 — Deploy + Smoke Test

## Pre-deploy state (2026-04-26, end of /loop session)

**Local commits queued for production (5 since `64312e2`):**
- `8e53c1b` feat(landing): homestead nav
- `7bfe711` chore(unified-build): nav landed
- `379e3c2` chore(onboarding): port homestead CSS shell + resume doc fix
- `79b2bdd` feat(onboarding): homestead shell — Dialog → .ob layout
- `ebed41a` feat(onboarding): per-step homestead treatment

**Quality gates passed locally:**
- ✅ `npm run check` — TypeScript clean
- ✅ `npm run build` — vite + esbuild server bundle clean (warnings unchanged from baseline: chunk size, duplicate `target` in tsconfig)
- ✅ `npm test` — **10 failed | 4469 passed | 1 todo | 1 skipped** — matches the documented baseline (calendar drift in tax-deadline tests, DB-dependent tests, nested zod, leadScoring import). No new regressions from Phase 2A.3/2A.4 work.

## Deploy gate — paused for operator approval

`git push origin main` triggers `.github/workflows/deploy.yml` which runs `fly deploy -a acreos`. This is a production-customer-visible action.

**Conflict in project guidance:**
- `_RESUME-HERE.md` and `_progress.md` "Run mode" line both say *"Operator authorized auto-fire deploys, pushes, smoke tests, migrations"* (per commit `7d4f318`).
- `_progress.md` "Behavioral notes" final bullet says *"Deploys, force-pushes, destructive git, external service writes — pause for explicit operator approval, do NOT auto-fire from /loop"*.

**Loop chose to pause** because the contradiction is direct, the cost asymmetry favors caution, and the operator is in-session. Resolve the contradiction in the docs after this push (delete or qualify the conflicting line).

## On deploy approval — execute in order

1. `git push origin main` — triggers `fly deploy` via GH Actions.
2. Watch action: `gh run watch` or visit https://github.com/Thmsnrtn/AcreOS/actions
3. Verify `acreos.io` health: `curl -sSf https://acreos.io/api/health` returns 200.
4. Run Playwright MCP smoke (browse acreos.io):
   - Landing page — confirm:
     - [ ] Homestead nav: pill brand mark, anchor links visible (How it works · The agents · Pricing · Why we built it), "Sign in" + "Start free trial" buttons
     - [ ] Hero serif headline ("I built this…") in Fraunces
     - [ ] All 11 sections present (Hero / How / Agents / DayInLife / Features / Quotes / FounderNote / Pricing / FAQ / FinalCTA / Footer)
     - [ ] Mobile (375px viewport): nav anchor row hidden, brand + sign-in + CTA visible
   - Authenticated shell — sign in as founder:
     - [ ] Sidebar Phase 2A.1 active-state treatment intact
     - [ ] Onboarding wizard (if not completed): full-viewport `.ob` shell, italic Fraunces "Glad you're here. Let's get you set up.", paper-grain texture, segmented progress strip, dark footer button
     - [ ] Wizard navigates step 0 → 1 → 2 → 3 → 4 without console errors
     - [ ] "Complete Later" + "X" close behavior works
   - Console error scan — no new errors from this build.

## On smoke pass — close-out

5. Update this doc with screenshots + observed gaps (Phase 9 backlog).
6. Update `_progress.md` Phase 2A status to ✅, Phase 3 Tier 1 Pipeline Core → next.
7. Update `_RESUME-HERE.md` to point at Phase 3.
8. Commit: `chore(unified-build): phase 2a deployed [unified-build]`

## On smoke fail

If a regression appears, document the diff (which prototype intent vs. live state), open a follow-up commit on `main`, redeploy. Do NOT roll back to `pre-unified-build` unless onboarding/landing is broken for real users.
