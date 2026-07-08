# Della Robinson — AcreOS user review (GA timberland operator)

I run timberland in south Georgia — Macon to the Florida line, mostly 40-200 acre tracts between $80K and $600K. Eighteen years at this. My buyers split roughly 60/40 between timber funds (Hancock, Manulife, Forest Investment Associates) and private hunters who want a place to put a deer stand. My stack is LandGate for the underwriting glance, a forestry consultant on retainer for cruise data and harvest oversight, and DocuSign for paperwork. I also run a cow-calf operation on the side, but that pays the property tax — timber pays the bills.

I gave AcreOS a full day. Here's what a south Georgia pine-and-hardwood operator sees.

---

## 1. Thirty-second verdict

Would I sign up today? **Free trial, then probably not at $49/mo Pro until somebody adds a timber valuation primitive.** AcreOS treats my 120-acre tract the same way it treats a half-acre infill lot in Phoenix. My land has *two* values stacked on top of each other — bare-land value, plus standing timber value — and AcreOS only models one of them.

At **$20 Starter** I'd keep it as a CRM backup to the spreadsheet I share with my forester.

At **$49/mo Pro** I switch *if* the platform learns three things: (1) timber stand inventory exists as a separable asset on a parcel, (2) CRP/CUVA covenant restrictions affect both valuation and salability, (3) hunting lease income is a recurring cash-flow stream that lifts the parcel's hold-vs-sell math.

What stops me cold: I searched the codebase for "timber," "stumpage," "MBF," "tons per acre," "cruise," "stand age," "loblolly," "rotation." The only hit on stumpage or merchantable timber as an actual *thing* is a one-line bullet in `server/ai/executive.ts:297` — *"Timber value: check if standing timber has marketable value (separate from land)."* That's it. No data model, no valuation tool, no harvest-contract surface. The AI is told to think about it; the platform doesn't model it.

---

## 2. Daily-use walkthrough — my imagined first day

**6:30 AM.** I land on `/today`. Pulse score, AI actions. Fine. **What I'd want as a timberland operator:** active hunting leases expiring this season, stands approaching merchantable age (28-32 yr loblolly), CRP contracts up for renewal, FSA/USDA program deadlines. None of those primitives exist. Pulse is built for a flipper measuring monthly velocity, not a 25-year rotation operator.

**7:00 AM.** I check `/parcels/:id` on a 140-acre tract. I get a property overview, due-diligence checklist (`client/src/pages/parcel-detail.tsx:74` — five items: title clear, no liens, no environmental issues, access verified, taxes current), and tabbed valuation/comps. **What's missing for me, line by line:**

- **No timber stand inventory tile.** Loblolly pine planted 1998, currently 28 yr old, ~140 tons/acre merchantable, $25/ton stumpage = roughly $3,500/acre standing — that's *more than the land* on most south Georgia tracts. AcreOS shows me one number — bare-land value from AVM — and that number is wrong by a factor of 2x to 3x for any actively-managed timberland.
- **No species/age/rotation field.** Pine plantations on a 25-30 year rotation behave radically differently than mixed hardwood you cut once a generation. AcreOS doesn't know the difference.
- **No CUVA/FLPA covenant flag.** Georgia's Conservation Use Valuation Assessment cuts property tax by ~40%, but locks the land into agricultural/forestry use for 10 years with stiff breach penalties. Forest Land Protection Act (FLPA) is a 15-year covenant. Both are *enormously* material to a buyer. AcreOS schema has `agriculturalExemptionAvailable: true` for Georgia (`server/services/regulatoryIntelligence.ts:127`) and that's the entire treatment. No covenant tracking, no breach-penalty calculation, no remaining-term display.
- **DD checklist is residential-flavored.** Title clear / no liens / no environmental / access verified / taxes current — those are all necessary, but for me they're the *floor*, not the work. The work is: cruise data within the last 3 years, no recent harvest, no clear-cut by previous owner, soil productivity index, drainage, road class, hunt-club lease in good standing, CRP contract assigned, FLPA/CUVA covenant status.

**8:30 AM.** I look at how AcreOS thinks about valuation. `server/services/creditBenchmarking.ts:19` shows credit benchmarks for `timberland` as a property *type* with median 65, p25 50, p75 78. That's a generic risk score — useful in the aggregate, useless for pricing my specific tract. The AVM doesn't know whether I have 32-year-old planted pine ready for final harvest or a 5-year-old replanted stand worth nothing for a decade.

