# NEXT_UP — read this first

**Purpose:** a fresh Claude session should be able to read this one file and
continue the canonical-architecture program without re-planning anything.

**Last updated:** 2026-08-12 · branch `claude/acreos-canonical-implementation-1asgvc`

---

## 1. What is the governing architecture?

`shared/architecture/canon.ts` — **the machine-readable canonical architecture.**
Read it before anything else. It holds the Master Audit's seven authoritative
layers, the nine-stage canonical loop, the fifteen constitutional laws, the
minimum canonical object set mapped onto this repo's real tables, and the twelve
architecture fitness functions with what enforces each one.

It is not prose. `tests/unit/canonicalArchitecture.test.ts` verifies every table
it names really exists in the Drizzle schema and every enforcement ref really is
a file on disk, and holds two ratchets that may only shrink.

Precedence, in order:

1. Safety, security, tenant isolation, data integrity, founder hard stops.
2. **The live repo at HEAD** for facts about what exists.
3. `CLAUDE.md` + `shared/governance/constitution.ts` (founder business decisions).
4. `shared/architecture/canon.ts` (architectural law, from Master Audit BI/BL).
5. Earlier Master Audit appendices, for rationale.

The audit was written against a **public GitHub snapshot**, so several of its
factual claims about this repo are already false. Verify before implementing —
see §6.

## 2. Where the program stands

| Canonical object | Status at HEAD | Where |
|---|---|---|
| organization, user, deal, workflow-run | canonical | pre-existing |
| **evidence-claim** | **canonical** ✅ | `evidence_claims`, this program |
| **decision-snapshot** | **canonical** ✅ | `decision_snapshots`, this program |
| property, parcel, document | conflated | `properties` god table |
| **outcome** | **canonical** ✅ | `outcomes`, this program |
| party, holding, instrument, plan, action-receipt | role-table | scattered |
| **scenario** | **canonical** ✅ | `scenarios`, this program |
| relationship, opportunity | absent | — |

**8 of 18 canonical objects now have a canonical home (was 4).**

Two ratchets track convergence, both down-only, both in
`tests/unit/canonicalArchitecture.test.ts`:

- `UNENFORCED_FITNESS_BASELINE = 0` (was 2) — **every fitness function now has automated enforcement**
- `OBJECTS_WITHOUT_CANONICAL_HOME_BASELINE = 10` (was 14)

## 3. What has been completed, and what proves it

See `EXECUTION_LEDGER.md` for the full record. Summary:

1. **Canonical architecture registry** (`9034306`) — canon.ts + 18-test ratchet.
2. **Evidence Fabric** (`7b80e76`) — `evidence_claims` (append-only) + pure
   deterministic resolution policy + provider anti-corruption adapter + lineage
   API. 37 tests. Makes laws 2, 3 and 6 satisfiable.
3. **Decision Memory** (`c863bf1`) — `decision_snapshots` (immutable) + freeze
   function + API. 18 tests, the central one mutating evidence underneath a
   recorded decision and asserting it does not change meaning.
4. **Infrastructure restraint gate** — BI152's New Database Test made
   checkable, inside `npm run check`. 12 tests run the real script against
   synthetic repos to prove it bites. Drove the unenforced-fitness ratchet to
   **zero**.
5. **Governed side effects** — `outward_actions` claim ledger + pure
   execute/replay/refuse classifier + terminal `ambiguous` state, wired into
   both mail transports. 22 tests, plus a down-only adoption ratchet.
6. **Ratchet correction** — the coverage ratchet was measuring the wrong one of
   two same-named `directMailService` modules; fixed so it cannot be satisfied
   by a no-op.
7. **Security** — the `/api/admin` MFA gate protected 2 of 7 surfaces because it
   was registered below five of them. Moved above all of them, with a
   source-order regression gate.
8. **Adoption** — the bulk-mail path now passes a durable
   `mailing-order:{orderId}:lead:{leadId}` key; adoption ratchet 4 → 2.
9. **Scenario** (layer 4) — `scenarios`, immutable and engine-versioned, wired
   into Decision Memory so a decision freezes the economics as well as the
   evidence. 19 tests.
10. **Honest send coverage** — `emailService.sendEmail` accepts a key; the
    coverage ratchet widened 2 → 61 because the measurement got honest, not
    because anything got worse.
11. **Outcome** (layer 7) — `outcomes` + variance as a pure projection over
    what the decision froze. **The customer-side canonical loop now runs end to
    end: evidence → scenario → decision → outcome.** 22 tests.
12. **Second economics engine** (BI191) — the registry is passed in rather than
    global, so `note_payoff` registers from server-side without relocating
    statute-adjacent code.
13. **`days` MetricUnit** — corrected a unit mislabel while no row was yet
    persisted.
