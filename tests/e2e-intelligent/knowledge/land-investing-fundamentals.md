# Land Investing Fundamentals

Domain knowledge reference for the AcreOS intelligent E2E test harness. This document equips the test agent with the vocabulary, mental models, and deal math a working land investor uses daily, so it can evaluate Atlas and Pax outputs with the same rigor a paying customer would.

---

## 1. Land vs. Improved Real Estate

Raw (vacant) land is a fundamentally different asset class from houses, apartment buildings, or commercial property. Understanding those differences is essential for evaluating any AI output that touches land valuation, deal structuring, or risk analysis.

### What makes land different

| Dimension | Improved real estate | Raw land |
|---|---|---|
| Income model | Rental cash flow, cap-rate driven | Flip for lump sum, seller-finance for note income, or hold for appreciation |
| Tenants | Yes - management, maintenance, turnover | None |
| Maintenance | Ongoing (roof, HVAC, plumbing) | Near-zero (mowing, fencing at most) |
| Valuation method | Cap rate, GRM, comps with adjustments | Comps only (price per acre for similar parcels in same county, same use) |
| Financing | Conventional mortgages widely available | Banks rarely lend on raw land; seller financing is the primary vehicle |
| Holding cost | Mortgage, insurance, utilities, repairs | Property taxes only (typically $50-$500/year for rural parcels) |
| Liquidity | MLS-driven, broad buyer pool | Narrow buyer pool, longer days-on-market, off-market deals dominate |
| Due diligence | Inspections, appraisals, surveys | Access verification, title search, zoning/use confirmation, environmental |

### The three land monetization strategies

1. **Cash flip** - Buy at 20-40% of market value, resell at 80-100% of market value. Time in deal: 30-120 days. Margin: $5K-$25K per deal.
2. **Seller-financed sale (notes)** - Buy cheap, sell at or above market value with owner financing. Collect monthly payments for 5-10 years. Creates recurring revenue.
3. **Buy and hold** - Acquire in the path of growth (edge of expanding metro, near announced infrastructure). Hold 3-10 years. Appreciation play, not income.

A sophisticated investor (and any credible AI assistant) should understand which strategy applies to a given parcel and recommend accordingly, not treat all land the same.

---

## 2. Investor Types

### Wholesalers
Buy (or option) parcels at deep discounts and immediately assign or double-close to another investor. Never intend to hold. Speed is everything. They need fast comps, quick title checks, and reliable skip tracing. Typical profit per deal: $2K-$8K.

### Flippers
Purchase, sometimes make minor improvements (clear brush, verify access, rezone from agricultural to residential, split into smaller lots), and resell. They need accurate valuation, zoning data, and subdivision feasibility. Typical profit per deal: $5K-$25K. Turnaround: 30-120 days.

### Note investors (seller-finance operators)
The most sophisticated segment. They buy parcels cheap, sell on terms (down payment + monthly installments), and either hold the note for cash flow or sell the seasoned note to a note buyer at a discount. They need amortization schedules, borrower qualification logic, and note portfolio analytics. Monthly cash flow per note: $150-$500.

### Buy-and-hold investors
Acquire parcels in appreciating areas and sit. Low effort but requires macro trend analysis - population growth corridors, highway projects, zoning shifts. They need market trend data and long-term appreciation projections.

### Tax-deed / tax-lien hunters
Acquire parcels through county tax sales. Tax deeds convey ownership directly; tax liens convey the right to collect delinquent taxes plus interest (and foreclose if unpaid). These investors need delinquent tax data, redemption period rules by state, and title risk assessment.

---

## 3. Essential Vocabulary

A credible AI output uses these terms correctly. An investor will immediately notice misuse.

**APN (Assessor Parcel Number)** - The unique identifier assigned by the county assessor to every parcel. Format varies by county (e.g., 123-456-789 or R0012345). This is the primary key for all parcel data lookups.

**Blind offer** - An unsolicited written offer mailed to a landowner, typically at 20-40% of assessed or estimated market value. The "blind" refers to the fact the investor has not spoken with the owner beforehand. This is the dominant lead-generation strategy in land investing.

**Due diligence period** - The contractual window (typically 15-30 days in land deals) during which the buyer can investigate the property and back out without penalty. A credible AI should mention this when discussing deal timelines.

**Title commitment** - A preliminary report from a title company listing all liens, encumbrances, easements, and exceptions on a parcel. Precedes title insurance. Essential before closing any land deal.

**Title insurance** - A one-time policy (typically $500-$2,000 for land) that protects the buyer against defects in title not discovered during the title search. Investors debate whether to get it on every deal or only on higher-value parcels.

