<!-- 30-frontier-persona audit (workflow wf_7fa8a8e2-d93): 30 lenses over BOTH the elevated AcreOS kernel + the frozen Foundry repo; 139 insights; synthesis + adversarial critique (the ghost of the last strip-and-rebuild). 2026-06-24. VERDICT: ONE repo, extract-in-place, foundry frozen, do NOT work both repos at once now. -->

# The Elevated AcreOS Kernel — Frontier Roadmap

## 1. The New Frontier Standard, and the One Honest Verdict

**The frontier standard.** The bar we just cleared was *paramount governed autonomy*: a kernel that senses, decides through a budget-bounded Operator, acts through a fail-closed gate stack, measures real Stripe/SendGrid consequence, learns through a causal world-model, and contains itself with a panicStop and an out-of-reach kill. The new bar — the genius-tier ceiling grounded in real 2030 trajectories — is **provable governed autonomy that earns, reasons, and contains itself under adversarial load**: cognition is a small bounded *council* whose disagreement is a measured governance signal; the loop *plans* multi-step over its causal DAG and learns *off-policy* from the road not taken (counterfactual regret), not just on-policy from what it executed; every safety-floor invariant is a *machine-checked property* (fast-check + a small TLA+ corrigibility spec + a standing adversarial red-team in CI) so a violation cannot *start* rather than being caught after; calibration is a *hard blocking gate* (an action whose forecast is statistically unproven cannot fire unwitnessed); every witnessed action emits a *replayable, cause-allocable, prediction-sealed* ProofReceipt an outside party can re-derive offline; and the kernel is domain-agnostic *by construction* — a physical `packages/kernel` workspace whose boundary the module system forbids crossing, admitting packs by a machine-checked refinement proof, born multi-tenant-shaped while inert at N=1. Beyond *paramount*, the kernel does not merely restrain itself well — it **proves its restraint was correct, predicts its own consequences and is graded on them, and admits new verticals by a green test instead of a re-audit.**

**The verdict on working both repos at once: NO. Unambiguously no, and the elevated kernel makes the answer *more* certain, not less.** One repo. Extract the kernel in-place into a real `packages/kernel` + `packs/land` workspace inside the AcreOS monorepo. Keep frozen `foundry/` frozen and reference-only — a *spec quarry*, not a codebase to resurrect or refit. Do not stand up a second live application. The reasoning is brutal and it is on disk: `foundry/` is 94k LOC, 771 TS files, $0 revenue, never launched — it is the on-disk *proof* that you already ran the strip-and-rebuild experiment once. The elevated kernel does not change the foundry-decision's calculus; it *vindicates* it while raising the seduction, because a more-excellent kernel makes the premature-platform story sound investible. **The single most important fact in this entire document is one the synthesis half-buries:** AcreOS is pre-revenue, the brain is gated OFF, and the grep confirms `allocateByRoi`, `composeBoardReport`, and `queryIntervention` each have exactly one file — their own definition. They are dead code. The highest-leverage line in any 14-move plan is the one the plan never sequences first: **get one paying customer and let the loop close once on one real dollar moving an edge from prior→measured.** Everything below is a function over *resolved real consequences*, and AcreOS has produced exactly zero. Therefore this document does two things the source synthesis did not: it inverts the phase order so revenue precedes frontier, and it explicitly demotes every platform-scaffolding move behind the gate "the loop has closed once on real money."

---

## 2. Roadmap A — AcreOS Past the Bar

The moves are ranked by leverage as engineering artifacts, but **leverage rank is not build order** — build order is governed entirely by §5's revenue gate. Two moves (1 and the revenue-loop work) precede revenue; the other twelve are byproduct that *follows* it.

