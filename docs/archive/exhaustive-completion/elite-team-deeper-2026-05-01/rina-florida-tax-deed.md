# Rina Goldstein — AcreOS user review

I'm 51, run my operation out of Tampa, and I do one thing: Florida tax-deed auctions. Not 50 states, not Texas struck-off sales, not Memphis courthouse-step deals. Florida only. Eight years in. I bid online via the county portals — Lee runs through Grant Street's RealAuction, Hillsborough does too, Miami-Dade is its own platform — and I work a price band of $3K to $80K on rural lots and the occasional small-town infill. My kit is TaxSale Resources for the certificate-sale calendars in May/June, a Tampa real-estate attorney named Frank who handles every quiet-title I file under §65.061, an Excel sheet I rebuilt three times, and a USB-tethered laptop on auction days because Lee County's site won't let me use my phone hotspot reliably.

I read Marcus's review. He gets the multi-state tax-delinquent picture right. I'm here to flag the **Florida-specific** holes — because Florida is its own animal inside this category, and AcreOS is treating it like just another row in a state-rules table.

---

## 1. Thirty-second verdict

**Closer to "no" than Marcus's "probably not yet."** Marcus has 4 states and 3 of them aren't in the rules table. I have 1 state and the table technically has it — but the *workflow* underneath FL is so generic that it doesn't matter. AcreOS knows Florida is "lien, 18%, 24 months." It does not know:

- Florida runs **two** auctions per parcel: the certificate sale (May/June, online), then a separate tax-deed sale 2 years later if the certificate holder applies.
- Bidders bid the **interest rate down** from 18% — winner is whoever takes the lowest rate. Most platforms model "highest bid wins." That's not how FL certificate sales work.
- 67 counties, **at least three different online auction platforms** (RealAuction/Grant Street for ~50 counties, Bid4Assets for some, county-built for Miami-Dade and a few others).
- Homestead-occupied properties have a different redemption math and a higher minimum opening bid at the deed sale (statutory floor includes half of assessed value).

If they fix the bid-down workflow and the two-stage certificate-then-deed clock, I'd renew. Today, I'd take the trial and stay on Excel.

---

## 2. Daily-use walkthrough — what my May looks like in AcreOS

**5:30 AM, May 12.** Pinellas certificate sale opens at 8 AM. I open `/tax-researcher`. The four-tab layout is fine. I filter to FL. The auction generator returns synthetic results — the same `Math.random()` parcel counts Marcus flagged, with `depositRequired: "500"` for every county. Pinellas requires a **5% deposit on your bid budget wired the Friday before the sale**. RealAuction won't let me bid without it. AcreOS doesn't surface that. It surfaces $500. **If a new investor trusts this number they show up to the auction with 1% of the deposit they actually need and get locked out.**

