# Lens 42 -- Government & Public Data API Integrations

**Auditor persona:** Government data API expert evaluating county assessor, USDA NASS, Census Bureau, FEMA, and other federal/state data integrations for accuracy, reliability, and coverage.

**Date:** 2026-04-15

---

## Executive Summary

AcreOS has built an impressive breadth of government data integration -- at least 18 distinct federal data sources are referenced, with working fetch implementations for Census ACS, USDA NASS QuickStats, FEMA NFHL, FEMA disaster declarations, FEMA NRI, USFWS NWI, USDA NRCS Soil Survey, USGS Elevation, EPA Envirofacts, BLM PLSS, and more. A `DataSourceBroker` with circuit breaking, tiered fallback, and caching ties everything together. However, several findings carry P0 severity because they can produce silently incorrect data that drives financial decisions (offer prices, county targeting, risk assessments), and multiple P1 findings reveal missing error handling that can cause silent degradation with no operator visibility.

---

## Findings

### P0-42-01: FIPS Code Mismatch for Presidio County, TX in Census Service

**File:** `server/services/censusDataService.ts` line 299
**Severity:** P0 -- Incorrect data causing bad decisions

The hardcoded FIPS lookup table maps `"TX:PRESIDIO"` to county FIPS `"383"`. The real FIPS code for Presidio County, TX is **389** (full FIPS 48389). Meanwhile, `countyAssessorIngest.ts` line 57 and `parcel.ts` line 1211 both use the correct full FIPS `"48377"` -- wait, that is also wrong. Let me be precise: the actual FIPS code for Presidio County, Texas per the Census Bureau is **48377**. In `censusDataService.ts`, the `countyFips` is listed as `"383"` which would map to full FIPS 48383 -- this is **incorrect**. The correct county FIPS code is `"377"` (three-digit county portion). The assessor ingest and parcel files use `"48377"` which is correct.

This means all Census ACS demographic queries, building permit queries, and population change queries for Presidio County will either return no data or data for the wrong county, silently returning `null`. Since Presidio County is a **priority-1** land investing target, opportunity profiles and campaign-targeting decisions for this county are built on missing or wrong data.

---

### P0-42-02: FIPS Code Error for Clay County, NC in Assessor Ingest

**File:** `server/jobs/countyAssessorIngest.ts` line 101
**Severity:** P0 -- Incorrect data causing bad decisions

Clay County, NC is listed with FIPS `"37389"`. The actual FIPS code for Clay County, NC is **37043**. FIPS 37389 does not correspond to any real NC county. This means:
- Tax delinquent list fetching uses the wrong FIPS for county-specific API endpoints.
- The `TAX_DELINQUENT_API_37389` env var will never match a real county endpoint.
- Any ATTOM or PropStream API calls referencing this FIPS will return empty or incorrect results.

---

### P0-42-03: Census Migration Data Always Reports Zero -- Fake Migration Signal

**File:** `server/services/censusDataService.ts` lines 174, 380-392
**Severity:** P0 -- Incorrect data causing bad decisions

`fetchCountyDemographics()` hardcodes `populationChangeFromPriorYear: 0` and `populationChangePercent: 0` (line 174-175) with a comment "Requires PEP data". The PEP fetch function (`fetchCountyPopulationChange`) exists but is **never called** from `buildCountyOpportunityProfile()` or any other code path.

The migration object (lines 380-392) is then constructed from these zero values, meaning `netMigration`, `netMigrationRate`, `inMigrationCount`, `outMigrationCount` are all zero. The `landDemandSignal` will always compute as `"weak"` (since `populationChangePercent` is 0, which falls into the `>= -0.5` bucket).

This is a P0 because county opportunity scores and investor recommendations explicitly depend on migration signals. Every county is wrongly flagged with a "weak" land demand signal, potentially causing users to skip high-growth counties or misallocate direct mail campaign budgets.

---

### P0-42-04: Rural Population Percent is a Population-Based Guess, Not Census Data

**File:** `server/services/censusDataService.ts` lines 194-201
**Severity:** P0 -- Incorrect data causing bad decisions

The `estimateRuralPercent()` function uses crude population thresholds to guess rural percentage (e.g., pop < 10000 = 85% rural). This is presented as part of the `CountyDemographics` object alongside real Census data, with no indication it is an estimate. The Census Bureau publishes actual urban/rural population splits in the Decennial Census (P2/H2 tables), but this is not used.

This matters because Maricopa County, AZ (pop ~4.5M) would show 5% rural, which is reasonable, but a county like Pinal County, AZ (pop ~425K, actually ~35% rural) would show 15%, and a place like Hays County, TX (pop ~260K, rapidly suburbanizing) would also show 15%. These errors propagate into county opportunity profiles that users rely on for campaign targeting.

---

