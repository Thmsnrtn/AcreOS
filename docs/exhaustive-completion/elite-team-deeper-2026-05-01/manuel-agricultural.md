# Manuel Ortega — AcreOS user review (Ag-land specialist voice)

I buy and sell agricultural ground in the California Central Valley. Fifty-one years old, based in Fresno, been doing this twenty-three years. My book is row-crop ground (tomatoes, garlic, cotton) and permanent crops (almonds, pistachios, table grapes) from Madera County down through Kern. Last year I closed eleven deals — two of them over a thousand acres. My stack is USDA NASS for cropland values, Land.com for listings, AgriData/Surety for soils, my crop consultant Ramon for tree-stand assessments, and a notebook of irrigation-district contacts I've built over two decades. Plus a CPA who actually understands Schedule F.

A broker buddy in Visalia forwarded me an AcreOS demo link. I spent a long Saturday in it. Here's the honest read from somebody who lives the ag-land asset class.

---

## 1. Thirty-second verdict

**Not for me as it stands. Not for any serious ag-land buyer.** AcreOS is a competent platform for raw land, recreational land, and rural residential — it's clearly built for the Land Geek-style flip-and-resell crowd plus some buy-and-hold infill. Ag land is a fundamentally different asset class and AcreOS treats it as a sub-bucket of "vacant land." That's the same mistake Land.com makes and the reason serious ag specialists in California still use a combination of LandsofAmerica, AcreValue, and a Rolodex.

I checked the schema. The `propertyType` enum has `"agricultural"` as one of five values alongside residential and commercial. That's it. No subcategorization between row-crop and permanent crop, no irrigation-district field, no water-allocation acre-feet, no Williamson Act flag, no Land Capability Class, no Farm Credit System loan suitability. The USDA NASS integration is actually present — that surprised me, and I'll get to it — but the comment in the code literally says **"pastureland per-acre ≈ raw land comp for non-agricultural buyers."** The team built the NASS integration *to dismiss ag values as a noise input for raw-land flippers*. That tells me everything about the audience the product was designed for.

Would I sign up? No, not at any price. There's nothing here that beats AcreValue's $300/year subscription for what I do. But I'll spend the next 200 lines telling you what would change my mind, because the bones aren't bad — they're just pointed at the wrong asset class.

---

## 2. Daily-use walkthrough — what an ag-land specialist actually does

**6:00 AM.** Coffee, then I check three things: (1) the USDA WASDE report if it dropped overnight (it moves almond and pistachio futures, which moves orchard values 60-180 days out), (2) the Friant-Kern Canal allocation announcement if we're inside an allocation window, and (3) Westlands Water District's daily water-trading bulletin board. None of these are concepts AcreOS has heard of. The `/today` page shows me Pulse score, expiring offers, stale leads. Useless. My morning is **policy + water + commodity**, in that order. Land prices follow.

**7:30 AM.** I'm meeting with a seller — third-generation almond grower in Tulare County who's tired and wants out. 640 acres, 480 in mature Nonpareil/Monterey almonds planted 2008-2011 (so 14-17 years old, late-mature productive years), 160 in row-crop on a fallow rotation. He wants to know what it's worth. I open `/parcels/:id` and put in the APN. AcreOS pulls a county-assessor record, valuation, soils via SSURGO. Good. **The valuation it returns is wrong by an order of magnitude in either direction depending on water, and AcreOS doesn't know that.**

A 640-acre orchard in Tulare is worth between $4.5M (no surface water, on overdrafted Pixley subbasin, SGMA Tier 4 restrictions) and $19M (full Friant Class 1 contract, Class I soil, 14-year trees in their peak productive window). **That's a 4x range on a single parcel based on water and tree-stand alone.** AcreOS's valuation engine is reading parcel size, recent comps, and a generic AVM. None of those three signals capture the asset.

What AcreOS would need on `/parcels/:id` for me to use it on an orchard:

