# Post-Closing Specialist Audit — AcreOS

**Author:** Esther Prendergast — 22 yrs post-closing at three title companies (Stewart, Old Republic, regional independent in PA), currently runs the post-closing desk for a 400-file/year shop. Wave 3 of the 87-persona deeper audit, day-2 ops lens.
**Date:** 2026-05-01
**Lens:** "Closings are sales theater — everyone is on their best behavior because they want to sign and shake hands. The real work begins after the wet ink dries. The deed has to leave the building, get to the right counter, get a stamp that the right county clerk recognizes, and come back as a recorded instrument with a number on it. The 24-to-72-hour window between signing and recording is where files die — and where the title company eats the loss because the buyer has already paid. Software that ignores this window is software written by people who have never been on the receiving end of a 'where's my deed?' email at 4:55 pm on a Friday."
**Read in full:** `server/services/closingChecklistGenerator.ts` (103 lines — entire post-closing surface), `server/services/countyRecordingFees.ts:91-115` (county overrides — 5 of 3,140), `server/services/closingCostEstimator.ts`, `server/services/titleChainService.ts:618-685` (the only existing recording-status check), `server/routes-closing.ts`, `server/routes-recording-fees.ts`, plus Whitman §6 (recording-fee math, transfer-tax remittance) and Marguerite §5 (signed-PDF persistence — what gets recorded).

---

## 1. Thirty-second verdict

**The signing-to-recording handoff in AcreOS is two checklist items and a hope.** `closingChecklistGenerator.ts:58-60` ships three post-closing line items — "Record deed with county" (closing+1), "Confirm recording and obtain recording number" (closing+7), "Send recorded deed copy to buyer" (closing+14) — and that is the entire day-2 operational surface. There is no recording-package builder, no transfer-tax-affidavit generator, no rejection-handling workflow, no instrument-number capture field on the deal record, no notification when the recording window slips past 7/14/30 days, no e-recording integration, and no post-recording document delivery. The county-fee data layer (`countyRecordingFees.ts`) is well-shaped but covers **5 of 3,140 US counties** in its override table — for the other 99.84% of the country it falls back to a single state-wide fee that is wrong by 30-100% in many counties and silently produces under-collected closing CDAs. The signed PDF that needs to be recorded does not yet exist as a stable artifact (Marguerite §5 — the signed envelope is reconstructable but not pinned). **Six weeks of focused work — Simplifile + ePN dual integration, recording package builder, instrument-number capture, transfer-tax-affidavit generator per state, rejection workflow, post-recording delivery — moves AcreOS from "the operator hand-walks every deed and prays" to "the file closes itself in 80% of counties without operator touch."** Without that work, AcreOS cannot truthfully advertise itself as a closing platform; it is a pre-closing platform that abandons the file at the moment of greatest financial exposure.

---

## 2. Day-2 ops gaps — what the post-closing desk needs and does not have

### 2.1 No "recording package" concept

In a real title company, after signing the closer assembles a **recording package**: the deed (original wet-ink or signed e-record), any required cover sheets (CA PCOR, NY RP-5217, FL DR-219, WA REET affidavit), the recording-fee check or e-fund, transfer-tax remittance, and any state-specific addenda (TX §11.008 boundary disclosure, PA Realty Transfer Tax Statement of Value Form REV-183). The package is the unit of work — it has a status (assembled / dispatched / recorded / rejected / re-submitted), a destination (county / e-recording vendor), a tracking number, and a cost (fees + tax + courier).

AcreOS has none of this. The deed PDF lives in `generated_documents`. The closing-checklist line item for recording is a single boolean. There is no `recording_packages` table, no package-assembly UI, no per-document role inside a package (deed-as-primary vs PCOR-as-cover-sheet vs REET-as-tax-form). The operator opens three browser tabs, prints the PDFs, walks them to a kinko's, and FedExes the stack to the county. Nothing in the system tracks that this happened or did not happen.

