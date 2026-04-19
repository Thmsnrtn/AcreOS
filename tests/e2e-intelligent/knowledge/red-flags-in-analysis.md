# Red Flags in AI Analysis: Credible vs. Non-Credible Output

Evaluation reference for the AcreOS intelligent E2E test harness. Each example below shows what a land investor would consider credible AI output from Atlas or Pax versus what would immediately erode trust. The test agent uses these patterns to score AI responses during automated journeys.

---

## How to use this document

For each scenario, there are four sections:

- **Scenario** - What the user asked or what parcel data was provided.
- **Credible output** - What a knowledgeable AI assistant would say. Specific data, correct math, flagged risks, cited sources, appropriate hedging.
- **Non-credible output** - What a generic or poorly trained AI would say. Vague language, invented confidence, missing risk flags, unsupported recommendations.
- **Why it matters** - What a real investor would notice and why it breaks trust.

---

## 1. Basic Parcel Valuation (Comps-Based)

**Scenario:** User asks Atlas to value a 10-acre parcel in Cochise County, AZ (APN 301-45-678). The parcel is zoned rural residential, has paved road frontage, and no improvements.

**Credible output:**
> Based on 6 comparable sales in Cochise County within the last 18 months (5-20 acres, road access):
> - 8.5ac, 4mo ago, $1,800/ac | 12ac, 7mo ago, $1,550/ac | 10.2ac, 11mo ago, $1,700/ac
> - 15ac, 6mo ago, $1,400/ac (larger = lower $/ac) | 7ac, 3mo ago, $2,100/ac (smaller premium) | 10ac, 14mo ago, $1,650/ac
>
> Estimated value: $16,000-$18,500 ($1,600-$1,850/acre). Paved road frontage is a positive -- several comps had dirt access only. Offer range for cash flip: $6,400-$7,400 (40% of value).
>
> Note: Excludes improvements or water rights. Assessor shows no structures. Could not verify well/utility access -- confirm before closing.

**Non-credible output:**
> This 10-acre property in Arizona is estimated to be worth approximately $20,000-$25,000 based on market conditions. Arizona land values have been appreciating steadily, making this a good investment opportunity. I recommend making a competitive offer to secure this property.

**Why it matters:** The credible output shows specific comps with per-acre pricing, adjusts for parcel size and access quality, and flags unknowns. The non-credible output has no comps, an unsupported range, and generic language. Any investor with five deals under their belt dismisses the second output immediately.

---

## 2. Landlocked Parcel (Access Is the #1 Issue)

**Scenario:** User asks Pax to evaluate a 20-acre parcel in Elko County, NV. The parcel is surrounded by BLM (Bureau of Land Management) land with no recorded road easement.

**Credible output:**
> Critical issue: This parcel appears landlocked. County recorder shows no recorded access easement. Surrounded by BLM land on all sides.
>
> Options: (1) BLM right-of-way permit under FLPMA -- 6-18 months, $1K-$5K in fees + survey. (2) Prescriptive easement claim if prior continuous use exists -- $3K-$8K attorney fees, uncertain outcome. (3) Negotiate deeded easement with any adjacent private owners -- fastest path.
>
> Without legal access, value drops to 10-20% of accessible equivalent. Accessible 20-acre comps in Elko: $800-$1,200/acre ($16K-$24K). Landlocked: $2,000-$4,000 total.
>
> Recommendation: Do not offer unless you have a clear, affordable path to legal access.

**Non-credible output:**
> This is a nice 20-acre parcel in Elko County. At current market rates, similar parcels are selling for around $15,000-$20,000. The location near public land is actually a benefit as it provides privacy and potential recreation access. I'd suggest offering around $8,000-$10,000.

**Why it matters:** The non-credible output treats BLM adjacency as a feature and values the parcel as if it has access. A landlocked parcel without a viable access path is nearly worthless. Missing this is the most damaging error a land AI can make.

---

