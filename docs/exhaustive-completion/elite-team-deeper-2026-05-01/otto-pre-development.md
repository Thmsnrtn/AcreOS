# Otto Lindqvist — AcreOS, the pre-development lens

I'm Otto. Fifty-six. Phoenix. I buy 5 to 30-acre tracts on the fringe of Maricopa and Pinal — the kind of dirt where the City of Buckeye annexation map is more important than the property tax bill — and I push them through 12 to 24 months of entitlement work before I hand them to D.R. Horton, Lennar, or Pulte. My deals run $500K to $5M. My P&L lives or dies on three numbers I almost never see in a CRM: yielded units per acre, tap-fee schedule per door, and the takedown cadence in the builder option contract. I'm reading AcreOS to find out whether it understands that I'm not a flipper, not a noteholder, and not a wholesaler — I'm a manufacturer of finished lots.

---

## 1. Thirty-second verdict

AcreOS is built for people whose deal closes in 90 days. Mine closes in 730. The platform's center of gravity — pipeline → blind offer → seller-finance note → exit — is fundamentally the wrong shape for pre-development work, and the gap shows up in the schema. `shared/schema.ts:41` lists fourteen `businessType` enums and `developer` is one of them, but `server/services/dueDiligenceEngine.ts` defines `BusinessDDType = "fix_and_flip" | "buy_and_hold" | "commercial"` — three values, none of which are mine. The marketing surface admits developers exist; the engine doesn't have a checklist for them. That mismatch is the whole story.

The good news: the bones are right. There's a zoning service (`server/services/zoningService.ts`), a wetlands/environmental engine, a parcel intelligence fusion layer, and a buyer-network module. If I were the head of product I would tell my team that 70% of what a pre-development operator needs is already in the codebase — it's just shaped for the wrong workflow.

At Pro: I can use it as a sourcing CRM for the front of my funnel. At Scale: not until there's an entitlement-state machine. At a hypothetical "Developer" tier: I'd pay $400/mo if it actually tracked tap fees, plat milestones, and a builder takedown ledger.

---

## 2. Daily-use walkthrough — Tuesday in Buckeye

**7:00 AM.** Phoenix is already 92°. I open `/today` in the truck. The dashboard is built for someone who closed two seller-finance notes yesterday and needs to chase callbacks. I have three live entitlement files in three different cities, two of which had planning commission hearings last night. **I need a surface that says: "Litchfield Park PC voted 5-2 to recommend approval of your PAD amendment; staff report posted at 11:47 PM; next stop is Council on June 18."** Pulse score doesn't help me track a 730-day timeline.

**8:15 AM.** New parcel comes across — 18 acres in unincorporated Pinal, owner motivated, asking $3.2M. I add it. The DD checklist is the wetlands/EPA/soils engine, which is good infrastructure but it's not the right checklist for me. My DD list is: (1) is this in a Municipal Planning Area? Whose? (2) what's the General Plan land-use designation and is rezoning realistic? (3) can it sewer? Where's the nearest 12" main? Will the City extend or am I funding a lift station? (4) water — CAGRD enrollment, AWS designation, central Arizona Water service area? (5) traffic impact — is there an existing TIA in the corridor I can ride on? (6) school district capacity letter availability. None of those six fields exist on the parcel record.

**9:30 AM.** I want to underwrite this thing. `/deal-underwriting` exists. For a flip the math is purchase + hold + exit. For me the math is purchase + 24 months of carry + entitlement spend ($350K-$1.2M of soft costs) + tap fees ($18K-$32K/door times yielded units) + bond-for-improvements + builder lot price × takedown schedule discounted to NPV. **AcreOS has no concept of soft-cost capex amortized over a hold period, no concept of a yielded-unit count, no concept of a deferred takedown.** The deal calculator is treating my $3.2M acquisition as if I'm reselling for $4.5M next quarter. The IRR it spits out is meaningless.

