# Imelda Ruiz — AcreOS user review (Landlord voice)

I run a small portfolio out of San Antonio. Twenty-two single-family rentals, three small multifamilies — call it 31 doors total. Cash-flow positive on most of them, two are dragging. I run the operation off Buildium for property management, Stessa for the investor view, QuickBooks for the books my CPA actually trusts, Avail for tenant screening, and DocuSign for leases. Five tools, four logins, $260/mo all-in. I have a part-time bookkeeper, no employees, and a maintenance bench of four vendors I've used for a decade.

A friend in my REIA chapter told me to look at AcreOS. I spent most of a Saturday in it. Here's the honest read.

---

## 1. Thirty-second verdict

Would I sign up today? **Maybe — but not as a Buildium replacement.** I'd consider AcreOS for the **acquisition side** of my business — when I'm hunting the next rental, running comps on a duplex on the east side, talking to a motivated seller about a tired four-plex. That part of what AcreOS does is genuinely better than the spreadsheet I currently use to track potential deals.

But I'd keep Buildium for everything that happens **after I close**. Tenants, leases, rent, maintenance, vendors, screening — none of that is what AcreOS is. I checked. There's no tenant entity. There's no lease object. There's no rent ledger. There's no maintenance ticketing.

So the answer is: I'd pay $20-49/mo for the acquisition workflow, *in addition to* my $58/mo Buildium plan. Not instead of it. AcreOS isn't competing with Buildium today — it's competing with the spreadsheet I keep in Google Drive labeled "deals to look at."

What stops me from going further: about 80% of my operational day has nothing to map onto in this product. That's not a bug. It's a positioning question. AcreOS sells itself to "Land Investors" and the persona registry has a "landlord" entry, but the landlord experience is 20% built. Almost a separate product.

---

## 2. Daily-use walkthrough — my imagined first day

**7:45 AM.** I land on `/today`. Greeting, Pulse score, Pax suggestions, expiring offers, stale leads. None of these are my morning. **My morning is: did anyone's rent hit overnight, are any maintenance tickets sitting older than 48 hours, and did the eviction filing on the duplex go through.** AcreOS has zero of that on the daily landing because AcreOS doesn't know what tenants or rent or maintenance are.

If I configured "landlord mode," what would I want here? A rent-roll snapshot (collected this month / outstanding / late), a maintenance queue count, a lease expirations next-30-days widget, and a vacancy count. None of those concepts exist in this app yet.

**8:30 AM.** I look at `/pipeline`. The lead vocabulary in landlord mode is "Lead / Rental / Acquisition / Leased" per the persona registry. **That's wrong.** A landlord has *two* lead pipelines: an acquisition pipeline (sellers, motivated owners, off-market buys) and a tenant pipeline (prospect renters, applicants, approved, leased). AcreOS gives me one. Conflating those is the same mistake AppFolio used to make in 2012.

I'd want — minimum — two CRMs: one for acquisitions (which AcreOS already has and is good at) and one for tenants/applicants. Rental prospects come in through Zillow, Apartments.com, Avail, my own website. They get screened (credit, eviction history, income), converted to applicants, signed onto a lease, and become a tenant. None of that flow exists.

The legal posture is also different in a way that matters. When I'm talking to a motivated seller, I can keep loose notes — "wife wants to move closer to grandkids in Houston, pushy son keeps calling." That's just CRM color. When I'm talking to a tenant applicant, **anything I write down is FCRA-discoverable in an adverse-action dispute**. I cannot write "seems unstable" in a tenant-applicant note. I can write "credit score 612, prior eviction 2022, denied per company criteria." Different system, different field validation, different audit log. Cramming both into one `leads` table is how you end up with a fair-housing complaint.

**9:30 AM.** `/parcels/:id` on a fourplex I'm considering buying on the south side. **Here AcreOS is genuinely good for me.** The DD checklist (title, liens, environmental, access, taxes) is the right list. What's missing for a landlord-buyer specifically: **a rent-roll uploader** — when I'm buying an occupied building I get a current rent roll from the seller. I want to drop that in and have AcreOS turn it into 4 tenant records, 4 lease records, and a "current cash flow" estimate before I close. None of that exists.

