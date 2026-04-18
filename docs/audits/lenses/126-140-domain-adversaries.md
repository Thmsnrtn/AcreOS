# Lenses 126-140 -- Land-Investing Domain Adversary Audit (Tier 3)

**Auditor perspective:** 15 adversarial domain lenses evaluate whether AcreOS correctly handles the data accuracy, compliance, and edge-case scenarios that real estate professionals encounter in land transactions.

**Date:** 2026-04-18
**Tier:** 3 (domain-adversarial depth)
**Severity scale:** P1 = could cause a real estate professional to make a bad financial decision based on incorrect data. P2 = missing feature or incomplete handling. P3 = improvement opportunity.

---

## Executive Summary

AcreOS has impressive domain coverage across many of these lenses. The due diligence engine, title chain service, Dodd-Frank checker, TCPA compliance, 1031 exchange tracker, environmental intelligence, and regulatory intelligence services demonstrate genuine understanding of the land investing workflow. However, several critical gaps exist in data accuracy surfacing, compliance guardrails for direct mail, and edge-case handling for heir property, mineral rights, and survey discrepancies. The most dangerous issues are places where the system presents data without freshness indicators or accuracy disclaimers, allowing users to trust stale or incomplete information for high-stakes decisions.

**Findings:** 8 P1, 14 P2, 9 P3

---

## Lens 126 -- Parcel Ownership Accuracy

**Files examined:** `server/services/parcel.ts`, `server/services/dueDiligence.ts`, `server/services/titleSearchService.ts`

### P1-126-01: Ownership data presented without freshness indicator to user

The parcel service caches ownership data for 30 days (`CACHE_FRESHNESS_DAYS = 30` in `parcel.ts:412`). The `lastUpdated` field is set to the fetch time, not the county's recording date. When a user views ownership info, there is no indication of how old the underlying county data is.

**Risk:** Property may have been sold, transferred to heirs, or placed into a trust between the county's last update and the user's lookup. A user sending an offer letter to a dead owner or a previous owner wastes money and time. In worst case, a user closes on a property where the seller is no longer the actual owner.

**Evidence:** `parcel.ts:326` -- `lastUpdated: new Date().toISOString()` records when AcreOS fetched the data, not when the county last updated the parcel record. The County GIS response attributes are mapped but there is no attempt to extract the county's own "last modified" date from the ArcGIS feature attributes.

**Recommendation:** Extract and display the county's own update timestamp from `feature.attributes` (ArcGIS endpoints commonly include `LAST_EDIT_DATE` or `MODIFIEDDATE`). Show "Data as of: [county date]" prominently in the UI. When cache is older than 14 days, show a warning badge.

### P1-126-02: ownershipType always null -- vesting status unknown

`dueDiligence.ts:516` sets `ownershipType: null` with the comment "Would need additional data source." The title search service (`titleSearchService.ts:43`) defines `vestingType` but only populates it from PropStream, which requires credentials most users will not have.

**Risk:** Knowing whether a parcel is held by an individual, LLC, trust, or estate is critical for determining who has signing authority and whether Dodd-Frank exemptions apply. The Dodd-Frank checker (`doddFrankChecker.ts`) asks for `sellerType` as input, but the due diligence report cannot auto-populate this because ownership type is never determined.

**Recommendation:** Parse the owner name from Regrid/County GIS using pattern matching (the code in `dueDiligencePods.ts:594` already does `ownerName.match(/LLC|INC|CORP|LP|LLP|TRUST|ESTATE/i)` but only for scoring). Expose this heuristic to the ownership info section.

### P2-126-03: No multi-owner detection from parcel data

County GIS and Regrid return owner names like "SMITH JOHN & SMITH JANE" or "SMITH JOHN ET AL". The parcel service stores the raw owner string but does not parse it to detect multiple owners. The `legalIntelligence.ts` partition risk assessment (`assessPartitionRisk`) requires an explicit `ownerCount` parameter that is never auto-populated from parcel data.

