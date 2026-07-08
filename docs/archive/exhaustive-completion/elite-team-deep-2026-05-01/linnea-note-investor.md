# Linnea Harju — AcreOS user review (Note Investor)

I am 50, I live in Minneapolis, and I run a note book. Sixty-three active notes today, mostly seller-financed paper I bought *from other holders* on the secondary market — a few I originated myself, but the bulk are notes some flipper or builder didn't want to service anymore and sold me at a discount. Residential pays $30K-$200K in unpaid principal. Small commercial — strip-center pads, a self-storage in Iowa, two carwashes — runs $80K-$300K. My stack today is **NoteSchool** for community + deal flow, **GoldenPear** for servicing, **QuickBooks** for books, and a 47-tab spreadsheet I have nightmares about.

I do not need another CRM. I need a note book that doesn't lie to me.

Wendell already wrote his land-investor review. I read it. Half his complaints are mine. The other half are his. Here's where Note Investor diverges.

---

## 1. Thirty-second verdict

Would I switch today? **No.** Not at any price. Not yet.

Would I switch in 90 days if a specific list of things ships? **Yes — at $79/mo Scale, possibly $49/mo Pro.** The Starter tier is irrelevant to me; I have 63 notes and growing.

Here is the brutal version. AcreOS today is a **land-investor platform with a notes tab**, not a note-investor platform. The persona vocabulary primitive (commit b444513) renames "Properties" to "Notes" in my UI, which is thoughtful, but **renaming a column isn't a data model.** A note investor's data model is fundamentally different from a land flipper's. AcreOS's `notes` table assumes *I originated the note from a parcel I sold.* Three-quarters of my book, I did not. I bought paper. There is no "acquired note" path.

What would change my mind in 90 days:

1. A real **note acquisition pipeline** distinct from "I sold my parcel and carried paper."
2. A **BPO + tape diligence workflow** — cash-on-cash yield, YTM at three discount prices, payment-history scoring on import.
3. **1098-INT batch generation** in January for every active note. (Wendell flagged this. He's right. For me it's existential.)
4. **Servicing math that matches GoldenPear** to the penny — partials, extra principal, escrow holdback, late fees, payoff with per-diem.
5. **Note assignment paperwork** — when I sell a note, I need an Allonge + Assignment of Mortgage/Deed of Trust generated and trackable.

If those five ship, I'm a $79/mo customer with two seats. If only items 3 and 4 ship I'm a $49/mo customer for myself only. Without item 1 the rest doesn't matter.

Let me be specific about what "switch" means for me, because I think the word gets used loosely. There are three migrations a note investor goes through with a new platform:

- **Trial migration** — I import 5 notes, run them parallel to GoldenPear for a quarter, compare the ledgers monthly. Low risk, low commitment. AcreOS could earn this from me today if items 3 and 4 shipped, even without item 1.
- **Primary migration** — I move my whole book over and AcreOS becomes my system of record, while GoldenPear continues to handle the regulated servicing. This requires items 1, 3, 4, 5 minimum.
- **Full replacement** — AcreOS replaces GoldenPear entirely. Requires AcreOS to either become a licensed mortgage servicer or partner with one as a reseller. Multi-year build. I'm not asking for this in 2026.

So when I say "I'd switch at $79/mo" I mean primary migration. Trial migration I'd do at $49/mo today *if* items 3 and 4 ship. Be clear which one your roadmap is targeting.

---

## 2. Daily-use walkthrough — first day with 60 notes imported

**8:00 AM.** I land on `/today`. Wendell called it dense. He's right. Pulse, AI actions, expiring offers, stale leads, goals bar. **None of that maps to my day.** A note investor's daily landing should answer three questions: who paid, who didn't, what's coming up. I don't have "expiring offers." I have **payments due today, payments late by 1-30 days, payments late 30-60, payments late 60+, and notes coming up for balloon or payoff in the next 60 days.** That's my dashboard. AcreOS's `/today` is built for someone hunting deals. I'm not hunting parcels. I'm hunting yield.

