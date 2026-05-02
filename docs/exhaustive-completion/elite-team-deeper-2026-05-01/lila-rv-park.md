# Lila Romanov — AcreOS, the RV-park developer's lens

I'm Lila. Forty-six. Sarasota. I buy 10-50 acres in Florida, Arizona, and Texas, push it through rezone and entitlements, design out 100-300 RV sites, pour the pads, drop the septic system, and either sell the stabilized park to Sun Communities / ELS / KOA-Holiday at a 6.5-7.5 cap or hold for cash flow. Deal sizes run $400K-$3M on the buy side, $4M-$22M on the exit. I have a civil engineer on retainer in Tampa, a land-use attorney in Phoenix, and a hurricane-insurance broker who is the only reason I sleep through August.

I came to this audit because Thomas asked me to. The honest read is that AcreOS is a beautiful piece of software for somebody who is *not* me. It is built for the buy-and-flip-or-owner-finance raw-land operator, and the system itself says so out loud — `server/routes-deals.ts:654` literally instructs the AI: *"a platform for LAND investors (vacant rural/raw land — not houses, not commercial)."* I am the third thing. I am the gap between raw land and built real estate, and that gap is where the money actually is.

---

## 1. Thirty-second verdict

Useful as a *deal-sourcing and acquisition* tool through entitlement award. Useless as a *project-development* tool from groundbreaking through stabilization. If AcreOS positions itself as the front of the funnel and integrates with construction-management software (Procore, Buildertrend) on the back, I'd pay the top tier and run my acquisition pipeline through it. If AcreOS pretends it can carry me from raw dirt to a stabilized 200-pad park, I will lose money trusting it.

Trial on Pro at $49 to manage my acquisition pipeline. Will not pay $79 Scale until there is a development module. Will pay $199/mo for an "RV-park / mixed-use development" tier with what I list in §5.

---

## 2. Daily-use walkthrough — Tuesday in Sarasota

**6:30 AM.** Coffee on the lanai. I open `/today` on the iPad. The Pulse score and the agent feed are pretty. None of it is for me. My morning question is *"did the Sarasota County planning department reply to my pre-app request for the Myakka City parcel?"* There is no entitlements queue. There is no "permit / variance / rezone status" lane in the deal Kanban. AcreOS thinks the only deal lifecycle is *lead → offer → contract → close → owner-finance.* My lifecycle is *lead → offer → contract → close → entitlement → engineering → permit → vertical → stabilize → exit.* The platform does not even acknowledge the back half exists.