**Assessment ratio** - The percentage of market value at which a county assesses property for tax purposes. Varies wildly: some counties assess at 100% of market value, others at 10-15%. Critical for interpreting assessed values and calculating blind offer prices. An AI that treats assessed value as market value is making a serious error.

**Highest and best use** - The legal concept describing the most profitable use a parcel can be put to, given zoning, physical characteristics, and market demand. Determines value. A 5-acre parcel zoned residential near a growing suburb is worth far more than the same acreage zoned agricultural in a remote area.

**Setbacks** - Required distances from property lines within which no structures can be built. Vary by municipality and zoning classification. A 1-acre parcel with 50-foot setbacks on all sides may have almost no buildable area.

**Easements** - Rights granted to others (utilities, neighbors, government) to use part of the land. Common types: utility easements (power lines), access easements (shared driveways), drainage easements. An easement does not transfer ownership but restricts use.

**Encroachments** - Structures or improvements from adjacent properties that physically extend onto the subject parcel. Discovered via survey. Can create title issues.

**MLS vs. off-market** - MLS (Multiple Listing Service) is the broker-controlled database. Most land deals happen off-market through direct mail, county records research, and personal networking. An AI assistant should not treat MLS as the primary data source for land.

**Motivated seller signals** - Indicators that an owner is likely to accept a below-market offer: tax delinquency, out-of-state owner (absentee), inherited property, divorce proceedings, bankruptcy filings, estate/probate.

**Skip tracing** - The process of finding current contact information (phone, email, mailing address) for property owners, especially absentee owners or those with outdated county records. Providers include BatchSkipTracing, BatchData, TLOxp.

**Absentee owner** - A property owner whose mailing address differs from the property address. In land investing, virtually all owners are absentee (they do not live on raw land). The term usually refers to out-of-county or out-of-state owners, who are statistically more motivated to sell.

**LTV (Loan-to-Value)** - For seller-financed notes, the ratio of the remaining note balance to the estimated market value of the underlying land. A note buyer purchasing a seasoned note wants LTV below 60-70%.

**Comps (comparable sales)** - Recent sales of similar parcels used to estimate market value. "Similar" means: same county, similar acreage (within 50% of subject), same general use/zoning, sold within the last 12-24 months. Comps are the foundation of land valuation.

**Days on market (DOM)** - How long a parcel has been listed before selling. For raw land, 90-365 days is normal. DOM under 30 suggests underpricing; DOM over 365 suggests overpricing or a problem with the parcel.

**Perc test (percolation test)** - A soil test determining whether the ground can absorb water for a septic system. Required in most counties before building. A failed perc test dramatically reduces a parcel's value if there is no municipal sewer access.

---

## 4. Typical Deal Math

### Blind offer pricing
- Pull county assessor data for a list of parcels in the target county.
- Determine the assessment ratio (e.g., the county assesses at 25% of market value).
- Calculate estimated market value: assessed value / assessment ratio.
- Offer at 20-40% of estimated market value.
- Example: Assessed value $10,000, assessment ratio 25%, estimated market value $40,000, offer range $8,000-$16,000.

### Response rates on direct mail
- Postcards: 0.5-1% response rate, $0.50-$0.75 per piece.
- Yellow letters (handwritten-look): 1-2% response rate, $1.00-$1.50 per piece.
- Blind offer letters (formal, with specific dollar amount): 2-5% response rate, $1.00-$1.50 per piece.
- Campaign sizes: typically 500-5,000 pieces per county per campaign.
- Expected deals per 1,000 mailers: 1-3 accepted offers.

### Flip margins
- Acquisition cost: $5,000-$30,000 (for parcels in the 1-40 acre range in rural counties).
- Carrying costs: property taxes, closing costs, marketing ($500-$2,000).
- Sale price: 2x-4x acquisition cost.
- Net profit per flip: $5,000-$25,000.
- Time in deal: 30-120 days.
- Annual volume for a full-time flipper: 20-60 deals.

### Seller-finance terms
- Down payment: 10-30% of sale price.
- Interest rate: 8-12% (higher than conventional because this is seller-financed, no credit check, high-risk borrowers).
- Term length: 5-10 years, sometimes with a balloon payment at 3-5 years.
- Monthly payment example: $25,000 sale, $5,000 down, $20,000 financed at 10% over 7 years = approximately $332/month.
- Late payment policy: grace period of 10-15 days, then late fee of 5-10% of payment.
- Default and foreclosure: after 60-90 days of non-payment, the seller can begin forfeiture/foreclosure proceedings (varies by state).

---

## 5. Red Flags and Risk Factors