- **Tree-stand record.** Variety, planting year, rootstock, spacing, irrigation system (microsprinkler vs drip vs flood), last yield record. A 14-year Nonpareil/Monterey on Nemaguard rootstock at 16x22 spacing with microjet irrigation is a specific asset with a specific NPV. AcreOS has no concept of any of those fields.
- **Water portfolio.** Surface water contracts (Friant Class 1, Class 2, CVP, SWP exchange), groundwater (well count, well depth, GPM, last test date, SGMA subbasin tier), water-rights priority dates if pre-1914. This is not a single number — it's a portfolio that gets valued like a bond ladder. AcreOS has no water entity at all.
- **Soil class via SSURGO.** AcreOS *does* have SSURGO. The `dueDiligenceEngine.ts` pulls farmland classification ("Prime / Statewide / Local / Not prime") and an NCCPI score. **That's the one ag thing the platform actually does.** It's wired up and it works. But the result lives in the DD checklist, not in the valuation, and a Class I almond ground vs Class III row-crop ground is a 60% delta in value per acre — nowhere does that flow into the AVM.
- **Williamson Act status.** California-specific. Land under a Williamson Act contract is locked into ag use for 10 years (or 20 for Farmland Security Zones), assessed at ag-use value not market value (typically 30-50% lower property tax), and any non-renewal triggers a 9-year unwind. Buyers underwriting CA ag land *must* know this. It's a yes/no field with a contract end date. AcreOS has neither.
- **Farm Credit eligibility.** Most ag deals over $1M finance through Farm Credit West or American AgCredit, not banks. Their underwriting wants a Schedule F history, irrigation infrastructure assessment, and tree-stand depreciation schedule. Different package than residential financing.

**9:30 AM.** I run the seller's water rights through my head. He has a 1922-vintage riparian claim on a tributary of the Tule River plus a Pixley Irrigation District allocation that's been at zero in three of the last six years thanks to drought. His two ag wells are at 380' and 420' with declining static water levels — he pumps from 220' now versus 140' a decade ago. **Under SGMA (Sustainable Groundwater Management Act), Pixley is in critical overdraft and the GSP requires 30% pumping reduction by 2040.** This is the central California ag-land question. AcreOS has nothing — no SGMA layer, no subbasin tier, no GSP flag, no critical-overdraft indicator. For Central Valley ag, that is the deal.

**10:30 AM.** I look at `/money`. Notes, Portfolio, Optimizer, Forecast, Capital. **Wrong product entirely.** Ag deals are not seller-financed paper. They're either cash, 1031 exchanges (huge in ag — about 40% of deals over $5M), Farm Credit System loans, or USDA FSA-guaranteed loans. The 1031 case alone — a Bay Area landowner cashing out a downtown office building and parking the proceeds in 600 acres of pistachios in Kern County — is a specific motion AcreOS doesn't model. I'd want a 1031 timeline tracker (45-day identification, 180-day close), a qualified-intermediary contact list, and a boot-calculator. None exist.

**11:30 AM.** I check crop-insurance posture. The seller has Federal Crop Insurance through Rain and Hail — Whole-Farm Revenue Protection plus Almond/Walnut Crop Insurance via the RMA. The buyer assumes nothing automatically; insurance is per-grower, not per-parcel. But I need to know last three years of indemnity payments because **a parcel with three consecutive frost claims tells me the microclimate is wrong for the crop**, regardless of what the AVM says. Crop insurance loss history is a public-ish data set (RMA Summary of Business). AcreOS doesn't pull it. Should.

**12:30 PM.** Lunch. I check the Farm Bill cycle. We're in the implementation phase of the 2024 Farm Bill (the 2018 was extended twice), and the new Title I price-loss coverage triggers for almonds shifted in ways that change the cash-flow underwriting on a 100-acre new planting by about $180/acre/year. **Federal policy is a 5-year cycle and ag-land prices respond to it on a 12-18 month lag.** AcreOS has no Farm Bill awareness. There's no policy calendar, no commodity-program eligibility check, no PLC/ARC-CO toggle. Pax doesn't know what a "Farm Bill" is — I asked. It returned a generic answer about agricultural legislation that read like Wikipedia.

**2:00 PM.** I'm at `/parcels/:id` again, this time on an EQIP-eligible vineyard restoration project I'm syndicating. EQIP (Environmental Quality Incentives Program) is USDA NRCS cost-share — they'll pay 50-90% of qualifying conservation practices like drip-irrigation conversion, cover-cropping, hedgerow planting. CSP (Conservation Stewardship Program) is the longer-term version. CRP (Conservation Reserve Program) is for marginal cropland — pay the farmer to *not* farm it, 10-15 year contracts. **These programs change the buy-vs-pass math on a property by 10-25%.** A 240-acre walnut block where the prior owner was 3 years into a CSP contract is more valuable to me than the same orchard without one — the contract transfers if the new owner certifies. AcreOS has none of this.

