# Brigid O'Shaughnessy — AcreOS user review (subdivider)

I'm 52. Rural Tennessee. I buy 40 to 200 acre parent parcels — usually $200K up to $800K — and I cut them into 5 to 50 smaller lots, then sell those lots one at a time over eighteen to thirty-six months. That's the whole business. I run a custom GIS off a Postgres + PostGIS box my nephew set up for me, I pay LandGlide $499 a year, I have a civil engineer on retainer named Earl who is slower than Christmas, and I spend more hours at the Williamson and Maury and Hickman county planning offices than I do in my own kitchen. My books live in Excel. My signatures go through DocuSign. I have never used a CRM that understood what I do, and I'm tired of looking.

So when somebody hands me AcreOS and says "land platform" — I look for the seven things that would actually move my Tuesday. None of them are AI. None of them are sequences. None of them are "Pulse score." Here's what I found after a half-day inside the product, with the persona switcher set to Subdivider.

---

## 1. Thirty-second verdict

Would I sign up today? **No, not for my actual work. Maybe a Starter trial just to keep tabs on the deal-finding side, but my subdivision pipeline stays in QGIS and Excel.**

This product was built for a flipper. A wholesaler. A note investor. Maybe a tax-delinquent guy. **It was not built for somebody who turns one parcel into thirty.** I'll use plain language: AcreOS knows the word "subdivider" — there's a persona slot, the vocabulary file calls my parcels "Parent parcels" — and that's where it stops. Picking that persona in settings doesn't unlock a single feature I need. It changes the labels on screens that don't fit my work anyway.

At $20/mo I'd keep it open as a county lookup tool. At $49/mo Pro — no, because I'm paying for note-ledger and mailer features I will never touch. **The subdivider tier described in the persona panel ("adds permit-tracking + per-lot pipelines") doesn't exist as shipped surfaces.** I checked.

---

## 2. The seven things I need — and what AcreOS actually has

### **(1) Subdivision plan tooling — drawing lot configuration on the parent parcel.**

This is the thing. When I buy 80 acres, the first afternoon I'm in QGIS sketching: where does the road go in, where's the cul-de-sac, how do I get five lots with road frontage and not three. I draw, I measure, I redraw. Over the eighteen months of a project I'll redraw that plan maybe forty times before the engineer stamps the final.

What AcreOS has: a Mapbox map (`property-map.tsx`) with **distance and area measurement** — click points, get feet, get acres. That is genuinely useful, more than I expected. The measurement-units toggle (imperial/metric, persisted in localStorage) is thoughtful.

What it does **not** have: any polygon drawing. No lot-splitting tool. No "draw a road centerline, set a 50-foot setback, generate lot polygons inside the remainder." No way to save a sketch and version it. I searched the dependencies — no `@mapbox/mapbox-gl-draw`, no Leaflet.draw, nothing. The map is a viewer with a measuring tape taped to the side.

For my work that means **the most important hour of my week happens outside this app**. If I can't sketch lot configurations on the parent parcel inside AcreOS, AcreOS is a side window — not the home screen.

What I'd build, in priority order:
1. Polygon draw → save as a "subdivision plan" attached to the parent parcel. `@mapbox/mapbox-gl-draw` is a fifty-line integration on top of what already ships.
2. Multiple plans per parcel ("Plan A — 12 lots," "Plan B — 8 lots, two estate"), so I can A/B them. Earl will redline whichever I send him; I want the previous plans intact when he comes back two weeks later asking why I changed the cul-de-sac.
3. Lot auto-numbering, frontage calculation, acreage per lot, road centerline length. The math is high-school geometry; the API surface is `turf.js`, which is already a dependency on most Mapbox projects.
4. Setback overlays — front 30, rear 20, side 15 — pulled from `zoning-lookup` so I can see the buildable envelope before I draw a lot too narrow.
5. Export to GeoJSON / DXF so Earl can pick it up in AutoCAD Civil 3D without retyping coordinates I already entered.

Without #1, none of the rest of this audit matters. A subdivider with no drawing tool is a CRM user with a really nice map.

