# Constance Fielding — AcreOS through a Chapter 11 debtor-in-possession lens

I'm Constance. Fifty-six. Phoenix. I've been in land sixteen years; built the business up to about 340 active notes and a working inventory line and I leveraged it the wrong way at the wrong time. November 2025 we filed Chapter 11. The trustee's office has the key to the file room — figuratively for now, literally next quarter — and I am operating as **debtor in possession**: still running the business, still collecting on notes, still writing checks, still acquiring inventory if I can justify it on a 2002 motion. But every dollar in and out is now a court question, the U.S. Trustee's office wants a Monthly Operating Report (MOR) on the 15th of every month, my DIP lender wants a borrowing-base certificate every Tuesday, and my unsecured creditors' committee has a forensic accountant who reads my filings the way I used to read AVMs.

I came at AcreOS asking one question: **can a debtor in possession run their business on this without burning thirty hours a month re-keying data into bankruptcy filings?** Because that's what I'm doing today on QuickBooks plus three custom Excels and it's killing me.

Short answer: AcreOS is closer than QuickBooks is, but it has zero awareness that a business can be in reorganization. Every assumption — single-org sole-control, owner sees everything, no external read-only oversight, no period-locking on closed reporting periods, no concept of pre-petition vs post-petition transactions — breaks the moment you file. Fixable. None of it is shipped.

---

## 1. Thirty-second verdict

The bones AcreOS already has solve about 60% of the Chapter 11 reporting problem better than my QuickBooks does. The note ledger is per-payment-line accurate (`server/services/bookkeeping.ts`), the audit log is real (`shared/schema.ts:4149` — captures action, entity, before/after, IP, UA, user), the 1099-INT generator already classifies interest income at the org level, and the cash-flow forecaster (`server/services/cashFlowForecaster.ts`) can already project 12 months of borrower payments which is exactly what an MOR cash projection requires.

What's missing is **the wrapper that makes all of that survivable inside a court-supervised reorganization**: a trustee/auditor read-only role, a petition-date marker that lets the system separate pre-petition from post-petition activity, a borrowing-base certificate template, a notes-receivable-as-estate-asset valuation surface that survives discovery, and a cash-collateral / DIP-budget variance tracker. Nothing in the codebase contemplates that the user's business is in court. **For the operator-in-bankruptcy this is roughly a six-week build on top of strong existing primitives.** For AcreOS as a platform this is the difference between "can keep customers who hit financial trouble" and "loses them to QuickBooks-plus-a-CFO-consultant the day they file."

The third lens — and this is the one I want to flag for whoever reads this honestly — **roughly 12-18% of small-operator land businesses that took 2021-2022 acquisition leverage are going to need some form of restructuring in the next 24 months.** Not all Chapter 11. Some Chapter 13, some out-of-court workouts, some assignment-for-benefit-of-creditors. But the cohort of distressed-but-still-operating Land Investors is large enough that this isn't a one-persona feature. It's a market segment.

---

## 2. Daily-use walkthrough — Thursday, MOR week

**Tuesday 6 AM.** Borrowing-base certificate due to my DIP lender by 5 PM. The certificate says: how many notes are eligible collateral, what's the aggregate principal balance, what's the haircut for delinquencies and concentration limits, and what's the resulting borrowing base against my $2.4M DIP facility. **AcreOS has every input.** The note ledger has principal balance per note (current). Portfolio Sentinel (`routes-portfolio-sentinel.ts`) flags delinquencies. Portfolio Optimizer (`server/services/portfolioOptimizer.ts:240-248`) already computes county-HHI which is exactly the concentration metric my DIP lender uses. **What's missing:** a borrowing-base certificate template that takes my facility's eligibility rules as input (notes ≤ 60 days delinquent, originated ≥ 9 months ago, county concentration ≤ 20%, single-borrower concentration ≤ 5%, DSCR proxy ≥ 1.0x for ag/commercial) and produces a one-page PDF I can sign and send. I currently rebuild this every Tuesday in Excel from a CSV export. Two hours each time.