**6:00 AM.** I look at the legal-intelligence card. `legalIntelligence.ts` line 122 says: "Florida is the largest tax lien market. Bidding starts at 18% and goes down. 2-year redemption period before deed application." That's correct as far as it goes. What's missing is everything that comes after "before deed application": the §197.502 application fee (~$75 + sheriff's title-search cost ~$200-$400), the 30-day publication requirement, the homestead-property opening-bid math (½ assessed + outstanding taxes + costs), the §197.522 notice-to-owner-and-lienholders requirement. Pax doesn't know any of this. I asked it "what's the minimum opening bid for a homesteaded tax deed in Florida" and got a generic "consult your county clerk" answer. **For a Florida-only persona, Pax needs to know F.S. Chapter 197 cold.**

**8:00 AM.** The Pinellas sale opens. I'm on RealAuction's site, not AcreOS. AcreOS has zero integration. I bid down on 14 certificates, win 9, bid the rate down to 0.25% on the two best parcels (yes, bidders routinely bid below 1% on the cleanest rural lots — the *return* on those is the 5% mandatory minimum interest under §197.472(2), which kicks in on any bid below 5%, plus the option to apply for tax deed in 24 months). **AcreOS has no concept of "winning bid rate," let alone the 5% floor rule.** The schema treats interest rate as a single field on the auction, not a per-certificate winning bid. So when I import my 9 wins, there's nowhere to put the 0.25% / 1.5% / 4% rates I won at. Forced back to Excel.

**11:00 AM.** Sale ends. I owe payment by 4 PM Wednesday. The county will mail (yes, mail) the certificates 6-8 weeks later. I want a "certificates pending" view in AcreOS — 9 rows, each with: parcel, bid rate, principal, accrual start date, expected certificate-receipt date, county. **There's no surface for this.** The `taxSaleListings` table has the bones, but no UI, no certificate-state machine (purchased → paid → certificate-received → accruing-interest → eligible-for-deed-application → deed-application-filed → deed-sale-scheduled → deed-issued OR redeemed).

**3:00 PM, two months later, July.** The certificates arrive. I want to enter them into AcreOS and never look at Excel again. The closest thing I have is `/parcels` and `/tax-delinquent`, neither of which models a tax certificate as the primary entity. **A FL-only operator needs `/certificates` as a first-class surface.** Marcus would benefit from this for his 16 Marion County certs too.

**April 2028 (two years later).** Eligible to apply for tax deed on certificates I bought in May 2026. I log into the Pinellas Clerk's portal, fill out the §197.502 application, pay the fee, wait for the sheriff's title search. **AcreOS has no "deed application" workflow.** No reminder that the 2-year window is open. No template for the §197.502 application. No tracking for the sheriff's title search (which often takes 30-90 days and is the bottleneck for everything downstream). The `legalIntelligence.ts` card mentions "2-year redemption period before deed application" once, in prose, in an `investorConsiderations` array. Prose isn't a workflow.

**Sheriff's title search returns.** It identifies all lienholders and the owner of record. I now have to **send statutory notice under §197.522 to every named party** — owner, lienholders, mortgagees, anyone with a recorded interest. 20 days minimum before the sale. AcreOS has a documents module but no §197.522 notice template, no service-of-process tracking, no "notice sent" / "notice acknowledged" / "return-receipt received" state machine. Frank charges me $400/parcel to handle this. AcreOS could do it for $50 and own me forever.

**Deed sale day.** The county auctions the property. **Homestead vs non-homestead changes the opening bid math.** Non-homestead opens at: outstanding taxes + interest + costs + ½% per month. Homestead opens at: that, plus ½ of the assessed value. On a $200K homesteaded parcel, the floor is $100K+ — most homesteaded properties get redeemed before deed sale because the owner can't lose that equity. AcreOS does not encode this. I got burned in 2022 bidding on what I thought was a $4K minimum-bid parcel; turned out it was homesteaded and opened at $87K. **One field on the parcel record — `isHomestead: boolean` — and a derived opening-bid calculator would have saved me a wasted Tuesday.**

**Deed sale won.** I now own the property. Surplus funds (anything I bid above the minimum) go into the registry of the court for the prior owner / junior lienholders to claim. Florida has a whole sub-industry of surplus-fund recovery. **AcreOS has no surplus-funds tracking.** I can't tell you how many parcels of mine have unclaimed surplus sitting at the clerk because I lost track.

---

## 3. Per-surface friction (FL-specific)

**`/tax-researcher`** — The state filter accepts FL. The auction generator is synthetic (Marcus flagged this generically; my version: it doesn't distinguish certificate sales from deed sales, so it shows me "FL auctions in May" without telling me whether each is a cert sale or a deed sale, and those are entirely different products). **Add a `saleType` filter: tax_certificate / tax_deed / both.** The schema appears to support it; the UI doesn't surface it.

**Online-platform integration** — Florida's 67 counties run on roughly four platforms: Grant Street's RealAuction (Lee, Pinellas, Hillsborough, Polk, ~50 others), Bid4Assets (a handful), Miami-Dade's in-house portal, county-custom (Monroe, a few panhandle). **AcreOS integrates with none of them.** I'm not asking for live bidding through AcreOS — that's a regulatory minefield. I'm asking for a *post-sale results import*: paste a RealAuction results URL or upload the results CSV, AcreOS parses my winning bids and creates certificate records. That's a one-week feature. Today: zero.

**Certificate-rate field** — Fundamental missing field. A Florida tax certificate is identified by (county, certificate-number, sale-year) and characterized by (face-amount, **winning interest rate**, sale-date). The `taxSaleListings` schema has none of: certificate-number, winning-rate, sale-year. So even if I imported my 9 wins, there's nowhere structured to put them.

**Bid-down auction model** — `dealHunter.ts` has `maxBidAmount` for high-bid auctions. FL certificate sales are reverse: I set a *minimum acceptable rate* (e.g. "I won't go below 1.5%"). The data model can't express this. **Add an `auctionDirection: "high_bid" | "low_bid"` field and a `minAcceptableRate` companion to `maxBidAmount`.** Then the worksheet generalizes.

**5% statutory floor (§197.472)** — Any FL certificate that wins at a rate below 5% accrues at a minimum 5% on redemption. So bidding 0.25% isn't dumb — you still get 5% minimum *if redeemed within the first year*. After the first year the actual won rate applies. **The redemption-amount calculator (which Marcus also flagged as missing) has to encode this floor or it'll quote the wrong amount on every FL certificate redeemed in year one.**

**Deed application workflow** — Doesn't exist. Should be a per-certificate timeline: month 22 (eligible-soon reminder), month 24 (eligible — apply button), application-filed, sheriff-search-pending (30-90 days), §197.522 notices (20-day pre-sale window), deed-sale-scheduled, deed-issued. Each stage with a per-county template (clerk forms vary across the 67 counties). **A 90-day build with one paralegal.**

**Homestead detection** — Florida's property-appraiser sites (one per county; Miami-Dade is `bcpao.us` for Brevard, Hillsborough is `hcpafl.org`, etc.) expose homestead-exemption status as a public field. AcreOS already has GIS endpoints for Miami-Dade and Hillsborough (saw them in `routes-admin.ts` line 1418/1421). **Add `homesteadExempt` to the parcel enrichment** for FL and surface it on the parcel detail with a red badge. That single badge prevents the $87K-opening-bid mistake I made in 2022.

**Wind-zone / flood-zone disclosures (§689.261)** — F.S. §689.261 requires a written wind-zone disclosure on residential transfers. The disclosure-list at `routes-platform-features.ts` line 1075-1080 has Radon, Sinkhole, Coastal Erosion for Florida — **but not the §689.261 wind/flood disclosure, which is the most-litigated FL disclosure of the post-Ian era.** Add it, with a reference to the statutory form. Hurricane-zone parcels are 30% of my acquisitions; I need this baked in.

**Sinkhole disclosure** — Already in the list, good. But Florida divides into "sinkhole" and "subsidence" zones, and Central FL (Pasco, Hernando, Citrus — some of my best counties) is the heart of the sinkhole belt. I'd want a per-parcel "sinkhole risk zone" enrichment from FGS data, not just a generic disclosure-required flag.

**§65.061 quiet-title workflow** — Florida quiet-title actions for tax-deed properties are governed by F.S. §65.061. The workflow: file complaint → constructive service if defendants can't be found (publication 4 weeks in a newspaper of general circulation) → personal service on locatable defendants → 20-day answer period → default judgment if no answer → final judgment quieting title → record. About 90 days if uncontested, 6+ months contested. **AcreOS has `titleChainService.ts` which scores risk but doesn't run the workflow.** Marcus asked for this generically; my FL-specific ask: encode §65.061 with the publication-newspaper requirement (each county has a designated legal-notice paper — Tampa Bay Business Journal for Hillsborough, Daily Business Review for Miami-Dade — AcreOS could maintain that list).

**County variance** — 67 counties means 67 sets of clerk-office quirks. Lee accepts wires only and posts the lot list 30 days out. Hillsborough lets you redeem online via a portal. Miami-Dade's clerk is notoriously slow on deed recording (4-6 weeks vs Pinellas's 2-3 days). **Marcus's per-county "clerk profile" notes ask applies double for Florida** — except here the variance is statewide and known, so AcreOS could ship pre-populated clerk profiles for all 67 from a single paralegal's research project.

**`/counties` page** — Florida has 67 counties; if I'm filtered to FL, this page should be my home. Each county tile should show: next certificate sale date, next deed sale date, online platform (Grant Street / Bid4Assets / county-built), recording-fee schedule, clerk's notice-paper, my certificate count active, my deed sales pending. None of that exists today. Bones do — I see Miami-Dade and Hillsborough already have GIS sources registered.

**Doc stamps (§201.02)** — Florida's documentary stamp tax is $0.70/$100 on deed transfers, $0.35/$100 on the mortgage in non-Miami-Dade counties (different rates in Miami-Dade — there's an additional surtax). `stateDocumentConfig.ts` line 172 has `transferTaxPercent: 0.07`. That's correct. `countyRecordingFees.ts` notes the Miami-Dade $0.45/$1,000 surtax. Good — this part is right. But the fee calculator should run automatically on every deed I record, not be a hand-typed line item.