**Fix sketch:** new `recording_packages` table (`{id, dealId, organizationId, county, state, status, dispatchMethod: 'simplifile'|'epn'|'mail'|'walk-in', assembledAt, dispatchedAt, recordedAt, rejectedAt, rejectionReason, instrumentNumber, recordedBookPage, totalFees, transferTaxRemitted, courierTracking}`). New `recording_package_documents` join table linking package to `generated_documents` rows with a `role` field (primary / pcor / transfer_tax_affidavit / addendum / cover_sheet). Surface in deal-detail UI as a "Recording" panel that takes over after the closing-checklist "Execute closing" item flips green.

### 2.2 No instrument-number capture field on the deal

`titleChainService.ts:65, 624` defines an `instrumentNumber` field *on the title-chain narrative*, but the deal record itself has nowhere to store the number that the county clerk stamps onto the recorded deed. After recording, the buyer's lender wants the instrument number (also called document number, recording number, reception number, or book/page reference depending on the state) for the title-policy issuance. The buyer wants it for their records. The seller's 1099-S filing references it. Future skip-trace and AVM lookups key off it.

Today the operator captures it nowhere. The "Confirm recording and obtain recording number" checklist item flips to done with no data attached. The number is lost the moment the email closes. When an audit asks "what was the recording number for the Smith parcel sale?" three years later, the answer is "let me email the county."

**Fix sketch:** add `recordedInstrumentNumber`, `recordedBookPage`, `recordedDate`, `recordedCounty` columns to `deals` (or to the new `recording_packages` table if §2.1 ships). Surface a required input on the "Confirm recording" checklist item — the user cannot mark it done without entering the number. Once entered, propagate to the title-chain service so future chain queries return AcreOS's own recordings.

### 2.3 No SLA timers / no "stuck file" detection

The 24-72-hour window between signing and recording is where files die. The two failure modes that the post-closing desk watches for:

1. **The deed sits in someone's outbox.** Closer signs Friday at 4 pm, throws the package on the corner of the desk, takes Monday off. Tuesday morning the deed is still on the corner. Closing-date-plus-1 has slipped to closing-date-plus-4, the buyer's homeowners-insurance binder has lapsed (some carriers void coverage if recording slips past 5 days), and the seller has called twice asking when the wire will release.
2. **The deed gets to the county and bounces.** Wrong fee amount, missing PCOR, wrong notary acknowledgment form, no two-witness block in FL, the legal description doesn't match the prior deed of record (county clerk requires exact match for chain-of-title indexing). The package comes back two weeks later with a yellow rejection slip. The closer re-fixes, re-mails, re-waits two more weeks. The buyer's lender cannot fund the loan-secondary-market sale until the deed records.

AcreOS has no SLA timer for either mode. The closing checklist due dates are static fields with no alarm. If "Confirm recording and obtain recording number" is due closing+7 and today is closing+14 with the box still unchecked, the system says nothing.

**Fix sketch:** background job `checkPostClosingSLAs` runs daily. For every deal with `closingDate ≤ today` and `recordingPackage.status ∈ {dispatched, null}`, compute days-since-closing. Tier the alerts:
- closing+2 with no package dispatched → soft nudge in the operator inbox
- closing+5 with no recording number captured → red banner on deal detail, push notification, email
- closing+10 with no recording number → escalation to org owner, "this deed is stuck — call the county" CTA with the county recorder's phone number pre-populated from `countyRecordingFees` (which today has no phone-number field — add one)
- closing+30 with no recording number → exception flag for compliance reporting

### 2.4 No rejection-handling workflow

When a package comes back rejected, the post-closing desk needs:
1. A place to log the rejection reason (county clerks use a small set of reason codes — wrong fee, missing PCOR, defective acknowledgment, illegible signature, legal description mismatch, missing transfer-tax stamp, wrong margin/font, document not original).
2. A re-submission workflow that doesn't require re-running the entire closing checklist.
3. A learning loop — if Travis County rejected the last three AcreOS packages for "missing notary commission expiration date," the doc generator should fix the template, not just the operator should fix the package.

None of this exists. A rejection in AcreOS today is "the user un-checks the recording checkbox and starts over" with zero institutional memory.

