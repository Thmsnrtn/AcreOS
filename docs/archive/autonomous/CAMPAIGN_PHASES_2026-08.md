# Campaign phase log — 2026-08 (ARCHIVED)

Historical evidence, not active context. These are the phase write-ups from the
2026-08 autonomous campaign, moved out of the live frontier on 2026-08-19 when
that file became a frontier rather than a diary.

Each phase corresponds to a commit; `git log` is the authoritative diary and
`docs/implementation/EXECUTION_LEDGER.md` is the long record. Nothing here is
required reading to continue work — read it when you need the reasoning behind
a specific change, not to orient.

Conclusions from these phases that still GOVERN were folded into
`docs/acreos-institution/` and `CLAUDE.md`. If this file and those disagree,
those win.

---

## PHASE 2 — FOUNDRY → ACREOS CROSS-POLLINATION (2026-08-18)

The full record is `docs/autonomous/FOUNDRY_ACREOS_CROSS_POLLINATION.md`, which
is the canonical artifact for this phase — entries 1–19 with the ten-point
admission test applied to each. This section is the campaign-level summary only.

**Foundry is READ-ONLY in this phase.** Nothing was committed to it, no test,
migration or doc there was touched. Invariants crossed; nouns did not.

### What landed (each its own commit, each mutation-tested)

| # | Commit | Invariant |
|---|---|---|
| 4, 5 | `a37affc8` | A person id is not a tenant scope; a push says what happened |
| 6 | `f8332db1` | Public truth proven from the rendered DOM; the two laws written into CLAUDE.md |
| — | `b920d94b` | `shortDescription` / `integrations` deleted through the ledger |
| 7 | `7cf0cef8` | A pause must reach the work that runs on the customer's behalf |
| 8 | `740deb35` | A ceiling belongs to the action class, not to whoever issues the grant |
| 9 | `21ecc76d` | A carrier's acceptance is not a delivery, on a regulated record |
| 10 | `835e0e9c` | An omitted risk flag is not a declaration of safety |
| 11 | `a6df3b60` | A guess is not a known value, on the path the law governs |
| 12 | `c937eb2e` | A verifier may only report an outcome it observed |
| 13 | `1674e2f5` | A dispatch receipt is not evidence the action worked |
| 14 | `8b4740a5` | Provenance travels with the value, not with the lookup |
| 15 | `96b0b3ad` | Authority belongs to the source, not to the transport |
| 16 | `893da34a` | A cost bound must measure the thing it bounds |
| 17 | `bb6c4182` | A secret is never compared with `===` |
| 18 | `daa749b6` | A route no flag governs is not a route that is off |

### Ratchets earned and locked in, never raised

`run-scheduled-jobs-linecount` 5823 → 5786 → 5721 (two extractions, each forced
by a fix that could not be made or tested in place). `colon-any` 2950 → 2942
(a typing improvement, not a deletion). `unreached-exports` 1400 → 1399
(`outcomeBasis` gained its first production caller). `check-org-scoped-fetch`
lost two `BASELINE_UNUSED_ORG` entries in the commit that fixed them.

### The three patterns that produced most of the findings

1. **The right rule already existed somewhere else and was not the one being
   used.** `outcomeBasis` (documented the consequence-vs-proxy distinction, zero
   production callers, while `outcomeOf` broke it); `intelligence/budget.ts`'s
   `executor` category (the scheduler summed everything instead);
   `landProfile.ts` scoring FCC broadband below county GIS as self-reported
   while the evidence layer recorded it as `authoritative`; `timingSafeEqual` at
   eight sites while five compared secrets with `===`.

2. **A missing value standing in for a decided one.** `movesMoney` optional;
   `reviewDueAt` optional; a route absent from `enabledRoutes` read as denied
   rather than ungoverned; `undefined === undefined` authenticating a webhook.

3. **A measurement attributed to an actor that was not a measurement OF that
   actor.** The verifier re-reading the actor's own audit row; a dispatch
   receipt voting on efficacy; the executor's cost ceiling summing the whole
   platform's AI spend.

### Claims checked and REJECTED

Recorded because a ledger listing only what survived is a biased account of the
reading. `enrichmentToClaims`'s `observedAt: null` (the sub-objects carry no
date field, so nothing is discarded); `routes-properties.ts`'s customer-typed
observations (deliberate, labelled `customer_edit`, carried through every
reader); the executor cost bound's lack of an org predicate (correct — it bounds
AcreOS's own spend, and the test now PINS the absence so nobody adds one by
analogy).

### A gate of mine that a mutation survived

The `featureFlagControlScope` check for "the server sends `controlledRoutes`"
searched the whole handler body, so dropping the fields from `res.json()` while
leaving their `const` declarations kept it green. The identifier was present;
the behaviour was not. Rewritten to assert on every `res.json()` payload. This
is the first law in CLAUDE.md applying to the gate written to enforce it, and it
is the reason mutation testing is done on every gate in this phase rather than
on the ones that feel risky.

### Known, recorded, deliberately NOT done