These are the concerns a knowledgeable investor checks before making an offer. Any credible AI analysis must address them.

**Tax delinquency** - A parcel with 3+ years of delinquent taxes signals high seller motivation but also title risk. The county may sell the tax lien or conduct a tax sale. Back taxes become the buyer's responsibility at closing.

**Landlocked parcels** - A parcel with no legal road access is worth a fraction of an otherwise identical accessible parcel. "Legal access" means a deeded easement or road frontage, not just "you can drive across the neighbor's field." This is the single most common dealbreaker in raw land.

**Flood zones** - FEMA flood zone designations (Zone A, AE, V, VE) dramatically affect buildability and insurance costs. A residential-zoned parcel in Zone AE requires flood insurance ($1,000-$3,000/year) and may require elevated construction. Flood zone status should be checked for every parcel.

**Wetlands** - Army Corps of Engineers jurisdictional wetlands cannot be built on or filled without permits (which are rarely granted). Wetland delineation can reduce usable acreage significantly. National Wetlands Inventory (NWI) maps provide a starting point but are not definitive.

**HOA liens** - Some rural subdivisions have HOAs with annual dues. Unpaid HOA fees create liens that survive sale. An HOA with $5,000 in back dues on a $15,000 parcel eats the entire margin.

**Mineral rights separation** - In many states (TX, OK, WY, CO, NM, ND), mineral rights can be severed from surface rights. A parcel where minerals have been conveyed to a third party may be subject to surface use by the mineral rights holder (drilling, access roads). This materially affects value and must be checked.

**Clouded title** - Any unresolved lien, judgment, heir claim, or recording error that prevents clean title transfer. Common in inherited properties where not all heirs signed the deed, or where old mortgages were paid off but never released of record.

**No legal access** - Distinct from landlocked; even parcels adjacent to roads may lack legal access if the road is private or the parcel's frontage is on an unimproved/paper road that the county does not maintain.

**Zoning restrictions** - A parcel zoned agricultural may not permit residential construction without a rezone or variance. Mobile homes, tiny homes, and RVs each have separate zoning considerations. An AI that says "you can build on this" without checking zoning is providing dangerous advice.

---

## 6. Common Data Sources

### Free sources
- **County assessor website** - Parcel data, assessed values, owner name, mailing address, tax status. The primary free data source. Coverage and data quality vary enormously by county.
- **County recorder** - Deeds, liens, mortgages, easements. Most counties now have online portals.
- **FEMA flood maps** (msc.fema.gov) - Flood zone determination. Free. Every parcel should be checked.
- **USGS topographic maps** - Terrain, elevation, slope. Useful for assessing buildability and access.
- **Google Earth / Google Maps** - Aerial imagery, terrain view, road access visual verification. Not a substitute for a survey but invaluable for initial screening.
- **National Wetlands Inventory** (fws.gov/wetlands) - Preliminary wetland mapping. Not definitive but flags potential issues.

### Paid sources
- **Regrid (formerly Loveland)** - Nationwide parcel boundaries and owner data. Good API. Coverage: ~95% of US parcels.
- **ATTOM Data** - Property data, sales history, AVM estimates, foreclosure data. Enterprise-grade.
- **DataTree (First American)** - Title plant data, property profiles, comparable sales. Used by title companies.
- **BatchData** - Property data API with skip tracing. Popular in the land investing community.
- **BatchSkipTracing** - Dedicated skip tracing (phone numbers, emails for property owners). $0.10-$0.15 per record.
- **PropStream** - All-in-one property data, comps, skip tracing, lead lists. Popular with land investors. $99/month.

---

## 7. Direct Mail Campaigns

Direct mail is the primary lead-generation channel in land investing. An AI assistant should understand campaign mechanics.

### Mail piece types
- **Postcards** - Cheapest ($0.50-$0.75/piece). Low response rate (0.5-1%). Good for initial broad outreach.
- **Yellow letters** - Designed to look handwritten. Higher response rate (1-2%). More expensive ($1.00-$1.50/piece).
- **Blind offer letters** - A formal letter with a specific dollar offer for the recipient's specific parcel. Highest response rate (2-5%). Most effective but requires per-parcel pricing. This is the dominant strategy.
- **Neutral letters** - Express general interest without a specific price. Response rate 1-3%. Used when the investor does not want to anchor a price.