**8:20 AM.** I try to import my 63 notes. I find `notes-import-dialog.tsx`. Good — at least it exists. **What does it import?** I have a GoldenPear export with these columns: borrower name, property address, original UPB, current UPB, interest rate, P&I payment, next due date, days past due, amortized term, remaining term, escrow balance, late fee balance, last payment date, last payment amount, original note date, maturity date, original holder, my acquisition price, my acquisition date. **Will the importer ingest all of that?** I don't know without testing. Wendell asked for a column-mapper that previews five rows. **For notes that's not optional, it's required** — every servicer's CSV is shaped differently and we re-import constantly.

What's worse: there's no field on the AcreOS note schema for **"acquisition price"** vs. **"original face value."** The difference between those two numbers is my entire basis schedule and my whole tax picture. If I bought a $90K UPB note for $62K, the IRS cares about both numbers separately for the rest of that note's life. AcreOS treats notes as if I originated them at face. **I didn't.** Most note investors didn't.

**9:00 AM.** I open `/finance`. The note table loads. I see loan-health badges (Current, 3 days late). I see a Stripe Connect indicator. **Stripe Connect is not how note borrowers pay me.** My borrowers send ACH through GoldenPear, mailed checks, and a few wire. I need a payment-source field that handles `ACH-pull`, `ACH-push`, `check-mailed`, `wire`, `cashier's-check`, `money-order`, `cash-at-close`. Stripe is for SaaS subscriptions and direct-to-consumer commerce. It is not a note servicing rail.

**9:30 AM.** I try to enter a partial payment. Borrower owes $812 P&I. Sent me $400. **Where does that $400 go?** On a note ledger, partial payments don't reduce principal — they sit in unapplied funds until the next payment makes them whole, *or* they apply per the note terms (interest first, then principal, then late fees, depending on jurisdiction). I cannot tell from the surface whether AcreOS's ledger handles unapplied funds. If it shoves the $400 against principal and shows the borrower as "partially current," that's wrong, and at scale that's malpractice.

**10:00 AM.** Borrower wants to send extra principal. $5,000 toward principal-only. **Does AcreOS's ledger let me earmark a payment as principal-curtailment?** Without that, every borrower who tries to pay off early breaks my book. This is the #1 most common servicing event after a regular payment, and I cannot tell from `/finance` that it's supported.

**10:30 AM.** I check yield. `/portfolio` shows "Annual yield" as `(totalCashFlow / totalValue) * 100`. **That is not yield on a note book.** That's gross cash-on-cash on a portfolio of *equity holdings*. For notes I need:
- **Current yield** = annual coupon / current UPB
- **Yield-to-maturity** at my acquisition price
- **IRR** including partial principal returned to date
- **Effective yield** net of servicing costs and tax escrow float

AcreOS has an `IRRCalculator.tsx` that does Newton-Raphson on cash flows. **Good math.** But it's a standalone modal calculator, not embedded in the note record. I'd want every note's detail page to show all four yield metrics computed live from its actual payment history. That's table stakes on a note platform.

**11:00 AM.** I start poking at the parts that don't exist. **There is no BPO request workflow.** When I'm considering buying a note, I order a BPO from a local agent for $75-150, attach it to the deal, and the BPO valuation gates my offer. I see `/properties` and `/parcels/:id` with valuation tabs — that's for my owned parcels, not for **notes I'm considering buying.** A note acquisition is a deal type AcreOS does not have.

**12:30 PM.** Lunch. Skeptical.

**1:30 PM.** I go to assignments. I sold a $48K UPB note last month to another investor. **Where do I generate the Assignment of Mortgage and the Allonge to the Note?** I find `documents.tsx` and `sign-document.tsx`. The HMAC-link signing flow looks great. But I don't see an **Assignment template library** with state-specific recordable forms. Notes get assigned every day on the secondary market and the paperwork has to be county-recordable. If AcreOS can produce a state-correct Assignment + Allonge with the original note attached and route it to the title company, I'd pay for that alone.

**2:30 PM.** I check on a pool note. Three of my LP investors share a $180K commercial note 50/30/20. **Does AcreOS support fractional ownership of a single note?** I see no "investors" relation on notes. This is a pool tracker problem and it's where a lot of small note shops live. Without it I'm back in the spreadsheet for those four pool notes immediately.

