# Bryce McAllister — AcreOS user review (Colorado Land Investor)

I'm 44, based in Salida. I work the southern San Luis Valley and the Sangre de Cristo / Spanish Peaks corridor — Costilla, Las Animas, Saguache, sometimes Huerfano and Alamosa. Mountain land and ranch-shoulder land, $20K to $200K. Half my deals are 5-acre HOA-encumbered lots in places like Forbes Park, Wild Horse Mesa, Sangre de Cristo Ranches, Rio Grande Ranches, Forbes Wagon Creek. The other half are 35-160 acre pieces with cattle history, sometimes a senior water right attached, sometimes a windmill that hasn't run since '94. My stack is PropStream for skip-trace, LandWatch for listings, Beacon for the GIS in counties that have it, the county clerk's online viewer in the ones that don't, and a network of three ranch brokers I've fed Christmas hams to for a decade. I keep books in QuickBooks Self-Employed. Signatures are SignNow.

I tested AcreOS over a working week. Persona switcher set to "wholesaler" the first three days, then "land flipper" the next two. Here's the Colorado-specific verdict.

---

## 1. Thirty-second verdict

Would I sign up? **At Starter, yes — for the parcel-discovery and the maps. At Pro, not yet — because the four things that make Colorado land Colorado land are not in this product.**

AcreOS knows my counties exist. The parcel-ingest job (`server/jobs/countyAssessorIngest.ts`) lists Costilla, Saguache, Las Animas, Huerfano, Alamosa. The ArcGIS endpoints in `server/services/parcel.ts` are wired to live county REST services for all four of mine. The market-pulse engine in `routes-market-intelligence.ts` even has a CO row with the right top counties. **At the data-ingest layer this is the most CO-aware land platform I've ever logged into.** That part is genuinely impressive — most products treat anything west of Kansas as a flyover.

But CO land is not generic land. The four things that close a Costilla deal — the POA, the water right, the severed minerals, and the disclosure form — get treated as text-blob afterthoughts. And the regulatory-intel module that ships `TX, FL, GA, NC, TN, AL, MS, AR, MO, OK` profiles **does not have a Colorado profile at all.** I checked twice. So a feature like "blind-offer wizard" runs me through a checklist that doesn't know my state's water-rights system, doesn't know my disclosure form, doesn't know whether my deed needs witnesses, and tells me nothing useful about the POA wall I'm about to hit.

---

## 2. The seven things I need — and what AcreOS actually has

### **(1) HOA / POA intelligence — Forbes Park, Wild Horse Mesa, Sangre de Cristo Ranches.**

Half my San Luis Valley inventory is in covenant-controlled subdivisions. **The POA is not a side issue — it is the deal.** Forbes Park has architectural review, road maintenance assessments ($600-$1,200/yr depending on which filing), a transfer fee at closing that varies by board policy, and active enforcement against unpermitted sheds, trailers, and "camping" longer than 14 days. Wild Horse Mesa is looser on architecture but has a private-road LLC that levies separately from the POA. Sangre de Cristo Ranches has multiple "units" (Unit 17, Unit 23, Unit 27 — different rule sets, different dues, different boards). A buyer who calls me asking "is Unit 23 the one where I can put a yurt" — and I get that call weekly — needs an answer in fifteen seconds.

What AcreOS has: a `hoaInfo` JSONB column on the due-diligence checklist (`shared/schema.ts:4620`) with `hasHOA`, `hoaName`, `monthlyDues`, `specialAssessments`, `restrictions[]`, `contactInfo`. A DD checklist item: "Restrictions reviewed — Check deed restrictions and HOA rules." That's the sum total. **A schema slot and a checkbox.** No POA library. No ability to attach a CC&R PDF and have it parsed into rule rows. No "yurt allowed?" field. No transfer-fee tracker. No board-contact directory.