**3:30 PM.** I check the irrigation district side. In the Central Valley, the *district* is often more important than the parcel. Westlands, Friant, Kern County Water Agency, Tulare ID, Madera ID — each has different allocation history, different conveyance reliability, different water-trading rules, different rate structures. A parcel inside Friant Class 1 with 0.75 AF/acre supplemental allocation is a different deal than a parcel one mile away outside the district boundary on well water alone. AcreOS would need an irrigation-district overlay and a water-allocation history feed. CA DWR publishes most of this. The data exists; AcreOS doesn't pull it.

**4:30 PM.** I look at what AcreOS calls a "deal pipeline." It's structured around offer status — sent / countered / accepted / closing. **Ag deals don't move in that shape.** A typical ag deal is: LOI → 60-day exclusivity → buyer-side environmental Phase 1 → buyer-side ag-engineer water assessment → buyer-side tree-stand assessment by a third-party crop consultant → 1031 funding coordination → 90-120 day close. The "stages" are different and the *time-on-stage* is 3-5x longer than a flip pipeline. The pipeline UI is fine if I relabel, but the velocity metrics are misleading because they assume rural-land pacing.

**5:30 PM.** I look for **commodity-pricing context** — am I buying into a $3.50/lb Nonpareil or a $1.85/lb Nonpareil market? Almond prices crashed from $4.20 in 2014 to $1.30 in 2023 to $2.20 today. That single chart determines whether 480 acres of almonds is worth $35K/acre or $12K/acre. Land.com has nothing. AcreValue has it as a paid add-on. **AcreOS could pull NASS commodity prices into the parcel view trivially — the NASS API key already exists for the land-value pull.** It doesn't.

**6:30 PM.** End of day. I've used AcreOS for maybe 20 minutes total. The other 7 hours of work happened in tools that understand my asset class.

---

## 3. Per-surface friction

**`/today`** — Acquisition-shaped. None of my morning signals (WASDE, allocation announcements, water-trading boards, Farm Bill calendar, almond/pistachio futures) live here. I'd want an ag-land mode with a **policy ticker** (USDA, RMA, NRCS, state water boards), a **commodity strip** (almonds, pistachios, walnuts, table grapes, cotton, dairy), and a **water-allocation status** card. None exist.

**`/parcels/:id`** — The single page where AcreOS could win me. SSURGO soil pull is genuinely good. Farmland classification + NCCPI score is the kind of data point Land.com doesn't have. **But the page is missing the entire ag stack on top of it:** tree-stand record, water portfolio, irrigation district, SGMA subbasin, Williamson Act, EQIP/CSP/CRP enrollment, crop-insurance loss history, commodity pricing context. Add those eight fields and this is a real ag tool. Without them it's a glorified parcel-viewer.

**`/valuation` / AVM** — Wrong by 2-4x on any orchard or vineyard because it doesn't ingest tree stand or water. The note in `usdaNassService.ts` saying pastureland is "the most relevant category for raw-land investors" is the smoking gun — the team optimized the NASS pull *away* from cropland values, which are the ones I care about. The data is being pulled and then thrown away.

**`/pipeline`** — Fine shape, wrong velocity assumptions. Ag deals run 90-180 days from LOI to close vs 30-60 for raw-land flips. The dashboards average everything together and call my pipeline "stalled" when it's actually pacing normally. I'd want an "ag deal" mode with calibrated stage-time expectations.

**`/money`** — Wrong product. No 1031 tracker, no Farm Credit lender list, no FSA-guaranteed loan workflow, no boot calculator, no Schedule F integration. The "Notes" tab assumes seller financing, which is rare in ag.

**`/inbox`** — Useful generically. Doesn't auto-link a message from `ramon@cropconsultants.net` to the parcel he assessed for me last week. Doesn't know what a crop consultant is. Should — they're as central to my workflow as a real-estate agent is to a residential investor.

