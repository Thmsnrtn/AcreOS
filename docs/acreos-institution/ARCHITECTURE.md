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
it is **things that exist and are never reached.** 390 exported symbols are
declared and referenced nowhere at all, a further 1,188 are exported wider than
they are used, and 60 tables have no reader. That is the honest shape of the
debt, and it is why the reachability gate is load-bearing rather than tidy.

The first two of those were ONE number (1,395) until 2026-08-20, and separating
them is the more useful fact: three quarters of what read as dead code was
ordinary code carrying an `export` keyword it did not need. The remedies differ —
delete the code, versus delete the keyword — and merged, the smaller and more
serious population was unreadable underneath the larger and harmless one.

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

**538 baselined entries.** Each is an unguarded cross-tenant path in principle.
Rule 3 exists because rules 1 and 2 both passed a function that shipped a live
cross-tenant read — it was org-scoped six other ways and the *query* was not.
Rule-2 entries are the ones to clear first: a caller-supplied id reaching another
tenant's row is the shape that actually leaks.

## Which role AcreOS takes

The governing question when a capability is designed is not "can we build it"
but **which role does building it this way put AcreOS in**. The standing answer,
recorded machine-readably as `posture.minimum-necessary-responsibility` in
`shared/governance/constitution.ts`:

> AcreOS assumes only the responsibility necessary to provide exceptional
> property-investment intelligence, orchestration, continuity and governed
> automation. Where equivalent customer value can be achieved while the CUSTOMER
> or a SPECIALIST PROVIDER remains the principal, custodian, sender, counterparty
> or regulated actor, that architecture is preferred.

AcreOS owns: intelligence, canonical investment context, evidence and provenance,
deterministic computation, strategy reasoning, Decision Memory, policy and
orchestration, workflow state, governed automation, receipts and reconciliation,
outcome learning.

AcreOS does not take on, merely because it would be convenient to implement:
custody of customer money; escrow; creditor-of-record status; sender identity
where a customer-owned sender is appropriate; contractual counterparty status;
licensed broker/appraiser/lawyer/accountant roles; consumer-reporting roles;
regulated professional judgment.

**This is a posture, and it has explicit exceptions — read them before acting on
it.** It is *not* an argument for replacing working architecture whose current
factual role is already narrow and defensible. It is *not* an argument for weaker
platform security, weaker tenant isolation, or less truthfulness — AcreOS remains
fully responsible for the integrity and lawful operation of the platform itself,
and allocating roles never contracts away law that applies to AcreOS. And it is
emphatically *not* an argument for adding manual approval clicks: high autonomy
is the goal. Standing authority, scoped grants, budgets, expiry and revocation are
how AcreOS operates continuously without silently becoming the customer's
business principal.

**The worked example, because doctrine without one rots.**
`server/services/atrSafeHarbor.ts` handles Ability-to-Repay under Reg-Z
§1026.43 — a credit determination about a *human being*. AcreOS does not make it.
It supplies the eight-factor checklist, the DTI arithmetic, a **refusal** when the
third-party verification §1026.43(c)(3) requires is absent, and the retention
record. `ATR_ATTESTATION_TEXT` reads *"I certify that I have made a reasonable and
good faith determination…"* and is signed by a named user at the customer. The
customer stays the creditor; AcreOS stays the instrument. Compare new capabilities
against that shape.

`constitution.test.ts` checks both halves: every hard stop the posture names as an
instance must still resolve and still be machine-enforced, and the ATR example
must still carry its first-person certification and its refusal. A posture whose
instances were deleted would otherwise keep reading as governance while meaning
nothing.

**A useful boundary for the investment side**, which this posture does not soften:
AcreOS may help an investor benefit from informational and operational
*advantage*. It may not manufacture a counterparty's informational *disadvantage*
through deception or fabricated facts. Internal evidence supporting an aggressive
offer is the product working; telling a seller that offer is "verified market
value" is not.

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

## The founder plane: two subsystems, and only one is on

Separate from the customer product, and larger than it looks: **109** non-test
modules under `server/services/autopilot/`. Two distinct things live near each
other here, and conflating them gets the risk picture backwards.

**The autopilot plane is default-OFF, by explicit design.** Each of its four
master switches requires `process.env.X === "true"` —
`SOLENE_DISPATCH_ENABLED`, `AUTOPILOT_PUBLISH_ENABLED`, `COGNITION_ENABLED`,
`SELF_PATCH_ENABLED`. `fly.toml` sets none of them. The module header states the
posture plainly: a null column falls back to the env default, the env default is
off, and the system stays safe-off until a real row says otherwise.
`SOLENE_PANIC_STOP` — a machine-unwritable Fly secret — overrides the database
switches entirely.

**The evolution pipeline is a different module and it IS running.**
`server/services/evolutionPipeline.ts` is **not** under `autopilot/`, and
`runScheduledJobs.ts` starts it with a plain unguarded call alongside the other
job registrations; it processes pending proposals every six hours in a 3–5am
window, gated only by a circuit breaker and the presence of self-assessment
tasks — never by an autopilot switch.

**The repository can therefore modify itself.** `evolutionPrGenerator` commits to
`evolution/<id>-<timestamp>`, pushes, and opens a GitHub PR labelled
`agent-proposed` with pre-mortem, rollback and gauntlet provenance in the body.
Be precise about what the flag does: `EVOLUTION_DEPLOY_VIA_PR !== "false"`
chooses the **delivery mode** — PR versus the legacy logical deploy — for a
pipeline that has already produced a change. It is not the on switch, and there
is no off switch for the pipeline itself short of the circuit breaker.

Two consequences a steward must hold: some branches and PRs here were not written
by a human, and "is the autopilot on?" and "can this repo open a PR at itself?"
have different answers.

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
