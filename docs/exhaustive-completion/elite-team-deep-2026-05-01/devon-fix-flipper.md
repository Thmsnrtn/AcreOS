# Devon Carter — AcreOS user review

I'm a fix-and-flipper out of Atlanta. Forty-four. Eight years in. I do roughly ten flips a year — buy distressed houses for $80K to $180K, push them through a 12-to-16-week rehab, list at $200K to $340K. My stack today: PropStream + DealMachine for sourcing, Builders Cloud to run the projects, QuickBooks for the books, DocuSign for paper, and a contractor bench I've spent eight years curating. So when somebody hands me a "real estate platform" and tells me it's for me, I open the rehab budget builder first. If there isn't one, I close the tab.

Half a day in AcreOS. Here's the take.

---

## 1. Thirty-second verdict

Would I sign up today? **Not as my primary.** Maybe as a sourcing tool, sitting alongside PropStream, on the $20 Starter while I trial it.

The persona registry calls me "fix_flipper" and the settings panel literally says: *"Buy distressed property, rehab, resell. Adds rehab budget + contractor management."* That's the pitch. But when I go looking for the rehab budget builder, it isn't there. The dashboard widget for my persona shows "Active Rehabs" with three properties and a `BudgetBar` — and when I open the file (`type-specific-widgets.tsx`), it's pulling from `FLIPPER_MOCK`. **Hardcoded mock data.** 123 Oak St, 456 Elm Ave, 789 Pine Rd, $85K budget, $52K spent, "Kitchen & Bath." That's not a feature. That's a screenshot.

So the marketing on the persona panel is writing checks the schema can't cash. That's the kind of thing that, as a buyer, makes me not trust the rest of the surface.

What would change my mind: ship the actual rehab budget builder backed by real tables (line items, vendors, draws, photos, change orders) and I'll move four of my live projects over the next week. Until then I'm just running comps in here while Builders Cloud does the real work.

---

## 2. Daily-use walkthrough — my imagined first day

**8:00 AM.** I land on `/today`. It greets me. Pulse score, AI cards, expiring offers, stale leads. Pretty. Not relevant. **A flipper's morning is two questions: "are any of my active rehabs behind schedule?" and "did the inspector clear the framing on Oak Street so I can release Draw 2?"** Neither shows up here. The dashboard treats me like I'm a land flipper running a pipeline of cold leads. I'm not. I have three active projects burning $300/day in holding costs and a fourth one closing Friday.

