# Sebastian Knox — AcreOS, the self-storage-land lens

I'm Sebastian. Fifty-three. Charlotte. I don't do recreational, I don't do rural, I don't do hunting tracts. I buy 2-to-5-acre infill parcels in Sun Belt growth corridors — Charlotte, Greenville, Raleigh-Durham, Charleston, Nashville exurbs — hold them eighteen to thirty-six months while I cook the entitlement, and sell to a self-storage developer. Public Storage. Extra Space. CubeSmart. U-Haul Real Estate when they're hungry. Deals run $200K on the small end and $1M when I find a corner pad on a six-lane arterial. I read what the Texas guy and the California operator wrote. They're testing the platform on raw-land dirt. I'm here to test it on something different — *light commercial / land-with-a-thesis* — because the self-storage flip is neither raw-land flipping nor full development, and I want to see whether AcreOS understands the gap.

---

## 1. Thirty-second verdict

AcreOS is built for raw-land flippers and note investors. The seven `InvestorType` buckets in `server/services/contextProfile.ts:30` are: wholesaler, note_investor, fix_and_flip, portfolio_builder, auction_hunter, developer, new_investor. There is no `commercial_land_specialist`. There is no `self_storage`, no `pad_site`, no `infill_commercial`. The onboarding bridge at line 47 maps every commercial-leaning business type — `commercial`, `multifamily`, `mobile_home` — to `portfolio_builder`. That's wrong for me. I'm not a portfolio builder; I have nine parcels at any given time and I want them gone in two years. I'm a *thesis-driven flipper with a 24-month horizon and a developer Rolodex.* That's a real archetype, and it's invisible to AcreOS today.

The closest fit is `developer`, which gives me Vision AI, Compliance AI, AVM, Market Intelligence (`contextProfile.ts:174`). Better than nothing. But "developer" in AcreOS means the guy who entitles 50-lot subdivisions. I'm a *land-banker for someone else's vertical build.* Different business.

Trial it on Pro at $49. Not Scale. Won't replace my stack — CoStar, Placer.ai, ParkSitter, plus an Excel-based demand-shed model my analyst built — but the parcel surface is genuinely the best I've seen in any land tool, and the entitlement-tracking gaps are fixable.

---

## 2. Daily-use walkthrough — Wednesday in Concord

**7:00 AM.** Driving the I-485 outer loop east of Charlotte looking at a 3.4-acre corner I've had under contract for eleven months. AcreOS `/today` opens. Pulse score is fine, but my real morning question is: *did anything change on my nine entitled-or-entitling parcels overnight?* Specifically: did any city council or planning commission post an agenda that touches my zoning case, did a competing storage facility just file a permit within three miles of my pad, did a developer in my buyer Rolodex publicly announce their 2026 acquisition target. **None of that is on the dashboard.** I'd build a `storage_specialist` widget pack: pending entitlement cases (with next hearing date), competitive supply alerts within radius, and "developer announcements" pulling from REIT 10-Q filings. None of these widgets exist in `INVESTOR_CONFIGS`.

**8:30 AM.** Pull up the Concord parcel — `/parcels/:id`. The Texas guy was right, this is the best surface in the platform. For me the load-bearing fields would be: highway frontage type and width, AADT (annual average daily traffic) count, signal access (Y/N), curb cut count, demand-shed metrics (population per existing storage SF within 3-mile and 5-mile radii). AcreOS pulls *some* of this. `dueDiligenceEngine.ts:459` queries OpenStreetMap for road type and ranks by hierarchy. Good. `data-source-broker.ts:1107` queries the National Highway Planning Network. Good. **What's missing: AADT.** I checked — there's no traffic-count integration. State DOTs publish AADT (NCDOT, SCDOT, GADOT, etc., all have public ArcGIS endpoints). For self-storage, AADT is the single most predictive variable for site value after demographics. *A storage developer will not pay premium for a pad with AADT under 15,000.* AcreOS should pull state DOT AADT layers and surface the count + the trend. Without it, my parcel detail is missing half its valuation logic.