### Campaign workflow
1. Select target county based on deal flow, price points, and competition level.
2. Pull owner list from county assessor or data provider, filtered by criteria (acreage range, absentee owners, tax delinquency, assessed value range).
3. Skip trace for current mailing addresses (10-20% of county records have outdated addresses).
4. Calculate offer prices based on comps and assessment ratios.
5. Print and mail. Use a mail house for scale ($0.50-$1.00/piece for print + postage on letters).
6. Field incoming calls and responses. Typical response window: 1-4 weeks after mail drop.
7. Follow up with interested sellers. Negotiate, get under contract.
8. Conduct due diligence, close, and resell.

### Economics
- 1,000 blind offer letters at $1.25/piece = $1,250.
- At 3% response rate = 30 responses.
- Of 30 responses, expect 3-5 accepted offers.
- If 3 deals close at average $10K profit = $30K gross profit.
- ROI: $30K / $1,250 = 24x (before closing costs and other overhead).

This is why direct mail economics matter and why any AI tool that helps optimize targeting, pricing, or response handling has significant business value.

---

## 8. Seller-Financed Note Mechanics

Seller financing is the most profitable exit strategy in land investing and the most complex. The AI assistant must handle note math correctly.

### Amortization
Notes are typically fully amortizing (no balloon) or partially amortizing with a balloon. The monthly payment on a fully amortizing note is calculated using the standard annuity formula:

`Payment = Principal * [r(1+r)^n] / [(1+r)^n - 1]`

Where r = monthly interest rate (annual rate / 12) and n = total number of payments.

Example: $20,000 principal, 10% annual interest, 7-year term (84 months):
- r = 0.10 / 12 = 0.00833
- Payment = $20,000 * [0.00833 * 1.00833^84] / [1.00833^84 - 1] = approximately $332/month.
- Total paid over life of note: $332 * 84 = $27,888.
- Total interest earned: $7,888.

### Balloon payments
Some notes are structured with a lower payment based on a longer amortization (e.g., 15 years) but a balloon (full balance due) at year 5. This gives the buyer a lower monthly payment but requires refinancing or payoff at the balloon date.

### Late payment handling
- Grace period: 10-15 days after the due date.
- Late fee: typically 5% of the monthly payment or a flat $25-$50.
- Notice of default: sent after 30-60 days of non-payment.
- Forfeiture/foreclosure: initiated after 60-90 days, governed by state law. Some states (TX, AZ) allow contract forfeiture (faster). Others require judicial foreclosure (slower, more expensive).

### Note seasoning
A newly originated note is worth less to a note buyer than a note with 6-12 months of on-time payment history. "Seasoning" refers to this track record. Investors who plan to sell their notes should expect:
- Unseasoned note: sells at 50-60% of remaining balance.
- 6-month seasoned note: sells at 60-70%.
- 12+ month seasoned note: sells at 70-80%.

### Note servicing
Managing collections, sending statements, tracking payments, and handling defaults. Can be done in-house or outsourced to a loan servicing company ($20-$35/month per note). Most investors self-service until they have 20+ active notes.

### Portfolio metrics
- **Yield** - The effective annual return on the note investment. Calculated from acquisition cost vs. total payments received.
- **Default rate** - Percentage of notes that go into default. Industry average for land notes: 15-25% (higher than conventional mortgages because borrowers are typically subprime).
- **Recovery on default** - The investor gets the land back and can resell it. Unlike conventional lending, the underlying asset (land) does not depreciate, so recovery rates are high relative to the note balance.
- **Cash-on-cash return** - Monthly note income / total cash invested. A well-structured note portfolio can generate 15-30% annual cash-on-cash returns.

---

## 9. How This Knowledge Applies to AcreOS Testing

When the test agent evaluates Atlas (the AI deal partner / CTO) or Pax (the executive assistant / support agent), it should verify:

1. **Terminology accuracy** - Are land-specific terms used correctly? Does the AI say "cap rate" for land (wrong) or "price per acre" (right)?
2. **Math correctness** - Are offer prices, amortization schedules, and ROI calculations accurate?
3. **Risk identification** - Does the AI flag access issues, flood zones, title concerns, and assessment ratio nuances?
4. **Source awareness** - Does the AI reference appropriate data sources (county assessor, FEMA, Regrid) rather than generic "market data"?
5. **Strategy alignment** - Does the AI match recommendations to the investor's stated strategy (flip vs. hold vs. finance)?
6. **Appropriate uncertainty** - Does the AI hedge when data is incomplete, rather than inventing confidence?
7. **Deal flow context** - Does the AI understand the pipeline (mailer -> response -> negotiate -> contract -> due diligence -> close -> exit)?
8. **Competitive awareness** - Does the AI understand that AcreOS competes in the land-specific software niche without referencing competitors by name?

A response that gets these right earns investor trust. A response that gets them wrong breaks trust immediately and permanently.
