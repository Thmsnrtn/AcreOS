# Hilda Rainey — Year-End CPA Closing-Month Audit

**Persona:** Hilda Rainey, 56, CPA, Cincinnati. Wendell's CPA, and CPA for 29 other Land Investor clients. Every January–March I close 30 sets of books, generate 30 stacks of 1098-INTs, file 30 Schedule Es, and reconcile 30 trust ledgers to QuickBooks Online. AcreOS is one of the systems my clients run; if it can't hand me a clean trial balance and a journal-entry export QBO will accept, I am in those books for ten extra hours per client.
**Wave:** 3 — year-end CPA lens.
**Date:** 2026-05-01 (closing-season-adjacent; my real season runs again in 8 months).
**Surfaces reviewed:** `server/services/bookkeeping.ts`, `server/routes-bookkeeping.ts`, `server/routes-elite-features.ts:530-650` (QBO + 1099 + portfolio), `server/services/costBasisTracker.ts`, `server/services/depreciationService.ts`, `shared/schema.ts:5934` (`trust_ledger`), `shared/schema.ts:10404` (`depreciation_schedules`), `client/src/pages/finance.tsx`.
**Predecessor audits read:** Zerah Hollingsworth (tax-attorney), Hassiba Akkari (GAAP revenue), Bartholomew Prescott (IRS audit-readiness).

I read all three. Zerah is right that the **forms** layer is theater. Hassiba is right that the **revenue** layer needs an immutable ledger. Bartholomew is right that the **audit packet** is an afternoon of curl. None of them are wrong. What none of them say loudly enough: when I sit at my desk on January 4 and ask the system "give me a trial balance for tax year 2025," AcreOS does not have one. There is no `chart_of_accounts` table. There is no debit/credit framing. There is no GL detail PDF. The "double-entry journal" comment in `bookkeeping.ts:458` is aspirational — `trust_ledger` is a single-sided running-balance table. **That is the gap that costs my clients money in February.**

---

## 1. One-line verdict

**AcreOS today is a payment-tracking app with a P&L view bolted on. It is not a general ledger.** The bones for tax-event capture exist (`trust_ledger`, `costBasis`, `depreciation_schedules`, `payments` with split P/I/late-fee), but there is no chart of accounts, no double-entry framing, no trial balance, no GL detail, and the QBO sync is a one-way `SalesReceipt` POST with no token refresh and no journal-entry export. **A two-week sprint can give me a trial balance, GL-PDF, IIF/QBO journal export, and a batched 1098-INT pipeline that doesn't kill Wendell's deal.** Without that sprint, I bill my Wendell-style clients an extra $2,000–$3,500 in January-March reconstruction, and I tell them to keep their separate QBO file as the system of record. That is exactly what AcreOS is trying to replace.

---

## 2. Trial balance — does not exist

A trial balance is the first artifact a CPA pulls on January 4. It lists every account in the chart of accounts with debit and credit balances summing to zero. Without it I cannot:

- Tie out cash to bank statements.
- Reconcile A/R (notes receivable) to the loan servicing ledger.
- Validate revenue lines against 1099 totals.
- Sign the engagement letter saying "books reviewed."

**What AcreOS has:** `trust_ledger` (single-column `amount` + running balance, no debit/credit, no account number), `generateProfitLoss` (`bookkeeping.ts:624`) which sums income and expense entry types into a P&L statement, and `getPortfolioAnnualSummary` (one-line interest/principal/late-fee totals).

**What's missing:**