## 3. Tax-Delinquent Parcel (Motivation vs. Title Risk)

**Scenario:** User found a 5-acre parcel in Maricopa County, AZ with 4 years of delinquent property taxes totaling $3,200. Owner is out of state. Assessed value: $18,000.

**Credible output:**
> Strong motivated-seller signals: 4 years delinquent + absentee owner. But significant risks:
>
> **Tax lien risk:** Maricopa County sells liens annually in February. At 4 years delinquent, a lien has almost certainly been sold. The holder can petition for a treasurer's deed 3 years after the lien sale. Check with the Maricopa County Treasurer for lien status and redemption deadline.
>
> **Valuation:** Arizona assesses vacant land at 16% of full cash value. $18,000 / 0.16 = $112,500 implied market value -- but this seems high for 5 raw acres. Cross-check with comps for 3-7 acre parcels in the same area.
>
> **Acquisition math:** Purchase price + $3,200 back taxes + ~$1,000 closing + $300-$500 title search. Order a title commitment -- 4 years delinquent often means other liens (HOA, judgments). Title insurance strongly recommended.
>
> **Offer strategy:** $3,000-$5,000 plus assumption of back taxes. Total investment: $6,200-$8,200.

**Non-credible output:**
> Great opportunity! The owner is 4 years behind on taxes, so they'll be very motivated to sell. With an assessed value of $18,000, you should offer around $5,000-$7,000. This is a solid deal with good upside. The delinquent taxes just show the owner doesn't care about the property.

**Why it matters:** The non-credible output treats assessed value as market value (Arizona uses 16% fractional ratio), ignores tax lien risk, and skips title search/insurance. Following this advice could mean buying a parcel only to lose it to a lien holder.

---

## 4. Parcel in a Flood Zone (FEMA Maps, Insurance)

**Scenario:** User asks Atlas to evaluate a 2-acre parcel in Harris County, TX for a seller-financed residential lot sale. The parcel is in FEMA Flood Zone AE.

**Credible output:**
> Zone AE = 1% annual flood probability (100-year floodplain). Major implications for your seller-finance exit:
>
> **Residential use:** Federally-backed mortgages require flood insurance; your seller-financed buyers technically don't, but should know the risk. Flood insurance in Zone AE: $1,200-$3,500/year. Post-Harvey, Harris County requires finished floors 2+ feet above BFE, adding $15K-$40K to building costs. Check the Harris County Flood Control District map for this parcel's BFE.
>
> **Value impact:** Non-flood 2-acre lots in Harris County: $30K-$50K. Flood zone lots: 30-50% discount ($15K-$25K). Much smaller buyer pool.
>
> **Seller-finance risk:** Flood increases default probability -- buyer builds, floods, walks. Require 25-30% down. Disclose flood zone in writing (failure to disclose = legal liability).
>
> **Recommendation:** Works only at flood-adjusted pricing. Acquire at $5K-$8K, seller-finance at $18K-$22K. Must disclose.

**Non-credible output:**
> This 2-acre lot in Harris County has good potential for residential development. The area is growing rapidly and property values are increasing. You could purchase this and sell it with seller financing for a nice profit. I'd estimate the value at $35,000-$45,000 based on comparable lots in the area.

**Why it matters:** The non-credible output ignores the flood zone entirely and values the lot as if it were not in a floodplain. In post-Harvey Harris County, flood zone awareness is the first thing any investor checks.

---

## 5. Mineral Rights Separated

**Scenario:** User asks Atlas about a 40-acre parcel in Reeves County, TX (Permian Basin). The deed conveys surface rights only; mineral rights were severed in 1985.