Also missing on the parcel view: **estimated rent comp.** I work off RentCast and a spreadsheet. AcreOS has property valuation but not rent valuation. If I'm a landlord, that's the number that matters — not ARV, but achievable rent per unit. That's the cap-rate input. The cap rate is the deal.

**10:30 AM.** I go to `/money`. I'm hopeful. **It's all wrong for a landlord.** Notes, Portfolio, Optimizer, Forecast, Capital — these are seller-financing concepts. I don't carry paper. I collect *rent*. I have no notes. I have leases.

What I need on this surface: a **rent roll** (every unit, current tenant, lease start, lease end, rent due, rent collected, rent late, security deposit held), a **NOI calculator** per property (gross rents - vacancy - operating expenses - capex reserve = NOI), a **cap rate view** (NOI / market value), and a **late-rent dashboard**. Of those four, AcreOS has zero. The "Portfolio" tab inside `/money` is structured around note delinquency — current / 30 / 60 / 90+ buckets — which is *almost* the right shape for late rent, but it's wired to note borrowers, not tenants.

**11:00 AM.** I check whether AcreOS can collect rent. **It can't, not for me.** Stripe Connect is wired up for note payments. There's no recurring-rent product, no ACH-pull from tenant accounts, no late-fee state-rule engine, no roommate-split rent collection, no Section 8 voucher tracking. Buildium does all of these and has done since 2010.

I'd add: in Texas, late fees are now capped at 12% of monthly rent for properties with 4+ units, 10% for fewer, after a 2-day grace. That's a *state-specific* rule. The note-borrower dunning sequence in AcreOS is similar shape (notice → late fee → demand → default) but the legal language and timeline for an eviction is different in every state. **Anyone shipping landlord rent collection has to ship a state-rule engine, not just a templated email.** Buildium gets this wrong half the time and they've been at it 15 years.

The other piece of rent collection that AcreOS has no concept of: **partial payments**. If Maria in Unit 3B owes $1,400 and pays $700 on the 5th and $700 on the 18th, my system needs to know that the first $700 doesn't satisfy the rent and doesn't stop the late-fee clock unless I say so. In Texas, accepting partial rent **after** filing a notice to vacate can void the notice and force me to start over. So the rent ledger has to track not just "was rent paid" but "is the legal posture preserved." That's a level of nuance that even Buildium struggles with.

And the roommate case. I have a 3BR house leased to three grad students, joint and several. If one pays his $700 and the other two don't, what happens? Some landlords accept that as "1/3 of rent," some say "the lease is one obligation, not three." The software has to model jointly-liable lease tenants vs separately-liable per-unit tenants. AcreOS has neither model.

**12:00 PM.** I look for **maintenance ticketing**. I find nothing. Buildium has a tenant portal where my tenant submits a leaky disposal with a photo, it routes to me, I dispatch to my plumber Roberto, Roberto closes the ticket with an invoice, the invoice posts to that property's expense ledger. That's a four-actor workflow (tenant, landlord, vendor, accountant). AcreOS has none of those actors except landlord.

The vendor side specifically: I keep W-9s on Roberto, my HVAC guy Jamal, my roofer Tony, my locksmith. At year-end I issue 1099-NECs to anyone I paid more than $600. Buildium tracks the W-9 and runs the 1099 batch in January. AcreOS has no vendor entity, no W-9 storage, no 1099 generator. That's a workflow my CPA would scream about because last year I 1099'd nine vendors. Forgetting one is a $290 IRS penalty per missed form.

The dispatch flow also matters. When a tenant submits "no hot water" at 8 PM on a Tuesday, my system needs to triage (is this an emergency?), route (Roberto for plumbing, Jamal for HVAC — and is the issue in the water heater pilot or the gas line?), notify the vendor, give the vendor the property address and the tenant's phone, and let the vendor close the ticket with a photo of the repair and an invoice. AcreOS has zero infrastructure for this. The closest thing in the current product is the inbox, which routes email and SMS to me — but it doesn't fan out to vendors.