I'll add: the existing measurement tool gives me hope. Whoever built it understood that distance and area on a map are real-world numbers I'll write down. The leap from measurement-mode to draw-mode is small in code and large in customer value. Take the leap.

### **(2) Permit-tracking workflow — county-by-county.**

In Williamson TN, a residential subdivision plat needs, in order: pre-application meeting with planning staff, sketch plan review, planning commission preliminary plat approval, soil percolation tests for septic on every lot without sewer (TDEC has its own queue and the testers only work April through October because frozen ground), road construction permit, road bond posting (cash or surety, usually 110% of estimated road cost), Tennessee Department of Environment and Conservation stormwater Notice of Intent, utility will-serve letters from the electric co-op and water utility, fire-marshal access review, final plat approval, mylar signatures from the surveyor and the planning chair, recording at the register's office, then assessor splits the parcel and issues new APNs for each child lot. **Fourteen separate gates.** Hickman County is different — fewer steps, but the percolation queue is worse because they have one TDEC tester for three counties. Maury is different again. Davidson refuses to do residential subdivisions in some districts at all anymore. Each gate has a fee, a contact, a turnaround estimate, and a document I have to produce.

What AcreOS has: a `regulatory-intel` page, a `compliance.tsx` page, a `regulatory-intelligence.tsx` page (yes, two — different names, same vibe), a `state-documents.tsx` page, and a `complianceGuardian` service. The schema has a `complianceRules` table keyed by ruleType including "subdivision" and "plat." I read it. **It's a rules engine for sale-disclosure compliance — affidavits, recording requirements, Dodd-Frank for seller-financing — not a permit tracker.**

What I need: a per-parent-parcel permit checklist with a **county template library** (start with the top 30 counties by subdivision activity), each gate as a row with status (not started / submitted / approved / rejected / on hold), submitted date, expected return date, fee, contact, attached documents, and a notification when something's stalled past its expected date. Williamson preliminary plat usually returns in 45 days; if I'm at day 60 I want a yellow flag, not silence.

What AcreOS has built that's adjacent and useful:
- The `tasks.tsx` surface could carry a permit checklist if the data model supported it.
- The `documents.tsx` + version-tracking infrastructure (the `documentVersions` table is real and `document-versions.tsx` ships) handles the document-attachment side cleanly.
- `counties.tsx` exists. I haven't audited it deeply but the name promises something I'd want.

The bones are here. Nothing has been wired into a subdivider workflow.

If you ship the permit-tracker first, before the drawing tool, you'd still get adoption from people like me — because the permit hell is the part that drives the drinking. Plats can wait. **Knowing whether Earl's stormwater plan got submitted to TDEC three weeks ago and is now stuck on a reviewer's desk** — that I'd pay for tomorrow.

### **(3) Per-lot pipeline — one parent into N children.**

Once the plat records, I have (say) eighteen lots. Lot 1 might be under contract to a buyer. Lot 7 is listed. Lot 12 is being held back for road access negotiations. Lot 14 is the one with the creek that nobody wants. Each of those lots is in its own pipeline stage, with its own price, its own buyer, its own closing date.

What AcreOS has: properties, leads, deals, pipelines — all single-parcel. The `personaVocabulary` calls my parcel a "Parent parcel" but **there is no parent/child relationship in the schema.** I checked `shared/schema.ts` for parent_parcel_id, child_lot, subdivision_lot_number — none of those columns exist. There's a `subdivision: text("subdivision")` field on the property table (a plain string for "Oak Ridge Subdivision") and that's it.

So if I tried to use AcreOS for an eighteen-lot project I'd create eighteen separate property records, lose the parent relationship, lose the cost-allocation (how do I split the $480,000 acquisition basis across the lots?), and lose the rollup view. I'd be re-entering the same APN-derived data eighteen times.

What I need:
1. `parent_parcel_id` foreign key on the property table, nullable. If null, you're a regular parcel (every existing user). If set, you're a child lot.
2. A "Lots" tab on the parent-parcel detail page showing all child lots in a kanban (status columns) or table view (sortable by lot number, asking price, days-on-market, buyer status).
3. Cost-basis allocation — when I add a child lot, the parent's basis distributes by acreage (default) or by my override percentages. The IRS lets me use either reasonable method; my CPA picks acreage-weighted with a road-impact adjustment. This is a tax-time requirement; my CPA needs basis-per-lot for every closing or I get a phone call I don't want at 11pm in March.
4. Rollup metrics on the parent — total parent basis, sold-lot proceeds, remaining inventory acres, blended cost-per-remaining-acre, projected IRR at current asking prices, breakeven sale month.

