# Lens 44 -- Real Estate Data Infrastructure

Auditor persona: Real estate data expert evaluating property data enrichment, parcel intelligence, AVM accuracy, comp analysis, and data provider integration quality.

Date: 2026-04-15

## Scope

Files examined:

- `server/services/parcel.ts` -- Tiered parcel boundary lookup (cache / County GIS / RapidAPI / Regrid)
- `server/services/parcelIntelligenceFusion.ts` -- Land Intelligence Score fusion engine
- `server/services/acreOSValuation.ts` -- AcreOS AVM (Automated Valuation Model)
- `server/services/comps.ts` -- Comparable properties analysis via Regrid
- `server/services/providers/provider-registry.ts` -- Multi-provider orchestration layer
- `server/services/providers/regrid-provider.ts` -- Regrid data provider
- `server/services/providers/attom-provider.ts` -- ATTOM data provider
- `server/services/providers/batchdata-provider.ts` -- BatchData provider
- `server/services/providers/open-data-provider.ts` -- Free open-data provider
- `server/services/providers/types.ts` -- Provider interface contracts
- `server/services/gradientBoosting.ts` -- Pure TypeScript GBM implementation
- `server/services/dueDiligenceEngine.ts` -- Automated due diligence checks
- `server/services/countyOpportunityScore.ts` -- County market cycle scoring
- `server/services/data-source-broker.ts` -- Legacy data source orchestration
- `server/providers-init.ts` -- Provider bootstrap

---

## P0 -- Incorrect Valuations (Ships Broken)

### P0-DATA-01: Flip price calculation contains compounding multiplier bug

**File:** `server/services/parcelIntelligenceFusion.ts:510`

The target flip price is calculated as:

```ts
const flipPriceTotal = offerTotal * (flipMultiple > 0 ? flipMultiple : 2) * 4;
```

When USDA NASS data is unavailable (the common case), `flipMultiple` defaults to `2`. The formula then computes `offerTotal * 2 * 4 = 8x the offer`. Since `offerTotal` is already 25% of market value, the flip price becomes `8 * 0.25 = 2x market value`. The inline comment says "4x offer = 2x market" but that only holds when `flipMultiple` is `1`. With the default `flipMultiple` of `2`, the flip price is **8x the offer or 2x the market value**, which cascades into inflated owner-finance loan amounts, monthly payment calculations, and ROI projections shown to users. When NASS data *is* present and `flipMultiple` is computed dynamically, the `* 4` outer multiplier further amplifies the error. A user making financial decisions based on these numbers could overprice their listing or miscalculate expected returns.

### P0-DATA-02: AVM falls back to $1,000/acre hardcoded baseline with no warning flag

**File:** `server/services/acreOSValuation.ts:328`

When no comparables exist and both the GBM model and OpenAI API fail, the AVM produces a valuation based on a hardcoded `$1,000/acre` baseline:

```ts
let pricePerAcreEstimate = 1000; // fallback baseline
```

This static national fallback is wildly wrong for expensive markets (coastal counties at $50K+/acre) and generous for cheap markets ($200/acre scrubland). The confidence is set to `45` regardless -- high enough to appear usable. The confidence interval is `0.6x` to `1.5x`, which for a $1,000 baseline means $600--$1,500/acre, presenting a false sense of precision on a baseless number.

### P0-DATA-03: AVM uses `request.marketConditions` which does not exist on the ValuationRequest interface

**File:** `server/services/acreOSValuation.ts:338`

