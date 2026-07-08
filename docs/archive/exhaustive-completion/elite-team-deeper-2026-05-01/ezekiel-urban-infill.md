# Ezekiel Crow — AcreOS user review (urban-infill specialist)

I'm 39. Detroit, Michigan. I buy distressed city lots — Detroit, Cleveland, Memphis, Baltimore — at $500 to $5,000 a piece, sometimes 50 at a clip out of a Wayne County tax-foreclosure auction. I sell them to local builders for $8K-$25K when I can, or I lot-bank them for five to ten years and let the neighborhood come to me. The side-lot programs in Detroit and Cleveland move 20% of my volume. My title work runs through a paralegal in Hamtramck named Renata who quiets thirty clouds a year for me. My books live in QuickBooks Online and a shared Google Sheet that Renata, my mowing crew, and I all hammer on. I have looked at every piece of REI software on the market and most of them assume I'm buying ten-acre rural parcels in Texas. So when somebody hands me AcreOS and says "land investor platform" — I am skeptical before I open the laptop. Here's what I found after a half-day with the persona switcher set to Land Investor (because there is no "urban infill" persona — more on that).

---

## 1. Thirty-second verdict

Would I pay for this today? **No, not at any tier, not for my actual workflow.** I'd open a free or $20 starter account to use the auction calendar and the title-search wrapper as side tools, but my real pipeline stays in my Sheet because the data model does not understand the shape of my business. The single-asset, single-deal, single-buyer mental model behind every screen here is built for somebody buying one 40-acre parcel in Luna County New Mexico from a motivated seller. I buy 50 city lots out of one Wayne County auction docket on the second Tuesday of October, every year, and the platform has nowhere to put that.

The persona registry shipped seven options — `land_investor`, `note_investor`, `tax_delinquent`, `wholesaler`, `subdivider`, `fix_flipper`, `landlord`. **There is no urban-infill, no infill-flipper, no lot-banker, no side-lot operator.** The closest is `tax_delinquent`, which is a lead-source label, not a business model. I can pick it; nothing meaningful changes downstream. The persona is decorative.

At the price points I work in — a $1,200 acquisition basis on a Brightmoor lot — every dollar of monthly SaaS matters. Pro tier at $49/mo would eat 4% of my acquisition basis on a single lot per month. A rural flipper buying a $40K parcel would feel that as 0.12%. The pricing assumes rural acquisition basis, and my whole business breaks the assumption.

---

## 2. The seven things I need — and what AcreOS actually has

### **(1) Tax-foreclosure auction calendar — county-level, with bid-track integration.**

Wayne County publishes its tax-foreclosure auction list every August for the September/October sale. The list is public, runs 12,000-18,000 properties, and ships as a PDF and a CSV. I open it the morning it drops, I filter to my four target zip codes (48205, 48227, 48228, 48238), I pull the assessor records on the 200 that look promising, I pre-bid the 40 I'd actually take, and I show up on auction day with $80K in cashier's checks. Cuyahoga (Cleveland), Shelby (Memphis), Baltimore City — same rhythm, different month, different list format.

What AcreOS has: a `tax-researcher.tsx` page with an **Auctions** tab. There's a "scan auction calendar" mutation and a `/api/tax-researcher/auctions` endpoint. The data model has `auction.county`, `auction.state`, `auction.name` — the bones are there. I checked the scan path and it's set up to pull from generic state-level lien sources, not the specific county foreclosure auctions where my volume actually lives. **I'd never find Wayne County's October sale in here today** — the system is built around state-level tax-lien states (Texas, Florida, Arizona), not the city-driven tax-foreclosure auctions that drive Rust Belt urban infill.

What I'd build:
1. A county auction-source registry seeded with the top 20 urban-infill counties — Wayne MI, Cuyahoga OH, Shelby TN, Baltimore City MD, Cook IL, Philadelphia PA, Lucas OH (Toledo), St. Louis City MO, Hamilton OH (Cincinnati), Genesee MI (Flint). Each entry needs the publication date pattern, the auction date pattern, the source URL or PDF location, and a parser hint.
2. A bulk-import path from the auction CSV that creates **draft properties in a single batch**, not eighteen separate manual entries. The `tax-delinquent-importer.tsx` shape is close — it takes a CSV with `parcel_id`, `assessed_value`, `taxes_owed`, `county`, `state`. Wire that same UX to "Import auction list" and the volume problem mostly solves itself.
3. Pre-bid scoring — given my filter rules (zip code, min lot SF, max minimum bid), pre-rank the auction list and let me mark the top 40 as "watching." The infrastructure for `dealFeedEngine` and `Pulse score` exists; pointing it at auction inventory is the surface change.
4. Bid tracking on auction day — note what I bid, what I won, what I lost to whom, what the winning bid was. That data feeds next year's pre-bid model.

