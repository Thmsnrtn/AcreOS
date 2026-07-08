# Tom Kearney — AcreOS user review (PA Land Investor, Marcellus mineral-rights)

I'm 60. Williamsport. I work Lycoming, Tioga, and Bradford counties — the heart of the PA Marcellus Shale fairway. I've been buying land in this state for thirty years, and for the last fifteen of those years the only number on a parcel that's mattered to me is whether the mineral estate came with the surface or not. PropertyShark for ownership, a PA-licensed oil-and-gas title abstractor named Doug who works out of a converted barn in Towanda, DocuSign for whatever I can sign without a notary. That's the stack. I came into AcreOS because a guy at the Sullivan County tax sale told me it had a "title chain analyzer." I spent four hours inside it. Here's the audit.

---

## 1. Thirty-second verdict

**No. Not for Marcellus work. Maybe a $20/mo county-lookup spy-glass; not a primary tool.**

AcreOS understands that mineral rights exist as a *concept*. It has a checkbox in the Land Credit model (`mineralRights: 'owned' | 'partial' | 'severed'`), it has a one-paragraph "mineral rights warning" in the due-diligence PDF, it has a state-by-state lookup function called `getMineralRightsInfo`. And it has not bothered to put Pennsylvania in that lookup. I'll get to that. **AcreOS knows minerals matter in Texas, New Mexico, Colorado. It has nothing on file for the second-largest natural gas producing state in the country.** That's not a polish issue. That's a "you don't know what state I'm in" issue.

For a guy whose entire edge is figuring out whether the 1923 deed reserved the oil and gas to the grantor's heirs, an oil-and-gas-blind platform isn't a tool. It's a distraction.

What I did in those four hours: I created an org, ran the regulatory-intelligence page for "PA," ran the environmental-intelligence card for a Tioga County parcel I own, generated a due-diligence report PDF, opened the Land Credit screen, looked at the document templates, looked at the title-chain analyzer with a synthetic event list, and read the parts of the schema that govern parcels, mineral status, and recording. Then I went into the codebase to verify what the UI was telling me. The UI was telling me less than the codebase confirmed: PA isn't there.

---

## 2. The seven things I need — and what AcreOS actually has

### **(1) Severed mineral estate detection — surface vs subsurface ownership.**

In PA the surface estate and the mineral estate are independently transferable. A 1908 deed can convey the surface to my great-grandfather while reserving the oil, gas, coal, and "all minerals of every kind" to the original grantor — and that reservation runs forever unless extinguished. I have bought 180-acre tracts in Tioga where the surface trades for $1,800/acre and the severed mineral estate, held by the heirs of a Pittsburgh coal lawyer who died in 1947, is worth $14,000/acre because Cabot wants to drill a horizontal lateral under it. **The whole game is figuring out who owns the minerals before the surface seller does.**

What AcreOS has: a `mineralRights` field on the Land Credit factor breakdown (`server/services/landCredit.ts:354`) with three possible values — `owned`, `partial`, `severed`. That's the entire data model. There's no separate mineral-owner record, no mineral-deed reference, no chain-of-title for the subsurface, no flag for whether the mineral chain has been abstracted at all. The DD report (`server/services/dueDiligenceReportGenerator.ts:230`) emits a generic "Mineral rights may be severed from surface rights" line for any property in `OIL_GAS_STATES = ["TX", "OK", "LA", "ND", "PA", "WV", "NM", "CO", "WY"]`. PA is on that list. Good.

**But `getMineralRightsInfo` (`server/services/environmentalIntelligence.ts:206`) has no PA entry.** I checked. The map covers TX, FL, AZ, CA, CO, NM, NC, GA, OR, WA. Ten states. Pennsylvania — the state with **70,000+ active oil and gas wells**, the heart of the Marcellus, where mineral severance is closer to the rule than the exception in the northern tier counties — falls through to the default branch and the code logs `"Mineral rights lookup miss"` and returns `severanceCommon: false, severanceRisk: "low", dominantMinerals: [], surfaceOwnerProtections: "moderate"`. That is *exactly wrong* for my counties. A platform that tells a Tioga County buyer "severance risk: low" has just earned somebody a six-figure mistake.

The same gap exists in `regulatoryIntelligence.ts`: that file has hand-written `practitionerNotes` for TX, FL, GA, NC, TN, AL, MS, AR, MO, OK — including a note for OK that says "Oil and gas mineral rights are often severed" — and **zero entries for PA, WV, OH, ND, WY**, the entire Appalachian and Williston gas belts. A founder shipping a "regulatory intelligence" surface that excludes the Marcellus while including the Mississippi Delta has a coverage map that doesn't match where the money is.