**8:15 AM.** I click into onboarding to set my type. I land on `/onboarding-v2` and see the picker. **There is no "Fix and Flipper" tile.** The options are Land Flipper, Wholesaler, Note Investor, Buy & Hold. The persona registry has `fix_flipper` defined in `personaVocabulary.ts` and `auth.ts`, the dashboard widgets dispatch on `fix_and_flip` (different slug, by the way — the codebase isn't internally consistent on the key name), but the onboarding step that's supposed to set me up for it doesn't expose it. So I picked Land Flipper because that's the closest thing visible. Now the whole platform thinks I'm hunting Loving County, TX, which I am not. I'm hunting Fulton, DeKalb, Cobb, and Clayton.

**9:00 AM.** I open `/parcel-detail` on a candidate house. The composed view is decent for land. For a house, it's missing the entire structure stack at first glance. I poke around — `properties.afterRepairValue` and `properties.estimatedRepairCost` are fields on the schema. Good. But on the surface I cannot find a place where I, the user, type in **my own ARV** based on the three comps I just pulled. The platform treats ARV as an enrichment value populated by ATTOM/BatchData (per the comment in `schema.ts`) — meaning it's a comp-based AVM dressed up with a different label, **not** the post-rehab number I'd defend in front of my lender. **An AVM is not an ARV.** An AVM tells me what it's worth today, in distressed condition. An ARV tells me what it'll be worth after I put in $62K of cabinets, paint, flooring, HVAC, roof patches, and a bathroom redo. **No competent fix-and-flip platform conflates the two. AcreOS conflates them silently.**

The `help-tooltip.tsx` definition tries to cover for this: *"After Repair Value — the estimated market value of a property after renovations are complete. For raw land, this is the estimated value after entitlement, clearing, or infrastructure improvements."* That tooltip is for both audiences and ends up clear for neither. For me, ARV needs a workflow: pick three sold comps within 0.5 mi in the last 6 months, adjust per square foot, apply your contractor's scope of work, output an ARV with a confidence band. None of that exists.

**10:00 AM.** I look for the rehab budget builder. The persona panel promised it. I search the codebase for "rehab budget," "scope of work," "line item." Nothing. There is no `rehabs` table. There is no `rehab_line_items` table. There is no `contractors` table. There is no `bids` table. There is no `draws` table. There is no `change_orders` table. There is no `permits` table beyond a county-level scoring field on `permitData` that counts permits issued by city — useful for market intel, useless for tracking *my* permit on *my* job at 1247 Cherokee Pl.

The "Active Rehabs" widget on my dashboard? Mock array. Three rows hardcoded into a TypeScript file. **The most-promised feature for my persona doesn't have a database.**

**11:00 AM.** I check `/finance` for vendor payments. There's a QuickBooks sync button (`handleQboSync` → `POST /api/bookkeeping/quickbooks/sync`) — that's good, that's exactly what I want. The compliance page mentions 1099-MISC filing in January for contractor payments. **But I see no contractor entity in the system to attach a 1099 to.** No W-9 collection. No YTD payment running totals per contractor. No 1099-NEC generator. (Note: 1099-MISC is the wrong form for contractor labor — that's been 1099-NEC since 2020. The compliance page is dated.) For a flipper paying out $300K-$600K/year in 1099 labor across 8-12 subs, this is the make-or-break tax workflow. Wendell needs 1098-INT for his note borrowers. I need 1099-NEC for my contractors. Neither exists.

**12:30 PM.** I drive to Cherokee Pl for a walkthrough with my GC, Marcus. I open `/field-scout` on my phone. **This is the one surface that genuinely surprised me.** Photo capture, GPS-stamped, offline sync, inspection checklist. I can shoot 40 photos of a kitchen tear-out in a basement with no signal and have them sync when I hit a Starbucks. That's real. That's the field tool I'd build. **Now connect it to a rehab line-item table** so each photo can be tagged to "Kitchen → Cabinets" or "HVAC → Condenser replacement," and I can hand my CPA a folder per line item at audit time. Today the photos aren't tied to budget categories. So they're just photos.

**2:00 PM.** Two of my three GCs sent bids on Cherokee yesterday — $58K, $71K, $63K — for the same scope. I want to put them side-by-side: line by line, where does Marcus go cheaper than Tony on flooring; where does Carlos pad the demolition. That's the bid-management workflow I do today on a yellow legal pad and I hate it. **AcreOS has no bid-comparison surface.** No way to upload a contractor estimate, parse it into line items (this is exactly the kind of LLM-extraction problem the platform brags about for other workflows), and reconcile across vendors. Missed opportunity.

**3:30 PM.** I'm two months into 1247 Maple. My private lender funds in three draws: 25% / 50% / 25%, each gated on inspection. I need a draw schedule view showing draws taken, draws remaining, inspection dates, lender contact, % complete per draw. **No draw-schedule entity exists.** There's a `notes` system for seller-financed paper aimed at land investors with payment streams, but that's for me being the lender on dispo, not me being the borrower on acquisition+rehab. Construction lending is a different beast and AcreOS doesn't model it.

**4:00 PM.** Project timeline. Builders Cloud gives me a Gantt: demo week 1-2, framing 3-5, rough-ins 5-7, drywall 7-9, finishes 9-13, punch 13-14, list 15. I have nothing remotely Gantt-ish in AcreOS. The `tasks.tsx` page is generic to-dos. There's no concept of dependencies (rough-ins can't start until framing inspection passes). Without dependency-aware scheduling, the platform cannot tell me "Maple is 6 days behind because the inspector won't be here till Tuesday." That's the question I need answered every morning.

