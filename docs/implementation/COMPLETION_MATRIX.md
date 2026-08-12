# COMPLETION MATRIX — Master Audit requirements → repository evidence

Every row is grounded in a file that exists at HEAD. A row with no file
reference is `MISSING`, not "in progress".

States: `IMPLEMENTED+VERIFIED` · `PARTIAL` · `BUILT-BUT-UNWIRED` · `MISSING` ·
`SUPERSEDED` · `CUSTOMER-EVIDENCE-GATED` · `SCALE-GATED` · `REJECTED`

---

## The twelve architecture fitness functions (BL3)

These are the audit's own pass/fail criteria, so they lead.

| # | Fitness function | State | Evidence |
|---|---|---|---|
| 1 | Single canonical identity | PARTIAL | `check-boundaries.mjs`, `check-kernel-boundary.mjs`. Nothing prevents a new table creating a parallel person/property identity — `leads` + `buyer_profiles` + `investor_profiles` already show the drift |
| 2 | Evidence traceability | PARTIAL | **Improved this program.** `shared/evidence/claim.ts`, `evidence_claims`, `enrichmentToClaims.ts`, 37 tests. Gap: only the enrichment write path emits claims |
| 3 | Historical decision fidelity | **IMPLEMENTED+VERIFIED** | `decision_snapshots`, `shared/decisions/snapshot.ts`, `decisionSnapshotFidelity.test.ts` (mutates evidence under a recorded decision) |
| 4 | Deterministic money math | PARTIAL | `shared/finance/cents.ts`, `shared/calculators/landDeal.ts`, `notePaymentMath.ts`, `check-no-fabrication.mjs`. No single versioned economics kernel; no gate asserting a financial field never comes from a model response |
| 5 | Governed side effects | PARTIAL | `customerMoneyRouting.ts` + `moneyCustodyHardStop.test.ts` are strong; `proofReceipt.ts` is excellent but founder-plane. **Idempotency is HTTP-scoped, not action-scoped — email/SMS/mail can double-send on retry** |
| 6 | Provider replaceability | PARTIAL | `providers/types.ts`, `provider-registry.ts`. Adapters normalise into `LookupResult`; nothing gates a vendor-shaped field being added to a canonical table |
| 7 | Tenant isolation | **IMPLEMENTED+VERIFIED** | `check-org-leading-index.mjs`, `check-org-scoped-fetch.mjs`, `orgScopedDb.test.ts`, `securityTests.test.ts`, `tenantScope.ts` |
| 8 | Cost attribution | PARTIAL | `cognitionBudget.ts`, `aiSpendGuard.test.ts`, `aiCostCeilingDefault.test.ts`, credit deduction on paid lookups. Not attributed to workflow or outcome, so cost-per-successful-outcome is not computable |
| 9 | Profile extensibility | PARTIAL | `business-types.ts` is a maturity registry, not a Pack contract. A real kernel/pack seam exists (`domainPack.ts`) but on the founder plane |
| 10 | Founder operability | PARTIAL | `operations-runbook.md`, `INCIDENT_RESPONSE.md`, `routes-founder-dlq.ts`. Not every failure class has an audited domain repair capability (BI180) |
| 11 | Outcome learning | PARTIAL | Founder plane is best-in-class (sealed prediction in `proofReceipt`, `decisionEval.ts`). Customer plane has no gradeable forecast |
| 12 | Infrastructure restraint | **IMPLEMENTED+VERIFIED** | `scripts/check-infrastructure-restraint.mjs` in `npm run check` + `infrastructureRestraint.test.ts` (12 tests running the real script against synthetic repos). Repo passes with 0 banned primitives across 165 deps; exception list empty |

## Canonical object set (BI12)