**Recommendation:** Add owner-name parsing to detect "AND", "ET AL", "ETAL", "&", "TRUST OF", multi-name patterns. Auto-flag parcels with potential multiple owners for partition risk review.

---

## Lens 127 -- Direct Mail Compliance

**Files examined:** `server/routes-campaigns.ts`, `server/services/directMailService.ts`, `server/services/directMail.ts`, `server/services/lobService.ts`, `server/services/tcpaCompliance.ts`

### P1-127-01: No do-not-mail suppression list check before sending

The direct mail services (`directMailService.ts`, `directMail.ts`, `lobService.ts`) send mail via Lob without checking against any suppression or do-not-mail list. While TCPA compliance exists for phone/SMS (`tcpaCompliance.ts`), there is no equivalent for physical mail.

**Risk:** Multiple states have direct-mail-specific regulations. More critically, if a lead has `doNotContact: true`, the TCPA service blocks SMS/phone but there is no corresponding check in the direct mail flow. The Lob integration in `directMailService.ts` accepts a recipient and sends immediately.

**Evidence:** `directMailService.ts` has no import of `tcpaCompliance` and no `doNotContact` check. `lobService.ts` similarly has no suppression check. The campaign routes (`routes-campaigns.ts`) create campaigns and track responses but have no pre-send compliance gate for mail pieces.

**Recommendation:** Add a `checkMailCompliance(leadId, orgId)` function that verifies: (1) lead.doNotContact is false, (2) lead is not on any uploaded suppression list, (3) address has been validated via Lob address verification before sending. Wire this into both the direct mail service and the sequence processor's mail step execution.

### P2-127-02: No state-specific direct mail disclosure requirements

Some states require specific disclosures on unsolicited commercial mail (e.g., return address requirements, business identification). The `regulatoryIntelligence.ts` service tracks state disclosure requirements but these are not cross-referenced or enforced in the direct mail sending flow.

**Recommendation:** Add a template validation step that checks the mail piece content against state-specific requirements from the regulatory intelligence database before sending.

### P2-127-03: Address validation not mandatory before mail send

Lob offers address verification (`verifyAddress` in `directMailService.ts`), but calling it is optional. A user can send 1,000 letters to unvalidated addresses, wasting credits on undeliverable mail.

**Recommendation:** Make address validation a default pre-send step with an explicit user override. Track and display the deliverability rate in campaign analytics.

---

## Lens 128 -- Boundary Accuracy

**Files examined:** `server/services/parcel.ts`, `client/src/pages/properties.tsx`, `client/src/pages/maps.tsx`

### P1-128-01: Synthetic boundaries generated when real data unavailable -- no visual distinction

`properties.tsx:613` generates synthetic boundaries when `parcelBoundary` is null:
```
boundary: (p.parcelBoundary as any) || { type: "Polygon", coordinates: [[[lng-d, lat-d],[lng+d, lat-d],[lng+d, lat+d],[lng-d, lat+d],[lng-d, lat-d]]] }
```

This creates a simple rectangle centered on the property's coordinates. The synthetic boundary is visually indistinguishable from real parcel boundary data on the map.

**Risk:** A user might rely on this synthetic boundary to assess lot shape, setbacks, or buildable area. If the actual parcel is an irregular shape (common with metes-and-bounds descriptions), the synthetic rectangle could misrepresent the property significantly.

**Recommendation:** Render synthetic boundaries with a distinct style (dashed line, lower opacity, different color) and show a "Boundary approximate -- not from county data" label on the map popup.

### P2-128-02: No acreage cross-validation between GIS boundary and recorded acreage

The parcel service returns both `ll_gisacre` (calculated from boundary polygon) and the property's recorded acreage. These values often differ -- GIS calculations can be off by 5-15% from the legal description, especially for irregular parcels. No comparison or warning is surfaced.

**Recommendation:** When both values are available, calculate the percentage difference. If >10%, flag it as a discrepancy that warrants verification via survey or legal description review.

---

## Lens 129 -- County Quirks