**Fix sketch:** `recording_package_events` table (`{packageId, eventType, eventCode, eventDetails, occurredAt}`) with event types `dispatched`, `rejected`, `resubmitted`, `recorded`. Event codes drawn from a fixed enum of the ~30 most common county rejection reasons (the National Recording Standards work group publishes these). When an org accumulates 3+ rejections with the same code, surface it to the AcreOS admin team so the underlying template defect can be fixed.

### 2.5 No post-recording document delivery

Once the recording number lands, the post-closing desk has to deliver:
- **Recorded deed copy** to the buyer (and their lender if any) — usually within 30 days
- **Recorded deed copy** to the seller's file
- **Title policy** to the buyer (issued by the title insurer after they confirm recording)
- **Recording confirmation** to the buyer's homeowners-insurance carrier (some require it before binding becomes a paid policy)
- **1099-S filing reference** to the seller (the title company is responsible for this filing in most cases)
- **County tax-roll change notice** — some counties (CA, FL) require the new owner to file a separate change-of-ownership form *after* recording

AcreOS today has the "Send recorded deed copy to buyer" checklist item (closing+14), and that is all. No automated email with the recorded PDF attached, no delivery tracking, no title-policy hand-off, no insurance-carrier notification, no 1099-S reference packet.

**Fix sketch:** when `recording_packages.status = 'recorded'` and the recorded PDF has been retrieved (see §3 below), trigger a `postRecordingDelivery` job that:
1. Emails the recorded deed PDF to all parties on the deal (buyer, seller, lender, agent), each with a delivery-receipt event logged.
2. Generates a "Closing Complete" packet PDF with the deed, settlement statement, recording confirmation, and 1099-S form, stored to the deal's documents.
3. If `dealType === 'buyer-financed'` or `existingMortgageAssumption === true`, sends a recording-confirmation email to the buyer's listed insurance carrier (capture the carrier on the closing checklist).
4. Posts a "Closing complete" entry to the deal timeline with the recording number, recording date, and links to all delivery receipts.

---

## 3. County recording integrations

### 3.1 The two paths and the honest math on each

Three real options for getting a deed to a county:

**Option A — paper, mailed or walked.** Works in 100% of counties. Operator burden: 1-2 hours per file. Calendar time: 5-21 days. Failure rate: ~12% (rejection on first submission across the industry; lower for experienced closers, higher for new ones). This is the AcreOS default today by virtue of having no other option.