| # | Move | Beyond-the-bar property | Effort | Build phase |
|---|------|------------------------|--------|-------------|
| 1 | `packages/kernel` workspace + `resolveActivePack` | Domain-agnostic by construction | M | **Phase 0 (now)** |
| — | **Close one real causal-edge loop** | Operating, not deployed | S | **Phase 1 (the real first phase)** |
| 3 | Calibration as a hard gate + convergence-gated autonomy | Calibration is load-bearing, blocking | M | Phase 2 (post-revenue) |
| 2 | Off-policy evaluation + shadow/regret twin | Learn from the road not taken | L | Phase 2 |
| 4 | Replayable, prediction-sealed ProofReceipt + chain self-verify | The receipt becomes the product | M | Phase 2 |
| 12 | Exactly-once outward-effect spine + orphaned-effect reaper | No double-charge, no lost send | M | Phase 2 |
| 6 | Invariants-by-construction (fast-check + TLA+ + red-team) | Violations cannot start | M | Phase 2 |
| 7 | Multi-step planner + plan-repair commitment ledger | The loop plans, not just reacts | L | Phase 2 |
| 8 | Bounded cognition council with measured disagreement | Cognition is a society | L | Phase 3 (deferred) |
| 5 | Thread TenantScope through decision state + panicStop | Multi-tenant-shaped, inert | M | Phase 3 (deferred) |
| 9 | Poisoning-resistant pooled prior | The data-co-op moat, privacy-safe | M | Phase 3 (deferred) |
| 11 | `admitPack` refinement proof + pack-invariance test | Platform admitted by a proof | M | Phase 3 (deferred) |
| 13 | Delegable WitnessGrant + attention-as-budget exchange | Breaks the one-founder-tap ceiling | M | Phase 3 (deferred) |
| 10 | Constrained-exploration budget + loop-stability governor | A bounded-regret *season* | L | Phase 3 (deferred) |
| 14 | Governance evidence packet + offline verifier | The Foundry product, dogfooded | M | Phase 3 (deferred) |

### Move 1 — Carve `packages/kernel` as a real workspace + make the loop pack-generic

**Beyond the bar:** domain-agnosticism stops being a convention (the regex ratchet `scripts/check-kernel-boundary.mjs`) and becomes a *physical law of the module system* — the kernel `tsconfig` literally cannot resolve `packs/*`.
**Current state:** the kernel and the land vertical share one source tree; the boundary is a regex check. The loop hardcodes the pack in three places: `continuousLoop.ts:540-541`, `cognitionContext.ts:307`, `worldModelSnapshot.ts:65` all reach for `LAND_PACK` directly.
**What to build:** convert AcreOS to an npm workspace; move the ~22 `KERNEL_MANIFEST` modules into `packages/kernel` with a `tsconfig` that cannot resolve `packs/*`; `packs/land` becomes a dependent package; TS project references become the enforcer with `check-kernel-boundary.mjs` as belt-and-suspenders. **Critique-corrected scope:** the *test* of domain-agnosticism does not require the full carve. The minimum falsifiable move is the three call sites behind `resolveActivePack(scope)` plus a composition-root manifest forbidding any pack symbol outside the resolver — that is one day. The 22-module workspace carve is *hygiene*, worth doing, but it must not block the toy-pack smoke test (§Phase 3) and it is emphatically **not** "building both repos in parallel" — it is a one-day boundary-hardening of one repo. Pure refactor, zero behavior change, every test keeps gating.

### The unwritten Phase 1 — Close one real causal-edge loop

**Beyond the bar:** the difference between *deployed* and *operating*. `worldModelSnapshot` showing one edge that sharpened from a *real* consequence is the milestone Phase 4 of the source synthesis named but never sequenced. It is the true first phase.
**Current state:** the brain is gated OFF; there are zero resolved Stripe/SendGrid consequences because there are zero paying customers; `queryIntervention`/`allocateByRoi`/`composeBoardReport` are defined and never called in production.
**What to build:** nothing frontier. Ship the land vertical — `dealActions.ts` over the real `leads` pipeline — to first revenue; arm witnessed-send on *one* real outward action through the existing gate stack; let *one* resolved Stripe consequence sharpen *one* `worldModel.ts` edge and persist the trajectory to `autopilot_worldmodel_snapshots`. This is the cheapest line in the whole document and the only one that makes the other twelve mean anything. Everything after this gate is decorating a switched-off machine until this gate is green.

### Move 3 — Calibration as a hard gate + convergence-gated autonomy