The tax-researcher surface is the closest thing in the product to my actual workflow, and **with one weekend of work it could go from "tax-lien curiosity tab" to "the reason I open AcreOS in October."** Aim it at the urban auctions, not the rural lien states.

### **(2) Quiet-title and clouded-title workflow.**

About 70% of the lots I buy come with title issues. Heir title where the owner of record died in 1987 and there are eleven living grandchildren. Tax-deed title that's voidable for the first 21 days post-sale under Michigan GPTA. Mechanic's liens from a contractor who tore down the house in 2003 and never got paid. Renata files a quiet-title action in Wayne County Circuit Court for me roughly thirty times a year — service by publication, twenty-eight day answer period, default judgment, recorded order. Each one is a sixty-to-one-hundred-and-twenty day project with named defendants, served-on dates, response deadlines, and a court order at the end.

What AcreOS has: a `title-search.tsx` page that runs a **preliminary title search** via `/api/title-search/search`. The output is "title issues" — a flat list. There's a `legalIntelligence.ts` service. There's a `compliance.tsx` and a `regulatory-intelligence.tsx`. **None of these track an open quiet-title case as a stateful workflow.** It's a one-shot lookup, not a docket.

What I need is a **case management surface** per parcel — quiet-title action filed (date, court, case number), defendants served (each with served-on date, method — personal/publication/mail), answer-period expiration date, default judgment date, recorded order date, attached documents. This is the same shape as a permit tracker. Different domain, same pattern: gates, dates, documents, contacts, status.

The `documents.tsx` + `documentVersions` infrastructure (already shipped — I checked, it works) handles the document side. The `tasks.tsx` surface could carry the gate checklist. **What's missing is the connective tissue — a "Title actions" tab on the property detail page with a structured workflow, not a flat issues list.** A quiet-title action is a 90-day project; treating it as a "title issue" line item misses the entire job.

If you ship this for the top 5 urban states (MI, OH, TN, MD, MO) with state-specific quiet-title templates, you'd own a workflow no other REI tool has. Title-only specialists charge $1,200 per quiet-title action; the workflow tooling for it doesn't exist anywhere.

### **(3) Lot mowing, maintenance, and city-fine tracking.**

City of Detroit will fine me $300 per uncut lot if the grass is over 12 inches in summer. Multiply by 50 lots, three cuts a season, and that's my single largest operating line. I have one crew (Maurice and his cousin) who runs 35 lots on a 21-day rotation May through October. I pay them per cut. I track which lots got cut on which dates because if Detroit issues a violation on lot 14782 Greenview I need to be able to show the cut log.

What AcreOS has: a `code violation` flag on the property distress display. That's it. There is no recurring maintenance schedule, no service-provider/vendor table for mowing crews, no per-lot cut log, no fine tracking, no annual maintenance budget rollup. I searched: there's a `vendorName` and `vendorEmail` on a different table (Due-Diligence assignments) and a `buyOptions` jsonb for vendor pricing on a marketplace surface, but **nothing wired to recurring lot maintenance.**

For an urban-infill operator, mowing isn't an extra — it's the dominant operating activity. My acquisition is 8 hours a year at the auction; my maintenance is 800 hours a year of crew dispatch, fine appeals, and post-storm checks. The product has zero surface for the 99% of the time I'm not buying.

What I'd build:
1. A `lot_maintenance_schedule` table — parcel, service type (mow/trash-out/fence/snow), recurrence, vendor, last-completed date, next-due date, cost.
2. A vendor table for crews — contact, rate, lots-assigned count, last-cut log.
3. A simple "dispatch sheet" view — "These 12 lots are due for cutting this week; here's Maurice's sheet."
4. Fine tracking — code-violation events per lot with fine amount, appeal status, payment status. Roll up to "$2,400 in fines outstanding, $1,800 paid YTD, $600 successfully appealed."
5. An annual cost rollup per parcel — purchase basis + cumulative maintenance + cumulative fines = total carry. **At year 5 of lot-banking, that number is what tells me whether to sell or hold another year.** Right now I keep it in the Sheet.

