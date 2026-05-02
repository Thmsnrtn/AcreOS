# Hank Bowman — AcreOS user review (Arizona Land Investor)

I'm 58. Cottonwood, Arizona. I work Mohave, Yavapai, and Coconino — sometimes Navajo if a deal walks in the door — and I trade $5K-to-$60K parcels, mostly five to forty acres, mostly off-grid. Stack: PropStream for the comps, LandID for the maps, and a water attorney named Russ on retainer because Arizona is the state where a parcel can be "buildable" on the title and unbuildable in real life. My business runs on a question every other state's investors get to ignore: **does this dirt have water, and can the buyer keep using it after they close.** Half my deals die on that question. The other half need to answer it before I'll close.

I went through AcreOS for a half day with the persona switcher set to whatever they'd give me — Active Land Investor — and tried to run my workflow through it.

---

## 1. Thirty-second verdict

Would I sign up today? **Maybe Starter at $20 for the map and the comps. Not Pro. The product knows Arizona exists and stops there.**

What's good: AZ is in `environmentalIntelligence.ts` with prior-appropriation flagged, AMA permits flagged, and the "assured water supply required for new subdivisions in AMAs" note. AZ is in `stateDocumentConfig.ts` with the right deed type (warranty deed with vendor lien), the right lien instrument (deed of trust), the right contract name (agreement for deed), zero transfer tax, no attorney required, e-recording same-day. AZ is in `usuryCeiling.ts` correctly — A.R.S. § 44-1201, no general usury ceiling for RE loans, seller-finance broadly exempt. AZ is in `routes-platform-features.ts` with the Affidavit of Disclosure flagged required for unsubdivided land and a Water Adequacy Disclosure note. The county GIS endpoints in `routes-admin.ts` cover Maricopa, Pima, Pinal, Yavapai. The `marketPulseEngine` knows about Mohave and Navajo. The `countyAssessorIngest` job has Mohave priority 1, Yavapai priority 2, Coconino priority 2, Navajo priority 2.

What's missing: **everything I actually need on a Tuesday morning.** No water-rights surface keyed to my parcel. No AMA / INA boundary check. No ADWR well-registry pull. No Subdivision Public Report workflow for >5 lots. No state-trust-land or BLM-adjacency flag on the parcel detail. No tribal-land border warning. No septic-perc workflow for AZ's harsh soils. The Arizona-specific Affidavit of Disclosure exists as a label in a checklist — there's no template, no merge fields, no signing flow tied to it. So for the seven things that make AZ Arizona, AcreOS knows the names and ships none of the workflow.

At $20/mo as a Starter side-tool to LandID? Yes. At $49/mo Pro because I'm paying for note-portfolio features and Pulse score and an AI buyer-qualification engine — no. **I don't need more AI. I need a water-rights box that says "this parcel is in the Prescott AMA, exempt-well limit 35 GPM, ADWR registry shows two wells within 1/4 mile drilled to 480 and 520 feet."** That box doesn't exist.

---

## 2. The seven things I need — and what AcreOS actually has

### **(1) Water rights — the one question that decides every AZ deal.**

In Arizona there are five Active Management Areas (Phoenix, Pinal, Prescott, Tucson, Santa Cruz) and three Irrigation Non-Expansion Areas (Joseph City, Douglas, Harquahala). Inside an AMA, new groundwater pumping requires either an Assured Water Supply designation or proof you're an exempt well (≤35 GPM, domestic use). Outside an AMA — most of Mohave and Coconino — you can drill a well, but you better have it registered with ADWR (Form 55-71A) and you better know your priority date if there's a senior right downgradient. **A parcel without water in AZ is a parcel without a buyer.** Off-grid buyers will not write a check until they know what well they can drill and what it'll cost.

