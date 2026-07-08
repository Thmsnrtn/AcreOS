# Wyatt Hollister — Tennessee Land Investor Audit

**Role:** TN Land Investor, 47, Crossville. Cumberland / Fentress / Overton counties. Mixed-use plays — hunting/recreation/agricultural with some development upside on the Plateau edge.
**Stack:** Lands of TN listing + a TN-licensed broker for the closes that need a license touch.
**Wave:** 3 of the AcreOS audit run.
**Reviewing:** `server/services/regulatoryIntelligence.ts`, `dealUnderwriting.ts`, `parcel.ts`, `propertyTaxService.ts`, `listingSyndication.ts`, `dueDiligenceEngine.ts`, `buyerNetwork.ts`, `dispositionOptimizer.ts`.
**Date:** 2026-05-01.

---

## 1. One-line verdict

**AcreOS knows Tennessee exists, lists it in seven state-code tables, and gets the broad strokes (no income tax, permissive land use, low usury risk) right — but it does not know a single thing that actually matters to a Cumberland Plateau land investor: not Greenbelt, not the 2022 wholesaling tightening, not karst, not the hunting-lease economy, not why a Knoxville retiree pays more for the same fifteen acres than a Nashville one.**

The state profile in `regulatoryIntelligence.ts:160-181` is a fourteen-line summary. Tennessee deserves more than fourteen lines, because Tennessee land investing is *different* from the South-Central template the rest of the file is built on.

---

## 2. Greenbelt (the single biggest gap)

The Tennessee Agricultural, Forest, and Open Space Land Act of 1976 — universally called "Greenbelt" — is the single most important property-tax mechanic on the Plateau. It is the difference between a $4,200/yr tax bill and a $380/yr tax bill on the same 50-acre tract.

### What AcreOS does today

`regulatoryIntelligence.ts:174` sets `agriculturalExemptionAvailable: true`. That's the entire treatment. There is no entity called Greenbelt anywhere in the codebase. `propertyTaxService.ts:55` links to the state Comptroller's *appeals* page — not the Greenbelt application page (which is on each county Assessor's site, not the Comptroller's).

### What's wrong about that

1. **Greenbelt is not an "exemption."** It's a use-value assessment. The land still gets taxed; it gets taxed on its value as farm/forest/open space (often $400–$1,500/acre) rather than market value (often $4,000–$15,000/acre on the Plateau). Calling it an exemption misleads a buyer doing back-of-envelope math.
2. **It has rollback liability.** When Greenbelt is removed (sale to non-qualifying buyer, conversion, subdivision), the county recaptures the **prior 3 years** of tax savings as "rollback tax." `dealUnderwriting.ts` runs a wholesale-vs-owner-finance-vs-retail analysis at line 156 and never models rollback. A 50-acre Greenbelt parcel with $3,800/yr in deferred taxes will hit the closing table with **$11,400 in rollback** the moment Wyatt pulls it out for a residential subdivision. That's a deal-killer unburied at the title commitment stage.
3. **Acreage minimums.** TN Greenbelt requires **15+ contiguous acres** for ag/forest classification, with a 1,500-acre cap. AcreOS will happily accept a 12-acre "agricultural" classification in `regulatoryIntelligence.ts:174` without flagging that the parcel is sub-threshold and the ag rate Wyatt is underwriting against doesn't apply.
4. **Subdivision triggers.** Carving 5 lots off a 50-acre Greenbelt parent triggers rollback on the *whole* parent tract, not just the carved acreage, in most counties. `parcel.ts` and `dealUnderwriting.ts` have no concept of "parent in Greenbelt" as a deal flag.

### What to ship

1. Add `greenbeltStatus: "qualified" | "enrolled" | "ineligible" | "unknown"` and `greenbeltRollbackEstimate: number` to the parcel intelligence schema. Calculate rollback as `3 × (marketAssessedTax - useValueAssessedTax)` whenever the user marks a TN parcel as Greenbelt-enrolled.
2. In the TN entry of `regulatoryIntelligence.ts`, replace the bare `agriculturalExemptionAvailable: true` with a Greenbelt block that captures: 15-acre minimum, 1,500-acre maximum, 3-year rollback, application due **March 1** of the year claimed, requires assessor approval, status is *parcel-specific* (a buyer must reapply in their own name after closing).
3. Add a Greenbelt-aware deduction line to the underwriter so the recommended exit strategy in `dealUnderwriting.ts:156-167` reflects rollback liability when the chosen exit is "subdivide & retail." Wyatt's Cumberland County deals frequently look like a subdivision play, and the current model overstates retail profit by exactly the rollback amount.
4. Practitioner note in the TN profile: *"Greenbelt is the default in rural TN — assume the seller has it unless the tax card explicitly shows market-value assessment. Confirm via county assessor card before underwriting; estimate rollback on any non-ag exit."*