**9:45 AM.** Demand-shed analysis. This is the test — can AcreOS compute *population per existing self-storage square foot* in a 3-mile radius? That ratio is my entire thesis. National average is roughly 6 SF per capita; under-supplied markets are at 3-4 SF and that's where I buy. I can't find a single function in `dataIntelligenceEngine.ts` or `dealUnderwriting.ts` that knows storage exists as a use type. `populationTrend5yr` exists at line 592. Population is there. But there's no inventory of competing storage square footage, no scrape of SpareFoot or SiteLink, no integration with SSA's quarterly supply data. **For a storage-land investor this is the deal-killing analytical gap.** Without demand-shed math, AcreOS is a parcel viewer with a pretty UI; my Excel model with a hand-curated competitor list is still indispensable.

The tell: the platform's `notes` strings inside `dataIntelligenceEngine.ts:276` literally say "Zoning determines buyer pool. Residential = broadest market. AG-5 = niche." That sentence reveals the worldview — buyer pool is graded by *zoning generality,* not by *vertical-buyer thesis.* For me an I-1 lot in a 4 SF/capita demand shed in Mooresville isn't "niche" — it's the most liquid commercial-pad I'll touch all year, because storage REITs are sitting on $9B of dry powder and I have eight phone numbers that all return calls.

**11:00 AM.** Zoning. The Concord parcel is currently I-1 light industrial, which is exactly what self-storage developers want — they want by-right or with a special-use permit, *not* a rezoning. `server/services/zoningService.ts` recognizes industrial (line 38). It marks industrial as `developmentPotential: "high"` (line 73). That's correct. But it doesn't tell me whether self-storage is a *permitted use* under I-1 in Concord NC specifically. The `permittedUses: zone.permitted_uses` field exists in the Zoneomics schema (line 67) — does the integration actually populate it? I'd want a "is self-storage permitted by-right / by SUP / not permitted" trinary on every parcel detail page. Concord zoning code says self-storage is permitted by SUP in I-1. Charlotte UDO calls it "personal storage facility" in CG and IC districts. *Every county codes it differently.* AcreOS should normalize this.

**12:30 PM.** Buyer match. I have a 4.1-acre pad in Mooresville under LOI, ready to flip. `server/services/buyerNetwork.ts` exists. I look at how buyer matching works — `buyerNetwork.ts:346` segments by `criteria.minAcres < 5 && criteria.maxPrice < 100000` (small recreational) versus `criteria.minAcres > 20` (income properties) versus `criteria.features?.includes('hunting')`. **Self-storage developer buyer profile: 2-5 acres, $200K-$1.5M, must have AADT and visibility, must have utility availability, must be in MSA with population > 50K within 3 miles.** That profile isn't expressible in the current criteria schema. I'd extend `searchCriteria` to include `useType` (self-storage, RV park, fast food pad, gas station, multifamily pad, industrial outdoor storage). Then a developer buyer signs in, ticks "self-storage," and my Mooresville pad surfaces.

**1:00 PM.** Sanity check on the I-1 zoning. Concord's UDO requires SUP for self-storage in I-1 because of historical concerns about facility appearance on industrial-arterial corridors. Cabarrus County's planning commission has approved 4 of the last 5 storage SUP applications since 2023; one was denied for lack of vegetative buffer to a residential parcel 80 feet to the south. I track this in a homemade spreadsheet of approval rates per jurisdiction. AcreOS could publish jurisdictional approval-rate stats — "Cabarrus County has approved 80% of storage SUPs since 2020, with median time-to-approval of 94 days" — and that single sentence would change which deals I underwrite. The data exists in public meeting minutes and case dockets; it requires scraping and normalization, but the moat once built is significant.