**9:30 AM.** Buyer side. `/buyer-network` and `buyerProfiles` schema (`shared/schema.ts:7944`). The `propertyTypes` array accepts free-text strings, and I can see "Timber" is referenced in `client/src/pages/investor-directory.tsx:49` and the marketplace dropdown (`client/src/pages/marketplace.tsx:807`). Good — at least the category exists. **But the matching engine has no concept of timber-specific buyer preferences:** preferred species mix, minimum stand age, harvest rights wanted/excluded, hunt-club lease retained or transferred, CRP-encumbered yes/no. A timber fund wants the opposite of what a private hunter wants — funds want merchantable timber and clear harvest rights, hunters want mature hardwood for deer cover and don't care about stumpage. Same parcel, two completely different buyer journeys. AcreOS treats them as one buyer pool.

**10:30 AM.** I try to model **annual hunting lease income** ($8/acre is typical in south Georgia — call it $1,120/yr on a 140-acre tract). I look at the `leases` table (`shared/schema.ts:11854`) — **it's a residential rental table.** `tenantName`, `tenantEmail`, `monthlyRent`, `leaseStart`, `leaseEnd`, `securityDeposit`. There's no `leaseType` field, no recreational/hunting/grazing/cell-tower/solar enum, no annual (vs monthly) cadence flag. If I shoehorn a hunting lease into this, I have to lie about half the fields. There's also no concept of *non-cash* return — I lease 60 acres to a hunt club for $480/yr, but they also maintain the food plots, repair the fences, and call me when somebody trespasses. That's worth more than the cash. AcreOS has no way to record it.

**11:30 AM.** **CRP — Conservation Reserve Program.** This is government money that pays $40-$80/acre/yr to keep land out of production. On a 140-acre tract with 60 acres in CRP, that's $3,000-$5,000/yr of guaranteed federal cash for 10-15 years. The contract is assignable to a buyer at sale. **I searched the codebase for "CRP," "conservation reserve," "FSA," "NRCS," "farm bill" — zero hits as substantive features.** The closest reference is `server/ai/executive.ts:504` mentioning *"FSA for farmland classifications"* in passing and the agricultural values lookup in `server/ai/supportAgent.ts:1085`. There's no CRP contract object, no annual payment forecast, no expiration alert, no buyer-facing "CRP-encumbered: $4,200/yr through 2031" disclosure block.

**12:30 PM.** Lunch. I ask Pax to "value my tract at parcel ID 142." It pulls the AVM. I ask "what about the timber?" Best case it cites the executive.ts bullet. There's no tool call to a timber valuation service, because there isn't one. There's no `lookup_timber_value` or `cruise_inventory` in the supportAgent toolkit (`server/ai/supportAgent.ts`). I checked.

**2:00 PM.** **Harvest contract paperwork.** When I sell standing timber to a logger, that's a separate document from a land sale — a timber deed or pay-as-cut contract specifying species, volume, term (typically 1-2 yrs to complete the harvest), severance liability, road-repair bond, BMP (Best Management Practice) compliance for water quality. AcreOS' document templates (`server/storage.ts:5316` etc.) cover assignment-of-contract, warranty deed, security deed — **no timber deed, no pay-as-cut contract, no BMP compliance affidavit.** Whoever built the document system was thinking real-estate transfer; nobody was thinking severance.

**3:00 PM.** **Georgia Security Deed.** Credit to the regulatory intelligence service (`server/services/regulatoryIntelligence.ts:131`) — it correctly notes *"Georgia uses Security Deeds (not mortgages) — important distinction. Non-judicial foreclosure is straightforward."* That's accurate and useful for owner-finance scenarios. The state config is one of the better surfaces.

**4:00 PM.** **Wholesaling-in-Georgia rule.** GA passed regulatory tightening on assignment-for-fee in 2023 (House Bill 200 era discussions, codified rules requiring disclosure of equitable interest). I don't wholesale, but I know operators in my mastermind who do — they need a disclosure-of-equitable-interest banner and AcreOS doesn't have one for GA. (Trey already flagged this for IL/OK/SC; GA needs to be on the list.)

