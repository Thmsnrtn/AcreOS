# Product

What AcreOS is, who it serves, and what it deliberately is not. Verified at
`10447296`, 2026-08-19.

---

## The thesis

**A universal property-investment operating kernel, extended through Strategy
Packs, expressed through a compressed and trustworthy customer experience.**

The canonical loop the whole product is organised around:

```
REALITY → EVIDENCE → ECONOMICS/SCENARIO → DECISION → PLAN/WORKFLOW
        → AUTHORIZED ACTION → REAL-WORLD RESULT → OUTCOME → LEARNING
```

The ceiling is compiling **investor intent + property reality + traceable
evidence + capital/risk constraints** into a defensible decision and a safe
execution path, then learning from what actually happened.

Land is the wedge and the deepest feature surface. It is not the ceiling.

## Who it serves

A closed, three-layer taxonomy owned by one module,
`shared/models/persona-mapping.ts`:

**15 `businessType` values → 9 `persona` values → 3 `investorType` values**
(land · notes · both).

The nine personas: land_investor, note_investor, note_originator, note_servicer,
tax_delinquent, wholesaler, subdivider, fix_flipper, landlord. Notes is the only
vertical that sub-forks by role.

That module exists because the mapping previously lived in three hand-synced
copies that drifted. **No new persona verticals** is a founder hard stop;
`personaMapping.test.ts` enforces it by asserting `BUSINESS_TYPES.length === 15`,
so a sixteenth fails the build. Worth knowing: that enforcement reads as a
fixture detail rather than a ruling, and the constitution registry flags it as
such.

## The honest state of the thesis

Three gaps, all measured, all deliberate, and all more useful to know than the
thesis itself.

**1. The kernel/pack seam is real only on the FOUNDER plane.** `DomainPack`
(causalModel + moveToLever + regulatoryProfile) has exactly one implementation,
`packs/land`, injected via `activePack.ts`, admission-checked by `admitPack.ts`,
and boundary-enforced by `check-kernel-boundary.mjs` (29-entry manifest, baseline
0). That machinery is AcreOS operating *itself* — `tenantScope.ts` is
single-tenant, scope `platform`.

On the customer side there is **no pack contract at all**. Five verticals carry
dedicated schema files totalling 60 tables; six nav modules are
`businessTypeOnly`; `businessType` appears in roughly 137 client and 102 server
locations as scattered conditionals.

Canon says this about itself: the `profile-extensibility` fitness function is
`partial`, with the note that the customer side has no Strategy Pack contract.
So today, customer verticals are **parallel implementations sharing
infrastructure**, not configurations of a kernel. Closing that is the highest-
leverage architectural work available.

**ONE LAYER OF IT CLOSED, 2026-08-20 — the attribution layer, and only that.**
This paragraph used to end "`strategy_pack_id` exists on `decision_snapshots`
and `scenarios` and every production caller writes `null`". That is no longer
true, and the fix was small because the taxonomy already existed. A strategy pack
IS a business type: `StrategyPackId` is an alias of `BusinessTypeId`, not a
second registry, so there is nothing to drift. All four canonical
`recordDecision` call sites are vertical surfaces and now say which rules shaped
them — `fix_and_flip` (the flip analyzer), `subdivider` (lot pricing), and
`land_flipper` (the blind-offer wizard and the offer-letter batch). Null in that
column had never meant "no pack applied", which is what the type's docblock says
it means; it meant a fact those routes held and did not record.
`strategyPackVersion` stays null on purpose until a versioned pack ARTIFACT
exists — the renderer already prints `@unversioned`, and "1.0" would be a version
nobody cut. `strategyPackIsRecorded.test.ts` pins all three claims.

**What that does NOT close:** every decision and scenario is now attributable to
a strategy, which is the reporting and calibration seam. The verticals are still
parallel implementations — the 137/102 scattered conditionals are untouched, and
a pack still configures nothing. Do not read the attribution layer as the
contract.

**2. The canonical loop closes for exactly two surfaces.** `recordDecision(` has
two non-generic production call sites: the flip analyzer (fix_and_flip) and lot
pricing (subdivider). The *consumer* half is built and customer-facing —
`/api/decisions/due` feeds the Today outcome prompt, `/api/decisions/calibration`
feeds forecast calibration. So the plumbing exists at both ends and thirteen
verticals have nothing to put through it. Their outcome prompt is structurally
empty forever.

Beware when grepping: `recordDecision` is **four different functions**. Only
`server/services/decisions/decisionStore.ts` is canonical; three others live on
founder routes. Nine hits do not mean broad adoption.

**3. All 15 verticals declare `maturity: "core"`; 13 cannot evidence it.**
`readiness.ts` defines four evidence tiers (declared → surfaced → underwritten →
decided) and `core` requires `decided`. Only fix_and_flip and subdivider reach
it. The ratchet asserts the overclaim count is **exactly 13**, not at most —
so a silent drop is caught too.

The founder's ruling (OD-5) was to demote the **public claim**, not the registry:
`core` is held to be a fair description of what a paying customer gets in-app.
Public surfaces render 13 verticals as Beta via `PUBLIC_CLAIM_DEMOTIONS`, which
may only ever move a vertical DOWN and throws at module load without a written
reason and date.

**The gap is the LOOP, not the surface.** Every vertical has a surface. Adding
more surface is not the work.

## Monetisation, and a live inconsistency

Five vertical packs sell at $100–$200/mo on top of a $20–$79/mo tier. Buying one
**unlocks nothing**: the `org_vertical_packs` row is written at checkout, and its
only readers render an "owned" badge and a P&L rollup. Every gated surface keys
on the org's self-reported `businessType`, which is free to set in onboarding.
There is no entitlement middleware anywhere in `server/`.

Separately, two tier vocabularies exist and cannot meet: billing declares
`starter | pro | scale`; the provider registry declares
`free | starter | pro | enterprise`. No mapping function exists, and
`tierIndex()` returns `-1` for an unknown tier — which `tierAllowed()` would
treat as below free. It has never bitten because both production callers
hardcode the tier.

## What AcreOS deliberately is not

From the founder DO-NOT-DO list (`CLAUDE.md`, mirrored machine-readably in
`shared/governance/constitution.ts`). These are decisions, not open questions.

- **Not a marketplace** before ~25 customers; **not a public API** before ~50.
  The staged surfaces exist and are deliberately unmounted, pinned in both
  directions by `expansionLadder.test.ts`.
- **Not a money custodian.** Customer money never moves on AcreOS's own account.
  Subscription payments to AcreOS are the only payments AcreOS is party to.
- **Not a sender of record** for counterparty mail. That requires the org's own
  connected identity.
- **Not an advertising platform.** Paid ads are a founder instrument on AcreOS's
  own account — the mirror image of the custody ban, not an exception to it.
- **Not a residential-comps data plane** before its revenue trigger.
- **Not a home for a second AI destination.** Pax is ambient fabric behind the
  doors, never an app within the app.
- **Never fabricating.** No invented numbers, no fake activity, no placeholder
  presented as real. Refuse rather than fabricate, everywhere.

## Where the product is in its life

**Pre-Customer #1.** That is the single most important framing fact: the blast
radius of almost every defect found today is zero, which is exactly why
correctness work now is cheap and correctness work later is not.

Customer #1 should arrive when the remaining important uncertainty is better
answered by real user behaviour than by another week of solitary engineering.
That crossover is a live judgement. Do not delay it for universal
composable-strategy perfection, fifteen equally deep verticals, a marketplace,
enterprise breadth, or scale infrastructure with no trigger fired.