What I need:
1. A `poaProfiles` table seeded with the top 30 covenant-controlled subdivisions in the SLV alone — that's a one-day effort by anybody with access to the Costilla and Saguache county land records and a search engine. Forbes Park, Wild Horse Mesa, Sangre de Cristo Ranches Units 1-27, Rio Grande Ranches, Forbes Wagon Creek Estates, Trinchera Ranch Estates, Mountain Tract, San Luis Valley Ranches. Each row: dues, transfer fee, ARC required, RV allowed, camping limit days, manufactured-home allowed, minimum dwelling sqft, road-LLC separate from POA (Y/N), board-contact email, governing-doc PDF link, last verified date.
2. Auto-attach by polygon: when a parcel imports from the Costilla GIS feed, hit-test it against POA boundary GeoJSON and surface "This parcel is in **Forbes Park, Filing 6** — POA dues $940/yr, transfer fee $300, ARC required, no RVs, 800 sqft min dwelling."
3. POA-aware blind offer: my offer on a Forbes Park lot is **15-25% lower** than the same acreage outside the POA boundary because of carry costs and ARC friction. The blind-offer calculator should take POA membership as an explicit input and adjust the offer.
4. "Estoppel letter" tracker — at closing the title company needs a current POA estoppel showing dues are paid. That's a workflow checkbox AcreOS does not have today.

If I had only one feature shipped, this one wins. **POA is the highest-friction, highest-leverage layer of CO land work, and right now AcreOS sees it as a free-text field.**

### **(2) Water rights — adjudicated decree numbers, senior vs junior.**

A Saguache ranch with a senior 1887 ditch decree is worth a different number than the same ranch with a 1973 junior right that hasn't been called in twelve years and probably won't yield in a dry year. Colorado is `prior_appropriation` — the regulatory-intel module knows that classification exists (`waterRightsSystem: "prior_appropriation"`) and applies a generic recommendation when the state profile is OK or TX. **There is no CO profile, so my water-rights warnings never trigger.** A 160-acre listing I tested through the wizard returned no water-rights flag because the state lookup returned undefined.

Even when CO is added, the profile structure won't go far enough. What I need:
1. A `waterRights` JSONB on properties: `decreeNumber`, `priorityDate`, `cfsAmount`, `acreFeetAnnual`, `divisionNumber` (1-7 in CO), `waterDistrict`, `useType` (irrigation/stock/domestic/recreation), `transferable` (boolean), `augmentationPlanRequired`, `lastCallYear`.
2. Pull-from-CDSS — Colorado's Decision Support System publishes adjudicated rights with REST. A water-right lookup that takes APN + county and returns associated rights would be a 2-3 day integration and a defining feature for CO sellers. CDSS HydroBase is the source of truth and it's queryable.
3. Domestic-well permit lookup — Division of Water Resources publishes well permits by location. "Does this 35-acre parcel have an existing exempt domestic well permit?" answers the most common buyer question I get.
4. Senior/junior call risk — the stream's call history (when was it last on call, by whom) tells a buyer whether the junior right on Trinchera Creek will yield in their lifetime or not.

The DD report generator (`server/services/dueDiligenceReportGenerator.ts:242`) speaks the right vocabulary — "Mineral rights may be severed from surface rights. Severance risk: ${mineralInfo.severanceRisk}" — but the equivalent for water is missing. **In CO, water risk is more important to land value than mineral risk by an order of magnitude.**

### **(3) Mineral rights severance.**

Most CO land has been split. Surface estate stays with the deed; the minerals were sold off in the 30s, 50s, 70s — usually to an oil & gas exploration shell that's now five layers deep in successor companies. Buyers want to know: "Are the minerals severed? If yes, who owns them? Is there active leasing?" In the Raton Basin (Las Animas / Huerfano) coalbed methane is real and recent — a 40-acre tract with active CBM rights producing $400/mo of override royalty is a different listing than the same acreage with severed minerals leased to a defunct LLC.

What AcreOS has: a `mineral_rights` exception type in `titleChainService.ts:307`, severance-risk language in the DD report generator, and a checklist item "Mineral rights confirmed." **The bones are present, the data is not.** There is no integration with the Colorado Oil & Gas Conservation Commission (COGCC) database, which publishes operator and well data by location. There is no override-royalty tracker. There is no "active lease" flag.

What I need:
1. COGCC well lookup by APN/section — surfaces "1 producing CBM well within parcel boundary, operator: Pioneer Natural Resources, formation: Vermejo, status: producing 2024."
2. BLM / CO state mineral records lookup — federal minerals are common in southern CO (split estate is the rule, not the exception, on a lot of homestead-era patents).
3. Override-royalty modeling — if the seller retained a fractional interest in the override on a producing well, that has present value the AVM doesn't see today.
4. A "title chain" surface that flags the severance year and the recorded book/page of the mineral deed. The titleChainService has the exception type — wire it to a CO record-search and it surfaces the actual severing instrument.

For my $20K-$200K range a missed mineral severance is rarely a deal-killer, but it routinely costs me 3-7% of margin because I underprice the mineral upside. **The math says paying for one COGCC integration earns its keep on every fifth deal.**