### **(4) Side-lot programs.**

Detroit's side-lot program lets the adjacent homeowner buy my vacant lot for $100 if certain conditions are met. Cleveland Land Bank does similar. **For lots where the neighbor expresses interest, I sell at side-lot prices voluntarily — it's the cleanest disposition I have.** My side-lot pipeline is roughly 8 lots a year, $100-$1,500 each, basically free relative to my basis.

What AcreOS has: nothing. The disposition surface is structured around builder/investor sale or owner-finance note creation. There's no "neighbor sale" channel, no adjacent-owner outreach template, no side-lot program registry per city.

What I'd build:
1. An adjacent-owner lookup. The `routes-micro-features.ts` already has `lookupNearbyParcels` — that's the seed. Surface it as "adjacent owners" on the property detail.
2. A side-lot disposition channel in the disposition flow alongside cash buyer and owner-finance. Different paperwork (city deed restrictions, owner-occupancy affidavit, no-resale-for-N-years), different price point.
3. A city side-lot program registry — Detroit, Cleveland, Baltimore, Toledo, Flint, Gary, Birmingham — with the eligibility rules and the city contact for each. Like the county auction registry I asked for in (1), but for the disposition side.

### **(5) Lot-banking strategy — multi-year hold.**

Three of my best lots I bought in 2018 for $400 each in a block of New Center that was nothing. They're worth $35K each today because Olympia Entertainment built the arena three blocks away in 2017 and the wave finally reached. **I held five years and made an 87× return.** That's the strategy.

What AcreOS surfaces: deal pipeline, deal stages, AcreScore, Pulse score, "next action" prompts, an executive agent that wants me to send mailers and run sequences. The entire UX is built around **velocity** — get a lead, send an offer, close the deal, list it, sell it, move to next. There is no UX for "I bought this in 2018 and I'm not selling until 2027." A property in my "Held" stage gets zero engagement from the system. The dashboard widgets, the activity feeds, the agent suggestions all assume forward motion. A lot-banking portfolio is the opposite of that — a five-year cooling period with mowing as the only activity.

What I'd want:
1. A `hold` status that's first-class, not a synonym for "stale lead." Properties in hold should be visible, queryable, but **not nagged.** No "This deal has been idle for 90 days" warnings.
2. An appreciation tracker — pull current assessed value annually, compare to basis, surface the unrealized gain. Detroit reassesses every year; my 2018 $400 lot has an annual datapoint going back seven years. That's a chart somebody on the team would build in 30 minutes if asked.
3. A "release trigger" rule — alert me when a lot-banking parcel hits a threshold (assessed value > $X, adjacent-sale price > $Y, neighborhood transaction velocity > Z/year). The `marketPulseEngine` already exists; pointing it at hold-portfolio parcels is a small lift.

### **(6) Bulk acquisition — 50 lots at a time.**

The October Wayne auction I'm buying 50 properties on a single day. They each need a parcel record, a tax record, a current owner (the county, before transfer), a target buyer category, a holding strategy. **Single-lot manual entry is dead on arrival at this volume.**

What AcreOS has: the `tax-delinquent-importer.tsx` is **the single most useful component in the app for me.** CSV upload, column mapping (`parcel_id`, `owner_name`, `mailing_address`, `assessed_value`, `taxes_owed`, `tax_year`, `county`, `state`), preview, import. That UX pattern, applied to auction wins, would solve my volume problem.

What's missing:
1. Re-purpose the same importer for "import auction wins" with a different schema (winning bid amount, auction date, auction county, lot legal description).
2. Bulk operations on the imported set — bulk-assign to a hold portfolio, bulk-mark for quiet-title action, bulk-add to mowing schedule with a single vendor.
3. A "bulk acquisition" record — the 50 lots are not 50 unrelated deals, they're one acquisition event with a single check-cashing date, a single set of recording fees split across them, and a single rollup of "what did I deploy on October 14, 2024."

The schema already supports child-of-parent relationships in spirit (the subdivider audit asked for this). An "acquisition group" is the same primitive — many parcels rolling up to one event.