**`/field-scout`** — This is the surprise. **Offline-sync field capture is a real ag tool.** Walking a 640-acre orchard, I want to mark dead trees by GPS, photo damaged microsprinkler heads, log soil-pit observations, capture hardpan depth, note salinity stains. The infra exists. What's missing is an **ag-specific field-template library**: tree-count grid, missing-tree map, irrigation-system survey, salinity walk, weed-pressure map. Add five templates and you've shipped a real product for ag scouting that beats the iPad spreadsheets most ag brokers use.

**`/documents` / `/sign-document`** — Could probably handle a CA Ag Land Purchase Agreement (CAR form AG-1). Doesn't currently model the **water-rights addendum** or the **growing-crop addendum** that go with it. The HMAC public-signing flow is the right architecture; the document templates are wrong.

**`/portfolio`** — Built for note delinquency. For ag, I want acreage-by-crop, water-portfolio summary, projected yield, projected commodity revenue, debt-service coverage ratio against Farm Credit covenants. None present.

**`/pax`** — Doesn't know about ag. I asked: "What's the impact of SGMA on Central Valley orchard values?" It returned a generic 4-paragraph summary that any land grant university extension page would beat. Asked: "Should I assume a Williamson Act contract on a Tulare County parcel?" — generic. **Pax for ag is undertrained.** That's not a feature gap, that's a knowledge gap. Specialty ag-land knowledge isn't going to come from generalized real-estate training data.

**`/onboarding-v2`** — Three paths (beginner / active / enterprise). None of them are "I buy ag land in a specific region." The persona registry has no ag specialist entry. Should.

**`/pricing`** — Even the $79 Scale tier doesn't unlock anything ag-specific. There's nothing here to upsell me to.

---

**A note on the daily reality.** The Central Valley ag-land market is roughly $40-60B in annual transaction volume across CA, AZ, OR, WA, ID. It is a serious asset class — pension funds, REITs (Farmland Partners, Gladstone Land), sovereign wealth funds (the Saudi alfalfa investment in Arizona is the famous example) — but it is also fundamentally a *relationship + region + water* business, and the tools serving it are weaker than the tools serving residential. There's actually a wedge for AcreOS here that the team hasn't seen: the existing ag-land tools (AcreValue, AgriData/Surety, Land.com) are all read-only data products. **Nobody has built the workflow layer.** AcreOS already has the workflow layer. It just needs the ag-specific data model and content packs to plug into it.

---

## 4. The AcreValue test — fail, but salvageable

AcreValue is what I actually use, with a $300/year subscription. Let me grade AcreOS:

- **Cropland values per county (USDA NASS)** — *Partial.* AcreOS pulls NASS but biases toward pastureland. The cropland values are right there in the API; they're not surfaced.
- **Soil productivity index (NCCPI / CSR2 / PI)** — *Done.* SSURGO pull exists. **This is the one place AcreOS genuinely matches AcreValue.**
- **Soil type and farmland classification** — *Done.* Same SSURGO pull.
- **Crop history layer (CDL — Cropland Data Layer)** — *Missing.* USDA NASS publishes 30m-resolution annual CDL going back to 2008. Tells me what crop was planted on every acre every year. Critical for ag underwriting; not pulled.
- **Yield history (county-level NASS)** — *Missing.* NASS publishes county-level yield for almonds, pistachios, walnuts, cotton, etc. Trivial pull from the same key.
- **Aerial historical imagery (NAIP)** — *Missing.* NAIP is free; updated every 2 years; tells me when an orchard was planted and how it's been managed.
- **Water rights and irrigation district overlays** — *Missing.* The data exists in CA DWR and state water boards.
- **Property line + ownership** — *Done* via the parcel service.
- **Comparable sales (ag-specific)** — *Partial.* General comps yes; ag-specific filtering (orchard vs row-crop, with water vs without) no.
- **Conservation program enrollment overlays** — *Missing.* USDA FSA publishes summary data.

**Net: AcreOS is roughly 30% of AcreValue's data depth, with zero of the ag-workflow on top.** But — and here's the salvageable part — AcreOS's workflow layer (pipeline, parcel detail, valuation, field scouting, signing, inbox) is *already better than AcreValue's*, which is essentially a map viewer. **If AcreOS shipped the ag data layer, it would leapfrog AcreValue, because AcreValue has data and no workflow, and AcreOS has workflow and no data.** That's a real wedge.

