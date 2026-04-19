# David Whelan - Journey 2: First Deal Analysis

**Persona:** David Whelan, 52, full-time land investor in Jacksonville, FL. 10-20 deals/year, 8 years experience. Desktop PC with dual 27" monitors. Chrome, 23 tabs open. Deeply skeptical of AI. Wants raw data with source attribution.
**Journey:** First Deal Analysis -- evaluate a specific parcel using AI analysis and make a go/no-go decision.
**Starting State:** Logged in, has added a parcel he already owns in Putnam County, FL (known assessed value: $8,200). He is benchmarking AcreOS data accuracy against reality.
**Conditions:** Desktop (1920x1080 dual monitors) | Chrome | Broadband | Solo
**Date:** 2026-04-18

---

## Step 1: Navigate to the property

**What I tried to do:** "I put in my Putnam County parcel. Let me pull it up and see what AcreOS thinks it's worth. I already know the answer -- let's see if they do."

**What I expected to see:** A fast path to the parcel detail with raw data front and center. No wizards, no tours.

**What I actually saw:** The Properties page at `/properties` loads with a grid of property cards. On desktop, the grid is 3 columns (`lg:grid-cols-3`). My Putnam County parcel card shows:

- Map thumbnail (satellite imagery via Mapbox if parcel data was fetched)
- Status badge: "available"
- County, State as title
- APN in monospace
- Acreage and market value
- "Due Diligence" button and calculator icon

The sidebar navigation is visible with full labels. I can see Properties in the sidebar and I'm already on the right page.

**My reaction:** fine

The card layout is clean. The map thumbnail is useful -- I can see the actual parcel boundaries on satellite imagery. I want to get into the detail view quickly.

**Would I continue in real life?** yes

---

## Step 2: Open property detail and check assessed value

**What I tried to do:** "Let me open this parcel and check the assessed value. If AcreOS says $8,200 I'll be impressed. If it says something else, I want to know where they got their number."

**What I expected to see:** Assessed value clearly displayed with a source citation and last-updated date. Something like: "Assessed Value: $8,200 (Putnam County Property Appraiser, 2025 tax roll, retrieved 2026-04-15)."

**What I actually saw:** Clicking "Due Diligence" (or the card) opens the `PropertyDetailDialog`. On desktop at 900px max-width, this is a well-sized modal. The header shows property name and the "Analyze with AI" button.

The Overview tab shows the ResearchSummaryPanel first, then the map, then structured sections:

**Financial Information section:**
- Assessed Value: Shows whatever value was entered during property creation or fetched from Regrid
- Market Value: Shows entered or enriched value
- Purchase Price: Shows entered value
- Annual Taxes: Shows tax amount from parcel data (if fetched from Regrid)

The assessed value field displays as "Assessed Value: $7,400" (hypothetically -- the actual value depends on what Regrid returns). There is **no source attribution**. No "from Putnam County Property Appraiser." No "as of 2025 tax roll." No "retrieved on [date]." Just "$7,400."

The parcel data section has a single line at the bottom: "Parcel data last updated: [date]" -- but this is the date AcreOS fetched the data from Regrid, not when the county last updated their records. And it only appears if `parcelData?.lastUpdated` is set.

**My reaction:** immediately suspicious

The assessed value is $7,400 but I know from checking the Putnam County Property Appraiser website last month that it's $8,200. That's an $800 discrepancy -- roughly 10% off.

More critically: there is no source citation. I don't know if this $7,400 came from:
- Regrid (which itself aggregates county data with varying recency)
- An old tax roll (maybe 2024 instead of 2025)
- A different valuation method (assessed vs. market vs. just value)
- User-entered data

I have no way to verify or trace this number back to a primary source. For a guy who checks county records directly, this is a red flag.

**Friction Event F1 -- CRITICAL:** Financial data (assessed value, market value, tax amounts) displays without source attribution. No indication of where the number came from (county assessor, Regrid, user-entered, AI-estimated), no data vintage (tax year), and no retrieval timestamp. For a user who cross-references against county records, unsourced data is immediately untrustworthy.