What AcreOS has: `environmentalIntelligence.ts` has an `AZ` entry in the `WATER_RIGHTS` map. It says "prior_appropriation," "permits required," "Appropriative right; groundwater rights in AMAs restricted," "Assured water supply required for new subdivisions in AMAs." That is **correct, useful, and as far as it goes.** The DD report generator (`dueDiligenceReportGenerator.ts` line 208) renders a Water Rights warning for western states. Good.

What AcreOS does **not** have:
1. AMA / INA boundary check on a parcel. The shapefiles are public on `azwater.gov`. Pull them once a quarter into a `water_management_zones` reference table, intersect parcel centroid, surface a flag on `/parcels/:id`. **One engineer-week.**
2. ADWR well registry lookup. ADWR publishes the wells-55 dataset — every registered well in Arizona, with depth, GPM, drill date, owner. Pull the five wells nearest a parcel centroid and render them in a Water tab. **Two engineer-weeks** including the API integration, caching, and rendering.
3. Assured Water Supply lookup for parcels inside an AMA. The Certificates of Assured Water Supply (CAWS) and the Designations are public records. If I'm subdividing >5 lots inside the Prescott AMA I need to know if my parcel is inside a designated provider's service area or if I'm on the hook for my own CAWS application. The product can't tell me.
4. A "Water" tab on `/parcels/:id` that surfaces all of the above plus the doctrine, the priority date if any, the nearest perennial stream from USGS, and a buy/no-buy recommendation. Today the parcel detail has tabs but not this.
5. A way to track Russ's invoices and his memos against a parcel. He bills me $375 a memo and I have forty memos a year. I'd love a "water counsel" thread per parcel that lives in the documents stack.

This is the **single most leveraged AZ feature** AcreOS could build. There are about 6,000 active AZ Land Investors and we all have the same question on every deal. Solve it once, charge for it forever. None of this is AI. It's data integration.

### **(2) AZ Subdivision Public Report — the >5-lot trip wire.**

Arizona Department of Real Estate (ADRE) requires a Subdivision Public Report for any sale of six or more lots, parcels, or fractional interests. This is heavier than the Texas equivalent — ADRE wants water adequacy, sewage disposal, road access, utilities, financing terms, all disclosed in a recorded report before any lot can sell. The application takes three to nine months. If you split a 200-acre parent into seven 28-acre lots and sell them without an SPR, ADRE can void the sales and you can owe restitution. This is the regulatory feature that breaks the Texas-trained subdivider when they cross the state line.

What AcreOS has: nothing on SPR specifically. The `routes-platform-features.ts` AZ disclosures list the Affidavit of Disclosure (which is the A.R.S. § 33-422 sale-side affidavit for unsubdivided land — different statute, different form). The `complianceGuardian` and `regulatoryIntelligence` services don't surface ADRE at all that I could find. There's no `Arizona` entry in `regulatoryIntelligence.ts` STATE_REGULATIONS — I checked, the file has TX, NC, AL, OK and a few others but no AZ block. **For my state, the regulatory intelligence page is empty.**

What I need: a "Subdivision Public Report" workflow on a parent-parcel that knows AZ rules — six-lot trigger, ADRE application checklist (Form ADRE 100, Form ADRE 200, water adequacy report, soils report, traffic impact if county requires, financial assurance), realistic timeline (count on six months), fee schedule, and a permit-tracker that flags when you're at SPR-day-90 and ADRE hasn't responded. This is the same checklist I keep on a clipboard. Move it into the app.

### **(3) State Trust Land adjacency — the access-easement trap.**

Arizona has 9.2 million acres of State Trust Land managed by the Arizona State Land Department (ASLD). It's everywhere — checkerboarded through Mohave and Coconino in particular. If your parcel only has road access across State Trust Land, you don't have legal access until ASLD grants a Right-of-Way (commercial lease or agricultural lease). **I have killed deals at the title-search stage because the only road in crossed unencumbered State Trust.** ASLD is not BLM. They will refuse, and they will charge you a per-acre lease rate if they grant it.