- **The `/api` catch-all's structural fix.** `app.use('/api', isAuthenticated,
  …)` applies auth to every later `/api` route by line number. It has caused
  three regressions, it currently shields a fail-open webhook comparison, and it
  makes the Meta lead-ads webhook non-functional. `apiCatchAllOrdering.test.ts`
  freezes the trap (two catch-alls, three anonymous registrations pinned ahead
  of them) but does not remove it: `fieldScoutRouter` spans `/properties`,
  `/leads` and `/voice`, so scoping the mount would strip accidental auth from
  every later route that never declared its own. Removing it safely requires
  auditing all of them first, and that is its own wave.
- **Meta lead-ads route ordering.** Moving it above the catch-all would make
  ingestion live — a product decision on a founder-only surface, not a defect fix.
- **USFS Wildfire Hazard Potential's authority.** It is a modeled raster and
  `EvidenceAuthority` has a `modeled` tier it is not using, but unlike FCC
  broadband nothing in the repository contradicts its current `authoritative`
  label. A domain judgement, not a defect this reading can evidence.
- **`routes-admin.ts:3031`'s duplicate `/api/config/features`.** Shadowed by the
  earlier registration in `routes.ts`, so dead — but it would serve a response
  with no deny-lists and none of the new fields if the order ever changed.


---

## PHASE 3 — CONSEQUENCE-RANKED TENANCY DEBT (2026-08-18)

Phase 2's Foundry ledger closed with all 22 candidates dispositioned. This phase
is §23's "consequence-ranked tenancy debt" item, and it was not planned — it
opened because a Phase-2 fix tripped a gate.

### How it started

Scoping `parcel_snapshots` reads for the property-report PDF gave
`ltvMonitor.estimatePropertyValue` org context for the first time. That promoted
it out of `check-org-scoped-fetch`'s rule-1 baseline (no org anywhere) into
rule 2 (has an org, resolves by primary key anyway) — and rule 2 reported the
primary-key read that rule 1 had been holding quietly.

**A completely unscoped function is LESS visible to that lint than a partly
scoped one.** That is a property of the tool, and it is why 163 baselined
rule-1 entries were worth re-reading rather than trusting.

### The method

Scan route handlers for "a URL id reaches a service method, and NO call in that
handler ever pairs that id with an org." Naive, that returns 143. Three
discriminators cut it to 28, and each exclusion is a real pattern worth naming:

- **GUARD-THEN-USE** — `getNote(org.id, noteId)` first, then an unscoped child
  read. Ownership was just proved. The dominant pattern.
- **FETCH-THEN-VERIFY** — read unscoped, then `if (row.organizationId !==
  org.id) return 404`. Correct, and invisible to a scanner watching call
  arguments. `buyer-prequalifications` and the VA action executor both do this,
  each with a dated comment.
- **DELIBERATELY PLATFORM-WIDE** — `requireFounder` routers such as dunning,
  which is AcreOS billing its OWN customers. Identity ≠ tenant ≠ authority; an
  org predicate there would be wrong.

### What was real

| Surface | Kind | Data |
|---|---|---|
| `GET /api/finance/ltv/:noteId` | READ | balance, property value, LTV, risk alerts |
| `GET /api/leads/:id/score-history` | READ | lead scores + recommendations |
| `PATCH /alerts/:id/{ack,resolve,dismiss}` ×2 routers | **WRITE** | portfolio alerts, incl. caller-supplied resolution text |
| `POST /api/pax/observations/:id/{acknowledge,dismiss}` | **WRITE** | Pax observations |
| `GET/POST /:leadId/{urgency,financial,engagement,offer-range}` | READ | lead signals, conversations, activities, valuations |
| `POST /api/writing-styles/:id/{samples,analyze,generate}` | **WRITE** | a tenant's voice profile |
| `PATCH /alerts/:id/resolve` (compliance) | **WRITE** | compliance alert, + a false audit entry |

`BASELINE_OFFENDERS` 166 → 149; rule-1 function baseline 126 → 124, rule-2
80 → 78. Every entry deleted in the commit that fixed it.

### Two bugs the tenancy work exposed that were not tenancy bugs

Threading an organization through forces every argument list to be re-read, and
two of them were wrong:

1. `suggestOfferRange(leadId, propertyId)` against a `(propertyId, signals)`
   signature. `req.body` is `any`, so it type-checked and the endpoint derived
   an offer range from whatever property shared an id with the lead.
2. `resolveAlert(alertId, resolution)` against `(organizationId, alertId)` — the
   query became `WHERE id = parseInt("<free text>")`, i.e. NaN. **The compliance
   alert was never resolved, and the route wrote an audit entry saying it was.**

A third instance is recorded in the code at `routes-seller-intent.ts`. Three of
one kind is a class, so the enabling condition got a gate:
`argumentOrderHazard.test.ts` fails on any two same-named functions whose shared
parameters are in opposite orders. Three real pairs found and aligned to the
house organization-first convention; two annotated exemptions (a storage/service
layering, and an arity difference) with the gate asserting each still matches.

### Founder rulings executed (picker, 2026-08-18)

- **KILL `GET /api/enhancements/campaign-roi/:id` + `calculateCampaignROI`** —
  no consumer, cross-tenant, and fabricating (`revenue = leads × $500`,
  `dealsCreated = leads × 0.1`). `attributionService.getAttributionReport`
  already computes the real thing, org-scoped and wired.
- **KILL the shadowed second `/api/config/features`** in `routes-admin.ts`.
- **Leave the Meta lead-ads webhook non-functional** — enabling ingestion is a
  product decision on a founder-only surface.
- **Leave USFS WHP `authoritative`** — nothing in the repo contradicts it.

Both KILLs are in `docs/company/deletion-ledger.md` with date and rationale. The
five remaining exports in `campaignEnhancements.ts` — including
`getCampaignBenchmarks`, which returns hardcoded 31% / 4.2% / 1.8% as
`avgOpenRate` / `avgResponseRate` / `avgConversionRate`, a second fabrication —
are recorded there for a ruling of their own rather than deleted alongside.

### Standing lesson

Every one of these was found by a gate reacting to an unrelated fix, or by
reading an argument list while changing something else. None was found by
looking for it. The gates that pay are the ones that get MORE sensitive as the
code gets more correct — which is exactly what rule 2 does, and exactly what the
argument-order gate is built to do.

---

## PHASE 4 — FABRICATED MEASUREMENTS (2026-08-18)

### The gap this phase exists to close

`lint:no-fabrication` scans for `Math.random`. The standing rule it enforces is
broader — *"no invented numbers, no fake activity, no placeholder data presented
as real"* — but the gate only proves **randomness is absent**. A hardcoded
constant presented as a measurement passes it every time, and three of them were
sitting on live customer surfaces. This is the same shape as the two laws in
`CLAUDE.md`: the gate was falsified against the symbol (`Math.random`), never
against the semantic defect (an invented number rendered as a measured one).

### What landed

**1. Climate risk — 40 of 50 states (`3be45090`)**

`CLIMATE_DATA` covers ten states. `assessClimateRisk()` answered for the other
forty with `overallRisk: "moderate"` and `{ level: "moderate", score: 50 }` — the
same shape as the ten real ones, and indistinguishable from them. The live
consumer is the customer's due-diligence PDF, where the lie took its second
form: the climate section only printed on a drought/coastal HIT, so an
uncovered state printed **nothing** — and in a document titled "due diligence",
printing nothing reads as *checked, nothing flagged*.

Fixed on both sides: `unknown`/`null` from the service, and an explicit
"Climate Risk: Not assessed" block in the PDF carrying the sentence *"absence of
a climate risk flag below does not indicate absence of climate risk"*. Four
mutations, all caught — including M2, a **different** fabricated default
(`"low"`/20), which proves the gate forbids the behaviour rather than the
literal 50.

**2. County opportunity score — a model fed its own defaults**

`computeCountyOpportunityScore` takes 21 market signals. AcreOS measures four of
them, sometimes. All three production callers closed the gap with literals:

| caller | constants supplied |
|---|---|
| `routes-epic-services.ts` | 17 (`avgDaysOnMarket: 90`, `monthsOfSupply: 6`, `estimatedInvestorMailingCount: 10`, `distanceToNearestMetroMiles: 80`, four `has…: false`, …) |
| `routes-data-intelligence.ts` | 12, the same values |
| `marketReportGenerator.ts` | `{ state, county } as any` — all 21 `undefined` |

So `GET /api/county-opportunity/:state/:county` returned, for **any county in
the United States**, a full markdown *Market Intelligence Report*: "Average days
on market: 90 days", "Sales volume (12 months): 20 transactions", a 0–100
opportunity score, and a recommendation to **buy**. Built entirely out of
constants.

`parcelIntelligenceFusion.ts` (~line 207) already contained the correct ruling,
written down and obeyed in exactly one place:

> *we deliberately DO NOT call `computeCountyOpportunityScore` here … feeding it
> hardcoded placeholder constants produced a fixed number dressed up as a
> "proprietary model" output.*

This is the recurring shape: **the right rule already existed somewhere else and
was not the one being used.**

Fixed by moving the refusal into the model, where no caller can route around it:
every signal is `number | null` / `boolean | null`; four `REQUIRED_SIGNALS`
without which it returns `null`; each dimension normalized over the signals it
could actually see; weights renormalized across the dimensions that scored; and
a `dataBasis` block ({measured, missing, dimensionsScored, weightCoverage}) that
travels with every score. Booleans are nullable for the sharpest reason:
`hasRecentInfrastructureAnnouncement: false` ASSERTS AcreOS checked and found
none; `null` says it never looked.

**3. A placeholder persisted into the database**

`countyAssessorIngest.ts` wrote `avgDaysOnMarket: 90, // Placeholder until we
track listing dates` into `county_markets` for every county it touched, and
`routes-epic-services.ts` read it straight back out as a measured fact. A
placeholder in a database is not a placeholder; it is data, and nothing
downstream can tell it from a measurement. Now `null`. Same for
`investorDemandScore: Math.min(100, Math.round(sales12.length * 2.5))` — a
rescaled sales count labelled "investor demand".

**4. A call that had never once succeeded**

`marketReportGenerator.getCountyOpportunityScore` called the model with
`{ state, county } as any`. It pushed *"Only undefined land sales in 12 months"*
into the red flags and then threw `TypeError` on
`input.monthsOfSupply.toFixed(1)`, which the surrounding `catch { return null }`
swallowed. It has therefore always returned null, silently, since it was
written — and the `as any` is what let it compile.

### A gate of mine that a mutation survived (again)

`"false and null score differently"` flipped **two** booleans at once. The
mutation that removed the null-guard from only `hasRecentInfrastructureAnnouncement`
stayed green, because the other field alone still made the two runs differ.
Rewritten as `it.each` over one field per case; both mutations now fail.

Second self-inflicted lesson, same commit: the source scanners initially matched
**their own fix comments**, which quote the constants they removed — 24 "offenders",
all prose. A gate that reads comments is matching text, not behaviour. They now
strip comments first, with a vacuity guard that fails if the stripper eats the file.

The caller scanner was also rewritten from a list of the old values to a
predicate on the **kind** of expression: a signal may be `null` or an expression
reading from data, never a bare numeric/boolean/string literal. So
`avgDaysOnMarket: 75` and `hasLakeOrRiver: true` fail exactly as `90` and
`false` did, and a signal added to the model is covered the day it is added
(`SIGNAL_NAMES` is derived from the input object, not retyped).

### Recorded, not fixed — with the reason

- **`scoreCountyForTargeting` (`sellerMotivationEngine.ts:703`)** carries the
  identical defect — `input.avgDaysOnMarket || 180`, `input.investorMailingCount
  || 10`, `input.growthRate5Year || 0` — and emits a `recommendation` and an
  `opportunityWindow` from them. It has **zero call sites**, so it is a latent
  copy of the same bug rather than a live one. Deletion ledger material, not a
  hotfix.
- **`EnvironmentalIntelligenceCard`** — zero call sites, and three of its five
  queries build `…/climate-risk/[object Object]` because they pass an options
  object as the second `queryKey` element under `getQueryFn`'s
  `queryKey.join("/")`. Two independent proofs it was never wired. In the
  deletion ledger for a ruling; repaired in place so it is honest if anyone
  wires it, which is not an argument for keeping it.
- **`negotiationEnhancements.ts:49-50`** — `avgDiscountFromAsking: 25` and
  `avgNegotiationRounds: 2.3` returned alongside genuinely computed
  `avgOffersToClose` and `winRate`, which is the most dangerous packaging: real
  and invented figures in one object, identically shaped.

### The generalisable finding

A `|| <constant>` on a metric is the fabrication idiom in this codebase, and it
is invisible to every gate currently running. `avgDaysOnMarket || 90`,
`investorMailingCount || 10`, `salesVolume12Months || 20`,
`medianPricePerAcre || "1000"` — each reads as a harmless default and each
produces a number a customer cannot distinguish from a measurement. The
type-level fix that actually holds is the one applied here: make the field
`| null`, so the absence has a representation and `||` has nothing to swallow.

### Founder rulings executed (picker, 2026-08-18, phase 4)

- **`GET /api/county-snapshot` keeps its score field, null with a reason.** The
  endpoint's USDA/Census content is real; the score is not computable from it
  and now says exactly which signals are missing. The absence is the spec for
  the transaction feed that would fill it.
- **KILL `EnvironmentalIntelligenceCard`** — executed: the component, `POST
  /api/environmental/highest-best-use`, and the five HBU symbols the route
  solely owned. `GET /api/environmental/climate-risk` survives, correcting the
  ledger row's original listing: `assessClimateRisk` is live through the
  due-diligence PDF and that endpoint is its HTTP face.
- **`scoreCountyForTargeting` NOT killed** — stays in the ledger as a recorded
  latent copy.
- **`campaignEnhancements.ts` five exports NOT killed** — still awaiting their
  own ruling.
- **Negotiation analytics computed from real offer data**, not nulled: both
  literals replaced with derivations off the `offers` table, plus a `basis`
  block reporting the population behind each figure.

### Two more of my own gates that a mutation exposed

`negotiationAnalyticsHonesty` — M4 removed the `offer_percentage IS NOT NULL`
predicate and the suite stayed green. On inspection the gate was RIGHT and the
mutation was wrong: SQL's `avg()` already skips NULLs, so the predicate is
semantically redundant and no behavioural assertion could distinguish it. But
the test's NAME ("excluded, not zeroed") claimed something it did not prove.
The load-bearing choice is `count(offer_percentage)` vs `count(*)` — the
denominator reported as the basis for the average — and that is invisible in
the returned numbers too, so it is now pinned on the generated drizzle
expression. M5 (`count()` for `count(offers.offerPercentage)`) fails.

The rule this makes concrete: **when a mutation does not fire, first establish
whether the mutation was semantically null.** If it was, the gate is fine and
the test's claim is what needs correcting — an overclaiming test name is its own
kind of false green.

## PHASE 5 — THE `|| <constant>` IDIOM (2026-08-18)

### The scan that found the rest

A throwaway scanner over `server/**/*.ts` for `<metric-shaped identifier> ||
<non-zero literal>` (and `??`) returned **129 candidates**. Most are legitimate
config defaults — `days ?? 30` for a query window, `gracePeriodDays ?? 10` read
off a note's own terms, `expirationDays ?? 10`. The dangerous subset is narrow
and specific: **a measurement of the world, defaulted to a plausible value, then
presented to a customer as measured.**

Ranked by consequence, the ones acted on:

| site | the constant | what it reached |
|---|---|---|
| `acreOSValuation.ts:75` | `compsMedianPricePerAcre \|\| 1000` | the AVM — a billable valuation |
| `dealFeedEngine.ts` | four pillars seeded 50 / 575, `acreage \|\| 5` | the daily deal feed's ranking and its dollar offers |
| `countyAssessorIngest.ts:484` | `avgDaysOnMarket: 90` | persisted into `county_markets` |
| `negotiationEnhancements.ts:49` | `25` / `2.3` | a live analytics endpoint |

Still recorded and unfixed, with reasons in the deletion ledger or here:
`acquisitionRadar.ts:340` (`medianDaysOnMarket || 90`),
`dataIntelligenceEngine.ts` (`medianDomDays ?? 180`, `medianHouseholdIncome ??
50000`), `marketPrediction.ts` (`avgDaysOnMarket || 60`),
`leadIntelligenceEngine.ts:315` (`pasturePerAcre || 1000`),
`parcelIntelligenceFusion.ts:831` (`opportunityScore || 50` — in the very file
that documented the refusal), and the LLM-parse family (`parsed.confidence ||
0.5`), which is a milder class: a model that returned no confidence gets one.

### A fix that deleted the symbol and left the behaviour

`generateValuation` carries a note from an earlier honesty pass: *"the old
`= 1000` seed meant every parcel in America 'was worth' $1,000/acre the moment
both real paths failed — branded as a proprietary model."* That fix removed the
visible `= 1000`. One level down, inside the model's own feature vector, sat
`pricePerAcreComps: compsMedianPricePerAcre || 1000` — and the only caller
passed `0`, so it fired on **every call**.

This is the clearest instance yet of the first law in `CLAUDE.md`, and it
happened to a fix that had already been made once, by someone who had correctly
identified the defect and written down why it mattered. Deleting the identifier
is not deleting the behaviour.

Second finding in the same function: `confidence = min(85, 50 + topImportance *
200)`, where `topImportance` is a property of the **trained model**. Every
parcel a given model ever scored reported the same confidence. A confidence
that cannot vary with the input is not a confidence.

### A tenancy leak found while fixing a fabrication

`generateDealFeed` gathered candidates with `.from(properties).where(and(LOWER(state)
= …, LOWER(county) = …))` — **no organization predicate**. `properties.organization_id`
is NOT NULL with a cascade FK; there is no shared parcel pool. So the daily feed
built for one org drew candidates from every org's parcels in its target
counties, and `buildOpportunity` returns APN, address, coordinates, assessed
value, tax-delinquency signals and owner-motivation analysis — then persists
them into the reading org's `daily_deal_feed`.

`check-org-scoped-fetch` was green over it before and after, and the reason is
the property already recorded in phase 3: **rule 3 treats a function as
org-scoped when the string `organizationId` appears anywhere in its body.**
`generateDealFeed` is org-scoped in six other places, so a partly-scoped
function HIDES an unscoped query inside it. The gate's blind spot is not
"unscoped functions" — it is "unscoped queries in scoped functions", which is
strictly harder to see and strictly more likely as a codebase gets more correct.

### "Fall open to neutral" is fabrication with a reassuring name

Three sites in `dealFeedEngine` were documented as deliberate:

- `NEUTRAL_RADAR_SCORE = 50` — *"Keeps the feed honest rather than crashing or
  fabricating a high score."* It did prevent a HIGH score. It did not prevent a
  fabricated one, and the comment's own framing — that the alternative to a
  default is a crash — is what hid the third option.
- `scoreColdParcelMotivation`'s *"honesty gate → fall open, no regression"*: the
  gate detects that the biography has no real series, returns null, and the
  caller substitutes 50. The gate found the truth and the caller discarded it.
- `countyOpportunity` was seeded 50 and **never assigned from anything**, so
  20% of every composite score in the feed was a constant.

All three now propagate null, and `computeComposite` renormalises over the
pillars that scored. A parcel with no pillar at all is dropped from the feed
rather than ranked, because "the ten best parcels we found" is a claim and an
unscored parcel is not evidence for it.

### The mutation-testing lesson, third instance

M3 on the deal-feed gate did not fire, and the reason was neither the gate nor
carelessness: `acreage || 5` appeared TWICE, and the caller-side guard returns
before the calculator runs, so the second occurrence is **unreachable**.
Mutating unreachable code is semantically null. Removing BOTH does fail.

The first attempt at handling this added a `forceComps` knob to "isolate" the
second guard — which could not work, because a mock cannot bypass a `return`
that happens before the mock is called. That knob was removed rather than kept:
a test fixture that pretends to isolate something it cannot is the same
overclaiming failure as a test NAME that does, and both read as coverage.

**The rule, now stated three times in three phases:** when a mutation does not
fire, establish which of three things is true before changing anything —
the gate is weak, the mutation was semantically null, or the mutated code is
unreachable. Only the first calls for a stronger gate.

## PHASE 6 — RULE 3: THE GATE'S BLIND SPOT, CLOSED (2026-08-18)

### The blind spot, stated precisely

`check-org-scoped-fetch` had two rules, and both judge a **unit**:

- **Rule 1** — does this method/function mention an organization anywhere?
- **Rule 2** — a unit that HAS an org: does it resolve an org-scoped table by
  primary key without using it?

The deal-feed leak passed both, and not by accident:

```
generateDealFeed(orgId)                     // org-scoped six other ways
  await db.select().from(properties)        // <- no org predicate
    .where(and(LOWER(state) = …, LOWER(county) = …))