**Credible output:**
> Important: Surface rights only. Minerals severed in 1985.
>
> **Reeves County context:** Heart of the Permian Basin -- severed minerals here are not theoretical. Active/future drilling is probable. Under Texas law, the mineral estate is dominant: the mineral holder can use reasonable surface area for drilling, roads, pipelines. Check county clerk for recorded surface use agreements.
>
> **Value impact:** Surface-only parcels in active Permian Basin counties trade at 30-60% below unified-rights parcels. Surface-only 40-acre comps: $800-$1,500/acre. With minerals: $2,000-$4,000+/acre.
>
> **Use impact:** Drilling activity (noise, truck traffic) is a negative for recreational or residential buyers. You may get surface damage payments but cannot prevent drilling.
>
> **Recommendation:** Not a dealbreaker, but price must reflect surface-only. Check the Texas Railroad Commission for active permits on or adjacent to this parcel.

**Non-credible output:**
> This 40-acre property in Reeves County, TX is a great investment. Land in this area is in high demand. At $1,500/acre, you're looking at a value around $60,000. The mineral rights situation is common in Texas and shouldn't be a major concern. I'd recommend making an offer around $25,000.

**Why it matters:** Dismissing severed minerals in the Permian Basin is disqualifying. The non-credible output values the parcel as if minerals are included -- overpaying by 50-100%.

---

## 6. HOA-Encumbered Parcel (Fees Eat Margins)

**Scenario:** User asks Pax to analyze a 1-acre lot in a rural subdivision in Polk County, FL. The lot is in a subdivision with a mandatory HOA charging $850/year. There are $4,250 in unpaid HOA dues (5 years delinquent).

**Credible output:**
> HOA problem that materially impacts deal economics:
>
> **HOA analysis:** $850/year dues, $4,250 unpaid (5 years). In Florida, HOA liens survive sale -- you pay these at closing. Check with HOA management for additional late fees/attorney fees; total could be $5K-$6K.
>
> **Deal math:** Comparable lots: $12K-$18K (without arrears). Buy at $3K + $4,250 arrears + closing = $7,250-$8,250 all-in. Sell at $14K = $5,750-$6,750 margin -- only if you find a buyer who accepts $850/year perpetual dues.
>
> **Exit risk:** HOA lots are harder to sell; many land buyers avoid them. Seller-financing adds HOA on top of note payment, increasing defaults. What does the HOA cover? If it's just dirt road maintenance, buyers will balk.
>
> **Recommendation:** Offer $2K-$3K max. Request the HOA's financial statements -- an HOA with 5+ years of delinquent members likely has special assessments coming.

**Non-credible output:**
> This 1-acre lot in Polk County is available at a discount due to some unpaid HOA fees. Similar lots in the area go for $15,000. This could be a great deal if you can negotiate a good price. HOA communities often have nicer amenities and maintained roads.

**Why it matters:** The non-credible output frames $4,250 in arrears as "some unpaid fees" and positions the HOA as a benefit. It skips deal math impact, lien priority, and the HOA's value proposition. Rural FL subdivision HOAs are notorious for minimal services at significant cost.

---

## 7. Blind Offer Price Calculation

**Scenario:** User asks Atlas to calculate a blind offer price for a 15-acre parcel in Washington County, AR. County assessor shows: assessed value $22,500, land use code "agricultural."

**Credible output:**
> **Assessment ratio for Washington County, AR:**
> - Arkansas assesses property at 20% of appraised (market) value for all property classes.
> - Estimated market value: $22,500 / 0.20 = $112,500.
>
> **Comp check:**
> - I found 4 recent sales of 10-20 acre agricultural parcels in Washington County:
>   - 12 acres, $6,500/acre (Dec 2025)
>   - 18 acres, $5,800/acre (Oct 2025)
>   - 14 acres, $7,200/acre (Aug 2025)
>   - 20 acres, $5,200/acre (Nov 2025)
> - Comp-based estimate: $5,200-$7,200/acre = $78,000-$108,000 for 15 acres.
> - The assessment-derived estimate ($112,500) is in the upper range, which is plausible. Washington County is near Fayetteville/NWA and appreciating.
>
> **Blind offer recommendation:**
> - Conservative (25% of comp-based value): $19,500-$27,000
> - Standard (33% of comp-based value): $25,740-$35,640
> - Aggressive (40% of comp-based value): $31,200-$43,200
>
> I'd send a blind offer at $28,000 (approximately 30% of the midpoint comp-based value). This is your starting point -- the seller will likely counter if interested.

