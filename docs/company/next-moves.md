# Next moves

The running hand-off between sessions. Update it at the end of every session:
what shipped, what it measured, and the top next moves. Newest first.

## 2026-11-05 — CJ harness: answer the "How Pax works" dialog before composer assertions — on `claude/cj1-dismiss-ai-disclosure` (off main `c8fa715`, PR open, unmerged)

- **Scope.** Harness only. The CJ audit was red three runs running. Decomposing run 42104190391 found 7 composer-topmost failures, the largest single cause. Each had `inViewport: true`. The first-visit AI-disclosure dialog (`AiDisclosureGate`, app shell) sat over /ai, so `elementFromPoint` hit the dialog.
- **Change.** CJ1 step 6 now clicks "Got it" when the dialog shows, the way a first-time customer would. It waits for the dialog to unmount and the Radix modal layer to release, then runs the topmost check unchanged. If the dialog is absent, the step does nothing. No product code changed and no assertion was loosened.
- **Out of scope, observed.** Load-timing flakes under the 18-way parallel walk, and the onboarding-bounce defect (its own package).
- **Proof.**
  - The workflow dispatch was REFUSED for the session token (HTTP 403, "Resource not accessible by integration"), so no CJ audit run exists on the branch yet. The founder dispatches: `gh workflow run customer-journey-audit.yml --ref claude/cj1-dismiss-ai-disclosure`.
  - Local probe instead: production build, local PG, `E2E_TEST_AUTH=1`, Chromium, iPhone 12 dark plus desktop 1440 light. It ran step 6's logic on /ai with the seeded customer's consent cleared.
  - Without dismissal, the composer measured `inViewport: true, topmost: false` (the defect, reproduced). With the step, `topmost: true`, still on /ai. With consent already recorded, the dialog was absent, nothing happened, and the check passed. 6/6.
  - Not a CJ1 run: the config documents why a local CJ1 cannot pass (no signed-out landing). WebKit was not probed.
- **Branch proof run 42137097255** (founder-dispatched on `eddc6e2`): CJ1 green on all 12 Chromium projects; red on the 6 WebKit iPhone projects.
  - No failure snapshot showed the disclosure dialog: the disclosure fix held.
  - 12 of 18 failed attempts were still composer-topmost. Every one had the iOS "Install AcreOS" sheet (`pwa-install-prompt.tsx`) over the composer. The sheet opens 4s after load, on iOS Safari only.
  - 5 attempts were navigation-interrupted (onboarding bounce, out of scope). 1 was the "no first-value CTA" timing class (out of scope).
- **Follow-up commit.** The same step now taps the sheet's X when it is open. The wait is bounded by the sheet's own 4s timer from the /ai load. Local WebKit probe: iPhone 12 and SE reproduce `topmost: false` with the sheet as the hit, and pass with the step. Pixel 5 and desktop Chromium never show the sheet.
- **Second follow-up (founder-scoped into this PR).** Navigation settle-tolerance.
  - Steps 3–7 use `gotoSettled()`. On a THROWN interruption only, it waits for the interrupting navigation to land, then re-issues the goto, at most 2 times. The interruption is WebKit "interrupted by another navigation" / "Frame load interrupted", or Chromium `net::ERR_ABORTED`.
  - A goto that completes is never repeated.
  - New landed-route assertions after the URL settles: step 4 must land on /onboarding-v2 or /today; steps 5 and 7 on /today, with step 7 also checked after the CTA poll; step 6 on /ai.
  - So the onboarding bounce now fails by name at step 5 with the URL it reached, instead of surfacing later as a CTA miss.
  - Local probe, iPhone 12, iPhone SE (WebKit) and Pixel 5 (Chromium), ×4 each: a stray navigation from the previous page kills a raw goto; `gotoSettled` lands /ai; an app bounce after a clean goto is not retried and lands /onboarding-v2. 36/36.
  - The probe also caught a single re-issue being interrupted again on SE, which is why the helper waits for the interrupting target.
- **Proof run 42143893610** on `a8da042`: the 12 Chromium projects and iPhone 14 Pro Max dark passed. 5 iPhone projects were red, 18 failed attempts in all.
  - 0 composer-topmost failures and 0 goto-interruption deaths. 9 interruptions were annotated and recovered from.
  - 12 attempts timed out at step 4: the install sheet opened over the wizard's "Go to Today" button, and the click waited behind it until the 240s test timeout.
  - 6 attempts completed every step, then failed the final `pageErrors == []` contract. The errors were WebKit's "<url> due to access control checks" for the app's boot fetches, cancelled by the walk's own full-document `page.goto`. One of the 6 had no re-issued navigation.
- **Third follow-up.** `page.addLocatorHandler` answers the install sheet whenever it blocks an action anywhere in the walk. The step-6 explicit dismissal stays, because the topmost check reads `elementFromPoint`, which never triggers a locator handler. Local WebKit probe: a click under the sheet hangs without the handler and succeeds with it on iPhone 12 and SE. Chromium never shows the sheet. 12/12.
- **Proof run 42151652145** on `348b6d3`: every bucket except one was zero, and step 4 was clear. All 13 failed attempts failed only on the page-errors contract: 271 entries, all access-control shaped.
  - The founder's decomposition of the traces settled it as a harness artefact. All /api/* requests returned 200 on the wire, the rejected instances never appear in the network log, and Chromium had 0 occurrences.
  - The mechanism is context.route + route.continue({headers}) token injection racing WebKit's access-control check.
- **Fourth follow-up (founder-directed): a network-corroborated page-error gate.** `tests/e2e-customer-journey/page-error-gate.ts`:
  - It dismisses an access-control page error ONLY when it is on the walk's own origin AND the same host+path completed 2xx in the same attempt. The gate runs after every step has passed.
  - Everything else still fails, including cross-origin errors, 4xx/5xx, no response, and unparseable messages.
  - Dismissed entries become a `page-errors-corroborated` annotation carrying raw strings and statuses. `run-customer-journey-audit.mjs` always prints that section in the run markdown and JSON, even at zero. The timing attachment keeps the raw `pageErrors`.
- **Proofs.**
  - `tests/unit/cjPageErrorGate.test.ts`, 10 tests using the raw strings from the run. Three mutants are all caught: bare signature exclusion, dropping the same-origin check, and accepting any status of 200 or more.
  - Live WebKit control (iPhone 12 and SE) produced REAL WebKit access-control errors through the spec's own listeners. A same-path 2xx was dismissed. Forced 500, revoked-token 401, no response and a genuine cross-origin CORS block all failed the gate.
  - Chromium never raises the class.
  - The `blob:` entry (`767f47f1-…`) has no network entry, so it still fails if it recurs.
- **Unchanged.** Route checks, so the onboarding bounce stays visible.
- **Next.** Founder dispatches proof run 4. The honesty proof needs a GREEN run whose report shows the class FIRED and was dismissed.

## 2026-11-05 — Fix-and-Flip V1: Leg 1 (#465), PATCH-defaults fix (#466), Leg 2 (stacked on #466) — all unmerged; Legs 3–4 held for Tom

- **Step 0** (`docs/evidence/2026-11-05/fix-and-flip-step0.md`, branch `claude/fix-flip-step0`) stopped the package before build. Muse ruled on 2026-11-05:
  - evidence rides as scenario assumptions (option a);
  - a NEW kit desk, with the draft offer untouched;
  - Leg 2 starts in parallel;
  - Legs 3–4 and change orders wait on Tom's §9.3 bundle.
  - Two ruling premises were wrong and are stated in the PRs: there is no `POST /api/flip-decisions` (the live recorder is `POST /api/flip-analyzer/offer`), and accepting a bid wrote nothing to the lines.