**1:00 PM.** Field visit on a turn at one of my single-families — tenant moved out last week. I open `/field-scout`. **This is genuinely useful for me, for a reason AcreOS didn't intend.** Move-out inspections need photos, a checklist, a date stamp. The field-scout offline-sync is *exactly* the move-out tool I'd want — every wall, every appliance, every floor, with a timestamp, before I release the security deposit. If AcreOS added a "move-in / move-out inspection" template to field-scout, with a tenant-signature step that ties back to the lease, **that's a real feature for landlords with very little new code.** I'd pay for that today.

**2:30 PM.** I look at `/documents` and `/sign-document`. The HMAC public signing flow is the right architecture. **Could it sign a residential lease?** Probably yes, technically. Practically — I have a 14-page Texas Association of Realtors residential lease with addendums (pet, lead-paint disclosure, Section 8, mold, bedbug, smoke detector). DocuSign handles that today. AcreOS's signing flow is built around a single document with signers, not around a lease *package* with addendums that have to be initialed in specific places per state law. Close, but not there.

The lead-paint disclosure specifically is federal — anything built before 1978 requires a separate signed disclosure, and the EPA has fined landlords up to $16,000 per violation when the form isn't on file. Six of my single-families are pre-1978. Every renewal I have to make sure that signed disclosure is on file. Buildium has a "lease packet template" feature where I define which addendums go with which property type and they auto-attach. AcreOS would need that or I'd lose forms in the shuffle. Lease renewal also matters — the renewal isn't a new lease in Texas, it's an addendum to the original. The signing system needs to model "lease + amendments over time" and let me see version 1, 2, 3 of a tenancy without losing the original.

**3:30 PM.** I look for **tenant screening**. Avail charges me $55 per applicant for credit + eviction + criminal + income verification, and the applicant pays. AcreOS has nothing here. Building tenant screening means TransUnion or Experian integration, FCRA compliance, applicant-pays billing, adverse-action notices when I deny. It's a quarter's worth of work to ship, and three states will sue you the first year. Don't half-build it.

The FCRA piece specifically: when I deny an applicant, I have to send an **adverse-action notice** within a defined timeframe, telling them which consumer-reporting agency was used, that they have a right to a free copy of the report, and that they have a right to dispute. Failure to send the notice is statutory damages of $100-1,000 per violation plus attorney fees. Companies that ship "casual" tenant screening get hit with class actions because they forgot the notice. AcreOS would need to build that workflow correctly *before* shipping the screening feature, not after. Avail and TransUnion's MySmartMove already solved this; reinventing it without consumer-finance counsel involved is malpractice.

Income verification is a sub-feature of screening that's gotten harder. Pay stubs are forgeable in 5 minutes with Photoshop. The new standard is bank-account aggregation via Plaid — you authorize me to see 60 days of deposits and confirm income. That's the level. Anything less and the screen is performative.

**4:00 PM.** I look for **Section 8 / housing voucher** workflow. Five of my doors are Section 8. The HUD inspection process, the HAP contract, the tenant-portion vs HAP-portion of rent, the annual recertification — none of this is in AcreOS. Buildium half-handles it. Most landlord software ignores it. If AcreOS shipped Section 8 properly it would steal customers from Buildium overnight in San Antonio, where about a fifth of the SFR market touches vouchers.

The Section 8 mechanics: the housing authority pays me a HAP portion (say $1,100) directly via ACH on the 1st. The tenant pays me a tenant portion (say $300) — sometimes on time, often late, occasionally never. So the rent ledger needs to know that one lease has *two* payors with *two* schedules and *two* dunning postures (you cannot evict a Section 8 tenant for the HAP portion, only the tenant portion, and even that requires HUD-specific notices). And the HUD inspection — failed inspection means HAP stops until repairs are made and re-inspected, but the tenant portion continues. Try modeling that on a single `rent_payment` table with one amount field. You can't.