**Beyond the bar:** calibration moves from a soft throttle to a *blocking* gate — an action whose forecast is statistically unproven literally cannot fire unwitnessed.
**Current state:** calibration in the autonomy logic influences promotion softly (per-domain, recency-weighted); a poorly-calibrated brain escalates more, but nothing *blocks*.
**What to build:** add a `CalibrationGate` to `policyGate`'s stack between budget and autonomy. An action requesting AUTO whose per-`(domain, actionClass)` calibration grade is over-confident or unproven is *downgraded to escalate* (forced witnessed), not blocked — the system still acts, but under a human witness. Gate autonomy *promotion* on causal-edge convergence (a flattened recent-confidence delta with measured evidence) rather than clean-cycle count. Persist calibration certificates into the receipt's `gateResults`; narrate "acting witnessed because its forecast is unproven" on `/founder/autopilot/story`. **Post-revenue only:** there is no calibration to grade until real outcomes exist.

### Move 2 — Off-policy evaluation + shadow/regret twin

**Beyond the bar:** the loop learns from the moves it did *not* take — the witnessed-send corpus of escalated/suppressed moves becomes training signal via a doubly-robust off-policy estimator, and the brain's *ranking* is graded, not just its executed action.
**Current state:** the loop learns only on-policy, from `efficacy.ts` Thompson updates on actions it executed.
**What to build:** persist per-tick a `ShadowRecord {chosenMove, deterministicFloorMove, suppressedMoves[], situationHash}` plus the play's selection propensity; when consequence resolves (keyed by `target_ref`), score both the taken path and a *clipped* doubly-robust counterfactual using `forecast.ts` as the reward model and `worldModel.predictMoveEffect` for the not-taken arm. Grade the ranking in a new `decisionRegret.ts` and feed it as the EV input to any proposed autonomy bump. Counterfactuals carry confidence and are *never displayed as outcomes*. **Critique-corrected sequencing:** this is the tell that off-policy is meaningless before revenue — you cannot estimate off-policy value when the on-policy dataset is empty. Hard-gated behind a non-trivial corpus of resolved consequences. Until then it is calibration-cosplay.

### Move 4 — Replayable, prediction-sealed, cause-allocable ProofReceipt + continuous chain self-verification

**Beyond the bar:** the receipt is no longer a record — it is a *replayable, externally re-derivable* artifact, the one thing no control-plane competitor can emit.
**Current state:** `proofReceipt.ts` + `proofReceiptStore.ts` emit a tamper-evident, hash-chained, principal-attributed, constitution-anchored receipt — but it is not replayable, the prediction is not sealed in, and the chain is not continuously self-verified.
**What to build:** fold a canonical `DecisionTrace` (considered moves, edge contributions, counterfactual delta, chosen EV, gate chain), the ex-ante `predictionClaim` (`successProb`, predicted `deltaPct`, `loopConfidence`), per-immutable verdicts, and the gate-decision/situation hashes **into the sealed receipt body** — covered by the existing sha256 seal, zero new crypto. Add `replayReceipt()` that deterministically re-runs the decision and asserts `argmax == chosen`; `resolvePrediction()` fired from the same Stripe/SendGrid webhooks; a worker job walking the chain each cycle re-deriving hashes and *auto-containing before paging* on any break; per-scope serialization via `pg_advisory_xact_lock` so the chain cannot fork. Surface a REPLAY-VERIFIED badge on `/founder/autopilot/story`. KMS-signing, Merkle-anchoring, and ZK stay **explicitly deferred** until a buyer names data-blind verification as the reason they'll pay.

### Move 12 — Exactly-once outward-effect spine + orphaned-effect reaper