What I'd build:
1. PA entry in `MINERAL_RIGHTS` with `severanceCommon: true, severanceRisk: "high", dominantMinerals: ["natural_gas", "oil", "coal", "limestone"]`, `surfaceOwnerProtections: "weak"`, and notes referencing the Marcellus and Utica plays plus PA's 2006 Oil and Gas Act.
2. A first-class **MineralEstate** record separate from the surface parcel — its own owner, its own chain-of-title, its own deed references, its own tax-parcel number where the county breaks it out (Bradford does, Lycoming doesn't, that itself is data).
3. Severance flag on the parcel detail UI that's red, not gray. "MINERAL ESTATE LIKELY SEVERED — abstract subsurface chain before offer."

### **(2) Marcellus lease economics — bonus and royalty math.**

When I buy surface-only and the seller has an active lease, I inherit the lease. When I buy with minerals intact, I'm sitting on an asset whose value is `(bonus per acre) + NPV(royalty stream)`. Current Marcellus economics in my counties: **bonus $500–$3,500/acre signing, royalty 12.5%–20% of wellhead value.** The 12.5% statutory minimum (PA Guaranteed Minimum Royalty Act of 1979, Kilmer v. Elexco 2010) is the floor; experienced lessors get 18–20%. A 100-acre tract with a fresh 18% lease on a producing horizontal pad can throw $40K–$180K/year for 5–8 years before it tails off.

What AcreOS has: nothing. There is no royalty model, no lease record, no production-decline curve, no bonus-per-acre comp set. The Land Credit weight on `mineralRights` tops out at 100 if `owned`, 30 if `severed` — a single integer. **An 18% royalty on a producing well is not the same asset as a 12.5% royalty on undrilled acreage held under a paid-up lease that expires in 14 months.** Same `mineralRights: "owned"` flag in the model. The valuation engine (`landCredit.ts`) treats them identically.

What I'd build:
1. `mineralLeases` table — lessee, effective date, primary term, extension clauses, royalty %, bonus paid, pugh clause yes/no, depth severance yes/no. Pugh clauses matter — without one, a 100-acre lease producing on 5 acres holds the entire tract.
2. PA-DEP well integration (`https://www.depgreenport.state.pa.us/`) — every operator, every spud date, every production report. This is **public**, freely downloadable, monthly. The platform brags about 80+ federal data sources; PA-DEP eGRID for oil and gas should be the easiest scrape on the list and it isn't there.
3. Royalty NPV calculator with state-specific decline curves. Marcellus decline is brutal — 60% in year one, 30% year two, then long tail. Anybody pricing a mineral asset off straight-line is dead.
4. Post-production cost handling. The 2010 *Kilmer v. Elexco* decision lets PA operators deduct post-production costs (gathering, compression, dehydration, transport) from royalty payments before applying the 12.5% statutory floor. That can chew 30–40% off a stated royalty. A royalty model that doesn't represent gross-vs-net is a royalty model that overpromises by a third.

### **(3) PA Sub-Surface Act — separate mineral chain tracing.**

The Pennsylvania Recorded Documents Act and the case law around it (especially *Hetrick v. Apollo Gas* and the 1971 Dunham Rule) mean the mineral chain has to be traced **independently** from the surface chain. A clean surface chain since 1908 tells me nothing about whether the gas was reserved in 1893. I need an abstractor to pull every deed in the grantor-grantee index for the *mineral grantor* lineage, which often diverges from the surface grantor lineage three or four owners back.

What AcreOS has: `titleChainService.ts` with `analyzeChainOfTitle(events: TitleEvent[])`. It's a single linear chain. Events have a `type` enum that includes `mineral_rights` as a `ScheduleBException` type (line 99) — meaning AcreOS treats mineral severance as a **title exception on the surface policy**, not as a separate estate with its own chain. That's how a title insurer thinks. It's not how a Marcellus buyer thinks.

What I'd build:
1. Two parallel chains per parcel — `surfaceChain` and `mineralChain`. Each with its own events, gaps, clouds, abstractor sign-off.
2. Bifurcation event — when a deed in the chain reserves minerals, branch the mineral chain off the surface chain at that grantor. The UI should show two ribbons that diverge.
3. **Dunham Rule presumption flag** — in PA, a reservation of "minerals" is presumed not to include oil and gas unless explicitly stated. That presumption alone changes the value of dozens of old reservations in my counties. Encoding it would make AcreOS the only platform that gets this right.

### **(4) Title insurance excludes minerals — most platforms don't realize.**

Standard ALTA owner's policies in PA exclude mineral rights, oil, gas, and coal from coverage as a **standard exception** (Schedule B-II). I can buy a title policy on a 200-acre tract, get clean paper, close, and discover six months later that Talisman Energy's 1992 lease — recorded in the wrong county or in a separate oil-and-gas index — encumbers my entire tract. The policy doesn't pay. **Mineral title is its own product and most surface-only title insurers won't write it.**

What AcreOS has: a `closingCostEstimator.ts` that calculates title insurance at "0.5% of sale price" (line 36). Flat. No mineral-policy line item. The DD report says "Standard title insurance policy should be available" (`titleChainService.ts:233`) without qualifying that "standard" means "your minerals aren't covered."

What I'd build:
1. Mineral-rights coverage as a separate optional line in closing-cost estimation, priced at the 0.3–0.5% of *mineral value* range that PA mineral title shops actually charge.
2. A warning surface — "Standard title policy excludes mineral rights. Mineral coverage requires separate underwriting and abstract" — surfaced on every PA, WV, OH, OK, TX, NM, ND, CO, WY parcel.
3. Mineral-abstractor directory. Doug in Towanda is one of maybe twenty people in PA who do this competently. AcreOS has an "investor-directory" page; an *abstractor* directory keyed by state and specialty is the same data model.

### **(5) Mineral-only deeds — does AcreOS know they exist?**

Half of my acquisitions in the last five years have been mineral-only deeds — I'm not buying surface, I'm buying the right to the gas under somebody else's surface. Heirs of a 1947 reservation don't want to deal with twelve cousins; I'll buy them out at $400/acre and consolidate the mineral estate while leaving surface alone. **No surface acreage transfers. No house. No road. Just rights.**

What AcreOS has: `propertyType` enums in the schema (`shared/schema.ts:8649`) — `raw_land, recreational, agricultural, residential_lot, commercial`. No mineral-only. No royalty-interest. No working-interest. The deal model assumes you buy real estate that has a polygon and an address. A mineral-only deal has neither — the description is by metes and bounds tied to the surface tract, the property has no mailing address, and there's no parcel polygon I can lasso on a map.

What I'd build:
1. New propertyType: `mineral_estate` — referenced to a surface parcel by APN, acreage = mineral acres (often a fractional interest, like "1/16th of all oil, gas, and coal under [described tract]").
2. Fractional-interest math throughout the platform. I commonly buy 1/64th interests when I'm consolidating heirship.
3. Mineral-deed template in the document generator. The PA standard mineral deed is half a page; AcreOS has an entire document-generation pipeline (`documents.ts`) and zero of its templates know what a mineral reservation looks like.
4. Affidavit of heirship for mineral consolidation. Most of my mineral acquisitions are from heirs of the original reserving grantor — often four or five people who never knew they owned anything. PA's affidavit-of-heirship process for severed minerals is its own specialized form, and the recording requirement varies by county. The platform's document templates don't know this exists.

### **(6) PA Recorder of Deeds — county-by-county quirks.**

Lycoming records oil and gas leases in the regular deed book. Bradford has a separate **Oil and Gas Lease book** (Book OGL-1, OGL-2…). Tioga uses an "Instrument index" that lumps everything together but tags it with a code. Sullivan still does paper books for anything pre-1980 and you have to drive there. **Each county has its own indexing convention and recording fee schedule.** Lycoming charges $18.50 first page + $4 each additional + UPI fee + state writ tax. Bradford is $20 first page. Tioga has a separate "mineral instrument" surcharge of $10.

What AcreOS has: `countyRecordingFees.ts` with a flat `PA: { rate: 10.00, paidBy: "split" }` — one number for all 67 PA counties. That's wrong. PA recording fees are set by county fee schedule, with state-mandated additions; the variance across my four counties alone is about 30%. There's no acknowledgment of separate oil-and-gas indexes.

What I'd build:
1. Per-county fee schedules for at minimum the 30 most-active PA counties. The state Recorder of Deeds Association publishes these annually.
2. Recording-office capability flags — `hasSeparateOilGasIndex`, `prePeriodFormat: "paper" | "scanned" | "digital" | "indexed"`, `oldestDigitalYear`. So the platform knows "Sullivan minerals before 1980 require a physical visit" and surfaces that in due-diligence task generation.
3. UPI (Uniform Parcel Identifier) integration — PA has a state-mandated UPI on every recorded instrument since 1989, and that's the foreign key that ties recorded documents to assessor parcels. Without UPI awareness, the chain-of-title work doesn't connect to the parcel.

### **(7) "Hidden gold" valuation — properties 3–10× undervalued if minerals retained.**

The deal of my career: 2014, Tioga County, 247 acres, surface comps said $1,400/acre, total $345K. Title work showed minerals had been reserved in 1916 to a man whose only descendant was a bachelor schoolteacher in Erie who'd never claimed them and didn't know they existed. I bought the surface for $345K, then bought the mineral estate from the schoolteacher for $90K, and leased the consolidated mineral estate to Cabot eight months later for $2,200/acre bonus + 18% royalty. **Total in: $435K. Lease bonus alone: $543K. Royalties since: about $1.1M.**

What AcreOS has: `landCredit.ts` produces a single composite score, with `mineralRights` weighted at 15% of the Legal subscore which is itself 15% of the total — meaning mineral status moves the overall score by maybe 2.25 points on a 100-point scale. **That's noise.** A platform that scores a tract with severed-but-cheap minerals identically to a tract with included-and-valuable minerals (modulo 2.25 points) is not modeling Marcellus economics. It's modeling residential lot acquisition.

What I'd build:
1. Two-asset valuation: surface NPV + mineral NPV, summed. Surface is comp-driven (you have this). Mineral is `(probability of lease) × (expected bonus per acre) × acres + NPV(royalty | drilling occurs)`. Both numbers shown. Both auditable.
2. Mineral-opportunity flag — if `mineralStatus === "severed"` AND `mineralOwnerKnown === false`, surface the deal as a *consolidation opportunity* with a workflow to find and contact the heirs. I do this manually for ten hours a week. AcreOS could do it in twenty seconds.
3. Comp set for mineral leases — recent bonuses and royalty rates within 5 miles. PA-DEP publishes lease records via county recorder integration; this is a scrape-and-parse problem, not a research problem.

---

## 3. Things that would matter for a PA operator and aren't in the platform

These didn't earn their own section — they're each a paragraph or a line — but together they're why I'd spend ten minutes inside AcreOS and then go back to my browser tabs.

**Dormant Mineral Act — PA doesn't have one.** Half the states with mineral severance (OH, IN, NY, ND, NM) have statutes that extinguish abandoned mineral interests after 20 years of non-use. PA does not — once severed, minerals stay severed forever absent affirmative reunification. That's a *huge* deal for valuation work, and it changes the strategy for chasing heirs. AcreOS's regulatory layer doesn't know this. It also doesn't know which states *do* have dormancy statutes, which means it can't model the time-decay of a severed estate's risk in any state.

**Forced pooling.** PA has a 1961 Oil and Gas Conservation Law that applies *only* to wells producing from formations below the Onondaga horizon. Marcellus is *above* Onondaga — so most Marcellus production is *not* subject to forced pooling. That means I can hold out. Utica plays that go below the Onondaga *can* be force-pooled. The platform has no concept of formation-by-formation regulatory regimes; it treats "PA oil and gas" as a monolith. It isn't.

**Act 13 impact fees.** PA's 2012 Act 13 imposes a per-well impact fee paid by drillers and distributed to counties and municipalities where wells are located. A surface owner with a producing well on the property doesn't get the impact fee — but the county does, and that funds the property tax base. Tioga County has received $80M+ in impact fees since 2012; that's why their assessor data is digitized when Sullivan's isn't. Platform-level: this should drive county-data-quality scores. It doesn't.

**Surface use agreements (SUAs).** When the mineral estate is severed and somebody else's gas is being drilled out from under my surface, I'm entitled to compensation for surface damages — pad sites, access roads, pipelines, frac-water impoundments. SUAs are negotiated separately from leases and run $10K–$80K per pad. AcreOS has no SUA record type. A PA surface-only owner without SUA awareness is leaving 5–6 figures on the table per producing pad.

**Coal severance is a separate animal.** Anthracite and bituminous coal in PA were severed long before oil and gas were on anyone's radar — much of northeastern PA has *coal severed in 1880, oil/gas severed in 1920, surface owned today*. Three estates, three chains, three sets of heirs. The platform's `mineralRights: 'severed'` field can't represent partial severance — coal gone, gas retained. That's the most common configuration in my counties.

**Subsidence risk.** Where coal was mined out a century ago, the surface can collapse. PA has the Bituminous Mine Subsidence Act (1966) and the Coal and Clay Mine Subsidence Insurance Fund. AcreOS's environmental intelligence doesn't surface subsidence risk; the PA-DEP has a public Mine Subsidence map I'd link to in twenty minutes if I were on the team.

**The DocuSign problem.** I sign maybe 40 instruments a year. Mineral deeds and oil-and-gas leases require notary acknowledgment in PA, and most county recorders won't accept a remote-online-notarized document for instruments that affect mineral title — they want wet signatures and a physical seal. I read the founder note about AcreOS shipping native e-sign. **Native e-sign without state-by-state recordability flags is going to cost somebody a deal.** Some PA counties accept Act 97 RON, some don't, and the line moves. The platform should know per-county whether RON is accepted for what instrument types — and where it isn't, fall back to print-and-mail with prepaid return.

---

## 4. Bottom line

AcreOS is built for the surface buyer — the wholesaler with a postcard list, the tax-deed flipper, the recreational-lot syndicator. For those people the product is fine and getting better. For an oil-and-gas-state Land Investor whose entire P&L lives in the subsurface, **the platform's mineral awareness is a lookup table missing my home state and a single integer in a credit-score model.**

**Two ship-tomorrow fixes:** add a PA entry to `MINERAL_RIGHTS` with `severanceRisk: "high"`, and add a `practitionerNotes` row for PA in `regulatoryIntelligence.ts` (it's missing — I checked). **One ship-this-quarter fix:** bifurcate the title chain into surface and mineral chains. **One ship-this-year fix:** model mineral estates as first-class assets with their own deeds, leases, royalty streams, and valuation. Without that last one, I'm not a customer. With it, I'm a $499/yr customer who'll bring you fifty more like me from the Pennsylvania Independent Oil & Gas Association directory.

The thirty-year-old land business in PA is a mineral-rights business wearing a surface-rights costume. AcreOS hasn't taken the costume off yet.

---

## 5. What would change my mind in 90 days

I'm not impossible to convert. PropertyShark gives me ownership and tax data, Doug gives me the abstract, DocuSign gives me a signature line. None of them talk to each other. A platform that **could** be the integration layer for my work would beat that stack — but only if it took the mineral estate seriously. Concretely, in priority order:

1. **PA in `MINERAL_RIGHTS` and `STATE_REGULATORY` with correct severance/risk and a Dunham-Rule note.** Half a day of work. Unblocks every PA user the platform will ever have. Do this Monday.
2. **Two-chain title model — `surfaceChain` and `mineralChain` as independent linked-event streams** on the parcel. Two weeks. Even without the abstractor integration, the data model alone is what lets the rest of the platform start representing severed estates correctly.
3. **`mineralEstate` propertyType with fractional-interest support, separate from `surface` parcels, joinable by APN.** A month. Lets me record my mineral-only acquisitions, build heir-consolidation pipelines, and value the subsurface separately.
4. **PA-DEP eGRID scraper.** The data is public, monthly, freely downloadable, and would let AcreOS surface "active well within 1 mile" / "permitted spud within 90 days" / "production reported last quarter" on every PA parcel. This is also the lowest-cost mineral-comp data source in the country. Two weeks for a competent backend engineer. Do this before adding another tax-delinquent scraper to a southern state.
5. **Doug.** Or someone like him. A vetted mineral-abstractor directory keyed by state and county, surfaced in a "find an abstractor" sidebar on every parcel in an oil-and-gas state. Nothing fancy. A list of names and phone numbers. The platform talks endlessly about "data" and not at all about the human network that actually closes mineral deals.

If I open the platform 90 days from now and four of those five exist, I'll bring the lease binder over. The fifth (Doug) is the one that turns it from a tool I tolerate into one I evangelize at the PIOGA fall meeting in Pittsburgh.

Until then — Tuesday morning, I'm still on PropertyShark and Doug's voicemail, and AcreOS is the tab I closed first.

One more thing. The persona switcher has a "Land Investor" mode and the founder dashboard has "intent" rules. Nowhere in any of those rule sets does the word "mineral" appear as a meaningful filter, segment, or trigger. If I'm a $499/year customer who buys mineral-only deeds in Bradford County and the platform's segmentation engine can't distinguish me from a guy buying tax-delinquent residential lots in Memphis, the platform isn't going to know what to ship me, what to alert me to, or what comp set to surface. **Mineral-investor as a first-class segment** would solve a lot of the above by routing only the relevant features and notifications to the people who care, while leaving the surface-buyer experience clean. Cheap to add. High signal.
