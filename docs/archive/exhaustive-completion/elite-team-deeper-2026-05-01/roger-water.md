# Roger Kashiwagi — Water-Rights Audit

**Reviewer:** Roger Kashiwagi, 56, Boise ID. Water-rights specialist, 22 years operating across the prior-appropriation belt. Stack: state-engineer water databases (IDWR, CO DWR, MT DNRC, WY SEO, UT DWRi, NV DWR) + a hydrologist contractor on retainer.

**Wave:** 3 — depth pass.
**Date:** 2026-05-01.
**Lens:** In Boise, Reno, Grand Junction, Bozeman — water IS land. A 40-acre dryland parcel with no water right is worth grazing money. The same parcel with a 1903 priority date for 80 acre-feet of irrigation is worth 30× more, and the right travels separately from the deed. Any "Land OS" that does not model water rights is hallucinating value across the entire West.

---

## TL;DR

AcreOS already has more water-rights infrastructure than I expected: a `WaterRightsInfo` interface in `server/services/environmentalIntelligence.ts`, a `waterRightsSystem` field in `regulatoryIntelligence.ts`, and a dedicated `environmental-intelligence-card.tsx` that gates a Water Rights panel behind a `WESTERN_WATER_STATES` allow-list. Founder copy in `routes-deals.ts` correctly calls out CO as "ADJUDICATED separately and commonly severed" and AZ/AMA permitting.

**But the implementation is a stub.** Five of the ten states it claims to support — including Idaho, Montana, Wyoming, Utah, Nevada — are MISSING from the `WATER_RIGHTS` lookup map. The schema has no concept of priority date, seniority rank, severance status, beneficial-use record, or forfeiture risk. The valuation engine (`acreOSValuation.ts`, `comps.ts`, `blindOfferCalculator.ts`) makes zero use of water-rights data. There are no water-rights data providers in the registry. A senior 1890 right and a junior 1985 right on adjacent parcels would be priced identically by the AVM.

For a Western-land investor, this is the difference between a tool that helps and a tool that gets you sued.

---

## Findings

### F-1 — `WESTERN_WATER_STATES` UI gate doesn't match data backing it

**Severity:** P0.
**Location:** `client/src/components/environmental-intelligence-card.tsx` declares `WESTERN_WATER_STATES = ["AZ", "NM", "CO", "NV", "UT", "MT", "WY", "ID", "OR", "WA"]`. The card calls `/api/environmental/water-rights/${stateUpper}` for any of these.
**Backing data:** `server/services/environmentalIntelligence.ts` lines 21-100 — the `WATER_RIGHTS` map only contains `TX, FL, AZ, CA, CO, NM, NC, GA, OR, WA`.
**Gap:** Five states the UI advertises water-rights data for — **ID, MT, WY, UT, NV** — fall through to the `getWaterRightsInfo` miss branch (line ~107) which returns `"Unknown — verify with state water agency"`. Idaho is my home state. This is the first thing I checked.
**Why it matters:** Idaho, Montana, Wyoming are pure prior-appropriation jurisdictions where the right IS the asset. A user in Twin Falls or Bozeman opens the card, sees "Unknown," and concludes AcreOS does not understand his market. He is correct.
**Fix:** Populate ID, MT, WY, UT, NV in `WATER_RIGHTS` before next release. I can dictate the entries from memory; one afternoon of work.

### F-2 — No priority date or seniority model anywhere in the schema

**Severity:** P0.
**Location:** `shared/schema.ts`. Searched for `priorityDate`, `seniorRight`, `appropriationDate` — zero hits. The only water-related fields are `hasWater: boolean` and `water?: { available, type, provider }` — i.e., AcreOS models water as a UTILITY (like sewer hookup), not as a property right.
**Why it's wrong:** First-in-time, first-in-right is the entire ballgame in 13 states. Two adjacent 40-acre alfalfa parcels with identical soil and access can differ in value by 5× based solely on whether the priority date is 1885 or 1975. In a drought year the senior holder gets full delivery; the junior gets a call letter and zero water. The platform cannot price a Western parcel without this field.
**Fix:** Add a `parcel_water_rights` table:

```
parcel_water_rights:
  id, parcelId, organizationId
  rightType (decree | permit | certificate | claim | exempt_well)
  priorityDate (date)            -- THE field
  seniorityRank (int, nullable)  -- adjudicated rank within the source
  source (surface_stream_name | aquifer_name)
  diversionPoint (geometry)
  pointOfUse (geometry)
  beneficialUse (irrigation | stock | domestic | municipal | industrial | recreation)
  authorizedQuantityCfs / authorizedQuantityAfPerYear
  status (decreed | permitted | pending | forfeit | abandoned)
  severedFromParcel (boolean)    -- F-3 below
  stateEngineerNumber (text)     -- e.g. IDWR water right no. 63-7896
```

### F-3 — No severance flag; "deed transfers water" assumption is the default