**10:45 AM.** Zoning lookup. `/zoning-lookup` and `server/services/zoningService.ts` pull from Zoneomics. Fine for a single-parcel current-use call. **What I need:** the General Plan designation (which is *future* land use, not current zoning), the underlying entitlement history (was this property part of a denied PAD in 2019?), and the density allowance under the GP — units per acre, including any density bonus mechanisms. Zoneomics returns "minimumLotSize" but not "maximumDensity," and that inversion is everything for me. A 5-acre tract zoned R1-43 (one acre minimum) is worth $200K. The same tract under a GP designation of "Medium Density Residential, 4-8 du/ac" with a path to rezone is worth $1.6M. AcreOS sees the first number, not the second.

**12:00 PM.** Lunch with the city engineer at Buckeye. He tells me a 24" sewer trunk is going in along Broadway Road in Q3 2027 and any project tying into it before that has to upsize at the developer's cost — recoverable through a development agreement. **Where do I record this in AcreOS?** It's not a note, not a contact, not a document. It's a *city-side intelligence event* on a parcel that affects the underwriting, the timeline, and the option negotiation with the builder. Right now I write it on the back of a Bashas' receipt and lose it within the week.

**1:30 PM.** I update the entitlement schedule on my Litchfield Park file. There are 31 stages: pre-app meeting, neighborhood meeting, PAD application, staff review (3 rounds), DRC, P&Z, Council, recordation of zoning, preliminary plat, civil engineering 30/60/90/100, dry utility coordination, final plat, mylars, plat recordation. Each has a city-side cycle time, an internal cycle time, a critical-path dependency, and a soft cost. **There is no project-management surface in AcreOS that handles this.** `/deals` has stages, but they're sales stages — `prospect / negotiating / under_contract / closed` — not entitlement stages. I'd build this in Smartsheet or Monday.com and AcreOS becomes a CRM bolted to a parcel record.

**3:00 PM.** I draft a builder option contract. This is *the* document of my business. A Lennar option for finished lots in a Buckeye master plan looks like: $X per finished lot, 15% earnest money against future takedowns, takedown of 24 lots/quarter starting 60 days after final plat recordation, with a force-majeure clause and a market-adjustment formula tied to MLS new-home median. **AcreOS has nothing.** No builder option template, no takedown schedule generator, no NPV table for staggered closings. The closest thing is `offer-wizard.tsx` and that's pointed at seller-finance retail buyers.

**4:30 PM.** Builder relationship management. I have eight active relationships — three at D.R. Horton (land acquisitions, division president, regional president), two at Lennar, two at Pulte, one at Tri Pointe. Each is a relationship measured in years. Each gets a quarterly land update. Each has different absorption preferences (DRH wants 40-foot lots, Pulte wants 50s, Lennar takes anything that pencils). **`/buyer-network` is built for retail land buyers searching parcels by acreage and price.** It's not a builder CRM. The schema (`buyerNetwork.ts`) tracks `BuyerBehaviorEvent` with `eventType: 'property_view' | 'search' | 'save_favorite'` — that's an MLS shopper, not a $400M land acquisitions executive who buys two communities a year. I need contact-relationship history, last-touch, last-deal, lots-under-option, lots-taken-down YTD, and absorption velocity per relationship. None of that is here.

**5:30 PM.** Comp pull for a builder pitch. I want every finished-lot transaction in the West Valley over the past 24 months — buyer (which builder), seller, lot count, lot widths, finished-lot price, takedown structure, escrow agent, recording date. That's a queryable comp set worth $30K-$50K to me per pitch because it's how I justify my ask to a Lennar acquisitions guy. AcreOS has comps via `comps.ts` but it's tuned to single-parcel raw-land comps, not finished-lot bulk-sale comps to production builders. Different data feed (county recorder), different join (multi-lot conveyance), different metadata. Build it once per MSA and you own that segment.

**6:30 PM.** Builder pitch — I'm sending DRH's land team a tract overview. PDF, 12 pages, with aerials, GP exhibit, conceptual yield study, infrastructure plan, traffic memo summary, school capacity letter, and a price-per-finished-lot back-into. **AcreOS's `/documents` has no builder pitch packet template.** It has TREC-style purchase contracts for retail land. I'd love to type "generate builder offering memorandum" and have it pull the parcel data, the entitlement status, and the conceptual yield, and output the deck. Two weeks of feature work. Massive lift for the developer market.

