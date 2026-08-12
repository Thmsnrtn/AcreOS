# ARCHITECTURE DELTA — current → target

The **authoritative, machine-checked** form of this delta is
`shared/architecture/canon.ts` (`CANONICAL_OBJECTS` and `FITNESS_FUNCTIONS`),
verified by `tests/unit/canonicalArchitecture.test.ts`. This document is the
prose companion: it explains *why* each row reads the way it does, at
file/module/schema/service level.

If the two ever disagree, **canon.ts wins** — it is the one a test can check.

---

## 1. The shape of the problem

AcreOS is not short of capability. At HEAD it has **752 Drizzle tables**, ~290
server route files, 3,400 TypeScript files, 632 unit-test files, and a mature
gate culture (21 lint gates, a dozen down-only ratchets, a machine-readable
founder constitution, a statute register).

The delta is not "features missing". It is that this breadth was built on a
**Reality Graph that was never made canonical**. When the program started, only
4 of the audit's 18 canonical objects had a single owning table. Everything else
was expressed as a status string, a role-specific side table, or a JSONB blob on
a god table.

That is why the audit's own conclusion (BI200) is *subtractive*: nearly all of
its ambitious ideas collapse onto a small number of durable primitives, and the
work is to make those primitives real rather than to add more surface.

## 2. Layer-by-layer delta

### Layer 1 — Identity & Tenancy · **strongest layer in the repo**

Tenant isolation is genuinely defence-in-depth, not convention:
`scripts/check-org-leading-index.mjs` requires an org-leading composite index on
every org-scoped table; `scripts/check-org-scoped-fetch.mjs` audits storage
methods for org context; `tests/unit/orgScopedDb.test.ts` and
`securityTests.test.ts` back it; `server/services/autopilot/tenantScope.ts`
provides a typed scope primitive that replaced an overloaded `null`.

**Delta:** authority is still largely feature-shaped rather than
consequence-shaped. BI73 wants permissions to reflect what an action can *cause*
(read / internal mutation / external communication / financial commitment /
destructive), which is the model the Action layer needs. Not yet built.

### Layer 2 — Canonical Reality Graph · **the largest remaining delta**

| Canonical object | Current representation | Why it is wrong |
|---|---|---|
| Property | `properties` | God table: cadastral identity (`apn`, `legalDescription`, `parentParcelId`) + economics (`purchasePrice`, `marketValue`) + pipeline status + due-diligence JSONB + direct `sellerId`/`buyerId` FKs into `leads` |
| Parcel | *inside* `properties` | BI9 forbids overloading APN identity onto the economic object. One Property may span many Parcels; today only the subdivision self-reference can express any of it |
| Party | `leads` (+ `buyer_profiles`, `investor_profiles`, `borrower_*`) | `properties.sellerId` **and** `properties.buyerId` both point at `leads`, so one real person in two roles needs two rows. BI10: Lead is a state/role, not a person table |
| Relationship | — | No typed edge. Every new investor profile has been expressed by adding convenience FKs (BI184 forbids), which is *why* role tables keep multiplying |
| Opportunity | — | Pre-commitment interest lives on `leads` + `properties.status`. Without it, one Property cannot host several simultaneous strategy evaluations (BI93) |
| Deal | `deals` | ✅ canonical |
| Holding | `properties.status = 'owned'` | Ownership is a string, not a position with basis, cash flows and disposition history |
| Instrument | `notes`, `rental_leases` | Two vertical tables, no shared Instrument shape — cross-strategy reasoning (a note secured by a property you also hold) has nothing to reason over |
| Document | `document_versions`, `generated_documents`, `deal_room_documents`, `document_templates` | No single Document identity, so a document cannot be referenced once and linked to the decision, workflow and evidence it produced |

**Migration note:** none of this requires a rewrite. Each is additive — a new
canonical table plus a backfill, with the god table retained as a projection
until its readers migrate. The pre-customer window (BI104, V3) makes this the
cheapest it will ever be.

### Layer 3 — Evidence Fabric · **DONE this program**

*Before:* acquisition-side provenance was strong and entirely discarded at the
write. `savePropertyEnrichment()` collapsed each run into an overwritten
`properties.enrichmentData` blob.

*Now:* `evidence_claims` (append-only) + `shared/evidence/claim.ts` (pure,
deterministic, versioned resolution with `unknown` / `conflict` / `stale` as
first-class states) + `enrichmentToClaims.ts` (the anti-corruption boundary) +
`GET /api/properties/:id/evidence[/:predicate]?asOf=` (lineage).