**Files examined:** `server/services/parcel.ts`, `server/services/regulatoryIntelligence.ts`, `server/jobs/countyAssessorIngest.ts`

### P2-129-01: APN format normalization is minimal

`parcel.ts:265-271` strips dashes and spaces from APNs and tries a few variants, but county APN formats are far more varied:
- Some counties use leading zeros that are significant
- Some use book-page-lot format (e.g., "0012-0034-0056")
- Some use tax ID numbers that differ from APNs
- Hawaii uses TMK format (e.g., "1-2-3-004-005")

The current approach of `cleanApn.replace(/^0+/, "")` (removing leading zeros) will fail in counties where leading zeros are part of the canonical APN.

**Recommendation:** Add a county-specific APN format registry that defines the canonical format for each county. When a user enters an APN, normalize it to the county's expected format before querying.

### P2-129-02: Only 2 county recorder APIs hardcoded

`titleChainService.ts:632-637` hardcodes recording verification endpoints for only Travis County (TX) and Maricopa County (AZ). The remaining 3,100+ counties return `{ recorded: false }` by default, providing no post-close recording verification.

**Recommendation:** Expand the county recorder registry. Consider integrating Simplifile or a similar e-recording service that covers multiple counties. At minimum, display "Recording verification not available for [county]" rather than silently returning false.

### P2-129-03: County GIS endpoint discovery is manual

The `countyGisEndpoints` table requires manual population. There is no automated way to discover or test new county GIS endpoints. This limits parcel data coverage to whichever counties have been manually configured.

**Recommendation:** Build a county GIS endpoint crawler that tests known ArcGIS Server patterns (e.g., `https://gis.[county].[state].gov/arcgis/rest/services`) and auto-registers working endpoints.

---

## Lens 130 -- Market Comps

**Files examined:** `server/services/comps.ts`, `server/services/parcelIntelligenceFusion.ts`

### P1-130-01: Comps do not filter by sale date -- stale sales used as current comps

`comps.ts:244` calls the Regrid API for nearby parcels but the `CompsFilters` interface has optional `minSaleDate`/`maxSaleDate` fields that are not enforced as defaults. A 10-year-old sale in a market that has tripled would produce a comp that is 3x too low.

**Evidence:** The `getComparableProperties` function accepts filters but the caller in `dueDiligence.ts:547-553` does not pass any date filters:
```
const compsResult = await getComparableProperties(
  centroid.lat, centroid.lng, 5,
  { minAcreage: ..., maxAcreage: ..., maxResults: 10 },
  organizationId
);
```

**Recommendation:** Default `minSaleDate` to 24 months ago. Display the date range of comps used in the analysis. Warn when comps are older than 12 months.

### P1-130-02: Comps average does not exclude outliers

`dueDiligence.ts:564-569` calculates average price per acre from all comps with no outlier exclusion. If one comp is a family transfer at $1 and the others are legitimate sales at $3,000/acre, the average is dragged down significantly.

**Recommendation:** Implement IQR (interquartile range) outlier detection. Exclude comps where `pricePerAcre` is more than 1.5x IQR below Q1 or above Q3. Display excluded outliers separately with an explanation.

### P2-130-03: No distinction between raw land sales and improved property sales

Regrid's `saleamt` field includes all property types. A sale of a parcel with a $200,000 house on it produces a wildly inflated per-acre comp for raw land valuation. The service has no mechanism to filter out improved properties.

**Recommendation:** Use Regrid's `improvval` (improvement value) field to detect and exclude improved properties from raw land comp analysis, or at minimum flag them.

---

## Lens 131 -- Title Chain

**Files examined:** `server/services/titleChainService.ts`, `server/services/titleSearchService.ts`

### P2-131-01: Title chain analysis operates on manually entered events

`titleChainService.ts:126` (`analyzeChainOfTitle`) accepts a `TitleEvent[]` array, but there is no automated way to populate this array from county records. The title search service (`titleSearchService.ts`) can query PropStream/ATTOM for deed chain and liens, but the data is not automatically fed into the chain analysis function.