**8:00 PM.** Carry-cost report. Property tax on a 22-acre Maricopa hold runs $14K/year. Mowing/weed abatement is $2,400/quarter. SRP irrigation hold-charges are $800/quarter. Insurance on a vacant tract is $1,800/year. Add interest on the 60% LTV land bank loan at 8.5% — that's $135K/year on a $2.65M loan. My all-in carry is north of $200K/year per project, and I'm running four. `server/services/costBasisTracker.ts` exists. Does it amortize soft costs? Does it categorize entitlement spend separately from carrying costs separately from hard costs? My CPA needs that breakdown for the cost-segregation study at exit. I don't think it does.

**9:30 PM.** I check my Pinal County file. Pinal is its own animal — most of the land I'd want is unincorporated and in the Maricopa-Pinal County's "Comprehensive Plan" area, which means rezone goes to Board of Supervisors not a city council, and the county uses a CR (commercial residential) and SR-43 (single-residence 43,000 sq ft) base zoning that's nothing like the cities. AcreOS doesn't differentiate jurisdiction *type* — incorporated city vs. county vs. tribal trust land vs. State Land Department lease. Each has a fundamentally different entitlement path. State Trust Land in particular (Arizona has 9.2M acres of it) requires a public auction; you can't just contract with the Land Commissioner. That nuance has to live in the parcel record.

---

## 3. The pre-development test — what passed, what didn't

**Pass:**
- `developer` is a valid `businessType` enum (`shared/schema.ts:41`)
- `profileType` includes `developer` and `builder` (`shared/schema.ts:7950`)
- Zoning lookup integration exists (`zoningService.ts`)
- Wetlands and environmental DD engine works for Phase I-style screening
- Parcel intelligence fusion exists for layered data joins
- Cost-basis tracker exists in some form
- Buyer-network module gives the bones for a builder CRM

**Fail or Missing:**
- **No `developer` DD template** in `dueDiligenceEngine.ts` despite `developer` being a recognized business type. This is the single most embarrassing gap in the codebase for my workflow.
- **No entitlement state machine.** The 31-stage process from pre-app to plat recordation has no representation. `/deals` stages are sales stages.
- **No General Plan / Future Land Use designation** field on parcels — only current zoning. For pre-dev work this inverts the value.
- **No yielded-unit calculator.** Density × net acreage × yield factor → expected door count is the core underwriting math.
- **No tap-fee / impact-fee schedule** by jurisdiction. Buckeye, Goodyear, Surprise, Maricopa each have a different schedule that updates annually. There's no per-jurisdiction fee table.
- **No builder option contract template** or takedown schedule generator.
- **No NPV-of-staggered-takedown** calculation in the deal calculator.
- **No civil engineering / consultant ledger.** I pay civil, traffic, environmental, surveyor, landscape architect, entitlement counsel separately on every deal. Tracking soft-cost spend by consultant by parcel is fundamental.
- **No bond / surety tracking.** Subdivision improvement bonds, performance bonds, warranty bonds — each has an issuer, a draw schedule, a release condition.
- **No development agreement repository** — DAs and pre-annexation agreements are the most important documents in my filing cabinet and AcreOS has nowhere to put them.
- **No "city intelligence" surface** — planning commission agendas, council hearings, capital improvement plan updates, sewer master plan amendments are events I need to track per jurisdiction.
- **`buyerNetwork.ts` is a retail-shopper schema**, not a relationship-managed builder CRM. `BuyerBehaviorEvent` is for MLS clicks, not for tracking that DRH took down 18 lots in Q1.

Net: AcreOS recognizes that developers exist as a customer segment; it has not yet built the surfaces a developer needs to operate.

---

## 4. Per-surface friction (pre-development)

**`/parcels/:id`** — Add: General Plan designation, Municipal Planning Area, annexation status, sewer service area, water provider, school district + capacity, current entitlement stage, yielded-unit estimate. Zoning is one field of nine I need.

**`/deal-underwriting`** — Needs a "Pre-Development" mode. Inputs: gross acres, net acres after dedications (typically 75-85% net), yielded units, finished-lot price by builder type, takedown schedule (lots × quarters), soft-cost budget, hard-cost budget, tap fees per door, hold period, construction loan terms. Output: NPV, IRR, peak capital, exit at takedown completion. The current calculator treats this as a flip and breaks.

