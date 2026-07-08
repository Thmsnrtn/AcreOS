# Phineas Rafferty — IRS Auditor Lens on AcreOS Records

**Auditor:** Phineas Rafferty, 51, Revenue Agent, IRS Small Business / Self-Employed (SB/SE) division. Cincinnati field office. 19 years on the job. Specializes in real estate, seller-financed installment sales, and Schedule E reconstructions.
**Subject:** Bartholomew Prescott — Land Investor, 31 active seller-financed notes, ~60 closed deals across TYs 2022–2024.
**Posture:** I do not care about AcreOS as a product. I care about whether the records it produces are **contemporaneous, complete, immutable, and reconcilable to a bank**. Everything below is filtered through that lens.
**Output:** What I would accept, what would raise my suspicion, and the IDR (Information Document Request) line items I would issue under Form 4564 if I sat down with Margaret next week.

---

## 1. What AcreOS Produces That I Would Accept

### Per-property acquisition/disposition trail
The `documentAnalysis` table stores deed-level structured data (grantor, grantee, legal description, recording info, consideration amount) with `fileUrl`, `fileHash`, and OCR confidence. If the recorded deed PDFs are retrievable and the hash verifies, that's primary evidence of basis-establishing events. I treat recorded-instrument PDFs the same way I treat HUD-1s and ALTA settlement statements — they are issued by a third party (the county recorder) so they are corroborated, not self-serving.

### Settlement fee audit log
The dedicated `fee_audit_log` table indexed by org, settlement, and createdAt is the right shape. Every fee mutation captured. If a closing cost shows up on the basis schedule, I can trace it to the exact settlement-line edit and the user who made it. **This is the cleanest piece of the system from my chair.**

### Per-note payment ledger
`/api/export/notes` exporting `originalPrincipal`, `currentBalance`, `interestRate`, payment history with dates is acceptable as a **starting point** for a Schedule B / Form 6252 reconstruction — provided it ties to bank deposits. I will always reconcile to bank: the AcreOS ledger is the taxpayer's books, not third-party evidence.

### 1098-INT generation logic
`routes-borrower.ts:770` sums `interestAmount` from completed payments where `paymentDate` falls inside the year. The arithmetic is auditable and the source ledger is the same one used to compute `currentBalance` — that internal consistency I appreciate. **Caveat below.**

### Audit log for org-level changes
`audit_log` with `before/after/fields/ipAddress/userAgent/metadata/createdAt` covers org changes, exports, and most CRUD on core entities. When it fires, it's IRS-grade. The problem is when it doesn't fire — see Section 2.

---

## 2. What Raises My Suspicion

### 2a. Mutable financial rows with conditional audit coverage
Bartholomew's own internal memo (Section 3 of the defendant memo) admits payments, notes, properties, and cost-basis adjustments are not soft-deleted, and that `routes-finance.ts`, `routes-borrower.ts`, and `routes-deals.ts` were "not found to call the audit logger directly." Translated to my language: **the books can be edited without a paper trail unless a route author remembered to write one.**

That alone shifts my burden-of-proof posture. I will assume the ledger is mutable until proven otherwise, and I will demand bank-statement reconciliation for **every** number on the return — not just the disputed ones. Audit scope expands.

### 2b. Cost basis is overwritten in place
`costBasisTracker.ts` does `db.update(costBasis)` and overwrites `currentBasis`. I asked Bartholomew on a hypothetical "what was your adjusted basis on 12/31/2023?" The answer he can produce is "what AcreOS currently believes it was on 12/31/2023" — not "what AcreOS reported on 12/31/2023." Those are different documents in my world. The first is reconstructed; the second is contemporaneous. **A reconstructed basis schedule is a yellow flag.** It does not disqualify, but it shifts evidentiary weight onto the underlying source documents (closing statements, capital improvement invoices).