**Surplus funds** — F.S. §197.582 governs distribution of tax-deed surplus. Junior lienholders have priority over the prior owner; both must be served. **No tracking in AcreOS.** I have at least $14K of unclaimed surplus across 4 parcels right now and I literally don't remember which ones. A `/surplus-funds` view tied to my deed-sale records would surface this.

**Hurricane / catastrophic-loss tracking** — Hurricane Ian (Sep 2022) and Hurricane Idalia (Aug 2023) hit my inventory hard. After a declared disaster, FL has a property-tax abatement process under F.S. §197.319 — owners can petition for damaged-property tax relief. **AcreOS doesn't model this.** When I'm holding 40 parcels in Lee County and a Cat 4 makes landfall, I want to bulk-flag every parcel within the warning cone, schedule drive-bys via `/field-scout`, and track abatement filings. The bones are there (FEMA flood-zone lookup exists per `routes-micro-features.ts` line 401); the workflow is not.

**Mobile experience for online auctions** — Marcus's "courthouse Tuesday" point becomes "tethered laptop in my dining room at 8 AM Wednesday" for me. Still mobile-adjacent because I want to glance at AcreOS on my phone for parcel notes while bidding on the laptop. **A tablet/phone "co-pilot" view that shows my pre-auction worksheet, my max-rate per certificate, and my live wins as I enter them — synced to AcreOS — would be the killer feature.** Today: I keep two browser tabs open and copy-paste.