### P0-42-05: USDA NASS Silently Falls Back to Fabricated "Estimated" Data

**File:** `server/services/usdaNassService.ts` lines 164-166, 393-416
**Severity:** P0 -- Incorrect data causing bad decisions

When the NASS API key is not configured or any API call fails, `fetchCountyLandValues()` silently returns data from `getEstimatedLandValues()` -- a function that generates synthetic 5-year price history using hardcoded state-level averages with a fixed 5% annual appreciation. This fabricated data:

1. Is labeled `source: "usda_nass"` (line 413), making it indistinguishable from real NASS data.
2. Applies a uniform 5% appreciation rate that does not reflect actual market conditions.
3. Uses the same value for every county in a state (e.g., every TX county gets $2,400/acre regardless of whether it is Hudspeth County desert or Travis County suburban fringe).
4. Feeds directly into the Podolsky blind offer formula, producing offer prices that may be off by 5-10x.

Since the `.env.example` shows `USDA_NASS_API_KEY` is commented out, this is likely the default runtime behavior in development and potentially production.

---

### P0-42-06: Opportunity Zone Lookup Uses 5 Hardcoded Bounding Boxes for All of the US

**File:** `server/services/opportunityZoneAnalyzer.ts` lines 11-23, 30-51
**Severity:** P0 -- Incorrect data causing bad decisions

The `isOpportunityZone()` function checks lat/lon against only 5 bounding boxes (Houston, LA, Miami, NYC, Chicago). There are over 8,700 designated Opportunity Zone census tracts in the US. This means:
- 99.95% of actual OZ tracts will return `isOZ: false`.
- Tax deferral and exclusion benefit calculations will never trigger for the vast majority of qualifying investments.
- The comment says "real implementation would query a USDA/HUD GeoJSON endpoint" but this has not been done.

---

### P0-42-07: Building Permits Single-Family Count is Fabricated

**File:** `server/services/censusDataService.ts` line 268
**Severity:** P0 -- Incorrect data presented as real

`singleFamilyPermits` is calculated as `Math.round(permits * 0.7)` with a comment "Estimate; single-family typically 70%". The Census Building Permits Survey actually provides separate fields for single-family (`UNITS1`), 2-unit, 3-4 unit, and 5+ unit structures. The code fetches only `BLDGS` and `UNITS` but not the breakdown fields, then fabricates the single-family number. This is returned in the `BuildingPermitsData` type with no indication it is estimated.

---

### P1-42-08: All Census Service Errors Are Silently Swallowed

**File:** `server/services/censusDataService.ts` lines 184, 233, 272, 602, 668
**Severity:** P1 -- Missing error handling on gov APIs

Every public function in `censusDataService.ts` has a bare `catch {}` block that returns `null` or an empty fallback with zero logging. This means:
- API key misconfiguration produces no warning.
- Census API rate limiting (when exceeding keyless limits) is invisible.
- Network failures, malformed responses, and schema changes all silently degrade.
- The FEMA disaster history endpoint (line 602) and Census migration flows endpoint (line 668) have the same pattern.

Operators have no way to know whether they are getting real Census data or `null` fallbacks without inspecting individual API responses.

---

### P1-42-09: USDA NASS API Errors Are Silently Swallowed

**File:** `server/services/usdaNassService.ts` lines 164, 201
**Severity:** P1 -- Missing error handling on gov APIs

`fetchCountyLandValues()` catches all errors and silently falls back to estimated data (P0-42-05 above). `fetchCountyPastureLandValues()` catches all errors and returns an empty array. Neither logs the error. Combined with the fabricated data fallback, a misconfigured API key or NASS outage is completely invisible.

---

### P1-42-10: No Retry Logic on Any Government API Call

**Files:** `censusDataService.ts`, `usdaNassService.ts`, `dueDiligenceEngine.ts`, `data-source-broker.ts`
**Severity:** P1 -- Missing error handling on gov APIs

No government API integration implements retry with backoff. Federal APIs (Census, FEMA NFHL, USDA NASS) are known for intermittent 503/504 errors and rate-limit-induced failures. A single transient failure causes the entire lookup to return null/fallback data. The `DataSourceBroker` has circuit-breaker logic but no retry-before-break -- it records a failure immediately and after 3 failures skips the source entirely.

---

### P1-42-11: FEMA Flood Zone Query Implemented in Three Separate Places

**Files:**
- `server/services/dueDiligenceEngine.ts` line 233
- `server/services/data-source-broker.ts` line 572
- `server/services/data-source-lookup.ts` line 99

**Severity:** P1 (architectural risk leading to inconsistent behavior)

