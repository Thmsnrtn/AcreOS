# MASTER PLAN

**Read `NEXT_UP.md` first** — it is the resumable state. This file is the
program's reasoning: how the target architecture was derived, what order the
work must happen in, and why.

The **machine-checked** form of the plan is `shared/architecture/canon.ts`,
verified by `tests/unit/canonicalArchitecture.test.ts`. Prose that a test cannot
check is exactly what this program exists to replace, so where this document and
canon.ts disagree, canon.ts wins.

---

## 1. Target architecture

One evidence-aware investment operating kernel with Strategy Packs and views
layered over canonical state (BI1). The canonical loop:

```
REALITY → EVIDENCE → ECONOMICS → DECISION → PLAN
       → AUTHORIZED ACTION → WORKFLOW → OUTCOME → LEARNING
```

Seven authoritative layers, in dependency order: Identity & Tenancy · Canonical
Reality Graph · Evidence Fabric · Economics & Strategy · Decision Memory ·
Action & Workflow · Outcome & Learning.

Pax is a cross-cutting interface over all seven, **not an eighth layer** (BI4).
Founder OS is a privileged control plane over the **same substrate**, not a
second product database (BI5). Both are registered as explicit NON-layers in
canon.ts with their prohibitions, so a change that violates either fails a test.

## 2. Current state

See `ARCHITECTURE_DELTA.md` for the file-level map and `COMPLETION_MATRIX.md`
for requirement-by-requirement evidence. The one-sentence version:

> AcreOS has exceptional breadth (752 tables, ~290 route files, 21 lint gates, a
> machine-readable founder constitution, a genuinely best-in-class
> governed-autonomy kernel) built on a Reality Graph that was never made
> canonical — 4 of 18 canonical objects had a single owning table when this
> program began.

## 3. The dependency graph that drives ordering

The canonical chain is not a preference; each link is unbuildable before the one
before it:

- **Evidence before Decisions.** A DecisionSnapshot freezes references to
  evidence versions. Before `evidence_claims` existed there was nothing stable
  to reference — the "frozen" evidence would have been a copy of a mutable blob.
  *(This is why Unit 2 preceded Unit 3, and it was load-bearing, not stylistic.)*
- **Decisions before Outcomes.** An Outcome is measured against what was
  predicted. Without a frozen prediction there is nothing to grade.
- **Authority before Action.** Consequence-class authority (BI73) determines
  what may execute; idempotency and receipts make the execution safe. Building
  receipts without authority produces proof of unauthorised work.
- **Reality Graph before Strategy Packs.** A Pack declares evidence
  requirements and lifecycle predicates over canonical objects. Declaring them
  over a god table encodes the god table into every Pack.

## 4. Build / buy / integrate / defer

**BUILD** (differentiated semantics + compounding state): Evidence Fabric ✅,
Decision Memory ✅, Reality Graph, Strategy Pack contract, deterministic
economics kernel, outcome calibration, operating-policy objects.

**INTEGRATE** (AcreOS owns the context and workflow): county/federal open data,
AVM/comps, skip trace, e-sign, mail.

**BUY / RENT** (commodity): payment rails, email/SMS transport, object storage,
foundation models, auth primitives.

**DEFER / REJECT** (no measured need — BI56): graph DB, vector DB as knowledge
store, Kafka, warehouse, Kubernetes, service mesh, microservice-per-module,
dedicated search cluster.

## 5. Execution order

Completed:

1. ✅ Canonical architecture registry + fitness-function ratchets
2. ✅ Evidence Fabric (layer 3)
3. ✅ Decision Memory (layer 5)

Next, in dependency order:

4. **Governed side effects** — action-boundary idempotency + customer-plane
   receipts, generalising `autopilot/proofReceipt.ts`. Highest consequence
   (real money, real counterparty relationships). Detail in `NEXT_UP.md` §4.
5. **Decision wiring** — make a real customer workflow (offer sent, pass
   recorded) write a snapshot, so Decision Memory accumulates without anyone
   choosing to use an API.
6. **Scenario** (layer 4) — a persisted, versioned economic hypothesis, so a
   decision can freeze a reference to the economics as well as the evidence.
7. **Strategy Pack contract** (BI90) — study `autopilot/domainPack.ts` and its
   CI-enforced boundary rather than inventing a second seam.
8. **Opportunity + Relationship** (layer 2) — the two absent Reality Graph
   primitives that unlock multi-strategy evaluation of one property (BI93) and
   stop role-table proliferation (BI184).
9. **Parcel / Property separation** — sequenced last of the Reality Graph work
   (see `BLOCKERS.md` B4).
10. **Customer Outcome + calibration** (layer 7) — closes the learning loop.

## 6. Migration strategy

Everything shipped so far is **additive**: two new tables, no column removed, no
write path changed except one appended try/catch. The legacy
`properties.enrichmentData` blob still has readers and still works.

For the Reality Graph work ahead, the pattern is: new canonical table →
backfill → keep the god table as a projection until its readers migrate → drop.
Never a big-bang re-baseline; V42 warns against high-risk refactors even
pre-customer, and the enrichment blob proves the compatibility approach works.

## 7. Acceptance tests

Convergence is measured by two numbers, both down-only, both in
`tests/unit/canonicalArchitecture.test.ts`:

- `UNENFORCED_FITNESS_BASELINE` — 2 → **1**
- `OBJECTS_WITHOUT_CANONICAL_HOME_BASELINE` — 14 → **12**

A staleness check fails the build if either count drops without the baseline
being lowered in the same commit, so the numbers cannot silently drift in either
direction.

## 8. Security, reliability and cost implications

**Security:** both new tables are org-scoped with FK cascade and org-leading
composite indexes (`check-org-leading-index.mjs` passes with zero new
offenders). Neither introduces a new external surface beyond two authenticated,
org-scoped GET routes and one POST.

**Reliability:** evidence recording is wrapped in its own try/catch *after* the
legacy write — a dropped claim degrades provenance, it never fails an enrichment
that already succeeded.

**Cost:** `evidence_claims.costCents` is the first per-fact cost attribution in
the repo, and the groundwork for Law 13 (cost per successful outcome). Append-only
growth is bounded by enrichment frequency, which is already rate-limited by the
30-day refresh skip in `enrichProperty`.