**5:00 PM.** I check the investor view. **The portfolio analytics in `/portfolio` are oriented around note delinquency, not rent roll.** What I want as a buy-and-hold investor: NOI per property, cap rate per property, cash-on-cash return, debt-service-coverage ratio, vacancy rate trailing-12, occupancy rate, average tenant tenure. Stessa gives me all of these for free. AcreOS gives me none. I checked.

The metrics I actually look at on a Sunday afternoon when I'm thinking about whether to buy door 32:

- **NOI per door** — am I clearing $400/month per door average after operating expenses, or has that drifted to $300 because property taxes went up 11% in Bexar County?
- **DSCR** — debt service coverage ratio. If a property's NOI is $1,200/mo and the mortgage payment is $1,000/mo, DSCR is 1.20 — that's the line my lender uses for the next refi.
- **Vacancy rate trailing-12** — am I actually achieving the 5% vacancy I underwrote, or is one of my single-families dragging at 18% because the neighborhood got rough?
- **Average tenant tenure** — my multifamily turnover is killing me. The duplex on the east side has had four different tenants in two years. That's $8,000 in turn costs each time. The metric tells me to either raise screening or sell that building.
- **Cap rate** — for the buy decision. I won't touch a deal under 7% cap in current Bexar County pricing.

None of these are calculated anywhere in AcreOS today. They could be — the data model would need rent receipts, operating expense entries by category, debt records, and property values. Half of that lives in QuickBooks, none of it lives in AcreOS.

---

## 3. Per-surface friction

**`/today`** — Doesn't know I'm a landlord. Pulse, expiring offers, stale leads — all acquisition-shaped. I'd want a landlord landing with rent collected MTD, late count, maintenance open count, lease expirations 30/60/90, vacancies. None of those data sources exist yet.

**`/pipeline` + `/leads`** — Handles acquisition leads fine. Doesn't have a tenant pipeline. Conflating tenant prospects with seller leads is a category error and I'd never use one CRM for both. They're different *humans* with different data needs and different legal posture (FCRA on tenants, not on sellers).

**`/properties` / `/parcels`** — Good for acquisition. Missing: occupancy status, current tenant, current rent, lease end date, rent comp estimate, NOI estimate. A property that I own and am renting needs a different info-arch than a parcel I'm trying to buy.

**`/money`** — Wrong shape for me. Notes / Portfolio / Optimizer / Forecast / Capital — all paper-investor concepts. I'd want Rent Roll / Cash Flow / Tax Pack / Cap-Rate, as a parallel view, not a replacement.

**`/finance` / Notes tab** — Not applicable. I have zero notes. I have 25 leases. The shape is *similar* (recurring receivable with a borrower/tenant, late tracking, payment history) but the regulatory regime and the document model and the dunning rules are different enough that you can't just relabel "borrower" to "tenant" and ship.

**`/portfolio`** — Aging buckets are right shape, wrong source. Wire them to rent-roll late-pay data and they're useful. Today they're wired to note delinquency. The aging buckets also need to differentiate between "rent late" and "rent in eviction" — those are very different operational states. A 60-day-late tenant in pre-filing is recoverable; a 60-day-late tenant where I've already filed forcible-detainer is not.

**`/inbox`** — Generally useful. Tenants do email me. But I'd want it to know that the message from `tenant@gmail.com` is from Maria in Unit 3B at 1247 Olmos Drive, with her current lease, her payment history, and her last maintenance ticket one click away. None of that linkage exists because the tenant entity doesn't exist. Also, half my tenant communications are SMS or WhatsApp, not email. The unified inbox would need to handle SMS as a first-class channel, with consent tracking — TCPA exposure on landlord SMS is real, and several PMs have been sued.

**`/field-scout`** — Already covered. **Best surface for me, for a use case AcreOS didn't design for.** Move-in/move-out inspection. Add a lease-attached signature step and you have a real product.

**`/documents` / `/sign-document`** — Could probably handle a simple lease. Doesn't handle the lease-package-with-addendums pattern that real residential leases require. Not yet a DocuSign replacement for me.

**`/pax`** — Pax doesn't know about my tenants because there are no tenants. Asking it "which of my tenants are most likely to renew?" returns nothing useful. That's the AI question I'd actually pay for.