The FEMA NFHL flood zone query is implemented three times with slightly different:
- URL construction (raw lat/lng string vs. JSON geometry object)
- Field lists (`FLD_ZONE,ZONE_SUBTY,STUDY_TYP` vs. `DFIRM_ID,FLD_ZONE,ZONE_SUBTY,STATIC_BFE`)
- Timeout values (8s vs. 10s vs. 10s)
- Fallback behavior when no features found (dueDiligenceEngine assumes Zone X; data-source-lookup returns "Area of Minimal Flood Hazard")

Different code paths could return different flood zone assessments for the same coordinates, depending on which service is invoked.

---

### P1-42-12: Census Data Hardcoded to 2022 ACS Vintage with No Freshness Check

**File:** `server/services/censusDataService.ts` line 135
**Severity:** P1 -- Stale data risk

The ACS query is hardcoded to `2022/acs/acs5`. The Census Bureau releases new ACS 5-Year data annually (the 2023 vintage was released December 2024). There is no mechanism to:
- Detect when a newer vintage is available.
- Update the year programmatically.
- Alert operators that the data is stale.

As of April 2026, this data is already 2+ vintages behind. Population, income, and housing data for fast-growing target counties may be significantly outdated.

---

### P1-42-13: FEMA Disaster History Uses Different API Than NFHL -- No Error Distinction

**File:** `server/services/censusDataService.ts` lines 554-605
**Severity:** P1 -- Missing error handling

`getCountyDisasterHistory()` uses the OpenFEMA v2 API (`www.fema.gov/api/open/v2/`), which is a different service from the NFHL ArcGIS REST API used for flood zones. The function:
- Matches on `designatedCounty` via string comparison, which is fragile (county name formatting varies).
- Catches all errors silently and returns `null`.
- Does not validate that the response structure matches expectations (`DisasterDeclarationsSummaries` vs `data` key).

---

### P1-42-14: County Assessor Ingest Has No Deduplication Across Runs

**File:** `server/jobs/countyAssessorIngest.ts` lines 700-773
**Severity:** P1 -- Data quality risk

The nightly job processes the same `TOP_LAND_COUNTIES` list every run. While comparable sales are deduplicated via `transaction_hash` (line 666), the delinquent record scoring and high-motivation flagging (lines 632-661) has no deduplication. The same owners could be flagged and logged as "HIGH MOTIVATION" every night, potentially triggering duplicate skip-tracing or outreach actions.

---

### P1-42-15: In-Memory Cache for USDA Data Has No Size Bounds or Eviction

**File:** `server/services/usdaNassService.ts` lines 422-456
**Severity:** P1 -- Reliability risk

`getCachedCountySnapshot()` and `getCachedLandTrend()` use a `Map<string, { data, expiresAt }>` with 24-hour TTL but no maximum size limit. In a system querying 200+ counties nightly, this map grows unbounded across the process lifetime. On the 4GB Fly.io machine, this could contribute to memory pressure over time.

---

### P1-42-16: FEMA NFHL "No Features" Assumed to Be Zone X (Minimal Risk)

**Files:**
- `server/services/dueDiligenceEngine.ts` lines 247-253
- `server/services/data-source-lookup.ts` lines 121-129
- `server/services/data-source-broker.ts` line 595

**Severity:** P1 -- Potentially incorrect risk assessment

When the FEMA NFHL query returns zero features, all three implementations assume the parcel is in Zone X (minimal flood hazard). However, zero features can also mean:
- The parcel is in an **unmapped area** (no FIRM panel exists) -- this is NOT the same as low risk.
- The FEMA service omitted data due to a coverage gap.
- The point fell outside the spatial index tolerance.

Unmapped areas in rural counties (the exact target market) are common. Presenting these as "minimal flood risk" is misleading.

---

### P2-42-17: Hardcoded FIPS Map Covers Only 23 Counties

**File:** `server/services/censusDataService.ts` lines 289-314
**Severity:** P2 -- Limited coverage

The `COUNTY_FIPS_MAP` covers only 23 counties. Any county not in this map gets `null` from `getCountyFips()`, causing `buildCountyOpportunityProfile()` to skip all Census and building permit queries. The assessor ingest job covers ~47 counties, so roughly half have no Census enrichment. A proper implementation would use the Census FIPS code lookup API or a comprehensive FIPS table.

---

### P2-42-18: County GIS Endpoint Validation Does Not Persist Failure Details

**File:** `server/services/gisValidation.ts` lines 186-189
**Severity:** P2 -- Incomplete monitoring

`validateAllEndpoints()` updates the `lastVerified` timestamp only for online endpoints (line 187-189). Endpoints that fail validation get no database update. Over time, the `lastVerified` field becomes misleading -- a stale timestamp could mean "verified a month ago and still fine" or "has been failing every check since then."

---

### P2-42-19: ArcGIS Discovery State Detection is Unreliable

**File:** `server/services/arcgis-discovery.ts` lines 159-197
**Severity:** P2 -- Data quality risk