**Impact:** The title chain visualization and grade system are architecturally sound (cloud counting, gap detection, lis pendens handling, probate flagging) but users must manually enter title events or have PropStream credentials to populate them.

**Recommendation:** Create a bridge function that converts `TitleSearchResult.deedChain` and `TitleSearchResult.liens` into `TitleEvent[]` format and auto-runs `analyzeChainOfTitle`.

### P2-131-02: Title search falls back to mock data with high confidence

`titleSearchService.ts` has a development fallback that returns mock data with `source: "mock"` and `confidence: 0.5`. The mock data includes realistic-looking results. If PropStream and ATTOM credentials are not configured (likely for most users), every title search returns fabricated data.

**Risk:** While the `source: "mock"` field exists, the UI may not prominently distinguish mock data from real results. A user seeing a "clear" title status from mock data might skip a real title search.

**Recommendation:** When mock data is returned, the API response should include a prominent `isMockData: true` flag and the UI should display a full-screen warning that no real title data was retrieved.

---

## Lens 132 -- Tax Delinquency Freshness

**Files examined:** `server/services/taxDelinquentPipeline.ts`, `server/services/delinquentListScraper.ts`, `server/services/dueDiligence.ts`

### P1-132-01: Tax status displayed without freshness date

`dueDiligence.ts:519-524` builds the tax info section:
```
const taxes: TaxInfo = {
  assessedValue: parseNumeric(property.assessedValue),
  taxAmount: parseNumeric(parcelData?.taxAmount),
  taxYear: new Date().getFullYear(),  // <-- always current year
  taxStatus: null,                     // <-- always null
};
```

`taxYear` is hardcoded to `new Date().getFullYear()`, not the actual year the tax data was last assessed. `taxStatus` (current/delinquent) is never populated. The user sees a tax amount with no indication of whether it is current, delinquent, or from what year.

**Risk:** A user might assume taxes are current when they are not, leading to unexpected back-tax liabilities at closing.

**Recommendation:** Source `taxYear` from the parcel data provider (Regrid includes this). Populate `taxStatus` from the tax delinquent pipeline when available. Display "Tax data year: [year]" and "Status: Unknown -- verify with county assessor" when status cannot be determined.

### P2-132-02: Auto-scraper covers only 4 counties

The `delinquentListScraper.ts` auto-scraper supports only Philadelphia PA, King County WA, Norfolk VA, and Milwaukee WI via Socrata APIs. The remaining 3,100+ counties require manual CSV upload through the tax delinquent pipeline.

**Recommendation:** Add more Socrata-enabled counties (there are 100+ counties publishing open data via Socrata). Consider adding support for other open data platforms (CKAN, ArcGIS Open Data).

---

## Lens 133 -- Deed Recording Lag

**Files examined:** `server/services/titleChainService.ts`

### P2-133-01: County recording tracker has no awareness of typical recording lag

`titleChainService.ts:608-668` tracks deed recording status but has no knowledge of typical county recording delays. Some counties record same-day; others take 4-8 weeks. The system treats all counties the same, showing "pending" status with no context about expected wait time.

**Recommendation:** Add a county recording lag estimate to the registry. Display "Typical recording time for [county]: [X] business days" in the post-close checklist. Trigger "delayed" status only after the expected recording window has passed.

### P3-133-02: No e-recording integration

Modern closings increasingly use e-recording services (Simplifile, eRecording Partners Network) that provide real-time recording confirmation. The system has no integration with these services.

**Recommendation:** Add Simplifile or CSC e-recording integration as a premium feature. This would provide instant recording confirmation for participating counties.

---

## Lens 134 -- Owner Contact Accuracy

**Files examined:** `server/services/skipTracingService.ts`, `server/services/parcel.ts`

### P1-134-01: Skip trace results have no expiration or freshness indicator

Skip trace results from BatchSkipTracing (`skipTracingService.ts`) are stored on the lead record but there is no `skipTracedAt` timestamp or expiration mechanism. Phone numbers and addresses change. A skip trace from 6 months ago may have stale contact information.

