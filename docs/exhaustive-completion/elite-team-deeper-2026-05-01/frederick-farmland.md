# Frederick Sloan — AcreOS user review (Institutional farmland voice)

I'm Frederick Sloan. I'm 57, based in Iowa City, and I run an 8,500-acre row-crop portfolio for an ag-REIT — corn-and-soy out of the heart of the Corn Belt, spread across 31 farms in Iowa, eastern Nebraska, and a couple of stragglers in northern Missouri. I don't farm. I haven't put a hand on a planter in 22 years. What I do is allocate capital, sign cash-rent and crop-share leases with the operators who actually farm the dirt, manage the FSA paperwork, decide when we tile a field, and report quarterly NOI per acre to the LPs who fund the trust.

So when somebody at our annual ag-investor roundtable mentioned AcreOS, I spent a Saturday morning poking at it on behalf of the trust. Different animal from Manuel's California permanent-crop ranch. He has trees and water rights. I have base acres and a tenant farmer named Dale.

Here's the honest read.

---

## 1. Thirty-second verdict

Would the trust use AcreOS? **No, not in its current shape.** AcreOS is built for somebody who *buys and sells* land — a flipper, a note investor, a wholesaler. We're institutional buy-and-hold. Our holding period is forever. Our buy decision happens once every few years and gets vetted by an investment committee that already runs comps on a Bloomberg-style ag-land terminal (Acres, AcreTrader-Equilibrium, Peoples Company internal). Our daily operating reality is *managing operators* — not flipping parcels.

That said: **AcreOS has good bones for the acquisition side**, and there are two narrow-but-real wedges where it could earn shelf space in our workflow within a year. I'll get to those. But selling AcreOS to ag-REITs as it stands today would be selling a CRM to people who don't have a sales pipeline.

The structural mismatch in one sentence: **AcreOS doesn't model the farm-manager–tenant–operator triangle, which is the core relationship of every dollar of institutional farmland in America.** Without that triangle, the rest of the conversation is moot.

---

## 2. Daily-use walkthrough — my imagined first day

**7:15 AM.** I land on `/today`. Greeting, Pulse score, expiring offers, stale leads, Pax suggestions. **My morning is none of that.** My morning is: did Dale get the corn planted on Farm 14 before the rain window closes, did the FSA office acknowledge our 156EZ form for crop reporting on Tract 8214, has Bayer's Climate FieldView synced last week's satellite imagery, and did the cash-rent ACH from Hagedorn Brothers on the Black Hawk County farm clear by the 1st. Zero of those touchpoints have a home on `/today`. AcreOS doesn't know what an FSA tract is, what a base acre is, or that I have an operator named Dale.

