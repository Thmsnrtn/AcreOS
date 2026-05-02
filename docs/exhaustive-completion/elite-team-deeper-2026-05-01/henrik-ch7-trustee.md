# Henrik Rosedale — AcreOS through a Chapter 7 trustee lens

I'm Henrik. Fifty-eight. Twenty-two years on the panel trustee list in the Northern District. Constance, who you've already heard from, was Chapter 11 — she's still her own debtor in possession, still running her business with court permission. I'm the other phone call. When a Land Investor under AcreOS files Chapter 7, control of the estate transfers to me on the petition date. The debtor still owns nothing of consequence; what they had on the morning of filing now belongs to a bankruptcy estate whose only fiduciary is me. My job is to liquidate it, distribute proceeds in priority order under §726, and close the case.

I came at AcreOS asking the inverse of Constance's question: **can a Chapter 7 trustee take possession of an AcreOS-run business overnight, lock the debtor out without losing the data, monetize the notes-receivable book, and produce a §704 final report — without spending the first three weeks reverse-engineering a SaaS app written for the person I just displaced?** The answer today is no, and the gap is more architectural than Constance's was. Chapter 11 needs a *mode* on top of single-operator AcreOS. Chapter 7 needs a *handoff* — a moment where the keys change hands, the debtor stops being principal, and the trustee becomes principal. Nothing in AcreOS contemplates that handoff.

---

## 1. Thirty-second verdict

The same primitives Constance praised work for me too: per-payment ledger accuracy (`server/services/bookkeeping.ts`), real audit log with before/after and IP (`shared/schema.ts:4149`), org-scoped isolation, soft-delete on the canonical entities (`shared/schema.ts:382`, `692`, `798`, `903`), and a real disposition pipeline (`server/routes-disposition.ts`) that I can co-opt for liquidation sales. AcreOS holds the right shape of data for a §704 trustee — it just doesn't know I exist.

What's broken specifically for Chapter 7, distinct from Constance's Chapter 11 list:

- **Owner-account takeover is impossible without compromising authentication.** The org's owner role (`shared/schema.ts:124`) is the only role with full surface visibility. To take possession I either get the debtor to hand me their Clerk credentials (which violates Clerk's TOS and the trustee's duty of impartiality) or I rebuild access org-by-org. Neither is acceptable in a 90-day case.
- **No "estate freeze" mode.** When I'm appointed, I need every mutation surface in AcreOS to halt for the debtor and route to me. AcreOS has no concept of "the principal of this org has changed and the prior principal is now read-only on their own data."
- **Soft delete is reversible by the same actor who deleted it.** A debtor under §727 discharge-objection scrutiny can soft-delete a payment, a deal, a communication. It's recoverable, but only by another owner-role user, and the audit trail of *why* it was deleted is thin. For preference-period and fraudulent-transfer review under §547 and §548 this is a real gap.
- **No look-back window primitives.** §547 looks back 90 days for ordinary creditors and one year for insiders. §548 looks back two years for actual or constructive fraudulent transfers. I need surfaces that say "show me every transfer of value out of this org during these windows, classified by counterparty type, with the corresponding counterparty insider-status." Today I write SQL.
- **No estate vs. exempt-property distinction on parcels and notes.** Some property of the debtor is exempt under state law (homestead, tools of the trade, retirement accounts) and not part of the estate I administer. AcreOS treats everything in the org as one undifferentiated bag.
- **The disposition pipeline assumes seller is willing.** A trustee §363 sale is a court-supervised sale of the estate's interest in property, free and clear of liens, with notice to creditors and a 21-day overbid window. Today's disposition module assumes a normal seller-and-buyer arm's length transaction.

Roughly five-week build for a focused engineer if and only if Constance's six-week Chapter 11 build has shipped first. Without that foundation it's eleven weeks because I'd be re-laying the role and petition-date primitives from scratch. **Build the Chapter 11 substrate first; my Chapter 7 mode rides on top of it as the conversion path.**

---

## 2. Day-of-appointment walkthrough — Tuesday

The case got assigned to me at 4:47 PM Monday. By Tuesday 9 AM the §341 meeting is on the calendar in 28 days and I have a fiduciary duty to preserve the estate. Walk with me.