**Wednesday 8 AM.** Forensic accountant from the unsecured creditors' committee emails: "Send a list of every payment received from a borrower between Sept 1 and Dec 1, with payment-date, payment-amount, allocation between principal/interest/late-fee/escrow, and the corresponding bank-deposit reference." That's a discovery request. **AcreOS can answer this question** — payments table joined to notes joined to bank-reconciliation has every field. There's no pre-built export for it. I can dump the payments CSV (`routes-communications.ts:879`) but the principal/interest/escrow allocation is computed at view-time, not stored as an exportable column on the row. So I export, open in Excel, and re-run the allocation by hand. Errors compound. **Build:** /api/court-discovery/payments-with-allocation?from=YYYY-MM-DD&to=YYYY-MM-DD → CSV with all five fields plus the bank-deposit reference. Ship it as a court-discovery exports menu visible only to a "trustee" or "court-auditor" role.

**Wednesday 2 PM.** DIP lender's loan officer wants to log in and see my notes-receivable balance live. Today I send him a screenshot. He's getting nervous. **AcreOS has no read-only external-viewer role.** The role enum (`shared/schema.ts:137`) has owner/admin/member/viewer/acquisitions/marketing/finance — and the role guard (`server/middleware/roleGuard.ts:13`) treats "member" as "read-only CRM access." That isn't what an external lender oversight role needs. A lender oversight role needs: read-only access to notes, payments, portfolio dashboards, P&L, *no* ability to see leads/CRM/pipeline (that's not collateral, it's competitive info), no access to communications, no access to acquisition pipeline. A trustee oversight role needs the inverse: read-only access to *everything financial including pre-petition history* but only write access to leave audit-comments. **Build a `external_oversight_role` enum** with three values — `dip_lender`, `trustee`, `creditors_committee` — each with its own read-scope mask.

**Thursday 7 AM.** MOR drafting day. The U.S. Trustee's MOR template (UST Form 11-MOR) has 28 sections. I'll list the seven that AcreOS could *actually fill in for me* if it knew it needed to:

1. **Cash receipts and disbursements by category** — payments table grouped by category. AcreOS has the data; needs a UST-template export.
2. **Accounts receivable aging at month-end** — notes table with current/30/60/90+ delinquency buckets. Sentinel computes this; needs an aged-AR snapshot frozen at month-end.
3. **Post-petition tax liabilities (paid and unpaid)** — propertyTaxService tracks parcel-level taxes. Needs a "post-petition only" filter (anything dated after petition date).
4. **Insurance coverage status** — Sentinel flags insurance lapses. Needs an "as-of-month-end" snapshot.
5. **Bank reconciliation summary** — bookkeeping.ts has trustLedger reconciliation. Needs MOR-formatted output.
6. **Compensation paid to insiders (the debtor herself)** — billing/owner-draws table. AcreOS doesn't track owner draws as a first-class concept. This is a gap.
7. **Comparison of actual cash to budget filed with court** — needs the cash-collateral budget loaded as a baseline. Forecaster (`cashFlowForecaster.ts`) projects forward; doesn't variance-track against an externally-loaded baseline.

The other 21 sections are narrative or attachments. But shaving 7 sections from manual-entry into auto-fill saves me four hours every month for the next 18 months.

**Thursday 11 AM.** Automatic stay question from a borrower. Dale in Colorado just emailed: "Hey Constance, I read your business filed Chapter 11. Do I still pay you?" The answer is yes — automatic stay protects *the debtor* from creditors, it doesn't free *borrowers of the debtor* from their obligations. My notes receivable are the estate's asset. Borrower payments must continue and are now post-petition cash collateral subject to my DIP order. **AcreOS gave me no help with this conversation.** I want a one-click "send post-petition payment instructions to all 287 active borrowers" sequence — branded letter explaining the situation, confirming payment instructions (which lockbox, which routing number), confirming their note terms are unchanged, contact info for borrower questions. The communications system can send the letter (`routes-communications.ts`) and the customer-letter generator (`routes-customer-letter.ts`) can probably produce the content. There's no template for this scenario. **Build a "post-petition borrower notice" letter template** with the legal language vetted once, stamped onto every active note with one click. Twelve-borrower test population in beta, then GA.