What AcreOS has: BLM/NPS/USFS public-lands check via the MCP tool (`server/mcp/index.ts` line 129). That's federal. It does not include Arizona State Trust Land. The ASLD GIS layer is public — `land.az.gov` — and not integrated.

What I need: a "Land Status" check on a parcel that returns federal ownership (BLM/NPS/USFS — already there), state ownership (State Trust — not there), tribal lands (not there), and adjacency within 1/4 mile of any of the above. Render adjacency as a flag, not a wall of text. "This parcel is adjacent to ASLD Section 16 — verify access easement before close." Three lines, saves three deals a year.

### **(4) A.R.S. § 33-422 Affidavit of Disclosure — actually generate the document.**

Arizona requires sellers of vacant lots in unincorporated areas (or subdivisions of <5 lots not requiring SPR) to deliver a notarized Affidavit of Disclosure covering water, sewage, road access, easements, soils, environmental hazards, flood, and legal access — at least seven days before close. The form is statutory: A.R.S. § 33-422 enumerates the disclosures item by item. The buyer can rescind if the affidavit is materially incorrect or untimely. **Every single sale I close requires this document.**

What AcreOS has: a label, "Affidavit of Disclosure," in the AZ row of `routes-platform-features.ts`. That's it. There is no template under `documents`, no merge-field schema, no signing flow tied to the AZ-specific form. I checked the `state-documents.tsx` page through the source — it serves general state config (deed type, recording fees) but doesn't host the affidavit template.

What I need: a `cc_template_az_33_422` template in the documents library with all 13 statutory items as merge fields (water source, water hauling, sewage method, perc test status, road maintenance, easements, mineral rights, environmental hazards, flood zone, legal access, zoning, agricultural exemption status, methamphetamine remediation status), a generation flow that pulls from the parcel record, and an HMAC-link signing flow with notary block. The signing infrastructure already exists; this is template work plus a tiny merge engine. **Two engineer-weeks. Saves me an hour per deal and reduces my malpractice risk to zero.**

### **(5) Tribal-land borders — Navajo / Hopi / Hualapai title traps.**

Northern Arizona has the Navajo Nation, the Hopi Reservation (a Navajo donut hole), Hualapai, Havasupai, San Carlos and White Mountain Apache, and several smaller communities. Tribal trust land is held by the United States in trust for the tribe — it is not "real estate" the way fee land is. **A parcel that *touches* a reservation boundary can have access, water, grazing, or even title disputes that don't show up in a county-recorder search.** I once had a parcel in Coconino whose access road had been traditionally used across Navajo land for sixty years; the Nation revoked the easement in year sixty-one and the buyer's purchase value dropped 70%. Title insurance didn't cover it.

What AcreOS has: nothing tribal-specific. The Public Lands MCP tool returns BLM/NPS/USFS but not BIA tribal lands.

What I need: a tribal-boundary adjacency check using the BIA shapefiles (public, on `data.bia.gov`). Render a flag on the parcel detail when the parcel is within one mile of a reservation boundary, with a one-paragraph explainer of the title-trap categories: access easements, water rights cross-claims, allotment-trust title chains. Don't try to solve it — just flag it so I know to call Russ.

### **(6) Off-grid reality — solar + well + septic as a buy/sell triangle.**

90% of my buyers are off-grid retreat-builders, vanlifers building a base, doomstead types, or end-of-the-road artists. They need three things: solar potential, drillable water, and septic-feasible soil. I price every parcel against that triangle. A Mohave parcel with great GHI, registered well within 1,000 feet, and Class A perc soils sells for $35K. Same parcel with 8 GPM well-failure-rate, granite at 20 feet (perc fails), and a HOA that bans solar — $9K and stuck for two years.

What AcreOS has: `solarPotentialService.ts` returns a GHI rating (excellent/good/moderate/poor) — **good, useful, I'd trust this for a first-pass screen.** `dataIntelligenceEngine.ts` returns SSURGO soil data including drainage, slope, septic_suitability — **also good.** The DD report includes water rights warnings.

