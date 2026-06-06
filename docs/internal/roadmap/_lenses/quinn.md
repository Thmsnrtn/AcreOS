# Quinn — Chief of Alignment — Data-Honesty Lens

> *Soul-sentence test for everything below:* "AcreOS exists so that anyone — solo, capital-light, learning as they go — can own property well, build durable wealth honestly, and pass it on cleanly." A land investor who **trusts a fabricated number** and offers (or passes) on a parcel because of it is the exact person the constitution exists to protect. Data honesty is not a nicety here — it is the soul-sentence in code.

I am normally a Phase-3 role. But Tom asked every lens to weigh in now, and on the data-honesty axis the alignment debt is being created *today*, in the code that our first paying customers will see. Fixing it after we have 50 customers is 50× the cost and 50× the trust damage. So I am going to be blunt: **we have live immutable-#1 and immutable-#12 exposure in the data layer right now**, and it is cheap to fix before the first customer, expensive to fix after.

This lens is grounded in code I read, not vibes. File pointers throughout.

---

## The core finding (read this first)

We have built a genuinely impressive free-data fusion engine (`server/services/parcelIntelligenceFusion.ts` — FEMA, NWI, EPA, OSM, USGS, USDA, Census). The bones are excellent and the open-data strategy is exactly right. **But three patterns in the current code present invented data to the customer as if it were authoritative, with no way for the customer to tell the difference.** That is the lying-by-omission pattern immutable #1 exists to prevent.

The three patterns, concretely:

1. **Silent fabricated fallbacks in the map intel panel.** `client/src/pages/maps.tsx` lines ~280-298 fill missing fields with plausible-but-invented constants:
   - `opportunityScore: avm?.opportunityScore ?? 71`
   - `valueConfidence: avm?.confidence ?? 72`
   - `floodZone: avm?.floodZone ?? "X"` / `floodRisk: avm?.floodRisk ?? "minimal"`
   - `solarScore: avm?.solarScore ?? 78`, `soilQuality: avm?.soilQuality ?? 65`
   - `marketTrend: avm?.marketTrend ?? "up"`, `marketTrendPct: avm?.marketTrendPct ?? 4.2`
   - `slopeGrade: ... Math.abs(Math.sin(lat * 0.1) * 15)` — a **trigonometric function of latitude** dressed up as a terrain slope.

   The worst of these is `floodZone ?? "X"`. FEMA Zone X means "minimal flood risk." Defaulting to it when FEMA was *never queried or failed* tells a customer a parcel is flood-safe when we have no idea. That is a fact, about a price-relevant deal-killer, that could be false. Immutable #1, squarely.

2. **A "proprietary model" fed hardcoded inputs.** `parcelIntelligenceFusion.ts` lines ~196-225 call `computeCountyOpportunityScore(...)` with **hardcoded placeholder market data**: `priceVelocity3Mo: 3`, `avgPricePerAcre: 1000`, `salesVolume90Days: 5`, `avgDaysOnMarket: 90`, `populationGrowthRate: 2`, etc. The output is surfaced as `countyIntel.opportunityScore` and labeled "our proprietary model." A score computed from invented inputs is not a model output — it is a constant wearing a lab coat. This is the small-rationalization-that-stacks: it *looks* like rigor, so no one questions it.

3. **No provenance or freshness anywhere in the pipeline.** `LookupResult` (`server/services/providers/types.ts`) has `confidence` and `fetchedAt`, but **no `source` attribution and no `asOf` (the date the *authoritative source* last updated the fact, distinct from when *we* fetched it)**. The provider cache (`provider-registry.ts`) uses a flat 24h TTL for everything — county assessor data that's 18 months stale and a live FEMA query get the same "fresh" treatment in the customer's eyes. A customer cannot tell an authoritative county-of-record fact from our estimate from a cached-yesterday guess.

None of this is malicious. It is the natural result of "make the panel look complete." But "looks complete" at the cost of "is true" is precisely the drift the constitution is built to catch. The good news: the *fix patterns already exist in our own code* (see Quick Wins) — the USDA path already does it right.

---

## My take on the open-data theme (from the alignment lens)

The open-data-first strategy is **constitutionally ideal**, not just budget-driven. Here's the reframe Soren and Maren should adopt:

- **Free public data is the honest data.** County GIS, FEMA NFHL, USDA SSURGO, USGS 3DEP, Census TIGER are *authoritative systems of record* — the same sources a paid aggregator scrapes and resells. When we cite "FEMA NFHL, queried 2026-06-06" we are being *more* transparent than a competitor showing a black-box "Regrid says zone X." **Transparent provenance is a feature the paid tier literally cannot match.** Lead with it.