**`/onboarding-v2`** — Three paths (beginner / active / enterprise). None of them are "I have a 25-door rental portfolio I want to manage." The persona registry has a landlord entry. The onboarding doesn't route to it. That's a gap.

**`/pricing`** — I'd pay $20/mo for the acquisition side as an *additive* tool. I would not pay $79 Scale for any of this until the landlord workflow exists end-to-end.

---

**A note on the daily reality.** Most days as a landlord do not look like AcreOS's `/today`. They look like this: at 7 AM a tenant texts that her dishwasher leaked overnight; at 9 AM the bank confirms 17 of 25 ACH rent debits cleared; at 10 AM I call the three that didn't; at 11 AM I dispatch Roberto to the dishwasher; at 1 PM I show a vacant unit to a prospective tenant; at 3 PM I run her credit through Avail; at 5 PM I email her either a lease or a denial letter. None of those nine touch points has a home in AcreOS today. Every one of them has a home in Buildium.

That's not me complaining. That's me pointing at the gap so the team knows exactly what to build if they want this market.

---

## 4. The Buildium test — fail, by design

Buildium does these for me daily. Let me grade AcreOS against each:

- **Tenant CRM with lease + payment history** — *Missing.* No tenant entity exists. Adding it is at least 2 months of work to do right (FCRA-compliant fields, lease relationship, payment relationship, maintenance relationship).
- **Lease management with addendum-aware e-sign** — *Partial.* Public signing exists. Lease-package signing with state-specific addendums does not.
- **Rent collection (ACH + check + Stripe + late fees)** — *Missing.* Stripe Connect exists but is wired to notes, not leases. State-rule late-fee engine doesn't exist.
- **Late-rent dunning with state-aware eviction timeline** — *Missing.* Note-dunning shape is close but legal substance is wrong.
- **Maintenance request portal (tenant → landlord → vendor)** — *Missing.* Three actors not modeled.
- **Vendor / repair tracking with W-9 and 1099-NEC** — *Missing.* No vendor entity.
- **Tenant screening with FCRA compliance** — *Missing, and dangerous to half-build.*
- **Section 8 / HAP contract handling** — *Missing.*
- **Rent roll / NOI / cap rate / DSCR investor analytics** — *Missing.*

**Net: AcreOS is not a Buildium replacement and shouldn't be sold as one.** That's not a criticism — it's a positioning fact. The AcreOS team has built an excellent acquisition workstation. Buy-and-hold operations is a different product.

---

## 4a. The other test — Stessa, not just Buildium

I lied a little when I said I run on Buildium and QuickBooks. I also run on Stessa. Stessa is the investor view — it pulls from my bank accounts, categorizes transactions, gives me a P&L per property, a balance sheet across the portfolio, and a dashboard I can show my husband when he asks why I'm buying door 32.

Stessa is free. Stessa is also where 80% of small landlords end up because Buildium is operations-heavy and most landlords with under 50 doors don't need the operational depth — they need the tax view.

**AcreOS could replace Stessa for me before it replaces Buildium.** That's a more realistic 6-month target. The pieces:

- Bank-account aggregation (Plaid)
- Transaction categorization with property-level tagging
- P&L per property
- Balance sheet across portfolio
- Schedule E export for my CPA in January
- Mileage tracking (I drive 4,000 miles/year between properties; that's a $2,800 deduction)
- Receipt capture from email (Home Depot receipts auto-import to a property)

Most of this is closer to existing AcreOS infra (the QuickBooks sync, the document store, the property entity) than the operations stack. **A "Stessa-killer" inside AcreOS is a more achievable wedge than a "Buildium-killer."** And it pairs naturally with the acquisition product because the same person doing the deal underwriting wants to know "what's the actual P&L on the 4 doors I bought 18 months ago."

---

## 5. Five features that would make this a real landlord product

1. **Tenant entity, separate from lead.** First-class, with lease history, payment history, maintenance history, screening history, communications log. This is the foundation everything else hangs from. Without it nothing else is shippable.
2. **Lease-package e-sign** — multi-document with state-specific addendums (lead paint, mold, bed bug, Section 8, pet, smoking) where each addendum routes to its own signature/initial fields. The HMAC public-signing infra is most of the way there; the lease-package model is what's missing.
3. **Move-in / move-out inspection in `/field-scout`** with tenant signature, attached to a lease, attached to a security-deposit ledger. **This is the one I'd ship first.** It rides on existing infrastructure.
4. **Rent-roll uploader on `/parcels/:id` for occupied acquisitions.** Drop in the seller's rent roll, get tenant records and lease records pre-populated, get an NOI estimate before you close. This is the one feature that would hook *any* landlord-buyer immediately.
5. **State-aware late-rent dunning.** Texas isn't California isn't New York. Eviction timelines, notice-to-vacate language, late-fee caps, and grace periods vary. A configurable rule engine that knows my state ships me a real Buildium alternative for that one workflow. This is also the highest-risk feature to ship — get the legal language wrong and you've helped a landlord file a defective notice.

---

## 6. Three things that are surprisingly useful, even for a landlord

1. **Acquisition CRM for the buy side.** When I'm hunting my next fourplex, the lead pipeline + parcel view + DD checklist + valuation tools are *better than my spreadsheet*. I'd use this for the buy-side even if I never used it for operations.
2. **`/field-scout` with offline sync.** Already discussed. Works for move-in/move-out inspection out of the box even before AcreOS ships a tenant entity. I'd start using this Monday.
3. **The persona vocabulary registry.** That AcreOS even *thought* about a landlord persona, with the right vocabulary (Lead/Rental/Acquisition/Leased — the words are mostly right even if the underlying objects don't exist) tells me the team has the long-term posture to ship this if they want to. Most acquisition CRMs would never bother.

---

## 7. The honest verdict

AcreOS is an acquisition platform with a landlord persona painted on the wall. The persona has the right name and the right vocabulary, but the rooms behind the wall haven't been built yet. **For my buy-and-hold operation, AcreOS is a complement to Buildium, not a replacement.** I'd pay $20-49/mo for the acquisition side as a Stessa-of-the-buy-process. I'd keep Buildium for tenants, leases, rent, and maintenance.

If AcreOS wants to compete with Buildium, the work is at least:
- Tenant entity + lease entity + payment ledger (3-4 months of foundation)
- Maintenance ticketing with vendor portal (2 months)
- State-aware late-rent and eviction workflow (2 months + legal review per state)
- Tenant screening with FCRA compliance (1 quarter, with vendor partnership)
- Section 8 / HAP contract handling (1 quarter, with HUD-comfortable PM)
- Investor analytics — NOI, cap rate, DSCR, cash-on-cash (1-2 months)

That's a year of focused build, conservatively. And that's *after* deciding the company wants to be in this market, because once you take rent money on behalf of a third party (the tenant) for a customer (the landlord), you're in money-transmitter territory in some states and your compliance surface area triples.

So my recommendation, friend to friend: **don't half-build this.** Either commit to the landlord market with a separate product line and a year of dedicated build, or stay focused on acquisition and let me bring my deals to AcreOS and my tenants to Buildium. The middle path — shipping a thin tenant table and a fake rent ledger to *say* you do landlord — gets people sued.

For now, I'd sign up for the $20 Starter, use it on the buy side, and keep paying Buildium $58/mo until the day AcreOS has a real rent roll. That day isn't today.

---

## 8. What I'd build first if I were on this team

If somebody handed me the keys for a quarter and said "make AcreOS useful for landlords without rebuilding everything," here's the order I'd ship in:

1. **Move-in / move-out inspection in `/field-scout`.** Lowest effort, highest visible value. The infra exists. Add a "tenant signature" step (use the existing HMAC signing) and an attachment to a property record. Even without a tenant entity, this is shippable in 2 weeks and gives every landlord a reason to keep the app on their phone. Wedge feature.

2. **Rent-roll uploader on `/parcels/:id`.** When I'm evaluating a 6-plex, I get a rent roll PDF or CSV from the seller. Drop it in. AcreOS parses it, shows me current tenants by unit, current rent, lease end dates, and computes a rough NOI. This is acquisition-flavored — it lives in the parcel surface, not a tenant surface — but it's the moment a landlord-buyer says "oh, this thing gets it." 3-4 weeks.

3. **Tenant entity, minimum-viable.** Name, contact, lease ID, current rent, lease start, lease end, security deposit. That's it. No screening, no payment history, no maintenance — just the entity that everything else hangs from. 3-4 weeks for the data model + basic UI. *This is the gating dependency for everything below.*

4. **Lease entity + lease-package signing.** Lease document, addendums attached, signed via the existing HMAC flow with multiple signers and per-document signature fields. Renewal as a related lease referencing the original. 4-6 weeks.

5. **Rent ledger + ACH collection.** Recurring monthly rent charge per lease, ACH pull via Stripe, late-fee rule per state, partial-payment handling. **This is the hard one.** 8-12 weeks if you take it seriously, including legal review of late-fee language per state.

After those five, AcreOS is at parity with Buildium for ~70% of basic single-family operations. Maintenance, vendor 1099s, tenant screening, Section 8 — those are quarters 2-4 of the landlord-product roadmap.

If those six items ship in the next 12 months, **I'd cancel Buildium**. Until then, I'm a happy AcreOS acquisition customer and a happy Buildium operations customer, and I keep both.

---

## 9. Things I checked and didn't find

For the team, a fast inventory of features I went looking for and could not locate:

- Tenant entity and tenant CRM
- Lease entity and lease document
- Rent receivable / rent ledger
- ACH-pull recurring rent collection
- Late-fee rule engine (state-aware)
- Eviction notice generator (state-specific forms)
- Maintenance ticket portal (tenant-side)
- Vendor entity, W-9 storage, 1099-NEC generator
- Tenant screening (credit, eviction, criminal, income)
- Adverse-action notice generator
- Section 8 / HAP-contract handling
- HUD inspection tracking
- Rent comp / rent valuation
- NOI calculator per property
- Cap-rate view per property
- DSCR calculator
- Cash-on-cash return calculator
- Vacancy-rate trailing-12 metric
- Move-in / move-out inspection template
- Security-deposit ledger and Texas-statutory release timing
- Tenant insurance verification
- Pet addendum tracking and pet-deposit ledger
- Renewal generator (Texas: addendum, not new lease)
- Lead-paint disclosure auto-attach for pre-1978 properties
- Tenant communication log with TCPA consent tracking

Each of these is a small feature. Together they're a year of work and the difference between "AcreOS has a landlord persona" and "AcreOS is a landlord product."

---

## 10. One last thing — what AcreOS gets right for landlord *acquisition*

I've spent most of this writing what's missing. Let me close on what's actually working.

When I'm hunting my next door, AcreOS is genuinely better than the spreadsheet I currently use. The acquisition workflow — lead capture, parcel research, owner outreach, due diligence, valuation, offer tracking, closing checklist — is well thought-through. The DD checklist on `/parcels/:id` matches the list I keep in my head: title clear, no liens, no environmental, access, taxes current. Add four more for landlord-buyers (current rent roll, current expenses, lender-acceptable property class, market rent comp) and that surface is the best acquisition tool I've used.

The field-scout offline sync is the kind of small thing that signals the team has actually been outside. Most "real estate software" is built by people who've never stood in a tenant's kitchen explaining why the dishwasher isn't covered under the lease. Whoever built field-scout has been outside.

The persona vocabulary registry is thoughtful. The HMAC public signing flow is the right architecture even if the lease-package model isn't built yet. The Stripe Connect plumbing is right even if it's wired to the wrong receivable.

So — when someone reads this and feels deflated by all the "missing" — don't. The bones are good. The acquisition product is genuinely useful. The landlord product is just a different product, and the team hasn't built it yet, and that's an honest place to be.

I'd sign up. I'd use it on the buy side. I'd come back in a year and check the rent roll.

— Imelda