**Beyond the bar:** an outward effect fires exactly once even across crashes, retries, and provider timeouts — no double Stripe charge, no lost SendGrid send, with a reaper that reconciles ground truth from the provider.
**Current state:** witnessed-send executes hands; there is no provider-native idempotency key threaded end-to-end and no reaper for stuck dispatches.
**What to build:** add a deterministic `dedupKey` to `HandContext` (= the `contentHash`, already a sha256 of frozen args) threaded as the provider-native idempotency key (Stripe/SendGrid), plus an `outbound_effects(scope, hand, dedup_key UNIQUE, result, status)` reservation written in the *same transaction* that flips `approved→executed`, replaying the cached receipt on duplicate. Add `reapStaleDispatches()`: lease-expiry on `in_progress` dispatches and stuck `approved` hands → query the provider by `dedupKey` for ground truth → write the true terminal state + emit the deferred receipt. Mine Foundry's `idempotency.ts`/`gateway.ts` as the *spec*; implement the corrected, scope-keyed version once in the kernel.

### Move 6 — Invariants by construction (fast-check + TLA+ + standing red-team)

**Beyond the bar:** the broadcast-laundering and un-witnessed-money holes were *found*, not foreseen. This institutionalizes finding the *next* class — a violation cannot *start* rather than being caught after.
**Current state:** the safety floor is enforced by example-based unit tests.
**What to build:** state the floor as universally-quantified fast-check properties (risk-only-tightens, unknown=maximally-risky, malformed-scope hard-errors *before any side-effect*, net-new=witnessed, broadcast=escalate, over-confident=promotion-held) promoted to a CI ratchet; write a ~150–250 line PlusCal/TLA+ spec of the gate-stack/trust-ladder/panicStop state machine, model-checked in CI with a TS trace-conformance test; stand up a generative adversarial red-team (property-based + a prompt-injection corpus against the Operator briefing) that fails the build if any invariant can be violated. Add the gate-stack fault matrix (every gate × every fault × every scope × known/unknown move) as a pure unit test. **Critique-honest caveat:** the TLA+ spec is genuine frontier hygiene but has near-zero N=1 *revenue* payoff — it is justified as a one-time correctness proof of code that is already written, not as a precondition to first dollar. Build it in Phase 2 as insurance on the body that earns, not before the body earns.

### Move 7 — Multi-step planner over the causal model + plan-repair commitment ledger

**Beyond the bar:** the jump from a well-gated bandit to a planner that reasons across the real 4–9-month land funnel.
**Current state:** the loop selects greedily, one move at a time; `queryIntervention`/`predictMoveEffect` are wired only as a within-tier EV/$ tiebreak (and `queryIntervention` is otherwise dead code).
**What to build:** add `planner.ts` — a *pure* depth-bounded expectimax/MCTS `planSequence` over `queryIntervention` (edge confidence = transition prob, `forecast.successProb` = action prior, leaf = predicted delta × path-confidence) that chooses the first move of the highest-EV *plan*, re-ordering only the discretionary tier (mandatory tier untouched; net-new still escalates). Persist committed plans (`autopilot_plans`, scope-keyed) and each tick CONTINUE/REPAIR/ABANDON against fresh senses with a recorded reason on `/story`. Wire the dead `allocateByRoi` into the EV leaf-value — this is also how that dead module finally acquires a production caller. Speculative plans labelled, never asserted.

### Moves 8, 5, 9, 11, 13, 10, 14 — Phase 3, gated, deferred