14. **Third engine** (`flip_mao`) — reuses profit/roi/total_cost so a flip and
    a land deal are comparable; caught a percent-vs-ratio 100x error at the
    adapter boundary.
15. **Fourth engine** (`rental_returns`) — buy-and-hold NOI / cap rate / cash
    flow / GRM. Widened `EngineSpec.compute` so an engine can DECLARE its own
    assumptions: only the engine knows it substituted a 40%-of-rent expense
    ratio, and without a way to say so the substitution vanishes into a
    measured-looking NOI.
16. **Fifth engine** (`multifamily_noi`) — the first engine allowed to REFUSE:
    an unmeasured commercial building yields null op-ex/NOI/cap rate rather than
    a fabricated 40%-of-rent figure. Four distinct assumption declarations.
    **Also corrected a false gap claim of my own** — see the warning below.
17. **The golden loop** (Section VII A) — one property carried from a raw
    provider payload through evidence → resolution → economics → decision →
    outcome, with every input the previous layer's REAL output. It found a real
    defect in twenty minutes: `freezeScenarioRef` kept only three "headline"
    metrics, so an engine's hold-period forecast never reached the decision and
    the variance called a real prediction "unpredicted". A decision now freezes
    every metric its engine predicted.
18. **The failing golden loop** (Section VII C) — a partial payload, a conflict
    between two authorities, and an outward action whose outcome is unknown. It
    found **two** defects: a credit refusal (which contacts nobody and charges
    nothing) was recorded `ambiguous` and PERMANENTLY poisoned the idempotency
    key; and `resolveClaims` would FABRICATE a conflict if handed an unfiltered
    claim set. Both fixed, both verified by reverting the fix.
19. **The tenancy golden loop** (Section VII B) — isolation across all four
    canonical layers. Isolation was CORRECT; the record was not:
    `freezeScenarioRefs` silently skipped ids it could not read, so a decision
    citing two scenarios was written with one and read as complete. Now refuses
    WITHOUT distinguishing "another tenant's" from "does not exist", so there is
    no id oracle and no silent loss. **A mutation test also caught one of my own
    assertions being vacuous** — see the ledger.
20. **Calibration** (Section VII D) — `shared/outcomes/calibration.ts` +
    `GET /api/decisions/calibration`. Per-metric forecast bias across many
    outcomes. The load-bearing part is the REFUSAL: below six compared outcomes
    it reports `insufficient` with every derived field absent, because six is
    the smallest n at which a unanimous direction clears a sign test at 0.05.
    **All four golden loops (VII A–D) are now done.**

Gate state at last commit: `npm run check` PASS (22 lints), tsc clean,
reachability at baseline 654, every ratchet at baseline, and the **full unit
suite green — 657 files, 8,619 tests, 1 skipped, 0 failures.**

A 24-agent reconnaissance sweep (12 layer readers + 12 adversarial verifiers)
ran against the repo during this program. Its most valuable output was the
adversarial pass: it caught the MFA ordering defect (unit 7), and it correctly
refuted a large number of its own layer reports, several of which had been
generated against a tree that this program was actively changing underneath
them. Treat any inherited "ABSENT" finding as needing re-verification against
HEAD before it is acted on.

## 4. The next highest-value unblocked task

**The engine registry is DONE. Stop adding engines. The gap is ADOPTION.**

BI191 is satisfied: five structurally different engines (`land_deal` cash-flow
series, `note_payoff` day-count accrual, `flip_mao`, `rental_returns`,
`multifamily_noi`) share ONE metric vocabulary, so a flip, a hold and a land deal
are comparable through normalised outputs (BI92). The registry is passed in
rather than global, so no statute-adjacent code moved.

**Do not add a sixth engine without first finding real inline arithmetic to
wrap.** Unit 16 nearly built a BRRRR engine for a feature that does not exist —
see §6a. Grep for the function that already owns the maths BEFORE planning the
adapter; if there is no such function, there is no gap.

In order:
- **Prompt for outcomes — the loop's last open end, and now the binding one.**
  Every layer exists and all four golden loops close, but **nothing asks a
  customer to record an outcome**, so the loop only closes when someone chooses
  to close it. Calibration therefore computes over whatever happens to have been
  volunteered, which is a biased sample by construction (people record the deals
  they remember, and memorable usually means extreme). Study the founder plane's
  due-outcome sweep (`outcomeLedger` / `decisionEval`) — **do not invent a
  second**. The honest hard part is picking WHEN a decision is due for an
  outcome without nagging, and refusing to treat "no answer" as "no outcome".