**`/buyer-network`** — Bifurcate into "Retail Buyers" (current schema) and "Production Builders" (new). Builder schema needs: company, division, contacts by role, absorption preferences (lot widths, price points, geographies), last 8 quarters of takedown velocity, lots currently under option with me, lots taken down YTD.

**`/documents`** — Add a Pre-Development pack: builder offering memorandum, builder option contract (with takedown schedule generator), pre-annexation agreement template, development agreement template, lot purchase agreement, escrow instructions for takedown closings.

**`/finance`** — Land bank loans, mezz, equity partners, JV waterfalls. None of this is here. My capital stack is not seller-finance. It's a regional bank line + an equity partner taking 30% of the promote above an 8% pref. I'd want JV waterfall modeling.

**`/zoning-lookup`** — Layer in General Plan, recently approved nearby PADs, recent rezone denials, planning commission decisions trend by jurisdiction. Current-zoning-only is insufficient.

**`/portfolio`** — Reorganize from "deal stage" to "entitlement stage." Show tract-level: months-in-process, soft-cost-spent vs. budget, next milestone, milestone owner, days-until-next-hearing.

**`/onboarding`** — When I select `developer` as my business type, the wizard should branch into a developer-specific path: jurisdictions I work in, builder relationships, typical deal size, capital structure. The current onboarding (`OnboardingWizard.tsx`) treats everyone like they're flipping a 1-acre lot in rural Texas.

**`/pax`** — Pax should know I'm a developer and prioritize: "Buckeye P&Z published the agenda for June 11 — your project is item 7" or "Lennar's Q1 earnings call mentioned reducing land-banked positions by 8% in Phoenix MSA, watch for option re-trade pressure." Right now Pax surfaces stale-lead nudges.

**`/pricing`** — Build a Developer tier at $299-$499/mo. Bundle: entitlement state machine, builder CRM, JV waterfall, jurisdictional fee schedules, civil consultant ledger, development agreement vault, builder offering memo generator. There is real budget in this segment — I spend $40K-$80K/year on entitlement consultants alone — and a tool that consolidates tracking is worth $5K/year easily.

**`/field-scout`** — For me this means windshield-time at the property: photos for the conceptual site plan, a quick walk-around to see drainage, slopes, neighbor's adjacent use. The offline sync is right. Add: a "drop a yield-conceptual point" so I can stand on a corner and tag the high points and low points for the drainage exhibit.

**`/compliance`** — Pre-dev compliance is its own beast. SWPPP (Stormwater Pollution Prevention Plan) is a federal NPDES requirement once I disturb more than an acre. Section 404 wetlands permits run through the Army Corps. ESA Section 7 consultation if there's a listed species (in Arizona that's mostly the desert tortoise and the cactus ferruginous pygmy-owl). None of these are tracked. They're each a permit with an issuer, a duration, an inspector, and a renewal cycle. AcreOS could be the system of record.

**`/integrations`** — The pre-dev workflow needs ArcGIS Online, Bluebeam Studio, Procore, and the city e-permitting portals (TRACS in Phoenix, Citizen Self Service in Buckeye, Accela in many others). None of these are integration targets in the current registry. The plumbing is there (`server/services/providers/`) — the providers just don't exist yet.

---

## 5. What's missing for pre-development — in priority order