**8:00 AM.** I look at `/parcels/:id` on a 320-acre quarter-section we own outside Cedar Falls. The DD checklist is the right *shape* but wrong *list* for farmland. Title, liens, environmental, access, taxes — yes, those. Missing for institutional farmland: **CSR2 score (Iowa's corn suitability rating), drainage class, tile map, HEL/non-HEL designation, wetland determination (Swampbuster compliance), FSA farm/tract number, base acres by commodity, payment yield by commodity, current operator, current lease term, current cash rent or share split, and a CRP enrollment flag.** Those are the dozen fields that determine the value of the dirt. AcreOS shows me soil type, drainage, prime-farmland yes/no, hydrologic group, capability class, and a USDA CDL crop label. That's a serious start — better than I expected — but it's surface data. The institutional buyer wants *FSA-record* data, which is the official government record, not a soil-survey approximation.

**Credit where due:** the property page does pull soil suitability, soil drainage, capability class, hydrologic group, prime-farmland flag, and a USDA CDL crop name with year. That's already 60% of the surface land-quality picture. With FSA CLU lookup wired up server-side (which I found in the MCP layer), the missing 40% is *fetchable*; it's just not surfaced on a parcel detail page where I'd see it.

**9:00 AM.** I look for the **operator (tenant farmer) entity**. There is no such thing. There's no operator record, no farm-manager record, no lease between owner and operator. The closest thing in the schema is a `lead` with a `landlord` persona overlay, which is meant for residential rentals. For institutional farmland this is structurally wrong: the operator is not a customer, not a vendor, not a lead — the operator is a *contractual counterparty* with a multi-year lease, an FSA Form 578 reporting obligation, a crop-insurance relationship, and a profit-share calculation if we're share-rent rather than cash-rent.

The data model needed: **Operator** (legal entity, principal contact, FSA producer ID, crop insurance agent, equipment list, machinery insurance certificate on file, prior performance metrics like avg yield per acre by year and crop). **Lease** (cash-rent vs flexible cash vs share-crop vs custom-farm — four very different financial structures), term, base rent or share split, escalator (CPI? gross-revenue-linked?), renewal mechanism, holdover provisions, conservation-practice clauses, input-cost-sharing rules. **Cropping plan** per farm per year (corn/soy rotation, cover crop yes/no, no-till yes/no, herbicide program if relevant). **FSA enrollment** (ARC-CO vs PLC by commodity, base acres, payment yields, conservation compliance status). None of this exists. Not surface UI — *not even a database table*.

**10:00 AM.** `/money` — Notes, Portfolio, Optimizer, Forecast, Capital. **Wrong shape entirely.** Notes are seller-financed paper. We hold zero notes. We hold *cash-rent receivables* and *share-crop revenue accruals*. The structural difference: cash rent is a fixed annual receivable (typically half on March 1, half on September 1 in Iowa) due from one operator per farm. Share crop is a *crop-revenue split* that doesn't settle until the elevator scale ticket comes back in October-November-December and we know yield × harvest price × split percentage. The payment timing, accounting treatment, tax treatment (cash rent is rental income; share crop can be material-participation farm income depending on landlord involvement), and risk profile are entirely different.

The Portfolio tab's aging buckets — current / 30 / 60 / 90+ — are *almost* right for cash-rent receivables, but the legal posture is wrong. If Dale doesn't pay the September installment by October 1, my lease has a specific cure window (typically 30 days, varies by state and lease form), and after that I have to issue a notice of default and ultimately move to recover possession before the next planting season. That's *very* different timing than note dunning. Iowa Code Chapter 562 has specific notice rules for farm tenancy termination — Sept 1 deadline for non-renewal, no later. Miss that date and the tenant gets another year. AcreOS has no concept of any of this.

**11:00 AM.** I look for **FSA integration**. There's USDA FSA CLU lookup wired up in the MCP layer (`server/mcp/index.ts`) — I can pull the CLU ID, farm number, tract number, and FSA-calculated acres from a coordinate. **That's actually impressive — it's the right data spine.** What's missing is the rest of the FSA picture: **base acres by commodity** (corn base, soybean base, wheat base, etc., established at 2018 Farm Bill levels), **payment yield** per commodity (which determines ARC/PLC payment size), **enrollment election** (ARC-CO vs PLC vs none, currently a Sept 30 annual deadline), and **conservation compliance status** (HEL, wetland, sodbuster). All of this is fetchable from the FSA county office; some of it is in MIDAS. None of it is in AcreOS.

If AcreOS surfaced base acres + payment yield + current ARC/PLC election on the parcel page, **that single feature would matter to every farmland-owning entity in the country**. Right now to get that data I have to call the county FSA office and ask them to print the 156EZ. That's 2026 and I'm using a fax machine. There's a real wedge here.

**12:00 PM.** I look at carbon-credit / regen-ag. AcreOS does have a `estimateCarbonCredits` function in `server/services/environmentalIntelligence.ts` — for cropland it pegs 1.2 credits/acre at $18/credit, with a 40-acre minimum and program-availability lookup by state. **That's a credible first cut.** For my 8,500 acres of Iowa cropland, that's ~10,200 credits/yr at ~$184k of program-eligible revenue if I enrolled all of it. That number is probably 2× too generous (mid-2024 prices on the voluntary market were $12-15 for ag soil, not $18, and you need to net out the verification/MRV costs that eat 30-40% of gross), but the *concept* is right and the surface is there.

What's missing for an institutional carbon program: **multi-year baselining** (you have to prove additionality — that the practice change is new), **practice attestation per field per year** (no-till, cover crop, reduced N, etc.), **MRV vendor selection** (Indigo, Truterra, ESMC, Bayer's Carbon Initiative), and **stacking rules** (you can't double-sell the same ton of CO2 across two registries). AcreOS estimates value but doesn't track enrollment or practice attestation. So it's a marketing slide, not a workflow. Forgivable for v1; needs a roadmap before a serious carbon-program manager would lean on it.

**1:00 PM.** **Bayer Climate FieldView / Pivot Bio / John Deere Operations Center.** I went looking. **Zero integrations.** No mention in the codebase, no API key fields, no data-source broker entry. For an ag-REIT this is the cost of admission. Climate FieldView has the operator's actual planting maps, applied-input maps (seed variety, seed population, fertilizer rate by zone), and yield maps from the combine. That's the data I need to verify share-crop revenue and to validate that my operator is following the cropping plan in the lease. Pivot Bio (nitrogen-fixing biological) data tells me which fields are getting reduced N, which feeds carbon program documentation. John Deere Operations Center has machine logs — when was the planter in the field, when was the sprayer in the field, when was the combine in the field. That's lease-compliance evidence.

These integrations exist as published APIs (FieldView has the FieldView API, JD has the Operations Center Data API). AcreOS could ship read-only ingestion of any one of them in a quarter. Without them, AcreOS can't be the operating system for an institutional farmland portfolio — it can be a CRM bolted onto one.

**2:00 PM.** **Tile drainage and capex.** A working tile-drainage map is the single most important capex artifact on Iowa cropland. New 20-foot-spacing pattern tile costs $1,000-1,400/acre installed in 2024, and on poorly-drained Iowa flats the productivity uplift is often 15-25 bushels/acre on corn — payback in 6-9 years at current corn prices. We need to track: existing tile map (lateral spacing, mains, outlets), install date, contractor, warranty, latest repair, and a planned capex schedule. AcreOS has no capex ledger per parcel. The /money surface is wired to notes; I'd want a "Land Improvements" ledger per farm with tile, terraces, waterways, fence, and well capex line items, depreciation schedules, and a per-farm net invested basis. Standard ag-REIT accounting; not even hard to build.

**3:00 PM.** **Cash rent vs share rent decision support.** This is the central capital-allocation question I make every November. Cash rent is fixed and lower-variance — typical Iowa CSR2-85+ ground at $310-360/acre cash in 2024-25. Share rent (50/50, 60/40, 65/35 owner) gives me upside in a $5+ corn year and downside in a $3.50 corn year, plus I share input costs in some structures. The math is a Monte Carlo over corn-price distribution × yield distribution × input-cost distribution. AcreOS doesn't have a cash-vs-share calculator. It does have a `priceOptimizer` and a `forecast-model` for note investing — same shape, wrong domain. Porting that engine to a row-crop revenue model is a 2-3 week build. Real wedge if AcreOS wants to talk to ag investors.

**4:00 PM.** **Crop rotation reporting.** Every fall I file FSA Form 578 reporting actual planted crops on each tract. AcreOS has no awareness of cropping plans, no rotation tracker, no acreage report assistant. Could AcreOS pull last 5 years of CDL data per parcel and show me the rotation history? Yes — the data is already there in the cropland enrichment block. Surfacing rotation history per farm with one chart would help me defend a Conservation Compliance audit, which is a $10k-50k swing if FSA flags a sodbuster violation.

---

## 3. Per-surface friction

**`/today`** — Acquisition-shaped. For institutional farmland I'd want: rent-roll receivables status, FSA filing deadlines (Sept 30 ARC/PLC, Jul 15 acreage report, NAP/crop insurance dates), operator communications queue, pending capex approvals, and a Climate FieldView "did the operator do what the lease says" widget. None of those data sources exist.

**`/pipeline` + `/leads`** — Useful for new acquisition (we buy ~3-5 farms a year). Conflating "operator" with "lead" would be a category error — operators are counterparties, not prospects.

**`/parcels` / `/parcels/:id`** — Best surface for our use case. Soil, drainage, prime-farmland, CDL crop, NLCD land cover are all there. Missing the FSA layer (base acres, payment yield, ARC/PLC), tile map, current operator, current lease terms, capex history.

**`/money`** — Wrong shape. Notes/Portfolio/Optimizer/Forecast/Capital is paper-investor language. For us: Rent Roll / Share-Crop Settlements / FSA Payments / Capex Ledger / Carbon Revenue.

**`/finance` / Notes tab** — Not applicable. Zero notes. The dunning shape could be repurposed for cash-rent receivables but the legal regime (state farm-tenancy law) and timing (annual, not monthly) are different enough that a relabel is wrong.

**`/portfolio`** — Aging buckets are right shape, wrong source. Wire to rent roll and they're useful. We'd also want NOI/acre, yield/acre, $/CSR2-point, IRR per farm, and benchmark vs Acres.com county comps.

**`/inbox`** — Useful. Operator emails, FSA notices, crop insurance docs, Climate FieldView alerts would all land here in a real ag deployment. The inbox would need to know that mail from `dale.hagedorn@gmail.com` is from the operator on Farm 14 with current lease terms and last YTD yield map one click away. Linkage doesn't exist because operator entity doesn't exist.

**`/field-scout`** — **Best surface for me, repurposed.** Farm walk-throughs with photos and offline sync are exactly what a farm manager does in March (planting prep), May (stand counts), August (yield estimate walks), and November (post-harvest residue check). Add a "farm visit template" with stand-count, weed pressure, and tile-blowout fields and we'd use this Monday. The infra is already there.

**`/documents` / `/sign-document`** — HMAC public signing flow is the right architecture. Could it sign an Iowa Bar Association Form 1601 cash-rent farm lease? Yes. Could it handle the lease-package pattern (lease + tile easement + chemical-application addendum + operator-insurance certificate)? Not without the lease-package model that the residential landlord write-up flagged. Same gap.

**`/pax`** — Pax has nothing useful for me because it doesn't know about operators, leases, FSA, or yield. The AI question I'd actually pay for: "given my 5-year yield history on Farm 14 under Dale and the local elevator basis, should I keep him on cash rent at $325 or convert to 60/40 share for 2027?" Pax can't answer because the underlying data doesn't exist.

**`/onboarding-v2`** — Three paths (beginner / active / enterprise). None route to "I manage a 8,500-acre farmland portfolio." A "Farmland / Ag-REIT" track would need its own entity setup (Operator, Lease, FSA Farm, Tract), import path (CSV from Acres or Peoples Company), and a tour that emphasized lease management not flip arithmetic.

**`/pricing`** — Wrong altitude. We'd be a six-figure annual contract if AcreOS shipped the farmland stack, and we'd expect a dedicated CSM, SSO, audit logging, RBAC, and a SOC 2 report. Today the $79/mo Scale tier is consumer-grade for our use.

---

## 4. The institutional-farmland test — fail, by design

Here's how AcreOS grades against the systems an ag-REIT actually runs:

- **Operator (tenant farmer) entity with FSA producer ID** — *Missing.* No table.
- **Lease entity (cash-rent / flexible cash / crop-share / custom-farm)** — *Missing.* No table.
- **FSA enrollment data (base acres, payment yield, ARC/PLC election)** — *Missing in UI; CLU lookup exists server-side.*
- **Crop rotation history + Form 578 prep** — *Missing.* CDL data exists per-year per-parcel but no rotation view.
- **Tile drainage map + capex ledger** — *Missing.*
- **Bayer Climate FieldView / John Deere Ops Center / Pivot Bio integration** — *Missing entirely.*
- **Carbon-credit enrollment + practice attestation** — *Estimate only; no workflow.*
- **Cash-vs-share rent decision Monte Carlo** — *Missing.*
- **State farm-tenancy law engine (Iowa 562, Illinois 735, Nebraska 76, etc.)** — *Missing.*
- **Conservation compliance (HEL, Swampbuster, sodbuster)** — *Missing.*
- **Crop insurance schedule (RP, YP, ECO, SCO) tracking** — *Missing.*
- **NOI/acre + IRR/farm + $/CSR2-point benchmarking** — *Missing.*

**Net: AcreOS today is not a farmland-management platform.** It's a great parcel-research tool with strong USDA enrichment, and that earns it a seat at the acquisition table. Operations is a different product.

---

## 5. Five features that would make this a real institutional-farmland product

1. **Operator + Lease entities with FSA producer ID.** First-class. Required before anything else. 4-6 weeks for the data model and minimum viable UI.

2. **FSA tract data on parcel page.** Base acres by commodity, payment yield, current ARC/PLC election, conservation compliance status. The CLU lookup is already wired; surface the rest of the FSA record. 2-3 weeks if we accept manual entry as the v1 fallback when FSA office is the source of truth.

3. **Crop rotation history widget.** Pull last 7 years of CDL data per parcel (already in the system — see `cropland.year`), chart it as a sequence, flag rotation deviations, generate a Form 578 export. 1-2 weeks of UI work on existing data.

4. **Climate FieldView read-only integration.** OAuth into the operator's FieldView account (with their consent — most leases now include an operator-data clause), pull planted-crop maps, applied-input maps, and yield maps. Becomes the lease-compliance backbone. 6-8 weeks for first-pass integration.

5. **Cash-rent vs share-crop optimizer.** Repurpose the existing `priceOptimizer` engine to row-crop revenue distribution: corn/soy yield × elevator basis × input cost × split percentage. Output an expected NOI distribution per lease structure. 3-4 weeks.

---

## 6. Three things AcreOS gets right for institutional farmland today

1. **USDA CLU + soil + CDL enrichment on the parcel page.** Better than I expected. Soil suitability, drainage class, prime-farmland flag, hydrologic group, capability class, and current-year crop name are all there. That's most of the land-quality picture for an acquisition decision.

2. **Carbon-credit estimator.** Static, but credible. Cropland at 1.2 credits/acre × $18 with state program lookup is a believable v1. Needs MRV vendor logic and additionality baseline before it's a real workflow, but the seed is planted.

3. **Cash-rent reference data via USDA NASS.** `usdaNassService.ts` is calculating cash-rent-per-acre at ~3.5% of farm RE value with a state breakdown. Rough heuristic, but for an investor screening an out-of-state county that's 80% of what they need before calling a local broker.

---

## 6a. A note on the LP-reporting shape

Once a quarter I send a 22-page report to the trust's LPs. Page 1 is portfolio NAV. Page 2 is cash-rent collected vs budget. Page 3 is share-crop accruals to date. Pages 4-6 are NOI per farm with prior-year comparison. Page 7 is FSA/government-payment receipts. Pages 8-12 are capex executed and capex committed (tile, terraces, fence, drying-bin upgrades). Pages 13-15 are valuation movement using a county-comps approach blended with our internal cash-flow model. Pages 16-18 are operator scorecards (yield achieved vs county avg, payment timeliness, conservation compliance). Pages 19-22 are forward-look: rent renegotiation calendar, lease expirations, fields targeted for purchase, fields targeted for sale.

I currently build that in Excel + a couple of Python scripts. **AcreOS could be the system of record for pages 2-7 and 13-18 within a year if the operator-lease entity gets built.** That's an LP-grade reporting capability, which is a moat against AcreTrader-Equilibrium (who only own dirt — they don't manage other people's portfolios) and against the legacy farm-management firms (Hertz, Murray Wise, Farmers National) who run on early-2000s software. The opening is real. The build is finite.

---

## 6b. Adversarial scenarios I'd worry about as a fiduciary

A few items the team should bake into the roadmap before chasing institutional farmland customers:

- **Operator data privacy.** When we ingest a Climate FieldView export, that's the operator's confidential business data — yield maps reveal his agronomic skill, applied-input maps reveal his input strategy. If AcreOS leaks that to a competing operator on a neighboring farm, we get sued and the operator gets poached. Need row-level operator-data isolation and an audit log they can request.
- **FSA misreporting risk.** If AcreOS auto-files a Form 578 acreage report and gets the planted acres wrong by even 5%, the producer can lose ARC/PLC eligibility for that crop year — that's $30-80/base acre of foregone payment. Liability waiver and human-in-the-loop confirmation are non-negotiable.
- **Conservation compliance triggers.** Sodbusting a slope without a conservation plan retroactively voids USDA program eligibility for the entire farm — every program, every year. AcreOS would need a "do-not-till these acres" geofence and a workflow that requires NRCS plan attachment before any aggressive tillage gets logged in the cropping plan.
- **Lease-renewal window automation.** Iowa Code 562.6 mandates Sept 1 notice of non-renewal; miss it and the tenant gets another year automatically. If AcreOS is the system of record, the team owes us rock-solid reminder logic with redundant escalations. A missed Sept 1 deadline is a $50-150k mistake on a 320-acre farm.

These are table-stakes for any system that touches farmland operations. If AcreOS ships farmland features without addressing these, the first ag-REIT customer becomes the first ag-REIT lawsuit.

---

## 7. The honest verdict

AcreOS is a parcel-research and acquisition CRM with genuinely strong USDA data plumbing under the hood. For an ag-REIT at our scale, it's a complement to (not a replacement for) the systems we run today: an Acres.com or Peoples Company terminal for comps, a custom Excel rent roll, FSA office paperwork, our operator-relationship-management spreadsheet, and Bayer FieldView. **AcreOS could replace one of those — the comp / acquisition tool — within a year.** Replacing the operator and lease layer is a year of focused product investment.

If you want institutional farmland customers, the path is:

- Quarter 1: Operator + Lease entities, FSA tract data on parcel page, crop rotation history widget.
- Quarter 2: Climate FieldView read-only integration, cash-vs-share optimizer, tile/capex ledger.
- Quarter 3: Carbon program enrollment + practice attestation, NOI/IRR/$-per-CSR2 benchmarks.
- Quarter 4: State farm-tenancy law engine for Iowa/Illinois/Nebraska/Indiana/Minnesota; SOC 2 + SSO for institutional procurement.

Ship that and we'd write a six-figure ACV check. Don't ship that and we'd pay $79/mo for the parcel research and keep our spreadsheets for everything else.

The parcel page is the wedge. The operator-lease model is the moat. Build the moat.

— Frederick Sloan, Iowa City IA