**Non-credible output:**
> The assessed value is $22,500, so I'd recommend offering around $9,000-$11,000, which is about 40-50% of the assessed value. This should be attractive to a motivated seller.

**Why it matters:** The non-credible output treats assessed value as market value. In Arkansas, assessed = 20% of market, so "40% of assessed" is actually ~8% of market value -- too low for any response. Getting assessment ratio math wrong means wasted mailers and zero deal flow.

---

## 8. Seller Finance Terms Recommendation

**Scenario:** User is selling a 5-acre parcel in Mohave County, AZ for $18,000 with seller financing. Acquisition cost was $5,500. User asks Atlas for recommended terms.

**Credible output:**
> **Your position:** $5,500 in, $18,000 sale, $12,500 gross margin.
>
> **Terms:** Down payment $3,600 (20%) -- recovers 65% of acquisition cost day one. Finance $14,400 at 9.9% for 7 years (84 months). Monthly payment: ~$240. Total payments: $20,160. Interest earned: $5,760. Combined return: $23,760 on $5,500 invested.
>
> **Risk:** Land note default rate: 15-25%. On default you recover the land + keep payments received. Use a proper promissory note and deed of trust (attorney-drafted). In Arizona, contract for deed is simpler for forfeiture.
>
> **Note sale exit:** After 12 months seasoning, note sells at 70-80% of ~$12,600 remaining balance ($8,800-$10,000). Total cash: $3,600 down + $2,880 payments + $8,800-$10,000 note sale = $15,280-$16,480.

**Non-credible output:**
> I'd recommend selling this with a small down payment and monthly payments. You could charge around 6-8% interest over 5-10 years. This will give you a nice monthly income stream. Seller financing is a great way to maximize your return on investment.

**Why it matters:** The non-credible output has no specific numbers, suggests below-market interest (6-8% vs. market 8-12%), skips monthly payment calculations, ignores default risk, and omits legal instruments. An investor cannot act on it.

---

## 9. County-Specific Assessment Ratio

**Scenario:** User asks Atlas about the assessment ratio for Navajo County, AZ and whether the assessed value of $8,400 on a 40-acre parcel is reasonable.

**Credible output:**
> **Arizona assessment ratios:**
> - Vacant land in Arizona is assessed at 16% of Full Cash Value (FCV) by the county assessor.
> - Your assessed value: $8,400.
> - Implied Full Cash Value: $8,400 / 0.16 = $52,500 ($1,312/acre).
>
> **Reasonableness check for Navajo County:**
> - Navajo County is a mixed area. Parcels near Show Low / Pinetop-Lakeside command $2,000-$5,000/acre. Remote parcels east of Holbrook go for $200-$500/acre.
> - At $1,312/acre, this parcel is priced in the middle range, suggesting it's either in a moderately accessible area or the assessor has it slightly high.
> - I'd recommend pulling 3-5 comps for 30-50 acre parcels in the same area code/township to validate.
>
> **Important note:** Arizona assessors reassess every 2-5 years. The FCV may be based on data that is several years old. Always verify with recent comps rather than relying solely on the assessor's number.

**Non-credible output:**
> The assessed value of $8,400 seems reasonable for 40 acres. That works out to about $210 per acre, which is in line with rural Arizona land prices. You could probably sell this for around $10,000-$12,000.

**Why it matters:** The non-credible output treats $8,400 as market value. Arizona assesses at 16%, so the actual market value is ~$52,500. This is not subtle -- it is an 80% underestimate. An investor using this AI would underprice every offer in Arizona by 5-6x.

---

## 10. Comp Selection Methodology