**Risk:** A user calls a number that now belongs to someone else, or sends mail to an address the owner no longer occupies. This wastes time and can create compliance issues if the new occupant receives unsolicited contact.

**Evidence:** `skipTracingService.ts` returns results with a `creditsUsed` field but no timestamp. The results are stored on the lead but there is no `skipTracedAt` or `skipTraceExpiry` field.

**Recommendation:** Add a `skipTracedAt` timestamp to the lead record. Show "Contact info last verified: [date]" in the UI. After 90 days, display a warning that contact information may be stale and offer a one-click re-trace.

### P2-134-02: Owner mailing address from parcel data not cross-validated with skip trace

The parcel service provides `ownerAddress` from Regrid/County GIS, and the skip trace service provides a separate address. These are not compared or reconciled. If they differ, it may indicate the owner has moved (strong motivation signal) or that one source is outdated.

**Recommendation:** When both sources provide addresses, compare them. If different, flag it as a data discrepancy and display both. An address mismatch between parcel records and skip trace is itself a useful signal.

---

## Lens 135 -- Seller Finance Edge Cases

**Files examined:** `server/services/doddFrankChecker.ts`, `server/middleware/complianceGate.ts`, `server/services/parcelIntelligenceFusion.ts`, `server/services/usury.ts`

### P1-135-01: Dodd-Frank 3-property count is not automatically tracked

`doddFrankChecker.ts` accepts `sellerFinancedDealsLast12Months` as a manual input parameter. The system does not automatically count the user's seller-financed deals from the deal pipeline to populate this field.

**Risk:** A user who has seller-financed 3 properties in 12 months and creates a 4th deal would not be automatically warned that they may need a licensed MLO. The compliance gate (`complianceGate.ts:57-65`) only triggers on `body.isSellerFinanced` with an informational message, not a blocking check.

**Recommendation:** Auto-count seller-financed deal closings from the deals table within the trailing 12-month window. Pre-populate the Dodd-Frank checker input and trigger a warning at deal creation when the 3-property threshold is approaching.

### P2-135-02: Owner finance scenario hardcodes 9% rate and 84-month term

`parcelIntelligenceFusion.ts:519` hardcodes `const monthlyRate = 0.09 / 12` and `const n = 84`. While these are common defaults, they do not account for:
- State usury ceilings (the `usury.ts` service exists but is not integrated into the owner finance calculator)
- Market conditions where higher or lower rates are appropriate
- Variable deal sizes where 84 months may be too long or too short

**Recommendation:** Feed usury ceiling data into the owner finance scenario. Allow user-configurable default rates per organization. Display a warning when the calculated rate exceeds the state's usury ceiling.

---

## Lens 136 -- 1031 Exchange

**Files examined:** `server/services/exchange1031.ts`, `server/routes-exchange-1031.ts`

### P1-136-01: 1031 exchange data stored in-memory, not persisted

`exchange1031.ts:60-62` comments:
```
// In-memory store keyed by orgId -> exchanges (in production, add a DB table)
// For now, we store exchange data in the activityLog as structured metadata
```

The 1031 exchange tracker, which manages the most time-critical deadlines in real estate (45-day identification, 180-day close), does not have a dedicated database table. Data is stored in the activity log as unstructured metadata.

**Risk:** If the server restarts, in-memory exchange data is lost. The 45-day identification deadline is a hard IRS deadline -- missing it means the entire exchange fails and the user owes capital gains tax. Losing track of this deadline could cost tens of thousands of dollars.

**Recommendation:** Create a dedicated `exchanges_1031` table with proper columns for deadlines, candidates, QI info, and status. Add a cron job that checks approaching deadlines and sends email/SMS alerts at 30, 14, 7, 3, and 1 day before each deadline.

### P2-136-02: Capital gains estimate uses simplified tax rates

`exchange1031.ts:95-96` uses flat rates (`0.15` for long-term, `0.22` for short-term) without considering:
- State capital gains taxes (vary by state, 0-13.3%)
- Net Investment Income Tax (3.8% for high earners)
- Depreciation recapture (25% rate)
- AMT implications