1. **Entitlement state machine.** A configurable 20-40 stage workflow per jurisdiction with cycle times, soft-cost line items, and dependency tracking. Foundational. Without this, AcreOS can't serve a developer at all.
2. **Pre-development DD template** in `dueDiligenceEngine.ts`. The `developer` business type is named in the schema; the checklist is empty. Trivial fix that makes the platform appear less hostile to the segment.
3. **General Plan / Future Land Use field** on parcels, with density allowance, with rezone-feasibility scoring.
4. **Builder CRM** as a separate surface from retail buyer-network. Relationship-tracked, takedown-velocity-tracked.
5. **Builder option contract generator** with takedown schedule and NPV math. This is the contract template that makes my business possible.
6. **Per-jurisdiction tap-fee / impact-fee schedule.** Maricopa County, plus the 12 incorporated cities I work in. Annual update process.
7. **Soft-cost / consultant ledger** by parcel by consultant by category, with budget-vs-actual.
8. **JV waterfall modeling** in `/finance` — preferred return, catch-up, promote tiers.
9. **Bond and surety tracking.**
10. **City intelligence feed** — agendas, staff reports, council decisions, CIP updates, by jurisdiction, by my watchlist.
11. **Jurisdiction-type differentiation** — incorporated municipal vs. county unincorporated vs. State Trust Land vs. tribal. Different paths, different counterparties, different timelines. Right now every parcel looks the same in the record.
12. **Adjacency intelligence** — am I next to an active master-planned community? Is the adjacent property under contract to a builder? Is there a CFD (Community Facilities District) on adjacent land that could be expanded to include mine? Adjacency is a 30% value driver and there's no surface for it.

---

## 6. Pricing reaction (pre-development operator math)

I run 4 active entitlement projects, average 22 months hold, average $1.4M acquisition, average $640K soft cost, exit at average $4.8M to builders. Three projects/year exiting at staggered cadence — ~$14M GMV. My current annual stack:
- Smartsheet (entitlement schedule): $25/user × 4 = $1,200
- Salesforce (builder CRM): $1,800/user × 1 = $1,800
- ArcGIS Pro (mapping/yield studies): $1,500
- Bluebeam (plan markup): $260
- DocuSign: $480
- QuickBooks Enterprise (cost-tracking): $1,800
- Outside entitlement consultants: $40K-$80K/year (not replaceable by software, but better tracking saves ~10%)
- Title-and-survey: $8K-$15K/deal
- My time on tracking, ledgering, consolidating: ~10 hours/week ≈ $26K/year of opportunity cost at $50/hr blended

Software stack alone: ~$7K/year. AcreOS at Scale ($79/mo = $948) doesn't replace any of it because the surfaces aren't there. AcreOS at a Developer tier of $399/mo = $4,788 *would* replace Salesforce + Smartsheet + most of the QuickBooks cost-tracking *if* the entitlement state machine, builder CRM, and consultant ledger ship. That's a $7K → $4.8K cash savings *plus* recovering 5+ hours/week. I switch.

Miss the entitlement state machine and I keep Smartsheet. Miss the builder CRM and I keep Salesforce. Either miss alone breaks the value proposition.

---

## 7. The deal-killer

For pre-development specifically: **the entitlement state machine.** Without a way to model a 24-month, 31-stage, multi-jurisdictional, multi-consultant workflow, AcreOS is a sourcing tool — useful at the front of my funnel, useless once I have the parcel under contract. And the front of my funnel is six weeks of work; the rest is two years. A tool that helps with the six weeks and abandons me for the two years is not the system of record I'm looking for.

For me personally: **the builder option contract and the takedown schedule.** This is the document and the math that defines my exit. It's how I get paid. It is the most asymmetric leverage point in the entire pre-development stack — get the option terms right and I make a 35% IRR; get them wrong and I make 12% on a 24-month hold which I could have beaten in a treasury. AcreOS has nothing here. Not a template, not a calculator, not a comp library of builder option deals by builder by year by MSA. That's a moat someone is going to build, and if it isn't AcreOS it'll be a vertical SaaS company aimed at the 4,000 active small-to-mid-cap land developers in the Sun Belt who all have this exact problem.

The opportunity is large. Pre-development land is a $40B/year acquisition market in the U.S. The personas in this market are sophisticated, well-capitalized, and software-tolerant — we already pay for Salesforce, Smartsheet, ArcGIS, and Bluebeam. We're not the seller-finance-note crowd that's hard to get to subscribe. We will pay $400/mo without blinking if the surfaces work. AcreOS has the bones. It needs the developer-specific flesh.

Until then: I'd use AcreOS as a sourcing CRM at the very front of my funnel, and stay on my existing stack the moment a parcel goes under contract. That's a $79/mo customer, not a $399/mo customer. The difference is whether the team builds the entitlement machine in the next two quarters or not.

— Otto