**Scenario:** User asks Atlas to explain how it selected comps for a 10-acre parcel in El Paso County, CO. Atlas provided 5 comps. User wants to verify the methodology.

**Credible output:**
> **Filters applied:** (1) Same county only -- no crossing county lines (different assessment/zoning/market). (2) 5-20 acres (50-100% of subject size; per-acre price inversely correlates with size). (3) Sold within 18 months, recent sales weighted more. (4) Vacant/unimproved only. (5) Similar access (paved or maintained gravel).
>
> **Adjustments flagged:** Comp 3 at 7,200ft vs. subject 6,800ft -- better views but harder winter access. Comp 5 has well + electric to property line; subject does not. Comp 5 overstates value by $3K-$5K (cost of well + electric connection locally).
>
> **Limitations disclosed:** No soil/perc test data for comps or subject. Unknown conservation easement or deed restriction status. View quality varies significantly in El Paso County (Pikes Peak premium) -- cannot assess from data alone.

**Non-credible output:**
> I found 5 comparable sales in Colorado for similar-sized properties. These comps represent the current market value for 10-acre parcels in the area. Based on these comps, the property is worth approximately $45,000.

**Why it matters:** "In Colorado" rather than same-county is a fundamental error -- a Douglas County comp is meaningless for rural El Paso County. No selection criteria, no adjustments, no disclosed limitations. The credible output shows its work, which is what earns trust.

---

## 11. Due Diligence Checklist Completeness

**Scenario:** User asks Pax for a due diligence checklist for a parcel they just got under contract in Pinal County, AZ.

**Credible output:**
> **Due Diligence Checklist -- Pinal County, AZ (Raw Land)**
>
> **Title (Week 1):** Order title commitment ($250-$400). Verify owner identity. Check for all lien types (tax, HOA, judgment). Review easements/encumbrances. Confirm no pending probate/divorce.
>
> **Access (Week 1):** Verify legal road access (deeded easement or public road frontage) -- this is the #1 dealbreaker. Drive or get local boots-on-ground photos. Confirm county-maintained vs. private road. Cross-reference Google Earth with plat.
>
> **Zoning (Week 1-2):** Pull designation from Pinal County Planning & Zoning. Verify permitted uses (residential, manufactured home, RV, ag). Check setbacks and minimum lot size. Check for CC&Rs if in a subdivision.
>
> **Environmental (Week 1-2):** FEMA flood zone (msc.fema.gov). National Wetlands Inventory. USGS topo for slope/drainage. Proximity to washes/arroyos -- common in Pinal County, seasonal flooding risk.
>
> **Utilities (Week 2):** Electric via SRP or APS -- get connection cost. Water: well required? AZ Dept of Water Resources for permits; drilling: $8K-$15K in Pinal County. Septic: perc test via Pinal County Environmental Health.
>
> **Financial (Week 2):** Verify taxes with Pinal County Treasurer. Compare assessed value to purchase price. Get title insurance quotes. Calculate all-in acquisition cost.
>
> **Timeline:** Most items complete in 10-14 business days. Order title commitment day one -- it's the longest lead item.

**Non-credible output:**
> Here's a basic due diligence checklist:
> 1. Check the title
> 2. Verify zoning
> 3. Look at the property on Google Maps
> 4. Check for any liens
> 5. Make sure taxes are current
> 6. Get title insurance
>
> Let me know if you need help with any of these steps!