*Remaining:* only the enrichment write path emits claims. Bulk import, manual
edit, due-diligence, residential comps and AVM/ARV still write unattributed
values onto canonical rows. A lint barring new unattributed writes to material
factual columns is the natural next ratchet.

### Layer 4 — Economics & Strategy · **not started**

- No persisted `Scenario`. Calculations are transient;
  `scenario_simulations` / `scenario_outcome_comparisons` are founder-plane
  autopilot tables, not customer investment scenarios.
- No Strategy Pack contract. `shared/business-types.ts` is a **maturity
  registry** (15 business types with `core`/`beta`/`roadmap` tiers,
  `workflowTemplateId`s and spotlight modules) — genuinely useful, and genuinely
  not the versioned declarative Pack BI90 describes (evidence requirements,
  calculation registry, decision criteria, workflow templates, capability
  defaults, AI context policy, cost escalation, fixtures).
- Deterministic math exists in pieces (`shared/finance/cents.ts`,
  `shared/calculators/landDeal.ts`, `server/services/notePaymentMath.ts`) but
  there is no single versioned economics kernel.

**Note the asymmetry:** a real kernel/pack seam *does* exist —
`server/services/autopilot/domainPack.ts` with a CI-enforced boundary
(`check-kernel-boundary.mjs`, 29 kernel modules, zero pack imports). It is on the
**founder autopilot** plane. The customer side has no equivalent. Building the
customer Strategy Pack contract should study that seam, not invent a new one.

### Layer 5 — Decision Memory · **DONE this program**

`decision_snapshots` (immutable) + `shared/decisions/snapshot.ts`. Freezes
resolved evidence with claim ids, assumptions with origin, alternatives with
reasons, derived unknowns, actor + authority, Strategy Pack id+version.

*Remaining:* nothing in the product yet *calls* `recordDecision` from a real
customer workflow — the API exists and is reachable, but an offer-send or a pass
does not automatically write a snapshot. That wiring is the next increment for
this layer.

### Layer 6 — Action & Workflow · **partial, and the next priority**

*What exists and is good:* `workflow_runs` with durable `resumeAt`/`resumeState`
and a delay-resume sweeper; a governed-autonomy kernel
(`server/services/autopilot/*`) with policy gates, escalation ladders, panic
stop, witness grants; and `proofReceipt.ts` — a hash-chained,
prediction-sealed, constitution-versioned receipt that is genuinely
best-in-class.

*The gap:* all of that governs the **founder** plane. On the customer plane:

- Idempotency is HTTP-request-scoped middleware (`Idempotency-Key` header, 24h
  TTL, in-memory fallback), not an Action/provider-boundary key (BI74).
- `emailService`, `smsService`, `lobService`, `directMailService`,
  `mailProvider` carry **no idempotency key** — a retried job can double-send.
- No customer outward action emits a receipt.
- `plan_proposals` exists but Plan-vs-WorkflowRun is not a clean boundary (BI21).

### Layer 7 — Outcome & Learning · **founder plane only**

`outcome_telemetry`, `outcome_calibrations`, `decisionEval.ts` and the sealed
prediction in `proofReceipt` make the founder plane's learning loop real. The
customer plane has no Outcome linking back to an investment decision, so
Decision → Outcome → calibration cannot close for the customer.

## 3. Pax / AI

Registered as a NON-layer (BI4). The observed drift from "one primary customer
Pax" is real: alongside Pax there are Solene, Atlas, Sophie, Beatrice, Iris and
Soren surfaces, and roughly thirty `shared/schema/solene-*.ts` schema modules.
Most are founder-plane, which BI25 permits — founder and customer AI share
infrastructure but not authority. The reconciliation question is which of these
are *user-facing identities* versus internal capability bundles (BI101, BI153).
Deferred pending the recon report; it is a naming/consolidation question, not a
correctness one, and correctness work outranks it.

## 4. Infrastructure

Mostly disciplined against BI56. The two worth watching: a pgvector Fly config
(vector infrastructure must stay a derived capability with a measured use case,
BI57) and a read replica (`server/db-replica.ts`) which C13 says must be earned
rather than assumed. `infrastructure-restraint` is the last fully **unenforced**
fitness function — BI152's New Database Test is still advisory, and a
dependency/config ratchet would make it checkable.
