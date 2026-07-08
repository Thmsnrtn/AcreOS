# Quentin Vass — AcreOS, the cell-tower / billboard ground-lease lens

I'm Quentin. Fifty. Nashville. I've spent eleven years buying small parcels with one thing on them: a cell tower or a billboard, and a lease attached. $20K to $100K a piece, $400 to $2,000 a month coming in. I don't farm them, I don't seller-finance them, I don't subdivide them — I collect rent and watch the escalator clauses tick. I've got 41 sites across Tennessee, Kentucky, north Alabama, and west North Carolina. My world is Crown Castle, SBA, American Tower, Lamar, OUTFRONT, and the carrier consolidation that turns three tenants into one. AcreOS bills itself as a land-investor OS. Land investor I am — but my "land" is a 30×30 fenced compound under 180 feet of galvanized steel, and the spreadsheet that matters is the one that says when the next 3% bump hits.

Wave 3. Here's how the platform looks through the ground-lease lens.

---

## 1. Thirty-second verdict

AcreOS is built for **vacant land**. Every taxonomy, every wizard, every motivated-seller filter assumes the parcel produces no income today and the play is to flip it or seller-finance it to a recreational buyer. My parcels produce income today and the play is to *not flip them.* The platform has a `leases` table — `shared/schema.ts:11853` — and seven CRUD routes on `server/routes-leases.ts`, but it's a residential-style schema: tenantName, monthlyRent, securityDeposit, leaseStart, leaseEnd. That's a duplex landlord's data model. It is not a ground-lease data model.

Could I track 41 sites in this? Technically yes. Would it surface what matters — the next escalator, the carrier consolidation risk, the cap-rate-derived valuation, the termination clause window — no. AcreOS would be a glorified address book for me at $79/mo, and I'd still keep my Excel.

Trial: skip. Until ground-lease specifics ship I'm not in market.

---

## 2. The schema gap, in one paragraph

`leases` table has eight functional columns. None of them are: lease type (cell-tower / billboard / solar / wind / pipeline / agricultural), tenant entity vs. site-acquisition holdco (Crown Castle Towers LLC vs. Verizon directly), lease commencement vs. rent commencement (different dates, different consequences), initial term + renewal options (typical: 5-year initial + four 5-year renewals = 25 years), escalator type (fixed % / CPI / hybrid / step), escalator interval (annual / 5-year), escalator floor and ceiling (CPI with 2% floor / 4% ceiling is standard), termination-for-convenience clause (carrier walks with 90-180 days notice — kills my valuation), revenue share (some Lamar billboards have a 15-20% gross share above base rent), tenant improvement reversion (who owns the tower at end of term), exclusivity (can I lease to a second carrier on the same compound), lease assignment language (when I sell, does the tenant have ROFR? consent required?), and rent-escrow / direct-deposit configuration.

A ground lease lives or dies on those fifteen fields. AcreOS has none of them.

---

## 3. Daily-use walkthrough — Wednesday in Nashville

**7:00 AM.** I open `/portfolio`. I want one number: trailing twelve months of ground-lease income, broken down by tenant entity, with a flag on any lease where the next escalator has already hit but the rent payment hasn't reflected it. Carriers underpay on escalators about 8% of the time — they're not malicious, they're sloppy with their accounting systems. I catch about $14K a year by reading my own statements. AcreOS doesn't do this and can't do it because it doesn't model escalators.

**8:30 AM.** New deal. Broker in Knoxville sends me a parcel: 0.4 acres, $42K asking, existing American Tower ground lease at $850/mo with a 3% annual escalator, 8 years remaining on a 25-year term with two 5-year renewals at fair market value. I want AcreOS to evaluate this in one click: cap rate at $42K / ($850 × 12 × 1.03^4 average) = ~21% if I hold five years and rent escalates as scheduled. That's the valuation that matters. AcreOS's valuation tooling is comp-based (`server/services/comps.ts`), and a comp on a 0.4-acre tower compound vs. a 0.4-acre vacant lot in the same county is meaningless — it'll undervalue this by 10x. The platform needs an income-approach valuation path that takes lease terms as input, projects cash flow, applies a cap rate appropriate to the carrier credit (Verizon's IG-rated, my cap rate is 6.5%; a regional WISP, my cap rate is 12%), and outputs a value. Doesn't exist.

