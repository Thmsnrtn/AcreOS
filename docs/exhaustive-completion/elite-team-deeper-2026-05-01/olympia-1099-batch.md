# Olympia Brightwell — AcreOS 1099 Batch Generation Audit

**Role:** Year-end information-return specialist, 24 years. Each January my four-person practice cuts ~3,800 1098-INT, 1099-INT, 1099-MISC, 1099-NEC, 1099-S, and 1099-C across roughly 180 small-cap landlords, note investors, and Land Investor operators. I file via FIRE and IRIS. I have walked clients through CP2100 / CP2100A "B-notice" letters, the § 6721 penalty matrix, and the 24% backup withholding waterfall more times than I can count.
**Wave:** 3 of 87-persona AcreOS audit, 1099 batch-generation lens.
**Date:** 2026-05-01.
**Surfaces reviewed:** `server/services/bookkeeping.ts` (lines 140–272), `server/routes-bookkeeping.ts`, `server/routes-elite-features.ts:540–580`, `server/routes-borrower.ts:760–840`, `server/services/financialOSService.ts`, `shared/schema.ts` (notes / payments / organizations / leads), `client/src/pages/borrower-portal.tsx`. I read Zerah's tax-attorney audit and Wendell's user review before sitting down.

I run the January machine. I do not look at "tax features"; I look at *batches that hit the FIRE/IRIS upload window without bouncing.* That is the only test that matters between January 15 and March 31. AcreOS fails that test today, and the gap is bigger than Wendell or Zerah described — because the codebase **mislabels the form it generates.**

---

## 1. One-line verdict

AcreOS today produces a function called `generate1099IntForms` that emits **a 1098-INT-shaped record under the 1099-INT name.** It is wrong on the form type, wrong on the role of the parties, wrong on the placeholder TIN string, and missing every batching, transmittal, e-file, and audit-trail surface that distinguishes a tax product from a CSV. **Do not let any client rely on this for tax year 2026.**

I would charge a client $180/borrower in January to do this work by hand from AcreOS's data. That is the price of the gap.

---

## 2. The form-type confusion (this is the load-bearing finding)

`server/services/bookkeeping.ts:230–272` defines `Form1099Int` and the function `generate1099IntForms`. It pulls every note where the borrower paid the org $600+ in interest during the tax year, and emits a record with the borrower as `recipientName` and the org as `payerName`.

**That is a 1098, not a 1099-INT.**

- **1098-INT (Form 1098, "Mortgage Interest Statement")** is filed by a *recipient* of mortgage interest in a trade or business when a payer paid them $600+ in a calendar year. Borrower → Lender direction. The lender files; the borrower receives a copy. (IRC § 6050H.)
- **1099-INT** is filed by a *payer* of interest income of $10+ to an investor or noteholder. Org → Investor direction. (IRC § 6049.)

The current code has the Land Investor as `payerName` (correct for a 1098, the org *receives* interest) but calls the form 1099-INT and puts $600 (1098 threshold) as the trigger. A 1099-INT trigger is $10. **The code is filling out a 1098 and calling it a 1099-INT.** If a CPA pulled this CSV and pushed it to FIRE under the 1099-INT TCC, the IRS would reject the file and (worse) any that processed would create phantom interest income against the borrower's SSN — triggering CP2000 notices six months later.

**Fix the name first.** Rename `Form1099Int` → `Form1098`, rename `generate1099IntForms` → `generate1098Forms`, rename `notesWith1099Required` → `notesWith1098Required`, rename `requires1099` on the per-note shape → `requires1098`. Update the route at `routes-bookkeeping.ts:34` and `routes-elite-features.ts:550` to `/api/bookkeeping/1098`. This is a four-file rename and it removes the single most dangerous misnomer in the codebase.

---

## 3. 1098-INT batch generation — what's there, what's missing

### What exists

- Per-org annual interest rollup with interest, principal, late fees collected per note (`generateAnnualInterestReport`).
- A $600 threshold flag on each note (`requires1099`, which we just established is misnamed).
- A single endpoint at `routes-borrower.ts:770–800` that emits one borrower's 1098 JSON when called from the borrower portal. Wendell's "63 sessions for 63 borrowers" critique is correct — there is no operator-side batch.
- Math is right: `interestCollected` from completed payments inside the tax year is the legal Box 1 number on a cash-basis lender.

### What's missing for a real January batch