**4:00 PM.** I start thinking about January. 1098-INT season. I have to send a 1098-INT to **every borrower** who paid me $600+ in interest in the calendar year. Sixty-three notes = up to 63 forms, plus the IRS copy. **I search AcreOS for "1098."** Nothing in the UI. Wendell flagged this too. **For a note investor this is not a feature gap — it's the load-bearing wall.** I cannot use this platform if I have to compute 1098s by hand in February.

**5:30 PM.** I try `/pax` to see if the AI helps. I ask "which of my notes are most likely to default in the next 90 days." Good question for a note investor. I don't know what AcreOS will say, but unless it's actually scoring on payment cadence + days-past-due trend + LTV drift + property-condition signals, it's a chatbot dressed in a suit. The right answer references *specific notes by borrower* and cites *specific signals*: "Henderson — 3 partials in last 6 months, last payment 12 days late, escrow short $340. Watch." That's a Pax I'd pay for. A Pax that says "Three notes show concerning trends. Want me to draft outreach?" is the cheap version and I'd turn it off in a week.

**6:30 PM.** I close the laptop. My honest reaction: **the bones are interesting, the surface is genuinely well-built, and the data model under it is for someone else.** AcreOS feels like it was specced by a land flipper who has carried paper a few times, not a note investor who lives in payment ledgers. That's fine — every product starts somewhere — but the gap between Note Investor in the persona registry and Note Investor in the schema is wide.

**Day 2 — what I'd test if I had a sandbox.** I'd pick three notes and put each through one full cycle:

1. A clean current note. Borrower pays $812 on time. Does AcreOS post it correctly, split P/I per the amort schedule, increment the principal-reduction column, and produce a payment receipt I can email? If yes, baseline works.
2. A note with a partial payment + late fee + extra principal in the same month. Borrower sends $400 on the 5th, $500 on the 22nd, and an extra $1,000 marked "principal only." Does the ledger show the right end-of-month balance? The right late-fee assessment? The right partial-vs-applied posting? Does the YTD interest figure match what I'd expect?
3. A payoff. Borrower wants to settle on a Friday at 2 PM. Does the per-diem calculator return the right number? Does AcreOS produce a payoff letter, a satisfaction-of-mortgage for recording, and a final 1098-INT-equivalent showing interest paid YTD?

**If those three test cases pass, I trust the ledger. If any of them fails, I don't.** That's the test. I'd run it on every release before importing live notes. This isn't optional rigor; it's how a note investor decides whether a platform handles money correctly.

---

## 3. Note-specific friction — what's missing or half-baked

**The data model assumes origination.** Every note in AcreOS appears to be a note *I created* by selling a parcel on terms. My book is mostly notes I *bought*. The schema needs:

- `acquisitionType` enum: `originated`, `purchased`, `inherited`, `partial-purchase`
- `acquisitionPrice` separate from `originalFaceValue`
- `acquisitionDate` separate from `originalNoteDate`
- `seller` (the prior holder) — not the borrower
- `assignmentChain` — every prior holder on the chain of title

Without those fields the note ledger will compute the wrong basis, the wrong yield, and the wrong gain/loss when I sell. A note investor cannot use a platform that gets basis wrong. The IRS does not accept "the platform did it."

**No BPO workflow.** When I'm doing diligence on a note to buy, I need a deal stage *before* the note enters the book. Something like `/note-pipeline` — sourcing, BPO ordered, BPO received, payment-history reviewed, title pulled, offer sent, accepted, in escrow, funded, on book. AcreOS's `/pipeline` is built for parcel leads. The semantics don't translate.

**Partial payments and unapplied funds.** I cannot verify from the surface that the ledger handles unapplied funds correctly. If a borrower sends $400 against an $812 payment, that money should sit in unapplied until either (a) the next deposit makes it whole or (b) it ages past a threshold and applies per note terms. Without that, my delinquency aging is wrong.

**Extra principal earmarking.** Every payment needs a flag: regular / partial / extra-principal-only / payoff / NSF-reversal / escrow-deposit / late-fee-payment. I see no evidence of this in the surface UI.

**Escrow holdback.** Some of my notes — especially the small commercial — collect tax/insurance escrow. That's a separate sub-account on the note ledger with its own balance, its own deposit/withdrawal history, and its own annual statement. **Not visible in AcreOS today.**