```

Rule 1 saw `organizationId` in the body. Rule 2 had nothing to say because the
query resolves by county, not by id. So the blind spot is not *unscoped
functions* — it is **unscoped QUERIES inside scoped functions**, and this is the
class that gets MORE likely as the codebase gets more correct: every fix that
adds an org predicate somewhere in a function pushes the rest of that function
out of rule 1's view. The same mechanism was recorded in phase 3 from the other
direction ("a completely unscoped function is LESS visible than a partly scoped
one"); this is its second and worse consequence.

### Rule 3

Walks each `.from(<org-scoped table>)` **chain** — `.from(` to the statement's
`;` at paren depth 0 — and asks whether THAT chain names the org. Four
discriminators, each for a false-positive family verified by hand:

| discriminator | family it removes |
|---|---|
| enclosing unit must have an org | rule 1's job |
| chain must not resolve by primary key | rule 2's job; guard-then-use |
| founder/platform/admin/telemetry/migration paths excluded | platform-wide by design |
| hoisted predicate variables not guessed at | stated as a limit, not papered over |

**947 → 361 → 127.** The register holds cases worth reading rather than a wall
of noise. Most are legitimate and are recorded as such: a verified-parent join
(`offers.batchId` after the batch was org-checked), a deliberate all-org sweep
that then loops per org, the frozen cross-org marketplace, a ternary predicate
whose branches both carry the org.

### Falsified against the semantic defect, per the first law

The rule was mutation-tested against the thing it governs, not the thing it
mentions:

- **Reintroduce the exact deal-feed leak** → rule 3 fires, gate red.
- **Equivalent representation** — remove the org predicate from the query but
  ADD an unrelated `organizationId` mention to the function body, which is
  precisely what defeated rules 1 and 2 → still fires.
- **Report but do not fail** (drop rule 3 from the PASS condition) → the canary
  test fails. A gate that prints a finding and exits zero is not a gate.
- **Break the chain walker** (`.from` → `.fromZZZ`) → the vacuity floor fails,
  loudly, rather than reporting every query as scoped.
- **Drop the primary-key discriminator** → the baseline inflates past its
  ceiling and the pin fails.

`orgScopedFetchCoverage.test.ts` gained a live **canary**: it writes a real file
into `server/services/` containing a function that mentions `organizationId` and
still reads `properties` without it, runs the lint, asserts it names the file
AND exits non-zero, then removes it. A canary the gate never walks is not a
canary — this one is written where the walk actually goes.

### What this buys

The two earlier tenancy phases fixed occurrences. This one changes what the
repository can *see*: 127 previously invisible queries are now frozen and
down-only, a new one has to be looked at, and the specific shape that shipped a
live cross-tenant read cannot return silently.

## PHASE 7 — `lint:measurement-defaults` (2026-08-18)

### The same law, applied to the other blind gate

Rule 3 closed the tenancy gate's blind spot. This closes the fabrication gate's.

`lint:no-fabrication` enforces *"no invented numbers, no fake activity, no
placeholder data presented as real"* by scanning for `Math.random`. It proves a
**symbol** is absent. The shape that actually shipped, four times, to live
customer surfaces is a **behaviour**:

| expression | surface |
|---|---|
| `compsMedianPricePerAcre \|\| 1000` | a billable AVM |
| `marketData?.avgDaysOnMarket \|\| 90` | a market intelligence report |
| `parcel.acreage \|\| 5` | three dollar offer amounts in the deal feed |
| `parcel.acreage ?? 1` | an offer batch (fixed in this commit) |

### The discriminator

Not every `?? N` is a lie, and a gate that says so is disabled within a week.
The question is **where the value came from**:

```
opts.days ?? 30                     a caller-supplied knob. Normal.
marketData?.avgDaysOnMarket || 90   a measurement. Fabrication.
```

A hit needs all four: a property access (not a bare local), a **non-zero**
literal (0 is the honest empty and the standard divide-by-zero guard), a leaf
name in the measurement vocabulary, and a root that is not an options bag.
**2,031 expressions considered → 77 in the register.**

### Two things this gate does that the old one does not

**It self-tests its own predicate on every run.** Nine cases, both directions —
four that must fire, five that must not. That caught two real defects before the
register was ever frozen: the measurement vocabulary was `$`-anchored and
therefore missed `avgDaysOnMarket` (ends in "Market"), the exact expression the
gate was written for; and the bare-local case was silently uncovered.

**It states what it cannot see.** A bare local (`compsMedianPricePerAcre ||
1000` — the AVM defect verbatim) has no receiver to judge, and resolving a local
back to the property it came from is dataflow, not regex. That limit is written
into the header AND pinned as a self-test case asserting the gate does NOT fire,
so the boundary is itself a tested contract rather than something a reader
discovers from a false green. The AVM case is covered behaviourally instead, by
`gbmValuationRefusal.test.ts`.

### Falsified against the behaviour

`measurementDefaultsGate.test.ts` writes probe files into `server/services/`
(where the walk actually goes), runs the real lint, and asserts:

- the deal-feed `parcel.acreage || 5` fires **and the lint exits non-zero**;
- an **equivalent representation** — different metric, `??` instead of `||`, a
  different number (`row.medianHouseholdIncome ?? 48250`) — also fires, proving
  the gate governs the shape rather than the constants that happened to be
  there;
- `opts.days ?? 30` does **not** fire;
- `row.salesVolume || 0` does **not** fire.

Mutations, all caught: report-but-exit-zero (2 tests), drop the knob
discriminator so it fires on everything (3 tests), and blind the expression
walker (5 tests).

### What is in the register, and what to fix next

Ranked, so the next session does not have to re-derive it:

1. **Market measurements** — `intel.medianHouseholdIncome ?? 50000`,
   `medianDomDays ?? 180`, `nassData?.pasturePerAcre || 1000`,
   `latestMetric.marketHealthScore || 50`,
   `profileData?.opportunityScore || 50` (in the very file that documented the
   refusal). Highest consequence; these are the AVM/deal-feed class.
2. **Contract terms** — `note.gracePeriodDays ?? 10`, and `documents.ts:163`
   PRINTS it into a customer PDF as "Grace Period: 10 days" for a note whose
   record does not carry one. A legal document asserting a term nobody agreed
   to is arguably sharper than any of the above.
3. **Autopilot trust/urgency seeded at 50** — the same neutral-midpoint pattern
   removed from the deal feed, still present in `executionEngine`,
   `agentInitiativeEngine`, `scpGoldenSuite`, `autonomousDecisionExecutor`.
4. **LLM-parse confidence** (`parsed.confidence || 50`) — the largest family and
   the lowest individual consequence: a model that stated no confidence is given
   one.

## PHASE 8 — THE ENGINE AND THE SIGNED NOTE DISAGREED (2026-08-18)

First item off the phase-7 register, and the sharpest one on it.

Three call sites read `acquired_notes.grace_period_days`:

```
server/jobs/acquiredNoteAging.ts   note.gracePeriodDays ?? 0
server/services/documents.ts       note.gracePeriodDays || 10
server/routes-documents.ts         note.gracePeriodDays || 10
```

For a note whose record does not state a grace period, AcreOS measured
delinquency against **zero** days while the promissory note it generated — the
document with a SIGNATURES block — promised **ten**. A borrower could be marked
late by the servicing engine inside a window the instrument grants them.

And `||` fires on `0`. A note whose record explicitly grants **no** grace period
produced a legal instrument asserting ten days. That is not a default filling a
gap; it is a document contradicting the record it was generated from.

`shared/notes/delinquency.ts` gained `noteGracePeriodDays()` — an explicit `0`
is a real term, `null`/non-finite/negative means the record states none, and
nothing is ever substituted. All three sites consume it, which is the second law
applied deliberately: this function exists *because* three copies disagreed, so
adoption is the whole point rather than an afterthought.

The callers then diverge **on purpose**, and the divergence is documented at
both ends: the aging sweep still measures an unstated term as zero (an internal
signal can be re-derived) while the documents decline to state a term at all (a
signed instrument cannot). The sweep surfaces `graceStated: false` so the
assumption is visible.

### Two self-corrections worth keeping

**I broke a stated purity property.** `planNoteAging`'s docstring says "No db,
no clock, no logger — so every rule above is directly testable", and my first
version put a `logger.info` inside it. Reverted: the fact travels out on the
return value as `graceStated`, and the impure caller logs it. A docstring that
states an invariant is part of the contract.

**A test of mine passed vacuously and one assertion caught it.** The aging
fixture omitted `paymentDueDay` / `originationDate` / `maturityDate`, so
`planNoteAging` returned "note is missing schedule facts" and two assertions
compared `0` to `0` and agreed. Only the one test that demanded the values
*differ* failed. The fixture is now complete and carries an explicit vacuity
guard asserting `skipReason === null` and `daysDelinquent > 0`.

Third correction, same file: that failing assertion was aimed at
`daysDelinquent`, but `computeNoteDelinquency` documents that it accepts the
grace parameter and **ignores it deliberately** — grace governs fees, not the
day count. The test was wrong, not the code, and it now asserts on
`lateFeeAdvisory`, the one output grace actually moves. Same discipline as the
mutation lesson: establish which side is wrong before changing either.

**A third self-correction, from a different gate.** The first version of the
aging fixture ended `} as AgingNoteRow`, and `check-tests-typecheck` flagged it
as a new offender (162 → 163). That gate's rationale is exactly the hazard: a
cast lets a fixture omit or misspell a field, and the test then asserts on
something that does not exist and passes forever. The cast was papering over a
real mismatch — `AgingNoteRow.id` is a `string`, and the fixture had a number.
Fixed by typing the fixture rather than by widening the baseline.

Three gates caught three different mistakes of mine inside one change:
`check-tests-typecheck` (the cast), the suite's own failing assertion (the
vacuous fixture), and `lint:measurement-defaults` (the stale register entries).
That is the ratchet system working as designed, on the author rather than on
someone else.

### The gate caught its own reduction

`lint:measurement-defaults`, added hours earlier, reported both
`note.gracePeriodDays || 10` entries **stale** the moment they were fixed —
exactly what a down-only register is for. Baseline 77 → 75, locked in.

## PHASE 9 — WHEN A DEFAULT LANDS IN A BAND THAT FLAGS (2026-08-18)

Second item off the phase-7 register: the market-measurement group in
`dataIntelligenceEngine`. It turned out to be a sharper variant of the pattern,
and the variant is worth naming.

### The variant

Every previous instance inflated a SCORE. These fell into a band that **pushes
a flag** — so the invented number was rendered as a finding, in prose, with an
impact statement beside it. Both routes pass `req.body || {}` straight in, so
`{}` was a fully-formed assessment:

| default | what it emitted |
|---|---|
| `inputs.medianDomDays ?? 180` | negative flag: *"180+ median DOM · Illiquid market — exit may be difficult"* |
| `inputs.distanceToPrimaryRoad ?? 10` | negative flag: *"10.0 miles to road · Remote location limits buyer pool significantly"* |
| `inputs.acresSize ?? 5` | **positive** flag: *"5.0 acres · Optimal parcel size for owner-financed land business model"* |

The third is the sharpest. An invented measurement presented as a FAVOURABLE
finding, in a scorer whose recommendation ranges over STRONG_BUY … DEAL_KILLER.
It is also the **fifth** place in this codebase where a parcel of unknown size
was assumed to be five acres — after `dealFeedEngine` (twice) and
`offerBatchService` (twice, as one acre).

`scoreCounty({})` had the same shape one level up: `medianDomDays ?? 180` (5 of
35 market-health points), `dataQualityScore ?? 0.5` (4 of 20 on the axis that is
ABOUT how much data exists), `ruralUrbanCode ?? 5`, and an asserted household
income — producing a real **TIER**, which is a buy/avoid instruction.

### The fix, and the one that was already right

Each signal now scores only when measured, and says so when not.
`scoreCounty` refuses below three of eight signals and returns
`tier: "UNSCORED"` with a `dataBasis`.

Worth noting: the comp-count branch in the same function **already did this
correctly** — `intel.soldCompsLast12mo ?? 0` scores nothing and pushes *"Low
comp count — gather more sold data before committing to this county"*. The
right pattern was sitting four lines above the wrong one, in the same function,
written by the same hand. That is the recurring shape of this whole campaign:
the correct rule usually already exists somewhere nearby and is not the one
being used.

Also fixed: `confidence` was clamped only at the top (`Math.min(0.99, …)`), and
the new unmeasured branches subtract from it — so it could go negative, outside
the field's own documented 0–1 range. Clamped at both ends.

### Mutation-tested, including the over-correction

  M1 restore `acresSize ?? 5`                     -> 2 tests fail
  M2 an EQUIVALENT default (8 acres, not 5)       -> 2 tests fail
  M3 `scoreCounty` stops refusing                 -> 2 tests fail
  M4 make EVERYTHING unknown (over-correct)       -> 1 test fails

M4 is the one that matters for a fix of this kind. Every "does not fabricate"
assertion passes trivially if the fix simply stopped scoring anything, so the
suite also demands that a fully-measured parcel scores HIGHER and still states
the measurements it was given.

Ratchet: `lint:measurement-defaults` 75 → 72, reported stale by the gate itself
and locked in.

## PHASE 10 — WHERE A DEFAULT BECAME A COMMITMENT (2026-08-18)

Completes the phase-7 market-measurement group. Everything fixed before this
inflated a score, a report or a ranking. Two of these **spent money**.

### The offer quoted to a property owner

`computeOfferIntelligence` (leadIntelligenceEngine) read

```
parseFloat(lead.acres || lead.acreage || "5")   and   nassData?.pasturePerAcre || 1000
```

For a lead with no acreage on file in a county USDA has no value for, that is
`1000 × 0.25 × 5` = a **$1,250 offer** — and `offerPrice` is interpolated
verbatim into the outreach message sent to the owner: *"My offer for your X
County property is $1,250."* A dollar figure quoted to a counterparty, from two
constants. Both inputs are now required, and the six message angles have
price-free variants that open the conversation without naming a number.

`buildNextBestAction` had the same shape for the operator ("Send blind offer
letter today at $1,250") and now says the figure is not established yet.

### The instruction to spend

`rankCountiesForCampaign` (parcelIntelligenceFusion) read
`profileData?.opportunityScore || 50`, and 50 lands on **"Test with 500
letters"** — an instruction to spend money, issued for a county nothing had
scored. That file's own header, ~620 lines above, documents refusing to feed a
scoring model placeholder constants. The rule was written down in the same file
that broke it. Unscored counties now return "Not scored — no county profile on
file" and hold no rank.

### Three of my own errors, and what each teaches

**A regex gate governed a spelling, not a behaviour.** The first assertion
matched the source for `lead.acres || lead.acreage || "5"`. The mutation that
restored it as `lead?.acres || …` — one character different — sailed straight
past. There is always another spelling. Replaced with behavioural assertions:
`scoreLeadIntelligence` touches no database on that path, so the real function
is called and the returned `estimatedOfferPrice` and `recommendedMessage` are
asserted. The redone mutation fails.

**A file-wide assertion found a second occurrence I had missed.** The same file
carried a SECOND `|| "5"` on the profile's own `acres` field, next to the offer
computed from the first. The test written for occurrence one is what found
occurrence two — the argument for asserting on the general form rather than the
one call site.

**I annotated the wrong consumer.** My comment claimed `maps.tsx` and
`blind-offer-wizard.tsx` render `leadIntelligenceEngine`'s
`countyContext.usdaLandValuePerAcre`. They do not — they read the
identically-named field on `blindOfferCalculator.marketContext`, which carried
the same `|| 0` and was the live one. The wrong-target mutation (M5) survived
until that was found, and both are now fixed: the live one behaviourally
tested, the dormant one corrected because the next consumer would inherit it.

`|| 0` is worth naming here, because this gate deliberately treats zero as the
honest empty. For a **land value per acre** it is not: the page rendered "Offer
modeled from USDA land values ($0/ac)" — land priced at nothing, presented as
the basis for an offer. Zero is only the honest empty for a COUNT.

### A flaky gate of my own, fixed rather than retried

The full suite failed once on `climateRiskRefusal.test.ts` (phase 4) with the
TX render containing the OH render's "Climate Risk: Not assessed" line. It
passed on re-run, at HEAD, and four times in a row afterwards — and a bisect
across the working set produced contradictory results, which is itself the
signature of chasing noise rather than a cause.

The cause: the three PDF cases shared one module instance and one `printed`
buffer, cleared only in `beforeEach`. Every `Promise.allSettled` branch in
`generateFullReport` rejects under those mocks (no db) and
`recordSnapshotAsync` is fire-and-forget, so a late write from the previous
case could land in the next case's buffer.

Fixed at the source — `vi.resetModules()` per render, buffer cleared
immediately before the call, text snapshotted synchronously after — plus a
guard that throws if a render produces almost no text, since an empty render
would make every `not.toMatch` in the file pass vacuously.

Recording it because the temptation was to re-run and move on: a gate that
fails intermittently is a gate that gets ignored, and then it guards nothing.

## PHASE 11 — UNAVAILABILITY WAS PERMISSION (2026-08-18)

Started from the phase-7 register's autopilot group (`agent?.trustScore ?? 50`)
and found something sharper next to it.

### The seeded 50 is not the defect

`trustAuthorityEscalation.getTier(50)` returns tier 0 — *"Observer — Recommend
Only"*, allowing only `generate_report` and `store_learning`. So an agent with
no trust record lands in the MOST restrictive tier. That default is
conservative and stays. Worth stating plainly, because the register flagged it
and the honest answer was "this one is fine".

### The defect beside it

`validateSafetyGates` returns `passed: violations.length === 0`, and four of its
gates were wrapped in swallowing catches:

```
} catch { /* governance brain may not be available */ }
} catch { /* trust service may not be available */ }
} catch { /* delegation service may not be available */ }
} catch {}                                    // deal value threshold
```

An unavailable governance brain, trust service, delegation service or database
contributed **no violation** — and no violation is a PASS. Unavailability was
permission, on the function that authorises autonomous agent actions including
`advance_deal_stage` and `send_churn_intervention` (a customer contact).

The comments were the tell: *"may not be available"* names the failure and then
treats it as success. This is the identity ≠ authority lesson in its quietest
form — not a wrong authority decision, but an authority decision that never
happened and reported as if it had.

### The right pattern was one gate above

`checkRateLimit`, immediately preceding these four in the same function:

```
} catch { return { allowed: false, reason: "rate-limit state unverifiable — refusing action (fail closed)" }; }
```

Same file, same function, one gate earlier. Fourth recorded instance this
session of the correct rule already existing adjacent to the broken one — after
`parcelIntelligenceFusion`'s own header, `dataIntelligenceEngine`'s comp-count
branch, and `outcomeBasis` in the original Foundry transfer.

### The fix and its proof

Each check now records a violation naming the gate that could not be evaluated,
with the underlying error and a route forward (restore the service, or
`escalate_to_founder` to proceed under human authority), and logs it. Failing
closed on an authority gate is the only safe direction.

`safetyGateFailClosed.test.ts` drives the real `executionEngine.execute()` with
each dependency made to throw in turn. Its first assertion is a vacuity guard —
with every dependency healthy the action must NOT be blocked by an
unevaluable-gate violation — so "refuse everything" cannot pass for a fix.
Mutations restoring each swallowing catch individually all fail.

### The fail-open class, scanned — a mostly NEGATIVE result

After the `executionEngine` finding, a scan of `server/**` for **empty catches
in gate-shaped context** returned 524 empty catches, 133 of them near
gate/guard/authorize/verify vocabulary. Auditing the highest-consequence subset
by hand — auth, security, middleware — the class is **handled correctly almost
everywhere**:

- `middleware/security.ts` — an invalid `APP_URL` simply is not added to the
  CORS allowlist. More restrictive, not less.
- `middleware/getOrCreateOrg.ts` (two sites) — a failed membership lookup
  leaves `org` null and falls through to the user's OWN org. Fail-closed for
  tenancy, which is the direction that matters.
- `routes-account-security.ts:147` — if the session lookup throws,
  `sessionUserId` stays null and `null !== clerkUserId` returns 403. Textbook.
- `routes-autopilot.ts:366` — a draft's example county; advisory, and annotated
  as such.

`executionEngine` was the outlier, not the tip of an iceberg. **Recording the
negative result deliberately**: it bounds the class, and the alternative — a
ratcheted gate over 133 mostly-correct sites — would have frozen noise and
taught future sessions that empty catches are suspect when they usually are
not. A gate whose register is mostly false positives gets ignored, and then it
guards nothing.

One real case did come out of the audit: `routes-account-security.ts` reported
`twoFactorEnabled: false` whenever the identity provider was unreachable,
unconfigured, or the lookup threw — and `account-security.tsx` renders that as
a red **"not enrolled"** badge. An unavailable check displayed as a finding
about the user's own security posture, on the page whose job is to state it.
Now `boolean | null`, rendering "unknown", with the failure logged.

`fcraAttestationStale`, ten lines below in the same handler, already did this
correctly (`boolean | null`, "leave null" on error). **Fifth instance this
session of the correct rule sitting adjacent to the broken one.** That
frequency is itself the finding: this codebase usually knows the right answer
somewhere within a few lines of where it gets it wrong, which is why reading
the neighbours has been the highest-yield technique in the whole campaign.

## PHASE 12 — THE REBUILD NEEDS ONE PASS, NOT TWO (2026-08-18)

Top of the "WHAT TO DO NEXT" list: *"43 migration files still fail on a clean
first pass … Making one pass sufficient is the real close-out."*

That section also says the highest-leverage tool here is a local PostgreSQL,
and it is right — every number below came from standing one up and running the
rebuild, not from reading the files.

### The cycle was three tables wide, not general

The runbook attributed the two-pass requirement to a circular dependency
between `migrations/*.sql` and `scripts/migrate.mjs`. Measured:

| | tables | statements skipped |
|---|---|---|
| SQL pass 1 + migrate.mjs | 755 | 44 |
| SQL pass 2 + migrate.mjs | 757 | 2 |

**The only two tables the second SQL pass created were `earnest_money_events`
and `rehab_photos`**, and each had a single unmet edge —
`0086` needs `earnest_money_holds`, `0089` needs `rehabs` **and**
`rehab_line_items`, all three created by migrate.mjs, which runs after.

`0085_rebuild_prereq_tables.sql` creates those three ahead of their dependants.
Definitions copied verbatim; both sides use `IF NOT EXISTS`, so whichever runs
first wins.

The `rehab_line_items` edge only became visible after the `rehabs` edge was
closed — the first ERROR in a file masks the ones behind it. Worth stating
because it is the general hazard of debugging migrations by reading logs:
adding `rehabs` alone moved the count 755 → 756 and left `rehab_photos` still
absent.

### A measurement mistake of my own, corrected

The first run used `psql -v ON_ERROR_STOP=1` and reported 40 failing files.
That number was an artefact: `0003_robust_namora.sql` errors at line 1571, so
ON_ERROR_STOP aborted the remaining ~1,000 statements of a file that creates
much of the schema, and everything downstream then failed on columns that
would otherwise exist. The runbook's loop uses plain `psql -f`, which continues
past errors. Re-measured in runbook mode: 68 files with at least one error, 155
errors — a different and much less alarming picture. **Measure the way the
thing actually runs, not the way that produces the cleanest signal.**

### The last two skips were a real drift, not an ordering artefact

After the prerequisite fix, two statements still skipped every run:

```
SKIPPED: CREATE INDEX fsv_org_idx ON field_scout_visits(organization_id)
SKIPPED: CREATE INDEX fsp_org_hash_idx ON field_scout_photos(organization_id, image_hash)
```

`0003_robust_namora.sql` creates both tables and carries an explicit
**"⚠ STALE — DO NOT TRUST THIS SHAPE"** block over them, naming the canonical
shape in `migrate.mjs` and instructing that 0003 must not be edited (Drizzle
journal hash). Both true — and together they left a gap nothing could close:
0003 runs first, so migrate.mjs's canonical `CREATE TABLE IF NOT EXISTS` is a
no-op and the columns never arrive. **A database rebuilt from this repository
had no `field_scout_visits.organization_id` at all**, while
`shared/schema.ts:18052` declares it `notNull()`.

`0004_field_scout_canonical_columns.sql` adds the missing columns with
`ALTER … ADD COLUMN IF NOT EXISTS`, which converges from both starting points.
`organization_id` is added NULLABLE and the reason is written into the file: a
NOT NULL column with no default fails against a table that already holds rows,
and a migration cannot see the row counts. The residual drift is stated rather
than papered over.

### Result

**One SQL pass + two migrate.mjs runs → 757 tables, ZERO statements skipped.**
The expensive half of the loop — a second pass over 243 SQL files — is gone.

The second migrate.mjs run is still needed: 37 of its own statements depend on
tables it creates later in the same file. That is an ordering problem *inside*
migrate.mjs and the next close-out, and it is now the only thing standing
between here and a single-command rebuild.

`migrationDefinitionParity.test.ts` pins the duplicated definitions column-for-
column and asserts both new migrations sort before what they unblock — an
ordering fix that sorts after its dependants fixes nothing. Mutations: dropping
a column from the copy fails; renumbering 0085 → 0095 fails; making
`organization_id` NOT NULL fails.

### The climate flake, properly fixed on the second attempt

The first fix (per-render `vi.resetModules()` + clearing the shared buffer)
was not enough — the suite failed again on a different case. Diagnosis was
blocked by the file passing **6/6 in isolation**, which located the problem as
cross-FILE rather than intra-file and ruled out the theory the first fix was
built on.

Rather than clear harder and hope, the shared `printed` array was replaced with
a per-render buffer plus a **quarantine buffer**: the moment
`generateFullReport` resolves, the mock's write pointer moves to `lateWrites`,
and an `afterEach` asserts `lateWrites` is empty. A late write now lands
somewhere harmless AND fails loudly with the reason.

That is the difference between fixing a flake and hiding one: the second
version cannot absorb the bug silently, because the bug now has its own
assertion.

## PHASE 13 — ONE COMMAND REBUILDS THE DATABASE (2026-08-18)

Phase 12 ended by naming the last obstacle: *"37 of migrate.mjs's own
statements depend on tables it creates later in the same file. That is an
ordering problem inside migrate.mjs and the next close-out."* Closed.

### All 37 were the same kind

Measured: every one of the 37 was an `ALTER TABLE` or `CREATE INDEX` sitting
EARLIER in the statement list than the `CREATE TABLE` it needs — eight tables
in total (`agent_action_log`, `cancellation_surveys`, `evolution_history`,
`lease_tenants`, `move_inspections`, `note_acquisitions`, `rental_leases`,
`subdivision_plans`). `cancellation_surveys` is the clearest: dependants at
line ~183, its CREATE at ~1949.

Nothing was missing. The list was out of order, and the second invocation of
the script existed to paper over it.

### The fix is in the runner, not the list

`migrate.mjs` now retries its skipped statements **once**, at the end of the
same run. The alternative — reordering a 10,000-line hand-maintained list — is
the riskier one: each `CREATE TABLE` carries its own foreign keys, so moving one
earlier can break a dependency that currently holds. The retry needs no
reordering at all.

Three properties were built in deliberately, because each is a way the change
could have been weakened while staying green:

- **Bounded.** `splice` drains the list once and the retry iterates that
  snapshot, so a statement that skips again cannot loop forever.
- **Case (a) survives.** A genuinely absent prerequisite still skips and is
  still reported — now with "even after the retry pass".
- **A retry failure ESCALATES.** A statement the first pass classified as a
  non-fatal skip, which then fails differently on retry, becomes a real failure
  with a non-zero exit. The softer first-pass verdict must not stand.

### Result

**One SQL pass + one `migrate.mjs` run → 757 tables, 37 resolved on the retry,
ZERO skipped, ZERO failures, exit 0.**

Across phases 12 and 13 the documented rebuild went from *two passes of 243 SQL
files plus two script runs* to **one of each** — and from "2 statements skipped,
that's fine" to zero.

`migrateRetryPass.test.ts` pins all three properties plus the runbook itself
(it must document the measured procedure, and the old two-pass loop must be
gone — an operator following a stale runbook is the failure this whole
sequence started from). Mutations: removing the retry fails 3 assertions;
swallowing a retry failure fails 1; making the retry unbounded fails 1.

## PHASE 14 — THE DRILL FOUND THE GATE THAT WOULD HAVE FAILED THE OUTAGE (2026-08-18)

Backlog item 2: *"a restore drill (runbook step 5) would be the first end-to-end
proof of the DR path itself."* Run.

### What the drill did

`pg_dump` → `createdb` → `psql` restore → row counts → step 5, against the
757-table database rebuilt in phases 12–13, with a small seeded graph
(2 orgs / 2 properties / 2 deals / 1 user).

| step | measured |
|---|---|
| dump (2.0 MB) | 0.55 s |
| createdb + extension | 0.16 s |
| restore (`psql`, exit 0) | 6.5 s |
| smoke verify — row counts matched the source EXACTLY | 0.04 s |
| step 5 `migrate.mjs --dry-run` | 0.45 s |
| **total (steps 2–5)** | **7.7 s** |

The RTO table in the runbook had read *"PLACEHOLDER, fill on first drill …
Until then, RTO is unproven."* It is now filled — **with its caveat attached**:
this proves the MECHANISM, not the timings (the dump has almost no data), and
the S3 fetch was **not exercised at all**. Half the RTO is still unmeasured and
the table says so.

### The defect the drill existed to find

**Step 5 failed on a perfectly restored database.** `migrate.mjs --dry-run`
exited 1 with *"7 statement(s) would fail. NOT safe to deploy as-is."*

All 7 were `CREATE INDEX CONCURRENTLY`, which PostgreSQL refuses inside a
transaction block. The dry-run validates inside ONE transaction and rolls back —
so its own mechanism cannot host those statements. The real, non-transactional
run applies all 7 without trouble; nothing was wrong with the database or the
backup.

This is the worst thing a gate can do, and worth stating precisely: an operator
following this runbook **after a genuine outage** would be told their good
backup is unsafe to deploy. And an operator who has seen the false alarm before
learns to ignore the gate — after which it cannot warn them about anything
real. A gate that cries wolf on the healthy case is strictly worse than no gate,
because it trains the response.

Fixed by classification, not suppression: those statements report as **NOT
VALIDATED** in their own category, excluded from the failure count, and the
verdict line states the coverage the gate does not have on every run —
*"they are not failures, and they are not proof either — this gate says nothing
about them."*

Step 5 now exits 0 on a good restore, and the mutation that restores the old
classification reproduces exit 1 on the same healthy database.

### A third instance of my own recurring mistake

The ordering assertion in the new test first compared `indexOf("WOULD FAIL")`
against the RAW source — and failed, because that phrase appears in the
explanatory comment above the code it describes. Same mistake as the
county-opportunity and deal-feed scanners earlier this session: **a source gate
that reads its own documentation is matching prose, not behaviour.** Stripped
comments, with a floor on the stripped size so the stripper cannot quietly eat
the file instead.