| Object | State | Evidence |
|---|---|---|
| Organization | IMPLEMENTED+VERIFIED | `organizations` |
| User | IMPLEMENTED+VERIFIED | `team_members` (Clerk owns auth identity) |
| Property | PARTIAL (conflated) | `properties` — god table |
| Parcel | MISSING | inside `properties` |
| Party | PARTIAL (role-table) | `leads` + role side tables |
| Relationship | MISSING | — |
| Opportunity | MISSING | — |
| Deal | IMPLEMENTED+VERIFIED | `deals` |
| Holding | MISSING | `properties.status = 'owned'` |
| Instrument | PARTIAL | `notes`, `rental_leases` |
| Document | PARTIAL (conflated) | four surface-specific tables |
| **EvidenceClaim** | **IMPLEMENTED+VERIFIED** | `evidence_claims` + resolution policy + 37 tests |
| Scenario | MISSING | — |
| **DecisionSnapshot** | **IMPLEMENTED+VERIFIED** | `decision_snapshots` + freeze fn + 18 tests |
| Plan | PARTIAL | `plan_proposals` — Plan/WorkflowRun boundary unclear |
| WorkflowRun | IMPLEMENTED+VERIFIED | `workflow_runs` with durable resume |
| ActionReceipt | PARTIAL (founder plane) | `autopilot/proofReceipt.ts` — hash-chained, prediction-sealed; no customer action emits one |
| Outcome | PARTIAL (founder plane) | `outcome_telemetry`, `outcome_calibrations` |

## Canonical operational SLOs (BI148)

| SLO | State | Evidence |
|---|---|---|
| No cross-tenant disclosure | IMPLEMENTED+VERIFIED | org-leading index lint + org-scoped fetch lint + tenant tests |
| No duplicate consequential action after retry | **MISSING** | no action-boundary idempotency on email/SMS/mail |
| Decision snapshots reconstruct their inputs | **IMPLEMENTED+VERIFIED** | `decisionSnapshotFidelity.test.ts` |
| Critical calculations match deterministic fixtures | PARTIAL | per-vertical calc tests exist; no single kernel fixture suite |
| Workflow state survives worker/process failure | PARTIAL | `workflow_runs.resumeAt/resumeState` + delay-resume sweeper |
| Source/evidence freshness is visible | **IMPLEMENTED+VERIFIED** | per-predicate freshness horizons + `stale` in resolution + lineage API |
| Variable cost is attributable | PARTIAL | per-org AI ceiling + credits; not per workflow/outcome |
| Customer export is reproducible | PARTIAL | `routes-import-export.ts`, `routes-dsar.ts` exist; not verified against canonical state |

## Golden vertical loops (mission §VII, BI161)

| Loop | State | Note |
|---|---|---|
| A. One Complete Property | PARTIAL | identity → evidence → provenance/conflict **now real**; strategy analysis → deterministic economics → scenario → decision **partially** (Decision Memory exists; Scenario does not); authorized work → receipt → outcome → learning **not on the customer plane** |
| B. One Complete Customer | CUSTOMER-EVIDENCE-GATED | onboarding/import exist; not proven end-to-end without founder rescue |
| C. One Complete Failure | PARTIAL | `tests/simulation/chaos.spec.ts` exists; no test proves "no duplicate consequential action after retry" because the primitive does not exist |
| D. One Complete Learning Loop | founder plane only | sealed prediction + `decisionEval` are real for the autopilot; no customer equivalent |

## Explicitly NOT built (and why that is correct)

| Item | State | Reason |
|---|---|---|
| Graph database | REJECTED | BI17/BI107 — graph is the domain model, relational is the storage |
| Vector DB as knowledge store | SCALE-GATED | BI57 — embeddings are a capability-specific index only |
| Kafka / warehouse / k8s / service mesh / microservices | REJECTED | BI56, BI58–59, BI64 — no measured need |
| Marketplace | SCALE-GATED | ~25 customers (founder decision, `constitution.ts`) |
| Public API | SCALE-GATED | ~50 customers (founder decision) |
| Residential-comps data plane | SCALE-GATED | revenue trigger (founder decision) |
| Cross-customer benchmarks | SCALE-GATED | BI81 — tenant-specific learning first |
| Platform money custody | REJECTED | founder hard stop, chokepoint + ratchet enforced |