**5:00 PM.** Dispo. The house is done, ready to list. AcreOS has `/listing-syndication` — MLS, portals, marketplaces. Promising. But it's general-purpose listing syndication, not "I'm a flipper choosing between (a) Atlanta MLS via my realtor on a 3% co-op, (b) FSBO on Zillow + Redfin, (c) wholesaling to my buyer list at $5K assignment." Each path has different docs (listing agreement vs. MLS-bypass disclosures vs. assignment contract), different timelines, different commissions. There's no flipper-specific dispo wizard.

---

## 3. Per-surface friction

**`/onboarding-v2`** — Fix-and-flipper isn't a selectable business type. The persona slug `fix_flipper` exists in vocabulary; the widget dispatch uses `fix_and_flip`; the picker offers neither. **Three different keys for the same persona across three files.** Pick one and unify (`shared/models/auth.ts:87`, `personaVocabulary.ts:31-96`, `type-specific-widgets.tsx:109`).

**`/today`** — Generic for me. A flipper's home dashboard should default to: active projects with days-on-site, days-vs-plan, $ remaining vs. $ spent, next inspection date, next draw, days to listing. None of those exist.

**`/parcel-detail`** — Conflates AVM and ARV. The DD checklist (title, liens, environmental, access, taxes) is land-flavored. For a house I need a different checklist: roof age, foundation, HVAC age, electrical panel amperage, plumbing material (galv vs. copper vs. PEX), structural concerns, asbestos/lead-paint flags for pre-1978, sewer-line scope, mold inspection. None of that is in the DD checklist that ships.

**`/properties`** — Default table works. Map view would be nice. **What's missing for a flipper: a "Project status" chip per row** — Acquired / Demo / Framing / Rough-ins / Drywall / Finishes / Listed / Under Contract / Closed. Today every property is in the same status pool as raw land deals.

**`/deals`** — Pipeline kanban for acquisition. Fine for offer→accepted→closed. **Doesn't model the rehab middle.** Once I close, the deal disappears from the pipeline and there's no "Active Project" board to take its place.

**`/finance`** — QuickBooks sync is the right primitive. Missing: per-contractor YTD payment totals, W-9 storage, 1099-NEC generator, **rehab cost-by-job rolled up against budget for live variance reporting**. My CPA wants Schedule C / Schedule E split per property + a clean labor-and-materials breakdown. The notes-and-payments-centric data model in `schema.ts` is built for the note investor, not the operator paying contractors weekly.

**`/listing-syndication`** — Right idea, wrong specificity. Needs flipper-mode: "List with realtor" / "FSBO direct" / "Wholesale assignment" with the corresponding docs and fee structure pre-loaded.

**`/field-scout`** — Best surface for me. Wire photos to budget line items and you've got the IRS-receipts-and-QC tool I'd pay $50/mo for as a standalone.

**`/compliance`** — 1099-MISC reference is outdated; should be 1099-NEC for non-employee compensation (post-2020). And the platform lists the deadline but doesn't generate the form. Listing a deadline I have to meet manually is just nagging.

**`/pax`** — The agent layer. I asked it (in my head) "is Maple on schedule?" and there's no project data to answer with. The Pax pitch falls apart when the data layer doesn't have rehabs.

---

## 4. The contractor-and-tax test — failing

My CPA needs five things every January. Here's how AcreOS does for me:

- **1099-NEC for every sub I paid >$600** — *Fail.* No contractor entity, no W-9 storage, no YTD totals, no form generator. This is my single biggest tax workflow and it's missing.
- **Cost basis per flip** — *Partial.* `properties` has `estimatedRepairCost` as a single number. Real basis = purchase + closing + materials + labor + permits + holding (utilities/taxes/insurance/interest) + selling. None of that is itemized in a basis schedule view.
- **Schedule C vs. Schedule E split** — *Unclear.* I'm on Schedule C (dealer, ordinary income on flips). A buy-and-hold investor is on Schedule E. The platform doesn't ask about my entity classification or treat the income differently.
- **Section 263A capitalization rules** — *Not modeled.* If I'm a dealer holding inventory, certain costs capitalize into basis instead of expensing. The platform isn't aware.
- **Cost-segregation studies** — There's a `depreciation-calculator.tsx` page. Doesn't apply to me as a dealer; flips are inventory, not depreciable. Fine — but the platform should know that based on my persona and not push depreciation suggestions at me.

**Net: this is a fail for the flipper tax workflow as it stands.** The QBO sync is the right primitive but everything that feeds into it is missing.

---

## 5. Five features that would make this a no-brainer switch

1. **Rehab budget builder.** A real `rehabs` table + `rehab_line_items` (category, scope, vendor, budgeted, committed, spent, variance, photos). Templated scopes — "kitchen mid-grade," "bath gut," "roof tear-off & replace," "exterior paint" — with default $/sqft so a new flipper can baseline. This is the feature your persona panel is selling. Build it.

2. **Contractor management with 1099 in January.** A `contractors` table, W-9 upload at first payment, YTD running total, end-of-year batch 1099-NEC generator that signs and mails (you already have the HMAC signing rails). Replaces the spreadsheet I keep on my dining-room table every December.

3. **ARV that isn't AVM.** A purpose-built ARV workflow on `parcel-detail`: pick 3-5 comps, apply $/sqft adjustment for sqft difference, apply scope-of-work delta (post-rehab condition vs. comp condition), output ARV with low/expected/high. Distinguish in the UI from the enrichment AVM. Your lender will care about this distinction — the IRS will too.

4. **Bid comparison with parsed estimates.** Drop three contractor PDFs into a job, LLM-extract line items, normalize to your scope template, show a side-by-side. This is exactly the kind of AI workflow your platform is positioned for and nobody else in the flipper-software space is doing it well.

5. **Construction-draw schedule wired to the project timeline.** Lender, total loan, draws planned, % per draw, inspection date, draw status, days-of-interest accruing. Daily holding-cost meter on the project view. When my GC says "we're a week behind," I want the platform to translate that into "$2,140 in additional carry, here's the new break-even sale price."

---

## 6. Three things that are surprisingly good

1. **`/field-scout` with offline photo sync.** I can shoot a job site in a no-signal basement and have it post when I'm back on cell. Whoever specced this has been on a real rehab site. Now connect each photo to a rehab line item and you have a flipper-specific feature nobody else has.

2. **The persona vocabulary registry.** It calls things "Project" and "Flip" and "Distressed owner" for me. Small thing — but if the rest of the product caught up to the vocabulary, this would be a real differentiator.

3. **HMAC-link signing flow.** The same primitive Wendell loved is the one I'd use to send change orders to my contractors for their initial. DocuSign costs me $480/year and 60% of what I send is one-pagers. If this works for my GC's assistant on her flip phone, it's gone.

---

## 7. The deal-killer if not fixed

**The persona panel makes a promise the database can't keep.** It says: *"Adds rehab budget + contractor management."* There is no rehab budget. There is no contractor management. The dashboard widget for my persona reads from a hardcoded mock array. The most-promised features for my type are vapor.

I can forgive a young product for not having a feature. I cannot forgive a product for *advertising* a feature it doesn't have. That's the moment a buyer decides the team doesn't know what they don't have — which means the rest of the surface might also be Potemkin. Fix the persona-panel copy first (today, it's a 5-line edit), then build the rehab + contractor stack second. Don't ship the marketing before the schema.

The day there's a real `rehabs` table with real line items, real contractor records with real W-9s, real bids being compared, and real draws tied to real inspections — I move four of my live projects over and tell every flipper in my Atlanta REIA. Until then I'm running comps in your sourcing surface and doing the actual work in Builders Cloud.

— Devon