---

## 3. Wholesaling — TN tightened the rules in 2022, AcreOS doesn't know

In 2022 Tennessee enacted Public Chapter 977, which made it a Class A misdemeanor to **advertise a property for sale that you do not own** without disclosing that you hold an equitable interest only. The statute targets the classic wholesaler move of marketing a property under contract as if it were your own listing. Marketing the *contract* is fine. Marketing the *property* is not.

### What AcreOS does today

`dealUnderwriting.ts:140-142` calculates a wholesale exit at 85% of purchase price as if it were a clean, universally-available strategy. `routes-organization.ts:699` lets users self-identify as `residential_wholesaler`. `atlasContextInjector.ts:68` even tunes the AI persona to wholesalers. None of these surfaces flag the TN-specific advertising restriction. The Listing Syndication service (`listingSyndication.ts:413-420`) will happily push a property to Lands of America under a TN org's account regardless of whether that org actually owns the property.

### What's wrong about that

A user in Crossville who spins up a wholesale listing through AcreOS — picks "wholesale" as the recommended exit, syndicates to LandWatch / Lands of America — is now committing a Class A misdemeanor *with AcreOS as the publishing tool*. That's a real-estate-board complaint at minimum and a TREC investigation at worst. Wyatt has a TN broker on his stack precisely because he doesn't want to be on the wrong side of this; AcreOS has no idea this line even exists.

### What to ship

1. `regulatoryIntelligence.ts` TN profile: add a `wholesalingRules` block with `requiresEquitableInterestDisclosure: true`, `statuteRef: "T.C.A. § 62-13-104(b)(3)"`, `effective: "2022-07-01"`.
2. When `listingSyndication` is asked to push a TN parcel where the org is not the deeded owner, **block the syndication** and surface a modal explaining the disclosure requirement, with a checkbox to confirm the listing copy includes language like *"This property is offered for sale by the equitable interest holder under contract; closing is contingent on assignment."*
3. When `dealUnderwriting.ts` recommends `wholesale` for a TN parcel and the underlying deal record shows status `under_contract` rather than `owned`, surface the same notice on the deal page.
4. Compliance route already exists (`routes-compliance.ts`) — wire a TN-wholesaling rule into the regulatory-compliance check job (`server/jobs/regulatoryComplianceCheck.ts`) that scans active syndicated listings for TN parcels-not-owned and flags them.

---

## 4. The Cumberland Plateau — geology, not just elevation

`dueDiligenceEngine.ts:75` defines slope as `flat / gentle / moderate / steep` and `dueDiligenceEngine.ts:558-578` notes it can't actually compute slope from a single elevation point. That's an honest engineering note, but it leaves a gigantic hole for Cumberland Plateau parcels.

### What's actually different about the Plateau

The Cumberland Plateau (Cumberland, Fentress, Overton, Morgan, Scott, Bledsoe, Van Buren counties) is **karst limestone capped by sandstone**. That geology drives four buildability constraints AcreOS does not detect:

1. **Sinkholes.** Karst topography means surface depressions that swallow drain fields, foundations, and (occasionally) tractors. TN does not require sinkhole disclosure (`regulatoryIntelligence.ts:171` correctly doesn't list it for TN — Florida is the only state with it in this codebase, line 100). Buyers and lenders care anyway.
2. **Perc test failure rates.** Plateau soils are thin over rock. Perc failures run 20–35% in Cumberland County depending on the side of the mountain. TN entry at `regulatoryIntelligence.ts:177` says `percolationTestRequired: false` — true legally, but a perc test is a *commercial* requirement on every recreational/development parcel, because no septic permit means no buildable lot.
3. **Bluff/escarpment lots.** A nominal 10-acre tract on the Plateau edge can have 6 acres of vertical bluff. Slope analysis from a single elevation point (`dueDiligenceEngine.ts:561`) won't catch this. The cure is a USGS DEM slope raster query — pull min/max/mean elevation across the parcel polygon, not a centroid point. The infrastructure for parcel polygons already exists (`parcel.ts:1062-1075` for Davidson; need to expand to Plateau counties).
4. **Coal mining undermining.** Northern Plateau (Scott, Morgan, Anderson, Campbell, parts of Cumberland) sits over abandoned coal mine workings. There is a TN OSMRE map of undermined parcels. AcreOS has no environmental layer for it.

### What to ship

1. Add a Plateau-specific check to `parcelIntelligenceFusion.ts`: when state=TN and county ∈ {Cumberland, Fentress, Overton, Morgan, Scott, Bledsoe, Van Buren, Sequatchie, White, Putnam, Pickett, Fentress, Anderson, Campbell}, run extended elevation analysis (polygon-based slope distribution), karst-risk overlay, and undermined-land overlay.
2. Add a county-assessor scrape for at least Cumberland (assessment via TNAssessment.com), Fentress, Overton — `parcel.ts:1062` only has Davidson today.
3. Surface a "Plateau buildability score" on the parcel detail page: composite of slope distribution, karst risk, undermining risk, and perc-test history (where county records exist).
4. In `regulatoryIntelligence.ts`, replace the practitioner note for TN with: *"East TN mountains and the Cumberland Plateau dominate the recreational-land market. Karst geology drives sinkhole and perc-failure risk. Always commission a perc test on any lot intended for residential resale — buyer financing depends on it. Sandstone-capped Plateau bluff lots can show 50–90% unbuildable terrain on USGS DEM despite favorable acreage."*

---

## 5. The Tennessee Residential Property Disclosure Form

`regulatoryIntelligence.ts:171` lists `requiredDisclosures: ["residential_disclosure", "lead_paint"]` for TN. That string is generic. The actual document is the **TREC Tennessee Residential Property Condition Disclosure** under T.C.A. § 66-5-201 et seq.

### What AcreOS does today

`stateDocumentConfig.ts` has TN in its state list (line 410) but I see no evidence the state-specific disclosure form is present in `content/` or `attached_assets/`. The Document Intelligence service (`documentIntelligence.ts`) processes documents users upload — it does not generate or surface the TREC form.

### What matters about it for land

The TREC residential disclosure has a specific exemption: **unimproved real property** (vacant land) is exempt from the form. T.C.A. § 66-5-209(2). For Wyatt's pure-recreational tracts, the form *should not be issued* — but if he sells a 25-acre tract with an old hunting cabin or a doublewide that's been there since 1987, it's no longer unimproved and the form *is* required. The line is fuzzy in practice.

### What to ship

1. In the TN entry, replace `requiredDisclosures: ["residential_disclosure", "lead_paint"]` with a structured object:
   ```ts
   requiredDisclosures: [
     { code: "TN_TREC_RPCD", label: "TN Residential Property Condition Disclosure",
       statute: "T.C.A. § 66-5-201", appliesWhen: "improved_residential",
       formUrl: "https://www.tn.gov/content/dam/tn/commerce/documents/regboards/trec/forms/...pdf" },
     { code: "TN_LEAD_PAINT", label: "Lead Paint Disclosure (pre-1978)",
       statute: "42 U.S.C. § 4852d", appliesWhen: "improved_pre_1978" },
   ]
   ```
2. Add an `appliesWhen` evaluator: when the deal record shows acreage > 5 and `improvementsValue == 0` and no structures, the residential disclosure is exempt and AcreOS should surface "TN Disclosure: NOT REQUIRED — unimproved land exemption (T.C.A. § 66-5-209)" in green on the deal close checklist. When there *is* a structure, prompt "TREC RPCD form required — generate and send to buyer."
3. Generate the form via the existing native e-sign stack (per project memory — AcreOS ships its own signing, no DocuSign). Pre-fill from the deal record.

---

## 6. Hunting lease income — a missing revenue stream

Tennessee is a top-five whitetail state with a culture of paying for access. A 100-acre Plateau tract can produce $1,500–$4,500/yr in hunting-lease income. For Wyatt's hold-while-marketing inventory, this is a real cash flow. The going rate on Plateau sandstone-cap acreage is $15–$45/acre/year depending on stand quality and access.

### What AcreOS does today

`dealUnderwriting.ts:120-167` runs a complete economic model: holding costs, taxes, insurance, maintenance, exit strategies. It has **no hunting-lease income line**. `dispositionOptimizer.ts:887` recognizes "Hunting, camping, or weekend getaway" as a use case — which is the right buyer-side marketing, but the *seller-side* hold economics ignore the income.

### What to ship

1. Add `holdingIncome.huntingLease: { annualPerAcre, totalAnnual, leaseType: 'season' | 'year' | 'multi-year', confidenceSource }` to the deal underwriting input.
2. In TN (and AL, GA, MS, AR, KY — the wider Mid-South hunting belt), pre-fill a default of $20/acre/yr for tracts >40 acres with timber/cover indicated by NLCD land-cover data, with a confidence note.
3. Subtract `huntingLeaseRevenue` from `totalHoldingCost` in `dealUnderwriting.ts:130-132`. A 60-acre Plateau parcel held 18 months at $25/acre/yr is $2,250 of income against ~$1,800–$3,000 of hold costs — the difference between a marginal hold and a free hold.
4. Add a marketplace surface for hunting leases. AcreOS already has `marketplace.ts` and `buyerNetwork.ts`; building a "hunters wanted" list inside an org's existing buyer-network primitive is a one-week job.
5. Tax note in the TN profile: hunting-lease income is **ordinary income** to the landowner, but it does **not** disqualify Greenbelt — recreational use of agricultural/forest land is permitted. Cite Tenn. Comp. R. & Regs. 0600-09-.04. Critical because Wyatt's accountant will ask.

---

## 7. The out-of-state retiree buyer — the dominant TN end-buyer

The most common end-buyer for a Plateau or East-TN recreational tract is a 55–70-year-old from the Midwest (OH, MI, IL, IN) or the Northeast (NY, NJ, PA) buying a retirement parcel. They're moving for: no income tax, mild winters, low cost of living, and family-friendly recreation. They are **not** the same buyer who buys a Texas hunting tract or a Florida lot, and they don't shop the same way.

### What AcreOS knows about this

`censusDataService.ts:546-548` knows about the Nashville growth ring (Rutherford, Wilson). It does NOT know about the Knoxville–Chattanooga retiree corridor (Cumberland, Roane, Loudon, Monroe, Polk) which is where the actual Plateau retiree money lands. `buyerNetwork.ts` and `buyerMatchingAI.ts` have no concept of an "out-of-state retiree" buyer archetype keyed off origin-state migration patterns.

### What's wrong about that

The out-of-state retiree shops differently:
- Searches for "Tennessee land for sale" from an OH IP, not from inside TN. Retargeting needs to know this.
- Cares about: **paved road frontage** (their rental car has to make it), **broadband availability** (Spectrum or fiber, not satellite), **distance to a hospital** under 30 minutes, and **distance to a Walmart or Lowe's** under 20 minutes. None of these are in `dueDiligenceEngine.ts`.
- Does not care about: timber stand quality, soil productivity index, hunting-pressure history.
- Pays a **15–25% premium** over a comparable parcel sold to an in-state buyer because they're buying a lifestyle, not a commodity.

### What to ship

1. Add a `buyerArchetype` taxonomy that includes `out_of_state_retiree` with attributes: origin states, age band, household income range, must-have features, willing-to-pay premium.
2. In `buyerMatchingAI.ts`, when matching a TN parcel to potential buyers, weight `out_of_state_retiree` matching against road class, broadband availability, and hospital/retail proximity.
3. Add to `dueDiligenceEngine.ts`: paved-road-frontage check (TIGER roads), broadband availability (FCC Form 477 / BroadbandNow API), nearest hospital, nearest retail. These are all free or cheap data sources and they directly drive the price band a TN parcel commands.
4. In `dispositionOptimizer.ts:887`, expand the "likely use case" beyond "Hunting, camping, or weekend getaway" to include "Out-of-state retiree relocation" when the parcel scores high on the retiree-fit features above. That changes the listing copy, the syndication choices (Zillow + Lands of America for retirees, vs LandWatch + on-X for hunters), and the photography guidance.
5. The Nashville-centric migration table in `censusDataService.ts:547` needs Plateau and East-TN retiree-corridor counties added: Cumberland (in-migration from Midwest), Roane, Loudon, Monroe, Polk, Bradley, Sevier (Smokies-adjacent retirees), and the West-TN edge for Memphis-flight buyers.

---

## 8. The two-week TN-specific sprint

### Week 1 — schema + intelligence

**Day 1 (3 hours):** Expand the TN entry in `regulatoryIntelligence.ts:160-181` with: Greenbelt rules (15-acre min, rollback formula, application deadline), wholesaling rules (P.C. 977, equitable-interest disclosure), structured disclosure list with `appliesWhen` evaluators, Plateau-specific practitioner notes.

**Day 2 (4 hours):** Add `greenbeltStatus`, `greenbeltRollbackEstimate`, `huntingLeaseIncome`, `paleozoicKarstRisk`, `underminedLandRisk` to the parcel intelligence and deal underwriting schemas. Wire into Drizzle migrations.

**Day 3 (6 hours):** Plateau county parcel scrapers — Cumberland, Fentress, Overton at minimum. Pattern after the Davidson entry at `parcel.ts:1062-1075`. Each county's GIS portal exposes a different ArcGIS or HTML interface; budget reality is more like 8 hours for three counties.

**Day 4 (4 hours):** Greenbelt rollback model in `dealUnderwriting.ts`. Subtract `huntingLeaseIncome` from holding costs. Surface rollback in the recommended-exit decision so a "subdivide and retail" exit on a Greenbelt-enrolled parent tract correctly takes the 3-year recapture hit.

**Day 5 (3 hours):** TN wholesaling-disclosure block in `listingSyndication.ts` and the regulatory compliance job. Block syndication of TN parcels-not-owned without explicit equitable-interest disclosure copy.

### Week 2 — buyer side + polish

**Day 6-7:** Out-of-state retiree archetype in `buyerNetwork.ts` and `buyerMatchingAI.ts`. Add broadband, hospital, retail, and paved-road-frontage checks to `dueDiligenceEngine.ts`.

**Day 8:** Hunting-lease marketplace surface — extend `marketplace.ts` with a "lease offers" type. Wire into existing buyer-network primitive.

**Day 9:** TREC Residential Property Condition Disclosure form — generate via native e-sign stack with `appliesWhen: improved_residential` evaluator. Auto-skip with "exempt — unimproved land" notice for pure-vacant TN deals.

**Day 10:** Practitioner-note rewrite for the TN profile, replacing the current 14-line entry with a real one. Update `propertyTaxService.ts:55` to point to county-assessor Greenbelt application pages instead of the appeals page. Add a TN-specific dashboard panel for orgs with `state: "TN"` showing: Greenbelt enrollment status of inventory, rollback exposure, hunting-lease pipeline, retiree-fit score distribution.

### What this sprint does not solve

- **East TN mountain land** (Sevier, Cocke, Greene) and **West TN delta land** (Lake, Obion, Tipton) have their own quirks — Smoky Mountain steep-slope subdivision rules, FEMA flood mapping along the Mississippi tributaries, agricultural use patterns that differ from Plateau hunting. Phase 2.
- **Tennessee Valley Authority** parcels and TVA-flowage-easement land near Watts Bar, Tellico, Center Hill — major recreational sub-market with restrictions that need their own profile.
- **Title-insurance practice.** `regulatoryIntelligence.ts:162` says `titleInsuranceRequired: false` for TN, which is technically correct (TN does not mandate it). In practice, every institutional lender and every out-of-state retiree closes with title insurance through one of three Knoxville-based agencies. Whether AcreOS surfaces this as a soft requirement is a UX call.

---

## Bottom line

AcreOS treats Tennessee as a low-risk, low-effort state in `regulatoryIntelligence.ts` and that's directionally fine for the average broker user. For Wyatt — a hands-on Plateau land investor with a TN broker on his stack — the gap between "directionally fine" and "actually useful" is Greenbelt rollback math, the 2022 wholesaling tightening, perc-test-aware Plateau buildability, hunting-lease income in the underwriter, and the out-of-state retiree as a first-class buyer archetype. Two weeks of focused work makes AcreOS the best TN-specific land-investing tool on the market. Until then, Wyatt is going to keep his spreadsheet, his county-assessor bookmarks, and his broker on speed dial — and AcreOS is just a CRM with pretty charts that doesn't know what state he's in.

— Wyatt