**10:00 AM.** Lease assignment. The Knoxville purchase requires American Tower to consent to the lease assignment. American Tower's process is its own portal, 60-90 days, requires their estoppel certificate signed by me as new landlord. AcreOS has no concept of *lease assignment as a closing milestone.* The DD checklist (`shared/schema.ts:2776+`) is title / physical / legal / financial — fine for vacant land, but missing the entire ground-lease-assignment track: tenant consent, estoppel certificate, SNDA (subordination/non-disturbance/attornment) if there's financing, W-9 substitution, ACH redirect form, certificate of insurance from tenant naming new landlord. That's a six-item checklist I run on every acquisition and AcreOS doesn't have it.

**11:30 AM.** Carrier consolidation watch. T-Mobile bought Sprint in 2020. DISH is building out as the fourth carrier but slowly. When T-Mobile sunsets a Sprint site, my lease terminates per the termination-for-convenience clause and I lose $1,200/mo. I track this manually: which of my towers have Sprint legacy equipment, which have T-Mobile colocations, which carriers are co-located vs. anchor-only. AcreOS has no field for *carrier on the tower* — it doesn't even know what a carrier is. I'd want a `carriers_on_site` JSON column with carrier, equipment type (anchor / colocation), lease ID, and consolidation-risk flag. Adjacent: a feed (FCC ULS, public sources) of carrier-facility decommissioning notices that auto-flags my sites.

**1:00 PM.** Billboard side. I have nine billboards on five parcels. Lamar leases four of them, OUTFRONT leases three, two are local independents. Lamar's standard ground lease is 20 years, $400-$1,200/mo, 10% escalator every five years, tenant pays property tax pass-through above a base year. The pass-through is its own column — when Davidson County reassesses my parcel, the pass-through math has to match the lease formula, and I've caught Lamar twice in seven years. AcreOS has no concept of property tax pass-through on a lease. That's a $3,000-$5,000/year audit issue per parcel.

**2:30 PM.** I check `/parcels/:id` on a Hamilton County tower compound. Best surface in the platform — Cesar said the same. But for me it's missing: lease summary card (tenant, base rent, current rent, next escalator date, next escalator amount, lease end, renewal options remaining, termination-for-convenience window), tenant payment history (90% of my "is this lease performing" question), and a "lease document binder" link to the original lease + every amendment + every estoppel I've signed. AcreOS has a documents surface (`server/routes-documents.ts`) but no concept of a *lease binder* as a first-class object on the parcel.

**4:00 PM.** Site-acquisition agent calls. Crown Castle's site-acquisition team has been buying small operators' tower portfolios at 18-22x annual rent for IG carriers, 12-15x for regional. I get one of those calls every quarter. When they ask "what's your portfolio look like" I want a one-click export: tenant, monthly rent, current rent (post-escalator), lease end, renewal options, termination clause, ground tax. CSV. AcreOS could ship that export tomorrow if it had the schema — it doesn't have the schema, so it can't ship the export. I keep this in Excel and I will keep it in Excel until AcreOS models a ground lease properly.