**Per-diem payoff.** Borrower calls Tuesday. "What's my payoff if I close Friday at 2 PM?" I need a payoff calculator that takes a date and returns: principal balance + accrued interest through close + per-diem to recording + late fees outstanding + recording/release fees - escrow refund. **One button.** I cannot tell if AcreOS does this.

**Yield panel on every note.** Current yield, YTM, IRR-to-date, and effective net yield. Not a standalone calculator. Per-note, live, on the detail page.

**Assignment + Allonge generation.** State-specific recordable templates, attached to the original note PDF, signed via HMAC link, mailed to the title company. This is the export side of every note sale.

**Pool/fractional ownership.** N investors share one note in defined percentages. Each investor gets their share of the cash flow and their proportional 1098-INT. Without this, every pool note is a spreadsheet.

**Note scoring on import.** When I'm looking at a tape of 40 notes for sale, I want AcreOS to score each one — payment history grade, LTV grade, property-condition grade, borrower-credit grade — so I can sort the tape in 30 seconds and bid on the top decile. That's where AI on a note platform earns its keep.

**Forced-place insurance tracking.** When a borrower lets their hazard policy lapse, I have to force-place coverage and add the premium to escrow. That's a workflow with three states (verified, expiring soon, lapsed-need-FPI) and the consequences of getting it wrong are five figures of uninsured loss. I see no insurance-tracking surface in AcreOS. A note platform without insurance compliance is incomplete.

**Property tax escrow disbursement.** Half my notes collect tax escrow. Twice a year I have to disburse to the county. **Where does AcreOS show me "tax disbursements due in the next 60 days"?** That's a workflow, not a calculation. Without it I miss a tax payment and lose lien priority.

**SCRA / military lookup on default.** Before I can foreclose on a defaulted borrower I have to run a SCRA check (Servicemembers Civil Relief Act) — if they're active duty I cannot proceed. This is a regulatory step every note servicer handles. I see no SCRA hook in AcreOS.

**Default workflow / loss mitigation.** When a borrower goes 60+ days late, I have a sequence: outreach call, demand letter, loss-mit options (forbearance, modification, deed-in-lieu, short sale, foreclosure). Each step has paperwork and timeline requirements that vary by state. AcreOS's `direct-mail-campaigns.tsx` is for marketing, not loss mit. I'd need a loss-mit case file per delinquent note.

**Modification accounting.** When I modify a note — drop the rate from 9% to 7% to keep a borrower in the property — that's a TDR (troubled debt restructuring) for tax purposes and a re-amortization for the ledger. The new amort schedule is *separate* from the original. Both have to be retained for IRS audit defense. I cannot tell if AcreOS retains versioned amort schedules.

**Per-surface notes from a note-investor lens:**

- **`/today`** — wrong default for me. Should switch on persona to: payments due today, late buckets (1-30 / 30-60 / 60+), maturities in 60 days, escrow tax disbursements coming up, insurance lapses. Pulse score is irrelevant on a note book.
- **`/pipeline` + `/leads`** — these are parcel-deal pipelines. I need a *note acquisition* pipeline parallel to it, with different stages and different deal cards. Renaming columns isn't enough; the stages themselves are different.
- **`/properties` + `/parcels/:id`** — useful when I take a property back through foreclosure (REO), useless for the 60+ notes I'm just servicing. The DD checklist is land-flipper DD; my note DD is "title clear, payment history clean, BPO supports my discount, borrower verified, escrow current, insurance verified."
- **`/finance`** — the loan-health badges are right. Stripe Connect is wrong rail. Need partial / unapplied / extra-principal / escrow / late-fee accounting visible per note. 1,800 lines in one file matches Wendell's read — at this complexity that file will break under a real schema migration.
- **`/portfolio`** — aging buckets are correct shape. The "Annual yield" formula `cashFlow/value` is wrong for notes. Replace with current yield + YTM + IRR-to-date per note plus weighted-average across the book.
- **`/money`** — five tabs is too many for me too. I want: **Notes**, **Payments**, **Escrow**, **Tax pack**. Drop Optimizer and Capital Markets entirely; those are for someone else.
- **`/pax`** — same complaint as Wendell on tab proliferation. The interesting Pax for me is "rank my book by default risk" not "draft outreach emails."
- **`/inbox`** — useful if I can route borrower replies into the right note's case file automatically. Email parsing on borrower name + property address. Otherwise it's a generic CRM inbox bolted onto a note book.
- **`/documents`** — needs a Note Templates section: assignment, allonge, modification, demand, deed-in-lieu, payoff letter, satisfaction-of-mortgage, 1098-INT. State-aware. None of these are visible in the surface today.
- **`/onboarding-v2`** — I don't fit any of the three paths (beginner / active / enterprise). I'm experienced with notes but new to AcreOS. Add a "I have an existing book — let's import it" path that walks me through a tape import + chart-of-accounts mapping in 20 minutes.
- **`/pricing`** — the Pro tier 1,000 AI requests/day cap is fine for me; I won't hit it. What I *do* care about is the line on tier feature matrix that says "seller financing supported." Today that line means "I can carry paper on a parcel I sold." It does not mean "I run a 60-note book." Be honest about that gap in the pricing copy. Don't sell me Note Investor at $79 when the schema is parcel-flipper.