---

## 4. The legal-compliance test — Florida edition

- **F.S. §197.472 — minimum 5% interest** — *Fail.* Not encoded in any redemption-amount calculation I can find.
- **F.S. §197.502 — tax-deed application** — *Fail.* No workflow, no template, no application-eligibility tracker.
- **F.S. §197.522 — notice to interested parties** — *Fail.* No template, no service-of-process tracking, no 20-day pre-sale countdown.
- **F.S. §197.582 — surplus-funds distribution** — *Fail.* No tracking, no claim workflow.
- **F.S. §65.061 — quiet-title** — *Fail.* No workflow; `titleChainService` only scores.
- **F.S. §689.261 — wind/flood-zone disclosure** — *Fail.* Missing from the FL disclosure list. This is post-Ian table-stakes.
- **F.S. §689.25 — radon, sinkhole disclosure** — *Pass.* Both in the disclosure list.
- **Homestead protection (Art. X §4, Fla. Const.)** — *Fail.* No `homesteadExempt` field on parcel; opening-bid math doesn't account for it.
- **Two-witness deed requirement (F.S. §689.01)** — *Pass.* `stateDocumentConfig.ts` correctly notes "Two witnesses are REQUIRED for valid deed in Florida. No exceptions." Whoever wrote that line knows FL.
- **Doc stamps (F.S. §201.02)** — *Pass.* Rate encoded, Miami-Dade surtax noted.