### **(4) Conservation easements — Colorado's tax-credit landscape.**

CO has the most active conservation-easement market in the country. The state issues a transferable income tax credit (currently 90% of the donation value up to $5M) on top of the federal deduction, and there's a legitimate secondary market for buyers of CO conservation tax credits. For a 160-acre piece with significant agricultural or wildlife value, a planned CE can add $200K-$1.2M of after-tax value and is often the **disposition strategy** that makes the deal pencil.

What AcreOS has: the dueDiligence service knows the substring "conservation" exists in zoning text (`server/services/dueDiligence.ts:165`). That's it. There is no easement model, no tax-credit calculator, no land-trust directory, no Baseline Documentation Report tracking, no monitoring-visit calendar.

What I need:
1. A `conservationEasements` table: holding land trust, recorded date and book/page, restricted-use enumeration (no subdivision, no surface mining, no commercial development, etc.), monitoring frequency, baseline doc PDF.
2. CE-aware AVM — a property under CE has reduced development potential and the comp set should filter accordingly. The AVM at `client/src/pages/avm.tsx` does not consider easement encumbrance today.
3. Tax-credit calculator — given an appraised "before" value, a "no-development" appraisal, the donation differential, and the CO 90% state credit math, project the credit yield and the secondary-market discounted cash value (typically credits sell at $0.83-$0.88 on the dollar to high-bracket CO taxpayers).
4. Land-trust directory — Colorado Open Lands, Palmer Land Trust, Colorado Cattlemen's Agricultural Land Trust, La Plata Open Space Conservancy, Trust for Public Land. Region-by-region, who's actively accepting easements, what their minimum acreage is, what their target ecosystems are.

This is the disposition strategy AcreOS is built to surface — the disposition optimizer talks about "Build home or cabin" use cases (`dispositionOptimizer.ts:883`) but **does not know that "place under conservation easement and sell tax credits" is a Colorado disposition path.** Add it.

### **(5) CO Real Estate Commission rules — wholesalers under scrutiny.**

CREC has been increasingly aggressive about unlicensed wholesaling. The current line — and it shifts — is that you can market your own equitable interest under contract, but you cannot market the property itself, you cannot misrepresent a contract assignment as a brokered sale, and the CREC has issued cease-and-desists to operators doing buyer-list-driven wholesaling without a license. There is no Colorado equivalent of the Texas TREC wholesaler rule yet, but several recent CREC enforcement actions establish the line.

What AcreOS has: the persona registry knows "wholesaler" exists (`server/services/contextProfile.ts:99`), the atlas-context injector tells the AI to talk to wholesalers about ARV and assignment fees, and `complianceGuardian` ships rules for sale-side disclosures. **There is no CO-specific wholesaler-licensing warning, no CREC rule reference, no "are you marketing the property or your equitable interest" language check.** A new operator could run AcreOS at full throttle in CO and walk into a CREC complaint without seeing a single warning from the platform.

What I need: a state-aware compliance gate that, when the user is in CO and the persona is wholesaler/land flipper, shows the CREC line on the marketing surface (campaigns, listings, SMS templates), and flags language patterns that look like brokerage ("for sale by ABC Properties at $45K") versus equitable-interest marketing ("I have a parcel under contract — closing 6/15 — assignable interest available"). Three rule lints. One legal review. Ship it.

The same module should warn that **Colorado Senate Bill 22-099** changed the licensing landscape for assignors and that an assignment fee structure with multiple intermediate parties needs a real attorney review, not an AI nod.

### **(6) Off-grid / cabin culture — buyers pay premium for "remote-ready."**

In the SLV, in the Sangre foothills, in Trinchera, on the eastern slope of the Spanish Peaks — buyers are looking for off-grid-capable land. They want to know: solar exposure (south-facing slope vs. north), road in winter (county-maintained vs. owner-maintained vs. seasonal), well permit potential (exempt domestic well allowed for parcels ≥35 acres in some basins, prohibited in others), septic feasibility, RV-temporary-occupancy allowed by county code, cell coverage, fire-protection district. A 35-acre piece with year-round access, exempt well rights, southern exposure, and Costilla county's relatively permissive RV occupancy rules is worth a 30-50% premium over the same acreage with the wrong answers on those four questions.