1. **No batch endpoint.** `generate1098Forms(orgId, taxYear)` exists in the service, but there is no route that ZIPs PDFs, no route that builds an IRS-acceptable e-file payload, no route that emails recipient copies before the January 31 deadline.
2. **No Recipient TIN on file.** `payerEin: "00-0000000"` and `recipientTin: "000-00-0000"` are *literal placeholder strings* at lines 262 and 266. The schema has nowhere to *put* a real TIN — `leads` (the borrower table) has no `tin`, `taxIdentifier`, `ssn`, or `ein` column. Without that column the form cannot be valid; with that column we still need the W-9 workflow to populate it.
3. **No Payer EIN.** `organizations.settings` has no `companyEIN` / `taxId`. The hardcoded `00-0000000` is what ships.
4. **No Box 2 — outstanding mortgage principal as of Jan 1.** Required since 2017. The payment ledger can compute it, but no code does.
5. **No Box 3 — origination date** is wired into the new Form1099Int interface (only `taxYear`). It's available on `notes.startDate`; the field just isn't included.
6. **No Box 6 — points paid on purchase.** Could come from acquisition costs but isn't pulled.
7. **No Box 8 — address of property securing the mortgage.** Notes have `propertyId` but the 1098 generator doesn't join properties.
8. **No 1096 transmittal cover** for paper filing.
9. **No FIRE / IRIS e-file payload.** See § 5 below.
10. **No `tax_form_issuances` table.** When a borrower disputes a 1098 in March, the org must produce the exact record sent + sent date + sent method. AcreOS has no audit trail.
11. **No corrected-form (Form 1098 with "CORRECTED" box checked) workflow.** Year 1, 5–10% of forms get corrected. Without a "supersede with reason" path, every correction is a manual mess.
12. **No de minimis suppression UI.** The $600 threshold is hard-coded as a filter; it should also surface a "below threshold but eligible" review list, because some lenders elect to file all anyway for record-keeping (and many of mine do).

### Wendell's case (40 active notes)

Wendell would need 40 1098-INTs in January 2027. Today: 40 manual borrower-portal sessions producing JSON, no PDF, no TIN, no Box 2, no Box 8, no transmittal. **Time-to-completion via AcreOS today: 12+ hours of his own labor + outside CPA cleanup. Time-to-completion if AcreOS shipped a real batch: 8 minutes.** That is the difference between a $20/mo trial and a $79/mo Scale conversion.

---

## 4. 1099-INT (the real one) — does not exist

A 1099-INT is filed when the org pays interest of $10+ to an investor or private-money lender. AcreOS users absolutely do this — every Linnea-style note pool, every syndicated parcel, every preferred-equity slice carrying coupon. Today the schema has no `investors`, no `capital_partners`, no `private_money_lenders` table. The accruals pipeline runs only borrower → org. Every dollar of interest the org pays *out* is invisible to the system.

**For a real 1099-INT batch we need:**

1. A `payees` table with name, address, encrypted TIN, TIN-type, W-9 capture date, W-9 document hash, backup-withholding-required flag, exempt-recipient code.
2. An `interest_paid` ledger entry on every distribution to an investor/lender.
3. A January batch that filters where YTD interest paid ≥ $10, generates one 1099-INT per payee, plus a 1096 transmittal (or IRIS payload).
4. Box 4 — federal income tax withheld — populated from the backup-withholding ledger. Today `box4FederalWithholding: 0` is hard-coded. That is wrong any time backup withholding *should* have been applied.

---

## 5. 1099-NEC, 1099-MISC — missing entirely

### 1099-NEC (contractors, $600+ in nonemployee comp)

Every Land Investor pays:

- Wholesalers (finder fees on assignments).
- Mailer vendors (Pebble, Open Letter Marketing, Yellow Letter HQ).
- Surveyors, environmental consultants, soil-test outfits.
- Attorneys (any payment $600+ to an attorney is reportable on 1099-NEC Box 1 *or* 1099-MISC Box 10 depending on character — gross proceeds vs. fees).
- Field VAs, photographers, drone operators, contract labor.

AcreOS has no `vendors` / `payees` / `contractors` table. Searching for it returns hits inside `dueDiligenceEngine.ts` ("Contractor bids") and `legalAutonomyEngine.ts` ("vendor renewal") — both of which are talking about *the existence of vendors as a concept*, not payment tracking. There is no general-ledger surface for "money out to a third party" that aggregates by payee per calendar year.