---

## 4. The CPA test — fail today, partial in 90 days if items ship

My CPA in St. Paul does my taxes every March. She needs:

- **1098-INT for every borrower who paid $600+ interest** — *Fail.* No generator visible. This is the deal-killer Wendell flagged and it's worse for me — I have 63 borrowers vs. his probable dozen. Hand-filling 63 1098-INTs in February is 14 hours of work that QuickBooks-with-a-1098-plug-in does in 20 minutes. AcreOS has to match that.
- **Basis schedule per note** — *Fail.* AcreOS doesn't separate acquisition price from face value. Without that, basis is wrong from day one. On a note I bought at $62K with $90K UPB, my basis is $62K, not $90K, and the OID/market-discount accretion rules apply. AcreOS's data model can't represent this today.
- **Gain/loss on note sales** — *Unclear, probably fail.* When I sell a note at $55K that I bought for $48K with $61K UPB, my gain is $7K (sale price minus my basis), not $-6K (sale price minus UPB). If AcreOS computes gain off UPB, every note sale is reported wrong.
- **Depreciation schedule** — *Partial.* I see `/depreciation-calculator` and `/tax-optimization`. Notes themselves don't depreciate, but the few REO properties I take back through foreclosure do. The page exists; quality unknown.
- **Interest income roll-up by entity** — *Probable partial.* If the QuickBooks sync categorizes interest correctly and tags by entity, this works. If not, I'm reclassifying 700 transactions in QBO every March.
- **OID / market-discount accretion** — *Fail.* When I buy a note at a discount, IRS Pub 1212 says I have to accrete the discount over the remaining life of the note as ordinary income. **No serious note investor's tax software ignores this.** AcreOS does not appear to compute it.
- **K-1s for pool notes** — *Fail.* No pool-ownership model means no K-1 export.

**Net: fail today.** Even with optimistic credit on QuickBooks sync, the 1098-INT gap and the basis-schedule gap are individually disqualifying.

A specific scenario that makes the basis problem concrete: I bought a $115K UPB note in March 2024 for $78K. The borrower paid $9,200 in interest in calendar 2025 and reduced principal by $3,400. My CPA needs:

- 1098-INT to borrower: $9,200 interest paid (this is what AcreOS would compute today — incorrectly, because it would compute it off the amort schedule, not the actual ledger).
- Basis schedule: starting basis $78,000 in 2024, plus accreted market discount per Pub 1212 each year, less principal received, gives me the right tax basis if I sell.
- If I sell that note in December 2026 for $85K with $103K UPB at sale: my gain is $85K minus accreted basis (~$80K-ish), not $85K minus $103K. AcreOS would report a *loss* using UPB. That's a wrong return that triggers an IRS letter.

There is no shortcut around this. Every note investor's tax life depends on it. If AcreOS doesn't model acquisition price separately from face value, every tax export it produces for me is wrong — and I'd rather have no tax export than a wrong one.

---

## 5. Five features that would make this irresistible

