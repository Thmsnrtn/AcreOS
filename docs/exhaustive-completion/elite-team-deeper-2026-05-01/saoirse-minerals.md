# Saoirse McNamara — AcreOS user review

I'm 42, work out of Midland TX, and I've been a mineral-rights operator for fourteen years. I buy and sell oil & gas, hard-rock metals, and water rights — Permian for the bulk of revenue, Bakken when the bid sheet looks right, Marcellus when somebody inherits a mess and needs out, and a steady rotation of New Mexico potash and Arizona copper. My stack is DrillingInfo (now Enverus) for well data and lease schedules, two contract landmen who run county-courthouse runs in TX/NM/OK, and one Excel workbook called `royalty_runs.xlsx` that ties decimal interests to monthly check stubs from twenty-three operators. I'm not a "land investor" by AcreOS's definition. I never see the surface. I've never set foot on most of the parcels I own a fractional interest in.

I came in because the AcreOS pitch said "Land OS." Minerals aren't land surface. So either the platform handles severed estates as a first-class concept or it doesn't. Let's find out.

---

## 1. Thirty-second verdict

**No, today.** Minerals are a footnote in AcreOS, not a vertical. The product knows that mineral rights *exist* and can be severed — the schema acknowledges it, the regulatory layer flags Permian counties — but there is no mineral persona, no royalty-run tracking, no division-order workflow, no decimal-interest math, no NPRI/RI/WI taxonomy, no Form 1099-MISC reporting from operators, no production-tax calculator, no pooling/unitization model. The product is built for somebody who walks parcels and bids at courthouse steps. I do neither.

That said, the bones for a minerals product are *more* there than I expected. There's a `MINERAL_RIGHTS` registry per state with severance risk, dominant minerals, and surface-owner protections (`server/services/environmentalIntelligence.ts:122-204`). There's a `getMineralRightsInfo(state)` function and a route at `/api/environmental/mineral-rights/:state`. There's a `mineralRights` field on listing syndication payloads. There's a credit-scoring weight for mineral rights in `landCredit.ts`. The framework grasps that minerals are a thing. It just doesn't grasp that minerals are *somebody's whole business*.

Verdict: I'd evaluate again in twelve months. Today I'd cancel the trial in week one because there's nothing here for me.

---

## 2. The "Land OS but minerals aren't land surface" question

This is the foundational positioning issue. The whole product is named, themed, and copy-written for *surface* land — the parcel, the photo, the soil quality, the road frontage, the field-scout walk-through, the comp-sales price-per-acre. None of that is my business. My business is decimal interests in subsurface estates that may or may not have a producing well on them, accumulated across hundreds of micro-positions where I own 0.0078125% of one section's royalty stream.

Three options, in increasing order of seriousness:

1. **Acknowledge the boundary.** AcreOS is for surface-land investors. Minerals are out of scope. Say so on the marketing site. Don't list mineral rights in the disclosures checklist if you don't have the workflow behind it. This is honest and small.
2. **Add minerals as a ribbon feature.** Every parcel has a "Mineral status" panel — owned/severed/unknown/leased — driven by the `getMineralRightsInfo` data plus a manual override per parcel. This is what the product is *currently aiming for*, and it half-works. Useful to a tax-delinquent buyer who wants to know whether the courthouse parcel they just bought came with the minerals. Useless to me.
3. **Treat minerals as a first-class vertical.** A mineral persona ("Mineral Investor"), a parcel concept that's a *tract+section+abstract+depth-interval* not just a polygon, a portfolio of fractional interests with decimal math, a check-stub ingestor, a division-order tracker, a pooling/unitization model, a 1099-MISC matcher, a Pax that knows the difference between a 3/16 royalty and a 1/8th lease. This is the real product for me. It's also a 12-month build with a domain expert in the room.

I think option 2 is what AcreOS will actually do, and that's fine — but call it what it is. Don't market "Land OS" as a minerals product. The surface investor and the mineral investor are not the same operator and we don't share a workflow. If AcreOS wants my segment, that's a separate SKU.

---

## 3. The seven things I actually need