**5:00 PM.** **Pine plantation rotation cycle.** A 25-30 year rotation has predictable thinning windows: first thin at 12-15 yr (pulpwood, $8-$12/ton), second thin at 18-22 yr (chip-n-saw, $15-$20/ton), final harvest at 25-30 yr (sawtimber, $30-$45/ton). That's three separate cash events on a 30-year hold. **AcreOS' cash-flow model has no concept of multi-year, irregular, harvest-driven cash events.** It assumes monthly rent or one-time sale. A timberland portfolio model that doesn't understand thinning is unusable for long-hold timber.

**5:30 PM.** **Forester collaboration.** I work side-by-side with a registered forester. He cruises my stands, files my CUVA paperwork, signs off on BMP compliance, and recommends thinning windows. AcreOS has user roles for VAs, partners, and attorneys (I see VA management in `server/routes-elite-features.ts:12`) but no concept of a *forester* role with limited scope-of-access to timber stand data and harvest contracts. He shouldn't see my buyer list or assignment fees; he should see and edit cruise records, BMP plans, and harvest schedules. That role is missing.

**5:45 PM.** **Aerial / vegetation analysis.** `tests/unit/visionAI.test.ts:109` actually has a `hasTimber: boolean` test — a vision AI is supposed to detect timber from imagery. Encouraging. But the test stops at "is there timber on this parcel, yes/no" — there's no species ID, no canopy density estimate, no stand-age proxy. NAIP imagery is free, GA gets refreshed every 2 years, and the difference between a 12-yr stand and a 28-yr stand is visible from the air. The bones of a timber-aware vision system are there; the muscle isn't.

**6:00 PM.** I log out. The platform isn't *hostile* to me — it's just not aware I exist as a distinct operator type. There is no `timberland_investor` persona in `client/src/lib/personaVocabulary.ts` (lines 111-119: only land_investor, note_investor, tax_delinquent, wholesaler, subdivider, fix_flipper, landlord). I default to "Land Investor" and inherit a vocabulary built for raw-land flippers doing 50-200 deals a year. I do 4-8 deals a year. We are different animals.

---

## 3. Per-surface friction

**`/today`** — Wrong default. I want: stands approaching merchantable age, CRP/CUVA contract expirations, hunting lease renewals, FSA program deadlines. None exist as tile primitives.

**`/parcels/:id`** — Missing the top-three timberland tiles: (1) **standing timber inventory** (species mix, age class, est. tons or MBF, last cruise date), (2) **encumbrance status** (CRP / CUVA / FLPA / conservation easement / hunt lease / cell tower lease — with remaining term), (3) **management activity log** (last thinning, last burn, last spray, last cruise). DD checklist needs a timberland variant. The five-item list is the *floor*.

**`/leads`** — Generic. Timber-fund leads behave nothing like private-hunter leads. They want IRR projections, cruise data, harvest history; private hunters want photos of deer scrapes and a survey marker walk. Same lead pipeline, two different qualification scripts. Persona vocab swap won't fix this — needs lead sub-types or a "buyer profile preset."

**`/deals`** — DD checklist isn't timber-aware. Add: "Cruise data current (≤3 yr)," "BMP plan on file," "FLPA/CUVA covenant disclosed to buyer," "CRP contract assignment authorized by FSA," "Hunt lease term communicated."

**`/documents`** — Missing timber deed, pay-as-cut harvest contract, BMP compliance affidavit, CUVA covenant disclosure, FSA CRP assignment form. The Georgia Security Deed handling is good. Add Forest Service / DNR-level docs.

**`/money`** — Cash-flow model is monthly-tenant or one-time-sale. Timberland is irregular harvest events on 25-30 yr rotations plus optional CRP annuity plus optional hunt-lease income. Build a "Long-hold timber" cash-flow preset: annual income line (CRP + lease) + lumpy harvest events at 12, 18, 28 yr + final sale.