1. **Note Acquisition Pipeline** — a deal type distinct from parcel leads. Sourcing → BPO → diligence → offer → escrow → funded → on book. Each stage with its own document checklist (note copy, mortgage/deed of trust, payment history, title commitment, prior assignments). This is the front door of my business.

2. **1098-INT batch generation in January.** Pull every active note. Compute interest paid by borrower in the calendar year per the actual payment ledger (not the amort schedule). Generate signed PDFs. Mark them mailed. Generate the IRS 1096 transmittal. **For a platform pitching itself to note investors this is non-negotiable.**

3. **Per-note yield panel** with current yield, YTM at my acquisition price, IRR-to-date computed from the actual payment ledger, and effective net yield after servicing costs. Live, not a modal calculator.

4. **State-aware Assignment + Allonge generator** — pick the state, fill the parties, attach the original note, route through HMAC sign, deliver to title company. Every note I sell or buy needs this paperwork. Right now I pay an attorney $200 per assignment.

5. **Pool/fractional ownership with proportional cash-flow + 1098-INT split.** When three investors share a note 50/30/20, AcreOS computes each investor's share of every payment, generates per-investor 1098-INTs, and produces a per-investor basis schedule. Without this, pool tracking lives in Excel forever. Bonus points if it produces an investor statement PDF I can email out monthly without manual work — that's how I keep my LPs happy and how I avoid the Saturday-morning "where's my December payment" call.

Bonus #6 if you have the budget: **a tape importer that scores notes on payment history + LTV + borrower credit on the way in.** When I get a tape of 40 notes from a brokerage, I want to bid on the top 5 by 9 AM. AcreOS's AI should be doing this, not writing me follow-up emails to leads.

Bonus #7: **a loss-mit case-file workflow** — every delinquent note gets a default file with state-specific timeline, demand-letter template, SCRA lookup result, BPO refresh, modification-vs-foreclosure decision matrix. The note investors I know spend 30% of our time on the bottom 10% of our book. Tooling that helps with the bottom 10% pays for itself in week one.

---

## 6. Pricing thoughts

I pay today: NoteSchool $97/mo + GoldenPear roughly $25/note/month for full servicing on the active subset (~$400/mo) + QuickBooks Online Plus $90/mo + DocuSign Standard $40/mo + the occasional attorney. Call it **$640/mo** baseline, more in heavy months.

AcreOS replacing all of that at **$79/mo Scale** would be a layup *if it worked.* But it doesn't replace GoldenPear today — GoldenPear handles the actual ACH pulls, the borrower portal, the regulatory licensing in 38 states (RMLA, SAFE Act compliance for mortgage servicers). AcreOS would have to either become a licensed servicer or partner with one. That's a hard problem and it's why every note shop pays a real servicer.

Realistic pricing tiers for me:

- **$49/mo Pro** — if AcreOS handles 1098-INT generation, basis tracking, yield panel, and assignment paperwork — and I keep GoldenPear for actual servicing. AcreOS becomes my "book of record" + tax + paperwork layer. Worth $49/mo easily.
- **$79/mo Scale** — if it does all of the above plus pool-ownership tracking and acquisition-pipeline workflow with BPO. Worth $79 easily.
- **$199/mo "Note Pro"** — a tier that doesn't exist yet. If AcreOS partners with a licensed servicer (or builds one) and replaces GoldenPear's $400/mo for me, I'd pay $199 in a heartbeat and consider it a steal.

The Starter tier at $20 is irrelevant. Note investors don't have <10 notes; we have 30+ or we're not in this business.

What I'd refuse to pay for: a per-note fee. I will pay flat. I will not pay per-asset because my book grows and my margin per note isn't large enough on the small-balance residentials.

What I'd happily pay extra for as add-ons: BPO ordering pass-through ($75-150 per BPO, AcreOS routes to a vendor and bills me), credit pulls on borrowers ($15-25 per pull), state-recordable Assignment generation ($20 per assignment vs. $200 to my attorney). **Pay-as-you-go on workflow steps that today cost me real money elsewhere is fine.** I just won't accept a base-fee multiplier on note count.

The BYOK angle Wendell flagged matters to me too: I have my own account at DataTree and at TLO. Let me bring those keys. Don't pay you to wholesale me data I'm already paying for.