### **(7) Pricing and economic fit.**

The deal calculator (`deal-calculator.tsx`) defaults to `holdingCostsMonthly: 50` and `holdingPeriodMonths: 6`. **That is reasonable for a $40K rural parcel held while a buyer is found.** It is wrong by two orders of magnitude for me — my holding cost is $0/month for the first 18 months (I just pay taxes and mowing seasonally), and my holding period is 60-120 months. The IRR math the calculator runs assumes a 6-month flip; my actual returns come from a 60-month hold. The math is right; the priors are rural.

The blind-offer calculator (`blindOfferCalculator.ts`) expects comparable sales data sourced from "county_records / landwatch / land_and_farm / usda_nass." **Detroit vacant city lots don't appear on LandWatch, Land and Farm, or USDA NASS.** Those are rural sources. The right comp source for me is Detroit's open-data portal, the Wayne County register of deeds bulk export, and Trulia/Zillow for nearby teardown comps. The calculator returns "Insufficient comp data" on every parcel I run.

The dueDiligenceEngine awards an AcreScore bonus of +150 for "adjacent to public land (BLM/USFS)" and a recreational premium for "forest >60%." **Neither of those exists in my market by definition.** The scoring rubric is a rural rubric. An urban-infill rubric would weight: distance to nearest in-progress development, neighbor occupancy rate within 200 feet, school district rating, side-lot program eligibility, walkability score. None of that is in the engine.

This is not a bug — it's a positioning question. The product was built for rural land flippers and the rubric reflects that. To serve me, an `urban_infill` persona would need its own scoring model, not just renamed labels over a rural model.

---

## 3. Specific surfaces I touched and what broke

**Properties list (`properties.tsx`).** I created three sample parcels with addresses on Pingree, Greenview, and Petoskey in Detroit. The list view rendered fine. The detail page assumes I have a market value, a list price, an acreage, and structured distress flags — for a $1,200 vacant city lot, I have none of those. Acreage on a 30×100 city lot is 0.069. The display rounds to "0" or shows ".07 acres" which is technically correct but visually it screams "broken." Urban lots want square feet displayed primary, acres secondary. The schema has `lotSizeSqFt: integer("lot_size_sq_ft")` already — the display layer just hasn't been told to prefer it for sub-half-acre parcels.

**Deal-hunter (`deal-hunter.tsx`).** The rule builder takes a `maxPriceCents`, `minScore`, `counties`. I set max price $5,000, min score 60, counties "Wayne". The rule saved. The system found zero matches because the deal-feed engine is sourced from generic land listings (LandWatch, Land and Farm, etc.), not the Wayne tax-foreclosure auction docket. The rule is fine; **the inventory pool is the wrong pool for me.**

**Counties page (`counties.tsx`).** I navigated to Wayne County. The page rendered with land-investor-flavored stats — average per-acre price, recent rural transactions, USDA NASS data. **The per-acre price for Wayne County is meaningless** — there's a 100× difference between a downtown commercial parcel and a Brightmoor vacant lot, both technically Wayne. Urban counties need a sub-county view (zip code or neighborhood), and the comp engine needs a sub-half-acre filter that excludes the rural-zoned parcels at the county edges.

**Title-search (`title-search.tsx`).** Ran it on a sample Wayne parcel. Got back a flat list of "title issues" — "Heir potential, last grantor recorded 1987" and "Unsatisfied mortgage 1992." Those are real issue types. **What's missing is the next step** — there's no "open quiet-title workflow" CTA, no "schedule with paralegal" action, no template for the named-defendants list. The output is a diagnosis with no treatment plan.

**Tax-researcher → Auctions tab.** Filtered to MI. Saw a "scan auction calendar" button. Clicked. Got a "Scan complete" toast. The auctions list was empty. The endpoint is wired but the underlying source registry doesn't include Wayne County's foreclosure auction. **The plumbing is there, the registry isn't seeded for my world.**