This is the core data-model gap. Without it, the persona is decorative — a label with no schema behind it.

### **(4) Survey and plat-map upload + version tracking.**

My civil engineer sends me a preliminary plat. I redline it. He sends v2. The county rejects it for a setback issue. He sends v3. The fire marshal wants a wider cul-de-sac radius. He sends v4. By the time it records I'm on v7 or v8 of the plat, plus three rounds of surveys (boundary, topo, as-built).

What AcreOS has: the `documentVersions` table is a real implementation — versionNumber column, restore-previous-version mutation, a `document-versions.tsx` page that lists versions per document. **This is the one piece of the subdivider stack that's already shipped, even though it wasn't built for me.** I'd use this on day one.

What's missing: nothing critical. I'd want a "document type" enum that includes "preliminary plat / final plat / boundary survey / topo / as-built / civil drawings / stormwater plan / soil report / percolation report / road bond / will-serve letter / recorded CC&Rs / HOA bylaws" so my filing system has shape, but the underlying versioning works. I'd also want a "linked permit gate" foreign key — when Earl sends v3 of the preliminary plat, that version should attach to the "preliminary plat — submitted" gate in my permit checklist for this parent parcel, so the document and the workflow stay in sync.

A small thing: when somebody opens an old plat version, log who opened it. My buyers' attorneys sometimes ask "what version of the plat was attached to the contract." I want to answer that without thinking.

This is where AcreOS is closest to ready. I'd estimate two days of polish to make it subdivider-shaped, plus the document-type enum and the permit-gate linkage.

A small ask while I'm here: surveys often arrive as DWG files, not PDF. I get the PDF for filing and the DWG for working. AcreOS's storage and version-tracking should accept both formats, even if it can't render the DWG inline. Earl will not start sending me PDFs only just because your software is opinionated.

### **(5) Lot-by-lot pricing.**

Lots are not interchangeable. A corner lot with 200 feet of road frontage and a creek view sells for $85K. The interior lot two over with no view sells for $52K. The lot at the end of the cul-de-sac with the great trees sells for $95K. **Pricing is per-lot and the premium logic is rule-based** — corner +10%, road frontage > 150ft +8%, water feature +15%, etc.

What AcreOS has: a `price-optimizer.tsx`, a `blindOfferCalculator.ts`, an `avm.tsx`, a `portfolio-optimizer.tsx`. These are buy-side tools — what should I offer for this parcel — not sell-side, lot-by-lot pricing tools.

What I need: a pricing-rules editor where I define premium percentages per attribute (corner +10%, frontage > 150ft +8%, water feature +15%, cul-de-sac +5%, lot < 1.5ac -10%), apply them to all child lots in a subdivision, see the proposed asking-price grid, override any cell, and lock the grid. Re-run when comps refresh. **The base price comes from the AVM on the parent's per-acre value.** This is a small surface — maybe a single screen — but it's the difference between guessing and pricing.

Bonus points if it tracks how my actual sale prices compare to my asking grid over time, so I can refine my premium rules empirically. Year three of doing this with my own data and I should be able to predict sale price within five percent on lot one of every new project.

Not built. The buy-side AVM is overbuilt for my needs and sell-side is underbuilt — symptomatic of a product designed for flippers, not subdividers.

### **(6) HOA / CC&R drafting.**

When I record a plat I usually record covenants alongside — minimum house size, no manufactured homes, architectural review, road maintenance assessment, sometimes an HOA. My attorney drafts these but I make twenty edits. They're long, formulaic, and I reuse 80% across projects.

What AcreOS has: a `documents.tsx` with templates and a signing flow (the HMAC-link public signer is genuinely good — no login for the signer, audit row, signer order, expiry). State documents page. None of it is CC&R-shaped.