### 3a. Severed estates — chain of title in two dimensions

Surface chain of title is what `titleChainService.ts` does. Mineral chain of title is a *parallel* chain — the surface deed in 1948 conveys to A, the minerals were reserved in 1923 by the original homesteader and pass through three intestate successions and a 1971 partition deed. By 2026, the minerals under one section are owned by 47 cousins descended from the 1923 reserver. **AcreOS has no concept of a mineral-only conveyance.** The title-chain UI is a single ordered list of grantor→grantee. Real mineral title runs *two* lists side-by-side and tracks where they fork (a "severance event") and where they re-merge (rare but it happens).

Concrete request: extend `titleChainService` to return `{ surfaceChain: [...], mineralChain: [...], severanceEvents: [...] }`. Each severance event is a deed-of-record that conveys minerals separately from surface. The Permian counties (Reeves, Loving, Martin, Midland, Upton, Crane — and AcreOS already has these listed in `routes-deals.ts:675`) are the obvious launch counties.

### 3b. NPRI vs RI vs WI vs ORRI — taxonomy first

These are not interchangeable terms.

- **Working Interest (WI)** — owns the right to drill, bears the cost of drilling, gets the lion's share of revenue post-royalty. This is the operator side. Subject to lease operating expenses (LOE).
- **Royalty Interest (RI)** — the lessor's reserved fraction (commonly 1/8 to 3/16, sometimes 1/4 in hot plays). Costs-free; gross revenue × decimal interest = monthly check.
- **Non-Participating Royalty Interest (NPRI)** — a royalty carved out of the mineral estate that does *not* participate in lease bonus or delay rentals. Just royalty when production happens. Usually inherited or gifted; common in family-trust splits.
- **Overriding Royalty Interest (ORRI)** — carved out of the working interest, expires when the lease expires. Common to compensate landmen and brokers.

AcreOS has *zero* fields for any of this. The `mineralRights` field on a listing is a boolean ("included / not included"). For my use case the four buckets above need to be a typed enum with their own decimal-interest field, expiration-event field (for ORRI), and cost-bearing flag (for WI). Everything downstream — revenue, tax, valuation — depends on which bucket.

### 3c. Three revenue streams — bonus, delay rental, royalty

A mineral lease pays three different things:

- **Lease bonus** — paid up-front when you sign the lease. $50–$30,000+ per net mineral acre depending on the play. One-time, taxed as ordinary income, reported on 1099-MISC box 1 ("rents") in some operator schemas, box 3 ("other income") in others — and yes, the operator gets to choose, and yes, that materially affects my self-employment-tax exposure.
- **Delay rental** — paid annually during the primary term if no production has commenced. Often $1–$5/acre/year. Some leases are "paid-up" and skip this.
- **Royalty** — paid monthly once production starts, based on a decimal interest applied to gross revenue minus state severance tax minus post-production costs (where the lease allows them to deduct, which is itself a holy war).

`bookkeeping.ts` knows about 1099-INT for note investors. It knows nothing about 1099-MISC from oil & gas operators. **The minerals 1099-MISC ingestor is the single most useful feature AcreOS could build for my segment.** Drop a stack of January 1099s onto the platform, parse the operator EIN, the state, the box-1 vs box-3 split, the gross royalty, the severance tax withheld, and reconcile to my expected royalty-run total. That alone is worth $99/mo.

### 3d. Pooling and unitization — the operator can pool me without asking

In Texas a unit can be pooled by majority of working interest owners (the Mineral Interest Pooling Act, 1965). In Oklahoma the Corporation Commission can force-pool me. Once my tract is pooled into a 640-acre unit, my decimal interest changes — it's now (my net mineral acres / unit acres) × my royalty fraction. **The math is non-trivial and operator-supplied division orders are wrong about 8% of the time** in my experience. I check every one against my own calculation in `royalty_runs.xlsx`.

Concrete request: a `unitization` model with unit name, unit acres, my tract acres, my net mineral acres, my decimal interest, the operator's stated decimal interest, and a delta flag if the two don't match. State-specific pooling rules (TX MIPA, OK forced pooling, NM compulsory, ND statutory unitization) belong in the same registry as the existing `MINERAL_RIGHTS` table. Today there's no `unit` concept anywhere in the schema.