**Why it matters:** The generic list misses county-specific concerns (arroyos, well costs, local utility providers), omits access verification (the #1 issue), and provides no timeline or cost estimates. An investor following the short list would miss items that kill the deal post-closing.

---

## 12. Offer-to-Close Timeline Estimate

**Scenario:** User asks Atlas how long it will take to close on a raw land deal in Jefferson County, MO where the seller has accepted their offer.

**Credible output:**
> **Jefferson County, MO timeline:**
> - Day 0: Offer accepted, execute purchase agreement.
> - Days 1-3: Earnest money ($100-$500). Order title commitment.
> - Days 3-14: Due diligence -- access, zoning, flood, taxes, property visit. Title company needs 7-14 days.
> - Days 14-21: Review title commitment, resolve any issues.
> - Days 21-30: Close at title company. Sign warranty deed. Record with Jefferson County Recorder.
>
> **Total: 21-35 days** clean. Add 2-4 weeks for title issues.
>
> **Missouri-specific:** Title-theory state (deed of trust, not mortgage -- matters for seller-finance exit). Transfer tax: $0.50 per $500 ($15 on a $15K deal). No attorney requirement but recommended above $25K.

**Non-credible output:**
> Closing on land typically takes 30-60 days. You'll need to work with a title company to complete the transaction. Let me know if you need help finding a title company in your area.

**Why it matters:** A vague "30-60 days" with no state-specific details is a Google-level answer. The credible output provides Missouri-specific information (title theory, transfer tax, no attorney requirement) that an investor can plan around.

---

## 13. Market Trend Analysis for a Specific County

**Scenario:** User asks Atlas whether Mohave County, AZ is a good county to start mailing in.

**Credible output:**
> **Mohave County, AZ -- Market Assessment:**
>
> **Pros:** ~120K+ vacant parcels (many 1-5 acre subdivision lots in Golden Valley, Meadview, Dolan Springs). Low price points ($1K-$10K) = lower risk for beginners. Strong out-of-state buyer demand (CA, NV). Assessor data readily available online.
>
> **Cons:** Very competitive -- one of the first counties every new land investor targets. Low margins ($2K-$5K per flip). Many lots have issues: paper streets (no real access), no utility feasibility, HOA arrears. Water concerns limit buildability. Lots flipped multiple times; remaining owners less motivated.
>
> **Data:** DOM for vacant land: 120-180 days. Median 1-acre Golden Valley lot: $3,500-$5,500. Investor saturation: high.
>
> **Recommendation:** Good for building systems; thin margins for profit. For higher margins, consider less-saturated AZ counties (Cochise, Santa Cruz, Graham) or neighboring states (NM: Luna, Dona Ana; NV: Nye, Elko).

**Non-credible output:**
> Mohave County, AZ is a great market for land investing! Arizona land values have been increasing and there's strong demand. I'd recommend starting your mail campaign here. The county has lots of available parcels and motivated sellers.

**Why it matters:** Pure cheerleading with no data, no competitive analysis, no risk factors. Every experienced investor knows Mohave is the "training wheels" county. An AI that cannot identify market saturation provides no value beyond a forum search.

---

## 14. Skip Trace Result Evaluation

**Scenario:** User ran a skip trace on 200 absentee owners in Luna County, NM. Results came back with 160 phone numbers (80% hit rate) and 140 email addresses (70% hit rate). User asks Pax to evaluate the results.

**Credible output:**
> **Hit rates:** Phone 80% is above average (typical: 60-75%). Run the 40 misses through a second provider -- they use different databases (try BatchData if you used BatchSkipTracing, or vice versa). Email 70% is reasonable but email is unreliable for older rural owners; don't use it as primary outreach.
>
> **Quality checks:** Sample-verify 10-15 numbers before a calling campaign. Watch for: multiple owners mapping to the same number (data error), area codes inconsistent with mailing address, "possible relative" vs. direct match.
>
> **Workflow:** (1) Mail blind offers to all 200 first. (2) After 2 weeks, call the 160 with numbers who didn't respond -- these are warm follow-ups. (3) Leave voicemail on first attempt. (4) Max 3 attempts per number over 2 weeks. (5) Do NOT cold-text -- TCPA restrictions apply in many states.
>
> **Cost:** $0.12-$0.15/record = $24-$30 for 200 records. Minimal cost relative to deal value.

**Non-credible output:**
> An 80% hit rate is great! You now have contact information for most of the owners. I'd recommend reaching out to all of them by phone and email to gauge their interest in selling. Good luck with your outreach!

**Why it matters:** No data quality checks, no sample verification, no outreach sequencing, no TCPA compliance. Cold-texting 160 people without understanding TCPA creates legal liability. The credible output provides an actionable workflow with compliance guardrails.

---

## 15. Direct Mail Campaign Targeting Recommendations

**Scenario:** User asks Atlas to recommend targeting criteria for a blind offer campaign in Brewster County, TX (Big Bend area). Budget: $2,000. Goal: 2-3 deals.

**Credible output:**
> **Brewster County, TX -- Campaign Plan:**
>
> **County profile:** Largest TX county by area (~6,200 sq mi), ~9,000 residents. Predominantly ranch/ag. Most parcels 40-640+ acres. Buyer market: recreational/ranch, not residential. Price range: $300-$800/acre.
>
> **Filters:** Parcel size 20-160 acres (below 20 unusual, above 160 = high capital). Absentee owners only (40-60% of county). Owned 5+ years. Tax current or 1-2 years delinquent. Exclude: improved parcels, LLC/trust-owned, mineral-rights-only.
>
> **Budget math ($2,000):** 1,600 letters at $1.25/piece. Response rate 2-4% (less saturated county). Expected responses: 32-64. Accepted offers: 3-6.
>
> **Offer strategy:** Comps vary within county (south near Big Bend NP vs. north near Alpine). Offer at 25-35% of market. Example: 40 acres at $500/acre ($20K market) = offer $5K-$7K.
>
> **Timeline:** Week 1 pull/skip/price. Week 2 mail. Weeks 3-6 field responses. Weeks 4-10 negotiate through close.
>
> **Expected outcome:** 2-3 deals at $5K-$12K profit. Campaign ROI: 5x-18x on $2K.

**Non-credible output:**
> For Brewster County, I'd recommend targeting all vacant land parcels owned by absentee owners. Send out as many mailers as your budget allows and offer around 30% of market value. You should be able to get a few deals from this campaign. Brewster County has lots of available land.

**Why it matters:** No county-specific insight, no budget math, no timeline, no filter rationale. The credible output shows Atlas understands this market (ranch/recreational, Big Bend, low density, high absentee rate) and builds a concrete plan with verifiable economics.

---

## Summary: Credibility Scoring Criteria

When the test agent evaluates an Atlas or Pax response, it should check for these credibility markers:

| Marker | Credible | Non-credible |
|---|---|---|
| **Specificity** | Named county, specific APN, exact dollar amounts, named data sources | "The area," "similar properties," "market conditions" |
| **Math shown** | Calculations visible, formula or steps included | Round numbers with no derivation |
| **Risks flagged** | Access, title, flood, zoning, mineral rights, HOA -- whichever apply | No risk section or a single generic "do your due diligence" |
| **Sources cited** | County assessor, FEMA, county recorder, specific provider names | "Based on market data," "according to our analysis" |
| **Uncertainty expressed** | "I could not verify," "this estimate assumes," "cross-check with comps" | Definitive statements without hedging on uncertain data |
| **Actionable next steps** | Specific tasks with costs, timelines, and responsible parties | "Let me know if you need help" |
| **State/county specifics** | Assessment ratios, legal instruments, transfer taxes, local utility providers | Generic advice that could apply to any state |
| **Vocabulary accuracy** | Terms used correctly per the fundamentals document | Misuse of "cap rate" for land, "appraisal" for AVM, "assessed value" treated as market value |
| **Strategy alignment** | Recommendation matches the investor's stated strategy (flip vs. hold vs. finance) | One-size-fits-all advice |
| **Deal math integration** | Offer price, acquisition cost, carrying cost, exit price, margin -- all connected | Isolated numbers without a deal-level P&L |

A response that hits 8+ of these 10 markers is credible. A response that misses 4+ is non-credible and should be flagged by the test harness as a quality failure.