**Severity:** P0.
**Location:** parcel acquisition flows in `routes-deals.ts`, blind-offer calculator, due-diligence checklist generator (`dueDiligenceEngine.ts`).
**Behavior observed:** The DD checklist for a Colorado parcel mentions "Phase 2 ESA" but contains no item for "obtain water-rights abstract from state engineer" or "verify water rights are appurtenant vs. severed." The blind-offer calculator treats acreage × price-per-acre with no water-rights modifier.
**Why it matters:** In CO, NM, NV, and increasingly ID, water rights are routinely severed and sold separately. A buyer who closes on a CO ranch assuming the irrigation water comes with it can wake up to find the previous owner sold the water to a Front Range municipality five years ago. The deed says nothing. AcreOS must SURFACE this question before the user makes an offer.
**Fix:** Add a "Water rights conveyed?" gate in the offer flow for any parcel in `WESTERN_WATER_STATES`. Default to **unknown — investigate** rather than **assumed appurtenant**. Add corresponding DD checklist item: "Pull water-rights abstract from [state engineer]; confirm appurtenance and absence of pending change applications."

### F-4 — No forfeiture / abandonment risk surface

**Severity:** P1.
**Location:** Nothing exists.
**Background:** Most Western states forfeit water rights after 5 years (ID, NV, UT) or 10 years (CO, WY) of non-use without an excuse. A right that has not been beneficially used is functionally worthless and a sophisticated buyer will discount accordingly — but only if he knows. State engineers publish "watch lists" and partial-forfeiture proceedings.
**Fix:** Job that ingests forfeiture watchlists from IDWR, CO DWR, NV DWR, UT DWRi quarterly. Flag any `parcel_water_rights` row where `status = decreed` but the right appears on a forfeiture docket. Show a yellow banner on the parcel detail surface: "Water right 63-7896 has not been used since 2019 per IDWR records; partial forfeiture risk."

### F-5 — Adjudication status not modeled

**Severity:** P1.
**Background:** The Snake River Basin Adjudication (Idaho), the Yellowstone River Adjudication (Montana), and the various Colorado water-court Division decrees produce decreed rights with VERY different legal weight than un-adjudicated claims. A decreed right is bankable; a claim is a lawsuit waiting to happen. The schema must distinguish.
**Fix:** `rightType` enum above plus an `adjudicationCaseNumber` field. For Idaho parcels in the SRBA basin (most of southern ID), default the DD checklist to require a copy of the partial decree.

### F-6 — `regulatoryIntelligence.ts` has `waterRightsSystem` but it's never read

**Severity:** P2.
**Location:** `server/services/regulatoryIntelligence.ts` defines `waterRightsSystem: WaterRightsSystem` in its state-profile type. I cannot find any caller that branches on this field — not the AVM, not the offer calculator, not the DD generator. It exists as documentation only.
**Fix:** Pipe `waterRightsSystem === "prior_appropriation"` into the DD generator and the offer-flow gate from F-3. Make this a feature, not metadata.

### F-7 — No water-rights data provider

**Severity:** P1.
**Location:** `server/services/providers/` — `attom`, `batchdata`, `regrid`, `open-data`. Zero water-rights providers.
**Background:** State engineers publish queryable databases — IDWR has a public REST endpoint, CO DWR has HydroBase, MT has a SOAP service (yes, still SOAP), NV has a REST API. A WesternWaterRightsProvider in the registry could enrich a parcel with priority date, decree status, and forfeiture flags at lookup time.
**Fix:** New provider category `water_rights` with state-specific adapters. ID and CO first (highest investor density), then MT/WY/NV/UT.

### F-8 — Valuation engine is water-blind

**Severity:** P0 for Western markets.
**Location:** `server/services/acreOSValuation.ts`, `comps.ts`, `priceOptimizer.ts`. Searched all three for `water_right`, `WaterRights`, `priorityDate` — zero hits.
**Why it matters:** Comp selection is currently $/acre by parcel attributes. In Owyhee County, a parcel with 80 AF of senior irrigation water comps at $8,000/acre; the parcel next door without water comps at $400/acre. Treating these as comparable poisons the model. The gradient-boosting model in `gradientBoosting.ts` cannot learn this distinction because the features don't exist.
**Fix:** Once F-2 lands and `parcel_water_rights` is populated, add features: `hasDecreedWaterRight` (bool), `seniorityRank` (int), `priorityDateAge` (years), `authorizedAFPerAcre` (numeric). Re-train. Comps must be filtered to same-water-class within Western counties.

### F-9 — Beneficial-use category is missing from the data model

**Severity:** P2.
**Background:** A water right's value depends on its use category. An irrigation right cannot be transferred to municipal use without going through a change application before the state engineer or water court — a 12-36 month process. A buyer planning to develop must know the right's authorized use BEFORE making an offer.
**Fix:** `beneficialUse` enum on `parcel_water_rights` (covered above). Surface in offer flow: "This parcel has an irrigation-only water right. Conversion to domestic/municipal use requires a change application."