1. **No chart of accounts.** Every entry in `trust_ledger` carries an `entryType` text token (`income_note_payment_interest`, `expense_acquisition`, etc.). That is a kind of pseudo-account, but it has no account number, no parent, no GAAP classification (Asset/Liability/Equity/Revenue/Expense), no QBO mapping. I cannot post `income_note_payment_interest` to QBO without manually telling QBO it is account `4100 — Interest Income` every January.
2. **No debit/credit fields.** `trust_ledger.amount` carries a sign — positive = income, negative = expense. That is single-entry bookkeeping. A real journal entry has at least two lines (Dr Cash 1000 / Cr Interest Income 1000) summing to zero. Without paired entries, I cannot prove the books balance, cannot post to QBO as a journal, and cannot answer "where is the offset to that interest income?" The answer should be Cash or Notes Receivable; today it is implied by the running balance and nowhere documented.
3. **No A/R reconciliation.** Notes receivable should appear as an asset (Dr Notes Receivable 80,000 at origination; Cr each month as principal is paid). `trust_ledger` records `income_note_payment_principal` as positive but never models the contra entry against the receivable. The asset balance on the balance sheet is implicit in `notes.currentBalance`, which is updated by the payments processor — outside the ledger.
4. **No balance sheet at all.** `generateProfitLoss` exists. There is no `generateBalanceSheet`. With seller financing being 60–80% of a Land Investor's balance sheet, this is the load-bearing wall.

**Fix (Day 1–2 of sprint):** Add `chart_of_accounts` (id, orgId, account_number, name, account_type [`asset`|`liability`|`equity`|`revenue`|`expense`], parent_id, qbo_account_id) seeded with a Land-Investor-default COA (1010 Cash, 1200 Notes Receivable, 1500 Land Inventory, 1700 Accumulated Depreciation, 2100 Customer Deposits, 4100 Interest Income, 4200 Land Sale Revenue, 5000 COGS — Land, 6100 Marketing, 6200 Legal, 6300 Recording, 6400 Property Taxes, 6500 Depreciation Expense). Add `journal_entries` (id, orgId, posting_date, source_type, source_id, memo) and `journal_entry_lines` (id, je_id, account_id, debit_cents, credit_cents, note_id, property_id, deal_id) with a CHECK constraint on each JE that `SUM(debit) = SUM(credit)`. Backfill from `trust_ledger` + `payments` + `costBasis` adjustments + `depreciation_schedules`. Trial balance is then `SELECT account_number, SUM(debit), SUM(credit), SUM(debit)-SUM(credit) FROM journal_entry_lines WHERE posting_date <= :asOf GROUP BY 1`.

---

## 3. GL-detail PDF — also does not exist

When the IRS or my reviewer asks "show me every entry that landed in 4100 Interest Income in 2025," I need a printable General Ledger detail report: account header, then every transaction in date order with date, JE number, source document reference, memo, debit, credit, running balance per account.

**What AcreOS has:** A P&L statement endpoint that returns aggregate `breakdown` per `entryType`. That's a summary, not a GL.

**What's missing:** literally everything below the summary number. There is no per-account drill-down endpoint, no PDF, no source-document hyperlink. If I dispute a $4,200 interest figure I have no path from "the number on the P&L" to "the seven payments that produced it" without writing SQL against `trust_ledger`.

**Fix (Day 3):** `GET /api/bookkeeping/general-ledger?from=&to=&accountId=&format=pdf` returning per-account transaction listings with running balance. Reuse the same data that powers the trial balance. Server-side render via the existing PDF stack (already used for portfolio summary at `routes-platform-features.ts:25`).

---

## 4. Journal-entry export to QBO — currently a `SalesReceipt` POST, which is wrong

`bookkeeping.ts:300-382` (`syncPaymentsToQbo`) creates QBO **SalesReceipt** objects for every payment with non-zero interest. This is wrong on three axes:

1. **A SalesReceipt is for cash sales of goods/services.** A note-interest payment is interest income on a financial asset. The correct QBO posting is a **JournalEntry** debiting Bank/Undeposited Funds and crediting Interest Income (and Notes Receivable for the principal portion). Booking interest as a SalesReceipt ties the income to a "Customer" record (the borrower), inflates customer revenue figures, and breaks QBO's 1099 vendor-tracking workflow because the borrower is now ambiguously a customer-with-revenue.
2. **It double-books with whatever QBO bank-feed is doing.** If the org has Stripe→bank→QBO automatic feed, the cash side is already imported as a Deposit. AcreOS posting a SalesReceipt creates a phantom second deposit. Every reconciliation in March is now wrong by 2× interest.
3. **There is no token refresh.** `getQboOAuthUrl` (line 388) initiates OAuth but I cannot find the callback handler in the codebase, and `syncPaymentsToQbo` reads `accessToken` from `organizationIntegrations.credentials` with no refresh logic. QBO access tokens last 1 hour. Refresh tokens last 100 days. After 60 minutes of idle, the next sync silently 401s and `errors++`. After 100 days the integration is dead and the user has to re-OAuth — and there is no UI surface that says "your QBO connection expired."