**Option B — Simplifile (now part of ICE Mortgage Technology).** Single API, covers ~2,400 of ~3,140 US counties (76%) for e-recording. Pricing: ~$5-10 per package + county fees pass-through. SLA: typical e-recording is recorded within 4-24 hours; same-business-day in well-run counties. Failure rate: ~3% (most pre-flight rejections caught by Simplifile's own validators before submission). API is well-documented, RESTful, supports webhook callbacks for status updates. **Highest ROI integration AcreOS could ship for the closing surface — Whitman flagged it from the legal lens, I am flagging it from the ops lens, we agree.**

**Option C — ePN (eRecording Partners Network).** Competitor to Simplifile. Covers ~1,800 counties with significant overlap to Simplifile, but covers ~200 counties Simplifile doesn't (notably some FL panhandle, GA south, and AL counties where Simplifile is weak). Pricing: similar. API is older, SOAP-based, slightly more painful to integrate.

**Option D — CSC eRecording.** Smaller footprint, ~1,400 counties, generally enterprise-tier pricing. Skip unless you have a CSC relationship for other reasons.

**Recommendation: ship Simplifile first (covers 76%), ePN second (covers another 6-8% incremental), and accept paper-only fallback for the remaining ~16% of (mostly very rural) counties. That gets AcreOS to ~84% e-recording coverage, which is industry-competitive.**

### 3.2 What an e-recording integration actually has to do

Not just "POST a PDF and get a recording number back." The full flow:

1. **Pre-flight validation.** Each county has its own document-format requirements: page size (8.5x11 vs 8.5x14 in PA, MA), margin requirements (TX requires 3" top margin on first page for the recording-stamp box; FL requires 1" margins all around but 3" at top; CA requires 2.5" top), font size (most require ≥10-pt for body text, ≥14-pt for the title), legibility (no scanned-from-fax artifacts), and grayscale-only on certain fields. AcreOS's `documents.ts` generators do not honor any of these. A Simplifile pre-flight will reject the AcreOS-generated TX deed today because the top margin is wrong.
2. **Cover sheet generation.** Many counties (CA every county, NY RP-5217, FL many counties) require a **county-specific cover sheet** that is not the deed itself but a separately recorded transmittal. The cover sheet has the parcel APN, the grantor/grantee names, the consideration amount, and a barcode the recorder uses to index. AcreOS does not generate any of these.
3. **Transfer-tax computation and remittance.** The recording fee and the transfer tax are usually paid in two separate transactions to two separate state/county entities. PA recording fee goes to the county recorder; PA realty transfer tax (1% state + 1% local) goes via a Statement of Value form (REV-183) to the PA Department of Revenue. WA recording fee goes to the county; WA REET (1.1-3.0%) goes to the WA DOR via a REET affidavit. FL doc-stamp tax goes to the county at recording on residential, but to the FL DOR for some commercial. AcreOS today computes a single transfer-tax number and shows it on the closing-cost estimator UI; it does not generate the remittance form, does not split the payment correctly, does not file the affidavit.
4. **Webhook handling for status callbacks.** Simplifile sends status updates: `submitted` → `in_review` → `recorded` (with instrument number + recorded date + book/page) OR `rejected` (with reason code). AcreOS needs an idempotent webhook receiver (Hessam §2.4 pattern — `recording_processed_events` table, atomic insert-on-conflict, state-machine guard on `recording_packages.status`).
5. **PDF retrieval after recording.** The recorded PDF has the county clerk's stamp, recording number, and book/page imprint. Simplifile makes it available via a download endpoint. AcreOS needs to fetch and pin this artifact to its own storage (S3) — this is the "official" recorded deed that the buyer will need for their tax records, future sales, and any title disputes. Without it, AcreOS only has the *pre-recording* PDF, which is legally distinct from the recorded original.

### 3.3 County-by-county quirks the integration must handle

| State / county | Quirk | AcreOS today |
|---|---|---|
| **CA — all 58 counties** | PCOR (Preliminary Change of Ownership Report) required at recording. Missing PCOR = $20 surcharge per Cal Rev & Tax §480.3 OR rejection (county-dependent) | Not generated. |
| **CA — Los Angeles County** | Additional Documentary Transfer Tax Affidavit (form ADTT) required. LA City overlay tax on >$5M sales (4.5% Mansion Tax — Measure ULA). | Captured in `countyRecordingFees.ts:96` as a *prose note*. Not enforced, not computed. |
| **CA — San Francisco** | Tiered transfer tax to $24.75/$1,000 above $25M. SF-specific Transfer Tax Affidavit (TTX-1). | Prose note only. |
| **NY — all 62 counties** | RP-5217 form required. NY State Real Estate Transfer Tax (TP-584) at $4/$1,000 + NYC RPTT at 1.0-2.65% for NYC counties. Mortgage Recording Tax for any new mortgage. | Nothing. NY is a `STATE_DOCUMENT_CONFIGS_FALLBACK` state — there is no NY-specific config. Marguerite flagged the same. |
| **WA — all 39 counties** | REET Affidavit required at recording. Tiered REET (1.1% to 3.0% based on price). Some counties (King) require electronic REET via DOR portal. | Computed in `countyRecordingFees.ts:74` as 17.78/$1,000 (correct) but no affidavit generated. |
| **PA — all 67 counties** | Realty Transfer Tax: 1% state + 1% local (most counties; Philadelphia is 4.278%). REV-183 Statement of Value form required. Recording fee structure changed in 2024. | State-level rate of 10/$1,000 (split) is right at the state level; local 1% is missing entirely. REV-183 not generated. Tom Pennsylvania persona will care. |
| **FL — Miami-Dade** | Additional $0.45/$1,000 surtax. Doc-stamp tax remittance via DR-219. | Captured as a prose note (`countyRecordingFees.ts:113`). Not enforced. |
| **FL — all 67 counties** | Two-witness requirement on every recordable deed (Fla. Stat. §689.01). | Marguerite §3.6 + Whitman §2.2 already flagged. Witness lines not in the deed PDF — package will be rejected on submission. |
| **TX — all 254 counties** | First-page top margin must be 3" for recording stamp. Each county sets its own per-page recording fee (Harris $35, Travis $36, others vary). § 5.069 contract-for-deed must be recorded within 30 days. | Margins not enforced in `documents.ts`. Two counties seeded with overrides; other 252 fall through to state default. |
| **GA — all 159 counties** | Real Estate Transfer Tax via PT-61 form. GA SuperiorCourt Clerk Cooperative Authority operates its own e-filing portal (GSCCCA) — not Simplifile. Need a separate integration for GA. | PT-61 not generated. GSCCCA not on the integration roadmap. |
| **NC — all 100 counties** | Excise Tax (NC stamp tax) of $1/$500. Two-witness or notary acknowledgment. PIN format varies. | Captured (`stateDocumentConfig.ts:308 witnessCount: 2`) but not enforced in deed generation. |
| **OH — all 88 counties** | Conveyance fee (state $1/$1000 + county varies, max $3/$1000). Each county has its own recording-fee schedule that changed in 2023. DTE-100 form required. | DTE-100 not generated. State default rate is wrong post-2023. |
| **IL — Cook County** | Three separate transfer taxes: state ($0.50/$500), county ($0.25/$500), Chicago city ($3.75/$500 with split between buyer and seller). MyDec form for state. | State default of 1.50/$1000 is approximately right for state portion only. County and city missing. MyDec not generated. |

The pattern: **AcreOS's `countyRecordingFees.ts` is good architecture for what it represents but is dramatically under-populated.** It has 5 county overrides; it needs 200+ to be useful at recording time. The state-level fallback is fine for a closing-cost *estimate* that errs ±20% — it is not fine for the *actual* fee submitted at recording, which has to be exact or the package gets rejected.

### 3.4 E-recording vs paper — the operator decision

Even with Simplifile integrated, the operator may still need paper for:
1. Counties not on Simplifile/ePN (~16% of US counties, mostly rural).
2. Documents the county requires as wet-ink originals (some counties still won't accept e-recorded deeds with conveyance > $1M, or for trust transfers, or for affidavits requiring blue-ink notary seal).
3. When the buyer's lender's title insurer requires wet-ink (rare but not extinct).

AcreOS needs a `recording_packages.dispatchMethod` field with values `simplifile | epn | mail | walk-in`, defaulting to whichever is available for the county, with operator override. For paper packages: print-ready PDF assembly (cover page, deed, addenda, fee check or money-order template, return-address label, USPS Priority Mail tracking input field).

---

## 4. The deal-killer

**The deal-killer for the post-closing surface is not technical — it is that AcreOS today claims to be a closing platform but the moment the deed is signed it stops being one.**

The product takes a Land Investor from lead to signed-deed beautifully. The state document configs, the e-sign flow, the closing checklist, the cost estimator — these are above-average for the LandTech category. Then the signed deed lands in `generated_documents` with `status='signed'` and the product walks away. The buyer wired funds two days ago. The seller's escrow disbursement is pending. The deed is sitting on someone's laptop. And AcreOS has no idea whether the file is on track or stuck.

The post-closing desk at any real title company is 30-40% of the closing labor. It is the place where files go to die or graduate. AcreOS today represents 0% of post-closing labor in the product surface. **An operator running AcreOS at scale (50+ closings/year) will, in the third or fourth quarter of operation, hit the moment where they have 8 deeds in various states of post-closing limbo, no system tracking any of them, and a buyer asking why their deed has not arrived — which they will, because the average post-closing-to-recorded-deed-delivered cycle in the industry is 21-45 days and there is always a long tail.** That moment is the moment the operator either builds their own spreadsheet and reduces AcreOS to a pre-closing tool, or — more dangerously — assumes "AcreOS is handling it" and discovers six months later that three deeds were never recorded, two are in the state of mortgage limbo, and the title insurer is refusing to issue a policy on the parcel they're trying to resell.

**The deal-killer is that AcreOS, sold as a closing platform, fails silently at post-closing.** Silent failure in this domain is materially worse than loud failure — at least with loud failure the operator knows to call the county. Silent failure means the operator finds out from the buyer's attorney 11 months later, which is also two months past the typical state's recording-priority cutoff for protecting the buyer against intervening liens.

**The fix is the six-week sprint outlined below. The risk if it doesn't ship: every Land Investor running ≥50 deals/year on AcreOS will, within their first year of operation, build their own post-closing tracker outside AcreOS, and at that moment AcreOS becomes one of three tools they use instead of the system of record.**

### Six-week sprint to close the day-2 ops gap

**Week 1 — recording package + instrument capture (foundation).**
1. New `recording_packages` table, joined to deals + generated_documents.
2. Required `recordedInstrumentNumber`, `recordedDate`, `recordedBookPage` fields on the closing checklist.
3. Post-closing panel in deal-detail UI replaces the current single checklist row.
4. Auto-create a recording package when checklist `execute-closing` flips to done.

**Week 2 — Simplifile integration (happy path).**
5. API client + webhook receiver (idempotent, per Hessam §2.4 pattern).
6. Pre-flight document validation (margins, page size, required fields).
7. One-click "Submit to Simplifile" button on the recording panel.
8. PDF retrieval after recording, pinned to S3.

**Week 3 — county-specific addenda generators.**
9. `generateCAPCOR(propertyId, dealId)`.
10. `generateNYRP5217(propertyId, dealId)`.
11. `generateWAREETAffidavit(propertyId, dealId)`.
12. `generateFLDR219(propertyId, dealId)`.
13. `generatePARTSStatement(propertyId, dealId)` (REV-183).
14. `generateGAPT61(propertyId, dealId)`.

**Week 4 — county fee data expansion + rejection workflow.**
15. Populate `countyRecordingFees` for top 200 counties by Land Investor volume — AcreOS already knows from telemetry which counties its users hit.
16. Add `phoneNumber`, `recordingDeskHours`, `requiredAddenda` fields to county records.
17. Rejection event log + standardized reason codes.
18. Re-submission workflow.

**Week 5 — SLA timers + alerts.**
19. `checkPostClosingSLAs` daily job.
20. Tiered alerts (closing+2 / +5 / +10 / +30) into operator inbox + email + push.
21. Stuck-file dashboard for the org owner.

**Week 6 — post-recording delivery + ePN second integration.**
22. `postRecordingDelivery` job (recorded PDF to all parties, delivery receipts, "Closing Complete" packet).
23. ePN integration for the ~6-8% of counties Simplifile doesn't cover.
24. Paper fallback workflow with USPS Priority tracking input.

That sprint takes AcreOS from "abandons the file at signing" to "closes the file in 80% of US counties without operator touch and tracks the other 20% to recorded status." That is the bar at which the product can honestly call itself a closing platform.

---

## Closing note

The bones for post-closing are not present yet — and the absence is hard to see from the outside because the pre-closing surface is so well-built that customers will assume the post-closing surface exists at parity. It does not. What exists is three checklist line items and a fee-estimator service.

The good news: nothing about closing this gap requires new architecture. The state document config is the right shape; it just needs more state-specific addenda. The county fee table is the right shape; it just needs more rows. The closing checklist is the right shape; it just needs more granular post-closing steps and SLA timers. The e-sign flow is the right shape (after Marguerite's seven-day sprint); it just needs the recorded-PDF retrieval lifecycle bolted on after the signed-PDF lifecycle.

Six weeks of focused work — items 1-24 above — and AcreOS becomes one of two or three LandTech products in the market that handle post-closing as a first-class surface. Without those six weeks, AcreOS will be the product that Land Investors love until their fourth quarter of operation, when they discover the deed-tracking spreadsheet they've been keeping is the actual system of record for the only part of the workflow that matters financially.

— Esther Prendergast