- **Adoption: still no client surface calls any canonical-layer API.** Verified
  again 2026-08-12 — zero references to `/api/scenarios`, `/api/decisions` or
  `/api/decisions/calibration` under `client/src`. This is now the single
  largest gap in the program: five engines, four layers, four closed loops, and
  the customer-facing calculators still compute for DISPLAY and persist nothing.
  Fix inside the existing Deals/Finance/Map surfaces — **never a new nav entry**.

**On the technique, which has earned its place:** five of the six defects this
program has found came from golden loops, and every one was invisible to the
per-layer suites — because each hand-builds the fixture for the layer below.
Every input must be the previous layer's REAL output; the failure branches matter
more than the happy ones; and **mutation-test the assertions themselves** — unit
19's tenancy check passed against a deliberately nullable tenant key, and unit
20 found unit 19's read-filter regex would have missed the very next query
written.
- **Adoption: no client surface calls `/api/scenarios`.** Verified 2026-08-12 —
  zero references under `client/src`. The engines are reachable and persistable
  and nothing persists. The customer calculators compute for DISPLAY only, so a
  number a customer acted on is reconstructable only where a decision happened to
  freeze it. Fix inside the existing Deals/Map surfaces — **never a new nav
  entry** (five fixed doors).
- **Prompt for outcomes.** Nothing asks a customer to record one, so the
  Decision→Outcome loop closes only when someone chooses to close it. The
  founder plane's due-outcome sweep (`outcomeLedger` / `decisionEval`) is the
  pattern to study — do not invent a second one.
- **Calibration across decisions** — the layer above a single variance.
- **SMS + e-sign transports**, then widen `PROTECTABLE_SENDS` to count them.
  The transport must be wired FIRST, or the ratchet becomes unlowerable and its
  own test fails.

Note the table-count ratchet is strict down-only (currently 759, north star
≤450) — a new table needs a deliberate bump with a written justification in
`scripts/ratchets/table-count.json`.

## 5. What must NOT be rebuilt or reconsidered

- **Do not create a second receipt system.** Generalise
  `autopilot/proofReceipt.ts`.
- **Do not create a second evidence-acquisition architecture.** The provider
  registry (cache, circuit breaker, credit deduction, licence gating) is real
  and good. The Evidence Fabric only *records* what it learned.
- **Do not add a source-registry, predicate or resolved-value table.** Sources
  live in `data-licenses.ts` (code), predicates in `shared/evidence/claim.ts`
  (typed registry), and the resolved value is a pure recomputable projection.
- **Do not reuse a `solene_*` or founder decision table for customer state.**
  BI5: Founder OS is a control plane, not a second product database.
- **Do not relitigate the DO-NOT-DO list** in `CLAUDE.md` — five customer doors,
  four founder doors, no new nav entries, no platform money custody, BYO send
  rails, no residential-comps data plane, refuse-not-fabricate, founder-only
  hard stops. Only the founder can rescind one.
- **Do not raise a ratchet baseline to make a gate pass.** Fix the occurrence.
  When a count legitimately drops, lower it in the same commit.

## 6. Audit claims that HEAD disproves

The Master Audit inspected a public GitHub page, not the source. Correct before
acting on any of these:

| Audit says | HEAD says |
|---|---|
| ActionReceipt is absent | Exists, hash-chained + prediction-sealed, but only on the founder plane |
| Evidence has no provenance | Acquisition-side provenance is strong (`LookupResult`, `DATA_LICENSE_REGISTER`); it died at the *write*, which is now fixed |
| No kernel/pack seam | Exists (`autopilot/domainPack.ts` + `check-kernel-boundary.mjs`) — on the founder plane; the customer side still has none |
| README names Pax/Sophie/Atlas | Still true, and still worth reconciling — but there are more agent identities than the README lists |

## 6a. Claims THIS PROGRAM made that HEAD disproved

The rule in §6 — verify a premise before implementing it — is easy to apply to
the audit's stale claims and hard to apply to one's own. It has already failed
once here, so it is recorded with the same weight:

| This program wrote | HEAD says |
|---|---|
| "BRRRR still computes inline, outside the registry" (`canon.ts`, units 12–15) | **`BRRRR` appears nowhere in this repository.** The only occurrence of the string was that note. There was no inline arithmetic to register because there is no BRRRR feature. Corrected in unit 16. |

The lesson is not "be careful with gap notes." It is that **a gap note is a
factual claim about the repo and decays exactly like the audit's do.** Before
implementing any item from §4, grep for the thing it says exists. A remaining-gap
sentence written three units ago has the same standing as an audit written
against a stale snapshot: none, until re-verified.

## 7. Standing verification discipline

From `CLAUDE.md`, and it has bitten this repo repeatedly: **a green agent report
is a hypothesis.** Run the gates yourself. Hunt "built but unwired" specifically
— new route files never mounted, services with zero call sites, schema without
migrations. `npm run lint:reachability` catches it and caught this program twice.