- **#465 Leg 1.**
  - What it adds: `POST /api/fix-and-flip/decide` through `recordUnderwrittenDecision` (`flip_mao` / `fix_and_flip`). Every input is server-resolved. The evidence (ARV row id + low/mid/high + count, the scope source, each rule's provenance, the hold comparison seen) is frozen as assumptions.
  - UI: the analyzer's MAO card says "Screen — nothing recorded", and a decision panel sits beside the draft offer.
  - Proof: 22 mutants caught; full vitest 19,805 passed (the 5 local-only env failures also fail on main); bundle 9,807 KB.
- **#466 Fix (live data loss).** Zod 4 `.partial()` keeps defaults, so:
  - saving a rehab line's "spent" zeroed its budget and committed amounts;
  - a rehab PATCH reset status to planning;
  - a draw PATCH reset status to planned.

  `patchSchemaOf` fixes the three FF routes. A population gate lists **8 other routes with the same shape** (rentals ×3, move-inspections, double-close, ccr-templates, tax-researcher, api-v1 leads). They are reported for their lanes and held down-only.
- **Leg 2 (stacked on #466).**
  - Three-way variance (not-committed ≠ $0).
  - Explicit apply-accepted-bid-to-lines act.
  - Estimate lock after planning, including no return to planning and no category moves.
  - Fact flags with no threshold; arithmetic bid deltas.
  - No migration. 21 mutants caught.
- **Next.**
  1. Muse audits #466, then Leg 2, then #465.
  2. Tom's answer on the §9.3 bundle (transition log, baseline, change orders, realized columns) unblocks Legs 3–4.
  3. Leg 5's staging proof waits on 1–4.
  4. Product calls reported, not made:
     - the rehab header budget vs the line estimates (two "budgets");
     - closing the lock's check-then-write race;
     - the 1099-NEC generator has no qualified-output gate (tax lane).

## 2026-11-03 — Buy-and-hold release: desk ported + mounted, wiring as links — on `claude/buy-and-hold-release` (off main `f7f2e3f`, PR #458, unmerged; blocker resolved 2026-11-05 by Option B)

- **What shipped on the branch.**
  - Ported (not merged — the held branch is 73 behind) the route, the page and the route test; the kit is byte-identical on both.
  - The four mounts were applied by hand.
  - Wiring is links only: the parcel page offers "Underwrite as a rental" (buy_and_hold orgs); after an `acquire`, the desk links to `/leases?tab=units&propertyId=…`. Nothing is created or copied.
  - HOLD pins removed together. `MATURITY_OVERCLAIM_BASELINE` 12 → 11.
  - `publicClaims.ts` and the evidence ladder are untouched.
- **Blocker (the reason it is a draft).**
  - `verticalReadiness.test.ts` measures evidence from source, so the mounted desk makes buy_and_hold `decided`.
  - Three main assertions then REQUIRE lifting the beta demotion and flipping the ladder in the same commit. The package forbids both until the staging journey.
  - Options A (lift now) / B (dated exemption until the Atlas row; recommended) / C (re-hold) are in `docs/evidence/2026-11-03/buy-and-hold-release.md`.
  - **Resolved 2026-11-05: Option B** (`founder-decisions-2026-11-05-buy-and-hold.md`). The register `HELD_PENDING_JOURNEY_PROOF` holds buy_and_hold at `beta` until 2026-12-31 at the latest; 6 mutants caught.
- **Proved.** The evidence file has the full Step 0 table, gates, mutants and audit:
  - real-DB route test (one scenario + one decision citing it, preview ≡ record, ownership guard writes nothing, cross-tenant 404 writes nothing, three declared assumptions, freeze integrity);
  - wiring test;
  - 10 mutants caught;
  - check/lint/build/bundle green: 9,814 KB of 9,823;
  - full vitest: 3 red = the blocker, plus 5 that fail identically on main here.
- **Next.**
  1. ~~Decide A/B/C~~ — B applied. The lift commit removes the demotion, flips the ladder and deletes the register entry together.
  2. Muse audits; merge deploys staging only.
  3. Leg 3 on staging: skip sample data; review "In 2 weeks", so the outcome leg completes ≥ 14 days later as a dated open leg.
  4. The ladder flips only on the completed journey.
  5. Founder: delete `claude/buy-and-hold-underwriting` after the staging proof.

## 2026-11-03 — G8 containment fixes — on `claude/g8-containment-fixes` (off main `f7f2e3f`, PR open, unmerged)

- **Scope.** Two items from the G8 containment verification. Both reproduced on `f7f2e3f`.
- **(1) `/investor-network` render layer.** `App.tsx` rendered `InvestorDirectoryPage` through a bare `ProtectedRoute`, so the frozen route's entry in `FROZEN_ROUTES` was never consulted. A signed-in user with the direct URL got the directory UI; the APIs already 404'd. It now renders through `FlaggedRoute`, the same wrapper as `/marketplace` and `/capital-markets`. The existing test was green over the defect because it asserted list membership, not the wrapper.
- **(2) Win-back touch-2 copy.** `server/jobs/growthAutomation.ts` advertised Marketplace (FREEZE), Satellite imagery (Vision AI, KILL 2026-08-01) and Voice AI (KILL 2026-08-01). The three lines are removed. One replacement was added: Offline field maps, which the Map door renders today (`maps.tsx` → `OfflineAreasPanel`). Schedule, recipients and sending logic are unchanged.
- **Proved.** `investorNetworkIsAMarketplace.test.ts` now asserts that every frozen route App.tsx registers parses as `flagged`. The new `winBackCopyIsHonest.test.ts` parses every string and template literal in the job and forbids frozen/killed surface names. Both go red with the fixes reverted.
- **Next.**
  1. Out of scope, flagged for later: touch 2 still says "Acquisition Radar". `/radar` is a redirect to `/deals/discover` (`AcquisitionRadarPage` archived 2026-06-01), so whether that claim holds needs a check.

## 2026-11-03 — G12 public-copy truth fixes (list-pull, stale Pro price) — on `claude/public-copy-truth-fixes` (off main `f7f2e3f`, PR open, unmerged)

- **Scope.** Public marketing/comparison copy only. No server code, in-app surfaces, legal docs or pricing changes.
- **List-pull (5 live strings removed).** Both /compare matrix notes, the shared /compare intro ("pull county data, mail the right owners"), every /learn/county page, and the /tools/calculator CTA.
  - Evidence that nothing pulls a list: no list-builder route; `countyAssessorIngestJob` has no caller; `fetchTaxDelinquentList` is a stub.
  - Replacement copy says only what code proves: the capped free tier (`TIER_LIMITS.free`) and CSV import (`POST /api/leads/import`).
- **The "$41 Pro" price.** No rendered public surface showed it; all three render from `TIER_PRICES_CENTS`.
  - The stale price lived in the CI claim record (`audit-public-claims.ts`), whose hand-written source agreed with it. The record now reads $99/$990, and the source is derived from the registry.
  - `$41` still renders correctly as **Starter** annual (round($490/12)).
- **Sept-2025 withdrawn claim: not found.** No claim record is dated 2025-09. The records hold 2026-09-01 and 2026-09-29 withdrawals; none of their phrases is on a public surface, and 2026-09-29 is the list-pull withdrawal fixed above.
- **Gates.**
  - `landingClaimsNoListPulling` now reads compare, learn, tools, pricing, the routed public pages and llms.txt. It also learned the "pull county data" shape.
  - New `publicPricingMatchesCanonical.test.tsx` renders landing Pricing and /pricing (both cadences), the JSON-LD and the Save-% badges against the decided tiers.
  - 14 mutants caught.
- **Not fixed (out of scope; for the founder).**
  - `docs/marketing/*` drafts (blog, outreach emails, LinkedIn page copy) still say "Pro $41/mo billed annually". They are not served, but the LinkedIn text may be live on LinkedIn.
  - `acreos-landing/` (a localhost-only prototype) still says "first list pulls overnight" and "90 seconds".
  - Stale price comments: `tier-pricing.ts` header ($20/$49/$79), `landing/Pricing.tsx:10`, and `pricing.tsx:159`.
  - Rounding: /pricing shows Pro annual as $83/mo against a $990 bill ($82.50).
- **Next.** Independent audit of the PR, then the founder merges. Decide whether to correct the docs/marketing drafts and the LinkedIn page.

## 2026-11-03 — First-party parcel ingest (the Regrid exit ramp), Wave A pilot WI — on `claude/first-party-ingest-wave-a` (off main `f7f2e3f`, PR open, unmerged)

- **Scope as dispatched.** Wave A only, WI first. AR excluded. The #452 gate is untouched: WI stays `gated`, `CLEARED_FOR_LOOKUP` stays `[]`, and `parcel.ts` is unchanged.
- **Step 0.** Verdicts are in `docs/evidence/2026-11-03/first-party-ingest-step0-and-wi-pilot.md`.
  - D1/D2 machinery has largely landed: the ETL template, releases, APID/lineage, the purpose ledger, the poller code and the honesty contract.
  - Confidence is high/medium/low, not 0–1, and has no serving floor.
  - Parcel lookup is not a ledgered surface.
  - No staging access this session: no Fly token, and Actions paths are refused. The bucket and staging tables are **unverified**, so the build is **dry-run only**.
  - The design-authority docs and dossier packs are not in the repo.
- **Contradictions (legs stopped).**
  - CT: the same item now serves the 2026 collection (1,320,686 vs the pack's 1,282,833 for 2025).
  - MA: the pack's service URL is dead (MassGIS moved it 2026-04-02), and no publisher statewide total exists.
  - Serving hookup: no store exists for a cleared statewide leg to answer from. Statewide builds write only bucket artifacts, the owned store is served ungated, and a new table needs a founder `table-count` bump. **Founder decision needed.**
  - DE matches its pack and is next.
- **Built.**
  - Pre-fetch ingest admission (`ingestAdmission` / `statewideIngestAdmission` → `IngestRefusedError` in `buildCounty`).
  - The re-verification radar (`reverifyBy`, `effectiveDossier`, applied on every registry read).
  - `can_mail` decoupled from internal use.
  - The WI dossier, from the V12 schema documentation re-read live.
  - WI `NOT AVAILABLE` stored as published, with a `suppressedUpstream` flag.
  - `reconcileCountyBuild`.
  - `scripts/land-data/statewide-dry-run.ts`.
- **Proved (live WI layer, dry run).**
  - Pepin: 9,693 counted, 9,693 stored, reconciled.
  - Kenosha: 68,499 counted, 68,499 stored, reconciled, with 64,144 "NOT AVAILABLE" stored and flagged. That equals the independent live count.
  - Kenosha peak RSS was **442 MB, over the 400 MB ceiling** (measured under tsx). Measure the large counties on the worker before scheduling.
  - 34 new tests; 8 mutants, all red. An independent audit's should-fixes are applied: one instant per run, a re-verify date is required, the job-level refusal is tested, and the population pins are in place.
  - **Radar is tighten-on-date only.** `reverifyTriggers` (the V13 release, a terms change) is recorded but not yet wired to the poller.
  - WI artifacts carry real owner names (internal use). Serving them waits on the §5 ledger; a parquet-reader pin holds that.
- **Next.**
  1. Muse audits; the founder merges (staging only).
  2. Founder: the bucket probe (staging access, or run it), and the serving-store decision (a new table vs. gating the owned-store readers).
  3. The post-merge §9 staging proof legs that do not need the bucket: live refusal (FL), gate-unchanged at a WI point.
  4. The DE adapter (geometry-only).
  5. Update the CT and MA packs, then build them.
  6. A WI golden county (§3.8) before any WI promotion.

## 2026-11-03 — P0 front-door fixes (D11) — on `claude/p0-front-door-fixes` (off main `f7f2e3f`, PR open, unmerged)

- **Step 0** ran on a staging-shaped local build (no staging token in-session) with fresh tenants walked through onboarding (no data). Record: `docs/evidence/2026-11-03/p0-front-door/README.md`.
- **Fix 1 (built).** The Pax composer was below the fold on 12/12 runs (top at 1,758 / 1,622 / 1,316px on phone / tablet / desktop) while `isVisible()` passed. It now portals into a sticky dock and sits on the first screen at 16/16 viewport × theme combinations, iPhone SE through QHD. PageShell gained an opt-in `stickyToViewport`; only Pax uses it. Placeholder pinned.
- **Fix 2 (partial).** "Import your first tape" is built for a fresh note investor and opens the note-tape import. A `/notes?action=new` bug was found and fixed: the import opened closed on phones after any in-app link, because the page mounts twice across the transition layers. **"Add your first watch" is stopped**: the "watch" referent is unpinned (flagged market watchlist with email alerts vs. import-only tax county watches). Land investors get no pinned CTA from this package.
- **Fix 3 (re-proof only).** 0 "Transition was skipped" page errors in 12 runs; reduced motion is respected.
- **Finding (not fixed, stop condition).** The final onboarding step's "Go to Today instead" bounces a fresh user back to wizard step 1. The cause is a non-awaited `needs-onboarding` invalidation before `navigate` plus a stale `OnboardingGate` cache. This is also the live double navigation beneath the silenced transition skip. It is a one-line fix and the strongest next package.
- **Next.**
  1. Muse audits the PR; the founder merges, which deploys staging only.
  2. Staging proof per the package's §1–5, plus the CJ run id + image for the Atlas row.
  3. Package the onboarding bounce fix.
  4. Decide what "watch" means for the second pinned CTA, and which personas get each form.

## 2026-11-03 — Legal-run build findings, unblocked legs — on `claude/legal-run-build-findings-2026-11` (off main `f7f2e3f`, one PR, unmerged)

- **Shipped (per-leg commits).**
  - **Leg 1:** the FCRA register citation spans (a)(2)/(a)(3)(A)/(a)(3)(F), and the umbrella comments are aligned. This is hygiene, not a mis-cite fix.
  - **Leg 4:** the benchmarks endpoint enforces its stated 10-transaction minimum.
  - **Leg 6:** legal holds now stop org erasure and the nightly purge (fail closed). `api_telemetry_samples` has a single retention owner: the rollup, whose hourly-vs-5-minute schedule bug is fixed and which now lives in its own file. Org erasure deletes the S3 bytes under `org/<id>/`.
  - **Leg 7:** the vendor inventory is retired as evidence (every DPA is UNKNOWN), and the four contradicted retention-policy claims are corrected.
  - **Leg 5:** disposition only; 0 of the 42 Tier A surfaces are wired, because every one needs a proposed taxonomy code.
  - **Leg 2:** only the read-only export-completeness inventory.
- **Stopped.**
  - **Leg 3:** four contradictions at step 0, listed in the PR.
    - dossiers are code, not database rows;
    - no destination is specified for the radar's tasks;
    - none of the four serve points carries statewide data today;
    - the 3.4 internal-doc rejection necessarily un-seeds NY, which is a founder call.
  - **Leg 8:** not touched (blocker-only by design).
- **New findings for Tom.** Two deletion paths ignore legal holds and are now named in the policy's §6 table: `POST /api/clear-demo-data` → `clearOrganizationRecords()`, and `server/jobs/archival.ts` (off by default). Neither was in the package.
- **Proved.**
  - The real-Postgres test `retentionRespectsLegalHolds.realdb.test.ts` fails on the old tree.
  - Unit mutants for every new gate are red.
  - Full vitest: 4 failures. 3 are date/timezone and fail identically on main; the 4th (the reachability gate) is fixed in this branch.
  - Gates run alone: `check:app`, the 33 lints and `build` are all exit 0. `check:tests` could not run in this 8 GB container (tsc was killed, exit 137), so CI is the verdict.
- **Not proved.** The staging proofs for Legs 4 and 6 (no staging access), the per-leg auditor verdicts and CI.
- **Next.**
  1. Muse audits; the founder merges.
  2. Run the staging proofs for Legs 4 and 6.
  3. Decide NY's seed (Leg 3.4) and state where the radar's tasks go (3.3).
  4. Wire hold checks into clear-demo-data and archival.

## 2026-11-03 — Statewide point lookup gated behind the license dossiers — on `claude/statewide-lookup-clearance-gate` (off main `519b62c`, PR open, unmerged)

- **Founder decision (2026-11-03).** A seeded statewide source may serve point-lookup results ONLY when its register state is cleared for lookup. It is recorded in `founder-decisions-2026-11-03-lookup-gate.md`. It closes the LQ-13/LQ-14 finding: nine statewide rows answered live lookups, owner names included, ahead of Regrid, with no gate.
- **Step 0 (verified against the tree).** The finding reproduced. On the platform key the order is cache → county_gis → Regrid. The function returned `outFields:*` (owner names in 7 of 9 states), and its only check was `blockedOutboundSource`. Two additions to the finding:
  - a second caller, `county-gis-provider.ts`;
  - an APN-path edge: a `county="*"` row matches when the county arg is `"*"`.
- **Change.**
  - `LOOKUP_CLEARANCE` was added to the EXISTING `statewideSourceRegistry.ts`; no parallel registry. It holds one explicit entry per seeded state and mirrors §8.4. All nine are gated.
  - `isClearedForLookup()` is true only for `cleared` with every evidence field filled.
  - `parcel.ts` `statewideRowMayServe()` gates the point path and the APN path. Both callers go through the point function.
  - A row with no entry is gated (fail-closed).
  - No migration. Bulk ingest, the dossiers and lookup persistence are untouched.
- **Proved.** `tests/unit/statewideLookupClearance.test.ts`:
  - (a) gated, per state: no request to the service, and fall-through to Regrid or to the next source;
  - (b) a cleared override restores results, per state;
  - (c) the ratchet: seeds ↔ entries both ways, the cleared set pinned (empty), and a reviewed list of every server reader of the statewide rows.
  - Mutants caught: point gate removed, APN gate removed, predicate always true, entry deleted, gate inverted.
- **Customer effect.** In FL, MT, NC, WA, NJ, AR, NY, WI and MD, coordinate lookups on the platform path now answer from Regrid, or return not-found when no Regrid key is configured.
  - That is a paid call where the free row used to answer. Today there are no customers.
- **Next.**
  1. Independent audit of the PR; the founder merges.
  2. Clear states one at a time as Option B lookup determinations land (the PR body lists the exact code change).
  3. Still open from register §8.5: C-3 (whether callers persist lookup results downstream) and C-4 (whether deployed `county_gis_endpoints` rows match the seed file). The gate keys on the row's `state` and `county="*"`, so extra DB rows are gated too.

## 2026-11-03 — Fix B: server auth reads @clerk/express 2.x's callable `req.auth` — on `claude/fix-b-clerk-auth-v2` (off main `29a1755`, PR open, unmerged)

- **Change.** `getClerkAuth(req)` invokes the callable `req.auth` and normalizes `userId` / `sessionId` / `factorVerificationAge`. All reads go through it: the 6 direct reads, the MFA cast, the 21 existing call sites (unchanged), and **2 cast-form reads the census missed** (`requirePaxDisclosure`, `routes-pax-disclosure`). The E2E bypass installs the callable. The JWT fallback block is untouched.
- **Production effects once deployed** (prod still runs on the fallback until the founder dispatches):
  - Pax chat stops 401ing (`requirePaxDisclosure` saw no userId on every request).
  - Per-user rate limits key by user, not IP.
  - MFA gets the real FVA claim, so 2FA users who verified pass `/api/founder` and `/api/admin`.
  - "Revoke other sessions" spares the current session.
  - The login-anomaly memo runs per session.
- **Proved.** Evidence: `docs/evidence/2026-11-03/fix-b-clerk-auth-v2-gates.md`.
  - The new tests fail on main (the middleware path with no `CLERK_JWT_KEY` returns 401). The fallback-preservation tests pass on both main and the branch.
  - 8 of 8 mutants caught.
  - Gates: check exit 0; check:tests 151 = baseline; client bundle delta 0 KB; full vitest 2 failures, the same 2 date-dependent ones as on main.
  - An independent audit found the change mergeable; its sweep findings are fixed.
- **Follow-ups (not this package).**
  1. Fallback-authenticated sessions (all of staging) carry no `sid` or `fva`, so on staging MFA still fails closed and "revoke others" still revokes the current session. Fixing that touches the frozen fallback block and needs its own package.
  2. `server/websocket.ts:78` checks only the bare `__session` cookie name.
  3. `toAuth()` runs on every helper call; it could be memoized per request.
- **Next.**
  1. Muse audits; the founder merges, which deploys staging only.
  2. Staging proof per Rollout §3: Google sign-in → `/today` stays after a hard reload; `/api/auth/user` returns 200; sign out and back in; two helper-consuming surfaces return 200. Record it in `docs/evidence/`.
  3. The prod deploy is a separate founder dispatch.
## 2026-11-03 — Acquired-note deletion guard (soft-delete package, reduced) — on `claude/acquired-notes-delete-guard` (unmerged)

- **Decisions.** Tom chose soft-delete for acquired notes. The delete-path sweep then found no product path that deletes one, so per the working-session answer this ships only a guard: no migration (the census stays unchanged), no service, no route. Both decisions are in `founder-decisions-2026-11-03-notes.md`.
- **Sweep.**
  - Only org erasure (`deleteOrganization`) reaches the `acquired_notes` → ledger CASCADE. It is unchanged.
  - `DELETE /api/notes/:id` is the legacy `notes` table.
  - Settings "Clear data" never selects `acquired_notes`, because its property and lead FKs are SET NULL. This was proven by running it on a built DB.
  - Two dev scripts tear down synthetic orgs (the test-borrower fixture and `sim-*`). They were reported and left unchanged.
  - The full table is in `docs/evidence/2026-11-03/acquired-notes-delete-guard.md`.
- **Guard.**
  - `acquiredNotesDeletedOnlyByErasure.test.ts` scans the source population: direct SQL and Drizzle deletes, and registers for org-row deleters, `TRUNCATE … CASCADE` and computed-table deleters, with vacuity floors and canaries.
  - `.realdb.test.ts` checks the live CASCADE parents and runs "Clear data", then erasure, on a note that has rows in both ledgers.
  - 11 mutants, all red.
- **Next.** Muse audits. When an acquired-note delete UI or route is wanted, build it as the soft delete Tom chose: `deleted_at` (migration 0301), read exclusion at the org-scoping layer, and restore. The guard fails any hard version first. Open question for Tom: should "acquired notes are soft-deleted" join the CLAUDE.md DO-NOT-DO list and `constitution.ts` as a standing rule?

## 2026-11-03 — Per-channel consent grant rows — on `claude/consent-per-channel-grants` (off main `29a1755`, unmerged)

- **Decision implemented.** Founder decision 2026-10-29 (G8 §B1), now recorded in `founder-decisions-2026-10-29-consent.md`. Consent grants are written as one `lead_consent_events` row per granted channel. The decision changes how grants are recorded, not who may be contacted.
- **Writer sweep.** Before this change there were three bundled grant writers, all writing one row claiming sms + email + phone + direct_mail:
  - `POST /api/leads`;
  - `PATCH /api/leads/:id/consent` (`routes-import-export.ts`);
  - the SMS opt-in keyword (`tcpaCompliance.ts`).

  No direct inserts exist outside `consentEvents.ts`. Revocations (STOP, both paths) also write bundled rows; they are out of scope and untouched.
- **Change.** `recordConsentGranted` now always writes one row per channel, in one INSERT. A bundled grant can no longer be written through it.
  - All three writers pass `TCPA_CONSENT_CHANNELS` = sms + phone. This set is pinned equal to `requiresTcpaConsent`.
  - Their only evidence is the `tcpaConsent` boolean, which covers texts and calls (2026-10-20 #2). This is an implementation reading, flagged in the decision file. Switching to four rows is one line.
- **Send gates.** None changed. The only reader of channels is the AI-voice call gate, which keys on the newest phone row, and that row's content is unchanged; `consentGrantRowsPerChannel.test.ts` pins the verdict equivalence. `invariantWatch` reads only revocations.
- **Gates.**
  - New tests: unit 15 + real-DB 6.
  - Six mutants, all caught (`docs/evidence/2026-11-03/consent-per-channel-gates.md`).
  - Full results are in the PR body.
- **Held, needs a decision (not changed — it would move the AI-voice gate).** The consent PATCH writes a fresh grant row on every call, including a re-assertion on an already-consented lead, using its own source mapping rather than the lead row's. Dedupe or source read-back would let an older written AI-voice grant become "newest" again and flip that gate.
- **Next.** Muse audits. Then decide the PATCH re-assertion question above, and whether STOP should keep revoking every channel (open since 2026-10-20).

## 2026-11-02 — G5 upgrade-path proof workflow — on `claude/serene-cori-0u9h8n` (PR #438, unmerged)

- **Built.** `.github/workflows/g5-proof.yml`: `workflow_dispatch` only, input `base_ref`. It builds `base_ref` with that ref's own `db:build-from-repo`, then upgrades it with the current `migrate.mjs`. It runs `--ddl-only` (the staging entry) and then the release_command, then `--dry-run`. It fresh-builds the current ref into a second database, diffs upgraded against fresh (census read plus normalized `pg_dump --schema-only`), and runs the real-DB suites on the upgraded database. No change to migrate.mjs, the schema or app code.
- **Proved.** Run 41401168690, base `58d1a9b7` → current `833f88f2` (main `b539f15` plus the workflow). Base, upgraded and fresh each have 752 tables. Both upgraded-vs-fresh diffs are EMPTY. 7 `tests/db` scripts and 199/199 real-DB vitest tests (41 files) passed on the upgraded database. Evidence: `docs/evidence/2026-11-02/g5-upgrade-path-proof.md`.
- **Caveat.** A dispatch is impossible until the file is on main: GitHub needs the workflow on the default branch, and the session token lacks Actions write. The proof ran through a temporary push trigger, which has since been reverted and is recorded in the evidence.
- **Next.** Muse wires the G5 gate text. After merge, re-dispatch once from main as a true `workflow_dispatch` confirmation. Consider dispatching per migration-bearing merge against the last release SHA.

## 2026-11-02 — Clerk FAPI origin default corrected — on `claude/clerk-fapi-origin` (off main `b539f15`)

- **Change.** `server/middleware/clerkProxy.ts` default upstream origin `https://possible-emu-83.clerk.accounts.dev` -> `https://clerk.acreos.io`. `CLERK_FAPI_ORIGIN` still overrides it exactly as before (trimmed, trailing slashes dropped, empty = default).
- **Why (founder-supplied evidence, not re-measured from this sandbox).** The emu host is a leftover in a different Clerk instance context: proxy-protocol calls there get 401 `proxy_request_invalid_secret_key` (different `auth_config` id). `clerk.acreos.io` is the app's real Frontend API host and answers the same calls 200 given the registered `Clerk-Proxy-Url` and the instance secret key. The Clerk domain `acreos.io` has `proxy_url` `https://acreos.io/__clerk`. The old "Cloudflare Error 1000" note was a DNS defect (the CNAME pointed at a Cloudflare-owned address); it now targets `frontend-api.clerk.services` and Error 1000 does not reproduce from a Fly machine.
- **Gate.** `tests/unit/clerkProxyFapiOrigin.test.ts` asserts the URL actually fetched under each env. Mutants: emu default restored -> 4 failed; env override ignored -> 1 failed.
- **No staging verification record** for this change exists in `docs/evidence/` (the 2026-10-30 `clerk-proxy-gates.log` is the x-forwarded-host fix). No Clerk or Fly config was changed.
- **Next.** Merge, then deploy; prod presents the registered proxy URL, so `https://acreos.io/__clerk/v1/environment` should answer 200. The ops-watch `sign_in` probe will show it.
## 2026-11-02 — V-Tax-1 T4b audit fixes (#425, audited NOT YET MERGEABLE at `8d71515`) — rebased onto main `6defa32a`

- **B3, rebase after T4a.** Done. T4b's two commits now sit on main `6defa32a`, with the same 29 files as before. The route-file conflicts were all #432's `routeParam` lines next to T4b's gate, and both are kept. The founder-decisions conflict was two "§3"s: main's T3a decision stays §3, and T4b's becomes §4, with its references updated.
- **B1, the T2b PATCH-status bypass.** Closed by the rebase. The refusal at `routes-tax-certificates.ts` (a PATCH to `deed_obtained`/`expired_to_deed` while redeemable returns 422) comes from main's T2b squash `a5ba7a1` (#421). `taxClock.realdb` passes 10/10, and with the refusal removed its PATCH case goes red.
- **B2, updates were ungated.**
  - `PATCH /api/rehabs/:id`, `/api/rehab-line-items/:id`, `/api/ad-postings/:id` and `/api/dd-assignments/:id` wrote their spend tables with no gate. All four were ungated, and all four now call `refuseRedeemableDeedSpend`.
  - The ad posting and DD assignment routes also check a parcel the body re-points them to.
  - The ratchet's markers now match updates as well as creates. The four routes are also pinned by name, with the gate required BEFORE the write.
  - `redeemableDeedGateUpdates.realdb` drives each route: refused on a held parcel with the row untouched, and allowed on a free one.
  - Mutants: all four gates removed (HTTP 4/4 red, and the ratchet names all four routes); a gate moved after the write (the ordering pin goes red).
- **Next.** Muse audits the new head; the founder merges.

## 2026-10-29 — V-Tax-1 T4b — the tax → Land exit, and the redeemable-deed gate on spend and marketing — on `claude/tax-v1-t4b-land-exit` (rebased onto main `6defa32a`). V-Tax-1 is code-complete.

- **Founder decisions (2026-10-29, recorded in `founder-decisions-2026-10-28-tax.md` §4).** The exit is an operator action, never automatic. The gate covers both spend AND marketing.
- **The exit** (`POST /api/tax-certificates/:id/move-to-land`, `server/services/tax/landExit.ts`).
  - It is available only at the clock's `deed_held` phase; still redeemable, or expired without a deed, is refused with why.
  - It links the org's property for the same parcel, using lead conversion's `findParcelProperties`, now exported: one matcher. A property still in the acquisition pipeline becomes `owned`.
  - Otherwise it creates one as `owned` with the price paid. The acreage comes from the lot's list, or the operator states it with its source; it is never invented (a missing acreage is a 422 `needsAcreage`).
  - The move is recorded on the property's `activity_events` in the same transaction. A second move is a no-op.
  - UI: `MoveToLandControl` under the clock.
- **The gate** (`refuseRedeemableDeedSpend` / `taxHoldRefusal` / `heldPropertyIds`).
  - "Held" is the clock's own answer, from the extracted `clockForCertificate`, which the clock route and the gate both use: not marketable (still redeemable, expired without a deed, or deed held without a quiet-title petition or attorney exception). Redeemed and cancelled positions hold nothing.
  - **Spend gated:** subdivision plan create/update, permit checklist create, permit-step update, lot split, rehab create, rehab line items, rehab seed template, DD assignment, DD dossier request (both routers — the ratchet found the second) and dossier run.
  - **Marketing gated:** listing create and publish, syndication, sync-all, buyer blasts, buyer matching (single and bulk), ad postings, and the marketplace listing. The marketplace had no offerability check at all; that is pre-existing and not fixed beyond the tax hold.
  - **Not gated, by design:** the free public-data DD lookups (flood, wetlands, soil, environmental), which are reads, not spend.
- **The ratchet** (`redeemableDeedGate.test.ts`) reads the population, not a list.
  - Every route unit in `server/routes*.ts` that writes a spend table or service must call the gate or be EXEMPT with a reason.
  - Every `offerabilityRefusal(` site must also check the tax hold.
  - It has vacuity floors on files, units and call sites.
- **The tax history on the property** (`GET /api/properties/:id/tax-history`, `PropertyTaxHistoryPanel` on the property detail):
  - each position's clock, calendar and bids;
  - the taught lock while held;
  - what the position cost so far (purchase + subsequent taxes, with its basis), shown as an input to the next offer.
- **Not done, stated plainly.**
  - No offer calculator reads the tax cost yet. It is shown on the property, not wired into `calculateBlindOffer` or `POST /api/offers`.
  - There is no single document store: the canon marks documents "conflated". Tax certificates have no document upload; quiet-title steps hold one S3 key.
  - `properties` has no APID column. The exit matches by parcel ref, as lead conversion does.
- **V-Tax-1 PR stack, all open.** #418 → #419 → #420 → #421 → #422 → #423 → #424 → T4b. Each retargets to main as the one before merges.
- **Escalations still open.**
  1. `preForeclosureNoticeMonths: 1` is a national default, used for 45 states. It needs the founder's call.
  2. TX flat-first-period stacking (25% plus 50%) is a legal reading.
  3. Security Scanning is red on main. It needs code-scanning access, or approval of the "make Trivy print" patch.

## 2026-10-30 — G10 spend-guard fix — on `claude/g10-spend-guard-fix` (based on main `58d1a9b`)

- **Ceiling gate fails open/closed by design.** The overrides lookup in `getEffectiveCeilings` is guarded: unreadable falls back to tier defaults with a warn naming the table. A customer call with a dead DB now returns allow from the gate itself; background (`failClosed`) is unchanged and still throws at the 70% bucket.
- **Quota gate.** `checkQuota` under a metering outage throws a designed `AIQuotaUnavailable` (503, `AI_QUOTA_UNAVAILABLE`), no SQL in the message. 503 vs 429 is a call the founder may overrule.
- **Concurrency bound.** Per-org cap of 5 AI tasks in flight (`server/services/aiConcurrency.ts`), one counter shared by `routeAITask` and the `aiSpendGuard` metered paths, released on every exit. The 6th gets 429 `AI_CONCURRENCY_EXCEEDED` with `Retry-After`. The value 5 is COO-proposed; the founder may overturn it.
- **Known limits.** The counter is per instance, so the real bound is 5 × machines until a Redis-backed version exists. It applies to every org-attributed call, background and BYOK included. `getOrgQuotaCap` error → `cap = 0` (unlimited) is a known sharp edge, left alone per the package.
- **Small addition outside the four named files:** `terminalErrorHandler` now sets `Retry-After` from `retryAfterSeconds` and keeps a named `AI_*` code on a 503.
- **Not done:** the staging demonstration and the k6 burst re-run of the four limiters (no staging access or `k6` here). Gates log: `docs/evidence/2026-10-30/g10-spend-guard-fix-gates.md`.
- **Next:** Muse audit; staging demonstration and burst re-run once the branch is on staging; Redis-backed cross-instance bound.

## 2026-10-29 — V-Tax-1 T4a audit fix (#424, audited NOT YET MERGEABLE at `6fcbbe21`)

- **Fix:** `buildLotRecord` read no county watch, so it always reported the redemption period "not stated on this county's watch". That was a false negative on the lot record, contradicting the watch panel beside it.
  - It now reads the org's own watch for the lot's state and county, matched case-insensitively. It uses the same `terms.redemptionPeriodMonths` read as `buildWatchTriage`, and passes `{ months, source }` to `triageLot`.
- **Trivial note from the audit, folded in:** the warehouse observations are now merged oldest first, which the field-record rule states.
- **Evidence:** `docs/evidence/2026-10-29/t4a-fix-mutations.log` (3 mutants, all caught) and `t4a-fix-gates.log`.
- **Next:**
  - #424 still sits on T3b → T3a → T2b. T2b (#421) is in re-audit after its fix batch.
  - The T2b bundle trim (≥5 KB) comes next.
  - Each stacked branch gets main merged in as the PR below it lands.

## 2026-10-29 — V-Tax-1 T4a — disagreement capture and negative knowledge on the lot's tax record — on `claude/tax-v1-t4a-disagreement` (rebased onto main `a0dcbef8`)

- **One rule, two verticals (addendum §2: reuse the Notes pattern).** N4's disagreement and negative-knowledge rule moved out of `buildNoteRecord` into `shared/provenance/fieldRecord.ts` (`recordedField`), unchanged.
  - The note record and the new tax lot record both call it. A test pins that both do, and that neither keeps a grouping of its own.
  - The Notes provenance chip and disagreement panel moved to `client/src/components/provenance/FieldRecord.tsx`, with Notes' test ids kept. The N4 real-DB suites pass unchanged, and a mutation in the shared rule turns `noteDisagreement.realdb` red.
- **The lot's tax record** (`GET /api/tax-researcher/listings/:id/record`, `server/services/tax/lotRecord.ts`). Its sources are:
  - the lot's own list observations;
  - other sales' lists of the SAME parcel (same state, county and APN, this org only);
  - values the operator read from the county;
  - the matched public-record parcel's market and assessed value (the warehouse).

  Every value is kept with its provenance. Where they differ, all are shown, the book value is named, and nothing is overwritten. Blank on the list reads differently from never stated.
- **County values.** `POST …/listings/:id/county-values` appends an `operator_correction` observation (`statedBy: county_record`, with its reference).
  - It is typed like the list's value. A wrong type, a value attached to an absence, or a future as-of is refused.
  - The book row and the list's value are untouched.
- **Negative knowledge.**
  - The record carries the triage facts: known, searched-none or never-searched. A lien search never run is "unknown", never clean.
  - The rights stack refuses to derive from it; the real-DB test drives both together.
- **UI** (`LotRecordPanel`): in the expanded lot on the worksheet, disagreements come first, then each fact with its provenance chip, then searched / not searched, then the county-value form.
- **Next.** T4b, the cross-vertical exit. The read-only map (2026-10-29) found:
  - no tax position ever creates or links a `properties` row (`tax_certificates.property_id` is always null in practice; `tax_sale_listings.property_id` has no writer);
  - the redemption lock and quiet-title gate are display-only;
  - about ten feasibility/plat/DD/rehab/expense spend routes with no common chokepoint;
  - no APID on `properties`.

## 2026-10-29 — V-Tax-1 T3b — the sale calendar in the county's time zone, registration as a stage gate, the position record — on `claude/tax-v1-t3b-calendar-ledger` (rebased onto main `b539f15d`)

- **Rebase.** On main `b539f15d`. T3b's own route-param reads go through `routeParam()` (#432), and the 0298 block in `scripts/migrate.mjs` sits before main's 0300 block.
- **Storage.** Migration 0298 adds columns and a widened CHECK; the table count is unchanged.
  - `tax_sale_auctions.calendar` and `registration` (jsonb).
  - The `tax_events.event_type` CHECK is replaced in one statement to add `subsequent_tax_paid`, `redemption_notice_recorded` and `foreclosure_filing_deadline`.
- **Calendar** (`shared/tax/auctionCalendar.ts`). AcreOS holds no county→zone map, and none was built.
  - The county's IANA time zone is STATED by the operator with its source and as-of date.
  - A time of day without a zone is refused (422). With no zone, no time is shown and no countdown is computed; the date shows alone, with why.
  - Instants are computed from the county's wall-clock time in its zone, so a Phoenix 10:00 sale is 17:00Z. Tested across zones and a DST change, and with the process time zone set to Asia/Tokyo.
  - A date-only registration deadline is called closed only once that date has ended everywhere.
  - `GET` / `PUT /api/tax-researcher/auctions/:id/calendar`; the panel sits under the selected sale on the worksheet.
- **Registration gate.** The checklist covers deposit, funds, entity documents, W-9 and registered as a bidder.
  - Each item's requirement is stated per county, with its source. An unstated item is open, never assumed not required.
  - "Registered as a bidder" can only be done, never waived.
  - A bid or win on a lot in the sale is refused (422, open items named) until every item is done or stated not required. A lot outside any sale is not gated.
  - **Every existing sale now starts gated**, the same posture as the T2a county lock. `PUT /api/tax-researcher/auctions/:id/registration/:item`.
- **Position record** (`shared/tax/ledger.ts`, `GET`/`POST /api/tax-certificates/:id/ledger`, under the redemption clock). It shows:
  - the lien amount, the rate, and the deadline with what it rests on;
  - the subsequent taxes paid, with their receipts and total. Reimbursement is the county procedure's own `subsequentTaxRules` with its source, or "not stated"; AcreOS never adds the taxes in.
  - interest, only where a rule is encoded, covering the certificate amount only;
  - the notices the operator recorded (a record of what they sent outside AcreOS; nothing is sent);
  - the foreclosure-filing deadline with its source (latest wins). There is no default, so `preForeclosureNoticeMonths` is not used.
  - A future payment or notice date is refused.
  - The UI says "Position record": "Ledger" is a founder codename (`no-founder-codenames-in-customer-jsx`).
- **Escalation still open.** The `preForeclosureNoticeMonths: 1` national default (see T3a below).
- **Next.** T4: disagreement capture, negative knowledge, and the cross-vertical exit to Land/Hold with full history.

## 2026-11-02 — Staging census undeclared tolerance tightened 21 → 19 — on `claude/census-tolerance-19` (off main `b539f15d`)

- **Measured.** The staging census ran after the #429 deploy (`b7558ad`, job 125059956124) and after the #431 deploy (`b539f15d`, job 125087050582). Both times it found 765 physical tables and 746 declared, and listed **exactly 19** undeclared tables. The 19 names were identical between the two runs.
- **Change.** `UNDECLARED_RESIDUE_TOLERANCE` in `scripts/staging-schema-census.ts` goes from 21 to 19, so any NEW undeclared table now fails the census. The census test derives its boundary cases from the constant (19 passes, 20 fails).
- **Not done.** The 19 names are not pinned in code. A swap (one table retired, another added) would still pass on the count alone. The tables are left in place: dropping them is a founder / deletion-ledger decision.

## 2026-10-30 — Scheduler double-boot fix — on `claude/scheduler-double-boot-fix` (rebased onto main `b7558ad`; first built on `58d1a9b`)

- **Root cause fixed.** `log` moved to `server/utils/log.ts`; `jobQueue.ts` and `dbBackup.ts` no longer import `server/index.ts`, so the worker stops booting a web server and a second `runScheduledJobs()`.
- **Guards.** `runScheduledJobs` is once-per-process; `scheduleSelfRescheduling` refuses a second active registration of a name. Both log loudly with the duplicate call site.
- **Janitor.** Moved out of `routes.ts` module scope into `scheduledJobsBoot.ts`, started by `runScheduledJobs`: one registration across both processes. Work and cadence unchanged.
- **Run-now route.** Takes the scheduled path's lock (`etl:<jobName>`, 300s) under a fresh holder id per request. Contention returns the existing `skipped` shape (`reason: "locked"`), 200, no new status code. An unknown job id is now a 404 rather than a 500.
- **Worker dependencies on `index.ts`, named and made explicit** in `server/workerBoot.ts`: provider registry, DB-stored credentials, realtime-alert Redis publisher, env/secret validation, PII console mask, test-auth guard, tracing. The replica role check was not carried over (warn-only, app boot).
- **Ratchet.** `run-scheduled-jobs-linecount` lowered 5594 -> 5588.
- **Not done.** Staging verification (2 poll days of `job_runs` counts, :5000 check, concurrent run-now) is still owed after deploy. No tables dropped, no cadences, TTLs or lock semantics changed.

## 2026-10-30 — Staging schema reconcile chained after every staging deploy, plus a table census — on `claude/reconcile-chain`

- **Why.** Staging deploys apply no schema (`fly.staging.toml` `release_command = "true"`). The only schema path was the nightly 07:17 UTC reconcile. On 2026-10-28, `note_events` (0293) lagged a green deploy that way.
- **Chain.** `staging.yml` gains a `schema-reconcile` job (`needs: deploy-staging`). It calls `staging-schema-reconcile.yml`, which now also takes `workflow_call`, so a failed reconcile or census turns the deploy run red. Rollback is deliberately not triggered by it, because rolling back the image would not undo DDL that already ran. The concurrency group `staging-schema-reconcile` moved to the job level so it holds for nightly, dispatched and chained runs alike.
- **Census.** A new `census` job runs after the reconcile and calls `scripts/staging-schema-census.ts`.
  - Physical: tables in staging's `public` schema (relkind r/p, no partitions). They are read SELECT-only on a staging machine, as names plus constraint and trigger counts.
  - Declared: every `pgTable(` on a non-comment line under `shared/`, the table-count ratchet's own rule. The run fails if an occurrence has no name, if the total differs from the ratchet baseline, or if a barrel table goes unseen.
  - Measured locally: 748 occurrences give 746 distinct names. `conversations` and `messages` are declared twice. The `shared/schema` barrel exports 743.
  - Tolerance: 0 for declared-but-absent tables. Up to 21 undeclared tables are tolerated, all listed and none dropped; dropping them is a founder / deletion-ledger decision. *(Tightened to 19 on 2026-11-02; see the entry at the top.)*
  - It also checks that the newest `migrations/*.sql` block's tables are present with the triggers that file creates.
- **Comments corrected** in `staging.yml`, `fly.staging.toml` and the reconcile header. None of them claims `db:push` any more.
- **Gate.** `tests/unit/stagingSchemaReconcileChained.test.ts` parses the workflows. Nine mutations were each confirmed red.
- **Next.** Pin the 21 undeclared residue by NAME once a census run has listed them, then lower the tolerance as the founder retires them. *(2026-11-02: the census has listed them, 19 by name; the tolerance is now 19. Pinning the names is still open.)*
## 2026-10-30 — PROD OUTAGE: nobody can sign in. Clerk proxy fix on `claude/clerk-proxy-signin-fix` (staging only)

- **Cause (proven in the founder's package):**
  - `server/middleware/clerkProxy.ts` forwarded `x-forwarded-host` = the public host.
  - FAPI attributes instances by that header, so `/__clerk/v1/environment` and `/v1/client` answered 400 `host_invalid` on prod and staging.
  - The `<SignIn>` widget never got a form.
- **Fix:** the header is no longer sent. `Clerk-Proxy-Url`, the secret-key handling, the publishable key and `/auth` are unchanged.
- **Detection:**
  - `clerk_proxy_health` probed the backing FAPI directly, which stayed 200 through the outage. It now goes through `<APP_URL>/__clerk/v1/environment` (`probeSignInProxy`).
  - The ops watch, which runs every 30 minutes, gains a `sign_in` provider. Two failed probes in a row open ONE incident and page the founder once; the first good probe resolves it.
- **Tests:**
  - `clerkProxyForwardedHost.test.ts`: the fake FAPI 400s on any forwarded-host claim, and three mutants were caught.
  - The real-DB harness `soleneStage2OnBuiltSchema` covers the sign-in incident lifecycle.
- **Not verifiable from the session sandbox:** `clerk.com` and `*.clerk.accounts.dev` are blocked by the network policy. Staging (deployed from this branch) is the proof.
- **Next:**
  - staging `/__clerk/v1/environment` returns 200;
  - the widget renders on staging `/auth`;
  - Muse audits;
  - prod deploy is a separate founder dispatch.

## 2026-10-30 — V-Tax-1 T2b bundle trim (#421; founder call: option 1, no ceiling change)

- **Measured:** T2b with main (#426) merged was 9826.91 KB against the 9823 KB ceiling. With the trim it is **9765.14 KB**, PASS, 57.9 KB under. The ceiling is left at 9823 KB, as the founder said.
- **What was dead:** the client imported `COVERAGE_LABELS` from `shared/landData/countySourceCensus.ts`. That module builds the 95-county census from its JSON at load, so the whole JSON (about 62 KB minified) shipped in the maps chunk and was never read. The client renders coverage from `GET /api/land-data/coverage`.
  - The types, labels and rule are now in `countyCoverage.ts`, with no data import. `countySourceCensus.ts` re-exports them, so no server code changed.
  - The stale reachability entry for `deriveCoverage` is removed.
- **Guard:** `clientNeverBundlesCensusData.test.ts` walks value imports transitively from every client file through `shared/`. Two mutants (a direct import, and a transitive one) were both caught.
- **Evidence:** `docs/evidence/2026-10-30/t2b-bundle-trim.log`.
- **Next:** Muse re-audits #421. Then T3a (#422), T3b (#423), T4a (#424, already accepted) and T4b (#425) each take main as the PR below them lands. The prod sign-in fix (Clerk proxy) is on its own branch.

## 2026-10-29 — V-Tax-1 T2b audit fix batch (#421, audited NOT YET MERGEABLE at `86d77e26`)

- **Fix 1, the quiet-title gate bypass.** Every route that could lift the lock now checks the county's deadline, not the status alone:
  - the case-open gate checks the date whatever the status;
  - a certificate PATCH to `deed_obtained` or `expired_to_deed` is refused while redemption is still running;
  - completing `petition_filed` re-checks the certificate itself.
- **Fix 2, `quiet_title_filed` is now written.** I chose to write it rather than remove it: T3b and T4b already read it.
  - Completing `petition_filed` registers the event, citing the case, in the same transaction.
  - A filed petition cannot be un-filed, because the calendar is append-only.
  - A computed deadline cites the `procedure_object` when the county's verified procedure states the same period.
- **Founder decision recorded:** T3a over-max bids keep the override with a stated reason. Absolute refusal is rejected (decisions doc §3).
- **Evidence:** `docs/evidence/2026-10-29/t2b-fix-mutations.log` (7 mutants, all caught).
- **Next:** Muse re-audits #421. Then T4a's fix (#424): the lot record must read the county watch's redemption period.

## 2026-10-29 — V-Tax-1 T3a — bid discipline: max bid from the rights stack, over-max flag, pre-bid discards, Courthouse Mode recording again — on `claude/tax-v1-t3a-bid-discipline` (stacked on T2b)

- **Storage.** Migration 0297 adds columns only; the table count is unchanged (founder decision 2026-10-28).
  - `tax_sale_listings.max_bid_basis`: the rights-stack decision record.
  - `tax_sale_listings.discard`: the kill reason, CHECKed to the four reasons.
  - `auction_bid_log.max_bid_cents_at_action` and `over_max_reason`. A CHECK means a reason can only exist beside the max it went over, on an amount that exceeded it.
- **Max bid** (`shared/tax/maxBid.ts`). It is value − liens the operator's own search says survive − other taxes − costs − required return. Each line carries its source and as-of date.
  - It is labelled a screen; the recorded line items are the decision record.
  - A missing line refuses and names itself. "Searched, none found" is stated; "not searched" is missing, never 0.
  - AcreOS does not decide which liens survive a sale; the line is named for what the operator recorded.
  - The worksheet editor previews with the same function the server records with. A typed max that differs drops its basis and reads "your typed number — no basis recorded".
  - Golden cases are in `shared/tax/golden/max-bid-golden.json`.
- **Over-max.** A bid or win now needs the amount actually bid or paid.
  - Over the max, it is flagged in the dialog BEFORE it is sent, and the server refuses it without a stated reason (422, nothing recorded). With a reason, it is recorded beside the max it exceeded.
  - The worksheet Bid button used to log the max itself as the amount bid, so the check could never fire. The Won dialog pre-filled the max as "what you paid". Both are fixed.
- **Discards.** A lot is discarded before bidding with one of: unbuildable, landlocked, contaminated, or other (with its reason).
  - Bidding on it is refused; passes still record. Reopening keeps the discard on record and restores the prior status.
  - Triage moves discarded lots out of the diligence order into their own list, and shows a recorded lien search instead of "no lien search has been performed".
- **Courthouse Mode recorded nothing, ever.** It POSTed to `/api/auction-listings/:id/log-bid`, a route that never existed, toasted "Action queued — we'll sync" and advanced anyway. The service worker queued that same dead prefix.
  - It now posts to the real bid log, and asks for what was paid on a win, with the over-max flag.
  - It advances only when the action was recorded or queued by the service worker; a refusal stays on screen. Skip writes nothing.
  - `sw.js` queues exactly the bid-log path (`OFFLINE_QUEUEABLE_PATTERNS`). A test fails if any queued prefix is not a mounted route.
- **ORM fixed (T2b's note).** `tax_certificates.id` is uuid in shared/schema now, the 15th uuid id family.
- **Escalated, not fixed — a national default (stop condition).** `preForeclosureNoticeMonths: 1` is the same value for 45 of 51 states in `shared/regulatory/taxLienStateRules.ts`.
  - It reaches the cert workflow payloads (`stateForeclosureNoticeMonths`, `server/services/certificateEvents.ts`) and the state-rules text ("roughly 1 month of pre-foreclosure notice", `server/routes-tax-rules.ts`).
  - The T0 remedy (refuse, don't present) would apply. It needs the founder's call, as T0's four did. T3b's foreclosure-filing deadline does not use it.
- **Next.** T3b covers three things:
  - the auction calendar in the county's own timezone. No county→zone mapping exists anywhere in the repo, and every tax date is UTC midnight today; the zone will be stated with its source, never guessed.
  - the bidder-registration checklist as a stage gate on `tax_sale_auctions` (columns, no table);
  - the certificate ledger (subsequent taxes paid, notices recorded, foreclosure-filing deadline) as `tax_events` types.

  Then T4.

## 2026-10-29 — V-Tax-1 T2b — redemption clock, calendar, alerts, locks, quiet-title gate — on `claude/tax-v1-t2b-clock-gates` (stacked on T2a)

- **Storage.** Migration 0296 adds `tax_events`: the tax calendar, where each redemption expiry carries the rule it rests on.
  - It is append-only and leaves only with its certificate.
  - The FK is `uuid`, because the DB's `tax_certificates.id` is uuid although the ORM says varchar.
  - It also adds `tax_certificates.deadline_source` and `quiet_title_cases.market_exception`, and retires `auction_readiness_checklists`. The founder's four-for-four swap is complete; the table count is 748.
- **Clock** (`shared/tax/clock.ts`, `GET /api/tax-certificates/:id/clock`). It covers:
  - the countdown, the rule cited (AcreOS's preliminary rule, or the county record entered) and the 90/30/7 alert dates;
  - the next action, and the "do not improve, do not market" lock with what clears it;
  - the capital tied up, and marketability in AcreOS;
  - a cross-check against the county procedure's stated period, where a mismatch is shown and never resolved.
  - On the redemption-clock page it opens from a per-certificate "Clock" button.
- **Nightly job.** It never overwrites a deadline the operator entered; until now it clobbered won-bid overrides in the 10 encoded states.
  - A computed deadline it corrects is re-registered on the calendar.
  - New one-shot 90- and 30-day alerts fire only the tightest threshold crossed. The daily 7-day alert and the workflow lanes are unchanged.
- **Quiet title.**
  - A case opens only once redemption has expired; redeemed and cancelled certificates are refused.
  - An attorney-reviewed exception can be recorded with the attorney's name and the reason.
  - Marketable in AcreOS means the deed is held AND the petition is filed or the exception is recorded. AcreOS never declares title marketable.
- **Flat-penalty honesty.** The redemption-clock Rate column now reads "25.00% flat penalty", "x/mo" or "x/yr". The workflow templates' "statutory rate" now reads "20% penalty — one-time, not an annual rate" for GA and TX.
- **Escalated, not fixed (attorney-gated legal reading).** Encoded TX `flat_first_period` adds the 50% second-period premium ON TOP OF the 25% (75% total) once past 6 months, and uses a 6-month first period even in the 24-month owner-occupied case. Whether that matches Tex. Tax Code §34.21 is a legal reading for the founder or an attorney.
- **Guard correction.** The guarded drops in 0294–0296 check for rows through `EXECUTE` (see the deletion ledger), and the fix is ported to T1 and T2a.

## 2026-10-30 — Express 5 params-typing compat (package 2026-10) — on `claude/express-params-compat`

- **What it unblocks.** `@types/express` 5 (in the Dependabot bumps #406/#411) types every route parameter as `string | string[]`. On main with only that one package swapped to 5.0.6, tsc reported 919 errors: 917 from params, 2 not.
- **Wildcard survey first.** There are four wildcard routes:
  - `/api/v1/{*splat}` (routes.ts)
  - `{*splat}` (static.ts and vite.ts)
  - `/learn/*learnPath` (routes-seo-head.ts)
  None of them reads its wildcard parameter; each uses `originalUrl` or `req.path`. There are no regex routes and no optional segments. Refusing arrays therefore breaks no flow.
- **One helper.** `routeParam()` in `server/utils/routeParams.ts` returns a string unchanged. An array is logged and refused with a `RouteParamArrayError` (statusCode 400); it never takes the first element, joins, or coerces. A handler that catches the error itself returns its usual 500; only the terminal handler reads the 400. An undeclared key passes through as `undefined`, as before.
- **Codemod.** Every `req.params` read in non-test `server/` code goes through the helper:
  - 1,174 dotted/indexed reads and 85 destructured names were wrapped, across 192 files: 1,256 helper reads in all.
  - One read was then reverted on purpose: `borrowerPortalKey` stays raw because it already falls back to the client IP for any non-string, so a refusal would have broken it. The gate lists it as the one explicit exception.
  - `req.query` is untouched: none of the 919 errors involved it.
- **Review.** An independent reviewer found the ltvTenancy regression assertion blinded by the wrapper. It is rewritten to match both forms, and it still refuses the defect.
- **The 2 non-params errors.** These were the `unknown`→`void` errors in routes-admin-compliance; its wrappers now return `ReturnType<typeof isAuthenticated>`. The `Outcome` union error resolved through the codemod.
- **Gate.** `routeParamRefusesArrays.test.ts` covers four things:
  - array refusal, at unit level and over HTTP on Express 5;
  - a population gate: no raw `req.params` read in server code, with file and read floors;
  - a canary for each forbidden shape;
  - mutation-tested by hand: making the helper return `value[0]` turned it red, and so did unwrapping one site.
- **Not done / owed.**
  - The bullmq `JobType "paused"` error does not reproduce on main (bullmq 5.79.2 still has `paused`). It belongs to the bullmq 6 bump in #406, where dropping `"paused"` from `getJobCounts` is a real behaviour change to decide then.
  - The #406 extras are not touched: react-day-picker caption, Sentry `profilesSampleRate`, bullmq repeat.
  - The #406/#411 rebase and re-audit are a separate, owed step.

## 2026-10-30 — G11 fidelity fix — import/export round trip — on `claude/g11-fidelity-fix` (based on main `58d1a9b`, independent of the Tax branches)

- **One PR, five defects plus three small items.** Gates log: `docs/evidence/2026-10-30/g11-fidelity-fix-gates.md`.
- **1 Originated notes import.** The importer now reads Start Date and First Payment Date and refuses a row without them, naming the column. It never makes a date up.
  - A row is validated whole before anything is written. If the note still fails, the borrower lead that row created is removed, and `lead.created` fires only after the note exists.
  - A blank Monthly Payment is calculated only when both Interest Rate and Term are stated; otherwise the row is refused.
  - A headers-only CSV now reports 0 rows. The 500 was `parseCSV` throwing on it. A file with no header at all is a 400.
- **2 Properties.** `Size (Acres)` is in the import map and the exporter writes the raw acreage. `exportHeadersAreImportable.test.ts` resolves every exported header through the importer's own resolver. `EXPORT_ONLY_HEADERS` names the few the importer deliberately ignores.
- **3 Leads.** The export now has County, APN, Acreage, Assessed and Estimated Value, the three tax-delinquency columns and Do Not Contact. Tags round-trip (the export joined with `; `, the import split on `,`).
- **4 Acquired notes.** New `GET /api/export/acquired-notes` (csv or json), `acquired-notes.csv` in the export-everything ZIP, and a download entry on the data-export page.
  - A dedicated endpoint, not an extension of `/api/export/notes`: three callers read the legacy shape (the data-export page, the ZIP, `routes-finance`), and the two books have different columns.
  - Headers are the note-tape field labels. The re-import path is `POST /api/note-tape/preview` then `/commit`, and the golden bar holds field for field.
  - A note that did not arrive through the tape has no document observations, so it exports blank document cells and the tape importer refuses it, naming the field.
- **5 Investor-income 403.** The package called this a test-identity limit. It was not.
  - `requireOrgOwnerOrAdmin` read `req.permissionContext`, which is only filled on mutating requests, so a genuine owner got a 403 on every GET.
  - The gate now resolves the caller's membership (`getUserPermissionContext`) and honours the founder identity as `requireFounder` does. A member and a stranger still get 403. `testAuth.ts` is unchanged.
- **Found while verifying Defect 5.** `aggregateInvestorIncomeForYear` multiplied each LP's interest by the note's split-row count (a window SUM over splits x payments). Three splits gave 3x the income, 225,000 where 75,000 is right. It now sums per note in a subquery. This feeds LP tax statements, so a reviewer should look at it first.
- **PATCH provenance.** A PATCH to an acquired note now writes one `edit` observation per changed field, in the same transaction. This needs migration `0300`, which widens the source CHECK; no table is added. It uses `0300` because Tax PR #421 holds `0296`.
- **Import errors.** `importRowError` maps driver errors to a field-level message. Applied to the lead, property, deal and note importers, the communications import, and job error text.
- **Sweep.**
  - Deals: headers resolve. Offer Date and Closing Date are now imported.
  - Originated notes: the export still carries no borrower name or contact. It is lead data, and adding it would widen the purpose-ledger census (DEBT may only shrink). A re-import of that export now refuses each row naming the borrower, and no longer 500s.
  - Communications: `leadEmail` was missing from the export, though the README told people to match on it. It is added.
  - Payments and audit log: no re-import path, by design.
- **Not done.**
  - The staging round-trip demonstration (staging is not reachable from here); the real-database tests stand in.
  - Leads invalid-numerics coercion is unchanged, as the package directed.
  - Existing defaults in the originated importer (rate 0, term 120, payment day 1, grace 10) are untouched and still invent values; they are worth a separate decision.
  - Needs a reviewer: the compensating-delete atomicity (storage takes no transaction) and the `parseCSV` change.

## 2026-10-29 — V-Tax-1 T2a — procedure objects + county-verification gate + bidding lock — on `claude/tax-v1-t2-procedure-clock` (stacked on T1)

- **T2 ships as two PRs, each net zero on tables.**
  - T2a: procedure objects and the bidding lock.
  - T2b: the clock and calendar (`tax_events`), 90/30/7 alerts, the redeemable-deed lock, the quiet-title gate, and flat-penalty honesty on the existing surfaces.
- **Storage.** Migration 0295 adds `tax_procedure_objects`.
  - It is versioned: UPDATE and TRUNCATE are refused, and a change is a new version. DELETE stays allowed so erasure completes.
  - It is org-private: one organization's verification is never shown to another.
  - It retires `county_redemption_rates` with the guarded, atomic drop. The table count stays 748.
- **The procedure object** (`shared/tax/procedure.ts`) records instrument, bid method, interest or penalty, redemption period, notice, foreclosure / quiet-title path and subsequent taxes.
  - Every field carries its source, its as-of date, state law or county practice, and its verification. AcreOS authors none of them.
  - A source over 12 months old raises the stale-law banner. County practice is labelled "not state permission".
- **The bidding lock (T2 [AUDIT]).** A county is biddable only with every required field, no stale field, and a county-verification task under 12 months old. Otherwise `POST …/bid-log` refuses `bid`/`won` with a 422 and the reasons, and records nothing.
  - `passed`, `outbid` and `no_show` stay open.
  - **Every county starts locked** until someone records its procedure and verifies it. This is the spec's intent; it will block bidding for existing users until they do.
- **UI.** A procedure card on each county watch: standing, reasons, banner, every field with its provenance, and forms to record a version and complete the verification.
- **Flat penalties** are described as "one-time, not an annual rate" (`describeReturn`).
- **Not in T2a.** The clock, alerts, locks and quiet-title gate (T2b). Seeding procedure objects from the old state tables was not done: that would put AcreOS-authored "law" into a store whose whole point is sourced, verified fields.

## 2026-10-29 — V-Tax-1 T1 — tax-list import, county watches, triage — on `claude/tax-v1-t1-watch-triage` (stacked on T0)

- **Storage (founder swap, net zero).**
  - Migration 0294 adds `tax_county_watches` and `tax_lot_observations`; the observations table is append-only and leaves only with its lot.
  - It retires `tax_sale_alerts` and `lien_search_records` with a guarded drop. The checks and the drops are ONE statement, because `migrate.mjs` runs the next statement after a failure.
  - It was proven by hand that a retired table holding a row survives, and so does its empty sibling.
  - `tax_sale_listings` gains `sale_date` and `import_id`, and `total_tax_owed` becomes nullable.
  - The table count stays 748.
- **Import (extended in place, not a parallel importer).**
  - The existing lot-list import gains a sale date, which is required unless the list is imported into an auction with a date (that date is recorded with the auction as its source), and delinquent years, which are required.
  - Amount owed becomes optional. Unstated is null, never 0, and is not summed.
  - The commit is one transaction. It writes the lots, a provenance observation per stated cell (file, row, column, raw), a recorded blank for each optional column the list has but leaves blank, the parcel/APID match, and a county watch per county.
  - Owner names are not copied into observations.
- **One parcel resolver.** `landData/resolveOwnedParcelRef` is extracted from the note-tape commit, which now calls it, so "matched" means the same thing in Notes and Tax.
- **Watches and triage.** Routes: `GET /api/tax-watches`, `PUT /api/tax-watches/:id/terms` and `GET /api/tax-watches/:id/triage`.
  - A watch's terms are stated values with a source, or unknown.
  - Triage (`shared/tax/triage.ts`) lists each lot's unknowns ordered by decision weight ÷ cost kind. It is labelled a screen. Costs are kinds, never dollars.
  - The panel sits on the auction worksheet, behind the tax-delinquent door.
- **Golden.** `shared/tax/golden/tax-list-golden.csv` plus its hand-written expected output.
- **Not in T1.**
  - Address-only lots: the APN stays required, which is stricter than the spec's "APN and/or address".
  - A row-level all-or-nothing commit: rejected rows are reported and the valid ones import, as before. Required columns still refuse the whole file.
  - Procedure objects and the clock (T2), bid discipline (T3), and the disagreement panel (T4).

## 2026-10-28 — V-Tax-1 started (Notes V1 complete: N1–N4 merged, main `45ed282`). T0 — tax defaults refuse instead of inventing — on `claude/tax-v1-t0-refuse-defaults`

- **Send gate re-verified.**
  - Main is `45ed282`.
  - The D2c tables (`parcel_apids`, `parcel_apn_windows`, `parcel_lineage_events`) are in migration 0291 on that head.
  - Staging deploy run 40743046229 succeeded on `45ed282`.
- **Map first.** Main already has nine tax-sale tables, two CSV importers, a redemption clock with a nightly job, quiet title and an auction worksheet.
  - None of it records per-field provenance or resolves to an APID.
  - Three rule stores disagree with each other.
  - Four tables are dead: nothing reads or writes them.
  - `note_events` cannot hold tax dates, because it requires an acquired note.
  - The forward-calendar registry the package assumes still does not exist.
- **Founder decisions** (`docs/company/founder-decisions-2026-10-28-tax.md`):
  - Swap the four dead tables for four purpose-built ones; the table count stays 748.
  - Fix the national defaults first, in their own PR.
- **T0 fixes.**
  - No 12% fallback: a state with no rule gets no amount, and the reason is stated.
  - No owned-deed fabrication: a certificate with no computable deadline is refused unless the county's deadline is entered with its source.
  - Quiet-title steps open undated, in procedure order.
  - An unknown redemption period scores nothing in the county opportunity score.
- **Left for T2.**
  - GA/TX flat penalties are still shown beside annual rates. Annualised-return honesty belongs to T2.
  - The nightly job still overwrites deadlines in the 10 encoded states.
  - Quiet title has no status gate yet.
  - SCRA tolling is still unimplemented; it is a founder decision, tracked in `statuteRegister`.

## 2026-10-27 — V-Notes-1 N4 — disagreement capture and negative knowledge — on `claude/notes-v1-n4-disagreement` (stacked on N3)

- **Disagreement.** For each term and yield field, the note record returns every distinct value any import stated, each with all its sources, plus which value the book holds (`bookValueIs`). A source stating a value the book lacks also counts as a disagreement: a later tape fills a field the first left blank, and a re-import never updates the book row. Nothing is resolved, averaged or deleted.
- **On the page.** A "Sources disagree on N terms" panel sits above the terms. It lists every value with its provenance chip, marks the book value, and says AcreOS has not picked one. Each disagreeing row carries a "sources disagree" badge.
- **Negative knowledge.** The import now records a `searched_none` observation for an optional field when the tape HAS the column but the cell is blank. The record distinguishes `blank_on_source` ("blank on the tape (column X) — asked, nothing stated") from `never_stated` (no import had the column). A later tape lacking the column does not erase the earlier "asked and blank". Collateral, liens, tax status and hazards already carried searched-none vs never-searched from N1/N2.
- **Tests rewritten to the new truth, not deleted.** `noteTapeCommit.realdb` and `noteRecord.realdb` had pinned "a blank field has no row". They now pin that a blank is never a value: it is a searched-none row, and a field the tape has no column for still has no row.
- **Not in N4.** Warehouse-vs-tape disagreement on a TERM: the warehouse holds no note terms, so there is nothing to compare yet. Collateral value comes only from the warehouse. Operator resolution of a disagreement (choosing a book value) is a write path the spec did not ask for.

## 2026-10-27 — V-Notes-1 N3 — outcome and forward-calendar hooks — on `claude/notes-v1-n3-events` (stacked on N2)

- **Storage.** `note_events` (migration 0293 + mirror) is the second of the founder-approved +2 tables, so the table count is now 748. It is append-only and org-private on the same terms as `note_field_observations`: a row leaves only with its note, so org erasure still completes (real-DB tested). CHECKs tie each event type to its category, and allow a recurrence only on a payment due that stays inside maturity.
- **Outcome hook.** Each imported row records one `performance_reported` event (status, paid-through date, balance), dated by the tape's as-of, or by the import date with that said. No model reads it. It is raw material for V-Notes-2 calibration.
- **Calendar hook.** Every imported row registers its maturity. Next payment due (monthly through maturity), balloon and next rate adjustment are registered only when the tape STATES them. A next due date is never derived from the due day. A new optional tape field, "Next rate adjustment", is stored as an observation and an event; it has no `acquired_notes` column.
- **Validator.** A next due, balloon or rate-adjustment date after maturity now refuses its row and names the cell.
- **Read.** The note record gains `outcomes` (every report, oldest first) and `calendar` (the latest registration per type, or why none is on record). The note page shows a "Dates on record" card: recorded only, nothing scheduled or sent.
- **Not in N3.** Alerts, clocks, reminders and borrower comms (V-Notes-2, inside the consent rails). No calibration model. Posted servicing payments are not mirrored into outcome events: that would touch the payment-posting path, which is money-adjacent.

## 2026-10-27 — V-Notes-1 N2 — the note page record — on `claude/notes-v1-n2-note-page` (stacked on N1)

- **Route.** `GET /api/notes/:id/record` (`server/routes-note-record.ts` + `services/notes/noteRecord.ts`). Owner/admin only; another org's note and a malformed id are the same 404.
- **Provenance on every value.** Each term and yield field carries the observation that states it: tape file, row, cell, as-of, confidence. A value entered outside the import says "no source recorded".
- **Investment-to-value** is purchase price ÷ the collateral's market value on record, shown only when both are known.
- **Document set.** present / missing / exception / no record, with the critical gaps named.
- **Collateral picture.** From the owned public-record parcel: value with its source and retrieval date, tax amount and year, APID or the reason there is none. Tax status, senior liens and hazards say "not searched" (no data model or lookup exists yet), never clean. Unmatched and never-searched are separate empty states, each with its next action.
- **UI.** `NoteRecordPanels.tsx` on `/notes/:id`: terms first, documents and yield beside them, collateral second, the existing ledger below as the timeline. Provenance chips open to the tape row and cell.
- **Not in N2.** The disagreement panel (N4; the record already returns every observation of a field). A live lien or hazard lookup (none exists; one would be a provider call and money-adjacent).

## 2026-10-27 — V-Notes-1 started (D2 merged as #412). N1 — note-tape import — on `claude/notes-v1-n1-import`

- **Storage (founder-approved +2 tables).** `note_field_observations` (0292) holds every stated value with provenance, plus recorded absences. It is append-only and leaves only with its note. `note_events` lands with N3. The table count is now 747. Decision record: `docs/company/founder-decisions-2026-10-27-notes.md`.
- **Importer.** `shared/notes/noteTapeFields.ts` (catalogue) and `server/services/notes/noteTapeImport.ts` (pure validator).
  - Refusal before build: an unmapped required field refuses the whole file.
  - Row errors carry the field, the cell and the fix. Nothing is coerced; missing is null.
  - Targeted per-cell corrections are recorded as `operator_correction`.
  - The document set (note, mortgage/DOT, assignment chain) must be mapped, and an exception must be recorded.
  - Yield fields are first-class: three new nullable columns on `acquired_notes`.
- **Commit.** `noteTapeCommit.ts` runs in one transaction.
  - It refuses unless every row is valid or explicitly excluded.
  - An existing loan number is never overwritten: values are appended and the differing fields are reported (N4's raw material).
  - Collateral is resolved to an owned public-record parcel, and to an APID where a FIPS reference exists. Otherwise it is recorded as `searched_none`, or as nothing when there was no APN.
- **Routes and UI.** `POST /api/note-tape/preview` and `POST /api/note-tape/commit` sit behind `canImportData`. `NoteTapeImport.tsx` is mounted in the existing notes import dialog (Finance door → notes tab, and `/notes?action=new`).
- **Retired.** The old acquired branch of `POST /api/import/notes` (`importAcquiredNotesFromCSV`) wrote rate 0, term 360 and a derived maturity, and called any unknown status "performing". The branch now refuses, and the function is deleted.
- **Golden note.** `shared/notes/golden/note-tape-golden.csv` plus a hand-written expected output, asserted end to end.
- **Not in N1.** The note page (N2), events (N3), the disagreement panel (N4), and borrower TIN import (deliberately not imported).
- **Spec gaps flagged.** The four design docs the spec cites (`files/platform-*.md`, the deepening doc) are not in the repo, so the nano-bar audit can only be run against what the spec itself states. The spec says the forward-calendar registry exists; it does not (`note_events` in N3 is that registry).

## 2026-10-27 — Delta audit on e398c3a3: the last gap, `source_parcel_id` dedupe in release assembly (founder: implement)

- **Dedupe.** `assembleAndStoreRelease` now reads each included county's parquet back (digest-checked) and keeps ONE row per `source_parcel_id`.
- **Which row wins.** The LAST copy in artifact order. That is the stable id sort over the source's `OBJECTID ASC` paging, so the highest source OBJECTID wins, i.e. the most recently inserted feature. There is no per-row edit date to judge recency, so this is stated as the deterministic rule. The rule is documented in the code header and in INTEGRATION-D2b.
- **What the release names.** A county with a repeat gets a deduped artifact pair, uploaded and bucket-confirmed like a build's, and the release names that pair. A county without one is named exactly as built.
- **Reporting.** Drops are reported in `AssemblyReport.deduped`.
- **No unchecked release.** With no object store, assembly refuses to store a release it could not check.
- **Downstream refusals stay** as defense in depth: lineage `duplicate_source_id` and the release diff.
- **Proof.** `tests/unit/releaseAssemblyDedupe.test.ts` drives the real entrypoint on real artifacts in a file-backed bucket. The as-built artifact is refused by lineage; the stored release names the deduped pair (the later copy wins) and lineage accepts it. A no-dedupe mutant and a first-copy-wins mutant each turn it red.
- **Docs cleaned.** The stale per-lane D2b/D2c "STAGED pending approval" lines in the 2026-10-24 entry now point to the 2026-10-25 wiring.

## 2026-10-26 (later) — CI round trip red on 5f14b02d: client tools newer than the server

- **What broke.** In CI run 40321419022, `build-schema` sub-check 10/10 failed on `pg_restore: ERROR: unrecognized configuration parameter "transaction_timeout"`. Nothing in the repo had changed: the same scripts passed on `5d11a766` the day before, and none of the dump/restore/workflow files had changed since 2026-10-11. `db-backup.sh` and `db-restore.sh` called whatever `pg_dump`/`pg_restore` came first on PATH. The runner's client tools moved past the `pgvector:pg16` service, and a 17+ client sends `SET transaction_timeout`, which 16 rejects.
- **Fix at the source.** `scripts/lib/pg-client-for-server.sh` resolves `pg_dump`/`pg_restore` of the SERVER's major version and refuses a mismatch, naming the package to install. Both scripts use it, and the manifest records `serverVersion`. CI installs `postgresql-client-16` (falling back to the PGDG repository). The round-trip check is unchanged.
- **Proof.** A local shim reporting "17" that sends `SET transaction_timeout`: the old scripts reproduce CI's exact error; the new ones resolve 16's tools and pass. The full `build-schema` run passes 10/10 with the shim on PATH. `offProviderBackupIsProvenInCi.test.ts` now pins the resolved call, and its credential check reads the `$PG_DUMP`/`$PG_RESTORE` calls. A bare-`pg_restore` mutant turns it red.
- **Follow-up, not changed.** `server/jobs/dbBackup.ts` (the production backup job) still runs a bare `pg_dump`. It has the same hazard if the Fly image's client ever moves past the database's major version. It is a production path, so it is flagged here rather than changed in a CI fix.

## 2026-10-26 — D2 consolidated audit fix list (Tom decided every open item); same branch, nothing merged

### What shipped
- **Org erasure deletes the text-keyed tenant tables** (Tom: delete, not retain). `deleteOrganization` now compares each tenant key in its own type (integer key → number, text key → its decimal string). It refuses to start when a key has a type it cannot match. Only an FK violation (23503) is retried; any other DELETE error throws `OrgErasureError` BEFORE the org row is deleted, and so does a failed `financial_ledger` detach. `onboarding_funnel_metrics` and `pax_user_context` rows are now erased. Proven on a database built from the repo (`orgErasureTextKeyedTables.realdb.test.ts`); the old integer comparison turns it red. Retention (1A) unchanged and re-verified: `financial_ledger` is detached, `purpose_ledger` is kept.
- **D2e batch per lead (2A).** Each lead's debit and purpose row commit in that lead's own transaction, and its vendor call follows that commit. A refusal or ledger failure skips only that lead, and a failed lookup refunds only that lead's debit. If the pool refuses every lead, the response is 429 with nothing run. The single door is unchanged. Isolation tests are mutation-proven.
- **FCRA citation.** written_consent is §1681b(a)(2); the other three are (a)(3). The enum is unchanged, and the real thrown message is pinned.
- **Claim corrections** (verified against the repo before editing):
  - D2c has 44 tests counted syntactically (19 + 18 + 7), and 65 at runtime (`it.each` expands lineageGolden to 28). Quote it as "44 tests, 65 cases".
  - D2h has 22 numbered entries, not 23.
  - D2d: wave-1 states other than FL never auto-promote; FL (Nassau) does.
  - D2a: 310 MB is a lane-reported figure, not a measured one. The pinned bound is the 400 MB internal ceiling under the 512 MB gate cap.
  - The D2h E1 guard is at `streamingArtifacts.ts:355-390`.
  - The INTEGRATION-D2c §4 heading now says three tables.
- **Close-out verification.**
  - Migrations 0290 and 0291 are mirrored in `migrate.mjs`.
  - The table count stands at 746, with approval notes.
  - The new tables are in the tenancy lint's population and classified global (they have no tenant key).
  - 14 D2b/D2c reachability entries said "STAGED pending table approval". They are reclassified as TRACKED FOLLOW-UP: the exports are still unreached, so the entries stay.
  - **Release assembly did NOT dedupe `source_parcel_id`.** Downstream it failed closed (lineage refused the county). Implemented 2026-10-27; see that entry.
- **Evidence logs** are kept in `docs/evidence/2026-10-26/`.

### Tracked only (not fixed)
- D2b §4 served-answer stamping (`served_release_id` exists; nothing writes it).
- D2c §3 crosswalk proposal.
- `source_parcel_id` dedupe in release assembly (done 2026-10-27).
- Non-TN lineage: refused until there is a national county FIPS reference.
- D2d disclosed gaps.
- Cache `answeringLayer`.
- D3 parcel-delta cross-source disagreement.
- Regrid org-scoping policy.
- An FCRA counsel ruling before skip-trace volume grows.
- Regrid price verification before the first paying customer.
- Human reads of the TN and NC terms before activation.
- D2f go-live prerequisites.
- D2a TN-47000 key reconcile (read-only count first).
- Other `§1681b(a)(3)(F)` mentions outside `fcraAttestation.ts` (`ai/tools.ts`, `routes-leads.ts`, `statuteRegister.ts`, …) were left as they are; only the cited line was in scope.

## 2026-10-25 — D2 pre-merge fix list (Tom approved seven decisions via Muse); same branch, nothing merged

### What shipped (follow-up commits on `claude/d2-bulk-wave1-identity-trust`, no history rewritten)
- **Org erasure (merge blocker).** `purpose_ledger` keeps no FK to `organizations` and sits in `RETAINED_TABLES` (Art. 17(3)(b)). `deleteOrganization()` now finishes for an org with ledger rows. Proven against a real DB built from the repo, differentially against a ledger-free control org; re-adding the FK turns it red.
- **P0a.** Pax `get_lead_details` strips `taxId`/`taxIdType` (`omitSecretColumns`), proven on the serialized tool result.
- **P0b + D2e Option B.** `fundSkipTraceLookups` debits the pool and writes the purpose rows in ONE transaction, before any vendor call. `POST /api/skip-traces` is now funded: 429 on refusal, refund on a failed lookup.
- **D2b wired.** Migration 0290, `releaseStore`, `releaseAssembly` (inactive job), founder promote/rollback/inventory behind Controls, and the real inventory in `/api/ops/data`.
- **D2c wired.** Migration 0291 creates exactly 3 tables (the doc heading said two; its DDL has three). It adds `apidStore` and `releaseLineage` (inactive job; TN-only FIPS; refuses other states).
- **Table count.** 741 → 746 (+2 D2b, +3 D2c), each approved.
- **D2f.** Stays unwired.
- **Real-DB proofs.** Every real-DB proof was falsified per index and trigger.

### Escalations (open, not fixed here)
- `deleteOrganization` never sweeps the two text-keyed tenant tables, `onboarding_funnel_metrics.org_id` and `pax_user_context.organization_id`: `text = integer` errors silently, so they are residual on EVERY erasure. Whether to delete or retain them is a customer-data-deletion decision.
- `parcelDeltaDetector` fires `owner_changed` on source disagreement.
- Regrid facts are stored with no org.
- FCRA cite (a)(3)→(a)(2).
- Confirm the Regrid price from the invoice.
- D2h TN/NC holds.
- A national Census county-FIPS reference (lineage is TN-only until then).
- D2b §4 served-answer stamping: the `served_release_id` column exists, but nothing writes it.

## 2026-10-24 — Package D2, delivered per workstream on branch `claude/d2-bulk-wave1-identity-trust` (Muse audits each; nothing merged from this lane)

Worked as a fleet: one worktree agent per workstream (D2a–D2h) plus two spec tracks, file-disjoint, with every shared file (migrations, migrate.mjs, schema, etlHandlers, registry, ratchets, next-moves) changed only by the integrator. Each lane's claims were re-run centrally; reachability was fixed per landing, never by raising a baseline.

### What shipped
- **D2a.** Streamed statewide template (`statewideCadastral.ts`, `streamingArtifacts.ts`) with dossier-gated live upload (no receipts, no "ingested"). Bounded TN Comptroller loader, county by county with metros first and statewide refused (`tnComptrollerCounty.ts`; bounded under an internal 400 MB RSS ceiling pinned in `tnComptrollerCounty.test.ts`, below the memory gate's 512 MB cap; accumulating mutants OOM in that gate. A 310 MB peak was reported from one lane run under fleet load and is not quoted as measured: that run was not reproduced centrally). Rows are sorted by parcel id in UTF-8 order via a bounded external sort. The object key carries the digest, so a same-day rebuild can no longer overwrite a receipted object. TX refuses explicitly (`TX_BEACHHEAD_COUNTIES` is empty, with its reason). Dossier drafts for 9 states in `docs/land-data/dossiers/` (no terms read; network). The whole-county in-memory artifact path is deleted (pmtilesWriter, writeGeoParquet/readGeoParquet, uploadAndConfirm, persistLoadedCounty); tests were ported. `completeLoadedCounty` is now the one canonical way to complete a county load.
- **D2b.** Pure release core in `server/services/landData/releases/`: content-addressed manifest id, `acreos-parcels vYYYY.MM.N` names, a bounded sort-merge diff, and an append-only promote/rollback pointer. 128 tests. Storage was approved and wired on 2026-10-25 (migration 0290, `releaseStore`, `releaseAssembly`); see the 2026-10-25 entry above.
- **D2c.** `shared/landData/lineage.ts` + `apid.ts`: lineage classification (with an explicit `ambiguous` outcome), APIDs that are never reused, non-overlapping APN windows, and inheritance; a synthetic golden lineage case. 44 tests counted syntactically (`apid.test.ts` 19, `lineage.test.ts` 18, `lineageGolden.test.ts` 7); 65 at runtime, because `lineageGolden`'s `it.each` expands to 28 (`docs/evidence/2026-10-26/d2c-d2d-suites.log`). Tables were approved and wired on 2026-10-25 (migration 0291, three tables, `apidStore`, `releaseLineage`); see the 2026-10-25 entry above. Crosswalk defect fixed: a retired parcel key was re-minted for a split remainder.
- **D2d.** Remap hardened against 20 drift shapes; six defects fixed (greedy assignment, degenerate proof, a throwing live read, duplicate golden parcels, unverified adoption, empty drift). Semantic JV→JV_HMSTD is rejected by golden. Wave-1 states other than FL have no golden county, so they never auto-promote; FL (Nassau, `shared/landData/golden/fl-golden-county.json`) is the golden county that does.
- **D2e.** Purpose ledger (0289, append-only, proven on real PG — log kept 2026-10-26: `docs/evidence/2026-10-26/purposeLedgerAppendOnly.log`, run under ACREOS_REQUIRE_REAL_DB). Receipts are unforgeable (WeakSet). Census of 221 person-adjacent surfaces: 214 are in a shrink-only debt register.
- **D2f.** Historical-use screening: verdict is adverse / no adverse in verified sources / inconclusive, never "clean"; a verified absence needs a positive control. Indiana end to end on fixtures. Entry point deliberately unwired (route/Pax tool held for COO).
- **D2g.** `GET /api/ops/data`: paid fall-through no longer counts failed attempts as paid; coverage by state against a stated denominator; release inventory reads `not_built`; layer vocabulary derived from the writers.
- **D2h.** `docs/land-data/d2h-research-verification.md`: 22 numbered entries checked (A1–A3, B1–B12, C1, D1–D3, E1, E2, E2a); only the PMTiles/GeoParquet format facts are confirmed at source.
- **Spec tracks** (separate worktree branches, not on the D2 branch): D3 conflation-disagreement spec + prototype; vertical + Pax groundwork specs.

### Not done, and why
- No live runs: the container's proxy denies state hosts, Regrid, USGS and ChatGPT.
- D2f exposure waits on a COO decision (route / Pax tool). D2b/D2c storage was decided and wired on 2026-10-25.
- The research, the design docs (v1/v2/Amendment 2) and vendor invoices are not in the repo (paths are proposed in D2h §3).

### Escalations raised to the COO (not fixed here)
- `server/ai/tools.ts` `get_lead_details` sends the lead row incl. encrypted `taxId`/`taxIdType` to the model provider (D2e P0).
- `parcelDeltaDetector.ts:406` fires `owner_changed` when two sources disagree (D3 finding).
- The Regrid ETL stores Regrid facts platform-wide with no org (`etlHandlers.ts:239-243`; D3 finding).
- Holds proposed by D2h: TN bulk upload, NC bulk storage (G.S. 132-10). Also: FCRA consent cite (a)(3)→(a)(2), and confirm the Regrid price from the invoice.
- `POST /api/skip-traces` makes a paid vendor call with no customer debit (pricing question, D2e).

### Next moves
1. Muse: audit each landed workstream; decide D2b/D2c tables, D2f exposure, D2e Option B (debit and ledger in one transaction), and the escalations above.
2. A networked session: read state terms into the dossiers; record positive controls for the D2f adapters; establish a golden county per wave-1 state.
3. D3 (conflation disagreement) is ready to start from its spec once D2b/D2c storage lands.

## 2026-10-23 — Package D1, data-sourcing foundation (bucket-independent parts), branch `claude/d1-data-sourcing-foundation`

### What shipped
- **D1a.** The Regrid cost table is at the published per-record floor (10¢ Standard / 15¢ Premium), and an empty answer or a free-source answer now costs 0. The credit-weight re-base was held at first (D1 stop condition): weights are what a customer's pool is debited, so changing them changes price. The founder decided it on 2026-10-23 (`b576d53f`): `parcel_lookup_paid` 8→10, `owner_lookup` 8→15, `valuation_lookup` 10→15, so no lookup weight sits below Regrid's cost.
- **A3.** `provider_lookup_log` gains `intent_class`, `answering_layer` and `confidence_served` (migration 0287), and the registry writes them on every path. A row with an org is that org's demand event. There's no reader yet.
- **D1c + A4.** `statewide_layer_metadata_v1` makes two metadata calls per statewide layer and reports drift against the last poll, the last ingest and the documented cadence. The orchestrator's new `finalize()` writes `etl_runs.observation` once per run, so the runs form an append-only snapshot series.
- **A2.** Every statewide row carries a dossier and a derived policy block. Every block is restrictive, because no terms were read.
- **D1b + A1.** `fl_statewide_cadastral_v1` refuses on a missing mapped field, an unbounded run, or an unverified county field. It writes canonical records with per-group provenance and decay class, GeoParquet and PMTiles locally, and `uploaded:false` receipts. It is never "ingested" without bucket-confirmed receipts and resolved use classes.
- **A5.** `tests/fixtures/golden/fl-golden-county.json` (moved in D2 to `shared/landData/golden/`; since established — five verified Nassau parcels) had five honest pending slots, and a CI harness checks them.
- Both jobs are seeded **inactive**.

### Not done, and why
- **Not run against live data.** The build container's network policy denies the state and Regrid hosts, so none of the live parts ran: the FL dry run, the 5-parcel spot check, the golden-county values and the live poll. They need a session that can reach `services9.arcgis.com`, `geodata.floridagio.gov`, `floridarevenue.com` and the other statewide hosts.
- **Design docs not in the repo.** `files/data-sourcing-intelligence-*.md` weren't available, so the D1 package text was used. The assumptions (Layer names, §12 use-class mapping, §8 RCW section) are noted in the code.

### Next moves
1. In a session that can reach the hosts:
   - run the FL dry run on one county;
   - fill the five golden slots from the county appraiser;
   - read the nine terms pages into the dossiers;
   - arm the poller.
2. D2 (TN county ingest) and D3 (delta ingest + `lastIngestedAt` per source).

## 2026-10-21/22 — Readiness packages 1–5 and the PR train (implementation lane; Muse audits and merges)

### Merged to main (main = 14748ed7 at 2026-10-22 03:40Z)
#388 (follow-redirects + vite advisories), #389 (entry chunk under budget),
#390 (letter-render launch timeout), #392 (Package 2, CAM FKs), #393
(Package 3, desktop-feel harness auth), #394 (Package 1, one org per signup),
#377 (transfer tax from statute), #391 (ops/ledger/kill-switch routes before
the /api catch-all).

### Refreshed onto main, waiting on CI and Muse (do NOT merge from this lane)
- **#395 Package 5, refund posting** — head 8d3d8ed0, 17/17 green. #394's
  restructure merged textually clean but put the chart-of-accounts seed
  OUTSIDE `if (provisioned.created)`; moved inside, after the `!isFounder`
  block (founders get charts). `chartOfAccountsSeedCallSite.test.ts` parses the
  file and fails on git's auto-merged version. Muse verified the carry.
- **#378, #380–#383, #385–#387** — each a merge of main with its port files
  equal to main and ratchets set from `--measure` on the merged tree (as-any:
  #378 → 1061, #381 → 1058; everything else at baseline). #382/#387
  migrate.mjs checked line-by-line against the merge base (both sides kept).
- **#379** — head 734c0f01 (merge of 14748ed7, as-any → 1062); draft, Muse
  marks ready. **#384** stays held until #379 merges (stacked; routes-elite-
  features.ts needs a semantic merge).
- **Package 4, canonical uuid ids (this branch).** The 14 parents and their 40
  child columns are uuid in shared/schema; KNOWN_DB_PUSH_MISMATCHES (38) is
  gone; `CONVERGE_UUID_ID_FAMILIES` in migrate.mjs converts a db:push-built
  database in place (no-op on prod). Evidence on 14748ed7: db:push of main vs
  this branch into scratch DBs differs in exactly 54 columns, all varchar →
  uuid (14 ids + 40 children), 738 tables / 656 FKs both sides; 0 of 648
  schema-declared FK columns mismatched; full suite 18,284 green with realdb.
  Refreshed onto post-train main bd35343b (2026-10-24): `npm run check` exit 0
  (no baseline moved), full suite 18,713 green, `db:build-from-repo` PASS on
  a fresh Postgres 16 with the 14 ids and the CAM trio's `lease_id` (cam_reconciliations,
  commercial_sales_reports, lease_rent_schedule) uuid with live FKs, and the
  convergence test 4/4 against real Postgres. The stale "STILL UNRESOLVED"
  note on the CAM block in migrate.mjs now records the resolution.

### Found, not fixed (needs a person)
- **npm's audit service is failing** (2026-10-22 ~02:35–03:20Z: 503, then 400
  "this endpoint is being retired. Use the bulk advisory endpoint"). npm
  Dependency Audit (and Security Gate with it) went red on #381, #382, #385;
  the same gate passes locally once npm answers. Needs "Re-run failed jobs" —
  this session's token gets 403.
- **The audit gate reads an audit that never ran as "0 vulnerabilities"**
  (`scripts/npm-audit-gate.mjs` never checks the report's error key). It went
  red tonight only because the accepted list is non-empty; with an empty list
  it would pass green over no scan. Security Gate then says "found critical
  vulnerabilities" when none were found. Proposed to Muse as its own PR.
- **drizzle-kit push exits 0 when a statement fails** — onto an unconverted
  varchar database ("cannot be cast automatically to type uuid"), and onto a
  database missing pgvector ("type vector does not exist"). Staging must
  converge through `migrate.mjs --ddl-only` (the nightly reconcile) before any
  manual db:push; noted in scripts/setup-staging.sh.

### Top next moves
1. Muse merges the refreshed train; re-check each remaining PR with
   `git merge-tree` after every merge, refresh only what conflicts.
2. After Package 4 merges, confirm the next staging-schema-reconcile run logs
   `OK: DO $uuid_ids$` and staging's 14 parents read uuid.
3. D1 (data sourcing: Regrid true cost, Florida bulk ETL, change-detection
   poller) — waits for Muse's spec.

## 2026-10-21 — Customer Journey Audit, next layer (issue #359), branch `claude/cj-journey-next-layer`

### What was wrong (each verified by running it locally against a production build)
- **One signup became several orgs.** A new user's first screen fires its
  queries in parallel and each reached `getOrCreateOrg` with no org: 5 orgs in
  23 ms for one user locally. `getOrganizationByOwner` had no ORDER BY, so an
  UPDATE (finishing onboarding) moved the resolved org and the next request
  landed in a fresh, un-onboarded one — /today bounced back into the wizard
  ("no first-value CTA"). The same race ran the signup rate limit once per
  request (5/email/hour), so a new user's own first page could 429 itself.
  Fixed: per-process coalescing + per-user advisory lock with re-check, and
  oldest-org resolution. Test: `tests/integration/orgProvisioningIsSingular.db.test.ts`.
- **"Transition was skipped" page errors**: `client/src/lib/view-transitions.ts`
  discarded the ViewTransition; skips now handled, real failures still
  reported once. Test: `tests/unit/viewTransitionSkipIsHandled.test.ts`.
- **The staging E2E token path was not exempt from the per-user rate limit**
  (the local flag always was): one synthetic user walking 9×2 viewports spent
  300/min and 429'd its own /today. `isE2eTestTraffic` now exempts both; never
  true in production (no token there). Test: `tests/unit/e2eTokenTrafficSkipsUserRateLimit.test.ts`.
- **Harness**: token now sent on every same-origin request (documents too —
  without it a document gets Clerk's handshake redirect), service workers
  blocked for CJ1 (SW-reissued /api requests lost the token), the consent
  banner is answered, and the config no longer leaks the token as
  `x-e2e-test-auth` to every origin.
- **A decorative gate found on the way**: CJ1's "clickwrap" check matched the
  cookie banner's "Privacy" text on bare /auth (sign-in, which has no
  clickwrap). It now opens `/auth?mode=register` and reads the ToS checkbox.

**Measured (local, production build, 12 Chromium projects, CI retries):**
before 2 expected / 6 flaky / 4 red (15 attempts "no first-value CTA", 6
click timeouts, 5 orgs for one user, 148 429s); after 12/12 passed on the
first attempt, 1 org, 0 429s, 0 page errors.

### Not verified here
- WebKit (iPhone projects): no WebKit build in this sandbox. The "composer
  missing on /ai" class is WebKit-only in CI; the next CI run is the check.

### Top next moves
1. Dispatch the audit on the branch; if iPhone stays red, read its
   error-context artifact before changing anything.
2. Count production users owning more than one org (counts only) — the race
   predates this fix; merging duplicates is a founder decision (customer data).
3. The consent banner covers the onboarding Continue button at 360 px — design call.

## 2026-10-21 — #386 amended to land-only (COO ruling under the founder's delegation)

- Land released; buy-and-hold is NOT. Its decision route
  (`server/routes-buy-and-hold-underwriting.ts`), page
  (`client/src/pages/rentals/underwrite-rental.tsx`), nav entry and spotlight
  module are removed from #386 and kept intact on
  `claude/buy-and-hold-underwriting` for a later PR gated on end-to-end journey
  evidence in the Readiness Atlas. The `rental_acquisition` engine stays as a
  calculator: it records nothing on its own, so buy-and-hold measures below
  `decided` and the demotion law requires its `beta` claim.
- `PUBLIC_CLAIM_DEMOTIONS` 11 → 12 entries (buy_and_hold restored); overclaim
  baseline 12 (main 13); ladder entry `surfaced`.

## 2026-10-20 — V0 vertical program re-applied (staged, not committed)

### Staged on `claude/recover-v0-vertical-program`
- Stranded commit `6f6c65f4` (V0: evidence rule v2, underwriting kit, land and
  buy-and-hold released) re-applied onto main. Its defects were renumbered
  because main had issued 0285–0288 meanwhile: 0285 → **DEFECT-0290**,
  0286 → **0291**, 0287 → **0292** (0289 reserved by another branch).
- One vertical rule, not two: `shared/governance/evidenceLadder.ts` no longer
  restates the OD-5 demotions by hand. Each vertical entry states one readiness
  tier and its claim/caveat derive from it; `verticalReadiness.test.ts` pins the
  ladder to the measured tier, the demotion map and the gradeable set
  (mutation-checked). Land and buy-and-hold now read "closes the canonical loop";
  subdivider carries "decided, not yet gradeable".
- New wall-clock reads from the stranded commit converted to `clock`.

**Measured:** targeted vitest 50 files (routeManifest run twice) / 776 test runs green; lint:reachability,
clock-reads, no-fabrication, boundaries, browser-safe-shared, org-fetch exit 0.
`npm run check`, the full suite and the build were NOT run (memory limits).

### Top next moves
1. Run `npm run check`, full `npm test` and `npm run build`, then an
   independent audit of the re-applied wave before committing.
2. DEFECT-0292 (acquisition-cost wording vs `total_cost`) is a founder-visible
   product choice.

## 2026-10-19 — Open Fieldstone items closed (Muse)

### Shipped to main
- **Company branding editor.** Settings → Organization now has a Company
  branding card: accent color (picker + hex, 6-digit validated), logo URL
  (absolute http(s), live preview), density (compact/comfortable/adaptive).
  Writes go through PATCH /api/tenant-theme (owner/admin only, enforced
  server-side); everyone else sees it read-only. Reset-to-defaults clears all
  three back to the theme. Test: `tests/unit/brandingEditor.test.ts`.
- **Accessibility prefs follow the person.** `/api/me/preferences` now accepts,
  validates, and deep-merges an `accessibility` blob (same JSONB column as
  appearance); the client hydrates from the server on login and debounced-PATCHes
  changes — the same pattern as appearance in theme-context.tsx. localStorage
  stays the fast-boot cache. The stale header comment about the non-existent
  `use-sync-accessibility-prefs` hook is corrected.
  Tests: `tests/unit/accessibilityPreferencesSync.test.ts` (15 tests).

**Measured:** new unit tests 15/15 green; appearanceContract + tenantKey
suites still green (56 tests); tsc clean on changed files.

### Top next moves

1. Then resume the 2026-10-18 list below (land the waiting branches; time to
   first deal; every paid action covers its cost).

## 2026-10-18 — Fieldstone redesign (`claude/fieldstone-redesign-q48nuj`)

### Built, on a branch with a draft PR, waiting for founder review

The approved Fieldstone redesign (founder decisions recorded in
`founder-decisions-2026-10-18-fieldstone.md`), implemented in the real app:

- **Three colorways, one product.** Fieldstone (default), Bedrock, Meridian ×
  Light / Dark / Match device, from one contract (`shared/appearance.ts`) read
  by both pickers, the boot script, the server and the gates. Retired themes
  migrate (Homestead → Bedrock, others → Fieldstone) with no customer row
  rewritten.
- **Appearance = Colorway + Display.** Font, density, motion and list-style
  pickers retired; Accessibility & comfort is its own section and owns reduced
  motion (the device setting is now honoured — it was being switched off).
- **One mark** across the app, auth, public pages and every installed icon /
  launch image (regenerated, reproducible from the manifest and index.html).
- **Fixed on the way** (each with a test that fails without the fix): undefined
  `--card-border` (every card outline was the text colour), `useIsMobile()`
  used as a boolean in four components, dialog close buttons dropped to the
  bottom, Today's section spacing lost on phones, the Map toolbar overlapping
  on phones, Finance's heading below its cards, the banner hidden under the
  rail, and — found by the independent review — the deploy-time migrator that
  would have deleted every Homestead user's choice on the next release.

**Measured:** `npm run check` exit 0; `npm test` and `npm run build` results are
in the PR. Real-app screenshots (production build, E2E test auth, seeded
fixture data) for all 6 colorway × mode combinations at desktop and iPhone,
plus 320px and tablet spot checks, are under `docs/design/fieldstone/`.

**Entry-chunk budget:** CI's Build job measured the entry chunk at 747 KB against
the 745 KB ceiling in `scripts/bundle-budget.json` (CI reads ~6 KB higher than a
local `NODE_ENV=production` build of the same tree, so `main` sits close to the
line there). The ceiling was not raised. The quick-appearance dialog now
lazy-loads its pickers, which takes the entry chunk below `main`'s own
(local: 755.0 KB on the branch, 756.2 KB on `main` at `e413ab6`).

**Not verified here:** the logged-out landing and sign-in pages (no real Clerk in
this environment — the public server answers the Clerk proxy's 502, and test
auth has no logged-out identity); real map imagery (no map key locally); real
Safari on an iPhone.

### Top next moves

1. **Founder review of the Fieldstone PR** — look at the screenshots, try the
   three colorways on the phone, then merge and run the manual deploy.
2. **Company branding editor.** Org accent/logo are applied safely now, but no
   UI sets them (only the API). Put a small editor under Settings → Organization.
3. **Accessibility prefs follow the person.** They live only in this browser;
   the sync hook the context's header mentions does not exist. Store them with
   the account like appearance.
4. Then resume the 2026-10-18 list below (land the waiting branches; time to
   first deal; every paid action covers its cost).

## 2026-10-18 (earlier sessions)

### Built, on branches, waiting for review and merge

| Branch | What it does |
|---|---|
| `claude/billing-entitlement-truth` | Seats: plans include their seats without support; add-on billing counts only seats past the included ones. One plan table. Included Pax turns charge no credits; past the allowance, purchased credits or an own key fund turns; background AI jobs follow the same rule. |
| `claude/lead-to-deal` | "Make this a deal" on a seller lead: creates or links the property and the deal in one transaction; idempotent; honest refusal when parcel facts are missing. |
| `claude/persona-vocabulary` | Deals and Finance use each persona's vocabulary; route hiding matches by path in every nav surface. |
| `claude/route-load-performance` | Map code loads only on Map; quick-add sheet loads on tap; build-graph gate. Mobile door pages download about 1–1.7 MB less JavaScript. |
| `claude/isolation-sweep-in-ci` | By-id isolation sweep runs in CI; the public log carries counts only; empty runs fail. |
| `claude/sim-followups` | Statement portal answers 503 when unconfigured; `phone_normalized` declared as the generated column it is in production. |
| `claude/declared-uniques-enforced` | Migration 0281 creates the 17 declared unique constraints idempotently (warn and skip, never fail a deploy); founder-org diagnostics on `/founder/readiness`. |
| `claude/house-mail-option` | Physical mail via AcreOS house mail (purchased credits only, priced above cost + card fees + margin) or the org's own Lob key. |

Each needs: an independent review, a merge of current `main`, then a PR.

### Remember

- Production deploys are manual now (Actions → "Deploy to Fly.io"). Merging
  to `main` does not change production.
- The 2026-10-17 repricing needs new Stripe prices and updated Fly secrets
  before checkout charges the new amounts.

### Top next moves

1. **Land the branches above** (review → merge main → PR → founder merges →
   manual deploy).
2. **Time to first deal.** Re-run `tests/simulation/campaign/lifecycle-90-days.ts`
   and remove each stall: new parcels start with `land_status` "unknown",
   which blocks offer letters; double-submitting "Add lead" in the browser can
   create duplicates; `/api/trial/status` reads wrong for a fresh org.
3. **Every paid action covers its cost.** Apply the house-mail rule (price ≥
   cost × card fees × margin, purchased credits, refuse unknown cost) to skip
   tracing and paid data lookups; add a founder view of margin by action.
4. **Close the remaining simulation findings:** the team list returns more
   than viewer roles need; 137 by-id routes the isolation sweep cannot probe
   yet; real (non-simulated) send credit charges are not exercised end to end.
5. **The unverified ground** (`docs/testing/verification-plans/`): real Safari
   on iPhone, Stripe test mode end to end, Twilio/SES/Lob sandboxes,
   backup-and-restore drill, load at 1,000 organizations.

### Waiting on the founder

- Current Lob prices for every mail spec (to confirm the house-mail cost table).
- Whether to unify the two house-mail price lists, once real Lob prices are in.

## 2026-10-20 — Lead imports keep the parcel facts (`claude/p4-csv-import-keeps-parcel-facts`, uncommitted)

### Built (working tree, not committed)
- **One parser module, every import path.** `shared/leads/parcelFacts.ts`
  reads ACREAGE, ASSESSED value (county), ESTIMATED value (market) and
  TAX-DELINQUENT status (flag, amount owed, years) — refuse-not-fabricate:
  "N/A" / blank / garbage / a county 0 are null, never 0; a positive amount or
  years count implies delinquent. Used by POST /api/leads/csv-import,
  POST /api/leads/import/tax-delinquent, importLeads() (POST /api/leads/import,
  /api/import/leads + its background job) and processTaxDelinquentImport();
  header rule shared by the Smart CSV sheet and the tax-delinquent importer.
- **Migration 0286** (+ migrate.mjs mirror): `leads.assessed_value`
  numeric(14,2), `tax_delinquent_amount` numeric(12,2), `tax_delinquent_years`
  integer. Assessed ≠ estimated, never one written into the other.
- **Lead detail Parcel card**: property address, APN/county, acreage,
  "Assessed value (county)" vs "Estimated value", tax delinquent / owed / years.
- **Fixed on the way:** the Smart CSV sheet's `parseCsv` stripped quotes before
  splitting cells, so any quoted comma ("$45,000", "SMITH, JOHN") split a cell
  and shifted the row.

**Measured:** new tests `leadImportKeepsParcelFacts` (44) +
`leadCsvImportParcelFacts` (8); 31 related files / 556 tests green; 12
mutations all red. Lints schema-migrate-mirror / schema / ghost-fields /
measurement-defaults / reachability / no-fabrication / org-fetch exit 0;
ratchet measure at baseline. NOT run: npm run check / tsc / full suite.

### Next
1. Run `npm run check` + full suite on a machine that can, then commit.
2. processTaxDelinquentImport() still has no production route
   (`/api/import/tax-delinquent` is named in a 404 hint but never mounted).
3. The synchronous `/api/import/:entityType` path ignores a `fieldMap` the
   job path honours (no client sends one today).