**Recommendation:** Add state tax rates from the regulatory intelligence data. Display the federal-only estimate alongside a range that includes "estimated state tax of $X based on [state] rates." Include a disclaimer that the estimate is simplified and users should consult a CPA.

---

## Lens 137 -- Heir Property

**Files examined:** `server/services/legalIntelligence.ts`, `server/services/titleChainService.ts`, `server/services/dueDiligencePods.ts`

### P1-137-01: No automated heir property detection

The `legalIntelligence.ts` partition risk assessment and `titleChainService.ts` probate detection exist but are not automatically triggered from parcel data. Key heir property signals that are available in the data but not checked:
- Owner name containing "ESTATE OF", "HEIRS OF", "ET AL"
- Property with a deceased owner (last sale decades ago, elderly owner signals)
- Tax bills sent to a different name than the owner of record

**Risk:** Heir property is the #1 title killer in land deals. A user who does not detect heir property status before making an offer wastes due diligence time and money. In worst case, they close on a property where undisclosed heirs later challenge the transfer.

**Evidence:** `dueDiligencePods.ts:594` already matches entity patterns in owner names but does not specifically check for "ESTATE OF", "HEIRS OF", or "DECEASED" patterns.

**Recommendation:** Add heir property pattern detection to the parcel data processing pipeline. When detected, auto-flag the property in the due diligence report with specific recommendations (probate verification, heir search, quiet title action considerations). Cross-reference with the partition risk assessment.

### P2-137-02: No Uniform Partition of Heirs Property Act (UPHPA) awareness

The partition risk assessment in `legalIntelligence.ts` does not reference UPHPA, which has been adopted by 20+ states and changes partition procedures for heir property. Under UPHPA, courts must consider a property's sentimental/historical value and can order buyouts instead of forced sales.

**Recommendation:** Add UPHPA adoption status to the state regulatory profiles. When heir property is detected in a UPHPA state, include specific guidance about partition procedures and buyout provisions.

---

## Lens 138 -- Mineral Rights

**Files examined:** `server/services/environmentalIntelligence.ts`, `server/services/titleChainService.ts`

### P1-138-01: Mineral rights severance data is advisory only -- no parcel-specific check

`environmentalIntelligence.ts:122-200` provides state-level mineral rights information (severance risk, dominant minerals, surface owner protections) for ~10 states. This is useful context, but there is no parcel-specific mineral rights check. The system cannot determine whether mineral rights have been severed from a specific parcel.

**Risk:** In states like Texas, New Mexico, and Colorado, mineral rights severance is extremely common. A user who buys surface rights without realizing minerals have been severed may face drilling operations on their property. The buyer who purchases from them may demand rescission.

**Evidence:** The `ScheduleBException` type in `titleChainService.ts:100` includes `mineral_rights` as an exception type, but this is only populated from manually entered title events or PropStream data (which most users lack).

**Recommendation:** Add a prominent "Mineral Rights Status: UNKNOWN -- verify with county recorder" warning for all properties in high-severance-risk states (TX, NM, CO, OK, WY, ND, PA). Link to the county recorder's office and provide guidance on how to search for mineral reservations in the deed chain.

### P3-138-02: No mineral rights valuation context

When mineral rights are mentioned, there is no guidance on their potential value relative to surface rights. In some areas (Permian Basin, Marcellus Shale), severed mineral rights can be worth more than the surface.

**Recommendation:** For properties in known mineral-producing regions, include a note about the potential significance of mineral rights status and suggest professional mineral title opinion if the property is in a high-production area.

---

## Lens 139 -- Conservation Easements

**Files examined:** `server/services/parcelIntelligenceFusion.ts`, `server/services/titleChainService.ts`, `server/services/priceOptimizer.ts`

### P2-139-01: Conservation easement detection is limited to title chain keyword matching

`titleChainService.ts:179-184` detects conservation easements only when they appear as manually entered title events with the word "conservation" in the description. There is no integration with the National Conservation Easement Database (NCED) or state land trust registries.