**1:30 PM.** I build the comp set. AcreOS `comps.ts` exists. I need *land comps for self-storage pad sales,* not residential land comps and not improved-storage-facility comps. Two completely different transaction sets. Storage-pad land transactions are public records but require filtering by buyer entity (Public Storage's deed name, Extra Space's "Storage of America LLC," CubeSmart's various SPVs). AcreOS could publish a curated list of self-storage REIT acquisition entities and let me filter recent county recordings by grantee. That would be a killer feature. I haven't built it; I'd pay for it.

**2:30 PM.** Entitlement tracking. The Concord parcel is at SUP application stage — I filed in February, planning commission in June, city council vote in July. AcreOS has nothing for tracking municipal cases. `compliance.tsx` page exists; I haven't dug in, but I doubt it tracks "next planning hearing date for case Z-2026-014." This is where I lose months and money — when I miss a continuance and have to refile. I'd want a `/parcels/:id/entitlement` tab with: case number, current status (intake → staff review → public hearing → council → recorded), next milestone date, supporting documents, opposition tracker (neighbors who showed up to oppose). Today this is in three Excel tabs and a Google Calendar.

**3:30 PM.** Hold-period economics. AcreOS `dealUnderwriting.ts` has hold-period logic. Line 175: "Extended hold period increases carrying cost risk" if `holdMonths > 18`. **For me, 18-month hold is the *floor,* not a risk flag.** My median hold is 26 months. The risk-warning logic doesn't fit my thesis — I expect to pay carry for two years. I'd want the underwriter to accept a `targetHoldMonths` input from my investor profile and adjust the IRR math accordingly, not blanket-flag anything over 18 months as "risky." The current logic is calibrated for wholesalers and short-flippers.

**4:30 PM.** Sale-leaseback structure. On one of my Charleston parcels I'm doing something funky — selling the dirt to the developer but keeping a 30-year ground lease. I get paid both ways: a one-time land sale and an ongoing ground rent that escalates with CPI. AcreOS `landCredit.ts:917` mentions ground leases ("cell tower ground leases") in passing as an income strategy, but there's no surface for *ground lease as a deal exit* in the underwriting flow. The note ledger is built around mortgage notes, not ground rent. If I want AcreOS to track $4,200/month ground rent escalating 2%/year for 30 years on a parcel I've sold, the closest fit is recording it as a "note" — and it's not a note, it's a leasehold income stream. This is a real gap for any commercial land specialist.

**5:00 PM.** Tax basis on a sale-leaseback. My CPA splits the transaction: portion attributable to the fee sale recognizes gain at closing; portion attributable to the retained leasehold is treated as ongoing rental income. The cost-basis tracker at `costBasisTracker.ts:134` saves a single `dispositionDate` and `dispositionPrice` per parcel — there's no support for partial dispositions or for retaining a residual interest. If I dispose of fee for $640K but retain a leasehold worth ~$800K NPV, AcreOS records "$640K disposition" and forgets the rest. By year-end my P&L is wrong. This is a bigger deal than it looks: it means AcreOS as currently shipped *cannot* book the most lucrative deal structure available to a storage-land specialist.

**5:45 PM.** AcreOS bias check. The Texas guy noted the platform "knows Texas exists." For me the question is whether the platform *knows commercial-pad land exists.* The bias I see all over the codebase: `autonomyBootstrap.ts:269` quotes "Properties with road frontage sell 30-40% faster than landlocked parcels" — true for recreational, irrelevant for me (every storage pad has frontage; AcreOS shouldn't celebrate it as a feature, it should *measure the kind of frontage*). `executive.ts:209` writes "Sweet spot counties: rural recreational, Sun Belt growth corridors, hunting/agriculture states" — Sun Belt growth corridors are mine, but the framing assumes I want them for hunting tracts. The platform's *narrative voice* is built around the dirt-flipper. The data layer is more flexible than the narrative.

**6:00 PM.** Disposition outreach. I have eight active developer relationships — three at Public Storage acquisitions, two at Extra Space, two at CubeSmart, one at U-Haul. Plus three regional players (Storage Asset Management, Prime Storage Group, Andover Properties). AcreOS has CRM-style buyer tracking via `buyerNetwork.ts`, but the *trust score* logic at `investorNetworkService.ts:54` is built around peer investors trading wholesale tickets — not around B2B relationships with corporate acquisitions teams who don't sign up for AcreOS. I don't need a trust score for the VP of acquisitions at Public Storage; I need a CRM with their last-deal-date, their submarket preferences, their cap-rate threshold, and their internal approval cycle (PS takes 90-120 days; ES takes 60-90; CubeSmart takes 45). The platform doesn't model corporate-buyer pipelines.

**7:15 PM.** Specialization framing. The marketing says "Land Investor with a niche." The product surfaces tell a different story. There's a `paxPersona.ts` file at line 62 referring to "entitlement + subdivision + infill — zoning, permit timelines, subdivision yield, horizontal development" as a Pax vertical-context block. Good — the system clearly understands a vertical specialist *can* exist. But it's stuck on subdivision development. Self-storage land specialist isn't subdivision; it's a single-pad vertical-buyer arbitrage with a 24-month entitlement clock. RV park specialist isn't subdivision; it's a 10-50 acre play with utility-of-stay buyers (Sun Country, Equity LifeStyle, Carefree). Cell tower / billboard specialist isn't subdivision; it's a sub-acre fee-strip with a SBA Communications or Crown Castle counterparty. *Each one of these is a real archetype with a real buyer Rolodex.* AcreOS has the architectural pattern for it (`paxPersona.ts`, `INVESTOR_CONFIGS`, `dashboardWidgets`). It just hasn't been used for anything but the wholesaler/note/developer trio.

**8:00 PM.** Re-read the `customerNarrative.ts` flow. Line 452: `getOrgInvestorType(s.organizationId)` — the system fetches an investor type per org. Line 477: that type goes into Pax's customer narrative as `verticalBlock`. Wired correctly. Adding a new investor type is two-file change: extend the union in `contextProfile.ts:30` and the bridge in line 47, add an entry to `INVESTOR_CONFIGS`, and Pax automatically narrates differently for me. The plumbing is *there.* What's missing is somebody saying out loud "we support self-storage-land specialists, RV-park specialists, cell-tower specialists." That's a product positioning decision more than an engineering decision.

**8:15 PM.** Build-to-suit relationships. Three of my last six exits were build-to-suit deals — I delivered the entitled pad to a developer who already had a tenant lined up (one of the REITs has an internal pipeline of MSAs they're behind on inventory; we trade pads against their list). For the BTS structure I need a CRM that tracks not just my buyer but *the buyer's pipeline.* Public Storage's analyst lets me know which MSAs are top of their list each quarter; I match those to my parcel pipeline. AcreOS could let me load a private "buyer wishlist" per developer relationship and surface my parcels that match it on demand. Today: spreadsheet. Tomorrow if AcreOS builds it: enormous time saver.

**8:30 PM.** Deal-feed scan. Wendell loved deal-feed. For me the question is: *can I express my buy-box as "2-5 acres, 50K+ MSA pop, AADT > 15K, signalized intersection, by-right or SUP storage zoning, $200K-$1M, growth corridor"?* If yes, I save forty hours a month. If no, I'm using LandSearch and Crexi for $1,800/year, and AcreOS is just another tab. The current `searchCriteria` schema in `buyerNetwork.ts` doesn't have AADT, MSA population, or use-type-permitted as native filters. I'd have to add them.

---

## 3. The self-storage-land compliance test — what passed, what didn't

**Pass:**
- Industrial zoning recognized as high development potential (`zoningService.ts:73`)
- Population trend included in market intel (`dataIntelligenceEngine.ts:592`)
- Highway/road hierarchy ranked from OpenStreetMap (`dueDiligenceEngine.ts:459`)
- National Highway Planning Network integration exists (`data-source-broker.ts:1107`)
- Buyer network can express criteria-based matching (`buyerNetwork.ts:586`)
- `developer` InvestorType has Vision AI + Compliance AI + AVM bundled (`contextProfile.ts:174`)

**Fail or Missing:**
- **No AADT / state DOT traffic count integration.** This is the single most predictive variable for self-storage pad value. NCDOT, SCDOT, GADOT publish ArcGIS endpoints — wire them into `data-source-broker.ts`.
- **No demand-shed analysis.** Population per existing storage SF in radius. No integration with SpareFoot, SSA, or REIT public filings.
- **No `commercial_land_specialist` or `self_storage` InvestorType.** The seven buckets in `contextProfile.ts:30` shoehorn me into `developer` (subdivision-flavored) or `portfolio_builder` (long-term holder).
- **No use-type-permitted normalization** at the parcel level (self-storage by-right vs SUP vs not permitted, per local code).
- **No ground-lease / leasehold income modeling.** Note ledger is mortgage-shaped only.
- **No municipal case tracking.** Entitlement workflow ends at "compliance check" — there's no SUP/CUP/rezoning case status timeline.
- **No corporate-buyer CRM.** Trust score model assumes peer-to-peer wholesale relationships, not B2B with REIT acquisitions departments.
- **Hold-period risk flag mis-calibrated** for thesis-driven holds (`dealUnderwriting.ts:175`).
- **No filtering of county recordings by REIT-affiliated grantee entities.** Public Storage / Extra Space / CubeSmart deed records are public; aggregate them and filter is high-leverage.
- **No partial-disposition support** in `costBasisTracker.ts:134`. Sale-leaseback exits cannot be booked correctly.
- **No municipal approval-rate tracking** per jurisdiction for storage SUPs / CUPs / rezonings. The data is in public meeting minutes.

Net: AcreOS treats land as something you buy raw and sell raw, or buy raw and entitle into lots. It does not yet treat land as a *thesis-driven asset class with a vertical-specialist buyer.* The self-storage flip is one of maybe twenty such commercial-pad theses (RV parks, fast food, gas, charging stations, multifamily pads, MOB pads, industrial outdoor storage) that share this archetype.

---

## 4. Per-surface friction (storage-specialist-specific)

**`/parcels/:id`** — Best surface, agreed. Add: AADT, signal access, curb-cut count, utility-stub distance, demand-shed pop/SF ratio, by-right/SUP/not-permitted trinary for storage. Surface the corporate buyer interest signals (REIT acquisition activity within 5 miles in last 12 months).

**`/onboarding`** — Add a "What's your specialization?" question after the business-type selector. Free-text or curated list: self-storage, RV park, fast food pad, billboard, cell tower, gas, EV charging, MOB, industrial outdoor storage, multifamily pad. Drive widget pack from that.

**`/deal-underwriting`** — Accept `targetHoldMonths` from investor profile. Stop flagging 24-month holds as risky for thesis-driven specialists.

**`/buyer-network`** — Add `useType` to search criteria. Add corporate-buyer-tracking surfaces (vs. peer-investor trust score). Allow tracking of public-company acquisitions teams as relationship records, not platform users.

**`/finance`** — Add ground-lease income type as first-class entity. Distinct from mortgage note. CPI-escalation, term, leasehold rights, all native fields.

**`/compliance`** — Add municipal case tracker. Case number, jurisdiction, hearing dates, status. Pull from city/county legistar feeds where available.

**`/pricing`** — A "Commercial Pad Specialist" add-on at $99/mo would have me on day one. Demand-shed analytics, AADT, REIT-grantee filtering, ground-lease modeling, municipal case tracking. That's the bundle.

**`/data-source-broker`** — `data-source-broker.ts:139` already maps a `transportation` category to "transportation, dot, highways, rail." The bones are there. Add AADT as a sub-category, add EPA stormwater layers (storage developers want known impervious-surface treatment paths), and add FEMA flood per parcel surfaced at a *building-pad* granularity, not the whole-parcel granularity. Storage developers underwrite on the actual building-pad envelope, not the worst corner of the lot. Surface that distinction.

**`/acquisition-radar`** — Currently configured for absentee-owner / motivated-seller wholesale leads. For me the trigger event is "parcel under 5 acres, sold within 6 months in an MSA where new storage permits filed > 0 in past 12 months." That's a *competitive supply trigger,* not a distress trigger. AcreOS could ingest municipal permit feeds and surface "submarkets where new supply is forming, but where you can still beat the new cohort to entitlement on the next infill pad." That's a feature only a vertical specialist would ask for, but it would be the most actionable lead source I could imagine.

**`/agent` (Pax)** — When I ask Pax "should I buy this Mooresville pad?" I want the answer to be vertical-aware. Pax should know my hold horizon is 24+ months, my exit is a corporate REIT or regional buyer, my IRR target is 18-22% unlevered, my downside scenario is "no entitlement, sell at cost." Today's `verticalBlock` injection (from `paxPersona.ts`) doesn't cover storage. Add a storage block: "User is a self-storage land specialist. Holds 18-36 months. Exits to PSA, EXR, CUBE, NSA, U-Haul, or regional consolidators. IRR target 18-22% unlevered. Underwrites on demand-shed (target < 5 SF/capita), AADT (target > 15K), and zoning permittedness." Pax then narrates the deal in my language.

---

## 5. What's missing for self-storage-land specialists — in priority order

1. **Demand-shed analytics.** Population per existing storage SF in 1/3/5-mile radii. Without this AcreOS cannot underwrite a self-storage pad. Highest-leverage feature for the entire commercial-pad investor segment.
2. **AADT / state DOT traffic integration.** Wire NCDOT, SCDOT, GADOT, FLDOT, TXDOT, AZDOT ArcGIS endpoints into `data-source-broker.ts`. Surface count + trend on parcel detail.
3. **`commercial_land_specialist` InvestorType** with subtypes (storage, RV, food, fuel, charging). Drive `INVESTOR_CONFIGS` widget pack and quick actions accordingly.
4. **Use-type-permitted normalization.** For each parcel, answer: is self-storage by-right, by SUP, or not permitted, per the actual local zoning code. Requires parsing local code or contracting with Zoneomics for that field.
5. **Ground-lease / leasehold income modeling** as a first-class deal exit.
6. **Municipal entitlement case tracker.** Case number, hearings, status, opposition, recorded outcome. Highest pain point in my workflow.
7. **REIT-grantee filtering of county recordings.** Curated list of Public Storage, Extra Space, CubeSmart, Life Storage, U-Haul SPV entities. Filter recent recordings by grantee. Comp set in five clicks.
8. **Corporate-buyer CRM** distinct from peer-investor trust scores. B2B contact records with last-deal date, submarket preference, cap-rate threshold, approval cycle length.
9. **Partial-disposition / leasehold-retention support** in `costBasisTracker.ts`. Sale-leaseback, ground lease retention, and easement carve-outs each break the single-disposition assumption. Without it, year-end reporting is wrong on any structured exit.
10. **Permit-feed ingestion** (city planning legistar feeds, state DCA records) for competitive-supply tracking. Per-MSA new-storage-permit count. Drives both `/acquisition-radar` triggers and `/parcels/:id` competitive-supply context.

---

## 6. Pricing reaction (storage-specialist math)

I run ~6 deals/year, ~$3M GMV, ~$700K net. My current annual stack:
- CoStar: $1,800/mo = $21,600 (sites, comps, REIT activity)
- Placer.ai: $400/mo = $4,800 (foot traffic / demand-shed)
- LandSearch + Crexi: $150/mo = $1,800
- ParkSitter (state DOT viewer): $80/mo = $960
- Excel demand-shed model: free, but my analyst's $4,000/mo retainer maintains it
- Title chain pulls: ~$25 × 6 = $150
- DocuSign: $40/mo = $480
- QuickBooks: $90/mo = $1,080

Total: ~$78,000/year, of which $48,000 is the analyst (who does more than the model).

AcreOS at $49 Pro = $588/year. At $99 Commercial-Pad add-on = $1,776/year. The math works only if AcreOS replaces *CoStar* — which is the $21,600 line — and that requires demand-shed analytics, AADT, REIT-grantee filtering, and entitlement tracking. Ship those four, and CoStar is in the trash and AcreOS is the most valuable software I own. Miss any two of them and I keep CoStar and AcreOS is a $588 accessory.

---

## 7. The deal-killer

**Demand-shed analytics.** No commercial-pad specialist — storage, RV, fast food, fuel, multifamily — can underwrite a deal without supply-vs-demand math in a defined radius. AcreOS has the population data (`dataIntelligenceEngine.ts:206`). It does not have the *competitive supply* data. Without supply, demand is half a model. Wire supply scrapes (SpareFoot for storage, GoBigRV for RV parks, public county business licenses for retail), do the ratio, surface it on parcel detail, and AcreOS becomes the tool. Don't, and we're using CoStar forever.

For the self-storage-specific framing: AcreOS has the bones for vertical specialization — the `InvestorType` system, the `dashboardWidgets` registry, the buyer-criteria schema. It just hasn't been pushed past the seven generic archetypes. Every commercial-pad thesis is an `InvestorType` plus a vertical-data layer. Build that pattern once for self-storage — demand-shed, AADT, REIT grantees, entitlement tracking — and the same scaffolding lights up RV parks, fast food, fuel, MOB, and multifamily pads. *That* is how AcreOS escapes raw-land flipping and becomes a serious commercial-land platform.

Until then I'm trialing on Pro, keeping CoStar, and watching whether the v6 roadmap takes the niche specialist seriously. The "Land Investor with a niche" framing in the marketing is honest. The product hasn't caught up to the marketing yet.

One last thing. The architecture is *better than the surface area would suggest.* The `InvestorType` system, the Pax `verticalBlock` injection, the `dashboardWidgets` registry, the buyer-criteria schema, the data-source-broker, the parcel detail surface — all of these are extensible primitives, not hard-coded archetypes. A two-week sprint by someone who understands self-storage land could ship a credible v1 specialist pack: new InvestorType, AADT integration, demand-shed function, REIT-grantee filter, ground-lease entity, municipal case tracker, "Commercial Pad Specialist" pricing tier. Six features, two weeks, $99/mo add-on. Tell me which engineer is leading that and I'll buy them dinner in Charlotte.

— Sebastian