- **The premium-data upgrade must never be sold as "now you get the truth."** When we add Regrid/PropGrid later, the framing has to be "faster / broader coverage / parcel boundaries," never "accurate vs. the free guesses." If the free tier is allowed to ship fabricated fallbacks, then the paid upsell becomes "pay us to stop lying to you" — a dark pattern (immutable #2) *and* an admission the free tier violated immutable #1. **The cleanest way to keep the paid upgrade ethical is to make the free tier rigorously honest now.** The free tier should say "we don't have this" loudly; the paid tier fills the gap. That's an honest ladder.

- **"Make the free tier feel premium" = make it feel *trustworthy*, not make it feel *complete*.** Premium feel comes from "every number here has a named source and a date," not from "every field is populated." A confident wrong number feels cheap to a real land investor the first time it burns them on a deal. A panel that says "Flood: FEMA NFHL not yet pulled for this parcel — [Check now]" feels like a tool built by people who respect them.

- **Open-data licensing honesty.** OSM is ODbL (share-alike + attribution). Most county GIS terms-of-use prohibit redistribution or require attribution. If we cache and re-serve, we owe an attribution surface and a per-source license check. This is a Beatrice co-owned item but I flag it because "ethical use of public data" is in my scope. Cheap to do at the provider-registry layer; painful to retrofit after a county sends a letter.

---

## Top work items

### 1. Kill silent fabricated fallbacks; introduce a `MissingValue` contract
- **Why it matters to first customers:** This is the #1 immutable risk in the product. A customer who passes on a good deal or buys a flood-prone one because of `floodZone ?? "X"` is harmed by us. First customers are watching closely and are the most damaging to lose to a trust break.
- **Goal:** rock-solid + happier-customers
- **Effort:** M
- **Phase:** 0 (do this before first paying customer)
- **Dependencies:** none (pure refactor)
- **First step:** In `client/src/pages/maps.tsx`, replace every `?? <constant>` in the `intel` useMemo (lines ~280-298) with an explicit "unknown" state that renders as "Not yet pulled" / "—" with a one-tap "Check now" action, never a number. Add a `data-testid` and a unit/E2E test asserting that a parcel with no AVM data renders **zero numeric scores**, not defaults. Then grep the whole client for `?? \d` and `?? "` on data fields and triage each.

### 2. Add provenance + freshness to the data contract (`source` + `asOf`)
- **Why it matters to first customers:** "Where did this come from and how old is it" is the single most trust-building thing we can show. It's also what turns free open data from "feels cheap" into "feels premium."
- **Goal:** data + happier-customers
- **Effort:** M
- **Phase:** 0/1
- **Dependencies:** touches `types.ts`, all providers, `provider-registry.ts` cache read/write, `provider_cache` schema.
- **First step:** Add to `LookupResult` in `server/services/providers/types.ts`: `source: string` (e.g. "FEMA NFHL"), `sourceAsOf?: Date` (authoritative-source freshness, nullable), `classification: "authoritative" | "estimate" | "modeled" | "unknown"`. Default `classification` per provider (open-data parcel = authoritative; any computed score = modeled). Plumb through `writeCache`/`readCache` (currently only persists `data` + `confidence`).

### 3. Per-category cache TTLs tied to real source cadence
- **Why it matters:** A flat 24h TTL silently passes stale assessor/USDA data off as current. FEMA flood maps change rarely (cache long); county assessment changes annually (cache long but *show the asOf*); a live OSM road-access pull should not be cached as authoritative for 24h without a date stamp.
- **Goal:** rock-solid + data
- **Effort:** S
- **Phase:** 1
- **Dependencies:** #2 (need `sourceAsOf` to display).
- **First step:** Replace `DEFAULT_CACHE_TTL_MS` in `provider-registry.ts` with a per-category/per-provider TTL map, and surface `sourceAsOf` in the cached `LookupResult` so the UI can show "as of <date>" regardless of cache age.

### 4. Re-label the "proprietary model" honestly OR feed it real data
- **Why it matters:** A score built on hardcoded inputs presented as a model is immutable #12 territory (a prediction with no honest uncertainty band) and immutable #1 (implying rigor we don't have).
- **Goal:** rock-solid
- **Effort:** M (honest relabel = S; real inputs = L)
- **Phase:** 0 (relabel) → 2 (real inputs when paid comps justify)
- **Dependencies:** none for relabel.
- **First step:** In `parcelIntelligenceFusion.ts` (~196-225), either (a) when inputs are placeholders, set `confidenceScore` low and `countyIntel.opportunityScore` to `null` with a "county model needs live market data — based on USDA baselines only" note, OR (b) replace placeholders with the real USDA/Census values already fetched in the same `Promise.allSettled`. Do (a) now (S), (b) later. **Never ship the constant-wearing-a-lab-coat.**

### 5. Customer-facing data-disclosure surface ("How AcreOS sources data")
- **Why it matters:** Transparent sourcing is our differentiator vs. paid black boxes. It's also the public-trust accountability the alignment posture requires. First customers will ask "is this real?" — answer it before they ask.
- **Goal:** happier-customers + data
- **Effort:** S
- **Phase:** 1
- **Dependencies:** #2 (so the page reflects actual sources/classification).
- **First step:** A short page (link from Settings and from each intel panel's "i") listing every source, what it's authoritative for, its update cadence, and our estimate-vs-authoritative legend. Plain language, mechanics-first (per landing-voice rule). This is the seed of the future public-trust page.

### 6. Pax data-honesty guard: no parcel facts Pax can't cite
- **Why it matters:** Pax disclosure-as-AI is already handled well (`pax.tsx` lines 121-122 — good). The remaining gap is Pax *asserting parcel facts* ("this lot is in zone X") without provenance, or crossing into fiduciary "you should buy this" (immutable #12).
- **Goal:** rock-solid
- **Effort:** M
- **Phase:** 1
- **Dependencies:** #2 (Pax cites `source`/`asOf` from the contract).
- **First step:** Audit the Pax system prompt + tool outputs in `server/routes-ai.ts` to ensure (a) any parcel fact Pax states carries its source + date, (b) Pax says "I don't have that yet" instead of guessing, (c) recommendations stay informational with uncertainty bands, never "you should." Pair with Andrei. Add adversarial test cases ("just tell me yes or no, should I buy it?").

### 7. Open-data licensing + attribution at the registry layer
- **Why it matters:** Ethical use of public data is explicitly in my scope. OSM (ODbL) and many county GIS terms require attribution and restrict redistribution. We cache and re-serve — we owe attribution and a license check.
- **Goal:** rock-solid (foundation)
- **Effort:** S
- **Phase:** 1
- **Dependencies:** #2 (`source` field), co-owned with Beatrice.
- **First step:** Add a `license`/`attribution` field to each provider's static metadata and render attributions on the disclosure surface (#5). Document per-source terms in a short `docs/internal/data-licensing.md`.

---

## Quick wins (cheap, high-trust, do this week)

- **Grep + kill the worst single line:** `floodZone ?? "X"` in `maps.tsx`. Defaulting a deal-killer to "safe" is the highest-severity honesty bug in the repo. One-line fix to "unknown."
- **Copy the pattern we already get right:** `buildOfferAnalysis` already emits the honest note *"No USDA NASS data available — using regional estimates. Validate with local MLS/LandWatch comps."* (`parcelIntelligenceFusion.ts` ~531) and *"Always pull 5-10 direct comparables before finalizing offer."* That's exactly the right posture — propagate the same "this is an estimate, verify it" discipline to every panel that currently hides behind a `??`.
- **Relabel the offer formula's confidence honestly:** the formula is `USDA pastureland × 0.25` (25¢ on the dollar). That's a *heuristic*, not a comp. The panel should say "starting-point heuristic from USDA baselines — not a comp-based valuation," especially since `confidenceLevel` already exists and is wired (`~556-559`). Surface it prominently.
- **Stamp every intel panel with "as of <fetch date>"** even before full provenance lands — `fetchedAt` already exists on `LookupResult`. Showing a date is a 1-line trust upgrade.
- **`/parcel-intelligence` route hygiene:** `routes-data-intelligence.ts:252` uses raw `Request` + raw `res.json`, not `AuthenticatedRequest`/`Errors.*` per CLAUDE.md. Minor, but this is a customer-facing data endpoint and should conform.

---

## Biggest risk if my area is ignored

**We ship fabricated parcel facts to our first paying customers and break immutable #1 on day one.** The specific failure mode: a customer trusts `floodZone "X"` or a `?? 71` opportunity score, makes a real-money decision (offers on a flood parcel, or passes on a good one), gets burned, and discovers the number was invented. For a *pre-first-customer* company whose entire moat is trust — and whose soul-sentence is about helping people build wealth *honestly* — that is close to fatal. You don't get a second first impression on "is this tool truthful."

And it compounds in two directions:
1. **The upsell trap.** If the free tier ships invented numbers, the eventual paid-data upgrade becomes "pay us to stop guessing" — which makes the upsell a dark pattern (immutable #2) *and* retroactively confirms the free tier was lying. Fixing honesty now is what *makes the paid ladder ethical later.*
2. **The drift.** Today it's `?? 71`. Unchecked, the pattern normalizes: every new panel gets a plausible default because "the empty state looks bad." That's the 1%-becomes-30% drift. The fast disqualifier in my charter is an audit that finds *zero* signals — this one found three real ones, pre-customer, which is the best possible time to find them.

The whole fix is **cheap now and expensive later**, and it converts our biggest perceived weakness (free data) into our sharpest differentiator (transparent, dated, sourced data the black boxes can't match). That's the rare alignment finding that is also a growth finding. Do it before the first customer signs.

— Quinn