### 2c. 1098-INTs were not actually issued — they were generated on demand
Borrower-portal-only PDF rendering with no batch founder workflow means I have no evidence the borrowers actually received 1098-INTs in January 2025 for TY 2024. The platform can produce a PDF today that says "issued 2025-01-31," but nothing proves transmittal. **IRC § 6050H requires the lender to furnish 1098 to the payer by January 31.** If Bartholomew didn't actually mail/email these, he owes a $290-per-form information return penalty (IRC § 6722) for each of 31 notes — that's $8,990 in penalties before we even discuss the underlying interest income.

I will ask for: send-receipts, postal-mailing logs, or borrower-portal access logs proving each borrower viewed their 1098. Absent those, I assess the § 6722 penalty.

### 2d. Basis schedule reconstructed from JSON exports
The `/api/export/backup` JSON bundle is described as "all org data." That is *the taxpayer's database dumped to disk*. It is not a source ledger in the third-party sense. The sequence "I exported JSON from my own system, then my CPA built a schedule from it" produces evidence whose integrity is no better than the underlying database. If I can't see that the database is append-only, the JSON dump inherits the mutability.

**Compare to a brokerage statement:** Schwab/Fidelity is third-party, signed, transmitted to IRS independently via 1099-B. AcreOS is not. So AcreOS-sourced schedules require corroboration with bank deposits and recorded deeds — every time.

### 2e. Retention purges run on a 60–90 day window for activity_log, agent_events, usage_events
This is the one that would make me lean forward. `server/jobs/dataRetention.ts` purges `activity_log` after 90 days. The three-year statute of limitations under § 6501(a) means I can audit TY 2022 right now — that's data from 36 months ago. **It's gone.** Six-year statute under § 6501(e)(1) for >25% omission of gross income? Even more gone. Fraud has no statute of limitations under § 6501(c)(1) — and the records that would prove or disprove fraud have been deleted by a cron job.

If the taxpayer engaged a "legal hold" only after receiving the CP2000, that does not retroactively un-purge the 2022 activity log. **Spoliation arguments become available to me.** I won't lead with them, but they're in the toolbox.

### 2f. Document integrity is URL-based, not content-addressed
`documentAnalysis.fileUrl` points at object storage. If the URL rotates, the bytes change, or the bucket gets re-keyed, the hash on file says one thing and the bytes say another. This is a chain-of-custody gap. I would normally request the original recorded deed from the county clerk to corroborate — but that's an extra step that gets billed to the taxpayer's CPA at $385/hr, which is the taxpayer's problem, not mine.

### 2g. No evidence of double-entry or bank reconciliation
AcreOS appears to be a single-entry system. Payments come in; balances reduce. There is no T-account, no trial balance, no monthly reconciliation to bank. **GAAP this is not.** That's not disqualifying for a small Schedule E filer — most small landlords use single-entry — but the burden is on the taxpayer to reconcile his books to his bank monthly. If Bartholomew can't produce contemporaneous bank reconciliations, his books are not "adequate records" under Treas. Reg. § 1.6001-1(a) and I am within my discretion to reconstruct using the bank-deposit method.

### 2h. Founder-impersonates-borrower endpoint is a chain-of-custody nightmare
The defendant memo describes pulling 1098 data by calling `/api/borrower/.../statements?type=1098&year=2024` "via curl with founder admin token (workable but undocumented)." That phrase alone is a finding. If the founder can authenticate as any borrower for the purpose of generating that borrower's tax statement, then there is no separation between *what the lender told the borrower* and *what the lender currently believes it told the borrower*. From an IRS evidentiary standpoint, the 1098 is supposed to be a frozen, transmitted document. An on-demand re-render by the lender's admin token is not that.

### 2i. AI-decision provenance overlaps the audit log
`founderAuditService` writes "decision events" with AI confidence and executed-vs-deferred status. That is a fascinating feature for the founder's own QA — but in an audit context it is **noise that I will subpoena anyway**. If AI agents wrote financial entries (auto-categorized payments, auto-classified closing costs as basis vs expense), I need to see the prompt, the model, and the human override. I will ask for it. If the answer is "we don't retain prompts," that is itself a finding under § 6001.