---

## 5. Five features that would make this an ag-land product

1. **Water-rights entity, first-class.** Surface water (district, contract class, allocation history), groundwater (well count, depth, GPM, SGMA subbasin tier, GSP restrictions), riparian/pre-1914 claims with priority dates. Linked to the parcel. This is the #1 underwriting variable in CA ag and it's currently a free-text note field at best.
2. **Tree-stand / permanent-crop entity.** For orchards and vineyards: variety, rootstock, planting year, spacing, irrigation system, last-three-years yield, last-three-years insurance loss. NPV depreciation schedule per crop type. Without this, AcreOS can't value an almond block within 2x.
3. **CDL (Cropland Data Layer) overlay on `/parcels/:id`.** USDA publishes this free. Ten-year crop-rotation history per parcel changes the underwriting story (continuous cotton tells me a different soil-management regime than tomato/garlic rotation). One API integration, big differentiation.
4. **Williamson Act + SGMA + EQIP/CSP/CRP enrollment flags.** CA-specific where relevant, federal where relevant. Status, contract end date, transfer eligibility. These are yes/no fields with dates and they shift price by 5-25% each. Six fields total. Trivial schema, big impact.
5. **NASS commodity-pricing strip on `/today` and parcel valuation.** The NASS API key is already used. Surface monthly commodity prices for the major Central Valley crops (almonds, pistachios, walnuts, table grapes, cotton, dairy, tomatoes) and let parcel valuation respond to a 12-month moving average. **An almond orchard is a commodity-price bet at the rootstock level.** Surface that.

---

## 6. Three things that are surprisingly useful, even for an ag specialist

1. **SSURGO soil pull on `/parcels/:id`.** Better than Land.com. Not as good as AgriData but free. The dominant soil + farmland classification + NCCPI score is exactly the right starting layer. Build on this.
2. **`/field-scout` offline sync.** Walking 640 acres in mid-July, 105°F, no LTE — I need offline. The infra is right. Templates are missing but the foundation is right.
3. **Pipeline + DD checklist + signing flow as a workflow layer.** Even though none of it is ag-tuned, the workflow shape is real and ag tooling currently has no equivalent. AcreValue is read-only data. AgriData is read-only data. Land.com is a marketplace. Nobody has the workflow. AcreOS does. That's the asset.

---

## 7. The honest verdict

AcreOS has accidentally built the right shell for an ag-land product, then shipped the wrong filling. The valuation engine, the parcel detail, the workflow stages, the field-scouting infra, even the NASS integration — all of these are correctly architected and pointed at the wrong asset class. The team built for raw-land flippers and let "agricultural" be a checkbox in an enum.

For me — a working California ag-land specialist — AcreOS is not buyable today at any price. But it's the only tool I've evaluated in five years where I can see a clear path from where it is to where I'd pay $5,000/year for it. **AcreValue charges $300/year for a map. AgriData charges $2,400 for a desktop product. A real ag-workflow product is worth $3,000-6,000/year per seat to working specialists, and the market in CA + AZ + WA + ID + OR alone is 8,000-12,000 such seats.** That's $30-60M of ARR sitting in a vertical the team doesn't currently address.

If AcreOS wants this market, the work is roughly:
- Water-rights entity + irrigation-district overlay (1 quarter, with state-data ingestion)
- Tree-stand/permanent-crop entity + variety library (1 quarter)
- CDL + NAIP + NASS commodity layer (1 sprint, mostly API plumbing)
- Williamson Act / SGMA / EQIP-CSP-CRP flags + enrollment lookups (1 sprint)
- 1031 / Farm Credit / FSA loan workflow (1 quarter)
- Pax retraining on ag knowledge (ongoing, partner with a UC-Davis or Cal Poly extension service)

That's a 6-9 month focused effort. Smaller than the landlord build I imagine other reviewers are scoping. The data is mostly free and federal. The hard part is design judgment — knowing that "irrigation district" is not a string field, it's a foreign key to an entity with its own allocation history and rate schedule.

---

## 8. What I'd build first if I were on this team

If somebody handed me one engineer for a quarter and said "make AcreOS useful for ag specialists":