**`/portfolio`** — `portfolioOptimizer.ts:321` correctly classifies anything with "timb" or "forest" in zoning as `Timberland`. Good. Then it treats it as a generic property type and recommends "diversify by adding timberland" (line 376) — funny, since I am 100% timberland and what I actually need is *species* and *age-class* diversification within timberland (don't have all 5 stands maturing in 2031). Schema can't model that.

**`/buyer-network`** — "Timber" as a string preference works for routing, but the matching engine doesn't score timber-buyer-fit on the dimensions that matter (stand age, species, harvest rights, encumbrance tolerance).

**`/inbox`** — Fine for my volume.

**`/field-scout`** — The offline sync would actually be useful out in a stand where I have no cell signal. But the inspection checklist (Trey flagged it as land-investor-flavored) doesn't have a timber variant — I'd want fields for stand density estimate, basal area, recent BMP compliance issues, evidence of trespass/poaching, road condition.

**`/pax`** (AI assistant) — Pax persona vocab (`paxPersona.ts`) doesn't have timberland framing. If I ask it "should I thin or hold," it'll answer based on whatever generic land logic is loaded. The executive.ts bullet at line 297 is a hint, not a capability.

**`/onboarding-v2`** — No timberland_investor option. I get bucketed as land_investor and miss every timber-specific seed.

**`/regulatoryIntelligence`** — Georgia entry is competent on Security Deeds. Misses CUVA, FLPA, GA forest taxation specifics, the 2023 wholesale-disclosure tightening, and the GA-specific rule that timber severance can trigger a CUVA breach if the harvest exceeds the management plan.

**`/campaigns`** — Direct-mail to absentee timberland owners is a real channel — heirs in Atlanta who inherited 80 acres outside Tifton from grandpa and have no idea what to do with it. AcreOS' campaign module would work for me, but the seed list filters (`server/services/leadDiscovery.ts` and similar) are absentee-residential flavored. I'd want filters like "owns 40+ acres, mailing address in different county, last sold >20 yr ago, agricultural or forest zoning, not enrolled in CUVA." None of those filters exist for timber-targeted mailings.

---

## 4. The timber tests — pass / partial / fail

1. **Standing timber as a separable asset on a parcel** — *Fail.* No data model. One-line AI bullet.
2. **Cruise data attachment / freshness** — *Fail.* No cruise_records table, no last-cruised-date field, no cruise-stale alert.
3. **CRP / CUVA / FLPA covenant tracking** — *Fail.* Zero codebase hits. Material to every south Georgia tract.
4. **Hunt-club / recreational lease as recurring income** — *Fail.* `leases` table is residential-rental shape. No leaseType enum.
5. **Harvest-contract paperwork (timber deed, pay-as-cut)** — *Fail.* Document templates are real-estate transfer only.
6. **Pine plantation rotation cash-flow model (12 / 18 / 28 yr events)** — *Fail.* Cash-flow model is monthly-rent or one-time-sale.
7. **Buyer matching by timber dimensions (stand age, harvest rights, encumbrance)** — *Fail.* String-tag only.
8. **Georgia state regulatory accuracy** — *Partial pass.* Security Deeds correct, ag exemption noted, but CUVA / FLPA / wholesale-disclosure missing.
9. **GIS data sources for GA** — *Pass.* Two GA endpoints registered (`scripts/import-state-gis-sources.ts:367-387`). Better than I expected.
10. **Native esign for timber deeds** — *Partial.* The HMAC-link signer (`client/src/pages/sign-document.tsx`) is solid; my issue is template *content*, not signing flow.
11. **Forester / consultant role with scoped access** — *Fail.* No specialty-role concept beyond VA / attorney / partner.
12. **Vision AI species + age detection from aerial** — *Stub.* Boolean detection exists in tests; production species/age inference does not.
13. **Absentee-timber-owner campaign segmentation** — *Fail.* No timber-aware seed-list filters.

**Net:** AcreOS is **about 15-20% there for timberland operators**. The 80% that's missing is the actual asset — standing timber, encumbrances, and harvest-driven cash flow. The operator surfaces (matching, esign, regulatoryIntelligence for GA) are all *almost* close enough that bolting on a timber model wouldn't be a rewrite. It'd be additive.

A telling signal: I can find "timber" as a property *category label* in five places (marketplace dropdown, investor-directory, portfolioOptimizer, creditBenchmarking, vision-AI test). I cannot find "timber" as a *first-class entity* with its own table, lifecycle, or valuation in any place. The team understood the category mattered enough to label it; nobody got around to modeling it. That's a fixable gap, not an architectural one.

---

## 5. Five features that would make this a no-brainer switch

1. **Timber stand inventory primitive on `/parcels/:id`.** A `timber_stands` table linked to parcel: species (loblolly / slash / longleaf / hardwood-mix), planted year, current age, last-cruised date, est. tons/acre or MBF, est. stumpage value at current prices. Show on the parcel detail as a tile next to AVM. **This single feature flips me from $20 trial to $49 paying.**

2. **Encumbrance & program tracking.** A `parcel_encumbrances` table covering CRP / CUVA / FLPA / conservation easement / hunt lease / grazing lease / cell tower / solar — with start date, end date, annual payment (where applicable), assignability flag, and breach-penalty estimate. Surface on `/parcels/:id` as a "What runs with the land" panel. Buyers want this. Lenders demand it.

3. **Hunt-club / recreational lease as a first-class lease type.** Extend the `leases` table with a `leaseType` enum (residential / hunting / grazing / farming / cell_tower / solar / mineral / billboard) and an annual cadence. Wire to `/money` so the recurring income shows up alongside rent.

4. **Timber deed + pay-as-cut contract templates.** Add to `server/storage.ts` document library. Include species, volume, term, severance liability, BMP compliance, road-repair bond. State-aware for GA's specific forestry rules.

5. **Georgia regulatory completeness.** Extend `server/services/regulatoryIntelligence.ts:113` with: CUVA covenant rules + breach penalties, FLPA covenant rules, forest taxation specifics, the 2023 wholesale-disclosure rule, and the timber-severance-triggers-CUVA-breach trap. Same architecture as the existing entry, just deeper.

6. **(Bonus)** Pine-rotation cash-flow preset. A "Long-hold timber" mode in `/money` that models thinning at 12 / 18 yr and final harvest at 28-30 yr as discrete events, plus optional CRP annuity. NPV / IRR computation that respects the irregular cadence.

7. **(Bonus)** A `timberland_investor` persona in `personaVocabulary.ts`. "Lead" → "Inquiry," "Property" → "Tract," "Closed" → "Conveyed," "Deal" → "Transaction." Pax persona vocab gets a timberland framing with thinning, cruising, stumpage, and rotation as native vocabulary.

---

## 6. Three things that are surprisingly good

1. **Georgia state regulatory entry is actually right on Security Deeds.** Most national platforms ship "Mortgage" templates for Georgia and end up sued. AcreOS got this right (`server/services/regulatoryIntelligence.ts:115` lists `security_deed` as a deed type, line 131 calls out the non-judicial foreclosure path explicitly). That tells me somebody on the team did real GA homework.

2. **`portfolioOptimizer.ts:321` correctly buckets timberland.** It checks `if (z.includes('timb') || z.includes('forest'))` — that's the right substring-match. The categorization is sound; what's missing is the depth *underneath* the category.

3. **The HMAC-signed link signer is genuinely native.** I came in wanting DocuSign-equivalent and `client/src/pages/sign-document.tsx` reads well — public link, signature capture, no Adobe redirect. If the document templates expand to cover timber deeds, this is the right plumbing. The pipes are good; the contents are missing.

4. **(Honorable mention)** `creditBenchmarking.ts` already has a `timberland` row with separate p25/median/p75 and default-rate buckets per state. Whoever wrote this understood timberland is its own asset class for credit purposes. It's a stub, but it's pointed in the right direction.

---

## 7. The deal-killer if not fixed

**Treating standing timber as invisible.** Every tract I sell has bare-land value plus standing timber value. On a 28-year-old pine plantation, the timber is *more than the land*. If I put a 140-acre tract into AcreOS and the platform tells me it's worth $280K (bare-land AVM) when the actual value is $280K + $490K standing pine = $770K, I cannot use this platform to talk to buyers, model cash flow, or underwrite an offer. I would mislead my own pipeline.

The fix is not small but it is well-bounded: one new table (`timber_stands`), one tile on `/parcels/:id`, one stumpage-price feed (TimberMart-South publishes quarterly Georgia averages — public data, $300/yr subscription for the detailed cut), and one extension to the AVM that adds bare-land + standing-timber. Maybe two engineering weeks. Until that ships, AcreOS is a CRM for the *non-timber* parts of my business — and my forester's spreadsheet keeps doing the actual work.

The platform clearly can scale to timber. The persona system, the regulatoryIntelligence pattern, the portfolioOptimizer's categorical awareness, the HMAC signer — these are all the right primitives. They were just built by people thinking about Texas hill-country flips and Florida infill, not Georgia pine plantations on a 30-year clock. We are 14% of the rural-land market by acreage and we get treated like an afterthought across every CRM I've ever trialed. Be the first one that doesn't.

— Della