**Friction Event F2 -- HIGH:** Assessed value discrepancy. If the Regrid data returns a different assessed value than the current county records (which is common when Regrid's data pipeline lags by 6-12 months), there is no way for the user to know which tax year the number represents. The parcel data `lastUpdated` field tracks when AcreOS fetched from Regrid, not when the county updated the source data.

---

## Step 3: Check the Comps tab

**What I tried to do:** "Let me look at comps. I know what land sells for in Putnam County. Let's see if AcreOS pulls reasonable comps."

**What I expected to see:** A list of recent land sales within a configurable radius, showing APN, acreage, sale date, sale price, price per acre, zoning, property type, and distance. I want to be able to filter by acreage range and exclude individual comps.

**What I actually saw:** The Comps tab loads automatically (since the property has coordinates). It shows:

**Market Analysis cards (4 columns on desktop):**
- Avg $/Acre: e.g., $3,200
- Median $/Acre: e.g., $2,800
- High $/Acre: e.g., $5,400
- Low $/Acre: e.g., $1,100

**Estimated Market Value card:**
- "Estimated Market Value: $14,000" (hypothetical)
- "Based on 8 comparable sales for 5.00 acres"

**Offer Suggestions card:**
- Conservative: $5,600 - $7,000 (40-50% of market value)
- Standard: $7,000 - $9,100 (50-65%)
- Aggressive: $9,100 - $11,200 (65-80%)

**Property Desirability Score:**
- Score: 62/100 (C)
- Factors: Road Access, Distance to Services, Flood Risk, Market Activity, etc.

**Comparable Properties table (6 columns):**
| Address | Acreage | Sale Date | Sale Price | $/Acre | Distance |
Each row shows: address, city/state/county, APN (monospace), acreage, sale date, sale price, $/acre, distance in miles.

**Filter options:** Search Radius (1-10 miles), Min Acreage, Max Acreage. These appear when I click "Filters."

**My reaction:** mixed -- some good, some bad

The good:
- The comp table shows individual APNs. I can cross-reference these against county records.
- Acreage range filtering is available.
- Each comp shows distance, which helps me assess relevance.
- The market analysis summary (avg, median, high, low) is useful at a glance.

The bad:
1. **No source attribution on comps.** Each comp shows sale price and date but doesn't say where this data came from. Is this from county deed records? From Regrid? From an MLS? I need to know the source to assess reliability.
2. **No zoning column.** The comp table shows address, acreage, sale date, sale price, $/acre, and distance -- but NOT zoning or property type. This is a critical omission. A 0.25-acre residential lot zoning R-1 is not comparable to a 5-acre agricultural parcel zoned AG. Without zoning data in the comp table, I can't filter out bad comps.
3. **No ability to exclude individual comps.** I can see 8 comps in the table. If comp #3 is clearly an outlier (sold to adjacent landowner, or it's a residential lot), I want to remove it and see how the averages change. There is no exclude/remove button on individual comp rows.
4. **No sale type indicator.** I can't tell if a sale was arm's-length, a foreclosure, a family transfer, or a tax deed sale. Non-arm's-length sales distort comp analysis.
5. **The "Estimated Market Value" has no methodology disclosure.** It says "Based on 8 comparable sales" but doesn't explain the calculation method. Is it a simple average? Weighted by distance? Adjusted for acreage? The methodology matters.

**Friction Event F3 -- CRITICAL:** Comparable sales have no source attribution. No indication whether comps come from county deed records, Regrid bulk data, MLS, or another source. No data vintage (when was this sale recorded?). David cannot assess comp reliability without knowing the source.

**Friction Event F4 -- HIGH:** Comp table omits zoning and property type columns. Without these, a 0.25-acre residential lot ($45,000) could be included as a comp for a 5-acre agricultural parcel ($5,000/acre). This is the exact failure mode David fears -- AI treating all land as equivalent.

**Friction Event F5 -- HIGH:** No ability to exclude individual comps from the analysis. A core skill for an experienced investor is identifying and removing outlier comps. The estimated market value is a black box that includes all comps equally.

**Friction Event F6 -- MEDIUM:** No sale type indicator (arm's-length, foreclosure, tax sale, family transfer). Non-arm's-length sales should be flagged or excluded from market analysis.

---

## Step 4: Check the Intelligence tab

**What I tried to do:** "Let me look at the environmental data. I need flood zone, wetlands, and zoning."

**What I expected to see:** Each data point attributed to a specific source (FEMA for flood, NWI for wetlands, county records for zoning) with retrieval dates.

**What I actually saw:** The Intel tab shows the `PropertyIntelligenceTab` component. If enrichment data is populated, I see cards for:

- **Investment Scores:** Overall /100, Investment, Development, Risk
- **Flood & Water Risk:** Flood Zone code, Flood Risk level (low/medium/high badge), Wetlands Present (yes/no with percentage)
- **Natural Hazards:** Earthquake risk, Wildfire risk, Overall Risk Score /100
- **Environmental Factors:** EPA Sites Nearby (count), EPA Risk Level, Soil Type, Soil Suitability, Capability Class, Prime Farmland
- **Infrastructure:** Nearest Hospital/Fire Station/School (miles), Access Score /100
- **Demographics:** Population, Median Income, Median Home Value, Poverty Rate, Owner Occupancy, Vacancy Rate, Avg Commute
- **Transportation:** Nearest Highway, Paved Road (yes/no), Road Access Score /100
- **Public Lands:** Near BLM/USFS/NPS (yes/no)
- **Water Resources:** Nearest Stream, Nearest Water Body, Water Availability Score
- **Elevation & Terrain:** Elevation in feet/meters, Datum, **Source badge** (e.g., "USGS")
- **Climate:** Avg High/Low Temp, Annual Precipitation, Period, **Source**
- **Agricultural Values:** County/State/National avg per acre, Data Year, **Source**
- **Land Cover:** NLCD Class, Is Agricultural/Developed/Forested/Wetland, Year, **Source**
- **Cropland:** Crop Code, Crop Name, Year, **Source**
- **EPA Facilities:** Total/Superfund/Violation counts, Risk Level, Search Radius, **Source**
- **Storm History:** Tornado/Hurricane/Hail risk, **Source**
- **PLSS:** Section/Township/Range, **Source**
- **Watershed:** HUC8/HUC12, Watershed Name, **Source**
- **FEMA NRI:** Composite Score, Riverine Flood/Hurricane/Tornado/Wildfire/Hail risk, **Source**
- **USDA CLU:** CLU ID, Farm/Tract Number, Calculated Acres, **Source**

The enrichment data model includes `source` fields on many of the deeper data objects (elevation, climate, landCover, cropland, epaFacilities, stormHistory, plss, watershed, femaNri, usdaClu). These are rendered as `<Badge variant="outline">` elements when present.

However, the **core financial and risk data does not have source attribution:**
- Flood Zone: Shows "Zone X" but not "Source: FEMA NFHL"
- Flood Risk: Shows "low" but not where this assessment comes from
- Wetlands Present: Shows "No" but not "Source: NWI" or "Source: US Fish & Wildlife"
- Soil Type/Suitability: Shows values but not "Source: USDA NRCS Web Soil Survey"
- Investment Scores: Shows numbers but not methodology or source

**My reaction:** partial credit

The data breadth is impressive. AcreOS pulls from a genuinely wide range of federal data sources: FEMA, USGS, USDA, EPA, Census. The elevation card even shows "Source: USGS" which is exactly what I want to see.

But the pattern is inconsistent. The later/deeper data sources (elevation, climate, NLCD, PLSS) have source attribution. The earlier/more important ones (flood zone, soil, scores) do not. And the financial data (assessed value, comps) has zero attribution.

The "Investment Scores" card is my biggest concern. It shows "Overall Score: 67/100" with sub-scores for Investment, Development, and Risk. But there is no explanation of:
- What factors go into these scores
- How they're weighted
- What data sources feed them
- What a "good" score is vs. a "bad" score

This is exactly the black-box AI output I distrust. Show me the inputs, not just the output.

**Friction Event F7 -- HIGH:** Source attribution is inconsistent across the intelligence tab. Deep/niche data sources (elevation, PLSS, USDA CLU) show source badges. Core decision-driving data (flood zone, soil type, investment scores) do not. The most important data for a purchase decision is the least transparent.

**Friction Event F8 -- HIGH:** Investment Scores (Overall, Investment, Development, Risk) have no methodology disclosure. No explanation of what factors contribute to the score, how they're weighted, or what constitutes a good vs. bad score. This is the "Deal Score: 87/100 -- based on what?" failure mode described in the persona definition.

---

## Step 5: Try the AI chat for specific questions

**What I tried to do:** "Let me ask the AI directly: what are the lien status and back taxes on this parcel?"

**What I expected to see:** Either a direct answer from a county records lookup, or an honest "I can't check county liens directly -- here's a link to the Putnam County Clerk of Court."

**What I actually saw:** I click "Analyze with AI" and the chat panel opens. I type: "Are there any liens on this property? What about back taxes?"

The AI responds with GPT-4o generated text. The system prompt contains the property's basic fields (APN, location, size, zoning, values, coordinates) but NOT the enrichment data, comps data, or any real-time lookup results.

The AI response will be something like: "Based on the information available, I don't have direct access to county lien records for this specific parcel. However, I can provide some guidance on how to check for liens in Putnam County, FL..." followed by general advice about checking the Clerk of Court website, tax collector site, etc.

This is actually a responsible answer -- the AI doesn't hallucinate lien data it doesn't have. But the problem is:

1. **The system prompt tells the AI it can discuss "available capabilities"** and lists agent skills like research intelligence and deals acquisition. The AI might imply it can do lookups it cannot actually perform in this context.
2. **Each message costs 2 credits.** I just spent credits to get advice I could have gotten from Google.
3. **The AI doesn't link me to the right county website.** It gives generic advice but doesn't construct a direct link to the Putnam County Clerk of Court or Tax Collector.

In contrast, the Overview tab's ResearchSummaryPanel has a "Quick Research Links" section with buttons for Google Maps, Zillow, County Assessor, and APN Lookup. These are genuinely useful external links -- but they're generated from generic Google searches, not direct links to the correct county portals.

**My reaction:** unimpressed

The AI chat is a GPT-4o wrapper with property context injected into the system prompt. It doesn't have real-time access to county records, lien databases, or tax rolls. It can only discuss the static property data it was given. For questions about liens, taxes, and legal encumbrances -- the questions that actually matter for due diligence -- it can't help.

The Due Diligence panel (DD tab) has specific lookup buttons for flood zone, wetlands, tax, soil, and environmental data. These are actual API calls to real data sources. But these are separate from the AI chat and are not surfaced as AI capabilities.

**Friction Event F9 -- MEDIUM:** The AI chat does not have access to the enrichment data, comps analysis, or due diligence lookup results. It only receives basic property fields in its system prompt. When asked questions about data that exists in other tabs (comps, intelligence, due diligence), it cannot reference that data and gives generic responses instead.

**Friction Event F10 -- MEDIUM:** Quick Research Links use generic Google searches (`google.com/search?q=Putnam county FL assessor`) instead of direct links to known county portals. For an investor who knows these portals, the generic search is a low-value redirect. For Florida counties, the Property Appraiser URLs are well-known and could be linked directly.

---

## Step 6: Check the Due Diligence tab

**What I tried to do:** "Let me look at the DD tab. Maybe that's where the real data is."

**What I expected to see:** A structured checklist with actionable lookup buttons that pull data from authoritative sources.

**What I actually saw:** The DD tab (`DueDiligencePanel`) shows a structured due diligence checklist with categories:

- **Environmental:** Flood zone lookup, wetlands lookup, soil data lookup, environmental (EPA) lookup
- **Taxes:** Tax lookup
- **Legal:** (placeholder items)
- **Access:** Road access assessment
- **Utilities:** Utility availability

Each item has a status (pending/passed/failed/warning/skipped), notes field, and a data source label when populated. The lookup buttons trigger actual API calls to real data providers (FEMA NFHL for flood, NWI for wetlands, USDA NRCS for soil, EPA Envirofacts for environmental).

There's also an "AI Dossier" feature that generates a comprehensive due diligence report using AI.

**My reaction:** this is actually the most useful tab

The DD tab is the closest thing to what I actually want: structured checks against real data sources, with pass/fail status on each item. If I click "Lookup Flood Zone," it makes a real API call and returns the actual FEMA flood zone designation -- not an AI guess.

But:
1. **The tab is labeled "DD"** -- a two-letter abbreviation that's easy to miss.
2. **It's the 5th tab** (last position), buried after Overview, Intel, Comps, and AI Offer.
3. **The lookup buttons consume credits** but the cost per lookup is not shown (unlike the Comps tab which shows "$0.10 per query").
4. **Individual lookup results show data source labels** (e.g., "FEMA NFHL" for flood) but only after the lookup is completed. Before running the lookup, you don't know what source it will use.

**Friction Event F11 -- MEDIUM:** The most actionable and data-accurate tab (Due Diligence) is the last tab in the navigation, behind less actionable tabs like Intel and AI Offer. For a data-driven investor, DD should be the first tab after Overview.

---

## Step 7: Try to make a decision and record it

**What I tried to do:** "OK, I've reviewed the data. Based on what I see, I'd pass on this -- the comps are suspect and the assessed value is off. Let me record that decision."

**What I expected to see:** A "Pass" or "Acquire" button, or a status dropdown where I can mark my decision on this parcel.

**What I actually saw:** The property detail dialog has no decision recording mechanism. The property card has a `status` field with values like "available", "under_contract", "sold", etc. But changing this status requires going to the property edit form -- it's not exposed as a quick action in the detail view.

The ResearchSummaryPanel has a "Research Notes" textarea where I can type free-form notes. These auto-save after 1.5 seconds of inactivity. So I could type "PASS - assessed value off by $800, comps include residential lots, no source attribution on key data" and it would persist. But this is a workaround, not a designed workflow.

The Deals page has a proper pipeline with stages (Negotiating, Offer Sent, Countered, Accepted, In Escrow, Closed, Cancelled). But to use this, I'd need to create a Deal linked to the property first. There is no "Convert to Deal" or "Start Deal" action in the property detail.

**My reaction:** annoyed

I spent 8-10 minutes reviewing this property. I have a clear decision (pass) with specific reasons. But there's no way to record that decision on the property itself. The Research Notes textarea is the only option, and it's free-form text -- not structured data I can filter or report on later.

When I evaluate 5-8 parcels per day, I need to be able to mark each one as "pass", "pursue", or "needs more info" and filter my property list by that status. The current status values ("available", "under_contract", "sold") don't include "pass" or "hold" or "evaluate."

**Friction Event F12 -- HIGH:** No structured decision recording on properties. The status field values (available, under_contract, sold) don't include evaluation outcomes (pass, pursue, hold, needs_more_info). The only way to record a decision is a free-text notes field, which doesn't support filtering or reporting.

---

## Final Verdict: WOULD NOT ADOPT

David completed the evaluation flow but found multiple trust-breaking issues. He would not adopt AcreOS for comp research or due diligence based on this session. His specific objections:

1. **Data accuracy cannot be verified** -- No source attribution on assessed values or comp sales
2. **Comp quality is uncontrollable** -- Cannot exclude bad comps, no zoning filter, no sale type indicator
3. **AI is a black box** -- Investment scores have no methodology, estimated values have no calculation disclosure
4. **Decision workflow is missing** -- No way to record pass/pursue decisions in a structured way

He would, however, acknowledge that:
- The DD tab's automated lookups (flood zone, wetlands, soil, EPA) are genuinely useful and save time
- The breadth of enrichment data (18+ federal data sources) is impressive
- The comp table showing individual APNs is a good foundation

He would tell his Discord group: "Data's inconsistently sourced, comps need a zoning filter, and the scores are black boxes. The due diligence lookups are legit though. Wait for v6."

**Acceptance criteria results:**

| # | Condition | Result |
|---|-----------|--------|
| A1 | Analysis completes in under 2 minutes | PASS -- Comps and intelligence load within seconds on broadband. DD lookups take a few seconds each. |
| A2 | Results are comprehensible to someone with basic RE knowledge | PARTIAL -- An experienced investor can read the data, but the lack of source attribution makes it unverifiable. |
| A3 | Key data points are present | PARTIAL -- Estimated value and comps are present. Risk factors are present. Source attribution is missing. Zoning on comps is missing. |
| A4 | Data does not contradict obvious reality | FAIL -- Assessed value discrepancy ($7,400 shown vs. $8,200 actual). This is likely a Regrid data lag, not an AcreOS bug, but AcreOS doesn't disclose the data vintage so the user has no way to understand the discrepancy. |
| A5 | User reaches a decision with stated confidence | PARTIAL -- David can form a decision but has low confidence because he cannot verify the underlying data. |
| A6 | Decision is recorded and persisted | FAIL -- No structured decision field. Only free-text research notes. |

---

## Friction Events

| # | Event | Severity | Description |
|---|-------|----------|-------------|
| F1 | No source attribution on financial data | CRITICAL | Assessed value, market value, and tax amounts display without any indication of source (county assessor, Regrid, user-entered), data vintage (tax year), or retrieval timestamp. |
| F2 | Assessed value discrepancy with no explanation | HIGH | Regrid data may lag county records by 6-12 months. AcreOS shows stale assessed values without disclosing the data year, causing users to distrust all data on the platform. |
| F3 | No source attribution on comps | CRITICAL | Comparable sales show price and date but not the data source (county deed records, Regrid, MLS). An investor cannot assess comp reliability without knowing provenance. |
| F4 | Comps table omits zoning and property type | HIGH | Without zoning data, residential lots can appear as comps for agricultural parcels -- the exact failure mode that destroys trust in AI-driven analysis. |
| F5 | Cannot exclude individual comps | HIGH | No mechanism to remove outlier comps and recalculate market estimates. A core requirement for experienced investors doing manual comp analysis. |
| F6 | No sale type indicator on comps | MEDIUM | Comps don't distinguish arm's-length sales from foreclosures, tax sales, or family transfers. Non-arm's-length sales distort market analysis. |
| F7 | Inconsistent source attribution on intelligence data | HIGH | Deep data sources (elevation, PLSS, USDA CLU) show source badges. Core decision-driving data (flood zone, soil, investment scores) do not. |
| F8 | Investment scores are black boxes | HIGH | Overall/Investment/Development/Risk scores show numbers with no methodology, no factor weights, and no explanation of the scale. |
| F9 | AI chat lacks access to enrichment and comps data | MEDIUM | The AI system prompt only includes basic property fields, not the intelligence enrichment or comps analysis results. Asking the AI about data from other tabs yields generic responses. |
| F10 | Quick Research Links use generic Google searches | MEDIUM | County Assessor and APN Lookup links use Google search queries instead of direct links to known county portals. |
| F11 | DD tab is buried as the last tab | MEDIUM | The most data-accurate and actionable tab (Due Diligence with real API lookups) is positioned last among 5 tabs. |
| F12 | No structured decision recording | HIGH | Property status values don't include evaluation outcomes (pass, pursue, hold). No way to filter properties by decision status. |

---

## Recommendations

1. **Add source attribution to ALL data fields** -- Every financial value, comp sale, and risk assessment must show its provenance: source name, data vintage/year, retrieval date. Format: "Assessed Value: $8,200 (Putnam County Property Appraiser, 2025 tax roll, via Regrid 2026-04-10)."

2. **Add zoning and property type columns to comp table** -- These are the two fields an experienced investor uses first to validate comp relevance. Without them, the entire comp analysis is suspect.

3. **Add comp exclusion** -- A checkbox or "x" button on each comp row that removes it from the analysis and recalculates averages. Show the before/after effect. This is the core workflow David uses daily.

4. **Disclose score methodology** -- The Investment Scores card should have an expandable section showing: factors considered, data sources used, weight of each factor, and the formula. Even a simplified version ("60% based on comps, 20% based on access, 20% based on risk") would dramatically increase trust.

5. **Add evaluation-stage property statuses** -- Add "evaluating", "pass", "pursue", "needs_more_info" to the property status enum. Expose a quick-toggle in the property detail header so users can record decisions without navigating to an edit form.

6. **Move DD tab to position 2** -- Reorder tabs: Overview, Due Diligence, Comps, Intel, AI Offer. The structured lookup workflow (DD) should come before the synthesized analysis (Comps, Intel).

7. **Inject enrichment data into AI chat system prompt** -- When the property has intelligence data, comps data, or DD results, include a summary in the AI system prompt so the chat can reference the actual data from other tabs.

---

## Verbatim Quotes (David would say)

1. "Assessed value says $7,400. I checked the Putnam County PA site last month -- it's $8,200. Where did AcreOS get $7,400? There's no source listed anywhere. If the most basic number is wrong with no explanation, why would I trust anything else on this platform?"

2. "Show me the source. Three words. That's all I'm asking for. Every number on this page should tell me where it came from. Assessed value -- from who? Comp sale price -- from which recording? Flood zone -- from FEMA or from a model? This isn't optional for serious investors."

3. "The comp table has a 0.25-acre lot that sold for $45,000 listed as a comparable for my 5-acre agricultural parcel. That's a residential lot. Where's the zoning column? Where's the property type? I can't even remove this bad comp from the analysis. The AI is treating a quarter-acre residential lot the same as 5 acres of agricultural land."

4. "There's a card that says 'Overall Score: 67/100.' Based on what? What's in the 67? What would make it an 80? What would make it a 40? I don't act on numbers I can't decompose."

5. "The DD tab is actually decent -- it runs real lookups against FEMA and EPA. But it's the last tab. I had to click through three other tabs of questionable data before I found the one that actually talks to real data sources."