What's missing: **the triangle isn't composed.** I can find solar on one screen, soil on another, water doctrine on a third. There is no "Off-Grid Suitability" widget that scores 0-100 across the three axes and renders a plain-English summary on the parcel card. There should be. Off-grid buyers are 90% of the AZ secondary market and they all run the same mental model. **Bake it into a scorecard. One day of work on top of services that already ship.** Call it the "Off-Grid Index" and it'll show up in Arizona deal-sheet screenshots on Twitter inside a month.

### **(7) Septic perc testing — AZ's harsh soil reality.**

Arizona soils are caliche, decomposed granite, pure sand, or — in a few valleys — actual loam. Maricopa County Environmental Services (MCES) and ADEQ permit on-site wastewater. The soils that fail perc are everywhere, especially in the high desert (Coconino) and the Hualapai foothills (Mohave). A failed perc downgrades a parcel from "buildable" to "RV-only" and crashes the price by 60%. The percolation test costs $400-$800 and requires a permitted soils evaluator. Most of my deals close subject to perc passing.

What AcreOS has: the regulatory intelligence file has a generic `percolationTestRequired` boolean for some states. AZ isn't a state in that file. The DD checklist has a generic septic-feasibility line item. The SSURGO data is pulled and contains septic_suitability, which is the right input.

What I need: an AZ-specific perc workflow — order the test through a permitted evaluator (there are ~30 in the state, list them by county), track the contingency in the deal pipeline with an SLA, attach the soils report to the parcel, and surface a fail-flag prominently. The soils-suitability data already supports a pre-test estimate that says "your SSURGO class is 7s — expect perc to fail" or "your class is 2 — perc likely passes." Translate the SSURGO output into plain English on the parcel detail. **A small surface that compounds — my pre-test reject rate would drop from 40% to 5% if the app told me upfront.**

---

## 3. The day-in-the-life test — where AcreOS would slot in

**Week 1 — list pull.** PropStream gives me 800 vacant Mohave / Yavapai / Coconino parcels under $40K. I dedupe absentee owners, drop anything inside an AMA without recorded water, drop anything with State Trust adjacency I can't verify, drop anything within a mile of a reservation boundary. I'm down to about 240. **Where AcreOS helps:** the parcel-import / list-management surface looks fine for ingest. **Where it doesn't:** the AMA-drop, ASLD-adjacency-drop, and tribal-adjacency-drop are filters I'd have to run in QGIS because the layers aren't in AcreOS. So I'd dedupe in AcreOS and screen in LandID.

**Week 2 — direct mail.** Yellow-letter campaign to 240 owners. **Where AcreOS helps:** the direct-mail-campaigns surface and the lead-intake. Looks well built. I'd use it.

**Weeks 3-6 — calls and offers.** Forty owners call back. I get fifteen verbal accepts on offers in the $0.30-on-the-dollar range. I write blind offers. **Where AcreOS helps:** `blind-offer-wizard.tsx` is reasonable; the offer-letter generation is fine. **Where it doesn't:** my AZ blind offers need to discount for water risk (no water = -50%), tribal adjacency (-15%), State Trust dependency (-25%), perc-likely-fail (-35%). The offer wizard doesn't know any of those discounts. I override every offer manually.

**Week 7 — under contract.** I get four parcels under contract. Each one I have to: (a) verify ADWR water status, (b) confirm legal access (no ASLD/tribal cross), (c) order perc, (d) get title commitment, (e) prep the A.R.S. § 33-422 affidavit. **Where AcreOS helps:** documents and signing for the purchase agreement. **Where it doesn't:** every other step. Five gates, none tracked, no county templates, no statutory form.

**Weeks 8-10 — close.** Title company closes them. Wire instructions, deed prep, recording. AZ is a non-attorney state and the title companies are competent. **Where AcreOS helps:** closing-costs.tsx is cleanly built and the deed-of-trust note ledger is solid for the rare seller-finance deal I do (one in twenty). **Where it doesn't:** the Affidavit of Disclosure I have to type in Word.