---

## 3. Form 4564 IDR — What I Would Issue

These are the line items that would actually appear on the IDR I hand to Margaret. They map to specific AcreOS data exports because I want her to be efficient — I am not adversarial, just thorough.

1. **Bank statements** for all business accounts, all 36 months. *(Not from AcreOS — this is the reconciliation source.)*
2. **Per-note amortization schedule** as of the date of each TY year-end (12/31/2022, 12/31/2023, 12/31/2024). I want **principal/interest split per payment** so I can verify Form 6252 installment-sale reporting matches the actual note ledger. AcreOS export of `notes.csv` with payment children is acceptable IF reconciled to bank.
3. **Form 6252 worksheets** for every installment sale, all years. Gross profit percentage, contract price, payments received in year. AcreOS does not appear to produce this — Margaret will derive it from notes.csv. **I will check her arithmetic.**
4. **Copies of every 1098-INT issued** for TYs 2022, 2023, 2024 — *plus proof of furnishing to payer by January 31 of the following year.* This is the § 6722 trap.
5. **Schedule of capital improvements per property**, with **paid invoices and proof of payment** (cancelled checks or bank debits). AcreOS `costBasis.adjustments` JSON is the index; the underlying invoices are the evidence. The JSON alone does not prove the improvement happened.
6. **Depreciation schedules** with method, recovery period, in-service date, prior depreciation, current-year depreciation, **and Form 4562 for the year placed in service.** I want to see the original election. AcreOS `depreciationSchedules` table is fine for prior-year roll-forward but not for the original election.
7. **Closing statements (HUD-1 / ALTA / settlement statements)** for every acquisition and disposition in the audit window. AcreOS `documentAnalysis` should have these — I want PDFs, not OCR extracts.
8. **Recorded deeds** for every property held during the audit window. Again, PDFs.
9. **The audit log** for the entire audit window, exported as CSV, with `action`, `entityType`, `entityId`, `userId`, `before`, `after`, `createdAt`. *This is where I look for retroactive edits.*
10. **The data retention configuration** as of the date of the CP2000. I want to know what was already purged before the legal hold was engaged.
11. **List of all team members and their roles** during the audit window — including any CPA/auditor accesses prior to mine.
12. **Software vendor letter from AcreOS** — yes, I will request a SOC 2 Type II report or equivalent attestation if one exists. The platform is the books-of-account system. Its controls are part of my evaluation.

---

## 3a. The Bank-Deposit Method Reconstruction (If His Books Don't Hold Up)

If AcreOS records cannot be reconciled to bank to my satisfaction, I fall back on the bank-deposit method, sanctioned in *Holland v. United States*, 348 U.S. 121 (1954), and the IRM at 4.10.4.6.4. Procedure:

1. Total deposits across all business accounts for the audit window.
2. Subtract identified non-income items (transfers, loan proceeds, capital contributions, refunds).
3. Result is gross receipts. I compare to reported receipts on Schedule E / Form 1040.
4. Any unexplained excess is unreported income. Burden shifts to the taxpayer to prove otherwise.

For a Land Investor with seller-financed notes, this method is **especially punishing**, because every monthly note payment looks like income unless he can show me a Form 6252 that breaks out the principal recovery (return of basis, not income) from the interest (income). If AcreOS can produce a clean per-payment principal/interest split that ties to bank, he avoids this. If it can't, he eats it.

That is the single largest dollar exposure in this audit and AcreOS is the lever. Build the export so principal/interest split is *line-item per payment, per note, with the bank-deposit date matched* and I become much easier to deal with.

---

## 4. What Would Make Me Close the Audit Quickly (No-Change or Small Adjustment)

If Bartholomew walks in with:

- Bank statements that tie to AcreOS payment ledger to the penny, monthly, all 36 months.
- Recorded deeds and closing statements for every basis-establishing event.
- 1098-INTs **with proof of furnishing** to each borrower by January 31.
- A Form 6252 for each installment sale with arithmetic that matches the AcreOS note schedule.
- An immutable audit log showing **no retroactive edits** to financial tables in the 30 days before or after the CP2000 date.
- An append-only cost-basis history (which AcreOS does not yet produce, but Margaret can reconstruct from `audit_log` if every adjustment fired one).

Then I issue a no-change letter or a small adjustment for arithmetic differences. We're done in 90 days. That's a good outcome for both of us.

---

## 5. What Would Escalate to Egg-Shell or Reverse-Egg-Shell Posture

- Cost basis numbers that do not reconcile to recorded deed consideration plus documented improvements.
- 1098-INT totals that do not match the borrower's claimed mortgage interest deduction (I cross-match via AUR — the Automated Underreporter — and discrepancies surface automatically).
- Bank deposits exceeding reported gross receipts by more than rounding error.
- Audit log evidence of edits to closed-year transactions after the CP2000 date.
- Activity log purged inside the audit window with no legal hold engaged.
- Multiple notes with identical "balloon paid" entries on suspiciously round dates with no corresponding bank deposit.

Any one of those gets me to "expand scope to six years under § 6501(e)(1)." Two or more and I'm calling CI (Criminal Investigation) for a fraud referral consult. I don't want to — referrals are a year of my life — but the Manual requires me to evaluate.

---

## 6. The Honest Assessment of AcreOS as a Books-of-Account System

For a Schedule E filer with 31 notes and 60 deals, AcreOS is **better than a shoebox of receipts and roughly equivalent to QuickBooks Self-Employed**. It is *not* equivalent to a real general ledger system (NetSuite, Sage Intacct) for the audit-readiness dimensions I care about, because:

- Single-entry, not double-entry.
- Mutable financial rows with audit coverage that depends on developer discipline.
- No bank reconciliation module.
- 1098 generation but no transmittal proof.
- Retention defaults that delete relevant evidence inside the statute window.

If the items in Bartholomew's own remediation list ship — append-only cost basis, Drizzle middleware forcing audit_log on every UPDATE/DELETE of financial tables, server-side 1098 batch with transmittal logging, legal hold flag, signed audit packet manifest — then AcreOS becomes **roughly equivalent to a small-business GL with a SOC 2-attested vendor.** That is a defensible books-of-account system in my world. Today it is not yet that.

---

## 7. One Sentence For The Engineering Team

Build the system so that when a Revenue Agent asks "what did the books say on December 31, 2023?" the answer is a deterministic query that returns a hash-verified snapshot — not a JSON dump of what the books say *today* and a story about what they used to say.

That is the difference between contemporaneous records and reconstructed records. The IRS treats them differently. So do I.

---

## 8. Procedural Note for Margaret (Bartholomew's CPA)

If you are reading this memo before our opening conference, here is what saves us both time:

- Engage the legal hold *now*, on the platform side, with a logged timestamp. I will note the date of engagement against the date of the CP2000. The closer those dates are, the better the optics.
- Do not regenerate 1098s today and present them as if they were issued in January 2025. I will check the audit log for the generation timestamp. Re-rendered statements are fine as exhibits — they are not fine as evidence of original transmittal.
- If any cost-basis adjustment was made *after* the CP2000 date, flag it in your workpapers. I will find it; better that you surface it.
- A signed manifest of the export bundle (sha-256 of every file at export time) is genuinely helpful. If AcreOS produces one, include it. If it does not, hash the files yourself with `shasum -a 256` at the moment of export and have Bartholomew sign a one-page certification of the export. That is acceptable to me as a contemporaneous record of what was produced.
- Bring the bank statements. I will ask for them anyway. Save us both a follow-up IDR.