**5:30 PM.** Renewal negotiation. Tower in Bowling Green KY — initial 25-year term ends in 14 months, tenant has two 5-year renewal options at "fair market value to be agreed, failing which by appraisal." Tenants will lowball me at renewal. My playbook: I send a letter 18 months before term, propose a 12% increase over current rent (justified by recent comparable lease assignments in the carrier's own portfolio, which I track from the FCC tower-registration database and public REIT filings), negotiate down to 7-9%, lock in another five years. AcreOS could automate the renewal-letter trigger 18 months before lease end, pre-fill the proposal with carrier-comp data, and run the negotiation as a deal pipeline. *That* would be a feature I'd pay for. Today: nothing.

**8:00 PM.** Bookkeeping. I'm a Schedule E rental real estate filer for these — they're rental properties, not flips. AcreOS exports to QuickBooks, but rental-property bookkeeping needs per-parcel P&L with depreciation schedules (39-year nonresidential real property, plus the tower itself if I own it which I usually don't), and the property tax pass-through reconciliation. I haven't tested the export but Wendell and Cesar both flagged QuickBooks gaps. Given the schema, mine will be worse — there's no way the export categorizes ground-lease income separately from flip proceeds because the system doesn't know the difference.

---

## 4. The bias problem — "vacant land" as a category

Look at the property type taxonomy. `shared/schema.ts:8649` — `raw_land, recreational, agricultural, residential_lot, commercial`. Where does a 0.4-acre tower compound live? "Commercial," I guess, but it's not commercial real estate in the CRE sense — there's no building, no NNN tenant in the office sense, no cap-rate market data feed that AcreOS could pull. It's a *ground lease,* a category of its own that the platform doesn't recognize.

`shared/schema.ts:6886` — `vacant_land, residential, commercial, agricultural`. Same gap.

`server/services/comps.ts` finds comparable sales of vacant parcels. There are no comparable sales of leased parcels because each ground lease is unique to its tenant, term, and escalator. The "comp" for my tower compound is the lease income times a cap rate, full stop. AcreOS valuation is structurally wrong for income-producing land.

The motivated-seller filters in `server/routes-leads.ts` and the campaign templates assume the seller is sitting on vacant unproductive land. Mine sit on $400-$2,000/mo income. I'm not the buyer AcreOS is hunting for, and the sellers I want to find — small operators with one or two tower sites who are aging out and want to cash out at 12-14x — are not in any of the platform's lead-discovery flows. There's no "owns a parcel with a building permit for a wireless communication facility" filter. There's no FCC tower-registration database integration. There's no MLS-equivalent for small ground-lease portfolios (because there isn't one publicly, but a platform could build one from public county records + FCC ULS).

---

## 5. Per-surface friction (ground-lease-specific)

**`/parcels/:id`** — Add a Lease tab, first-class. Show: tenant, tenant entity vs. ultimate carrier, base rent, current rent, escalator type/interval/floor/ceiling, next escalator date, lease commencement, term end, renewal options remaining, termination-for-convenience window, exclusivity status, pass-through status. Make every one of those fields editable and history-tracked.

**`/finance`** — Add cash-flow forecast on lease basis: monthly rent × escalator schedule × probability-of-renewal × probability-of-termination. The platform already has `cashFlowForecasts` (`shared/schema.ts:7750`) for note-based seller finance. Extend it to lease-based income with the same plumbing.

**`/onboarding`** — Add a "what kind of land investor are you?" question. Buy-and-hold seller-finance is one path. Buy-and-flip is another. Buy-and-hold ground-lease is a third. The wizard should branch. Today it assumes path 1 or 2.

**`/documents`** — Need a ground-lease template pack: standard cell-tower lease (with carrier-friendly and landlord-friendly variants), standard billboard lease, lease assignment + assumption, estoppel certificate, SNDA, memorandum of lease (for recording — you record the memo, not the lease), termination notice, escalator notice, ROFR notice. None of these exist.

**`/inbox`** — Add a "carrier consolidation watch" email digest: any time a public filing references one of my carriers' sites in my counties, surface it. SEC 10-Ks of Crown Castle / SBA / American Tower mention site rationalization plans every quarter — that data is public and machinable.

**`/portfolio`** — Add cap-rate-on-portfolio. Sum trailing rent ÷ sum cost basis. Compare to peer cap rate (anonymized aggregate from other AcreOS users in the same lease-type bucket). I'd love to know if my portfolio is over- or under-yielding the cohort.

**`/field-scout`** — Useful for me. When I drive a parcel I want to photograph: fence condition, tenant access road condition, any equipment changes (new antenna = could be a new colocation = could be a new sub-lease I should know about). The current tool does photos; doesn't have a "is the tenant in compliance with site maintenance obligations" checklist. Easy add.

---

## 6. What's missing for ground-lease — in priority order

1. **Ground-lease-specific schema.** The fifteen fields I listed in §2. This is the foundation; nothing else works without it.
2. **Income-approach valuation.** Cap-rate-driven, takes carrier credit + escalator schedule + termination risk as inputs. Replaces comp-based valuation for leased parcels.
3. **Escalator engine.** Background job that calculates the next escalator on every active lease, fires a reminder 30 days before, and reconciles actual rent received against expected post-escalator rent.
4. **Carrier consolidation feed.** FCC ULS + carrier-public-filing scraper that flags sites at consolidation risk. This is a feature only AcreOS could build at scale, and it's defensible.
5. **Lease assignment closing checklist.** Tenant consent, estoppel, SNDA, W-9, ACH redirect, COI. Run as a track parallel to title/physical/legal.
6. **Renewal-negotiation pipeline.** 18-month-out trigger, comp-data prefill, deal pipeline integration.
7. **Property-tax pass-through reconciliation.** Per-lease formula, ties to the assessor data the platform already pulls.
8. **Memorandum of lease document generator** with state-specific recording requirements. Tennessee, Kentucky, Alabama, North Carolina at minimum for me.
9. **Site-acquisition agent CSV export** — one-click portfolio summary in the format Crown Castle / SBA / American Tower request.
10. **Schedule E P&L per parcel** with depreciation and pass-through reconciliation. CPA-ready.

---

## 7. Pricing reaction (ground-lease operator math)

41 sites, ~$680K annual lease income, ~$3.4M cost basis, ~20% blended cap rate. My current annual stack:

- Excel + Google Sheets for the lease ledger: free, ~3 hours/week ≈ $4,700/year of my time at $30/hr blended
- DocuSign for estoppels and amendments: $40/mo = $480
- Bill.com for ACH receipts: $45/mo = $540
- A small CRE-tracking tool I tried that didn't work: $0 (cancelled)
- CPA: $4,800/year (he's the load-bearing piece)
- One acquisition attorney on retainer: $6,000/year
- Site visits / windshield time / Field-Scout-equivalent: my time

Total tooling: ~$1,020/year + my time. Total professional services: $10,800/year. Total: ~$11,820 + opportunity cost of my time.

AcreOS at $79/mo = $948/year. If it gives me items 1-5 above, I switch tomorrow and I save 3 hours/week. If it adds items 6-10 over the next year, I pay $200/mo and don't blink. The TAM here is small — there are maybe 8,000 small ground-lease operators in the US — but each one is sticky, high-LTV, and largely unaddressed by REI software. I'd be the highest-NPS customer on the platform if you built the schema.

---

## 8. The deal-killer

For ground-lease specifically: **the schema.** Without lease-type, escalator, termination clause, and carrier fields, no downstream feature works. AcreOS's `leases` table is residential-landlord shaped, and bolting cell-tower fields onto it via the `terms` JSONB column is the wrong answer — that pushes the complexity into application code that doesn't exist and makes the data unindexable for the analytics that matter (next escalator across portfolio, termination-window across portfolio, carrier exposure across portfolio).

For me personally: I won't trust my $680K/year cash flow to a system whose data model doesn't represent escalators. That's table stakes. Build the schema, build the escalator engine, build the income-approach valuation — then come back. Until then I'm in Excel and AcreOS is for my friends who flip recreational lots in Tennessee.

The opportunity here is real. Ground-lease investors are an underserved niche with high willingness to pay and almost no purpose-built tooling. Cesar wants Texas. Wendell wants notes. I want leases. We're all Land Investors but the shape of the work is different — and right now AcreOS is shaped for one of us.

---

## 9. Specifics that will matter when you build this

A few items that are easy to overlook from the outside but will bite the implementation.

**Rent commencement vs. lease commencement.** Standard cell-tower lease has a "lease commencement date" when the lease is signed and an installation/construction period (60-180 days) before "rent commencement." Term clocks from rent commencement, not lease commencement. The escalator clock typically starts on the rent-commencement anniversary. Get this wrong and every escalator forecast is off by a quarter.

**Anchor vs. colocation rent.** Anchor carrier (the first one on the tower) typically pays the ground-lease rent directly to me as landowner. Colocations (carrier 2, 3, 4) pay the *tower owner* (Crown Castle / SBA / American Tower) for tower space — but my ground lease often has a revenue-share clause: I get 25-35% of colocation rent above a threshold. That's a separate income stream from base rent and it's the difference between a "boring 6% cap" lease and a "secretly 11%" lease. Schema needs to model both.

**Memorandum of lease vs. lease.** I never record the full lease — too much commercial detail to make public. I record a memorandum of lease, which is a one-page filing that puts the world on notice that the parcel is encumbered by a lease, names the parties and term, and references the unrecorded full lease. Every state has slightly different requirements for what the memo must contain. This is a document-generator opportunity.

**SNDA in financing scenarios.** When I refinance a ground-lease parcel, the lender wants the tenant to sign a Subordination, Non-Disturbance, and Attornment agreement. Tenants (especially the public REITs) have their own SNDA templates and won't sign anyone else's. The platform should know the major tenants' template URLs and warn me to use theirs.

**Tax pass-through base year.** Most ground leases have a property-tax pass-through that kicks in only above a "base year" tax level. If the base year is 2018 and county taxes have gone up 22% since then, I get to pass through the 22% increase. The math is mechanical but the base-year reference has to be stored on the lease. This is a common audit-recovery item.

**State-specific recording quirks.** Tennessee records at the Register of Deeds, fee $5 first page + $5 each additional. Kentucky records at the County Clerk, fee $50 flat for memorandum of lease in most counties. Alabama is per-page with a state recording tax. North Carolina has a separate excise tax on lease memos with terms over 99 years. These belong in `stateDocumentConfig.ts` next to the seller-finance recording configs Cesar already validated.

**Tenant ACH redirect on assignment.** When I buy a leased parcel, the carrier's accounts-payable system has to re-route the rent ACH from the seller's bank to mine. Each carrier has a different form: American Tower wants a W-9 + voided check + their landlord-update form; Crown Castle has an online portal; Verizon wants paper. Two of my acquisitions had a 60-day rent gap during this transition because the seller wouldn't forward the misdirected rent. AcreOS could surface the carrier-specific redirect process at closing as a checklist item with the right forms attached.

**Insurance certificate compliance.** Tenant is required to carry liability insurance naming me as additional insured. Carriers send a fresh COI annually, but they often send it to the wrong landlord (the previous owner) for years after an assignment. I'd want a "COI received this year — yes / no, expiration date" tracker per lease, with a 60-day reminder before expiration that triggers a request to the carrier.

**Severance: lease vs. tower vs. equipment.** I own the land. I usually don't own the tower (carrier-owned anchor) or I own the tower but not the equipment (Crown-Castle-owned tower with carrier equipment colocated). Severance — what's mine, what's theirs, what reverts at term end — is in the lease. At term end the carrier removes equipment and restores the site to "broom-clean." Modeling reversion as a date-driven event with a "is the tower mine at end?" flag matters when I forecast salvage value.

---

## 10. The narrow ask

If I could pick one thing for the next sprint: **a `lease_terms` table** with the fifteen fields. Just the schema. Migrate the existing seven-column `leases` table to it as `lease_terms.basic_payment_terms`, leave the residential landlord case working, and let me populate ground-lease specifics in the new fields. Everything else — valuation, escalator engine, renewal pipeline — falls out of that schema work over the next two quarters.

Without it, AcreOS is a vacant-land tool and I'm an income-property buyer. With it, I'm your highest-LTV customer in a niche nobody else is serving.

— Quentin