**8:00 AM.** New lead — 28 acres in DeSoto County, currently zoned A-10 (agricultural, 10-acre minimum). A broker thinks it can be rezoned to allow an RV park. I drop the parcel into AcreOS. The DD checklist runs. It tells me about flood zone (good — `routes-micro-features.ts:399` proxies FEMA NFHL, that's table stakes done correctly), wetlands, soils, ag valuation. It does **not** tell me:
- The county's RV-park ordinance (FL counties vary wildly — Charlotte and Lee allow it under PD overlays; Sarasota is hostile; DeSoto is the sweet spot).
- Whether the parcel is in a Coastal High Hazard Area (CHHA) — which kills RV-park feasibility in Florida because the state won't let you put residential structures there post-Andrew.
- Whether the parcel is inside a wind-borne debris region (most of FL south of I-4 is) — drives shelter requirements and insurance premium.
- The FDOT access-management classification for the abutting road — drives whether I can even put a driveway in.

The zoning service (`server/services/zoningService.ts`) returns a category enum that has *agricultural, residential, commercial, industrial, mixed, open_space, unknown.* There is no `recreation` or `campground` or `mobile_home_park` category. My entire asset class is invisible to AcreOS's zoning brain.

**10:30 AM.** Pre-app prep. My civil engineer wants soil percolation test results, FEMA elevation, and a wetlands jurisdictional determination before he'll quote me on septic design. AcreOS surfaces FEMA flood zone and (per `routes-data-intelligence.ts`) a "parcel intelligence report" with EPA + soil + USDA. Good — but soil-survey USDA data at 2.5-acre resolution is **useless for septic design.** The state of Florida (Ch. 64E-6 F.A.C.) requires site-specific perc tests. AcreOS could partner with a soil-testing dispatch service the way it dispatches title companies. Doesn't.

**11:30 AM.** Underwriting. I open `/deal-underwriting`. It runs a wholesale / owner-finance / retail exit comparison (`server/services/dealUnderwriting.ts:140-160`). Wholesale at 85% of purchase price. Owner finance at 9.9% / 120 months / 20% down. Retail full market. **None of these are my exit.** My exit is *stabilized RV park sold to a strategic buyer at a cap rate against trailing-12 NOI.* The math is:

- 200 pads × $42/night avg × 65% occupancy × 365 = $1.99M gross rev/yr
- Less ~42% operating expense ratio (utilities-passthrough adjusted) = $1.15M NOI
- Cap at 6.75% (Sun Communities tier) = $17M exit
- Less $5.5M dev cost, less $850K land basis, less $1.4M carry = ~$9M profit, IRR 28%-ish over 36 months

AcreOS's underwriter cannot model any of this. There is no "stabilized NOI / cap rate" exit branch. There is no "operator buyer" type in the buyer network — `client/src/pages/buyer-network.tsx` is built for retail land buyers and 1031 investors, not Sun-tier institutional acquirers with 90-day rep-and-warranty diligence.

**1:00 PM.** Capex modeling. I need: pad construction ($8K-$18K per pad), septic system (~$1.5K-$3K per pad in FL coastal soils), water hookup, electric ($3K-$5K per pad for 30/50 amp pedestal), roads (5%-8% of gross), amenity building, pool, laundry, dump station. There is no construction budget surface in AcreOS. The closest thing is the holding-cost field in the underwriter, which assumes monthly tax + insurance — nothing about construction-period interest, draws, retainage, contingency. **Procore handles this; AcreOS doesn't pretend to.** Fine — but then say so explicitly so I don't waste a Saturday trying.

**3:00 PM.** Florida disclosures. Closing on a 22-acre tract in Charlotte County. AcreOS knows Florida is a two-witness deed state (`stateDocumentConfig.ts:178`) — that's correct and a lot of platforms get it wrong. Good. What it doesn't surface:
- **Coastal Construction Control Line (CCCL)** — Fla. Stat. § 161.053 — disclosure if applicable. Material for any FL coastal land deal.
- **Florida Building Code wind-zone designation** — material for any future structure.
- **Sinkhole disclosure** — Fla. Stat. § 627.7073 — Florida-specific, applies to insured property.
- **Property tax cap (Save Our Homes / 10% non-homestead)** — § 193.155, § 193.1554 — drives buyer's carry math.
- **Documentary stamp tax** is in the config at $0.70/$100 — correct. Good.

The pattern is the same as Cesar found in Texas: AcreOS *names* the state-specific compliance landscape but doesn't *generate the documents.*

**4:30 PM.** Hurricane insurance. My broker quotes me $48K/year on the stabilized park. AcreOS has no insurance-cost line item that scales with wind zone, distance to coast, or aggregate replacement value. The carrying-cost field treats insurance as a flat percent. In Florida that's wrong by an order of magnitude; in Arizona it's wrong the other direction. I'd want a state+county+wind-zone insurance estimator wired to a parametric model. Nobody else has this either, but if AcreOS shipped it, I'd switch from my current spreadsheet immediately.

**6:00 PM.** Exit-buyer pipeline. My buyers are Sun Communities (NYSE: SUI), Equity LifeStyle (NYSE: ELS), Roberts Resorts, Northgate Resorts, Blue Water Development, plus a long tail of regional roll-ups. They have *acquisition criteria pages* on their websites — minimum pad count, minimum NOI, geographic boxes, age of asset. AcreOS's buyer-network is set up for retail land buyers and the 1031 desk. There is no surface where I can register that my exit buyer pool is ten institutional names with 1099-K-scale check sizes and a 60-day diligence cycle.

**9:00 PM.** I close the iPad. I have written down on a yellow legal pad all the things AcreOS could not do for me. The yellow legal pad is full.

---

## 3. The RV-park-development test — what passed, what didn't

**Pass:**
- FEMA flood-zone API integration (`routes-micro-features.ts:399`) — table stakes done right.
- Wetlands / NWI / EPA / USDA soil enrichment — useful at the screening stage.
- FL state config knows two-witness rule, doc stamp tax, mortgage (not deed-of-trust) state.
- Zoning lookup via Zoneomics with ATTOM fallback — gives me a starting point even if the categorizer is too narrow.
- The deal pipeline + parcel surfaces are clean enough to manage acquisition through closing.

**Fail or Missing:**
- **No "recreation / campground / mobile_home_park / RV_park" zoning category.** The categorizer in `zoningService.ts` will misroute any RV-relevant code into `unknown` or `commercial`.
- **No entitlements / rezone / variance status tracking.** A multi-month process with milestones (pre-app, neighborhood meeting, P&Z hearing, BOCC vote, conditions of approval, building permit) that AcreOS has zero awareness of.
- **No development-cost / capex / draw-schedule module.** Pad cost, septic, utilities, roads, amenities — none of it modeled.
- **No stabilized-NOI / cap-rate exit path** in the underwriter. Only wholesale, owner-finance, retail.
- **No institutional / strategic-buyer profile** in the buyer network. My exit pool is invisible.
- **No CCCL / wind-zone / sinkhole / surge-zone disclosure surfaces** for Florida.
- **No insurance-cost estimator** scaled to wind zone or aggregate insured value.
- **No septic-design / perc-test dispatch.** Could be a provider integration. Isn't.
- **No FDOT (or state DOT) access-management / driveway-permit awareness.** Without a permitted driveway, the parcel is worthless to me.
- **No operating-expense-ratio benchmarking** by asset class. The underwriter holding-cost model is built for raw-land carry, not stabilized operations.
- **No "land + light development" concept.** AcreOS is binary: raw land or nothing. There is a real, large market in *entitled-and-engineered land sold to operators* — the play I make most often.

Net: AcreOS understands the *land* side of my acquisition. It is silent from the moment I take title forward.

---

## 4. Per-surface friction (RV-park developer)

**`/parcels/:id`** — Best surface, like everyone keeps saying. For me, add: zoning *with overlay districts and PD eligibility*, CCCL, wind zone, surge zone (Cat 1-5 SLOSH), distance to coast, FDOT access classification, county RV-park ordinance link, perc-test result attachments, wetlands JD attachment.

**`/deal-underwriting`** — Add a fourth exit: *develop-and-sell to operator at cap rate.* Inputs: pad count, ADR, occupancy ramp curve, OpEx ratio, target cap rate, dev cost, dev timeline. Output: levered IRR, peak equity, sensitivity grid (cap rate × occupancy).

**`/buyer-network`** — Add an "institutional / strategic" buyer type. Pre-seed with the dozen public and private RV-park / MH-park acquirers and their stated criteria. When my project hits stabilization, auto-match.

**`/documents`** — Florida-specific disclosure pack: CCCL, sinkhole, property-tax-cap, doc-stamp computation worksheet, two-witness deed template (already correct), and the FL FAR-9 "Vacant Land Contract" form.

**`/onboarding`** — When I select "developer" or "RV park" as my asset focus, gate me into a different pipeline template with entitlement / engineering / permit / vertical / stabilize stages.

**`/finance`** — My financing isn't seller-financed notes. It's construction-to-perm with a regional bank, plus a preferred-equity layer. AcreOS has no surface for either.

**`/field-scout`** — Brilliant for site walks. Add: *septic perc-test photo log with GPS pin and depth annotation,* and *driveway-sightline photo capture* with a ruler overlay for FDOT submittal.

**`/pricing`** — There is no developer tier. There should be a $199/mo "Developer" tier with the entitlement tracker, capex module, institutional-buyer network, and disclosure pack.

---

## 5. What's missing for the developer segment — in priority order

1. **Entitlement / permit tracker.** A first-class surface, not a bolt-on Kanban. Stages: pre-app, traffic study, neighborhood meeting, P&Z, BOCC, conditions of approval, building permit, certificate of occupancy. With per-stage document attachments and a per-county playbook.
2. **Stabilized-NOI exit branch in the underwriter.** With cap-rate compression / expansion sensitivity and a 36-month dev-and-stabilize cash flow.
3. **Capex / draw-schedule module.** Pad, septic, utilities, roads, amenity. Tied to construction loan draw requests.
4. **Institutional-buyer pipeline.** Sun, ELS, Roberts, Northgate, Blue Water, plus regional. Match on pad count + state + NOI threshold + asset age.
5. **Florida hurricane / coastal disclosure pack.** CCCL, sinkhole, wind zone, surge zone, doc-stamp worksheet, FL FAR-9 land contract.
6. **RV-park / mobile-home-park / campground zoning categorizer.** Add a `recreation` or `mhp` enum to `zoningService.ts` and teach it the codes (e.g., FL "PD-RV", AZ "C-3-RV", TX SUP overlays).
7. **Insurance-cost estimator.** State + county + wind zone + aggregate insured value → annual premium estimate. Calibrate against three FL carriers and one E&S broker.
8. **Septic / perc-test dispatch as a provider integration.** Same pattern as title-co dispatch: I click, somebody is on-site within a week, results are in the parcel record.
9. **Construction-management bridge.** Don't rebuild Procore. Push milestones into Procore via API; pull invoices back. Same pattern as the QuickBooks bridge for bookkeeping.

---

## 6. Pricing reaction (developer math)

I do 2-4 deals/year. Each deal is $400K-$3M land basis, $2M-$8M total project cost, $4M-$22M exit. My current annual stack:

- LandGlide / Regrid: $300/yr
- ArcGIS subscription: $700/yr
- Procore: $9,200/yr
- Buildertrend: not used (Procore wins)
- LoopNet / CoStar: $14,400/yr (the brutal one — but how I find listings)
- Insurance broker time-share: ~$3,000/yr equivalent
- Civil engineering: per-deal, ~$45K-$80K, not subscription
- Spreadsheets and a paralegal at $48/hr part-time: ~$22,000/yr
- Survey + title: per-deal

Total *subscription* spend: ~$30K/yr. AcreOS at $79 Scale doesn't move the needle. AcreOS at a $199 "Developer" tier with the nine items in §5 would replace ~$8K-$12K of my stack and save ~120 hours/year of spreadsheet time. Easy yes.

The catch: even at $199, AcreOS has to ship at least five of the nine to earn it. Two of nine and I keep my spreadsheets.

---

## 7. The deal-killer

For the developer segment specifically: **the platform doesn't acknowledge the segment exists.** Read `server/routes-deals.ts:654` again — *"a platform for LAND investors (vacant rural/raw land — not houses, not commercial)."* I am the in-between. I am not raw-land-and-flip and I am not commercial. I'm *raw-land-becomes-commercial-via-entitlement-and-engineering,* and that's the category AcreOS pretends doesn't exist.

That's the strategic deal-killer. The tactical deal-killer is the underwriter: if I cannot model a stabilized-NOI cap-rate exit, I cannot run a deal in AcreOS, full stop. Wholesale and owner-finance are not relevant to a project that will take 24-36 months of vertical construction before it has a CO.

For Florida specifically: **CCCL + wind zone + surge zone awareness.** A platform that pulls FEMA flood data but not CCCL is a platform that is going to get a Florida customer named in a buyer's-disclosure suit. That's not theoretical — that's *Sunshine State of Affairs LLC v. Smith,* a half-dozen variations a year. The same statute-cite-but-no-document gap Cesar found in Texas applies here.

The honest path forward: **build a `/development` mode** behind a feature flag, with the entitlement tracker + capex module + cap-rate exit + institutional-buyer pipeline as the four pillars. Charge $199 for it. Sell it to the 200-300 RV-park / MHP / storage / agritourism developers who are *already on AcreOS for the acquisition phase* and currently jump out to spreadsheets when the dirt actually starts moving.

Until then: I'd run AcreOS as my *acquisition CRM* through closing day. After that I go to Procore and Excel like everyone else. That's a real product — but it's not the all-in-one Thomas talks about, and pricing should reflect that honesty.

— Lila