**Fix (Day 4–5):**

- Replace `syncPaymentsToQbo` with `syncJournalEntriesToQbo` that POSTs to `/journalentry`. For each AcreOS journal entry, map source account_id → QBO account_id (via `chart_of_accounts.qbo_account_id`) and post a balanced JournalEntry. QBO accepts up to 30 lines per JE; batch by date if needed.
- Add `POST /api/integrations/qbo/callback` with token-exchange (`grant_type=authorization_code`) and persist `expires_at`. Add a refresh job that runs at `expires_at - 5min` using the refresh token; on refresh failure mark integration `disconnected` and surface a banner.
- Add a "Test sync" button that posts ONE JE for last month, lets the founder eyeball the QBO register, and roll back if wrong.
- Provide a CSV/IIF export as a **manual fallback**: `GET /api/bookkeeping/journal-export?year=2025&format=iif|csv|qbo-jc` — every CPA I know wants this when the OAuth pipe breaks at 11pm on January 30. IIF is QuickBooks Desktop legacy but is universally accepted; CSV with QBO-friendly column names imports into QBO via `Banking > Import Data > Journal Entries`.

---

## 5. Basis schedule export — partial; needs a CPA-shape

Zerah covered the engine quality. My narrower lens: when I ask for "the basis schedule for the 2025 tax return," I want one CSV per entity with the columns I actually paste into Lacerte / UltraTax / Drake:

| Property | Acquired | Original Basis | Capital Improvements YTD | Depreciation YTD | Adjusted Basis 12/31 | Held > 1 yr | Disposed Date | Sale Price | Realized Gain/Loss | § 1250 Recapture | LTCG Portion |
|---|---|---|---|---|---|---|---|---|---|---|---|

**What AcreOS gives me today:** `GET /tax-optimization/cost-basis/:propertyId` — one property at a time, JSON payload, no recapture split, no 1-year flag derived. I have to write a loop in Python over `propertyIds` (which I have to get from a separate `/api/export/properties` call), then fight JSON-to-CSV.

**Fix (Day 6):** `GET /api/bookkeeping/basis-schedule?year=2025&format=csv` — one row per property the org owned at any point during the year, with the columns above. Recapture split per Zerah §3a item 2. Adds maybe 60 lines of code to `costBasisTracker.ts`.

---

## 6. Depreciation schedule — Form 4562 worksheet

The depreciation engine is Zerah-confirmed solid for 27.5/39/15/5/7-year MACRS straight-line. What I need at year-end is the Form 4562 worksheet — Part III (MACRS depreciation), columns (a) through (g), grouped by recovery period, summing to one annual depreciation total per entity.

**What's missing:** The roll-up by entity. `depreciationSchedules` is per-property. There is no `getEntityDepreciationSchedule(orgId, year)` that produces the Form 4562 shape. Zerah flagged this at §3b item 6.

**Fix (Day 7):** `GET /api/bookkeeping/depreciation-schedule?year=2025&format=csv|pdf` — group by recovery period, total per group, total at the bottom. Match Form 4562 line numbers in the column headers so I can paste straight into the prep software.

Secondary: the client-side `depreciation-calculator.tsx` runs a different (looser) MACRS model than the server engine (Zerah §3b item 5). Pick the server engine. Delete the client model. I have already had two clients hand me numbers from the client calculator that did not match the server schedule.

---

## 7. 1098-INT batch — Wendell's deal-killer, and rightly so