What AcreOS has: utilities-info JSONB (electric/water/sewer/gas/internet) on the DD checklist. Generic. The onboarding sample copy uses "off-grid" once: "Stunning 10 acre mountain property with Pikes Peak views. Perfect for off-grid living." That's a marketing string, not a feature.

What I need: an "Off-grid feasibility score" surface — not an AI score, a deterministic rubric — that combines:
- South-facing slope percentage (computed from USGS topo + aspect — already accessible via the existing layer infrastructure)
- Distance to nearest paved road and county-maintained-road status
- Domestic-well permit eligibility (basin-by-basin: Closed Basin in SLV requires augmentation; Rio Grande basin allows exempt wells under conditions)
- Septic feasibility from soil percolation data (the `dataIntelligenceEngine` already pulls SSURGO septic_suitability — surface it)
- County RV-occupancy rules (Costilla allows extended RV occupancy with permit; many CO counties don't)
- Fire-protection district coverage (insurance-relevant for any future structure)
- Cell coverage (FCC broadband map is public)

Six inputs, deterministic rubric, score 0-100, color-coded card on the parcel page. **The single most-asked question in CO land sales has a checkbox-to-existing-data answer.** Build it.

### **(7) CO Seller's Property Disclosure — the form is real.**

Colorado has an REC-promulgated SPD form (Seller's Property Disclosure — Land), revised periodically, and the seller is expected to fill it out for any residential land sale. Form fields include water source/right, sewer/septic, mineral severance acknowledgment, easements, environmental, HOA/POA, special districts, and (in 2023's revision) a wildfire-risk disclosure section. State-documents page already has a CO row with deed type, lien instrument, etc. — but **the disclosure form itself is not a generated artifact in the documents module.**

What AcreOS has: state-documents.tsx includes a CO entry. stateDocumentConfig.ts has the deed/title side handled. The documents module ships a strong HMAC-link signing flow.

What I need: the CREC-promulgated SPD-19-10-11 (or whatever the current rev) loaded as a template, merge-fielded to property data, prefilled where possible (HOA known? auto-fill from `hoaInfo`. Mineral severance from titleChain? pre-flag "yes — see exhibit"), surfaced as a required artifact in the listing flow for any CO-state property. Ship the same for the SPD-Improved if the property has a structure (rare for me but real for the cabin-on-acreage subset).

Adjacent ask: source-of-water disclosure (statutorily required separately for any rural CO sale where water is anything other than municipal) is its own form. Bake it.

---

## 3. Per-surface friction (CO-specific)

**`/regulatory-intel`** — Loaded the page expecting CO. Got TX/FL/GA/NC/TN/AL/MS/AR/MO/OK. **My state is not in the dropdown.** The page renders a "select a state" prompt and offers ten that aren't mine. This is a one-PR fix — add a CO entry to the `stateProfiles` array in `server/services/regulatoryIntelligence.ts` with `waterRightsSystem: "prior_appropriation"`, `requiredDisclosures: ["spd_land", "source_of_water", "mineral_rights", "lead_paint"]`, and `practitionerNotes` that mention HOA-heavy SLV subdivisions, conservation-easement tax credits, and CREC scrutiny on wholesaling. Until that lands, the entire regulatory intelligence surface is dead for me.

**`/state-documents`** — CO is here, but the JSON is incomplete. The transferTaxPercent is `0.01` which is nominal — accurate that there's effectively no state transfer tax — but the documentary fee at the county level is real and varies. The lien instrument "Deed of Trust" is correct. **The seven CO-specific disclosure forms are not surfaced anywhere.**

**`/zoning-lookup`** — Useful for ag and rural-residential categorization, but my counties have such permissive zoning at the rural level that the more useful lookup is **subdivision covenants**, which the page doesn't address. Zoning ≠ POA in CO; the POA is the harder constraint by far.

**`/title-search`** — The title chain service knows about mineral_rights exceptions. **It does not surface CO water-rights decree numbers as a chain entity, which they should be** — a senior water right is a separately recorded property interest in CO and belongs in the chain.

**`/blind-offer-wizard`** — Runs without a CO water-rights or POA dues input. My offers in Forbes Park need to be net of $940/yr POA dues × my expected hold period. That math is missing.

**`/avm`** — Generic comp-based. Does not adjust for: (a) POA membership downward, (b) senior water right upward, (c) conservation easement encumbrance, (d) off-grid-feasibility premium, (e) mineral-severance discount. Five CO-specific adjustments, all absent. The CO comp universe is small enough — I have maybe 80 useful comps in Costilla in any 12-month window — that **without those adjustments the AVM is wrong by 20%+ on most of my deals.**

**`/parcels/:id`** — Costilla and Las Animas live ArcGIS feeds work. The parcel detail surfaces fine. The "neighbors" view is useful for skip-trace targeting. **No POA membership badge. No water-right card. No easement card. No off-grid score.** It's a generic parcel page on a CO parcel — my parcel-screening workflow is faster on Beacon today.

**`/founder` surfaces / Pax** — I do not need an AI assistant guessing about whether Wild Horse Mesa has an active Architectural Review Committee. I need the platform to know Wild Horse Mesa has an ARC, what they require, and who chairs it this year. Deterministic data, not generative inference. **Pax should be off-by-default for CO compliance work** until the underlying data layer supports it.

---

## 4. The data-model gap, in plain words

CO land has four orthogonal property interests on every parcel: **surface, minerals, water, covenants.** Each is separately recordable, separately transferrable, separately valued. The current property model treats the parcel as one fungible thing with a JSONB on the side for HOA. **The fix is four lookup tables** — `mineralInterests`, `waterRights`, `poaMemberships`, `conservationEasements` — each FK'd back to property, each with a "verifiedAt" timestamp and a source URL. Wire them to the COGCC, CDSS HydroBase, county clerk record search, and a hand-curated POA library. That's the spine. The blind-offer wizard, the AVM, the DD report, the listing page, and the disclosure-form generator all read from the spine. Eight to twelve weeks for one engineer + one researcher who knows CO land. The CO-specific researcher matters more than the engineer.

---

## 5. Three things AcreOS has built that I'd actually use today

1. **Costilla / Las Animas / Saguache live ArcGIS parcel feeds.** Nobody else has this. Beacon doesn't cover Costilla cleanly. PropStream's CO tax data is stale by 6-9 months. **A live county-GIS layer for the SLV is, by itself, worth the Starter price.** Make sure this doesn't break — those endpoints rotate URLs every couple years, and the `notes` field doesn't say when they were last verified.
2. **HMAC-link signing.** I do 30-50 purchase agreements a year on lots that don't justify a full title company until the closing. The HMAC public-signer flow with audit row, signer order, and expiry is genuinely good. I'd cancel SignNow and route everything through this. It's an annual savings of $360 right there.
3. **Parcel-discovery + market-pulse loop.** The deal-feed engine flags Costilla. The market-pulse engine flags Costilla. The county-assessor ingest job prioritizes Costilla. **For the buy side, AcreOS in CO is at least as good as PropStream + LandWatch combined, at half the price.** I'd run it in parallel and probably consolidate within six months.

---

## 6. The deal-killer

**No CO state profile in regulatory-intel + no POA layer + no water-rights model.**

Three fixes. Until those three exist, the rest of the platform — the AI tier, the founder dashboard, the campaigns, the marketplace — is decoration. Add them in this order:

1. **Add CO to `regulatoryIntelligence.ts`.** One PR. Half a day with a CO real-estate attorney to review the JSON. Unblocks every downstream surface that branches on state.
2. **Ship the POA library.** One researcher, two weeks, top 30 SLV subdivisions. Wire to property polygon-intersection. Surface as a card on `/parcels/:id`.
3. **Wire CDSS for water rights.** Two weeks for one engineer. APN/section lookup → adjudicated rights list with priority dates and decree numbers.

After those three, the conservation-easement layer, the off-grid score, the CREC compliance gate, and the SPD-form generator are each one-to-two-week additions on top of the same spine.

If you ship those, I'm a Pro subscriber for three years and I'll bring you the eight other CO operators I know in the valley. The CO Land Investor cohort is small — maybe 200-400 active operators across the southern half of the state — but we are loud and we talk to each other constantly. Whoever ships the SLV-shaped product owns the segment. Today, nobody has shipped it. **You are 60% closer than anybody else and you don't know it.**

One more thing. Please do not solve any of this with an AI summarization layer. I do not want an LLM telling me whether Forbes Park allows yurts. I want the Forbes Park Filing 6 Declaration of Covenants, recorded book/page, parsed once by a human, stored as data, surfaced as data. The covenants don't change often. Index them like reference data, not like prompts. The buyers I sell to are paying real money based on what your platform tells them — generative confidence levels are not a substitute for verified covenant text.

— Bryce McAllister
   Land Investor, Costilla / Las Animas / Saguache / Huerfano counties, CO