**Weeks 11-30 — list and sell.** I list on Land.com and Lands of America (LoA — there is no AZ-only marketplace because there are too few of us to matter to MLS). Direct-mail to past buyers. Some lots move in two weeks. Some sit eighteen months. I price-cut at month four if no offers, package two together at month nine, sometimes seller-finance to a buyer who's a 580 FICO retiree paying cash-flow from Social Security. **Where AcreOS helps:** listings, drip sequences, the seller-finance note ledger. **Where it doesn't:** Lands of America syndication isn't in `listingSyndication.ts` that I could find — I'd be re-entering listings.

---

## 4. Per-surface friction (AZ-specific)

**`/maps`** — Mapbox + FEMA + USDA + topo + hillshade + satellite. Strong general-purpose map. **Missing for AZ:** AMA/INA boundary overlay, ASLD State Trust overlay, BIA tribal-lands overlay, ADWR registered-well dot layer. Adding four overlays from public ArcGIS endpoints is a one-week project on top of the existing layer infrastructure.

**`/parcels/:id`** — Composed view, neighbors, DD checklist. **Missing tabs for AZ:** Water (AMA status, nearest registered well, ADWR priority date), Land Status (federal/state/tribal adjacency), Off-Grid Index (solar + water + perc composite). Three tabs, a meaningful difference for every AZ user.

**`/zoning-lookup`** — Useful pre-acquisition. The setback returns are good for a flipper. **Missing for AZ:** county zoning is fragmented and the recreational/agricultural overlays in Mohave (RU-zoning splits) are rule-heavy. Yavapai's zoning is different from Mohave's even for nominally identical "rural" parcels. The lookup's results don't reflect that local complexity, which is a generic problem but acute in AZ.

**`/regulatory-intel` + `/regulatory-intelligence` + `/compliance` + `/state-documents`** — Four overlapping surfaces. **None of them have an Arizona block in the regulatoryIntelligence service** that I could find — the file contains TX, NC, AL, OK and others. So when I navigate to the regulatory page for my home state I get either generic content or empty content. That's a credibility problem for me. **Add an AZ block: ADRE, ADWR, ADEQ, ASLD, A.R.S. § 33-422, A.R.S. § 33-422.01 (assured water supply), Subdivision Public Report process, Affidavit of Disclosure form, the five AMAs by name, the three INAs by name.** Day-and-a-half of writing for someone who knows the state.

**`/state-documents`** — The AZ block in `stateDocumentConfig.ts` is solid: warranty deed with vendor lien, deed of trust, agreement for deed, no transfer tax, e-recording, no attorney required. This is the one surface where my state is fully represented. Don't break it.

**`/documents`** — The HMAC-link signing flow is genuinely good. **Missing:** the AZ § 33-422 Affidavit of Disclosure template, the Beneficiary Deed template (estate planning, AZ-specific A.R.S. § 33-405), and the ADRE Public Report cover-letter set. Three templates, four hours each.

**`/compliance`** — The complianceGuardian rules engine has "subdivision" and "plat" rule types in `complianceRules`. None of them apply ADRE Public Report logic for AZ. Add a rule: `if state=AZ AND lot_count >= 6 AND no_active_spr THEN warn "ADRE Subdivision Public Report required."` One rule, one row in the seed data.

**`/today`** — Pulse score and AI suggestions. **Missing for me:** "Russ owes you a memo on parcel X — 14 days outstanding," "Perc test on parcel Y due back this week," "ADRE Public Report on parcel Z is at day 90 of expected 180." These are the events that would actually make `/today` matter for an AZ Land Investor.

**`/pax`** — Off, please. I have a water attorney and I do not want an LLM hallucinating about A.R.S. § 33-422 sub-clauses to a buyer's attorney. Pax should be opt-in for me, scoped to drafting marketing copy and follow-up emails. **Never let it author a § 33-422 affidavit.**