**Risk:** Conservation easements permanently restrict property use and dramatically affect value. A user who does not detect an existing conservation easement before closing may find the property is unbuildable and unsellable for their intended purpose.

**Recommendation:** Integrate with the NCED (free API at `https://www.conservationeasement.us/`) to check whether a parcel or nearby parcels have recorded conservation easements. The `parcelIntelligenceFusion.ts` deal killer detection already includes `conservation_easement` as a type but relies on free-text detection from due diligence results.

### P3-139-02: No tax benefit analysis for conservation easements

Conservation easements can provide significant tax benefits (charitable deduction for donating an easement). For properties in areas with conservation interest, this could be an alternative disposition strategy. The system does not model this option.

**Recommendation:** Add conservation easement donation as a disposition option in the `dispositionOptimizer.ts` service, with estimated tax benefit calculations based on the property's appraised value and the donor's tax bracket.

---

## Lens 140 -- Survey Discrepancies

**Files examined:** `server/services/parcel.ts`, `server/services/dueDiligence.ts`, `client/src/pages/properties.tsx`

### P1-140-01: No warning when GIS acreage differs from user-entered acreage

`dueDiligence.ts:502-503` prefers the user-entered acreage over GIS-derived acreage:
```
acres: parseNumeric(property.sizeAcres) || (acresFromParcel ? parseNumeric(acresFromParcel) : null),
```

When both values exist but differ significantly, no warning is generated. GIS acreage (`ll_gisacre` from Regrid) is derived from the boundary polygon and can differ from the legal description's acreage, which is derived from the survey.

**Risk:** Discrepancies between GIS and legal acreage often indicate: (1) boundary errors in the county GIS, (2) encroachments or adverse possession, (3) a survey that has not been updated after a lot split, or (4) mapping errors. Any of these could affect the deal price, which is often calculated per acre.

**Recommendation:** When both GIS and recorded acreage are available, compute the percentage difference. If >5%, generate a warning: "GIS-computed acreage ([X]) differs from recorded acreage ([Y]) by [Z]%. A recent survey may be needed to confirm actual boundaries." Include this in the due diligence report's risk assessment.

### P2-140-02: No legal description parsing or validation