These are the bounded **council** (`operator.ts` → `CouncilMember[]` with `reconcileCouncil()` feeding disagreement into `riskautonomy.ts`); **TenantScope** through `domain_autonomy_levels` re-keyed to `(scope, domain)`, snapshots, and a scope-aware `panicStop` with a single global `correlatedFailureBreaker`; the **poisoning-resistant pooled prior** (per-tenant contribution cap, k-anonymity floor, robust aggregation, consent gate ported as a spec from Foundry's `hasConsent`, calibration-weighted contribution); **`admitPack`** refinement proof + pack-invariance property test + conformance scaffolder; the delegable **`WitnessGrant`** + attention-as-budget exchange (breaks the one-founder-tap ceiling); the **constrained-exploration budget** + loop-stability governor; and the **GovernanceEvidencePacket** + offline `verify-bundle.mjs` + `controlCatalog.ts`.

Every one of these is technically excellent and every one is **deferred behind the revenue gate** for the reason §4 makes explicit: their justification reduces to "for pack #2 / for tenant #2," which by the foundry-decision's own Phase 4 gate does not yet exist. Moves 8, 5, 9, 11, 13 in particular are the moves the critique correctly flags as premature platform scaffolding. They are documented here so the path is charted — not scheduled before a dollar.

---

## 3. Roadmap B — The Parallel AcreOS + Foundry Build

### Repo topology — decisive

**ONE repo. Extract the kernel in-place into a real `packages/kernel` + `packs/land` workspace inside the AcreOS monorepo**, with the kernel⊥pack boundary enforced by the module system (TS project references) and `check-kernel-boundary.mjs` as belt-and-suspenders.

- **Do NOT** create a second repo.
- **Do NOT** resurrect or refit frozen `foundry/`. Keep it frozen and reference-only, mined as a *spec quarry* — its tool-gateway four pre-flight checks (kill-switch / classification / communication-budget / idempotency), its `idempotency.ts` dedup, its consent gate, and its 12-agent / Gate-0-4 taxonomy are genuinely good *designs*. Re-implement the corrected versions on the kernel's superior primitives. **Read three files, write three corrected kernel additions, import zero lines, run nothing.**
- **Do NOT** publish a kernel SDK now — Foundry's own `packages/foundry-sdk` stub is the ghost of exactly that mistake (distribution before base).
- **"Foundry" is NOT a repo and NOT an application.** It is the *name* for two things: (a) the governance *product* — priced proof-receipt + offline verifier + evidence packet — the running kernel emits as a byproduct, and (b) the eventual *second* `packs/<vertical>` in the same monorepo.

### The phase plan (critique-inverted)

The source synthesis ordered Phase 1 as "ship the frontier kernel." The critique is right: that buries the revenue loop and funds the second-system trap under the word "inert." The corrected order:

**Phase 0 — Seam made physical, cheaply (now, pure refactor):** kill the three hardcoded `LAND_PACK` call sites behind `resolveActivePack(scope)` + a composition-root manifest. ~1 day. The full `packages/kernel` workspace carve is hygiene that may follow but must not block. This is the foundry-decision's own un-done "one move" and the *only* thing that makes a foreign pack runnable at all.

**Phase 1 — Close one real loop (the true first phase):** ship `dealActions` → first revenue; arm witnessed-send on one real outward action; let one resolved Stripe consequence sharpen one `worldModel` edge. The milestone is `worldModelSnapshot` showing one edge moving prior→measured from a *real* dollar. Until this is green, every frontier move is decorating a switched-off machine.

**Phase 2 — Frontier kernel, as the reward for a closed loop (post-revenue):** moves 3, 2, 4, 12, 6, 7. Each is pure-kernel, sits in `KERNEL_MANIFEST` behind the ratchet, makes AcreOS more capable as a byproduct, and — critically — is now *trainable and testable* because real consequences exist. "Build both in parallel" is satisfied here: the kernel getting more advanced *is* the platform getting more capable; there is no second codebase.

**Phase 3 — Prove the platform claim with a TEST, not a product:** author `packs/_smoke` — a deliberately-foreign ~5-variable toy pack (self-storage / freight-broker; same reversible/illiquid/document-heavy band) — and run the full decide→gate→act→measure path on the *unchanged* kernel with the founder *not* in the loop. **Instrument it: count every kernel edit it forces.** Each edit is a sized kernel-generalization debt; zero edits = the seam is real and the platform option is in-the-money. Run every Phase-2 capability against *both* packs in one test suite. ~2 engineer-days, deletable in an afternoon. This is the *entire* legitimate "parallel build" — one kernel proven against two packs in one repo.

**Phase 4 — Platformize ONLY as the reward for winning (gated, not now):** a real second vertical is funded only when **all** hold: (a) AcreOS reaches first real revenue *and* the loop has closed once on a real causal edge (the Phase-1 milestone), (b) the foreign toy pack passes conformance + `admitPack` on the unchanged kernel, and (c) a real foreign buyer *pulls* for the governance product. Even then it is a `packs/<vertical>` in the same monorepo plus at most a published `packages/proof-verifier` — never a second application, never a speculative multi-tenant runtime. KMS-signing, Merkle-anchoring, and ZK stay deferred until a buyer names data-blind verification as the reason they'll pay.

### Milestone gates governing when Foundry work may start

| Gate | Condition | Unlocks |
|------|-----------|---------|
| G0 | `resolveActivePack` lands, all tests green | Phase 3 toy-pack test is *possible* |
| G1 | First real revenue + one edge sharpened from a real Stripe consequence (`worldModelSnapshot`) | Phase 2 frontier moves are *meaningful* |
| G2 | Toy pack passes on unchanged kernel, kernel-edit count = 0 | Platform option is in-the-money |
| G3 | A real foreign buyer pulls for the governance product | Phase 4 second vertical is funded |

No Foundry work — beyond the ~2-day in-repo toy-pack smoke test — is allowed before **G1 and G2 and G3** all hold.

---

## 4. Blind Spots (folded in honestly from the critique)

1. **The dead-code disease is already present and the plan buries it.** `allocateByRoi`, `composeBoardReport`, `queryIntervention` have exactly one file each — their own definition. `seedGrowthObjectives` and `predictMoveEffect` have one real external caller. Adding thirteen modules to a system whose existing intelligence modules are dead code is the failure mode, not the fix. **Mitigation baked into this roadmap:** move 7 is the production caller `allocateByRoi` and `queryIntervention` have been waiting for; no new module ships in Phase 2 without a named production caller in the same PR.

2. **The frontier standard optimizes the wrong loss function for a pre-revenue product.** TLA+, doubly-robust counterfactual regret, conservative-bandit LCB budgets, ZK, Merkle, KMS, an "insurable actuarial asset" — none moves a dollar of first revenue, and there is no customer to govern autonomy for. The brain is gated OFF. **Mitigation:** every one of these is demoted behind G1; the document now names the revenue loop as the true Phase 1.

3. **Off-policy learning cannot be trained before revenue.** You cannot learn from "the moves not taken" when the on-policy dataset is empty — zero resolved consequences. Move 2 is calibration-cosplay until real Stripe/SendGrid events exist. **Mitigation:** hard-gated behind a non-trivial resolved-consequence corpus.

4. **"Inert / cheap-now insurance against a retrofit" is the exact rationalization that built foundry's 94k LOC.** The retrofit cost is speculative and deferred; the build cost is real and immediate; at N=1 with zero customers you'd pay 100% of a cost to hedge a ~0%-before-you're-dead risk. Inert code is not free — it is surface area every refactor preserves, every invariant test covers, every reviewer must understand. **Mitigation:** moves 5, 9, 11, 13 (the TenantScope/pool/admitPack/WitnessGrant cluster) are moved out of "Phase 2 now" and into Phase 3-deferred behind the revenue gate. The seam (move 1) is kept because it is one day and is the falsifiable *test* of domain-agnosticism — not the multi-tenant runtime.

5. **The council triples LLM cost against a $50/mo cap to add nuance to a brain with nothing real to be nuanced about.** Elegant, seductive, premature. **Mitigation:** move 8 is Phase 3, OBSERVE-first, council size 2 then 3, behind `isCognitionEnabled` and the shared `CognitionBudget` wrap — and only after the brain has real outcomes worth deliberating over.

6. **The elevated kernel makes the second-system trap *more* seductive, not less.** A more-excellent kernel makes premature platformization sound investible. The frozen 94k-LOC repo is the same failure mode in better clothes. **This is the load-bearing honesty of the document:** the elevation vindicates the foundry-decision; it does not loosen it.

---

## 5. Dependency-Ordered Sequencing Across Both Roadmaps

```
Phase 0 (now, ~1–2 days, pre-revenue)
  └─ Move 1a: resolveActivePack(scope) + composition-root manifest   [unlocks G0]
     (Move 1b: full packages/kernel workspace carve — hygiene, non-blocking)

Phase 1 (THE FIRST REAL PHASE, pre→first revenue)
  └─ dealActions → first dollar
     └─ witnessed-send on one real outward action
        └─ one resolved Stripe consequence → one sharpened worldModel edge
           └─ worldModelSnapshot shows prior→measured                  [unlocks G1]

Phase 2 (post-G1, frontier kernel as reward — each PR ships its own production caller)
  ├─ Move 3  CalibrationGate + convergence-gated autonomy   (needs real outcomes)
  ├─ Move 4  prediction-sealed replayable receipt + chain self-verify
  ├─ Move 12 exactly-once effect spine + reaper             (independent; can parallel 4)
  ├─ Move 6  fast-check floor + TLA+ + red-team             (independent; correctness insurance)
  ├─ Move 2  off-policy / regret twin   (needs Move 4's DecisionTrace + a consequence corpus)
  └─ Move 7  planner + plan-repair      (needs queryIntervention live; wires dead allocateByRoi)

Phase 3 (post-G1, prove the platform with a TEST)
  └─ packs/_smoke toy pack on unchanged kernel, founder not in loop
     └─ count kernel edits forced; run Phase-2 caps against both packs   [unlocks G2]

Phase 3-deferred platform scaffolding (ONLY after G2; still no second app)
  ├─ Move 5  TenantScope through decision state + scoped panicStop
  ├─ Move 11 admitPack proof + pack-invariance test + conformance suite
  ├─ Move 9  poisoning-resistant pooled prior
  ├─ Move 13 delegable WitnessGrant + attention exchange
  ├─ Move 8  bounded council (OBSERVE-first, behind isCognitionEnabled)
  ├─ Move 10 constrained-exploration budget + loop-stability governor
  └─ Move 14 GovernanceEvidencePacket + offline verifier + controlCatalog (dogfood on AcreOS)

Phase 4 (post-G1 ∧ G2 ∧ G3 — the platform is the reward for winning)
  └─ first real packs/<vertical> + at most a published packages/proof-verifier
```

The critical path to value is short and contains **no frontier move**: Move 1a → first revenue → one closed loop. Everything else follows that gate.

---

## 6. The Sacred Invariants Preserved Throughout

These hold at every phase, under every refactor, in every pack, and no move above is permitted to weaken them:

1. **Honesty is sacred.** No fabricated numbers anywhere. Attribution is always a *lower bound*; absence is never failure. Counterfactuals (move 2) carry confidence and are **never displayed as outcomes**. Pooling (move 9) moves only the *prior*, never a displayed track record or attribution lower-bound.
2. **The brain never bypasses the safety floor.** The deterministic reflex floor is untouched by the council (move 8 reconciles *above* it), by the planner (move 7 re-orders only the discretionary tier; mandatory tier untouched), and by every pack.
3. **Fail closed, always.** Every gate fails closed on throw/hang/malformed. Unknown actions are maximally-risky by default. Malformed scope hard-errors *before any side-effect*. An invalid pack fails closed (`admitPack`).
4. **Net-new is witnessed; broadcast escalates; irreversible/novel/over-ceiling can never be policy-witnessed.** The Operator/council proposes; the body forces witnessed-send. `panicStop` voids all live `WitnessGrant`s atomically.
5. **Risk only tightens; autonomy is earned on resolved outcome, never on execution; pending banks nothing.** Promotion is convergence-gated; a poorly-calibrated brain escalates *more*.
6. **Containment precedes paging.** Drift → auto-contain-before-page. Chain-break → auto-contain-before-page. The out-of-reach env kill the agent cannot write remains out of reach. The global correlated-failure breaker is the *only* global detector.
7. **The kernel⊥pack boundary is machine-enforced.** The kernel imports no pack — module system first, ratchet second. The land vertical lives only in `packs/land/*`. Every tenant-scoped surface is born multi-tenant-shaped and inert at N=1, lit unchanged at tenant #2 — but **not built before the revenue gate**.
8. **Every witnessed action emits a valid, hash-chained, constitution-anchored ProofReceipt** — a branded-type bijection, not a convention. The chain self-verifies continuously and cannot fork (per-scope advisory lock).

The kernel's excellence is the *reward* for winning, never the *strategy* for avoiding the win. Ship the land vertical to the first real dollar; let the loop close once on one real consequence; then — and only then — let the frontier compound.