**`/founder` surfaces** — Hide them for customers. They were noise on the persona switcher for me.

**`/atlas`, `/depreciation-calculator`, `/exchange-1031`, `/dunning-manager`, `/board-of-directors`, `/conscious-organization`** — None of these apply to my model. The nav is too dense. A persona-driven nav for "AZ Land Investor" should show maybe 12 entries, not 60+.

---

## 5. The data-model gap

Three columns and one reference table cover most of the AZ-specific shortfall:

1. `properties.water_management_zone text` — nullable; values like "Prescott AMA," "Joseph City INA," or null. Populated by intersecting parcel centroid against the ADWR boundary shapefiles.
2. `properties.adwr_well_count_quarter_mile integer` — nullable; populated by spatial query against the ADWR wells-55 dataset.
3. `properties.land_status_adjacency jsonb` — nullable; structure `{ federal: ["BLM"], state: ["ASLD-Section-16"], tribal: ["Navajo-Nation:0.6mi"] }` or similar.
4. A `water_rights_priorities` table for the parcels with adjudicated rights — priority date, decree, certificate number. Most parcels don't have one. The ones that do, I'd pay $50 just to have it on file.

The existing `parent_parcel_id` model that the Subdivider audit asks for is also load-bearing for me — when I'm doing a 6+ lot SPR, the parent / child relationship is the spine of the workflow.

---

## 6. Three things AcreOS has built that I'd actually use today

1. **The `environmentalIntelligence.ts` water-rights state map.** AZ entry is correct. The doctrine, the AMA permits, the assured-water-for-subdivisions note. As a foundation it's right. Connect it to the parcel detail and surface a Water tab and you're 30% of the way to my must-have.
2. **The `stateDocumentConfig.ts` AZ block.** Warranty deed with vendor lien, deed of trust, agreement for deed, no transfer tax, e-recording, no attorney required. This is the one place AcreOS knows my state.
3. **The MCP public-lands lookup.** BLM/NPS/USFS adjacency. Add State Trust and BIA tribal lands to the same call and it becomes a deal-screen tool for my entire intake funnel.

Honorable mention: SSURGO soils data is already pulled for septic suitability. Translate the SSURGO output into a plain-English perc forecast and that's a real surface for $0 of new data integration.

---

## 7. The deal-killer

**Arizona's land market runs on water rights, ADRE Public Reports, State Trust adjacency, A.R.S. § 33-422 affidavits, tribal-border title traps, off-grid suitability scoring, and AZ-specific perc reality. AcreOS has a label for the affidavit, a paragraph about the doctrine, and silence on everything else.**

The product was built for a national audience and gets the AZ pieces right where they overlap with the national pattern (deed types, recording, usury, tax-lien state). It gets the AZ pieces wrong — or absent — where Arizona is genuinely different from everywhere else.

I will not move my live work into AcreOS until I can:
1. Open a parcel and see its AMA/INA status, nearest registered ADWR wells, and water doctrine.
2. See a federal/state-trust/tribal adjacency check — not just BLM.
3. Auto-generate an A.R.S. § 33-422 Affidavit of Disclosure with merge fields and an HMAC signing link.
4. Track an ADRE Subdivision Public Report through its 13-step application gate-by-gate.
5. See an Off-Grid Index (solar + water + perc) on every parcel card.
6. Get a percolation forecast from SSURGO before I order the test.
7. Have an Arizona block on the regulatory-intelligence page that's not empty.

Build five of those seven and I'll sign Pro for two years and bring you the half-dozen Verde Valley investors I trade with.

One last thing: please don't ship "AI-powered Arizona water rights analyzer." Russ costs me $4,500 a year and is right every time. The product I want is the deterministic data layer that hands him a clean memo to review. Pull ADWR. Pull ASLD. Pull BIA. Pull SSURGO. Compose them on a parcel detail page. The rest is just labor I save.

— Hank Bowman
   Cottonwood AZ — Mohave / Yavapai / Coconino Land Investor