**Without that surface, no 1099-NEC is possible.** A Wendell-class operator owes 4–8 of these in January. Failing to file is a § 6721 penalty per missed return ($310/return tier in 2026, $630/return at intentional disregard, uncapped on the high tier).

### 1099-MISC

Three buckets matter for Land Investors specifically:

1. **Box 1 — Rents.** Any operator with leased land, agricultural cash rent, hunting leases, or grazing leases owes a 1099-MISC for any landlord they pay $600+/year in rent. Della's timber operators and Vesta's hunting-lease lessees are dead-on for this.
2. **Box 2 — Royalties ($10+).** Mineral royalties, oil/gas royalties, water-rights royalties, timber depletion. **Saoirse's mineral-rights persona is a dedicated audit on this exact case.** AcreOS has zero schema for royalty accounting — no `royalty_payments`, no production-volume → revenue conversion, no severance-tax tracking.
3. **Box 10 — Gross proceeds paid to an attorney.** Settlement payments, escrow disbursements where the closing attorney aggregates funds. Common in defended quiet-title and tax-deed cases.

Box 6 (medical/health), Box 7 ($5K direct-sales), Box 14 (excess golden parachute) are out of scope for Land Investors.

---

## 6. 1099-C — debt cancellation (frequent, totally absent)

When a Land Investor reworks a defaulted seller-financed note and forgives $600+ of principal, **the borrower owes ordinary income tax on that amount** (§ 61(a)(11)) and **the org owes a 1099-C.** This is *common* in our world — far more common than for conventional mortgage lenders, because seller-financed paper to credit-impaired buyers defaults at 8–15% historically.

Schema gap: `notes` has a `status` enum but no `discharge` event with a `forgivenAmount`, `identifiableEvent` (Code A–H), and `interestForgiven` flag. The 1099-C requires Box 6 (identifiable event code) which has 8 specific values — A: bankruptcy discharge; B: receivership; C: statute of limitations; D: foreclosure election; E: debt relief from probate; F: by agreement; G: decision/policy to discontinue collection; H: expiration of nonpayment testing period. None of this is captured anywhere.

**This is also the most asymmetric form on the board:** the cost of *not* filing falls on the org (penalty + audit risk); the cost of filing *correctly* helps the borrower (clear basis impact for them, clean books for the org). It should be the easiest "yes" in the build.

---

## 7. W-9 collection workflow — the cheapest fastest fix

I cannot say this strongly enough: **the W-9 is the foundation.** Without a TIN on file at first payment, every dollar paid is presumptively subject to 24% backup withholding under § 3406. If the org pays $10K to a contractor without a W-9 and doesn't withhold, the org is on the hook for $2,400 + penalties + interest, *forever*, irrespective of whether the contractor reported the income.

What needs to ship:

1. **W-9 capture surface** at first payee creation. Form 4 fields: Name (legal + DBA), Address, TIN (SSN or EIN), Federal tax classification (sole prop / single-member LLC / C-corp / S-corp / partnership / trust / other), Exempt payee code, Exempt FATCA code, Signature + date.
2. **TIN matching against the IRS TIN Matching Program** (e-Services) — a free service for participants in the IRS Bulk TIN Matching program. Catches typos and mismatches before the form is filed.
3. **TIN encryption at rest.** This is PII; it must be encrypted with a separate key, accessed only at form-generation time.
4. **W-9 PDF storage with hash + capture date + IP.** Audit defense.
5. **Hard block in the payment cascade** when a payee has no W-9 on file *and* YTD payments are about to cross $600 (1099 threshold) or $10 (1099-INT/MISC Box 2 threshold). Soft warn below threshold.
6. **Annual W-9 refresh nudges.** TINs change (life events, entity restructures); a stale W-9 is a problem.
7. **Form W-8BEN / W-8BEN-E** path for foreign payees. Triggers 1042-S, not 1099. Heng-style foreign-buyer personas need this.

This is a 1-week build done right. It is the single highest-ROI tax investment AcreOS can make.

---

## 8. Backup withholding — non-existent and dangerous

When the IRS sends a CP2100 / CP2100A "B-notice" because a TIN-name mismatch was reported, the org has 15 business days to send a B-notice to the payee, request a corrected W-9, and **start withholding 24% on subsequent payments until the issue is cured.** AcreOS has:

- No `backup_withholding_required` flag on payees.
- No B-notice template.
- No first-B-notice / second-B-notice tracking (the rules differ).
- No automatic 24% deduction on outbound payments.
- No quarterly Form 945 (annual return of withheld federal income tax) generation.
- No EFTPS tax deposit workflow for amounts withheld.

A note operator with an unmatched investor TIN who receives a CP2100 in March 2027 and ignores it (because AcreOS gave them no path to act on it) is accumulating a § 3403 liability for the full 24% of every distribution made after the 30-day cure window. That liability is **the org's, forever** — even if the investor self-reports. This is the kind of latent risk that surfaces in IRS audits 3–4 years out and ruins operators.

---

## 9. FIRE vs IRIS — the e-file path

Two production-grade IRS e-file paths exist for information returns:

- **FIRE (Filing Information Returns Electronically):** Legacy. Requires a Transmitter Control Code (TCC). File-format specs in IRS Pub 1220. Fixed-width records, complex but stable. Filers > 10 returns must e-file (was 250+ pre-2024; the threshold dropped sharply for 2024+ returns).
- **IRIS (Information Returns Intake System):** Newer, JSON/web. Requires IRIS TCC (separate application from FIRE TCC). Supports 1099 series; expanding coverage. Lower barrier to entry, friendlier API, recommended for new builds.

**Recommendation: build IRIS first.** The schema is JSON, the test environment is real, the IRS is steering filers toward it. FIRE remains for forms IRIS doesn't cover yet (1098-T historically lagged, for example) and as fallback. AcreOS today has neither.

What the build needs:

1. Org-level TCC capture at onboarding for clients who file > 10 returns annually. (Most clients won't have one; offer "AcreOS files on your behalf" via a service-provider TCC, but that has ECI / FBAR / privacy implications worth attorney review.)
2. IRIS payload builder per form type — distinct schemas for 1098, 1099-INT, 1099-MISC, 1099-NEC, 1099-C, 1099-S.
3. Submission state machine: draft → reviewed → submitted → accepted → rejected → corrected.
4. Acceptance receipt storage (the IRIS Submission ID).
5. Reject-reason codes mapped to remediation actions.
6. **Test-mode submissions** in IRIS sandbox during November/December so the January batch isn't the first time the system has talked to the IRS.

Recipient copies are a separate path — print + USPS-mail or e-deliver with consent (Pub 5223 has the e-delivery rules; consent must be electronic and demonstrate ability to access the format).

---

## 10. Top 10 1099-batch-generation gaps (ranked by January cost)

1. **Form-type misnomer.** `generate1099IntForms` emits a 1098 under the 1099-INT name. Single highest-priority rename. (§ 2.)
2. **No W-9 capture and no TIN storage.** Cannot fill any form correctly. Triggers backup withholding liability. (§ 7.)
3. **No FIRE/IRIS submission path.** Even with perfect data, no way to file at scale. (§ 9.)
4. **No `tax_form_issuances` audit trail.** No defense against borrower / IRS dispute. (§ 3.)
5. **No 1099-NEC / 1099-MISC at all.** Missing entire form families that affect every operator. (§ 5.)
6. **No backup withholding workflow.** § 3403 liability accrues silently. (§ 8.)
7. **No 1099-C on debt forgiveness.** Frequent in seller-financed land. Schema has no discharge event. (§ 6.)
8. **No corrected-form path.** Year 1, ~7% of forms need correction. Today: manual file + manual submission. (§ 3.)
9. **No royalty accounting (1099-MISC Box 2).** Saoirse-class mineral cases produce zero forms. (§ 5.)
10. **Recipient TIN and Payer EIN are literal placeholders** (`000-00-0000`, `00-0000000`). The current code would emit invalid forms even if the rest worked. (`bookkeeping.ts:262, 266`.)

§ 6721 penalty exposure for a 40-borrower Wendell at intentional-disregard tier: 40 × $630 = **$25,200/year**. For a 63-borrower Linnea: **$39,690/year**. These are not theoretical — they accrue per missed or wrong return.

---

## 11. The 2-week 1099-batch sprint

### Week 1 — foundations + 1098 batch

**Day 1 — rename + EIN + property join (4h):**
Rename Form1099Int → Form1098 across `bookkeeping.ts`, `routes-bookkeeping.ts`, `routes-elite-features.ts`. Add `companyEIN` and `companyTIN` to `organizations.settings`. Join `properties` into the 1098 generator for Box 8 secured-property address.

**Day 2 — TIN schema + W-9 capture (10h):**
Add encrypted `taxIdentifier`, `taxIdentifierType`, `w9OnFileAt`, `w9DocumentId`, `w9SignatureIp`, `taxClassification`, `exemptPayeeCode`, `backupWithholdingRequired` to `leads` (borrowers) and a new `payees` table for non-borrower payees. Build the W-9 capture form with PDF generation and storage. Wire IRS TIN matching call (test mode).

**Day 3 — `tax_form_issuances` table + Box 2 (8h):**
Schema: `(orgId, payeeId, formType, taxYear, generatedAt, pdfHash, sentAt, sentMethod, irsSubmissionId, status, correctionOf)`. Compute Box 2 (Jan 1 principal balance) from the payment ledger.

**Day 4 — 1098 batch endpoint + PDF + ZIP (8h):**
`POST /api/tax/1098/generate?year=2026` walking every active note, generating one PDF per qualifying borrower, ZIP'd, plus a Form 1096 paper transmittal cover. Pre-flight checklist page that warns on missing TIN / missing Box 2 / missing Box 8 before generation runs.

**Day 5 — payees + 1099-NEC schema (8h):**
`payees` table fully populated. `payee_payments` ledger with category (rent / royalty / nec / interest / attorney-gross-proceeds). January UI to draft 1099-NEC and 1099-MISC for every payee paid > $600 (or >$10 royalty / >$0 attorney) in the prior year.

### Week 2 — durability + e-file

**Day 6 — IRIS sandbox submission (10h):**
IRIS TCC capture at org level. JSON payload builder for 1098 and 1099-NEC. Sandbox submission. Acceptance ID storage. Reject handling.

**Day 7 — backup withholding (8h):**
B-notice template. CP2100 import workflow. 24% withholding on outbound payments when flagged. Form 945 worksheet. EFTPS reminder calendar.

**Day 8 — 1099-INT (true) + 1099-C (8h):**
Investor-side interest payments → 1099-INT batch. Note-discharge event with identifiable-event code → 1099-C batch.

**Day 9 — 1099-MISC royalty + rent (6h):**
Royalty ledger schema. Mineral / timber / hunting-lease distribution paths. 1099-MISC Box 1 / Box 2 / Box 10 batch.

**Day 10 — corrected-form path + recipient e-delivery consent (6h):**
"Supersede with reason" workflow. Recipient e-delivery consent capture + delivery audit trail (Pub 5223).

**Day 11–12 — production IRIS + January-readiness (12h):**
Production TCC. Full batch dry-run against November/December test data. Calendar surface for Jan 31 / Feb 28 / Mar 31 deadlines.

**Day 13–14 — runbook + audit-defense docs:**
`docs/runbooks/1099-january.md`. CP2100 / B-notice / corrected-form / penalty-abatement playbooks. Sample audit-defense package per form type.

### What this sprint does *not* solve

- 1042-S for foreign payees (W-8BEN handling) — separate week.
- 1099-K for marketplace facilitators — N/A unless AcreOS becomes a payment facilitator.
- 1099-A on acquisition or abandonment of secured property — adjacent to 1099-C, can fold in if needed.
- State equivalents (some states require separate filings even when feds accept; the CF/SF Combined Federal/State Filing Program covers most but not all).
- Multi-org filing aggregation for CPAs managing 50+ AcreOS clients — Iolanda-Salesforce-tier feature.

---

## 12. Bottom line

AcreOS is **closer to a real 1098 batch than it looks** (the math is right, the threshold is right, the per-note rollup exists) and **further from a real 1099 product than anyone seems to realize** (the form is misnamed, no payee schema exists, no W-9 surface exists, no IRS submission path exists, no audit trail exists, and the entire 1099-NEC / 1099-MISC / 1099-C family is invisible).

If items 1–4 of the sprint ship, I would let a Wendell trust the 1098 batch in January 2027. If items 1–7 ship, I would let an org issue any payment without me losing sleep about backup withholding. If items 1–14 ship, AcreOS owns the January machine for the median Land Investor, and I refer my smaller clients to it instead of building their batches manually.

Until then, my January 2027 spreadsheet still lives. And every borrower TIN in this codebase is `000-00-0000`.

— Olympia Brightwell, EA