What I need: a covenant template library — restrictive covenants, road maintenance agreements, HOA bylaws, architectural review standards, septic-system maintenance covenants, well-sharing agreements (more common than you'd think), private-road easements — with merge fields for project name, recording county, lot count, assessment amount, ARB committee size. Nothing AI here, please. I do not want a generative model writing CC&Rs that get recorded in perpetuity against my buyers' titles. **A template engine with merge fields, period.** AcreOS has the rendering and signing infrastructure (the HMAC signer is solid); the missing piece is the template library and the field schema.

Two-week build for somebody who knows the document types — and you should not pretend you do; hire a Tennessee land-development attorney for forty hours of consulting and let them seed the library. Big leverage for me: my attorney bill drops 40% if I show up with a draft instead of asking him to start from blank, and the savings on a single project pay for AcreOS for two years.

### **(7) Per-county approval timelines.**

Williamson is fourteen months end-to-end. Hickman is four. Maury is six. Davidson is a different planet. **I bid acquisitions on the carry cost of those timelines** — if I think Williamson approves in fourteen months I bake in fourteen months of property tax, interest carry, and opportunity cost. If approval slips to twenty I've lost the project.

What AcreOS has: nothing on county timelines specifically. The blind-offer calculator considers acreage and zoning. It does not know that Williamson takes a year longer than Hickman.

What I need:
1. A `county_subdivision_timelines` reference table — preliminary plat lead time, final plat lead time, typical-revision-rounds, percolation-test season window — sourced from county planning offices and refined by my own historicals.
2. A "carry cost projector" on the parent-parcel page: given county X, parcel Y, holding cost Z/month → estimated timeline → total carry → adjusted IRR.
3. Cohort tracking — across every parent parcel I've run through Williamson, what's my actual mean and p90 approval time? Refine the estimate from my own data.

This is a build. No pieces of it exist today. **And it's the kind of build that compounds — every project I run through your platform refines the timeline data, and that benefits every other subdivider on AcreOS too.** Earl's TDEC submissions are fungible; the subdivision regulations of Hickman County are not. Pool the data, raise everybody's IRR. There's a small moat in here for the platform if you build it right.

---

---

## 3. The day-in-the-life test — where AcreOS would slot in

Let me walk through a single project the way I actually run it, and tell you where AcreOS would help and where it would be furniture.

**Month 0 — acquisition.** I find an 80-acre parcel for sale in Maury County, asking $640K. I pull it up in LandGlide, then in QGIS over the FEMA flood and the soil-survey layers. I run comps on what 1-3 acre lots have sold for in the area over the last 24 months. I sketch four rough subdivision plans and pick the one that yields 22 lots with reasonable road costs. I bid $560K with a 90-day inspection contingency.

**Where AcreOS helps today:** the map with FEMA + USDA + topo layers, the AVM and blind-offer calculator on the parent, the comps surface, the DD checklist on `/parcels/:id`. This stretch is genuinely good. I'd use it.

**Where AcreOS doesn't help:** the four-plan sketch step. I do that in QGIS and screenshot it into a Google Doc.

**Month 1-3 — closing and pre-application.** Earl walks the land, runs a boundary survey, confirms acreage. I meet with Maury planning. We do a sketch-plan review. They tell me my road won't work because of slope, and the cul-de-sac needs to be 50 feet of radius minimum. Earl redraws. I pay $14,000 for the preliminary engineering set.

**Where AcreOS helps:** document storage and versioning if I drop the survey and the engineering sets in. That's it.

**Where AcreOS doesn't help:** tracking that I had the pre-application meeting on March 12 with Sarah at Maury planning, that her note was "slope > 8% needs alternative road alignment," that Earl's revision was due back April 4 and arrived April 19, and that the next gate is preliminary plat submission with a $1,400 fee. None of that has a home in AcreOS today.

**Month 4-9 — preliminary plat through final plat.** Submit, revise, resubmit. Percolation tests on every lot — I have to schedule TDEC, who tests when the ground isn't frozen and isn't saturated, which in middle Tennessee gives me April-May and September-October. Two lots fail perc. Earl redraws to absorb them into adjoining lots, lot count drops from 22 to 20. Road bond posted, $186,000 in surety. Stormwater NOI to TDEC. Will-serve letters from Maury Electric and city water. Final plat goes to planning, gets approved on the third try.

**Where AcreOS helps today:** still document storage. Still nothing on the workflow.

**Where AcreOS doesn't help:** the entire eighteen-month workflow. This is where I'd be hitting it the hardest, and it's silent.

**Month 10-12 — recording, listing, marketing.** Plat records. Assessor splits the parcel and issues new APNs over the next 60-90 days. I list the first 8 lots on the MLS through a friend who's a broker. I drop direct mail to a list of in-state buyers I've sold to before. CC&Rs get recorded with the plat.

**Where AcreOS helps:** listings page, direct-mail-campaigns surface, the documents/signing flow for purchase agreements and deeds. Reasonable here, but not subdivider-specific — it's the same flow a wholesaler would use, parcel by parcel.

**Where AcreOS doesn't help:** the rollup. I have 20 lots in motion. I want one screen showing all 20 with their status, asking price, days listed, current offer if any. Today I'd have 20 separate parcel records and no parent view.

**Months 13-30 — selling lots one at a time.** Some lots move in 60 days. Some sit for 18 months. Pricing adjusts every quarter. The last three lots are always the hardest — usually the back of the property, no road frontage, awkward shape, the one I sketched against in plan A and lost in plan B. I'll price-cut, package two together, sometimes seller-finance one to a buyer who can't qualify, sometimes hold one for myself and build a spec house on it. Each of those is a different transaction shape: cash sale, packaged sale, financed sale, hold-and-improve. The pipeline status enum needs to support all four.

**Where AcreOS helps:** seller-financing notes (the existing note ledger would handle a held lot fine), the pricing-cut tracking. Reasonable.

**Where AcreOS doesn't help:** the cohort analysis I'd want — across my five most recent subdivisions, what's the median time-to-sell by lot characteristic? Front lots vs. back lots, larger vs. smaller, view vs. no view. That data should compound across my projects and inform the pricing grid on my next project. Today, it doesn't, because the parent-child model isn't there.

---

## 4. Per-surface friction (for the surfaces a subdivider would touch)

**`/maps`** — Best general-purpose map I've seen in a CRM. Mapbox with FEMA flood, USDA cropland, USGS topo, hillshade, satellite. Distance and area measurement work. **For viewing it's strong. For laying out a subdivision it does nothing.** This is the surface where, if a polygon-draw + lot-split tool existed, I'd live.

**`/parcels/:id` (parent parcel)** — Composed view, due-diligence checklist, neighbors. Good for buying. Bad for the eighteen months after I bought it. **A "Subdivision" tab here would change my life:** plan list, child-lot table, permit checklist, document-version stack, cost-basis allocation, asking-price grid. One tab. One day, the most important tab in the app.

**`/zoning-lookup`** — I'd use this on a parcel scout. Setbacks, allowed uses, min lot size. Good. The result schema includes setbackFront/Rear/Side and minLotSize, which is exactly what I need to constrain the lot-layout sketch. **Wire this into the (not-yet-built) drawing tool and you've shipped the highest-leverage subdivider feature in the industry.**

**`/regulatory-intel` + `/regulatory-intelligence` + `/compliance` + `/state-documents`** — Four surfaces, overlapping content, hard to tell which is canonical. The schema's `complianceRules` table even has a "subdivision" ruleType, but reading the rules engine in `complianceGuardian.ts` it's geared at sale-side disclosures (water source, sewage, road access affidavits required for unsubdivided land sales — Arizona-specific), not at the platting and permitting side. **For a subdivider, none of these surfaces answer "what permits do I need in Williamson TN for an 18-lot residential subdivision."** That's the single question I'd want them to answer. They answer adjacent questions about disclosure compliance and Dodd-Frank seller-financing rules. Useful, but for somebody else.

Pick one of those four pages, rename it, and make it the permit-tracker home. Three of the four can be merged into the chosen one. The IA proliferation is going to bite the team eventually anyway; subdivider is a good forcing function to consolidate.

**`/documents` + `/document-versions`** — Genuinely good. The version-restore flow is correct. I'd use this for plats, surveys, civil drawings, soil reports. Adding a `documentType` enum tuned to subdivision artifacts would make this a real plat-management tool.

**`/tasks`** — Generic task list. Could carry permit checklists if there were a per-parent-parcel grouping with county templates. As shipped, no.

**`/counties`** — I haven't audited deeply. The name suggests it could host the county-timeline reference data. If it doesn't yet, this is where it should land.

**`/portfolio` / `/money` / notes** — I have no notes. I sell lots cash-or-conventional. Maybe one in twenty buyers takes seller financing, and that's a single-note operation, not a portfolio. The note-ledger surfaces are dead weight for me. I'd want a "Subdivider" pricing tier that swaps the Notes-heavy Pro plan for a Permits-and-Plats-heavy plan at the same price — same dollars, different feature mix. Today the pricing assumes everyone is some flavor of seller-finance land investor, and I'm not.

**`/closing-costs`** — Useful per-lot at closing time. Cleanly built. I'd use this twenty times a year, once per lot sale.

**`/depreciation-calculator`** — Doesn't apply to me. Lots held as inventory aren't depreciated; they're cost-of-goods-sold when sold. If you're going to support subdividers properly, the tax treatment is COGS-and-inventory, not depreciation-and-basis-recovery. Different chapter of the IRS code, different schedule on the return.

**`/onboarding-v2`** — Three paths: beginner, active, enterprise. I'm "active" but the active flow assumes I'm doing single-parcel acquisitions and dispositions. **There's no "what's your model" step that would route a subdivider to subdivision-shaped onboarding.** The persona registry knows my model exists — the onboarding doesn't ask. The subdivider should land on a different first-day screen than the wholesaler. Seven personas, seven first-day screens. Ship the persona-aware onboarding before you ship the subdivider features and you'll get higher activation when those features arrive.

**`/today`** — Pulse score, AI suggestions, expiring offers, stale leads. None of this is shaped for a subdivider. My version of "what should I do today" is: which permits are stalled past their SLA, which lots have offers waiting on me, which child lots are about to hit a price-cut threshold, what's Earl behind on. Build that "subdivider /today" and the surface starts earning its real estate.

**`/pax`** — I will be honest. I do not want an AI assistant guessing about my permit deadlines. I want a deterministic checklist with a calendar. Pax should be off by default for me, or scoped to "draft a buyer follow-up email" type tasks where it can't damage anything. Approval-timeline drift, basis allocation, CC&R drafting — keep the AI out of those.

**`/founder` surfaces** — Not for me. I'd want them hidden when the persona is subdivider, the same way you'd hide them for any non-founder customer. They're noise.

**`/maps`, `/parcels/:id` "Subdivision" tab, `/permits` (new), `/lots` (new), `/plats` (new)** — That would be my left-rail nav. Five entries. Nothing else. The current nav has thirty-something entries and most of them don't apply to my model. **A persona-driven nav that hides what I don't need would do more for my onboarding than any AI feature.**

---

## 5. The data-model gap, in plain words

The subdivider model is **one parent → many children, with shared basis, separate sale**. Every other persona AcreOS supports today is **one parcel → one transaction**. Every persona except mine fits the existing schema. Note investor: one note, one borrower. Wholesaler: one contract, one assignment. Fix-flipper: one house, one rehab, one sale. Landlord: one unit, one lease at a time. Mine is the only model where the unit of work splits.

The fix is not cosmetic. It's a `parent_parcel_id` column on properties, a `basis_allocations` table tying parent costs to child lots with method enum (acreage / frontage / override), a `subdivision_plans` table holding the GeoJSON of saved plans with versionNumber, a `permit_checklists` table keyed by (parent_parcel, county) with `permit_gates` rows, a `county_subdivision_timelines` reference table seeded from the top 30 markets and refined by user data, a `lot_pricing_rules` table for the asking-price grid, and a `cc_r_templates` library. **Probably eight tables, three weeks for one engineer, four weeks if you do it properly with migrations, tests, and the existing `AuthenticatedRequest` typing patterns.** Reuses your existing org-scoping, your audit-log infrastructure, your document-versions table.

Until that lands, "subdivider" is a label on a dropdown in settings, not a product. The persona panel literally promises "adds permit-tracking + per-lot pipelines" — neither exists. That's a credibility issue if a user picks the persona expecting the features. **Either ship the features or remove the promise from the panel.** The current state where the persona is selectable but the workflow isn't built reads as either marketing surface that ran ahead of engineering, or a signal that the team has not decided whether subdividers are a real customer segment.

Decide. Either way, the dropdown copy needs to match the reality.

---

## 6. Three things AcreOS has built that I'd actually use

1. **Document versioning.** Plats and surveys cycle through revisions — usually six to eight rounds before recording. The existing `documentVersions` table and restore flow handle this correctly, with versionNumber and a restore mutation already wired. Add a documentType enum and a permit-gate foreign key and I'm done.
2. **Map-layer infrastructure.** FEMA NFHL flood, USDA cropland and CLU, USGS topo, hillshade, satellite — all present, all toggleable, all behind a clean `useDynamicMapLayers` hook. For pre-acquisition site assessment this is better than what I have in QGIS without spending an afternoon configuring services. I'd pay for the map alone if it stood alone, which I'd argue is also a separate product worth selling — call it "AcreOS Atlas" and price it at $19 — to people who don't need a CRM at all.
3. **Zoning lookup with setback returns.** The schema returns setbackFront/Rear/Side and minLotSize as numbers, not text. That's the buildable-envelope math right there, machine-readable. Connect it to a draw tool and the difference between "no subdivider tooling" and "best subdivider tooling I've seen" is one engineer-month.

Honorable mention: the HMAC-link signing flow. I'd use it for purchase agreements on individual lot sales, replacing my DocuSign subscription. Audit row, signer order, expiry — all the things that matter. The savings on the DocuSign annual alone offsets a Pro subscription for the year.

---

**`/tax-optimizer` / `/tax-optimization`** — Two surfaces, similar names. For me the tax conversation is COGS allocation across lot sales, not depreciation strategy. If neither surface can do basis-allocation-on-sale for inventory, neither matters to a subdivider.

**`/blind-offer-wizard`** — I've used the equivalent in REI Pro. The AcreOS one looks reasonable. The output for a subdivider should not be a single offer per parcel — it should run two scenarios: "buy whole and resell," and "buy and subdivide," with the carry-cost differential modeled. The current `pipelineIntelligence` service knows about a "subdivide" disposition strategy. Surface that as a toggle in the wizard. Two days of work.

---

## 7. The deal-killer

**One parent parcel becomes many child lots, and AcreOS does not know that.**

That's it. Everything else — permits, pricing grids, CC&R templates, county timelines — is downstream of fixing the data model. Until a parent parcel can hold child lots in the database, every subdivider feature you build sits on top of a workaround.

I will not move my live work into AcreOS until I can:
1. Open a parent parcel.
2. See its child lots.
3. Allocate basis across them.
4. Track a permit checklist by county.
5. Sketch a subdivision plan on the map and save it.
6. Version a plat document.
7. Set per-lot asking prices with rule-based premiums.

Numbers 6 is built. Numbers 1-5 and 7 are not. Until five of those seven exist I'm in QGIS and Excel — which, honestly, work fine.

If you build it I'll sign for three years and bring you every subdivider I know in middle Tennessee. There are more of us than you think — every county seat has two or three operators turning 80-acre tracts into ten-lot pockets — and none of us have a real tool. Whoever ships this owns a vertical that nobody is competing for. We are too small for the enterprise CRM platforms to chase, too operational for the spreadsheet to scale, and too specific for the generic land CRMs to fit. There is a real moat for whoever respects the workflow.

One more thing: when you do build it, please don't market it as "AI-powered subdivision platform." It is not an AI problem. It is a workflow problem and a data-model problem. The AI tier on top is fine, optional, off by default. The subdividers I know turned the marketing volume off in 2018 and have not turned it back on. Sell us the schema, sell us the drawing tool, sell us the permit tracker. The features will sell themselves.

— Brigid O'Shaughnessy
   Subdivider, Williamson / Maury / Hickman / Davidson Counties, TN
