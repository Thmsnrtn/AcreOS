# 04 — Service Sprawl (solene / autopilot)

*Slice 04. Read-only. Region: `server/services/` (991 files / 366K lines), deep-dive on `services/solene/` (49.7K) and `services/autopilot/` (19K).*

**State of the region.** The autonomous-agent subsystem is mostly **LIVE**, not scaffolding: the solene engine runs off the worker's scheduled jobs (`runContinuousTick` every 30 min, dynamically imported at `runScheduledJobs.ts:2697`), `dispatchRunner`/`dispatchQueue` are worker entrypoints, `dispatchToolExecutor` (1,744 lines) fans into the reasoning modules (`speculations`, `counterfactuals`, `evidenceWeights`, `decisionTraces`, `capabilityDiscovery`…), and autopilot's immune/hands chains are wired through the worker and mounted `/founder/*` routes. The scaffolding is a real but **minority** residue.

**The single defect class that survives every gate here:** *test-only modules absorbed into the reachability ratchet's tolerated baseline of 655 unreached exports.* The reachability lint **sees** these (an export whose only consumer is its own test is UNREACHED — lint header lines 35–36), but the ratchet is a down-only baseline, not a hard gate, so ~2,064 lines of dead solene service code sit inside the 655 pool, unadjudicated by the deletion-ledger, passing CI green. Two structural blind spots make the true number higher than 655: dynamic imports render a module **opaque** (exempt), and the lint is **one-hop** (a production consumer counts even if that consumer is itself only test-reached).

---

### F-04-1 — Seven test-only solene service modules (~2,064 lines) are dead, unadjudicated, and hidden in the reachability baseline
**Severity:** P2 real
**Surfaced by:** slice 04
**Survives which gates:** `lint:reachability` *counts* each as an unreached export (header lines 35–36: "an export whose ONLY consumer is its own test file is UNREACHED") but only ratchets against baseline `unreachedExports: 655` (`scripts/ratchets/reachability.json`) — it never fails on membership, only on the aggregate rising. `tsc`/tests pass because each has a live-looking `.test.ts`. Neither the deletion-ledger nor defect-registry adjudicates them (grep: NONE).
**Evidence:** Each module's *only* importer (any path, quotes-anchored) is its own test:
- `solene/adversarialTests.ts` (422) → `adversarialTests.test.ts` only
- `solene/distributedReasoning.ts` (417) → `distributedReasoning.test.ts` only
- `solene/founderBypass.ts` (331) → `founderBypass.test.ts` only (the `founderBypass` word in `credits.ts:90`/`routes-transparency.ts:53` is an unrelated boolean flag/count, not this module)
- `solene/timeAwareDecisions.ts` (322) → `timeAwareDecisions.test.ts` only
- `solene/planProposals.ts` (308) → `planProposals.test.ts` only (the live `routes-plan-proposals.ts` imports the *table* `@shared/schema/solene-plan-proposals`, not this service)
- `solene/sessionTaskStore.ts` (203) → `sessionTaskStore.test.ts` only
- `solene/chat/ceoQuestions.ts` (61) → **zero** importers, not even a test

