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
| relationship, opportunity, scenario | absent | — |

**6 of 18 canonical objects now have a canonical home (was 4).**

Two ratchets track convergence, both down-only, both in
`tests/unit/canonicalArchitecture.test.ts`:

- `UNENFORCED_FITNESS_BASELINE = 0` (was 2) — **every fitness function now has automated enforcement**
- `OBJECTS_WITHOUT_CANONICAL_HOME_BASELINE = 12` (was 14)

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

Gate state at last commit: `npm run check` PASS, tsc clean, reachability at
baseline 654, every ratchet at baseline.

## 4. The next highest-value unblocked task

**Governed side effects — idempotency at the outward action boundary.**

Why it is next: it is the highest-consequence remaining `partial` fitness
function (real money and real counterparty relationships), and canonical law 8
depends on it. The canonical dependency chain puts it at layer 6, immediately
after Decision Memory at layer 5.

The precise, verified gap:

- `server/middleware/idempotency.ts` is **HTTP-request-scoped** (an
  `Idempotency-Key` header, 24h TTL, in-memory fallback). BI74 requires the key
  at the **Action/provider boundary**, carried through the WorkflowRun.
- `emailService`, `smsService`, `lobService`, `directMailService` and
  `mailProvider` carry **no idempotency key at all** — verified by grep. A
  retried job can double-send. `preMailDedupe.ts` is an *audience* policy
  (don't mail your own parcel, don't re-mail within 90 days), not retry safety.
- A genuinely excellent receipt primitive already exists —
  `server/services/autopilot/proofReceipt.ts`, hash-chained,
  prediction-sealed, constitution-versioned, TenantScope-attributed — but only
  on the **founder autopilot plane**. No customer outward action emits one.

Recommended shape (do NOT build a second receipt system):

1. One durable claim ledger keyed `(orgId, actionKind, idempotencyKey)` with an
   atomic claim (`INSERT ... ON CONFLICT DO NOTHING`), so a retry after a
   partial success returns the recorded result instead of re-sending.
2. Handle the **ambiguous outcome** explicitly (AU28): provider timeout after
   the request left is neither success nor failure and must not silently retry.
3. Wire the highest-consequence path first — physical mail via Lob costs real
   money per piece.
4. Add a ratchet enumerating outward-send call sites and holding the
   *unprotected* count down-only. That is the compounding part: it converts
   BL3's "governed side effects" from prose into a number that must shrink.

Note the table-count ratchet is strict down-only (currently 758, north star
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