Zerah covered this exhaustively. My CPA-specific addition: **the workflow I run on January 28 for a 30-borrower client is not 30 portal logins.** I need:

1. A founder/CPA-role endpoint `POST /api/founder/1098/batch?taxYear=2025` returning a ZIP of server-rendered PDFs (Bartholomew §item 5; Zerah §2 item 1). Filename `1098_<year>_<noteId>_<borrowerLastName>.pdf`.
2. A pre-flight CSV listing every note that *would* generate a 1098 with a column for each blocker: `missing_borrower_tin`, `missing_lender_ein`, `missing_jan1_balance`, `missing_property_address`, `interest_under_600`. I cannot file a stack with 6 blanks in the recipient TIN box; I want one screen that tells me which 6 to fix.
3. A `tax_form_issuances` table (Zerah §2 item 10) storing `(orgId, borrowerId, formType, taxYear, generatedAt, pdfHash, sentAt, sentMethod)`. When a borrower disputes a 1098 in March I need an immutable record of what was sent.
4. **Form 1096 cover** for paper filing OR an IRIS / FIRE e-file path. Paper template is a one-day add. E-file is a separate two-week build and probably not in scope for this sprint.
5. **Box 2 (outstanding mortgage principal as of Jan 1)** computed from the payments ledger. Today's endpoint returns `principalBalance` (current). Wrong by 12 months.
6. **Box 8 (property address)** pulled from `notes.propertyId → properties.address`. The data is there; the 1098 generator does not pull it.
7. **Borrower TIN field on `leads`** (or a borrowers-specific table) collected during onboarding. Without TIN, every 1098 is incomplete and the CPA owns 24% backup withholding under § 3406 that should have been the operator's problem.

This is six items but it is one Day 8 of work, with item 7 carved out as a separate schema migration. **Wendell will not stay on AcreOS without items 1–4.**

---

## 8. Closing-month CPA workflow — what actually happens January 4–March 15

Walk-through of the season, with what AcreOS does and does not give me:

| Step | What I do | AcreOS today | What I need |
|---|---|---|---|
| **Jan 4** — kickoff. Pull TB, AR aging, depreciation, year-end balance sheet, GL detail | Pull `/api/finance/portfolio-summary`. No TB, no BS, no GL detail. | I write SQL. Or call the founder. | Trial balance + balance sheet + GL detail PDF |
| **Jan 8** — confirm 1098 totals match interest-income line | Two-step: `bookkeeping/annual-interest-report` for total, then per-note. Numbers reconcile but exposed at different endpoints. | Inline in TB GL detail for account 4100 |
| **Jan 15** — print 1098-INT package for borrowers (postmark by Jan 31) | Per-note JSON in borrower portal only. | Server-side batch ZIP (§7 above) |
| **Jan 20** — file 1099-NEC for contractors (vendors, mailers, attorneys) | **Missing.** No vendor table, no W-9 surface, no 1099-NEC generator. | Per Zerah §6 |
| **Jan 25** — depreciation schedule for entity | Per-property API only; no entity roll-up | Form 4562 worksheet (§6) |
| **Feb 1** — reconcile QBO ↔ AcreOS month-by-month | QBO sync is one-way SalesReceipt POST, breaks AR; no reconciliation report | Two-way reconcile + JE export (§4) |
| **Feb 10** — 1099-INT to investors (private money lenders we paid > $10) | **Missing.** Per Zerah §6. | 1099-INT generation path |
| **Feb 20** — Schedule E rental income summary (per-property gross, expenses, depreciation) | **Missing.** Per Zerah §6. | Schedule E worksheet endpoint |
| **Mar 1** — basis schedule + Schedule D / Form 8949 for dispositions | Cost basis exists per-property, no entity export, no 8949 shape | Day 6 sprint output |
| **Mar 10** — installment sale reporting (Form 6252) for seller-financed dispositions | **Missing.** | Form 6252 worksheet — gross profit %, contract price, payments received, recognized gain |
| **Mar 15** — 1065 / 1120-S due for partnerships and S-corps | K-1 absent (Zerah §5) | Out of sprint scope; flag for Q2 |
| **Apr 15** — individual 1040 + Schedule E + 4562 + 8949 + 6252 | Aggregate from above | Aggregate above |