Properties have a `legalDescription` field (`dueDiligence.ts:33`) but it is populated only when manually entered. There is no parsing of metes-and-bounds descriptions to validate them against the boundary polygon, or to detect obvious errors (e.g., a description that doesn't close).

**Recommendation:** For lot-and-block descriptions, validate that the referenced subdivision plat exists in county records. For metes-and-bounds, implement basic closure validation (sum of bearings should return to the point of beginning). Display a warning if the description appears malformed.

### P3-140-03: Centroid calculation uses simple average, not area-weighted centroid

`parcel.ts:101-140` calculates the centroid as a simple arithmetic mean of polygon vertices. For irregular polygons, this can place the centroid outside the actual parcel boundary. While this rarely causes material issues, it can produce confusing map visualizations.

**Recommendation:** Use a proper area-weighted centroid calculation (or the winding-number centroid formula) for more accurate placement, especially for L-shaped or narrow parcels.

---

## Cross-Cutting Findings

### P1-CROSS-01: Due diligence report lacks a master accuracy disclaimer

The due diligence report PDF generator (`dueDiligenceReportGenerator.ts:399`) includes a disclaimer, but it is a single line at the bottom of the last page. Given that the report aggregates data from 18 sources with varying accuracy and freshness, a more prominent disclaimer is needed.

**Recommendation:** Add a "Data Accuracy" section on page 1 of the report that lists each data source, its last update date, and its known limitations. Include a statement that "This report does not substitute for a professional title search, survey, or environmental assessment."

### P2-CROSS-02: No unified "data confidence" score per data point

Individual services track data sources (`dataSource: "cache" | "county_gis" | "regrid" | "rapidapi" | "property_record"`) but there is no unified confidence scoring that accounts for:
- Data age (fresher = higher confidence)
- Source reliability (county GIS > USDA average)
- Cross-validation (multiple sources agree = higher confidence)

**Recommendation:** Implement a per-field confidence indicator that the UI can render (e.g., green/yellow/red dot next to each data point). This helps users understand which data to trust and which to verify.

### P3-CROSS-03: AI summary does not disclose its limitations

`dueDiligence.ts:185-226` generates an AI summary via OpenAI using data from the report. The AI summary is presented alongside factual data without any indication that it is AI-generated analysis versus verified fact.

**Recommendation:** Prefix the AI summary with "AI-Generated Analysis:" and add a note: "This analysis is generated by AI based on the data above. It may contain errors or miss important considerations. Do not rely on this summary as the sole basis for investment decisions."

---

## Summary Table

| Lens | ID | Severity | Title |
|------|----|----------|-------|
| 126 | P1-126-01 | P1 | Ownership data shown without county freshness date |
| 126 | P1-126-02 | P1 | ownershipType always null -- vesting unknown |
| 126 | P2-126-03 | P2 | No multi-owner detection from parcel data |
| 127 | P1-127-01 | P1 | No do-not-mail suppression check before sending |
| 127 | P2-127-02 | P2 | No state-specific mail disclosure enforcement |
| 127 | P2-127-03 | P2 | Address validation not mandatory before mail send |
| 128 | P1-128-01 | P1 | Synthetic boundaries indistinguishable from real data |
| 128 | P2-128-02 | P2 | No GIS vs. recorded acreage cross-validation |
| 129 | P2-129-01 | P2 | APN format normalization is minimal |
| 129 | P2-129-02 | P2 | Only 2 county recorder APIs hardcoded |
| 129 | P2-129-03 | P2 | County GIS endpoint discovery is manual |
| 130 | P1-130-01 | P1 | Comps not filtered by sale date |
| 130 | P1-130-02 | P1 | Comps average includes outliers |
| 130 | P2-130-03 | P2 | No raw land vs. improved property distinction |
| 131 | P2-131-01 | P2 | Title chain requires manual event entry |
| 131 | P2-131-02 | P2 | Title search falls back to mock data |
| 132 | P1-132-01 | P1 | Tax year hardcoded; tax status always null |
| 132 | P2-132-02 | P2 | Auto-scraper covers only 4 counties |
| 133 | P2-133-01 | P2 | No county-specific recording lag estimates |
| 133 | P3-133-02 | P3 | No e-recording integration |
| 134 | P1-134-01 | P1 | Skip trace results lack freshness timestamp |
| 134 | P2-134-02 | P2 | Parcel address vs. skip trace address not compared |
| 135 | P1-135-01 | P1 | Dodd-Frank 3-property count not auto-tracked |
| 135 | P2-135-02 | P2 | Owner finance hardcodes rate/term without usury check |
| 136 | P1-136-01 | P1 | 1031 exchange data in-memory, not persisted |
| 136 | P2-136-02 | P2 | Capital gains estimate uses simplified rates |
| 137 | P1-137-01 | P1 | No automated heir property detection |
| 137 | P2-137-02 | P2 | No UPHPA awareness in partition assessment |
| 138 | P1-138-01 | P1 | Mineral rights check is state-level only |
| 138 | P3-138-02 | P3 | No mineral rights valuation context |
| 139 | P2-139-01 | P2 | Conservation easement detection is keyword-only |
| 139 | P3-139-02 | P3 | No conservation easement tax benefit analysis |
| 140 | P1-140-01 | P1 | No warning when GIS acreage differs from recorded |
| 140 | P2-140-02 | P2 | No legal description parsing/validation |
| 140 | P3-140-03 | P3 | Centroid uses simple average, not area-weighted |
| Cross | P1-CROSS-01 | P1 | DD report lacks prominent accuracy disclaimer |
| Cross | P2-CROSS-02 | P2 | No unified data confidence scoring |
| Cross | P3-CROSS-03 | P3 | AI summary not labeled as AI-generated |
