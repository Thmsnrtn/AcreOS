# Architecture

The authoritative layers, the canonical objects, and the seams that must not be
crossed. Verified at `10447296`, 2026-08-19.

---

## The registry is the architecture

`shared/architecture/canon.ts` is machine-readable and authoritative: **7
canonical layers**, 2 explicit NON-layers, **15 laws**, **12 fitness functions**,
**18 canonical objects**, and the 9-stage loop.

`canonicalArchitecture.test.ts` proves every table it names exists and every
enforcement pointer resolves to a real file. **Extend that registry; do not
re-derive it in prose.** This document explains it — it does not compete with it.

The seven layers: identity-tenancy · reality-graph · evidence-fabric ·
economics-strategy · decision-memory · action-workflow · outcome-learning.

The two NON-layers are declared as such on purpose. **Pax is not a layer** — it
reasons over canonical state and is not an alternate truth store. **Founder-OS is
not a layer** — it is how AcreOS operates itself, not part of the customer
product. Several defects in this repo's history came from treating one of them as
a layer.

## Canonical objects: 9 of 18 have a home

| status | objects |
|---|---|
| canonical (9) | organization, user, deal, evidence-claim, scenario, decision-snapshot, workflow-run, outcome, opportunity |
| conflated (3) | property, parcel, document — all inside the `properties` god table |
| role-table (5) | party, holding, instrument · plan, action-receipt |
| absent (1) | relationship |

`OBJECTS_WITHOUT_CANONICAL_HOME_BASELINE = 9`, down-only.

Two facts that shape the remaining work, verified rather than assumed:

- **`plan` and `action-receipt` are FOUNDER-PLANE ONLY.** `plan_proposals` has no
  `organization_id` at all. The customer side of both is unbuilt, not blurred —
  so that work is a build, and it can run in parallel with layer 2.
- **Parcel identity is solved at the KEY level, not the table level.**
  `shared/parcel/parcelRef.ts` is the one definition of "the same parcel", with
  an adoption ratchet at 0. What remains is that cadastral identity is still
  welded to economic state on `properties`, with direct `sellerId`/`buyerId` FKs
  into `leads`. Until they separate, assemblage is inexpressible and
  `relationship` cannot be modelled without duplicating the FK mess.

## Scale

751 tables · 245 migrations · 542 services · 269 route files · 149 job roster
entries · 154 client pages. See `IMPLEMENTATION_STATE.md` for the live counts and
every ratchet baseline.

A repository this size has one dominant failure mode, and it is not complexity:
it is **things that exist and are never reached.** 1398 exported symbols have no
production consumer; 60 tables have no reader. That is the honest shape of the
debt, and it is why the reachability gate is load-bearing rather than tidy.

## Tenancy

**Application-level only. There is no PostgreSQL row-level security anywhere** —
zero `ROW LEVEL SECURITY` / `CREATE POLICY` across `migrations/` and
`migrate.mjs`. Isolation is the typed `AuthenticatedRequest` contract plus
`check-org-scoped-fetch.mjs`, which runs five down-only registers:

| rule | baseline |
|---|---|
| 1 — touches an org table without org context | 147 |
| 2 — has an org, resolves by id anyway | 63 |
| 3 — scoped unit, unscoped query | 127 |
| function shape, rule 1 / rule 2 | 124 / 78 |

**539 baselined entries.** Each is an unguarded cross-tenant path in principle.
Rule 3 exists because rules 1 and 2 both passed a function that shipped a live
cross-tenant read — it was org-scoped six other ways and the *query* was not.
Rule-2 entries are the ones to clear first: a caller-supplied id reaching another
tenant's row is the shape that actually leaks.

## Providers

`server/services/providers/` is the documented registry — tier filtering, credit
deduction, circuit breaking (3 failures in 5 minutes), response caching via
`provider_cache`.