Two missing items hurt me most as a CPA, in addition to Zerah's list: **Form 6252 installment-sale worksheet** (for every seller-financed deal that closed in the year, I need gross profit %, contract price, payments received, principal vs. interest split — AcreOS has every input but emits no worksheet) and **Schedule E rental income summary** for any held parcel that produces rents.

---

## 9. Schedule of notes receivable + interest income — the year-end report I most often want

Specific to Wendell-style portfolios. I need one PDF, per entity, per year, with:

**Header section**
- Entity name, EIN, tax year, total notes outstanding, total face value at 1/1 and 12/31, weighted average rate, weighted average remaining term.

**Per-note rows (one note per line)**
- Note ID, borrower name, borrower TIN (last 4), property address, origination date, original principal, rate, term, monthly P&I, principal balance 1/1, principal balance 12/31, principal received YTD, interest received YTD, late fees received YTD, days delinquent at 12/31, status (current/delinquent/forbearance/paid_off), 1098 issued (Y/N), 1098 amount.

**Totals row**
- Sum of original principal, sum of 1/1 balance, sum of 12/31 balance, sum of principal received, sum of interest received (= TOTAL on Schedule B Part I Line 1, "Interest Income" of the 1040), sum of late fees, count of notes 1098'd.

**Footnote**
- "Of the $X total interest income, $Y is from notes acquired at discount; refer to OID accretion schedule" — when Zerah's OID work lands.

**What AcreOS has:** the inputs. `notes` + `payments` + `leads` + `properties`. The summing logic in `generateAnnualInterestReport`. **What it does not have:** the report. There is no PDF endpoint that produces this. Adding it is half a day on top of the trial balance work.

**Fix (Day 9):** `GET /api/bookkeeping/notes-receivable-schedule?year=2025&format=pdf|csv`. This is the report Wendell hands me without me asking. AcreOS should be the system that generates it.

---

## 10. Top 10 year-end CPA gaps, ranked

By "minutes of CPA time saved per client per year":

1. **No trial balance / balance sheet / GL detail** — I rebuild the TB by hand. ~3 hours per client. **Ship the COA + journal-entry tables (§2) first.**
2. **QBO sync uses SalesReceipt and doesn't refresh tokens** — every January I disconnect QBO and rebuild the year manually. ~5 hours per client. **Switch to JournalEntry + add OAuth refresh (§4).**
3. **No 1098-INT batch + no `tax_form_issuances` audit trail** — Wendell will leave the platform if this stays half-built (Zerah's words; mine too). ~1 hour per client January 25–31. **Server-side batch (§7).**
4. **No notes-receivable + interest-income annual schedule** — I rebuild this in Excel from raw payments. ~90 min per client. **PDF endpoint (§9).**
5. **No basis schedule export in CPA shape (§1245/§1250 split, recapture)** — I patch in the recapture math myself. ~45 min per disposition. **Day 6 sprint.**
6. **No Form 4562 worksheet roll-up** — I aggregate per-property numbers into the form. ~30 min per entity. **Day 7 sprint.**
7. **No Form 6252 installment-sale worksheet** — every seller-financed sale needs this; I do it from scratch in Excel. ~45 min per disposition. **Add to Day 6 work.**
8. **No 1099-NEC / 1099-MISC / 1099-INT for non-borrower payees** — covered by Zerah §6. Without it, my client may be hit with backup-withholding liability or §6721 penalties.
9. **No Schedule E rental income summary** — for any parcel that produced rents, I need gross / expenses / depreciation by property. Half-day add.
10. **No legal-hold or read-only "CPA" role** — Bartholomew's P0. Without it I either get a viewer login (sees marketing PII I shouldn't see) or a CSV dump and lose the audit trail.

---

## 11. Two-week sprint — closing-month foundation