The `generateMarketEstimate` method accesses `request.marketConditions ?? {}` but `ValuationRequest` (line 130) has no `marketConditions` field. This silently passes an empty object to the GBM estimator, causing all market-related features to use hardcoded fallbacks: `distanceToHighwayMiles: 5`, `distanceToCityMiles: 20`, `soilQualityScore: 5`, `countyMedianIncomeK: 55`. The GBM model therefore treats every property as having identical market conditions. This is a TypeScript error that ships undetected because esbuild skips type checking (orientation issue #2).

### P0-DATA-04: Podolsky formula uses USDA pastureland value as "lowest comp" -- conceptually incorrect

**File:** `server/services/parcelIntelligenceFusion.ts:498-503`

```ts
const usdaPerAcre = nassData?.pasturePerAcre || (nassData?.farmRealEstatePerAcre * 0.6) || 1000;
const lowestCompPerAcre = usdaPerAcre;
const offerPerAcre = lowestCompPerAcre * 0.25;
```

USDA NASS reports county-level *average* agricultural land values, not recent *comparable sales*. Using a county average as the "lowest comp" systematically overstates the baseline for below-average parcels and understates it for above-average parcels. The Podolsky methodology calls for pulling actual recent sales and using the lowest sale, not a statistical average from the USDA. The code labels this value `lowestComparableSale` in the output (line 543), misleading users into thinking it comes from real transaction data.

### P0-DATA-05: County Opportunity Score receives entirely hardcoded inputs

**File:** `server/services/parcelIntelligenceFusion.ts:194-218`

The `computeCountyOpportunityScore` call passes fabricated constants instead of real market data:

```ts
priceVelocity3Mo: 3,
priceVelocity12Mo: 5,
avgPricePerAcre: 1000,
salesVolume90Days: 5,
salesVolume12Months: 20,
avgDaysOnMarket: 90,
...
```

Every county in every state receives identical inputs. The resulting "County Opportunity Score" is therefore a fixed constant, not a data-driven assessment. This score feeds into the composite Land Intelligence Score and the buy/pass recommendation, making the entire recommendation engine decorative rather than functional.

---

## P1 -- Missing Data Validation (Ships Bad)

### P1-DATA-01: No input validation on any parcel/valuation service entry point

None of `lookupParcelByAPN`, `lookupParcelByCoordinates`, `generateLandIntelligenceReport`, or `generateValuation` validate their inputs with a schema (Zod or otherwise). Missing, null, NaN, or negative values for latitude, longitude, acres, or APN flow directly into API calls and arithmetic. For example, `lookupParcelByCoordinates(NaN, NaN)` will call the Regrid API with `lat=NaN&lon=NaN`.

### P1-DATA-02: SQL injection vector in County GIS APN lookup

**File:** `server/services/parcel.ts:277`

```ts
const whereClause = `${apnField} = '${apnVariant}'`;
```

The APN value is interpolated directly into a SQL WHERE clause sent to external ArcGIS REST endpoints. While this targets third-party servers (not the local database), a crafted APN string like `' OR 1=1 --` could extract unintended data from county GIS systems. The `apnField` is also user-controllable via the `countyGisEndpoints` table field mappings.

### P1-DATA-03: OpenAI JSON response parsed without validation

**File:** `server/services/acreOSValuation.ts:373-375`

```ts
const raw = completion.choices[0]?.message?.content?.trim() || '';
const parsed = JSON.parse(raw);
if (parsed.pricePerAcre && typeof parsed.pricePerAcre === 'number') {
```

The GPT response is `JSON.parse`'d without try/catch around the parse specifically (the outer catch is too broad), and only `pricePerAcre` is type-checked. A hallucinated response like `{"pricePerAcre": -5000}` or `{"pricePerAcre": 999999999}` would be accepted as-is. No range bounds, no sanity check against regional norms, no outlier rejection.

### P1-DATA-04: AI valuation enhancement has unbounded adjustment range

**File:** `server/services/acreOSValuation.ts:650-698`

The prompt instructs the LLM to return an adjustment between -20% and +20%, but no code enforces this bound. The raw `result.adjustment` is applied directly:

```ts
const finalValue = adjustedValue * (1 + aiEnhancement.adjustment / 100);
```

An LLM hallucination returning `adjustment: 500` would quintuple the valuation. No clamping, no outlier detection, no human-in-the-loop safeguard.

### P1-DATA-05: Regrid API token passed in URL query string

**Files:** `server/services/parcel.ts:810`, `server/services/comps.ts:271`

Both parcel and comps services pass the Regrid API key as a `token=` query parameter:

```ts
const url = `https://app.regrid.com/api/v2/parcels/point?lat=${lat}&lon=${lng}&token=${token}...`;
```

Query string tokens appear in server logs, browser history, proxy logs, and CDN logs. The Regrid API supports `Authorization: Bearer` headers (used in the health check at `regrid-provider.ts:157`) which should be used consistently.

### P1-DATA-06: Comps cache uses in-memory Map with no size limit

**File:** `server/services/comps.ts:156-157`

```ts
const compsCache = new Map<string, { data: CompsSearchResult; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60;
```

The cache grows unboundedly in process memory. With heavy usage across many lat/lng/radius/filter combinations, this will consume increasing RAM on the 4GB Fly.io machines. Old entries are only evicted on cache hit (TTL check), not proactively. The ATTOM provider correctly uses the database-backed `provider_cache` table; the comps service should too.

### P1-DATA-07: Provider registry does not actually deduct credits

**File:** `server/services/providers/provider-registry.ts:62-134`

The `lookup` method accepts `creditBalance` and checks affordability before calling a provider, but never performs the actual credit deduction. The comment on the `enrichAll` method (line 149) says "each deducts from a shared balance" but only decrements a local `remainingBalance` variable that is discarded when the function returns. The billing system is therefore bypassed -- paid lookups are executed without charging the organization.

### P1-DATA-08: Regrid provider `lookup()` ignores `organizationId` parameter for BYOK key resolution

**File:** `server/services/providers/regrid-provider.ts:67-68`

```ts
async lookup(category: DataCategory, input: LookupInput): Promise<LookupResult> {
    ...
    const apiKey = await getApiKey(); // no organizationId passed
```

The `getApiKey` function supports BYOK via `organizationId`, but the `lookup` method calls it without the parameter. This means BYOK Regrid keys are never used through the provider registry path -- all lookups fall back to the platform key. The `isConfigured` method correctly accepts `organizationId`, creating inconsistency.

---

## P2 -- Coverage Gaps

### P2-DATA-01: No ATTOM AVM integration in the fusion engine

The `parcelIntelligenceFusion.ts` engine fuses FEMA, NWI, EPA, OSM, USDA, USGS, and Census data but does not call the ATTOM provider for its AVM (Automated Valuation Model), which is the industry gold standard for residential/rural valuations. The ATTOM provider is registered and has a `valuation` category, but the fusion engine never queries it. Users with ATTOM keys configured get no benefit in the intelligence report.

### P2-DATA-02: No MLS or Land-specific comp sources

The comps analysis relies exclusively on Regrid parcel data, which contains assessed values and some sale amounts from public records. There is no integration with MLS feeds, LandWatch, Lands of America, Land and Farm, or Zillow/Redfin APIs. The code itself acknowledges this gap (line 539-540): "Always pull 5-10 direct comparables from LandWatch, Land and Farm." These are manual instructions to the user, not automated data feeds.

### P2-DATA-03: Dual orchestration layers create confusion and inconsistency

Two parallel systems exist for routing data lookups:

1. **Provider Registry** (`server/services/providers/provider-registry.ts`) -- newer, type-safe, tier/credit/circuit-breaker aware
2. **Data Source Broker** (`server/services/data-source-broker.ts`) -- legacy, category-based, with its own circuit breaker and caching

The open-data provider delegates to the broker (`data-source-broker.ts`), creating a nested orchestration chain. The fusion engine (`parcelIntelligenceFusion.ts`) bypasses both and calls service functions directly. The comps service (`comps.ts`) also bypasses the registry and calls Regrid directly. There is no single source of truth for which provider served a given data point, making cost tracking and quality monitoring unreliable.

### P2-DATA-04: GBM model has no training pipeline

**File:** `server/services/acreOSValuation.ts:22-41`

The GBM model is loaded from either `GBM_MODEL_JSON` env var or `server/ml/artifacts/gbm_valuation.json` on disk. There is no training pipeline, no scheduled retraining, no concept of model versioning, and no mechanism to feed recorded transactions (`transactionTraining` table) back into a new model. The `recordTransactionForTraining` method collects data into the database but nothing reads it back for fitting. The model artifact likely does not exist, making the GBM path dead code and forcing every valuation through OpenAI or the $1,000 baseline.

### P2-DATA-05: Comps analysis does not filter by land type

**File:** `server/services/comps.ts:271`

The Regrid radius search fetches all parcels within range without filtering for vacant land vs. improved residential/commercial properties. A 5-acre vacant lot will receive "comparables" that include single-family homes, commercial buildings, and other improved properties with radically different per-acre values. The ATTOM comps endpoint (line 189) hardcodes `propertytype=SFR` (single-family residential), which is also wrong for land investing.

### P2-DATA-06: Parcel coordinate lookup bypasses tiered fallback

**File:** `server/services/parcel.ts:796-857`

`lookupParcelByCoordinates` goes directly to Regrid with no cache check, no County GIS attempt, and no RapidAPI fallback. Only the APN-based `lookupParcelByAPN` uses the four-tier cascade (cache -> County GIS -> RapidAPI -> Regrid). Since the coordinate lookup is the primary path used by the Regrid provider and the open-data provider, every coordinate-based request burns a paid Regrid API call even when cached or free alternatives exist.

### P2-DATA-07: Due diligence engine receives dummy propertyId and orgId

**File:** `server/services/parcelIntelligenceFusion.ts:180`

```ts
runAutoDueDiligence(0, 0, input.latitude, input.longitude, input.acres, input.state)
```

The first two arguments (`propertyId: 0, orgId: 0`) are dummy values. If the due diligence engine ever uses these IDs for database lookups, cache keying, or billing, results will be incorrect or collide with other zero-ID calls.

### P2-DATA-08: No staleness detection on cached parcel data

**File:** `server/services/parcel.ts:412`

Parcel cache uses a 30-day TTL (`CACHE_FRESHNESS_DAYS = 30`), but there is no mechanism to detect when underlying data has changed (ownership transfer, tax sale, boundary adjustment). Stale owner information could cause mail campaigns to target the wrong person. There is no webhook or polling mechanism to invalidate cache on ownership change events.

### P2-DATA-09: BatchData provider has no caching layer

**File:** `server/services/providers/batchdata-provider.ts`

Unlike the ATTOM provider (which uses `provider_cache` table), the BatchData provider has no caching. Every skip trace or property lookup is a fresh API call at 3--15 cents each. Repeated lookups for the same address/owner will be charged multiple times.

### P2-DATA-10: enrichAll runs categories sequentially despite "parallel" comment

**File:** `server/services/providers/provider-registry.ts:149-159`

```ts
// Run lookups in parallel, but each deducts from a shared balance.
// For simplicity, run sequentially to track balance correctly.
for (const category of categories) {
```

The comment says parallel but the implementation is sequential. Since credit deduction is not actually implemented (P1-DATA-07), the sequential design costs latency for zero benefit. A multi-category enrichment that could complete in ~1 API round-trip instead takes N sequential round-trips.

---

## Architecture Assessment

### Strengths

1. **Tiered provider design is sound.** The provider registry's concept of tier filtering, cost-aware ordering, and circuit breaking is well-architected. The interfaces are clean and extensible.

2. **Free data coverage is broad.** The due diligence engine integrates FEMA, NWI, EPA, OSM, USGS, USDA soil survey, NLCD land cover, BLM adjacency, endangered species, and wildfire risk -- all from free government APIs. This is a genuine competitive advantage for a land investing platform.

3. **Parcel lookup tiering is smart.** The cache -> County GIS -> RapidAPI -> Regrid cascade for APN lookups correctly minimizes cost. The County GIS endpoint registry with ArcGIS REST support is a creative approach to getting free parcel data.

4. **Podolsky methodology alignment.** The deal-killer detection (landlocked, flood zone, wetlands, Superfund), opportunity signals (tax delinquent, out-of-state owner, long tenure), and seller motivation scoring map well to the land investing playbook.

### Weaknesses

1. **Valuation integrity is compromised.** Between the hardcoded $1,000 fallback, the missing `marketConditions` type field, the fabricated county opportunity inputs, and the unbounded AI adjustment, the AVM cannot be relied upon for pricing decisions.

2. **The fusion engine is decorative.** The Land Intelligence Report appears comprehensive but its County Opportunity Score uses static fake data, its Podolsky offer analysis substitutes USDA averages for actual comps, and its pricing notes recommend manual steps the system itself should automate.

3. **Provider registry is underutilized.** The registry exists but the primary code paths (fusion engine, comps service, coordinate lookup) bypass it entirely, calling Regrid and other services directly. Credits are not actually deducted.

4. **Two data orchestration layers.** The provider registry and the data source broker serve overlapping purposes. No single path is authoritative.

---

## Summary

| Priority | Count | Theme |
|----------|-------|-------|
| P0 | 5 | Incorrect valuations: compounding multiplier bug, hardcoded fallback, missing type field, USDA-as-comp misuse, fabricated county scores |
| P1 | 8 | Missing validation: no schema on inputs, SQL injection in GIS queries, unbounded AI adjustments, leaked API tokens, no credit deduction |
| P2 | 10 | Coverage gaps: no ATTOM AVM fusion, no MLS comps, dual orchestration, dead GBM pipeline, wrong property type filters |

The data infrastructure has a well-designed provider abstraction layer and impressive free-data coverage, but the valuation and pricing pipelines -- the highest-stakes outputs -- are compromised by hardcoded fallbacks, fabricated inputs, and missing validation. A user making a $50,000 land acquisition offer based on the current Podolsky analysis or AVM output is operating on unreliable numbers.