**Onboarding wizard.** Picked "Land Flipper" (the closest available — there's also Residential Wholesaler). The questions that followed asked for target acreage, target states, average deal size. I answered "0.05 acres," "MI/OH/TN/MD," "$2,500." The system accepted but **no downstream tuning happened** — the dashboard, the recommendations, the agent prompts are all still pointing at rural-flipper defaults. The persona is captured but not consumed.

---

## 4. The data model gaps, ranked

1. **No `urban_infill` or `lot_banker` persona** in `Persona` union (`shared/models/auth.ts`). Add one, wire vocabulary, ship a different scoring rubric.
2. **No acquisition-group concept.** 50 lots from one auction need to roll up. Same primitive the subdivider audit asked for (parent_parcel_id), different name (acquisition_event_id).
3. **No recurring maintenance schedule.** Mowing is the dominant operating activity for me; the schema has nowhere for it.
4. **No quiet-title workflow surface.** Title issues exist as flat strings; cases need a docket-shaped workflow.
5. **No side-lot disposition channel.** Disposition is binary (cash/owner-finance); needs a third channel for city-program sales.
6. **No multi-year hold UX.** "Held" is treated as "stale"; needs to be first-class with appreciation tracking and quiet-mode (no nags).
7. **Comp sources are rural-only.** LandWatch, Land and Farm, USDA NASS — none of them have Detroit city lots. Need urban comp sources (Trulia, Zillow, Redfin teardown comps, city open-data portals).

---

## 5. What I'd actually pay for

**Free tier, today, as a side-tool:** auction calendar (if Wayne is in it), title-search wrapper, the bulk CSV importer.

**$20/mo, if you ship the urban auction registry and bulk import polish:** I'd pay for that to consolidate the spreadsheet I keep for the four cities I work in.

**$49/mo, if you ship quiet-title workflow + mowing/fine tracking + side-lot disposition:** Now I'm replacing Renata's case sheet, my Google Sheet for the crew, and my QuickBooks tag system. That's a real product.

**$99/mo, if you ship the full urban-infill persona — scoring rubric, lot-banking-friendly UX, multi-year appreciation tracking:** I'm a customer, and I bring three friends.

The infrastructure to do all of this exists. The auction surface, the importer, the document versioning, the nearby-parcel lookup, the document tasks, the vendor field — they're all in the codebase. The work is wiring them into the urban-infill workflow, adding the eighth persona, and shipping a scoring rubric that doesn't penalize "dominant land cover: developed."

Until then, AcreOS is a rural land flipper's tool that happens to have a Detroit zip code in its allowed-input list. I'll keep my Sheet.

---

## 6. The bias problem, explicitly

The product has rural-investor priors baked into eight different layers and most of them are invisible until somebody like me pokes them:

- **Vocabulary.** "Land Investor" is the default persona term. In Detroit, nobody calls themselves a Land Investor. They say "vacant lot guy," "infill flipper," "side-lot operator." The label is technically accurate and culturally wrong.
- **Default values.** Holding cost $50/mo, holding period 6 months, default acreage in the dozen of acres. All wrong for me by 10-100×.
- **Comp sources.** Rural land listing sites only.
- **Scoring weights.** BLM adjacency, forest cover, recreational premium. Zero of these apply to me.
- **Disposition channels.** Cash buyer or owner-finance. No city-program channel.
- **Map surface.** Mapbox tiles default to a wide view appropriate for 40-acre parcels; for a 30×100 city lot you need to zoom much further in to see the shape.
- **Onboarding flow.** Asks acreage in acres, not square feet. A 0.069 input feels wrong to type.
- **Agent prompts.** The executive agent suggests "send a mailer to 500 owners in counties X, Y, Z." For me, the analog is "show up at Wayne auction in October," and that prompt does not exist.

A genuine "urban infill" persona would touch all eight layers. The persona framework exists; nobody has filled in the column for me yet. **If you want urban-infill operators in your customer base — and there are roughly 8,000 of us nationally, and we're cash-rich and software-poor — the work is well-scoped. Twelve weeks, two engineers, one PM who's willing to spend a week riding with me through a Wayne auction cycle to see the actual shape of the work.** Otherwise the persona registry's seven slots stay rural and I stay in QuickBooks.

I'll close on a positive: the bones in this codebase are better than the bones in any of the four REI tools I've trialed in the last two years. The schema is clean, the surfaces are consistent, the document-versioning is a real implementation, the bulk importer pattern is right, and the auction tab exists as a stub waiting to be aimed at the right inventory. **You are one positioning decision and one twelve-week sprint away from being the best urban-infill tool on the market — because no such tool exists.** That's the opportunity. Take it or don't, but don't pretend the persona registry already covers me. It doesn't.