Two engineers, parallelizable. ROI-ranked. Builds on (and does not duplicate) Zerah's and Hassiba's sprints.

### Week 1 — the GL

| Day | Task | Output |
|---|---|---|
| 1 | Schema: `chart_of_accounts`, `journal_entries`, `journal_entry_lines` (CHECK Σdr=Σcr). Seed default Land-Investor COA. | DDL + drizzle types |
| 2 | Migration: replay `trust_ledger` + `payments` (with implicit cash/AR offsets) + `costBasis` adjustments + `depreciation_schedules` into balanced JEs. Keep `trust_ledger` writable for one release behind a feature flag. | Backfilled GL |
| 3 | `GET /api/bookkeeping/trial-balance?asOf=` and `/general-ledger?from=&to=&accountId=&format=pdf`. Server-rendered PDFs via existing stack. | TB + GL detail |
| 4 | `GET /api/bookkeeping/balance-sheet?asOf=` (Assets / Liabilities / Equity). | BS report |
| 5 | `GET /api/bookkeeping/journal-export?year=&format=iif\|csv\|qbo` — the offline fallback CPAs actually use. | Manual export path |

### Week 2 — QBO + tax forms

| Day | Task | Output |
|---|---|---|
| 6 | Replace `syncPaymentsToQbo` with `syncJournalEntriesToQbo` posting QBO `JournalEntry`. Map account_id → qbo_account_id via COA. Add account-mapping UI. | Correct QBO posting |
| 6 | OAuth callback handler `/api/integrations/qbo/callback`, refresh-token job, "QBO connection expired" banner. | Durable QBO link |
| 7 | Server-side 1098-INT batch ZIP with pre-flight CSV. `tax_form_issuances` audit table. Form 1096 paper template. | Wendell-blocker fix |
| 8 | `GET /api/bookkeeping/notes-receivable-schedule?year=&format=pdf\|csv`. | The report Wendell wants |
| 9 | Basis schedule export (Day-6 of Zerah's sprint) + Form 4562 entity roll-up + Form 6252 installment worksheet. | CPA-shape exports |
| 10 | CPA / auditor read-only role (Bartholomew §item 4) + view logging. Legal-hold flag freezing retention purges. Documentation: `/docs/runbooks/year-end-cpa-handoff.md` describing the artifacts and the closing-month flow. | Production-grade CPA seat |

**End of week 2 deliverable:** I can run AcreOS as the system of record for a 30-note Wendell-style client. I get a TB I trust, a GL I can drill into, a JE export QBO accepts, a 1098 batch that doesn't make me a paralegal, and a notes-receivable schedule I print and sign. Today I get a P&L and a SalesReceipt-shaped QBO sync that double-books the bank feed.

---

## 12. Out of scope for this sprint, flagged for Q2

- K-1 generation for syndicates (Zerah §5) — separate two-week build.
- 1031 exchange persistence (Zerah §4) — separate sprint.
- W-9 collection workflow + backup withholding (Zerah §6/§7) — adjacent but tax-attorney-led.
- ASC 606 deferred revenue + subscription event ledger (Hassiba) — that's the SaaS-side books, separate from the operator-side books I close.
- Cost segregation, § 704(b) special allocations, foreign-owner reporting — out of scope indefinitely; attorney-in-the-loop product.

---

## Bottom line

AcreOS today is **70% of the way to a real bookkeeping product on the inputs, 20% of the way on the outputs, and 0% of the way on the GL.** The payment splits are right. The interest math is right. The depreciation engine is honest. But I cannot give my reviewer a trial balance, I cannot post a journal entry to QBO, and I cannot batch 1098s without scripting a curl loop. Two weeks of focused work produce a system I would let a client run as their books-of-record. Without those two weeks, I tell my Wendells to keep QBO as the system of record and treat AcreOS as a side ledger we reconcile to. That is a workable answer for them and a hollow win for AcreOS.

Get the GL right. The forms layer follows naturally. Wendell stays.

— Hilda Rainey, CPA