Confirmed no dynamic/string references (`grep -rln <name>` excluding self+test = NONE for six; only the false-positive-word cases above).
**What's wrong:** Real service modules (6–12 exports each) with a passing test suite but no production call site. They are the exact `services/lateFees` / `calculateFlipAnalysis` class the reachability ratchet was built to kill, surviving only because the ratchet tolerates a 655-deep backlog rather than failing on membership.
**Impact:** Neither (does not block the first sale or burn trust) — but it is the highest-yield deletion input in the region for the ≤600K-LOC campaign: ~2,064 verified-dead lines with no downstream, deletable in one commit that also lowers the baseline.
**Fix:** `rm` all seven modules + their tests; lower `reachability.json.unreachedExports` from 655 by the freed export count in the same commit (the ratchet's own "cheapest way to satisfy this gate is deletion" north star). Record KILL rows in the deletion-ledger first.
**Gate it:** Already gated by `lint:reachability` — but change the *policy*: these should never have entered the baseline. Add a sub-rule that a NEW test-only service module (test authored in the same commit as the module, zero prod importer) fails hard rather than incrementing the tolerated count. Baseline today: `unreachedExports 655`.
**Effort:** S
**Blast radius:** 14 files (7 modules + 7 tests), one ratchet JSON, two ledger rows.
**Confidence:** high — quote-anchored import grep + dynamic-ref grep + ledger grep all agree.

---

### F-04-2 — Reachability lint is one-hop and dynamic-import-opaque, so scaffolding islands and dynamically-loaded modules are structurally invisible to the gate
**Severity:** P2 real
**Surfaced by:** slice 04
**Survives which gates:** This IS the gate's own documented boundary. `lint-reachability.mjs` header lines 71–73: "Dynamic imports … make the module OPAQUE: every export … is reported as opaque … and is NOT counted as unreached." It also cross-references a symbol against *any* production file (line 35) without asking whether that consumer is itself reached — a one-hop check, not transitive from an entrypoint.
**Evidence:** The solene engine is reached ONLY via dynamic import: `runScheduledJobs.ts:2697` `const { runContinuousTick } = await import('../services/solene/continuousLoop')`. Under the opacity rule, every export of `continuousLoop.ts` (1,651 lines) is exempt from the unreached count regardless of real use. Separately, dead leaf modules `founderBypass.ts`/`planProposals.ts`/`adversarialTests.ts` themselves *import* the live `dispatchQueue.ts` — the edge direction means importing a live module does not make a dead consumer visible, but the inverse hazard holds: a cluster whose sole entry is a test would count every internal module as "reached."
**What's wrong:** The repo's best gate (per orientation) has two blind spots that exactly cover this subsystem's wiring style (dynamic worker imports + deep intra-package graphs). A module dynamically imported *only from a test* would be counted as opaque-exempt, i.e. fully invisible — the strongest evasion path.
**Impact:** Neither directly — but it bounds how much the deletion campaign can trust the 655 number. The true dead-export count in `services/` is ≥655; the gap is unmeasured.
**Fix:** (1) For opacity, record dynamic-import *sites* and, if the only site is a test file, treat the target as unreached rather than opaque. (2) Add a transitive pass: seed from real entrypoints (`server/index.ts`, `server/worker.ts`, mounted routers, registered jobs) and mark unreachable islands, reported as a fourth count.
**Gate it:** Extend `lint-reachability.mjs` with a `transitively-unreached` count + baseline; keep it down-only like the others. No baseline yet (new count).
**Effort:** M
**Blast radius:** one lint script + one ratchet JSON; report-only, no code deletion required to land.
**Confidence:** high for the mechanism (lint self-documents both blind spots); medium for the magnitude (I did not build the transitive pass to quantify the hidden island count).

---

### F-04-3 — `routes-plan-proposals.ts` carries a stale "NOT yet wired" TODO while the route is in fact mounted, and its 308-line service twin is dead
**Severity:** P3 minor
**Surfaced by:** slice 04
**Survives which gates:** No gate reads TODO comments. `lint:reachability`'s `unregisteredRoutes` count (baseline 1) does not flag this route because it *is* registered — the comment lies in the safe direction (says unwired, is wired), so nothing trips.
**Evidence:** `routes-plan-proposals.ts:13` header: "TODO(solene-cron-wiring): registerPlanProposalRoutes(app) is NOT yet wired in server/routes.ts because routes.ts is frozen this wave." But `routes.ts:261` imports it and `routes.ts:2408` calls `registerPlanProposalRoutes(app)`. The route reimplements table access directly (`import { planProposals } from "@shared/schema/solene-plan-proposals"` at line 41; own `db.insert/select`), bypassing the dead `solene/planProposals.ts` service (F-04-1).
**What's wrong:** Documentation drift plus a near-duplicate: the feature exists twice — a live route that hand-rolls table queries and a dead service module that also hand-rolls them. Stale "not wired" comments are the wave-discipline failure CLAUDE.md warns about (an agent reporting on the part it built, blind to the neighbor).
**Impact:** Neither — but it is a trust-eroding signal for any operator reading the file to understand plan-proposal flow.
**Fix:** Delete the stale TODO block; delete `solene/planProposals.ts` under F-04-1; if any shared query logic is worth keeping, hoist it into the route or a thin repo function — do not resurrect the service.
**Gate it:** none possible for stale prose comments beyond code review; the near-duplicate half is covered by F-04-1's reachability policy.
**Effort:** S
**Blast radius:** 1 route file comment + the F-04-1 deletion.
**Confidence:** high — mount site and comment both read directly.

---

### F-04-4 — Autopilot is 108 production files but only 6 test files (944 lines), inverting solene's ratio — a large ungated actuator surface
**Severity:** P2 real
**Surfaced by:** slice 04
**Survives which gates:** No gate measures test-coverage ratio per package. The reachability ratchet confirms autopilot has **zero** one-hop-dead modules (good), but "reached" ≠ "tested." `services/autopilot` = 108 prod files / 18,048 lines with 6 test files; `services/solene` = 54 prod / 26,657 lines with 43 test files / 23,046 lines.
**Evidence:** `find server/services/autopilot -name '*.ts' ! -name '*.test.ts' | wc -l` = 108; `-name '*.test.ts' | wc -l` = 6. The untested surface includes actuators: `hands/apply-refund.ts`, `hands/dunning-action.ts`, `hands/run-ad-campaign.ts`, `hands/send-email.ts`, `adProviders/metaAdProvider.ts` (creates real, paused Meta campaigns on a linked connection per `hands/index.ts`).
**What's wrong:** The money/broadcast actuators live behind a boot-time witnessed-send invariant in `hands/registry.ts` (`requiresWitnessByInvariant`, throws on registration) — a genuinely strong structural guard. But the surrounding 108-file orchestration (planners, ladders, packs, governors) that *decides* what to hand off is almost entirely untested relative to its size.
**Impact:** Burns trust after sale — if the autopilot narrates or acts on a mis-planned step for the first real customer, there is little test scaffolding to have caught it. The witnessed-send wall limits blast radius to founder-approved actions, which is why this is P2 not P0.
**Fix:** Prioritize characterization tests for the actuator-adjacent planners (`act.ts`, `decide.ts`, `deliberate.ts`, `policyGate.ts`, `dealActions.ts`) before onboarding the first customer whose data they touch. Do not test the whole 108 — test the decide→hand boundary.
**Gate it:** A per-package `test-file-to-prod-file` floor ratchet (direction: up) scoped to `services/autopilot`. Measured baseline today: 6 test / 108 prod = 0.056.
**Effort:** L (writing the tests); S (the ratchet).
**Blast radius:** `services/autopilot/**`.
**Confidence:** medium — the counts are exact; "untested = risky" is an inference, and the witnessed-send invariant genuinely caps the downside.

---

## Coverage ledger

**Examined exhaustively:**
- Full file listing + line counts of `services/solene/` (97 files) and `services/autopilot/` (114 files).
- External (non-self, non-test) importer sets for both packages (`grep -rln services/solene|services/autopilot`).
- Per-module quote-anchored importer counts for every candidate orphan; the 7 confirmed-dead solene modules re-verified against ALL importers incl. tests + dynamic/string refs + ledger + defect-registry.
- Reachability lint mechanism (`scripts/lint-reachability.mjs` header + entrypoint logic, lines 1–246) and its ratchet baselines (`scripts/ratchets/reachability.json`, all four counts + allowlist + bump notes).
- Wiring of the live spine: `continuousLoop` (dynamic worker import), `dispatchRunner`/`dispatchQueue`/`dispatchToolExecutor`, `hands/registry.ts` + `hands/index.ts` barrel side-effect registration, `immuneResponse` chain, `council→deliberate→continuousLoop`.
- Near-duplicate candidate pairs: immuneSystem/immuneResponse (NOT dup — plan vs wire), claimsEngine/claimsGate (NOT dup — layered), constitutionalGuard/preCallConstitutionalChecker (NOT dup — downstream vs upstream), planProposals service vs route (IS a dead twin, F-04-3).

**Examined by sampling:**
- The 108 autopilot prod modules: verified reachability at one hop for a representative set (immuneResponse, admitPack, claimsGate/Engine, council, deliberate, hands/*, domainPack, activePack); did not open every one.
- Content of the 7 dead modules read only at header + export-count granularity, not line-by-line.

**Did NOT examine:**
- The other ~880 files of `services/` outside solene/autopilot (pax, iris, soren, krieger, contracts, providers, improvement, governance, mail, etc.) beyond incidental cross-references — other dimension slices own those.
- Whether the `solene-plan-proposals` / other solene schema tables have live writers (schema slice 05's charge).
- Runtime behavior — this is a static-reachability audit; I did not execute the worker or observe a real tick.
- A full transitive-reachability computation (proposed in F-04-2 as the fix, not run here), so the true count of scaffolding islands beyond the 7 confirmed dead leaves is unquantified.

## Constitution Collisions

None. The witnessed-send + hard-stop invariants in `services/autopilot/hands/registry.ts` (boot-throw on money/broadcast/customer-facing/`matchHardStopHand`) actively *enforce* the constitution's "hard-stops stay founder-only" and "be the rail" rulings rather than colliding with them. No finding proposes a new nav entry, AI destination, or money-custody change. The recommended deletions (F-04-1) remove agent-scaffolding that no constitutional KEEP verdict protects (deletion-ledger KEEPs cover `routes-solene-*.ts` and Rosy River, none of the 7 dead modules).