**Net: AcreOS gets the static FL facts right and the dynamic FL workflows wrong.** A tax-deed operator lives in the workflows. The facts are a Wikipedia article.

---

## 5. What's missing — the FL-specific list

1. **Two-stage certificate-then-deed state machine.** Per certificate: purchased → paid → certificate-received → accruing → eligible-for-application (month 24) → application-filed → sheriff-search → §197.522-notice → deed-sale-scheduled → (deed-issued | redeemed). Each stage with statutory deadlines and templates.

2. **Bid-down auction model.** `auctionDirection: "low_bid"`, `minAcceptableRate`, `winningRate` per certificate. Without this, FL is unmodeled.

3. **§197.522 notice template + service tracking.** Frank charges me $400 for this; AcreOS could do it for $50 and own the workflow.

4. **§65.061 quiet-title pipeline.** Per-county notice-paper directory, publication scheduling, 20-day answer countdown, default-judgment template, recording flow.

5. **Homestead-exemption field on parcel + opening-bid calculator.** Pulls from county property-appraiser sites. The Miami-Dade and Hillsborough GIS endpoints are already registered — extend to all 67 counties (most are ArcGIS REST and follow predictable patterns).

6. **Surplus-funds tracker.** Per parcel, post-deed-sale: "surplus = $X, claim deadline = Y, claimants of record = [Z]." Tied to my owned-parcel records.

7. **Hurricane/catastrophic-event response.** When NOAA issues a warning cone for FL counties where I hold inventory, surface affected parcels, schedule drive-bys, prep §197.319 abatement filings. Post-Ian/Idalia this is no longer a nice-to-have.

8. **County clerk profiles for all 67.** Pre-populated. Each: online-auction platform, deposit %, deposit-due timing, recording timeline, legal-notice paper, deed-sale day-of-week, redemption-online portal URL.

9. **Online-platform results import.** RealAuction CSV export, Bid4Assets CSV export, Miami-Dade portal scrape. Post-sale, paste URL, AcreOS pulls my wins into certificate records.

10. **(Bonus.)** Pax tuned on Florida tax-deed law specifically. F.S. Chapter 197, F.S. §65.061, F.S. §689.261, plus the post-Ian case law on hurricane-impacted tax-deed properties. Narrow domain, deep training.

---

## 6. Three things that are surprisingly good

1. **Two-witness rule is correctly encoded.** `stateDocumentConfig.ts` line 178: "Two witnesses are REQUIRED for valid deed in Florida. No exceptions." That line by itself tells me a real Florida-licensed person reviewed the deed configs. Not generic.

2. **Documentary stamp tax math is right.** $0.70/$100, with the Miami-Dade surtax called out separately in `countyRecordingFees.ts`. Most platforms get this wrong by lumping doc stamps into "transfer tax" generically.

3. **Sinkhole disclosure is in the FL disclosure list.** Tells me somebody read the actual seller-disclosure statutes, not just Googled "Florida real-estate disclosures." The omission is wind/flood under §689.261, but what *is* there is correctly chosen.

4. **(Bonus.)** Miami-Dade and Hillsborough GIS endpoints are already registered as data sources. The right two counties to start with — they're the highest-volume tax-deed counties in the state.

---

## 7. Pricing reaction

I run roughly $400K/year of capital across FL certificates and deeds. My current stack: TaxSale Resources ($99/mo) + Frank's flat $400/parcel for §197.522 notices + ~$50K/year of his hourly time for quiet-titles and edge cases + my Excel + a $40 CRM. The Frank line item is what AcreOS could displace.