**It is the minority path.** `providerRegistry.lookup` has 2 production call
sites; `dataSourceBroker.lookup*` has 71 across 14 files. And the registry's
headline capability has never once run: both callers **hardcode** the tier
argument, one passing `"free"` and one `"pro"` with a comment saying it is a
vendor registration tier rather than a subscription check. Tier-based filtering
has never routed a real customer plan.

Anyone wiring a third caller must first decide how a billing `scale` org maps
onto the `ProviderTier` ladder. No mapping exists.

## The founder autopilot plane

Separate from the customer product, and larger than it looks: 99 modules under
`server/services/autopilot/`.

**The repository modifies itself.** `evolutionPrGenerator` commits to
`evolution/<id>-<timestamp>`, pushes, and opens a GitHub PR labelled
`agent-proposed` with pre-mortem, rollback and gauntlet provenance in the body.
It is **on by default** — `EVOLUTION_DEPLOY_VIA_PR !== "false"` — gated by a
fails-closed LLM judge gauntlet, with `SOLENE_PANIC_STOP` (a machine-unwritable
secret) overriding everything.

Two consequences a steward must hold: some branches and PRs here were not written
by a human, and the kill switch is an environment variable, not a code path.

## Agent authority, and where it does not meet

Two independent authority computations answer overlapping questions, and neither
consults the other.

- `agentAuthorityGate.checkAuthority` — per-agent `authorityConfig` levels plus
  `isNeverPromote()`, the 15-name founder-only ceiling.
- `trustAuthorityEscalation.getTier(trustScore)` — the only per-agent check in
  `executionEngine.validateSafetyGates` and `agentInitiativeEngine`.

**`agentAuthorityGate` reads as the autonomy ceiling and is not one.** Its 15
names mirror the founder hard stops closely enough that a reader will assume
autonomy is bounded by them. No action that reaches the gate can match any of the
15 — live callers emit `proactive:${id}` and `reaction:${id}`, and no roster entry
contains a colon. None of the 15 has an executor anywhere either, so nothing
hard-stop-class currently executes. **The guard proves nothing rather than being
stepped over.** Do not cite that file as enforcement of the DO-NOT-DO list.

Reconciling the two vocabularies is on the frontier. Adding more names to the
list is not the fix.

## Semantic contracts that must not be violated

- **Plan ≠ workflow ≠ action ≠ outcome.** Each transition is explicit.
- **An evidence claim is not a resolved fact.** Resolved state is a projection
  over claims; unknown and conflict are valid values.
- **A seller or user assertion is not verified property truth.**
- **Provider acceptance is not delivery; delivery is not a real-world result;
  a real-world result is not an investment outcome.**
- **Outcome and learning never rewrite a historical decision.** A decision
  snapshot preserves what was known, assumed and chosen at the time.
- **Learning never widens authority.**
- **Deterministic financial and geometric truth stays deterministic**, versioned
  and testable. No model in that path.
- **The unknown resolves toward caution, never toward permission.** See
  `DEVELOPMENT_INSTITUTION.md` — this one was learned in four places at once.

## Legacy and superseded

- The 7,379-line `founder-dashboard.tsx` monolith was decomposed across six
  commits and is fully deleted. No new code references it; new founder surfaces
  are their own route behind one of the four doors.
- `/founder/autopilot` is a legacy alias redirecting to `/founder`. The Lens-4
  "Bridge" home at `/founder/bridge` is now a deep tool, not a home.
- The standalone negotiation copilot was killed 2026-08-13. Its table is
  deliberately NOT dropped: it holds customer data, and deleting that is a
  founder-only hard stop, so the DROP stays a decision someone makes on purpose.

## Where to look

| question | file |
|---|---|
| the architecture itself | `shared/architecture/canon.ts` |
| founder decisions, machine-readable | `shared/governance/constitution.ts` |
| engineering standards, nav doctrine, DO-NOT-DO | `CLAUDE.md` |
| what was deleted and why | `docs/company/deletion-ledger.md` |
| current counts and baselines | `IMPLEMENTATION_STATE.md` |