### F-10 — `environmentalIntelligence.ts` mentions Idaho exempt-well rule but Idaho isn't in the map

**Severity:** P1, internal contradiction.
**Location:** `environmentalIntelligence.ts` line ~92 (under Oregon) reads: "Exempt groundwater use allowed for domestic/stock up to 15k gal/day." That's actually closer to ID's 13,000 gpd domestic-exempt rule. Meanwhile no ID entry exists.
**Fix:** Audit pass — Idaho domestic exempt is 13,000 gpd plus 0.5 acre-feet for irrigation of up to 0.5 acres. Add ID entry with correct numbers.

---

### F-11 — No "call" / curtailment notification surface

**Severity:** P1.
**Background:** In a dry year, the senior holder on a stream issues a "call" through the state engineer/watermaster. Every junior right upstream is curtailed in reverse priority order until the senior is satisfied. In ID and CO this happens annually on multiple basins; junior holders get a phone call from the watermaster and 24-72 hours to shut headgates. For a buyer evaluating a junior right, the practical question is "how often was this right curtailed in the last 10 years?"
**Fix:** Ingest curtailment/call records from IDWR and CO DWR. Compute a `historicalCurtailmentRate` field (days curtailed per irrigation season, 10-yr average). Surface alongside the priority date. A 1985 priority right curtailed 60+ days/year is worth a fraction of one curtailed 2 days/year — same priority date, very different reliability.

### F-12 — "Use it or lose it" calendar isn't on the dashboard

**Severity:** P2.
**Background:** Owners with multiple rights need a calendar of beneficial-use deadlines, change-application windows, and proof-of-beneficial-use filings. UT requires a Proof of Beneficial Use within the time set by the state engineer. NV requires Proof of Completion and Proof of Beneficial Use on permitted rights. Missed filings = forfeiture.
**Fix:** Once `parcel_water_rights` exists, derive deadlines from `priorityDate + state-specific intervals` and surface in the operator dashboard's calendar view. This converts AcreOS from a deal-flow tool into an asset-management tool for water-heavy portfolios — meaningful TAM expansion in the West.

### F-13 — Map layer doesn't show the diversion point

**Severity:** P2.
**Background:** A water right has a diversion point (where you take water from the source) and a place of use (where you apply it). The diversion point is often NOT on the parcel — it can be miles upstream on a ditch with shared headgate. A buyer needs to see the diversion point relative to the parcel boundary on the map; if the diversion is on a neighbor's land via a ditch easement, the entire right is contingent on that easement remaining valid.
**Fix:** Map layer rendering `parcel_water_rights.diversionPoint` and `pointOfUse` geometries with a connecting line. Color-code by priority date age (deep blue = pre-1900, light blue = post-1980).

### F-14 — Conjunctive-use / interconnected-aquifer modeling absent

**Severity:** P3 (deep-cut, but matters in ID/NV).
**Background:** The Snake River Plain Aquifer is hydrologically connected to the Snake River. Idaho administers groundwater and surface water conjunctively; pumping a junior groundwater right can be curtailed to protect a senior surface right miles away. The legal doctrine of "conjunctive management" means a parcel's groundwater right may be curtailed by a surface call it's not directly tied to.
**Fix:** Aquifer-river connectivity layer (USGS publishes these). Flag any groundwater right in a connected basin as "subject to conjunctive call." Show this on the right detail card.

---

## Persona-specific assertions Roger needs to see before recommending the platform

1. **Idaho coverage parity with Colorado.** If you can show me a Twin Falls hay-ground parcel and pull the IDWR water-right number with priority date, I'll trial it.
2. **Severance default = unknown, not assumed.** I have watched buyers lose six figures on this exact ambiguity.
3. **AVM that prices a senior right.** The current model is dangerous in the West because it is confidently wrong rather than humbly absent.
4. **Forfeiture watchlist on the parcel detail page.** If you can flag a 5-year non-use risk before I make an offer, you've earned my retainer.
5. **A "send to hydrologist" export.** I work with one contractor; let me ship her a clean PDF with the diversion point, point of use, and decree number rather than copying fields by hand.

---

## Severity summary

- **P0 (ship-blockers for Western markets):** F-1, F-2, F-3, F-8.
- **P1:** F-4, F-5, F-7, F-10.
- **P2:** F-6, F-9.

Ten findings. Four ship-blockers. The good news: the bones exist. `environmentalIntelligence.ts` and the environmental card are real work, not vaporware. The fix is to finish what was started — populate the missing states, add the property model for priority date and severance, and pipe water-rights signal into valuation and DD.

Until then, I'd recommend AcreOS to a Texas or Carolina investor without hesitation. For my book of business in Boise — not yet, but I'll re-audit when F-1 through F-3 land.

— Roger Kashiwagi
