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
| party, holding, instrument, plan, action-receipt, outcome | role-table | scattered |
| **scenario** | **canonical** ✅ | `scenarios`, this program |
| relationship, opportunity | absent | — |

**7 of 18 canonical objects now have a canonical home (was 4).**

Two ratchets track convergence, both down-only, both in
`tests/unit/canonicalArchitecture.test.ts`:

- `UNENFORCED_FITNESS_BASELINE = 0` (was 2) — **every fitness function now has automated enforcement**
- `OBJECTS_WITHOUT_CANONICAL_HOME_BASELINE = 11` (was 14)

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

Gate state at last commit: `npm run check` PASS (22 lints), tsc clean,
reachability at baseline 654, every ratchet at baseline, and the **full unit
suite green — 651 files, 8,455 tests, 1 skipped, 0 failures.**

A 24-agent reconnaissance sweep (12 layer readers + 12 adversarial verifiers)
ran against the repo during this program. Its most valuable output was the
adversarial pass: it caught the MFA ordering defect (unit 7), and it correctly
refuted a large number of its own layer reports, several of which had been
generated against a tree that this program was actively changing underneath
them. Treat any inherited "ABSENT" finding as needing re-verification against
HEAD before it is acted on.

## 4. The next highest-value unblocked task

**Register a second economics engine**, then **Outcome** (layer 7).

The scenario layer landed with exactly ONE registered engine (`land_deal`).
That is honest — it is the one deterministic calculator that already existed and
was already used — but it means most financial numbers in the product are still
unversioned and unpersisted. The highest-value follow-ons, in order:

1. **Register `note_payoff`.** `server/services/notePaymentMath.ts` is already
   versioned and already persists its inputs; bringing it into `ENGINES` is
   mostly registration, and it proves the registry generalises across verticals
   rather than being a land-shaped abstraction.
2. **Flip / BRRRR / multifamily NOI.** Each currently computes inline. Extract
   to a pure function, register it, and the numbers become defensible.
3. **Outcome (layer 7).** `decision_snapshots` and `scenarios` now capture the
   prediction; nothing yet records what ACTUALLY happened and compares. The
   founder plane already does this well (a prediction sealed into
   `proofReceipt`'s hash, graded later by `decisionEval.ts`) — study that, do
   not invent a second mechanism. Note law 9: an Outcome REFERENCES a snapshot,
   it never edits one.

Also still open and needing no decision: wiring `smsService` (~10 sites) and
e-sign, then widening `PROTECTABLE_SENDS` to count them — the transport must be
wired FIRST, or the ratchet becomes unlowerable and its own test fails.

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

## 7. Standing verification discipline

From `CLAUDE.md`, and it has bitten this repo repeatedly: **a green agent report
is a hypothesis.** Run the gates yourself. Hunt "built but unwired" specifically
— new route files never mounted, services with zero call sites, schema without
migrations. `npm run lint:reachability` catches it and caught this program twice.