- **$20 Starter** — I'd take the trial. Wouldn't pay long-term unless certificate-state-machine ships.
- **$49 Pro** — Worth it the day the §197.522 template + service tracking ships, because that alone replaces ~$8K/year of Frank's notice work.
- **$79 Scale** — I'd pay this if quiet-title pipeline + surplus-funds tracker ships. That's $30K/year of Frank's time displaced.
- **$200/mo FL-only tier** — If AcreOS built the focused Florida product (everything in §5), I'd pay $200/mo and so would the 200-300 other operators I know who work FL exclusively. That's a $500K-$700K ARR niche product hiding inside the platform. Don't ignore it.

---

## 8. The deal-killer if not fixed

**The two-stage clock.** Florida's certificate-then-deed structure is not a state-rules-table row — it's a fundamentally different state machine from every other tax-sale state. AcreOS today models tax sales as "auction → win → redemption-clock → done." Florida is "auction → win certificate → 24-month accrual → eligible → application-filed → sheriff-search-30-90-days → §197.522-notice-20-days → deed-sale → won-or-redeemed → quiet-title-90-180-days → marketable." That's nine stages, not three.

If I bid on a certificate in May 2026 and AcreOS forgets to remind me to apply for the deed in May 2028, **my certificate goes to the §197.482 list — the certificates that go unredeemed and unapplied-for — and after 7 years it becomes worthless.** F.S. §197.482 cancels certificates after 7 years if no deed application is filed. I lose my entire principal plus 7 years of opportunity cost.

That is the FL version of Marcus's redemption-clock fiduciary obligation. Different statute, same bar: **the money math has to be right and the deadlines have to be enforced.**

A second-tier deal-killer: the homestead opening-bid calculator. If AcreOS shows me "minimum opening bid $4,200" on a homesteaded property and the actual opening bid is $87,000 because §197.502(6)(c) adds half the assessed value, **I no-show at the auction or — worse — show up under-deposited and forfeit my deposit.** Once is enough.

The third-tier observation: AcreOS already has the right bones for FL specifically. The Miami-Dade and Hillsborough GIS sources, the FL doc-stamps math, the two-witness rule, the sinkhole disclosure — somebody on the team did the research. The gap between that research and a usable Florida product is one focused engineer + Frank-the-attorney-on-retainer for a 60-day sprint. I'd pay for the early-access tier of that sprint and co-write the case study.

If I had to give the team a 60-day Florida-only plan from where I sit:

- **Day 1-20:** Add `auctionDirection`, `winningRate`, `homesteadExempt`, `certificateNumber`, `saleYear` fields to the schema. Build the certificate-state-machine UI at `/certificates`. Encode §197.472(2) 5% floor in the redemption-amount calculator.
- **Day 21-40:** Ship the §197.522 notice template + service tracking. Ship the deed-application workflow with month-22 / month-24 reminders. Add §689.261 wind/flood disclosure to the FL disclosure list. Add homestead opening-bid calculator.
- **Day 41-60:** §65.061 quiet-title pipeline with per-county notice-paper directory. Surplus-funds tracker. RealAuction results-import CSV. Pre-populated clerk profiles for the top 15 FL tax-deed counties (Miami-Dade, Broward, Palm Beach, Hillsborough, Pinellas, Orange, Lee, Polk, Pasco, Brevard, Volusia, Sarasota, Manatee, Marion, Duval).

That's a real Florida product by July. I'd buy the trial in week one and be the loudest ambassador you have by Q3.

A final note on positioning. Marcus said "tax-delinquent specialist" is a real sub-vertical worth naming. Inside that sub-vertical, **"Florida tax-certificate / tax-deed investor" is a real sub-sub-vertical worth naming separately** — because the workflow is genuinely different, the regulatory body of work (Chapter 197) is its own beast, and the buyer profile is more concentrated and more sophisticated than the multi-state operator. There are roughly 5,000 active Florida-only tax-deed investors. A tool built for them — not a row in a 50-state table, but a real workflow product — would own that market.

— Rina