**Tuesday 6 AM.** I email the debtor's counsel with my appointment order and a turnover demand for "all books and records of the debtor including but not limited to the AcreOS account at [organization slug]." Counsel replies that they'll have the debtor send me a CSV export. **That's the wrong answer for me and AcreOS should make it the wrong answer for everybody.** I do not want a CSV. CSVs are a snapshot, they're trivially edited, and the live system is the §704(a)(8) record I have to administer. I want to be added as the controlling principal of the org with the debtor demoted to a read-only "former principal" role. AcreOS today has no surface for that. **Build:** trustee turnover wizard. Debtor's owner uploads the trustee appointment order PDF, the system creates a `trustee_takeover` request, the trustee accepts via a secure Clerk-mediated invite, and on acceptance the debtor's role is automatically demoted from `owner` to `former_principal_readonly` and the trustee's role is promoted to `owner_trustee`. Audit-stamped. Reversible only by court order uploaded into the same surface.

**Tuesday 8 AM.** First thing I want to see is the §521(a)(1) schedules the debtor filed and reconcile them against the live system. The debtor's Schedule A/B claims notes-receivable principal of $1.84M. The live AcreOS portfolio P&L (`routes-portfolio-pnl.ts`) shows current note balances of $2.07M. That's a $230k delta and the debtor's counsel will tell me it's "stale data on the schedules." Maybe. Or maybe the debtor's Schedule A/B understated the estate's assets to keep the means-test math friendly. **Build:** schedule-reconciliation surface. Trustee uploads the debtor's filed schedules (they're public PACER documents), AcreOS does a line-item diff against the live data as of petition date, and surfaces every variance over a configurable threshold. This is the single highest-value §704 audit tool I could ask for.