---

## 7. The deal-killer

**The note acquisition data model is missing.**

Not the 1098 (that's a build, but a finite one). Not the assignment templates (also a build, also finite). The deal-killer is structural: AcreOS's `notes` table assumes I originated every note. **I didn't.** The way the platform represents a note today cannot accommodate the difference between original face value and my acquisition price, the assignment chain back to origination, or the OID/market-discount accretion that flows from buying notes at a discount.

That's not a feature. That's a schema migration. Until that ships, **AcreOS is structurally a land-flipper platform with a notes pretty-print, not a note-investor platform.** The persona vocabulary primitive that renames "Properties" to "Notes" in my UI is the right gesture but it's writing on a Land Investor data model. A Note Investor needs a Note Investor data model.

If Thomas's team wants Note Investor as a real persona, the work order is roughly:

1. Schema migration on `notes` — acquisition fields, assignment chain, ownership splits.
2. Servicing ledger — partial / unapplied / extra-principal / escrow / payoff per-diem. Match GoldenPear's behavior to the penny.
3. 1098-INT + basis-schedule + OID/MD accretion — the tax pack.
4. Acquisition pipeline + BPO workflow — the front door.
5. Assignment / Allonge generator — the back door.

In that order. Item 1 unlocks all of them. Without item 1 the rest don't compose.

The reason I'm being precise about ordering: I've watched two other "real estate" platforms try to bolt notes onto a parcel-flip data model. Both ended up with notes-as-second-class-citizens — half the features I needed, none of the ledger discipline, and an upgrade tier that promised "advanced note features coming soon" for two years running. I'd rather AcreOS not pursue notes at all than pursue them halfway. Halfway is worse than nothing because I'll move my book over, lose six months reconciling, and end up rebuilding in Excel anyway.

The honest path: tell me you're committing to Note Investor as a real persona with a real schema, give me a roadmap with dates, and I'll be patient. Or tell me Note Investor is in the registry as a vocabulary primitive only and you're not building the schema this year — I'll appreciate the honesty and stay on GoldenPear.

If items 1–3 ship by July 31, I will trial AcreOS on a 5-note subset for 90 days and let the math speak. If the basis schedule and 1098-INT match my CPA's spreadsheet to the dollar on a real quarter, I am a $79/mo customer for the next decade.

If items 1–3 don't ship, I am a NoteSchool + GoldenPear + QuickBooks customer for the next decade and AcreOS is a brand I read about in *Note Investor* newsletters but never log into.

The note ledger has to be right, *and* the note ledger has to know it's a note book — not a parcel book pretending.

---

## Postscript — the things that gave me hope

I'm not all skepticism. Three things impressed me in the half day I spent here, and I want to name them so the team knows what's working.

**The HMAC-link signing flow** that Wendell loved is even more valuable to me than to him. Every note assignment, every modification agreement, every payoff letter, every demand letter goes through a signature step. If AcreOS's signing rail handles signer order, audit trail with IP, and expiry — and the link works on a flip phone — I save $480/year on DocuSign and an unmeasurable amount of time. The architecture sketch looks correct. The proof is in whether my 73-year-old borrower in rural Iowa can sign without a 20-minute support call.

**The persona vocabulary registry.** It's not enough on its own — I made that point above — but the *fact that the team built it* tells me they're thinking about non-land-flipper personas as first-class. Most "real estate platforms" don't even know note investors exist. That AcreOS at least has us in the registry as `note_investor` with seven labeled vocabulary slots is more than I get from any of my current vendors.

**The IRR calculator math is correct.** Newton-Raphson with 1e-7 tolerance and 1000-iter ceiling is the right shape. The math primitives are there. They just need to be plumbed into the note-record level instead of living in a standalone modal. That's plumbing, not invention.

If the team wires the right plumbing to the right primitives and adds the missing schema, AcreOS becomes the first platform built for note investors that doesn't feel like a 2008-era servicing tool. That's a real opportunity. I'd love to be a beta customer for it.

But until the schema migration ships, I'm not switching. I will, however, check back in 90 days. Send me a note when items 1–3 are live.

— Linnea