### 3e. Production / severance tax — varies by state, by mineral, by year

- **Texas** — 4.6% on oil, 7.5% on gas, exemptions for high-cost/marginal wells.
- **Oklahoma** — 5% gross production tax on oil & gas (dropped from 7% in 2014, raised back to 5% from a 2% sliding scale on horizontals — moving target).
- **New Mexico** — 3.75% oil & gas severance + 0.19% conservation tax + emergency school tax. Layer cake.
- **North Dakota** — 5% gross production + 6.5% extraction (with trigger-price relief on stripper wells).
- **Pennsylvania** — no severance, an "impact fee" instead. Marcellus operators love this.

A working severance-tax calculator is one weekend of code if the rate table is right and *kept current*. The operator withholds at point-of-sale before they cut my royalty check, but I still need the gross-vs-net reconciliation for my own books, and for state-by-state apportionment when I file (I'm a TX resident with NM and OK income — three returns, three apportionments).

`regulatoryIntelligence.ts` already has practitioner notes for OK and AL acknowledging "oil and gas mineral rights are often severed." Good. But there's no rate table, no calculator, no per-month per-state rollup. That's the next layer.

### 3f. Form 1099-MISC reporting — I get 23 of these every January

Twenty-three operators. Twenty-three EINs. Twenty-three different formats (PDF mostly, some still mailed paper, two via QuickBooks portals, one via DocuSign, one via a 1990s-vintage operator portal that requires a Java applet). I sit at the kitchen table on a Saturday in early February and key these in by hand. Total time: 4-6 hours. Total dollar value parsed: ~$340K of royalty income last year.

**An ingestor that takes a stack of PDFs, extracts payer EIN, recipient TIN, box 1, box 3, box 4 (federal withholding, rare but happens), box 7 (state tax withheld), and matches them to existing royalty-run records — that's a $200/mo feature for me.** Easily. Today the bookkeeping module is income-statement-shaped, not 1099-shaped. The two are related but not the same.

### 3g. The "what is this parcel" surface

When I look at a parcel page in AcreOS today (e.g. `/parcels/:id`), I see soil quality, topography, comps, zoning, road frontage, neighbors. **I want none of these.** I want: section/township/range, abstract number (for TX) or survey number (for NM), depth severance ("from surface to base of San Andres formation"), my decimal interest, the lessee of record, the lease primary term and HBP status, the most recent producing well within the section, the operator's ownership in the unit, and the last royalty-run amount. Same data table, completely different fields. Persona swap, again.

---

## 4. The DrillingInfo / Enverus integration question

I pay Enverus $850/mo for what amounts to a giant well-and-lease database. If AcreOS could ingest an Enverus export — well headers, completion records, production volumes, lease assignments, decline curves — and overlay it against my decimal-interest portfolio, that's a workflow. If AcreOS tries to *replace* Enverus, that's a six-figure database licensing fight against incumbents who've been at this since 1999 (DI), 2003 (HPDI), and 1985 (IHS Markit). Don't replace — *integrate*. Build an Enverus connector and a TGS connector and a S&P Global Commodity Insights connector. Mineral operators already pay for the data; we want it surfaced in our portfolio view.

This is the same architectural pattern AcreOS already uses for surface data via the provider registry (`server/services/providers/`). The minerals version is the same shape with different vendors.

---

## 5. Per-surface friction — what I touched that didn't fit

**`/parcels/:id`** — Composed parcel view loads fast, looks good, has a clean breadcrumb (the recent `PageTopbar` commit). Tells me nothing about minerals beyond a probable severance flag in the environmental-intelligence card. The card itself (`environmental-intelligence-card.tsx:245-271`) shows severance risk, dominant minerals, surface-owner protections — useful as a *flag for surface buyers*, useless for me as a *mineral buyer*. I need a sibling component, `MineralPositionCard`, that loads my decimal interest and current royalty-run state for that section. Doesn't exist.

**`/title-search`** — Renders a single-column chain. Mineral title is two columns. Won't work for me without a layout change.

**`/today`** — Pulse score, lead reminders, deal pipeline. None of these match my month. My month is: the 25th-of-month royalty-run window (when most operators cut checks for the prior month), the 10th-of-month landman update, the quarterly division-order audit, the annual February 1099 reconciliation. **Build a `today.minerals` widget** that shows expected royalty-run totals vs. actuals, division orders pending signature, lease-expiration alerts, and 1099 reconciliation status in February. The persona registry can swap it.

**`/onboarding-v2`** — Lists land_investor, note_investor, tax_delinquent, wholesaler, subdivider, fix_flipper, landlord. **No mineral_investor.** That's the front-door tell. Persona vocabulary at `client/src/lib/personaVocabulary.ts:111-119` is missing my entire industry.

**`/pax`** — Pax doesn't know what NPRI means. I tested. It generalized to "non-participating royalty interest is a type of royalty," which is technically correct and operationally useless. Pax needs a minerals knowledge pack: lease taxonomy, common decimal-interest math, severance-tax tables, the standard division-order pitfalls, how to read a check stub. This is one focused dataset and a system-prompt swap when the persona is mineral_investor.

**`/documents` and signing** — The HMAC-link signing flow is fine for division orders (which I sign 30-50 of a year). What's missing is a *division-order template library* and a *decimal-interest verification step* on the document itself. I should never sign a DO without the platform recomputing my decimal from net mineral acres / unit acres / royalty fraction and flagging a delta. AcreOS has the signing flow; it's missing the verification.

**`/inbox`** — Operators send me a mix of: monthly check stubs (data, ingest), division orders (action, sign), force-majeure notices (ack), shut-in royalty notices (track for reactivation), pooling notices (decision, may need to dissent within statutory window). **Each of these is a different workflow.** A generic AI-drafted reply is dangerous here — replying to a pooling notice as if it's a marketing email could waive my dissent rights. Pax should refuse to auto-draft on operator correspondence and route to me with a flag.

**`/counties`** — Better fit for me than for a tax-delinquent operator, actually, because I think in counties too (Reeves, Loving, Lea, Eddy, Williams, McKenzie). But the per-county data is surface-flavored — it shows tax-roll and zoning, not active rigs / horizontal permits / spacing-unit boundaries / state-mineral leasing schedules. Same surface, different data layer.

---

## 6. The legal-compliance test — fail with caveats

The same fail mode I'd flag for the tax-delinquent persona shows up here: the platform must not give me legal advice on mineral title, lease interpretation, or pooling rights. It can flag the issue and route to my landman or my oil-and-gas attorney. Don't have Pax tell me whether my Permian lease's Pugh clause is enforceable post-extension. That's a $400/hr conversation with a Midland O&G lawyer, not a chatbot answer.

The 1099-MISC ingestor needs to be careful with TIN handling — these are SSNs and EINs, PII-grade, and the bookkeeping module's existing posture doesn't address tax-doc retention specifically. Talk to Anouk on privacy and Hana on tax before shipping.

---

## 7. The hard-rock and water-rights side — even thinner

I deal in three families: oil & gas (the bread), hard-rock metals (copper/molybdenum/lithium positions in AZ, NV, CO), and water rights (CO senior decrees, NM permits, AZ AMA-locked rights). AcreOS treats these the same way it treats oil & gas — with a state flag and a notes blob. They are not the same workflow.

**Hard-rock minerals.** Royalty-bearing leases here are negotiated as either net smelter return (NSR — typically 1-5%) or gross overriding royalty (GOR), and the math is a different beast from oil & gas. NSR pays after smelter charges and refining costs; the deduction list is in the lease and is fought over in audits. AcreOS would need an `nsrDeductions` field, a per-mine smelter contract registry, and a way to ingest quarterly mining reports (10-Q-style filings for public miners, K-1s for partnerships). None of that exists. The `MINERAL_RIGHTS` table flags Arizona for copper/gold/silver/sand_gravel and that's the floor — there's no ceiling.

**Water rights.** The water rights table at `environmentalIntelligence.ts:20-101` is *better* than the mineral table — ten states, prior-appropriation vs riparian vs hybrid, transferability, notes. For somebody trading senior CO decrees this is a good first-glance card. But it's still a state-level overview, not a position tracker. If I own a 17-acre-foot Greeley Canal Co. share with 1872 priority, I want a `waterPosition` model with priority date, decreed amount vs historical use (which sets the transferable amount), seasonal limits, and a change-of-use proceeding tracker. Today AcreOS has the encyclopedia; it's missing the ledger.

The pattern across all three: AcreOS knows the rules well enough to advise a *surface buyer who's curious about a side issue*. It doesn't know the workflow well enough to be the system-of-record for an *operator whose whole P&L is that side issue*.

---

## 8. What a six-month minerals MVP would look like

If AcreOS asked me to scope a credible v1 — not the full vertical, but enough to win the Tier-2 Permian operator — here's the order:

1. **Persona + persona vocabulary.** Add `mineral_investor` to the registry. Pipeline stages: Prospect → Title verified → Offer made → Conveyance signed → Recorded → Producing → Plugged. Pulse score off, replaced by a royalty-run on-time score.
2. **Mineral position model.** New table `mineral_positions` with section/township/range, abstract or survey, depth severance, decimal interest, RI/NPRI/ORRI/WI bucket, lessor of record, lease state. Owned by an organization. One parcel can have many positions; one position can span many surface parcels.
3. **Division-order ingestion + verification.** Upload PDF, parse, recompute decimal from net-mineral-acres / unit-acres / royalty-fraction, flag deltas above 0.5%. Sign via the existing HMAC flow only if delta is zero or operator override is on file.
4. **Royalty-run ledger.** Monthly check stubs ingested as PDF, normalized into a `royalty_runs` table with operator, well, period, gross revenue, severance tax, net check. Reconcile to expected (decimal × gross × (1 - severance rate) - post-production deductions). Flag deltas.
5. **1099-MISC reconciliation in January.** Ingest stack of 1099s, match payer EIN to operator, sum box 1 + box 3, reconcile to twelve months of royalty-run net. Generate a CPA-ready export.
6. **Severance-tax calculator.** State rate table, refreshed annually. TX/OK/NM/ND/PA/WV/LA/CO at minimum. Applied at royalty-run normalization time.
7. **Enverus connector.** Read-only integration that pulls well headers and production data for a list of operator/lease/section keys. License the data via the existing provider registry pattern.

That's six months with two engineers and one domain expert. Out of scope for v1: forced pooling dissent workflows, NSR lease audits, water-decree change-of-use filings, mining-quarterly ingestion, ORRI expiration tracking. Those land in v2.

The thing I'd watch for: don't build minerals as a feature toggle on the existing parcel model. The data shape is genuinely different — a section with 47 fractional-interest owners across three depth intervals does not fit in a `parcels` row. New table, new persona, new today widgets, new Pax knowledge pack. Otherwise you ship a half-product that nobody trusts.

---

## 9. The Wave-3 verdict

AcreOS is not a minerals product today. It's a surface-land product that *acknowledges* minerals exist. For my segment to evaluate it seriously, it needs:

1. A mineral_investor persona in `personaVocabulary.ts` with its own pipeline stages, today widgets, and Pax knowledge pack.
2. A mineral-position model that's not a parcel polygon — section/township/range, depth severance, decimal interest, three revenue streams, lease state.
3. A division-order workflow with decimal-interest verification.
4. A 1099-MISC ingestor and severance-tax calculator.
5. A title-chain UI that runs surface and mineral chains in parallel.
6. Vendor connectors for Enverus / TGS / S&P, not a replace-them play.
7. A pooling/unitization model with state-specific rules driven off the existing `MINERAL_RIGHTS` registry.

That's a 12-month vertical build. If AcreOS commits to it, I'm a Tier-1 reference customer for the Permian. If not, the honest move is to drop "Land OS" framing for minerals and ship the small option (parcel-level severance flag, no more) without overpromising.

Either path is fine. The dishonest path is selling minerals as a feature when it's a checkbox.