1. **Surface NASS cropland values on `/parcels/:id`.** The data is already pulled. Stop biasing toward pastureland. Show all four NASS categories (farm real estate, cropland, irrigated cropland, pastureland) and let the user pick. 1 week.

2. **CDL crop-history overlay on `/parcels/:id`.** USDA publishes 30m raster going back to 2008. Pull it, sample by parcel polygon, show a 10-year crop rotation. 2-3 weeks for a working version.

3. **Williamson Act flag + Land Capability Class display.** SSURGO already pulls farmland classification — surface it prominently, not buried in a DD checklist. Add Williamson Act as a county-assessor lookup (CA counties publish this; some do, some don't, but Fresno/Tulare/Kern/Madera all do). 2-3 weeks.

4. **Water-rights free-text capture, then structured.** Start with a free-text "water portfolio" field on the parcel. Then in v2, structure into surface-water-contract + groundwater-wells + riparian-claims subentities. Even the free-text version is more than what exists today. 1 week for v1, 4-6 weeks for v2.

5. **Five field-scout ag templates.** Tree-count survey, missing-tree map, irrigation-system inspection, salinity walk, weed-pressure map. The infra exists; this is template work. 2-3 weeks.

After those five, I'd evaluate AcreOS as "the tool I use for parcel research and field documentation, alongside AcreValue for comps." That's the entry point. The deeper integrations (1031, Farm Credit, RMA loss history, Pax retraining) are quarters 2-4 of an ag-product roadmap.

---

## 9. Things I checked and didn't find

For the team, a fast inventory:

- Water-rights entity (surface, ground, riparian)
- Irrigation-district overlay or lookup
- SGMA subbasin tier / GSP restriction flag
- Williamson Act contract status + end date
- Tree-stand / permanent-crop entity (variety, year, rootstock, spacing)
- Variety library (almond, pistachio, walnut, grape, citrus)
- Yield history (county or parcel)
- CDL (Cropland Data Layer) overlay
- NAIP historical aerial
- NASS commodity-price strip
- Crop-insurance loss history (RMA SOB)
- EQIP / CSP / CRP enrollment flag and contract end date
- Farm Bill policy calendar
- 1031-exchange tracker (45/180-day clock, QI list, boot calculator)
- Farm Credit System lender directory
- USDA FSA-guaranteed loan workflow
- Schedule F P&L view per parcel
- WASDE / market-news ticker
- Water-trading bulletin board feed
- Soil salinity / EC layer
- Hardpan depth / subsoil restriction layer (SSURGO has this — not surfaced)
- Frost-risk microclimate layer (Cal Adapt publishes free)
- Crop consultant / PCA contact entity (parallel to "agent" in residential)
- CA Ag Land Purchase Agreement template (AG-1) + addendums
- Growing-crop allocation addendum
- Williamson Act non-renewal calculator
- 1031 boot calculator with depreciation recapture

Each of these is small. Together they're the difference between "agricultural is an enum value" and "AcreOS is the workflow tool for ag-land specialists."

---

## 10. One last thing — the strategic read

I've been blunt because the deeper-audit format invited it. Let me close on what I think the team should hear.

**The ag-land asset class is a $40-60B/year transaction market with no modern workflow tool.** AcreValue and AgriData are read-only data. Land.com is a marketplace. AgFleet, Granular, Climate FieldView are *farming* tools, not *land-investment* tools. The category is genuinely unaddressed for the buy-side specialist who isn't farming the land themselves.

AcreOS shipped most of the workflow surface for residential land in a way that translates to ag better than the team realized. The pipeline, parcel detail, signing flow, field-scout, inbox, valuation engine — all of these have direct ag analogues. The missing pieces are *data layer* and *vocabulary*, not workflow.

A six-to-nine-month focused build, with one PM who knows ag land and one engineer doing the integrations, ships an ag-land product that has no real competitor in workflow terms. The unit economics ($3-6K ARR per specialist seat, 8-12K specialist seats in CA + AZ + Pacific Northwest alone) are stronger than the residential-investor segment AcreOS currently targets.

I'd watch this for a year. If the ag layer ships, I'd be a $5K/year customer, and I'd bring three of my Visalia broker friends with me. If it doesn't, I'm not the customer and that's fine — but the team is leaving a real wedge on the table.

— Manuel