**Thursday 3 PM.** DIP budget variance review with my CRO. We agreed with the court on a 13-week cash budget at the first-day hearing. We're in week 11. I want to see actual receipts vs budgeted receipts week-by-week, actual disbursements vs budgeted disbursements by category, and the cumulative cash variance. **The cash-flow forecaster runs forward projections; there's no variance tracker against a static budget.** Build: /api/cash-collateral-budget/upload (CSV in: week-number, category, budgeted-amount), /api/cash-collateral-budget/variance (returns actual vs budget by week+category with cumulative variance). This is a ~300-line feature and it's table-stakes for any court-supervised business.

**Thursday 5 PM.** Plan-of-reorganization modeling. My attorney wants to know: if I haircut my unsecured creditors at 35¢ on the dollar with a 5-year payout, can the note portfolio's free cash flow service that schedule? Cash-flow forecaster can answer half of this — it projects gross note cash flow. It can't model: senior DIP debt service, post-petition operating costs, professional fees (the bankruptcy attorneys and CRO bill more than my insurance), priority tax claims, then unsecured pool. **A waterfall-modeling surface that takes my projected note cash flow and routes it through a court-approved priority schedule, then shows me what's left for unsecured creditors quarter-by-quarter for five years, would let me draft the plan myself instead of paying my attorney $625/hour to do it in Excel.**

---

## 3. The Chapter 11 / DIP test — what passed, what failed

**Pass:**
- Audit log captures action, entity, before/after, IP, user (`shared/schema.ts:4149-4165`) — court-defensible chain of custody on data changes
- Note ledger is per-payment, per-allocation accurate (`server/services/bookkeeping.ts`)
- Annual interest report and 1099-INT generator at org-scope (`server/routes-bookkeeping.ts:23-46`)
- Portfolio P&L by year (`routes-portfolio-pnl.ts`) — usable as a starting point for MOR cash receipts
- Cash flow forecaster with 12-month note projections (`cashFlowForecaster.ts`)
- Portfolio Sentinel monitoring (delinquency, tax, insurance) — three of the seven MOR-required exhibits
- CSV export for notes, payments, leads, properties, deals (`routes-import-export.ts:244-253`, `routes-communications.ts:879`)
- Trust ledger with bank-reconciliation primitive (`bookkeeping.ts` references `trustLedger`)
- Org-scoped isolation on every query (data is partitioned cleanly)

**Fail or Missing:**
- **No external-oversight role.** Trustee, DIP lender, and creditors' committee all need read-only scoped access. None exists. Member role is too broad in the wrong dimension and too narrow in the right one.
- **No petition-date marker.** Pre-petition vs post-petition is the central distinction in every Chapter 11 surface — schedules, MORs, cash-collateral compliance. Schema has no `organizations.petition_date` or equivalent. Every report I run today has to be hand-filtered.
- **No period locking.** Once an MOR is filed with the court, the underlying period must be immutable — no retroactive backdated entries, no "I'll just edit that payment date." Today AcreOS lets me edit any payment any time. That's a court-evidence problem.
- **No borrowing-base certificate generator.** Inputs all exist; output template doesn't.
- **No cash-collateral-budget variance tracker.** Forecaster projects; no surface variances actuals against a court-loaded baseline.
- **No insider-compensation tracking.** Owner draws / officer compensation isn't a first-class entity. UST cares about this in every MOR.
- **No professional-fee tracking.** Bankruptcy attorneys, CRO, financial advisor — all paid from the estate, all subject to fee applications. AcreOS doesn't have a "professional retainer" entity or a fee-application export.
- **No reorganization-plan waterfall modeler.** Cash-flow forecaster goes one step (gross note cash). Doesn't apply priority waterfall.
- **No post-petition borrower notice template.** Template gap, not architectural — but it's the single most-asked-about question on Day Two of any filing.
- **No notes-receivable-as-estate-asset valuation.** AVM values properties. Note valuation for bankruptcy schedules is different — it's the risk-adjusted PV of remaining payments at a market-comparable yield, not a property AVM. Nothing here computes that.
- **No discovery-export bundle.** Forensic accountant requests a bundle every two weeks. Today I cobble it from three CSVs.
- **No pre-filed-claim reconciliation.** When unsecured creditors file proofs of claim, I have to reconcile them against my schedules. AcreOS has no "creditor" entity outside borrowers.
- **No automatic-stay enforcement on the comms side.** If a former *creditor* of mine (someone I owe money to) emails me through AcreOS, the system shouldn't let me reply with a payment offer (that's a stay-violation risk). No surface for this.