`extractLocationInfo()` matches state abbreviations by checking if the 2-letter code appears anywhere in the title/description/tags text. This can false-match (e.g., "OR" matching any text containing "or", "IN" matching "in", "ME" matching "me"). The `break` on first match means a Florida service mentioning "California" in its description would be tagged as California.

---

### P2-42-20: Building Permits Trend Classification is Based on Absolute Counts, Not Relative

**File:** `server/services/censusDataService.ts` lines 277-282
**Severity:** P2 -- Misleading analysis

`getPermitsTrend()` classifies permit activity by absolute count (>500 = "surging", <50 = "declining"). This ignores county size. A county with 500,000 people and 200 permits is not "growing" -- it is stagnant. A county with 5,000 people and 60 permits is experiencing a construction boom. The `permitsPerCapita` field exists in the type but is always set to `0`.

---

### P2-42-21: USDA NASS Cropland Value is Fabricated from Farm Real Estate Value

**File:** `server/services/usdaNassService.ts` line 324
**Severity:** P2 -- Estimated data presented as real

`croplandPerAcre` is calculated as `latestFarm * 1.1` with the comment "Cropland typically 10% above farm RE average." The NASS API provides actual cropland values as a separate query, but this is never fetched. The 10% premium is a national average that varies wildly by region (in Iowa it might be 0%; in Arizona it might be 200%).

---

### P2-42-22: Data Source Broker Uses ILIKE Pattern Matching for Category Routing

**File:** `server/services/data-source-broker.ts` lines 157-165
**Severity:** P2 -- Fragile query logic

Category-to-source mapping uses `ILIKE '%' + cat + '%'` against the database, meaning a source categorized as "fema_flood_historical" would match both "flood" and "fema" lookups, potentially returning the wrong data source for a given query category.

---

## Coverage Assessment

| Government Data Source | Integration Status | Accuracy | Error Handling | Notes |
|---|---|---|---|---|
| Census ACS 5-Year | Implemented | Stale (2022 vintage) | Silent null | P0-42-03, P1-42-08, P1-42-12 |
| Census PEP | Implemented but unused | N/A | N/A | P0-42-03 |
| Census Building Permits | Implemented | Partially fabricated | Silent null | P0-42-07, P1-42-08 |
| Census Migration Flows | Implemented | Untested | Silent null | P1-42-08 |
| USDA NASS QuickStats | Implemented | May be fabricated | Silent fallback | P0-42-05, P1-42-09 |
| FEMA NFHL (Flood Zones) | Implemented (3x) | Zone X assumption risk | Basic error handling | P1-42-11, P1-42-16 |
| FEMA OpenFEMA (Disasters) | Implemented | Fragile county matching | Silent null | P1-42-13 |
| FEMA NRI (Risk Index) | Implemented | Appears correct | Circuit breaker only | -- |
| USFWS NWI (Wetlands) | Implemented | Appears correct | Timeout handling | -- |
| USDA NRCS (Soils) | Implemented | Appears correct | Basic error handling | -- |
| USGS 3DEP (Elevation) | Implemented | Appears correct | Basic error handling | -- |
| EPA Envirofacts | Implemented | Appears correct | Basic error handling | -- |
| BLM PLSS | Implemented | Appears correct | Basic error handling | -- |
| ATTOM Data | Implemented | Depends on key | Logged failures | Commercial API |
| PropStream | Implemented | Depends on key | Silent fallback | Commercial API |
| County Assessor APIs | Framework only | N/A | Falls to scrape queue | No real endpoints configured |
| Opportunity Zones (HUD) | Stub only | 5 of 8,700 tracts | N/A | P0-42-06 |

---

## Recommendations (Do Not Fix -- Document Only)

1. **Fix FIPS codes immediately** (P0-42-01, P0-42-02) -- incorrect FIPS codes mean queries silently return wrong-county data or no data at all.
2. **Wire up PEP population change** into county opportunity profiles so migration signals are real.
3. **Mark estimated/fabricated data** clearly in all return types (add `isEstimated: boolean` field) so consumers can distinguish real USDA data from state-level guesses.
4. **Consolidate FEMA flood zone query** into a single canonical implementation.
5. **Add structured logging** to all government API catch blocks so failures are visible in monitoring.
6. **Implement retry with exponential backoff** for all federal API calls (1 retry, 2s backoff minimum).
7. **Upgrade Census ACS vintage** to latest available and add automated freshness detection.
8. **Replace hardcoded FIPS map** with the Census Bureau FIPS API or a bundled FIPS lookup table.
9. **Replace Opportunity Zone bounding boxes** with the official CDFI Fund OZ tract GeoJSON dataset.
10. **Add `isEstimated` flags** to `BuildingPermitsData.singleFamilyPermits`, `CountyDemographics.ruralPopulationPercent`, and `CountyAgSnapshot.croplandPerAcre`.