**Tuesday 10 AM.** Preference-period transactions under §547. Look-back is 90 days for arms-length creditors (so back to roughly January 27 in this hypothetical), and one year for insiders. I need every dollar that left the estate during that window: principal payments to lenders, repayment of intercompany loans, owner draws (Constance flagged these aren't a first-class entity — fix that), payments to family-member vendors, payments to entities the debtor controls. **AcreOS has every disbursement in the bookkeeping ledger but has no insider-status flag on counterparties.** Build a `counterparty_insider_status` field on the contacts/vendors table — values: `not_insider`, `insider_family`, `insider_affiliate`, `insider_officer_director`, `unknown_pending_review`. Surface a "preference review" report at /trustee/preferences that takes the petition date, computes the 90-day and 1-year windows, and groups disbursements by insider-status with running totals. Without this I'm back to SQL and Excel, which is exactly the workflow that loses cases for trustees who don't catch a $40k preference because it was buried in a vendor named after the insider's holding company.

**Tuesday 11 AM.** §548 fraudulent-transfer review. Two-year look-back. I'm hunting for: (a) actual fraud — transfers made with intent to hinder, delay, or defraud creditors, and (b) constructive fraud — transfers for less than reasonably equivalent value while the debtor was insolvent or rendered insolvent by the transfer. The honest version of (b) is the debtor selling a parcel to their cousin for $40k when the AVM said $145k. **AcreOS has the AVM (`server/routes-avm.ts`) and the actual-sale-price in the deal record.** Build a "below-market disposition" report: every closed disposition during the §548 look-back where actual-sale-price was less than 70% of contemporaneous AVM, joined to counterparty insider-status. That's a 90-line SQL query exposed as a trustee surface. It will find me money in roughly one out of every four cases I take.

**Tuesday 1 PM.** Automatic stay enforcement. §362 stays virtually all collection activity against the debtor. AcreOS's communications surface (`routes-communications.ts`) is a sending tool. From the moment of my appointment, every outgoing communication on behalf of the debtor needs my approval — or, more realistically, every outgoing communication needs to be classified as either (a) ordinary-course operations of the estate which I authorize as a class, or (b) anything else, which I personally review. Today the system has no "trustee approval queue" for outbound comms. Build: in `owner_trustee` mode, a comms-approval queue with three buckets — auto-approved (template payment-receipt confirmations to active borrowers), trustee-review (anything else), and blocked (any outbound communication to a creditor of the debtor, which is a stay-violation risk on its face).

**Tuesday 3 PM.** Notes-receivable liquidation strategy. The estate has roughly 340 notes. I have three options: (1) collect them in the ordinary course over 5-7 years (rare for Chapter 7 — usually closes within 18 months), (2) sell the book in bulk to a note buyer at probably 65-72¢ on the dollar, or (3) sell tranches segmented by quality. The disposition module assumes I'm selling parcels. I'm selling the *receivable*. That's a different asset class, a different counterparty universe (note-buying funds, not retail land buyers), and a different documentation pack — I need an assignment of mortgage, an allonge, the original note (or a lost-note affidavit), the loan payment history, and a pay-off statement, not a parcel listing photo. **Build:** notes-receivable §363 sale surface. Bundle creator that lets me select notes by criteria (state, performing/non-performing, principal range, originated-date range), generate the documentation pack per note as a single zip, and a counterparty list seeded with note-buyer funds I can email an offering through.

**Tuesday 4 PM.** I want to identify exempt property. The debtor in this hypothetical is in Arizona; under A.R.S. §33-1101 the homestead exemption is $400k on a primary residence, tools-of-the-trade exemption tops out at $5k, and certain retirement accounts are fully exempt. The debtor's residence parcel is in AcreOS as a property in the org's portfolio because the debtor used a HELOC against it as acquisition capital. **AcreOS can't tell me which parcel is the homestead.** No flag. No surface for the debtor to pre-mark exempt property at filing. I have to ask counsel which parcel is the residence and which equipment is "necessary tools of the trade" and apply the exemption math by hand. Then I have to abandon the exempt property back to the debtor under §554 — meaning, formally release it from the estate. AcreOS should have an "abandon to debtor" action that mirrors a soft-delete from the estate's perspective but transfers the parcel to a recovery org owned by the debtor post-discharge. None of this exists.

**Tuesday 5 PM.** §704(a)(8) final report prep. I'm 8 hours in. I close the laptop. Tomorrow is creditor-claim mailings, the day after is bank-account turnover, the day after that is the §341 meeting prep deck. The point is: AcreOS could be the system I run all of this from, or it could be the thing my paralegal exports CSVs out of for me to re-key into Best Case bankruptcy software. The first version costs the platform roughly five weeks of focused work and earns the right to keep the ex-debtor's data on AcreOS through the entire case lifecycle, including conversions back to Chapter 11 (rare) and discharges (the more common end state).

---

## 3. The Chapter 7 trustee test — what passed, what failed

**Pass:**
- Audit log with before/after, actor, IP, UA (`shared/schema.ts:4149`) — this is the §704 evidentiary substrate
- Org-scoped isolation on every query — clean partition for the takeover
- Soft-delete on canonical entities (parcels, notes, contacts, deals) — I can recover what the debtor "deleted" in the run-up
- Note ledger accuracy at per-payment, per-allocation grain — exactly what a §363 note buyer's diligence pack requires
- Disposition pipeline (`server/routes-disposition.ts`) — repurposable for §363 estate sales
- Deal underwriting and AVM (`server/routes-avm.ts`) — the §548 below-market-transfer test
- Bookkeeping ledger (`server/services/bookkeeping.ts`) with categorized entries — preference review starts here

**Fail or Missing:**
- **No trustee-takeover handoff.** The single highest-leverage gap. Without it nothing else matters.
- **No `former_principal_readonly` or `owner_trustee` role.** Even if Constance's `external_oversight_role` enum ships, those roles are read-only and additive. A trustee role is *replacement* — it demotes the prior principal.
- **No counterparty insider-status flag.** Preference and fraudulent-transfer analysis collapses without this.
- **No look-back window primitives at the report layer.** 90-day, 1-year, 2-year windows are repeated parameters in trustee work; today they're hand-typed each time.
- **No estate-vs-exempt classification on assets.** The trustee administers estate property; exempt property goes back to the debtor. Today everything in the org looks identical.
- **No schedule-reconciliation surface.** Comparing the debtor's filed §521 schedules against the live system is the most efficient §704 audit step that exists; today there's no surface for it.
- **No §363-sale variant of the disposition pipeline.** Court approval order, 21-day overbid window, free-and-clear language, notice to creditors with claims — none of it modeled.
- **No notes-receivable bulk-sale documentation pack generator.** Per-note allonge, assignment of mortgage, payment history, payoff statement. Each individually exists; bundling for a note-buyer fund's diligence does not.
- **No automatic-stay outbound-comms gate.** A trustee-mode comms surface should require approval on anything outside ordinary-course estate operations.
- **No claim register.** Creditors file proofs of claim with the court. The trustee maintains a claims register, objects to claims that are duplicative or inflated, and ultimately distributes per §726 priority. Constance flagged a `proofs_of_claim` table for Chapter 11; for Chapter 7 the same table needs distribution-priority logic on top.
- **No §726 distribution waterfall.** Administrative expenses first, then priority claims (wages, taxes), then general unsecured, then subordinated, then equity. Different from Constance's reorganization waterfall — same skeleton, different rules.
- **Soft-delete by the debtor during the look-back window has no "frozen" guard.** Once I'm appointed, no entity should be soft-deletable — only soft-marked-disputed. The debtor's prior soft-deletes in the look-back window need a "review for §548 implications" flag.
- **No final-report export.** UST Form 4 (Trustee's Final Report) is the closing artifact. Auto-fillable from estate-administration data.
- **No abandonment-under-§554 workflow.** When the trustee determines property is burdensome or of inconsequential value, it is formally abandoned back to the debtor. AcreOS has soft-delete; it doesn't have "remove from estate, preserve title to debtor."
- **No turnover-of-books certificate.** §521(a)(4) requires the debtor to turn over books and records. AcreOS could produce a court-stamped certificate confirming turnover happened on a specific date with a cryptographic hash of the data state.

---

## 4. Per-surface friction (Chapter 7 lens)

**Org settings → Principal control.** Add a "trustee turnover" tile, gated behind upload of an appointment order PDF and a court-issued case number that matches the `organizations.case_number` Constance proposed. Once accepted, the prior owner is auto-demoted and a notice is emailed to every team member.

**`/portfolio` (existing dashboard).** In trustee mode, default the view to "as of petition date" and add a banner: "Estate administered by trustee Henrik Rosedale, appointed 2026-05-15, Case 26-04217-NDIN."

**`/notes` list view.** Add a bulk-select-and-package action that builds a §363 sale offering bundle: zip file with note PDF, payment history, payoff statement, allonge template, assignment of mortgage template, and a CSV summary.

**`/disposition` pipeline.** Add a §363 sale variant. Required fields: court approval order PDF, notice-to-creditors recipients (auto-populated from claim register), overbid procedures, sale hearing date.

**`/communications` outbound queue.** In trustee mode, every outbound is gated. Build three classifier rules: ordinary-course-borrower-comm (auto-approved), prior-creditor-of-debtor (blocked with stay-violation banner), other (manual review).

**`/audit-log`.** Add three saved filters: "preference window (90 days pre-petition)," "insider preference window (1 year pre-petition)," "fraudulent-transfer window (2 years pre-petition)." Each filter limits to disbursements and dispositions, joined to counterparty insider-status.

**`/team`.** In trustee mode, the prior debtor's team members are visible but cannot be invited, removed, or have roles changed by the prior owner — only by `owner_trustee`. Surface a banner explaining this to team members on first login post-takeover.

**`/legal/claims-register` (does not exist).** New surface. Upload proofs of claim received from the court, classify by priority (admin / priority / general unsecured / subordinated), reconcile against debtor's schedules, log objections, track distribution amount.

**`/legal/trustee-final-report` (does not exist).** New surface. Aggregates estate-administration data into UST Form 4 format. Includes total receipts, total disbursements by §726 class, professional fees, trustee compensation under §326, and remaining balance.

---

## 5. Data-model deltas required (additive to Constance's list)

- `organizations.bankruptcy_chapter` enum already proposed by Constance — Chapter 7 is the value `'7'`.
- `organizations.trustee_user_id` — fk to the appointed trustee's user record. Distinct from `owner_user_id` because in Chapter 7 they diverge.
- `organizations.principal_status` enum — `'pre_petition' | 'debtor_in_possession' | 'trustee_administered' | 'discharged' | 'dismissed'`.
- `organizations.estate_freeze_at` — timestamp. From this moment forward, mutations route through the trustee approval gate.
- New `counterparty_insider_status` field on `contacts` table — enum `'not_insider' | 'insider_family' | 'insider_affiliate' | 'insider_officer_director' | 'unknown_pending_review'`. Defaults to `unknown_pending_review` for any counterparty active during the look-back windows.
- New `asset_estate_status` field on `parcels` and `notes` tables — enum `'estate_property' | 'exempt_property' | 'abandoned' | 'sold_363' | 'surrendered'`.
- New table `trustee_takeover_requests` — appointment-order PDF, case number, requesting trustee user id, accepted-at, rejected-at, court-revocation-at.
- New table `claims_register` — claimant, claim amount, scheduled amount, priority class (`'admin' | 'priority_wages' | 'priority_taxes' | 'general_unsecured' | 'subordinated'`), status (`'allowed' | 'disputed' | 'expunged'`), distribution amount.
- New table `section_363_sales` — fk to dispositions, court approval order, notice-recipients-snapshot, overbid window start/end, sale hearing date, free-and-clear flag.
- New role enum value on memberships — `'owner_trustee'`, `'former_principal_readonly'`. Cannot coexist on the same org.
- New `mutation_freeze` flag on `audit_log` writes — once estate is frozen, every mutation gets stamped with `under_trustee_administration: true` for the §704 record.

---

## 6. What I would build first, after Constance's six weeks

Assume Constance's substrate has shipped: petition date, period locks, external-oversight roles, MOR exports, borrowing-base, audit hash export. From there, five weeks for Chapter 7 mode:

1. **Week 1.** Trustee turnover wizard end-to-end. `owner_trustee` and `former_principal_readonly` roles. Estate freeze flag wired through every mutation guard. This is the "keys change hands" foundation.
2. **Week 2.** Counterparty insider-status field on contacts. Backfill UI for the trustee to classify in bulk. Look-back window primitive. Preference review report (90-day and 1-year, grouped by insider-status).
3. **Week 3.** §548 fraudulent-transfer review report (below-market dispositions joined to insider-status). Schedule-reconciliation surface (debtor's filed §521 vs live data diff). Estate-vs-exempt classification on parcels and notes.
4. **Week 4.** §363 sale variant of disposition pipeline. Notes-receivable bulk-sale documentation-pack generator. Claim register surface with §726 priority classification.
5. **Week 5.** Automatic-stay outbound-comms gate in trustee mode. Trustee final report (UST Form 4) export. §726 distribution waterfall calculator.

End-state: a panel trustee can take over an AcreOS-run Chapter 7 case, administer the estate from the live system, run preference and fraudulent-transfer review without leaving the platform, conduct §363 sales of both parcels and the notes-receivable book, maintain the claims register, and file the trustee final report — all from inside AcreOS.

---

## 7. The handoff is the product

I want to underline this because it's the load-bearing insight from the Chapter 7 lens that I don't think Constance fully captured from her side. **Chapter 11 is a mode the debtor enters and exits while remaining principal. Chapter 7 is a transfer of principal.** Those are different software shapes. Constance's audit gave you the mode. Mine gives you the transfer. The transfer is harder because it touches identity, authentication, and the entire role model — not just the data filters.

The trustee turnover wizard has one subtlety that's worth getting right at the schema level. When the debtor's owner accepts the demotion — or when they refuse and counsel goes to court for a turnover order — the system has to record *which* path was taken because that distinction matters in subsequent §727 discharge proceedings. A debtor who voluntarily turned over the books is in a better posture than one who was compelled by court order. Capture both states on the `trustee_takeover_requests` row: `acceptance_method` enum (`'voluntary' | 'court_compelled' | 'pending'`) and `compelled_order_pdf` for the latter case. Three additional schema fields and the audit trail meets the §704 evidentiary bar.

The transfer is also where every consumer-facing SaaS today fails its users. QuickBooks doesn't have it; my paralegal still has to download QBO files from the debtor and re-import them into a fresh trustee instance, losing the audit trail in the process. Stripe doesn't have it; I have to email Stripe Trust & Safety with a court order and wait two weeks for them to manually reroute payouts to a trustee-controlled account. Salesforce doesn't have it; I have to file a court motion to compel the debtor to add me as a system administrator. **If AcreOS ships the trustee turnover wizard alone — even without all the §547 / §548 / §363 surfaces I listed above — it would be the only SaaS in the Land Investor stack that handles the moment of bankruptcy correctly.** That alone is worth shipping in a sprint. The rest is depth.

---

## 8. Closing note — discharge and dismissal

A Chapter 7 case ends one of three ways: discharge (debtor's eligible debts are wiped, trustee files final report, case closes), dismissal (case is thrown out, debtor is back where they started), or conversion (the rare Chapter 7 → Chapter 11 retrograde, more common Chapter 11 → Chapter 7 collapse). Each has implications for AcreOS state.

On **discharge**, the trustee role sunsets and the org dissolves — there's no debtor to return control to in any meaningful sense, because the business as a going concern is liquidated. AcreOS should preserve the case data for the seven-year retention window the court requires and then archive it. On **dismissal**, the trustee role sunsets and the prior owner is restored to `owner` (with a permanent annotation in the audit log that the case was filed and dismissed). On **conversion** from Chapter 11 to Chapter 7 — which is what brings me into a case Constance was previously running — Constance's `external_oversight_role` setup needs a graceful upgrade path to my `owner_trustee` setup. Don't model these as parallel tracks. Model them as states in the same lifecycle finite-state machine: pre_petition → debtor_in_possession → trustee_administered → discharged | dismissed.

The cohort of operators who will need a Chapter 7 trustee surface is smaller than Constance's Chapter 11 cohort — call it 3-5% of the distressed-leverage 2021-2022 acquisition population versus her 12-18%. But every operator who hits Chapter 7 hits it suddenly, and the platform that handles the moment of takeover with grace earns trust from every other operator who watches a peer go through it. Word travels fast in the Land Investor community when somebody loses their data the day they file. It travels equally fast when somebody doesn't.

Build the transfer. The rest follows.

That's my audit. I've done this for twenty-two years across roughly 2,400 cases and the software has never been on my side. AcreOS could be the first one that is.
