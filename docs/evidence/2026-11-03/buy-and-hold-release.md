# Buy-and-hold release — Step 0 verdicts and build gates (2026-11-03)

Package: `claude-package-buy-and-hold-2026-11` (Muse draft, 2026-11-03).
Branch: `claude/buy-and-hold-release`, off main `f7f2e3f3` (#452 merge head — matches the spec's head).
Times are Eastern.

How each verdict was reached is stated: **read** (source / git), **ran** (executed here), or **unverified**.

## Step 0

| § | Check | Verdict | How |
|---|---|---|---|
| 2.1 | Port reconciliation map | **Holds.** `verticalDecision.ts`, `UnderwritingWorkbench.tsx`, `ReviewDateChoice.tsx`, `shared/economics/scenario.ts`, `engineFields.ts`, the rental engine, calculator and field set are **byte-identical** between the held branch head (`b6e3c6ba`) and main. `routes-scenarios.ts` differs only by main's newer `routeParam()` hardening. The route's four imports and the page's eight workbench props match main's signatures exactly; zero drift to resolve. Main is the superset. | read (`git diff b6e3c6ba f7f2e3f3 -- …`) |
| 2.1 | Branch mount diffs | The branch's `layout-sidebar.tsx` and `routeManifest.ts` diffs would have **reverted** three main a11y labels and **dropped** four newer route entries (`routes-note-record/-tape`, `routes-tax-procedures/-watches`). The mounts were hand-applied, one line each. Confirms port-not-merge. | read |
| 2.2 | Head + census | Head `f7f2e3f3`. `scenarios`, `decision_snapshots`, `outcomes` are in the Drizzle schema and build from `migrations/0228/0230/0231/0232`. Newest migration stays **0300**; this branch adds none. | read + ran (local DB built from repo) |
| 2.2 | Stores on staging | **Unverified here** — no staging DB access from this session. Spec/proof record says 0 rows. | — |
| 2.3 | HOLD census | §0's six pins confirmed (the test file + five reachability entries). **Three more references found** that assert or describe the hold: (a) `shared/business-types/publicClaims.ts:80-85` doc comment ("NOT released … held back on claude/buy-and-hold-underwriting") — left untouched, because publicClaims.ts is fenced; (b) `tests/unit/verticalReadiness.test.ts:114` comment on the overclaim baseline — updated with the 12 → 11 drop; (c) `docs/company/roadmap-2026-10.md:259` and `docs/company/next-moves.md:757-761` (historical records — left as history). | read (repo-wide grep) |
| 2.3 | **The contradiction** | See "Stop — the demotion fence cannot hold on main" below. | ran |
| 2.4 | Mount points | `routes.ts` beside `/api/scenarios` (under the orphaned `// Vertical underwriting desks` comment the hold left behind); `App.tsx` beside `/rent-roll`; sidebar under the orphaned "The vertical's decision desk" comment in the Rentals module; `routeManifest.ts` after `routes-scenarios.ts`. | read |
| 2.5 | Activation path | **Source: `/onboarding-v2` is the real, gated path, not a mock.** `OnboardingGate` (App.tsx) redirects any org with `onboardingCompleted !== true` to `/onboarding-v2`; that page calls real endpoints (`PATCH /api/organization`, `POST /api/onboarding/provision`, `PUT /api/me/persona`, `POST /api/onboarding/complete`). Business type is chosen on step 1. Its *optional* step 2 seeds sample data via `POST /api/onboarding/sample-data` — Leg 3 must **skip** it so the proof org holds only real rows. The staging signup walk is **unverified** (no browser on staging from this session). | read |
| 2.6 | Pipeline endpoints | All mounted, org-scoped (`routes-rentals.ts`): `GET/POST /api/rentals/properties/:propertyId/units`, `POST /api/tenants`, `POST /api/leases`, `GET /api/rent-roll/occupancy`; ledger in `routes-rent-ledger.ts` (`POST /api/leases/:id/payments`, `POST /api/rent-charges/generate-scheduled`, `GET /api/leases/:id/ledger`). Units UI is the Units tab of `/leases` (`?tab=units` deep link already existed). Staging row counts **unverified**. | read |
| 2.7 | Outcome loop | **No pack filter.** `decisionsDueForOutcome` filters on org, non-null `review_due_at <= now`, and not-yet-resolved only; `OutcomePrompt` applies no vertical filter. It renders on Today only when `!showEmptyState` — a proof org with one property satisfies `hasAnyData`. Smallest honest review offset in `ReviewDateChoice`: **14 days** ("In 2 weeks"). | read |
| 2.8 | Claim pins | `landingVerticalTiers.test.ts`, `publicMaturityRendered.test.tsx` and the OD-5 block of `verticalReadiness.test.ts`. The first two stay green unmodified. The third is the contradiction. | ran |

### Two §0 statements that did not hold (non-blocking)

- "`UnderwritingWorkbench`'s only page consumer on main is `flip-analyzer.tsx`." **False:** it has **zero** page consumers on main; `flip-analyzer.tsx` hand-rolls its own desk. The rental page is the workbench's first production consumer. Its props match, so the port is unaffected, but the workbench's UI had only ever been exercised by its unit test.
- The proof record `hidden_files/buy-and-hold-e2e-proof-2026-11-03.md` is **not in the repository** (no `hidden_files/` directory). Its contents could not be read; scope was taken from the spec's restatement of it.

## Stop — the demotion fence cannot hold on main

`tests/unit/verticalReadiness.test.ts` measures each vertical's evidence **from source**. Mounting the desk puts a production `recordUnderwrittenDecision(…, strategyPackId: "buy_and_hold")` call in the tree, so buy_and_hold measures **`decided`** the moment Leg 1 lands. Main's tests then **require**, in the same commit:

1. `no demotion is stale` → remove `PUBLIC_CLAIM_DEMOTIONS.buy_and_hold` (publicClaims.ts);
2. `covers exactly the verticals that cannot show decided` → same;
3. `a ladder entry claims the loop exactly when the measurement says decided` → flip `vertical.buy_and_hold` to "decided" in `evidenceLadder.ts`.

The spec forbids all three in this package (§6.2, §6.3, §8.3-12, §9.1). Both cannot be true on main. This is the same tension the 2026-10-21 COO hold resolved by keeping the route **off** main. So the build is complete and every other gate is green, but these **three assertions stay red** and the PR is a **draft**. I did not modify the gate or touch publicClaims/the ladder: both are decisions above this build.

Options (a decision for Muse / Tom):

- **A. Lift with the mount** (one line in publicClaims + the ladder entry). This is what main's OD-5 rule already says. But it inverts the spec's order (claim before journey proof).
- **B. Add an explicit, dated "held pending journey proof" exemption to the two OD-5 assertions and the ladder assertion**, single entry, expiring when the Atlas row lands. Keeps the spec's order, but amends a governance gate.
- **C. Re-hold:** don't merge; keep the port on this branch until Leg 3 can run some other way (staging deploys from main, so this needs a branch deploy).

Recommendation: **B.** The source-measured `decided` is a fact about code; the public claim is meant to wait on journey evidence. An exemption makes that difference explicit instead of hiding it, and it removes itself in the one-line lift.

## Resolution — Option B applied (2026-11-05)

Founder decision relayed by Muse, recorded in `docs/company/founder-decisions-2026-11-05-buy-and-hold.md`.

- **What changed.** `verticalReadiness.test.ts` gains `HELD_PENDING_JOURNEY_PROOF`, with exactly one entry: `buy_and_hold`, held since 2026-11-05, review by 2026-12-31. The three OD-5 / ladder assertions treat a held vertical as still-demoted.
- **New guards.** A new block holds the entry to its own rules:
  - it must measure `decided`;
  - its demotion must stay `beta`;
  - its ladder must not claim the loop;
  - it must cite the decision file and be unexpired;
  - the register is pinned to `["buy_and_hold"]`.
- **Untouched.** `publicClaims.ts` and `evidenceLadder.ts`.
- **Verified by running it.** The file is green (50 tests), and the claim pins are green.
- **Mutation check.** 6 mutants, all caught:
  - lift the demotion without removing the hold;
  - flip the ladder;
  - unmount the route (the hold goes stale);
  - widen the register;
  - expire `reviewBy`;
  - point at a missing decision file.
- **Gates.** `check:tests` 151 = baseline, `lint:ratchets` and `lint:no-fabrication` pass.

## Build gates (run here, 2026-11-03 ~23:00 ET; verdicts read from files, never through a pipe)

| Gate | Result |
|---|---|
| `check:app` (tsc) | exit 0 |
| `check:tests` | PASS — 151 = baseline 151 (it was 152 mid-build, from a new test; fixed, not baselined) |
| Remaining 33 `npm run check` lints, run one by one | all exit 0 (incl. `lint:reachability`: all 11 counts at baseline after the 5 HOLD entries were removed) |
| `npm run lint` (eslint, 0 warnings) | exit 0 |
| Full vitest with a real DB built from the repo | 19,781 tests: **8 failed**, 19,772 passed, 1 skipped |
| …of the 8 | **3 are the contradiction above** (`verticalReadiness.test.ts`). **5 fail identically on main `f7f2e3f3`** in this environment (re-run on a main worktree): `forecastIsContractNotAssumption`, `noteRecordPanels`, two `serverStampsConsentAndOfferTimes.realdb`, `serverOwnedTimestampsStayServerOwned.realdb` — date/environment dependent, not this change |
| `npm run build` | exit 0 |
| `check-bundle-size.js` | PASS — **9,814 KB** total JS (ceiling 9,823 KB; 9 KB headroom). `underwrite-rental` chunk 15 KB. Main's figure was not re-measured here |
| Claim pins | `landingVerticalTiers`, `publicMaturityRendered` green **unmodified**. `moneyCustodyHardStop`, `customerMoneyRouting` green **unmodified** |
| Local bundle strings | `api/buy-and-hold` client 1 / server 1; `buy_and_hold_underwrite` server 1; `rentals/underwrite` client 3. Staging bundles are Leg 3 |

The local real database lacks pgvector, so `db:build-from-repo` reported its one known table (`solene_embedded_records`) missing. No test here touches it.

### Mutation checks (each mutant applied, its tests run, reverted)

| Mutant | Result |
|---|---|
| route records under `fix_and_flip` instead of the `buy_and_hold` literal | caught (10 red) |
| route skips the org-scoped property lookup | caught (realdb cross-tenant + SQL-shape) |
| next step offered for every kind, not only `acquire` | caught |
| next-step link carries the wrong property id | caught |
| `/leases` drops the deep-linked id | caught |
| `UnitsPanel` ignores `initialPropertyId` | caught |
| desk ignores `?propertyId=` | caught |
| parcel-page entry ungated | caught |
| sidebar child ungated | caught |
| the acquire link performs a POST when followed | survived the first version of the test; test fixed to actually follow the link and watch raw `fetch`; now caught |

### Independent audit (fresh agent, read-only)

- It confirmed the blocker above. It found no unwired residue, no prefilled field, no copied figure and no tenant leak. Copy is clean (D17).
- Fixed from its findings:
  - the citation assertion was a substring match; it now reads `decision_snapshots.scenarios`;
  - the follow-the-link check was vacuous;
  - the `/leases` id handoff was untested.
- Stated, not changed:
  1. A real other-org id given to `?propertyId=` shows as "Property #N (not found)" in the picker rather than nothing. No address leaks, and recording 404s with nothing written. The spec's "preselects nothing" would need a workbench change.
  2. `POST /api/buy-and-hold/underwrite` is org-scoped but not business-type gated, as §8.10 allows. A land org could record a buy_and_hold decision on its own property by calling the API directly.
  3. "real expenses" in the page intro (ported verbatim) refers to numbers the operator types.

### One change outside the four mounts, flagged

`UnderwritingWorkbench` gains one OPTIONAL prop, `recordedNextStep`, the only way the recorded state can offer the acquire handoff. Without the prop the render is unchanged (its existing test is untouched and green). `verticalDecision.ts` (the kit) is untouched.

## Leg 3 — not run (post-merge by design)

Leg 3 runs on staging after merge → deploy → reconcile, which this PR must not do. Script notes from Step 0:

- skip onboarding's sample-data step;
- pick "In 2 weeks" (the smallest review offset), so the outcome leg completes ≥14 days after the decision is recorded and stands as a dated open leg until then;
- Today's outcome prompt needs `hasAnyData` (one property suffices).

## Atlas row (draft — becomes evidence only when Leg 3 passes)

> **buy_and_hold** — decision desk mounted (`/rentals/underwrite`, `POST /api/buy-and-hold/underwrite`) on the shared kit; engine `rental_acquisition` declares the vertical; omitted inputs are declared assumptions (origin + basis), never $0; property → desk and acquire → units are links only. Journey on staging: _pending Leg 3_ (activation via `/onboarding-v2`, intake, underwrite, decision persisted citing the scenario, pipeline exercised with data, outcome appended). Public claim: **beta** (unchanged; lifting is Tom's call on this row).