---

## 4. Per-surface friction (Chapter 11 lens)

**`/portfolio` (existing dashboard)** — Shows current NRV-style portfolio metrics. For a debtor I want a toggle: "show as of petition date" (locks the snapshot) and "show post-petition activity only" (filters to transactions after petition date). Both are one-line filters once `organizations.petition_date` exists.

**`/notes/:id` (note detail)** — Add a "post-petition payments" panel separate from the main payment ledger. Forensic accountants ask for this every cycle.

**`/cash-flow`** — Already projects forward. Add a "load court budget" upload (CSV: week × category × dollars) and a variance view. This is a five-day build for a senior engineer.

**`/bookkeeping/annual-report`** — Add an MOR period (calendar month) alternative alongside the annual one. Month-by-month at the same fidelity is the artifact UST wants.

**`/audit-log`** — Add filter "show only changes during reorganization period" and a court-stamped CSV export with cryptographic hash of the export bundle. Defensible-record export is a five-line addition once the bundle is structured.

**`/team` (membership)** — Add the three external-oversight role types as invitable roles. Trustee invitation flow should require dual-confirmation by org owner.

**`/legal/court-filings` (does not exist)** — New surface. Repository for filed schedules, MORs, motions, orders. Tag each with date filed, court reference number, and the underlying data snapshot used. So when a creditor asks "what was your AR balance on Sept 30 2025?" I can produce both the filed exhibit and the live data that backed it, and prove they matched at filing.

---

## 5. Data-model deltas required

- `organizations.petition_date` — nullable date. Setting it triggers the Chapter 11 surfaces.
- `organizations.bankruptcy_chapter` — enum (`'7' | '11' | '13' | 'abc'`). Different chapters, different surfaces.
- `organizations.case_number` — text. Every export header references it.
- `organizations.dip_facility_id` — fk to a new `dip_facilities` table.
- New table `dip_facilities` — lender, facility size, interest rate, eligibility-rule JSON, borrowing-base history.
- New table `cash_collateral_budgets` — period start/end, line-item budget JSON, court-approval reference.
- New table `professional_retainers` — firm, role (counsel/cro/fa), retainer balance, billing-rate schedule, fee-application history.
- New table `insider_compensation` — recipient, period, amount, category (salary/draw/expense reimbursement), MOR-disclosure flag.
- New table `proofs_of_claim` — claimant, scheduled amount, claimed amount, disputed amount, status.
- New role enum `external_oversight_role` — `'dip_lender' | 'trustee' | 'creditors_committee' | 'court_examiner'`.
- New `period_locks` table — entity, period, locked-at, locked-by, court-filing reference. Read by every mutation guard.

---

## 6. What I would build first, with limited engineering

If I had one engineer for six weeks dedicated to making AcreOS survivable for a debtor in possession, the order is:

1. **Week 1.** `organizations.petition_date` + role enum + period-lock table + petition-date filter wired through the five highest-traffic financial views.
2. **Week 2.** Trustee/DIP-lender/creditors-committee read-only role with scoped surface-by-surface access. Audit-log export with cryptographic hash.
3. **Week 3.** Borrowing-base certificate template + cash-collateral-budget variance tracker.
4. **Week 4.** MOR auto-fill for the seven sections AcreOS already has the data for. PDF output stamped with case number and period.
5. **Week 5.** Post-petition borrower notice template + pre-vs-post-petition activity views on `/notes/:id`. Insider-compensation entity. Professional-retainer entity.
6. **Week 6.** Notes-receivable-as-estate-asset valuation (risk-adjusted PV at comparable yield, distinct from AVM). Discovery-export bundle. Plan-waterfall modeler skeleton.

End-state: a debtor in possession can run their land business on AcreOS, file court-defensible reports from it, give their trustee and DIP lender direct read-only access without exporting CSVs, and emerge from reorganization with the same system-of-record they entered with — except now seasoned by 18 months of court oversight, which is more rigorous than any voluntary audit.

That last point is the strategic one. A small operator who survives Chapter 11 on AcreOS comes out the other side with cleaner books than a small operator who never filed. That's a better customer to serve for the next 10 years. Don't lose them at the filing.

---

## 7. The automatic-stay misconceptions worth coding against

Three borrowers have already asked me — directly or indirectly — whether my filing means they get to stop paying. None of them mean it maliciously. They've Googled "Chapter 11" and gotten confused. AcreOS could fix this with one well-written letter template and a borrower-portal banner. The legal substance:

- **Borrowers must continue paying.** Their note is the estate's asset. Stopping payment is default, not relief.
- **Payment terms are unchanged.** No interest-rate change, no maturity-date change, no balloon adjustment unless the plan of reorganization specifically alters the note (which would require court approval and notice to that borrower).
- **Where to send payments may change.** If I move from my pre-petition lockbox to a court-approved DIP lockbox, borrowers must be notified in writing with at least 30 days' lead time. AcreOS should track which borrowers received the notice, when, and which lockbox each one is current as of.
- **Borrowers cannot offset against me.** If a borrower owed me $40k on a note and I owed them $5k for, say, a survey deposit refund, the automatic stay prevents most setoff. AcreOS should flag any "credit-the-borrower-against-their-note" workflow with a stay-violation warning during the post-petition period.
- **Foreclosure I initiate against a defaulting borrower is not stayed.** The stay protects me from *my* creditors, not my borrowers from *me*. I can still send default notices and pursue foreclosure remedies on a deeply delinquent note. AcreOS should not block these workflows, but should add a court-aware audit annotation on every foreclosure step.

A single 80-line file with these five rules encoded as guardrails inside the existing communications and payments surfaces would prevent at least a dozen mistakes a year for any operator running this playbook.

---

## 8. Closing note — emergence

The day my plan of reorganization is confirmed and I emerge as a reorganized debtor, three things should happen in AcreOS automatically: the petition-date marker becomes an emergence-date marker, the period locks roll off (with the locked snapshots permanently archived for the seven-year retention window the court requires), and the external-oversight roles have a sunset workflow — trustee access revokes on emergence date, DIP-lender access converts to whatever exit-financing arrangement is in the confirmed plan, creditors'-committee access terminates. Today none of those workflows exist because none of the predecessors do.

Build them as a set, not as a feature. The reorganization arc has a beginning (petition), a middle (operating under court oversight), and an end (emergence or conversion to Chapter 7), and AcreOS should know about all three. Don't treat Chapter 11 as a flag you flip on and forget. Treat it as a temporary mode the org enters, operates within, and exits — the way a delivery truck switches into low gear up a hill and back into fifth on the descent. Same engine. Different governance.

The cohort of operators who will need this in 2026-2027 is not small. The cohort who will lose their AcreOS account because the system couldn't survive their reorganization is also not small. Pick the better outcome. I'd rather emerge from Chapter 11 still on AcreOS than emerge having been forced to migrate my entire book of business to QuickBooks plus three Excels because the platform didn't speak my new language. Right now it doesn't speak it. It can. Six weeks of focused work.

That's my audit. Take it for what it's worth from someone whose business is currently teaching her, in real time and at considerable expense, exactly what software she wishes she'd had on the day she filed.
