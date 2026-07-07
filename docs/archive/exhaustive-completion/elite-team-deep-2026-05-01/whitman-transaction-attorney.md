# Real-Estate Transaction Attorney Audit — AcreOS

**Author:** Whitman Ashcroft — 25 yrs RE transaction attorney, Texas + Florida bars, hundreds of seller-financed closings, tax-deeds, wholesale assignments. Wave 2 of the 87-persona deep audit.
**Date:** 2026-05-01
**Lens:** "I have sat across the desk from a thousand investors who 'just bought the form online.' Half the time the form was fine. The other half it cost them five times the legal bill they tried to save. The product I would happily put in front of a client is one that knows what it does not know — that pulls back the operator's hand at exactly the moments where moving forward without counsel turns a $40k deal into a $300k lawsuit. AcreOS gets there in some places and is naked in others."
**Read in full:** `server/services/documents.ts` (1,092 lines — the entire document forge), `server/services/stateDocumentConfig.ts:79-525` (50-state config), `server/services/usury.ts` + `server/services/usuryCeiling.ts` (two parallel usury databases), `server/services/legalIntelligence.ts:154-193` (RESPA), `server/services/regulatoryIntelligence.ts:62-300` (state disclosure metadata), `server/services/closingChecklistGenerator.ts`, `server/services/closingCostEstimator.ts`, `server/services/doddFrankChecker.ts`, `server/routes-finance.ts:480-516` (dunning), `client/src/components/required-disclaimer.tsx`, plus Marguerite (e-sign) §3-5 and Hana (tax) where they touch transfer/recording.

---

## 1. One-line verdict

**For pure land (no dwelling), seller-financed, in the 17 states with full configs — yes, with eyes open. For wholesale assignments, anything residential, anything in the 33 fallback-config states, anything in IL/OK/SC, or any borrower-default that lands in court — no, not yet.** AcreOS has built more state-aware transaction infrastructure than any LandTech tool I have seen — usury data for 51 jurisdictions, deed-type variation across 50 states, Dodd-Frank exemption logic that actually matches Reg Z citations, and a closing-cost estimator wired to county recording schedules. The bones are there. What is missing is the soft tissue: the purchase-contract layer (no TREC, no FAR/BAR, the "offer letter" is a non-binding LOI dressed up as one), state disclosure forms (zero — the metadata exists in `regulatoryIntelligence.ts` but no document is generated from it), wholesaling-license guardrails (none — the platform happily lets you wholesale in IL where you need a brokerage license without one warning), and the foreclosure / forfeiture flow when a borrower stops paying (state ends at "default_notice" string and that's it — `routes-finance.ts:485`). **Six weeks of focused work moves AcreOS from "use at your own risk" to "I would let my client run a $250k seller-financed land book on this with attorney review at execution."**

---

## 2. State-by-state purchase-contract template gaps

The single largest gap in the document forge: **AcreOS does not generate a binding purchase agreement.** What it generates is `generateOfferLetter` (`documents.ts:362-508`), which the code itself titles "LETTER OF INTENT TO PURCHASE" (line 395) and which closes with "This offer is valid for 14 days" (line 480) and a "SELLER ACCEPTANCE" signature block. That is a hybrid creature: a non-binding LOI in the headline, a binding offer in the consideration paragraph, an acceptance block at the bottom. In Texas this would be argued as either a binding contract (because seller signed an "I/We accept this offer and agree to the terms stated above" line, `documents.ts:498`) or as an unenforceable agreement to agree (because there is no mutual indemnity, no time-is-of-the-essence clause, no default remedies, no earnest-money escrow agent named, no inspection-period structure). A real attorney looks at this and says: "which is it?" The product cannot answer.

### 2.1 Texas — TREC One-to-Four Family Residential Resale Contract

For any Texas dwelling transaction the *de facto* required form is the **TREC No. 20-17** (One to Four Family Residential Resale) or **TREC No. 9-16** (Unimproved Property) — the latter is the form for raw land, which is what AcreOS ships. The Texas Real Estate License Act §1101.155 requires real-estate license holders to use TREC-promulgated forms unless the contract was prepared by an attorney for the specific transaction. AcreOS is not a license holder, so this rule does not directly bind it — but every investor *user* who is a licensee or who works with one, and every title company that closes the transaction, expects the TREC unimproved-property form. Submitting the AcreOS LOI to a Texas title company will get a callback within an hour asking for a "real" contract.

The TREC 9-16 form has eleven specific paragraphs that AcreOS does not produce: special provisions paragraph, broker's fees paragraph, settlement-and-other-expenses paragraph (specific allocation language), title objections paragraph, possession paragraph, title policy and survey paragraph (six-element ALTA structure), termination option (paragraph 7C — the "option period"), execution paragraph with statutory consumer notices in 14-pt bold, plus the §5.061 contract-for-deed disclosures if the buyer is paying in installments. None of this is in `documents.ts`. The state config (`stateDocumentConfig.ts:360-379`) flags the §5.069 issue in prose but the doc generator never injects the disclosure block.

**Action: ship a `generateTexasTRECContract` (or, more conservatively, a "Texas Land Purchase Agreement v1") that is reviewed and notarized by a Texas-licensed RE attorney before any user runs a Texas seller-financed deal through AcreOS. Or — and this is what I would actually recommend — partner with a doc-prep service (DocuSign Forms, Smokeball, or a Texas-specific shop like Texas Title Forms LLC) and integrate via API rather than generating this in-house.**

### 2.2 Florida — FAR/BAR Vacant Land Contract

Florida's analog is the **FAR/BAR Vacant Land Contract** (Florida Realtors / Florida Bar joint form), revised 2024. Same story as TX: title companies, lenders, and FREC-licensed agents expect this form. The FAR/BAR has Florida-specific clauses AcreOS does not produce: the chapter 720 HOA disclosure paragraph, the radon gas disclosure (Fla. Stat. §404.056(5) — *required* on every real-estate contract regardless of property type), the property-tax-disclosure summary (Fla. Stat. §689.261 — required for *every* residential contract, including vacant land that may be developed residentially), and most critically the **two-witness execution block** (Fla. Stat. §689.01) — without two attesting witnesses on the deed *and* on any contract that will be recorded as a memorandum, the instrument is voidable as to third parties.

The state config catches the witness-count issue at `stateDocumentConfig.ts:168` (`witnessCount: 2`) and the practice note at `:178` reads "Two witnesses are REQUIRED for valid deed in Florida. No exceptions." Good. But `generateOfferLetter`, `generateWarrantyDeed`, `generateLandContract`, and `generateDeedOfTrust` *all* emit signature blocks with one signature line per party (e.g. `documents.ts:330-335` for the warranty deed) — no witness lines, no witness attestation language. An AcreOS-generated FL deed today will not record. The operator has no way to know this from the dispatch UI. Marguerite flagged the same thing from the e-sign side; I am flagging it from the document-content side. It is the same defect.

### 2.3 California — Grant Deed + SB-303 disclosures

California is correctly flagged as a grant-deed state (`stateDocumentConfig.ts:120-139`). What is missing: the **PCOR** (Preliminary Change of Ownership Report — Cal. Civ. Code §1098), required at every recording; the **SB-303 (2023)** consumer disclosure block on residential RE documents; and the **§1102 Real Estate Transfer Disclosure Statement** — which is required for residential 1-4 unit transfers but routinely waived in vacant-land deals. The product needs to know the difference. None of this is generated. PCOR alone, missed at recording, is a $20 reject and a 2-week delay — annoying but not fatal. SB-303 missed on a contested signing is the exact thing that gets the deed rescinded.

### 2.4 The 33 fallback-config states

`stateDocumentConfig.ts:403-438` populates the missing 33 states with a default config that says, in `deedNotesForInvestors`: "Consult a local real estate attorney for [State]-specific requirements." That is the right disclaimer to put in a tooltip; it is the wrong basis for a doc generator. A user in Pennsylvania running a seller-financed installment land contract will get a generic "CONTRACT FOR DEED" template with PA in the state field, no acknowledgment of PA's strict installment-land-contract usury cap (6% civil ceiling per `usuryCeiling.ts:75` — which the doc generator does not consult), no awareness of PA's specific recording-tax structure, no PA-specific covenants. The product appears to support PA. The product does not actually support PA.

**Action: gate document generation behind a per-state "fully supported / advisory only / unsupported" flag. For unsupported states, the Generate button is disabled with an "AcreOS does not yet have attorney-reviewed templates for [State]. Use a local doc-prep service" message. For advisory-only states, the doc is generated but watermarked DRAFT — DO NOT USE WITHOUT ATTORNEY REVIEW.**

---

## 3. Disclosure-requirement gaps

The metadata is there. The execution is not. `regulatoryIntelligence.ts:62-300` knows that Texas requires `["mold", "lead_paint", "easements", "deed_restrictions"]`, Florida requires `["sinkholes", "flood_zone", "environmental_contamination", "lead_paint"]`, and so on. This data is exposed via `GET /api/regulatory/states/:code` (per the file header). What does *not* exist:

1. **No seller's disclosure form is generated.** Search the codebase: `grep -iE "(seller.{0,3}disclos)"` returns four hits — three in `regulatoryIntelligence.ts` describing the requirement, one in `routes-platform-features.ts:1106-1110` listing it as a checklist item. No `generateSellersDisclosure(state, propertyId)` function. No PDF. No questionnaire. The form does not exist; the system merely *knows it should*.
2. **No lead-paint disclosure form** — required *federally* by 24 CFR Part 35 / 40 CFR Part 745 for any pre-1978 residential property transfer. Vacant land is exempt; a manufactured home or existing dwelling on the parcel is not. AcreOS lists `lead_paint` as a required disclosure for 9 states but never asks the operator "is there a structure on this parcel?" and never produces the **EPA Form 7600-1 (Disclosure of Information on Lead-Based Paint)**. A federal HUD-EPA enforcement action carries a $19,507-per-violation civil penalty (2024 inflation-adjusted). One missed disclosure on a manufactured-home parcel is a five-figure regulatory exposure.
3. **No flood-zone disclosure** for FL/NC/TX coastal counties. Florida amended Fla. Stat. §689.302 in 2022 to require sellers to provide flood disclosure on any residential transfer (PA 2022-72). AcreOS knows from `regulatoryIntelligence.ts:100` that FL requires `flood_zone` disclosure but never generates the form.
4. **No sinkhole disclosure** for Florida (Fla. Stat. §627.7073) — required on residential transfers, voluntary on vacant land, but routinely demanded by FL title insurers as a closing condition. Catalogued in the metadata, never produced as a document.
5. **No mineral-rights disclosure** for NC (N.C. Gen. Stat. §47E-4) — material defect disclosure is required, including severance of mineral rights. A buyer who later learns the mineral rights were severed has a claim against the seller for non-disclosure. AcreOS knows about this (`regulatoryIntelligence.ts:148`), generates nothing.

**Action — six items:**

1. Add `generateSellersDisclosure(state, propertyId, organizationId)` to `documents.ts`. State-aware: pull `requiredDisclosures` from `STATE_PROFILES`, render each as a yes/no/N-A questionnaire that becomes the disclosure form when seller fills it.
2. Add `generateLeadPaintDisclosure(propertyId, organizationId)`. Conditional on `property.hasStructure === true` *and* `property.yearBuilt < 1978` *or* `yearBuilt unknown`. Use the verbatim EPA Form 7600-1 statutory language.
3. Add `generateFloodDisclosure(state, propertyId)`. Pull FEMA flood-zone code from `addressVerification.ts` (already a service) — auto-fills the form.
4. Add **disclosure-completion gate** to closing checklist. `closingChecklistGenerator.ts` should inject a `disclosure-required-${type}` checklist item per state requirement, blocking the "send-docs" item until completed.
5. Surface the gate in the deal-detail UI: a red banner "Seller's Disclosure required for [State] — not yet generated."
6. **Federal lead-paint hard block**: when `property.hasStructure === true` and either `yearBuilt < 1978` or `yearBuilt === null`, refuse to generate the warranty deed without a signed lead-paint disclosure attached. Federal preemption — this is not optional in any state.

---

## 4. Wholesaling-legality warnings — completely missing

This is the single most legally exposed surface in the product and it gets zero protection.

The dealUnderwriting service (`server/services/dealUnderwriting.ts:140-162`) computes a "wholesale" exit strategy and recommends it when the math works:

```ts
let recommended: "wholesale" | "owner_finance" | "retail" = "retail";
const wholesaleRiskAdj = wholesaleProfit; // fast, low risk
```

`fast, low risk` — that comment, in a wholesale-recommendation engine, in 2026, with the regulatory landscape we have, is malpractice in code form. **Wholesaling without a real estate license is a regulated activity that has been criminalized or restricted in at least eight states in the past four years:**

| State | Statute / regulation | What it requires | AcreOS today |
|---|---|---|---|
| **Illinois** | 225 ILCS 454/20-10 (2019 amendment to Real Estate License Act) | Anyone who completes more than 1 wholesale assignment per year as a principal must hold a brokerage license OR sell as the equitable owner with full disclosure | No warning. No license-status field. No transaction-volume tracking against the 1/year threshold. |
| **Oklahoma** | 59 O.S. §858-102 (HB-3873, effective 2021) | Anyone who advertises a property they do not own, or assigns more than 1 contract per 12 months without disclosure of equitable interest, must hold a real-estate license | No warning. Direct-mail templates (`onboarding.ts:237`) include "I take over your existing mortgage payments" — squarely the activity OK requires licensing for. |
| **South Carolina** | S.C. Code §40-57-30 (2018 amendment) | Wholesale assignments require licensure unless seller is fully informed of the assignment fee and assignee identity | No warning. `generateOfferLetter` makes no mention of assignment intent or the assignee. |
| **Tennessee** | T.C.A. §62-13-104 + 2024 AG opinion | Marketing a property to potential end-buyers before holding equitable title is unlicensed brokerage | No warning. |
| **Kansas** | K.A.R. 86-3-21 (2023) | Same — license required for repeat wholesalers | No warning. |
| **Pennsylvania** | 63 P.S. §455.301 + 2023 enforcement guidance | Active brokerage activity requires licensure; wholesaling for fees triggers it | No warning. |
| **Colorado** | C.R.S. §12-10-201 (2024 amendment) | Wholesaling beyond 5 transactions / year requires license | No warning, no transaction-count tracking. |
| **Mississippi** | Miss. Code §73-35-3 (2022 amendment) | License required for property marketing without ownership | No warning. |

The product happily computes wholesale economics, recommends the wholesale exit when it pencils, generates an "offer letter" that doubles as a wholesale-able contract (assignment-of-rights language is conspicuously absent — `documents.ts:362-508`), and leaves the user one direct-mail blast away from an unlicensed-brokerage citation. In Illinois that is a Class A misdemeanor on the first offense (225 ILCS 454/20-10(c)) and a Class 4 felony on the second.

**Action — three changes:**

1. **State gating in `dealUnderwriting.ts`**: when `recommended === "wholesale"` and the property is in an at-risk state, replace the recommendation card with a compliance warning and require user attestation: "I am a licensed [State] real-estate broker" / "I am the equitable owner via signed contract" / "I have attorney guidance for this assignment." No attestation, no recommendation.
2. **Per-org transaction counter**: track wholesale assignments per org per rolling 12 months. When count approaches state threshold (1 in IL/OK, 5 in CO, etc.), surface a banner: "You are at 4 of 5 wholesale assignments allowed in CO without a brokerage license. The 6th will require licensure or it is a regulatory violation."
3. **Assignment-of-contract template**: add `generateAssignmentOfContract(dealId, assigneeInfo)` with the per-state required disclosure block (in IL, OK, SC, TN, the assignee fee must be disclosed in writing to the seller — failure to disclose is itself a §454/20-10 violation). Today there is no assignment template; users are doing it by hand or off-platform, which means AcreOS's value-add ends right at the legal-exposure boundary.

---

## 5. Promissory note + deed-of-trust template quality

The note (`documents.ts:61-214`) and the deed of trust (`documents.ts:920-996`) are *better* than the offer letter — but each has specific content gaps that any RE attorney would catch on review.

### 5.1 Promissory note — what's missing

`generatePromissoryNote` produces a clean borrower/property/loan-terms summary plus an amortization schedule. What it does not produce:

1. **Promise-to-pay paragraph** — the actual binding language ("FOR VALUE RECEIVED, the undersigned ('Borrower') promises to pay to the order of [Lender]…"). Without this paragraph the document is not a negotiable instrument under UCC Article 3 §3-104. It is *describing* a loan, not making one.
2. **Acceleration clause** — "Upon default, the entire unpaid balance shall, at Lender's option, become immediately due and payable." Critical for foreclosure. Missing.
3. **Default + cure language** — what counts as default (30-day late? 10-day grace? both?), and the cure period. The land contract template (`documents.ts:1068`) hard-codes "Failure to make payments within 30 days of due date shall constitute default" — but this 30-day rule is *not consistent* with the note (`note.gracePeriodDays` defaults to 10) and *not state-aware*. Texas Property Code §51.002 requires 20-day default notice + 20-day cure period for any deed-of-trust foreclosure. The template ignores this.
4. **Late fee** — referenced as a field if `note.lateFee > 0` (`documents.ts:135`) but the dollar amount appears with no statutory basis. Most states cap late fees at 5% of the missed payment (e.g. CA Civ. Code §2954.5 — 6% cap; FL Stat. §697.06 — 5% cap; TX Fin. Code §349.501 — 5% cap or $25 minimum). AcreOS lets the user enter $500 on a $400 payment with no usury check. That is a 125% effective late-fee rate that any court invalidates and that, combined with interest, may push the *effective* APR above the state usury cap.
5. **Prepayment penalty / right to prepay** — not addressed at all. Default common-law rule is no prepayment without express right; the product needs to grant the right (best practice for borrower-friendly notes) or expressly carve out a penalty (with state-specific limits — TX caps at 5% of unpaid balance for the first 5 years; CA prohibits prepayment penalties on residential 1-4 family loans entirely under Civ. Code §2954.9).
6. **Choice-of-law and venue** — missing. Whose law governs? Where does suit lie? Without these, the borrower can file in any sympathetic forum and the lender is dragged across the country.
7. **"Time is of the essence" recital** — missing. Required for most acceleration clauses to bind cleanly.
8. **Notice address** — where do default notices go? The note has the borrower's last known address but no clause specifying that notices to that address are deemed received.
9. **Severability clause** — if one clause is invalid, do the rest stand? Missing.

### 5.2 Deed of trust — what's missing

`generateDeedOfTrust` (`documents.ts:920-996`) is shorter than the note. What is missing is much more important.

1. **Power of sale** — the "GRANT IN TRUST" paragraph (line 961) recites "with power of sale" — good. But there is **zero non-judicial-foreclosure procedure language**. In Texas, TX Property Code §51.002 requires the deed of trust to specify the manner, time, and place of sale, the notice requirements, and the trustee's authority. The template does not have any of this. Result: when borrower defaults, the trustee discovers the deed of trust does not actually authorize a non-judicial sale and the lender must file a judicial foreclosure suit — adding 12-18 months and $15-30k in legal fees.
2. **Substitute trustee provision** — the named trustee is in the document. What if they die, retire, or refuse to act? Standard deeds of trust include a substitute-trustee clause letting the beneficiary appoint a new trustee. Missing.
3. **Insurance, taxes, and waste covenants** — borrower's obligation to maintain insurance, pay taxes, prevent waste. The land contract template covers this in prose (`documents.ts:1068`); the deed of trust does not. So the borrower's obligation to keep current on taxes is in the contract for deed but not in the deed of trust on a financed-purchase deal.
4. **Due-on-sale clause** — missing. Without it, borrower can sell the property and the lender's security is tied to whoever now owns it. Required for any seller financing where the seller wants to be able to call the loan on transfer.
5. **No legal description requirement notice** — the template prints `propertyDescription` as a string. If the operator pastes "10 acres in Travis County" instead of a metes-and-bounds or platted lot reference, the deed of trust is recordable but unenforceable as to specific land. There is no field-level validation that `propertyDescription` is a real legal description (no "Lot X, Block Y, …" or metes-and-bounds pattern check).
6. **Notary acknowledgment** — present (line 988) but uses generic "person(s) whose name(s) is/are subscribed" boilerplate. Florida (Fla. Stat. §117.05) and California (Civ. Code §1189) require *specific* statutory acknowledgment forms. Wrong form = deed will not record. Same problem Marguerite flagged for NY ESRA: the state config has the data, the doc generator does not consult it.

**Action — for both note and DoT:** rewrite both as state-aware templates that pull the additional clauses from `stateDocumentConfig.ts` (which needs to be expanded to include `defaultCureDays`, `requiredAccelerationLanguage`, `notaryAcknowledgmentForm`, `prepaymentPenaltyMaxPercent`, `lateFeeCapPercent`). One reviewed-and-blessed-by-counsel template per state, parameterized on these fields. Today the templates are 80% generic and 20% state-aware; they need to be 30% generic and 70% state-aware.

### 5.3 Land contract — Texas §5.069 compliance

Texas contract-for-deed has the strictest statutory disclosure regime in the country. **TX Property Code §5.069** requires the seller to provide, *at execution*, a 7-day right of rescission notice, an annual accounting requirement, recordation within 30 days of execution, plus the §5.014 statutory addendum disclosing whether the property is in a special district. AcreOS's land-contract template (`documents.ts:1019-1092`) has **none** of this for Texas. The state config flags the issue (`:367` "CAUTION: Texas Property Code 5.061-5.086 imposes strict requirements") but the doc generator does not act on the flag. A non-compliant Texas contract for deed is voidable by the buyer **at any time** under §5.075 — which means buyer pays for 6 years, decides the land isn't worth it, and walks away with a refund of every payment made. The seller's only recourse is the buyer's continued possession, which can be ended at any time by the buyer. This is the worst possible asymmetry for the seller-investor.

**Action: refuse to generate a TX contract for deed without the §5.069 disclosure block injected. Better: refuse to generate a TX contract for deed at all, surface a "Use a Deed of Trust + Warranty Deed in Texas — contracts for deed are a trap for sellers" warning, and direct the user to the deed-of-trust template. The state config note already says exactly this in prose; the product should enforce it.**

---

## 6. Recording fees + transfer-tax integration

This is one of the better-built pieces. `countyRecordingFees.ts` (188 lines) plus `closingCostEstimator.ts` (100 lines) plus the per-state `transferTaxPercent` and `recordingFeeBase` fields in `stateDocumentConfig.ts` produce a credible all-in cost estimate. `routes-recording-fees.ts` exposes the data via API. `closingChecklistGenerator.ts:55-60` includes a "Record deed with county" item with a +1-day post-closing due date.

What is **not** integrated:

1. **No actual recording.** The system produces the estimate and the to-do; it does not e-record. The major county-recording aggregators (Simplifile, ePN, CSC) have APIs. The product should integrate at least one of them — probably Simplifile, which covers ~2,400 of the ~3,140 US counties for e-recording. Without this, the operator hand-walks every deed to the county clerk or mails it in. For a 50-deal/year investor this is 50 trips. This is the single highest-ROI integration AcreOS could ship for the closing surface.
2. **No transfer-tax remittance.** WA's REET (1.1-3% of sale price — `stateDocumentConfig.ts:392`), FL's documentary stamp tax ($0.70 per $100), GA's $1/$1000 — these are owed at recording. The estimator computes the amount; the system does not generate the remittance form (e.g. WA REET Affidavit, FL DR-219). For each state where the tax is non-zero, the corresponding statutory remittance form should be auto-generated and filed alongside the deed.
3. **County-level fee data is approximate.** `recordingFeeBase` is one number per state, stored at `stateDocumentConfig.ts` (e.g. AL = $18). In reality, recording fees vary significantly *by county*: Mobile County AL is different from Jefferson County AL. `countyRecordingFees.ts` has a county-aware override layer (good) but the override coverage is partial — verify which counties are populated. Where county data is missing, the estimator falls back to state base, which can be off by 30-100% for high-cost counties.
4. **No realtime data sync.** Recording fees and transfer-tax rates change. Pennsylvania raised its recording fee structure in 2024. Texas counties revise their plat-recording fees on county-by-county schedules. There is no service that re-fetches county recording fees on any cadence. Today's data is a snapshot; in 18 months it will be wrong and quietly so.

**Action — three items, in order of cost:**

1. **Integrate Simplifile** for e-recording in their covered counties. Single integration, ~2 weeks of work, replaces the manual recording trip for ~75% of US counties. The `closingChecklistGenerator` "Record deed with county" item becomes a button.
2. **Generate state-specific transfer-tax remittance forms** alongside the deed. Highest-impact states: WA, FL, NY, CT, NJ. One state per week; ship over a quarter.
3. **Quarterly recording-fee + transfer-tax data refresh job** with a state-by-state changelog visible to admins. Today's data is 2024-2025 vintage; that is fine for now but it has a half-life.

---

## 7. Title-commitment integration

There is a `titleCompany` *field* on deals (`importExport.ts:176`, `googleCalendarSync.ts:108`), and there are two "title" services — `titleSearchService.ts` (288 lines) and `titleChainService.ts` (756 lines). I expected to find an integration with one of the major title underwriters (First American, Old Republic, Stewart, Fidelity National) or with a title-search aggregator (DataTree, NETR Online, TitleVest). I do not.

What `titleSearchService.ts` and `titleChainService.ts` actually do is **construct a title-chain narrative from public records** that AcreOS already pulls (county recorder data, tax records, court records). This is excellent for due diligence — the product can show you the chain of title for a parcel from public data — but it is not the same as a **title commitment** from a licensed title insurer that the buyer's lender will require at closing. A title chain from public data is informational; a title commitment is an insurance underwriter's guarantee. Closing without one means the buyer (or buyer's lender) carries the risk of any title defect not on public record — undisclosed liens, forged deeds, missed heirs, mechanic's liens.

The `closingChecklistGenerator` correctly includes "Order title search" and "Review title commitment" items (`closingChecklistGenerator.ts:49-50`) — but these are to-dos with no execution path. The operator clicks done, manually orders the commitment from a local title company, manually reviews it, and manually checks it off.

**Action:**

1. **Integration partnership with one of:**
   - **Simplifile + First American** — bundled offering, one of the larger LandTech integrations.
   - **Qualia** — closing-platform-as-API, sophisticated but expensive.
   - **PropLogix** (now part of Stewart) — title-search-as-an-API, lower cost, narrower coverage.

   Whichever — the goal is a one-click "Order title commitment" from inside AcreOS that wires to the title company, returns the commitment PDF + exception schedule, and surfaces high-priority exceptions (e.g. unsatisfied mortgage, unpaid property tax, undisclosed easement) as alerts in the deal-detail view.

2. **Title-commitment review surface.** When the commitment comes back, the product should parse Schedule B-II exceptions and flag the ones that matter for land deals: unsatisfied mortgages, unpaid taxes, mineral-rights severance, easements that affect access. The closingChecklistGenerator should refuse to advance from "title-review" to "execute-closing" if any high-priority exception remains unresolved.

3. **Existing `titleChainService.ts` reframed as "preliminary title check."** It is genuinely valuable as a pre-offer due-diligence tool — show the operator the chain of title before they make an offer. But the UX should make clear: "this is informational, not insured. A title commitment is required before closing."

---

## 8. Note enforcement / foreclosure when borrower defaults

This is the second-largest gap, after wholesaling-license guardrails.

What exists today: `routes-finance.ts:471-516` exposes a dunning endpoint that classifies a delinquent note into one of five stages — `current`, `friendly_reminder`, `formal_notice`, `final_warning`, `default_notice` — based on `daysDelinquent`. The `agent-skills.ts:1555` reference is a one-line placeholder: `legal: "Initiate foreclosure proceedings per state law"`. That is the entire foreclosure surface.

What an actual seller-financed note workflow needs when the borrower stops paying:

1. **Notice of default (NOD) generation.** Texas requires §51.002 20-day notice; California requires §2924 90-day notice; Florida requires §697.07 acceleration notice + judicial foreclosure complaint. None of these is generated. The system tells the operator "default_notice" and stops.
2. **Cure-period tracking.** When was the NOD served? When does the cure period expire? When does the lender's right to accelerate vest? AcreOS does not track any of these dates after the dunning stage flips to `default_notice`.
3. **Trustee's sale notice (for deed-of-trust states).** TX Property Code §51.002 requires notice of trustee's sale 21 days before the sale, posted at the courthouse and mailed to the borrower. Generated by AcreOS: nothing.
4. **Judicial-foreclosure complaint template (for mortgage states).** Most-used in NY, FL, IL, NJ. Standard form per state, available from state bar form books. AcreOS produces zero such templates.
5. **Forfeiture notice (for contract-for-deed states with forfeiture remedy).** OH, MI — common land-contract states — allow forfeiture rather than foreclosure. Specific statutory notice required (e.g. ORC §5313.05). Missing.
6. **Reinstatement and accounting templates.** When the borrower cures, the lender must produce a payoff/reinstatement statement showing all amounts due. Missing.
7. **REO transition workflow.** When the foreclosure or forfeiture completes and the lender takes the property back, that property needs to flip from "note collateral" to "owned inventory" in the system, with the original note marked `foreclosed`, the property restored to inventory at fair-market or note-balance value, and a tax cost-basis recalculation (the IRS treats foreclosure-takeback as a deemed sale at the note balance — Hana flagged related issues from the tax side). The note status enum (`routes-finance.ts:56`) includes `foreclosed` but there is no service that *executes* the transition.

**This is the entire reason a sophisticated investor wants software to manage seller-financed notes. The "happy path" — borrower pays on schedule for 7 years, AcreOS tracks the amortization — is the easy part. The hard part is the ~5% of notes that go bad, where the value of the software is making the recovery process structured rather than ad-hoc. Today, AcreOS supports the happy path beautifully and abandons the user at the moment they need help most.**

**Action — phased over a quarter:**

1. **Week 1-2:** `generateNoticeOfDefault(noteId, organizationId)` — state-aware, pulls the right statutory language for the property's state. Auto-set the cure-expiration date in the note record. Surface in the dunning UI.
2. **Week 3-4:** `generateNoticeOfTrusteeSale` for deed-of-trust states (TX, AZ, CA, OR, WA, CO, GA, NC, NM, NV, ID, MO, NM, ID, UT). State-specific notice content, sale-date calculation per state's required notice period.
3. **Week 5-6:** `generateForfeitureNotice` for installment-land-contract states (OH, MI, MN, IA). Statutory form per state.
4. **Week 7-8:** Reinstatement / payoff statement generator, foreclosure-complete REO transition workflow.
5. **Week 9-12:** Per-state foreclosure-process state machine — `default_noticed` → `cure_expired` → `sale_noticed` → `sale_completed` → `redemption_period` → `final` — with date-tracking, document-generation milestones, and reminder triggers at each stage.

---

## 9. Tenant / usury laws — two parallel databases, both partially right

The product has **two separate usury databases** that do not agree with each other:

- `server/services/usury.ts:3-54` — 50-state map with a single `maxRate` field, e.g. TX = 18%, CA = 10%, MI = 7%.
- `server/services/usuryCeiling.ts:37-89` — 51-jurisdiction map with `civilCeiling`, `commercialCeiling`, `realEstateCeiling`, `sellerFinancingExemption`. TX is `civilCeiling: null` (no effective ceiling). CA is `civilCeiling: 10` *with* `sellerFinancingExemption: true`. MI is `civilCeiling: 7`.

These disagree on TX (18% vs. no cap), GA (16% vs. 7% civil), several others. An `auditOrgUsury` job (`usury.ts:106-136`) calls the *first* database; the Dodd-Frank checker UI consults the *second*. The user can fail one check and pass the other for the same proposed rate. This is exactly the "two sources of truth" problem that produces wrong legal advice in production.

The *second* database (`usuryCeiling.ts`) is more sophisticated and closer to right — it correctly captures the seller-financing exemption that exists in most states for written commercial RE notes — but it has its own gaps:

1. **Arkansas Amendment 89** — correctly flagged as 17% across all categories, no exemption (`:41`). Among the strictest in the US. Good.
2. **California seller-financing exemption** — Cal. Const. Art. XV §1 *does* exempt seller-carry where seller held title, but the statutory backing (Cal. Civ. Code §1916.1) is more nuanced than the file's note implies. The exemption is for "any person other than a person licensed as a real estate broker" who "extends credit secured by real property," provided the loan was *not arranged by a third party*. A real-estate-broker user who is also the seller may *not* qualify — the file does not capture this.
3. **Texas §302.001** — civilCeiling: null is correct for written commercial RE; *consumer* RE (residential dwelling) is capped at 18% effective. The file does not distinguish. Operator running a residential seller-finance deal in TX gets a "no ceiling" answer when the actual ceiling is 18%.
4. **Late fees + default-rate stacking** — usury law in most states treats late fees, default-rate increases, and prepayment penalties as additional interest. A note at 12% nominal + 5% late fee + 4% default-rate increase = effective 21% APR for the period of default, which can push past every state's commercial ceiling. Neither database considers stacking.
5. **Federal preemption** — the Depository Institutions Deregulation and Monetary Control Act of 1980 (12 U.S.C. §1735f-7a) preempts state usury caps for first-lien RE loans secured by 1-4 family residential property if the lender is a state-chartered or federally-chartered bank. AcreOS users are not banks, so this is a corner case, but if any AcreOS user *is* a bank or an MLO, the analysis changes entirely.

**Action:**

1. **Pick one database.** `usuryCeiling.ts` is the more sophisticated one. Delete `usury.ts` (or reduce it to a deprecation shim that calls into `usuryCeiling.ts`).
2. **Add a `consumerCeiling` field** to the unified data structure. For TX, FL, NY, CA where consumer-RE has a different cap than commercial-RE, populate it. The check function should ask: is this a residential dwelling? If yes, use `consumerCeiling`. If no (vacant land), use `realEstateCeiling`.
3. **Effective-rate calculation.** When checking a proposed rate, factor in the late-fee structure and the default-rate-increase clause (if any). Surface "your effective post-default APR is X%; your state's cap is Y%."
4. **Add state-specific seller-financing-exemption disclosure language** to the note template. When the seller relies on the exemption, the note should *recite* the exemption (e.g. "This Note is exempt from California's general usury limits pursuant to Cal. Const. Art. XV §1 because the lender held title to the subject property and is not a licensed real-estate broker"). This is the documentation that, in a contested usury claim, the lender uses to defend.

---

## 10. The "this is my legal advice" disclaimer — present in places, missing in others

`required-disclaimer.tsx` is a clean, well-structured component with four disclaimer types (`financial`, `legal`, `ai`, `valuation`). It is correctly used on the user-facing pages I'd expect: `compliance.tsx`, `cash-flow.tsx`, `negotiation-copilot.tsx` (both AI and legal), `avm.tsx`, `deal-hunter.tsx`, `dodd-frank-checker.tsx`. Good.

What does *not* carry a disclaimer:

1. **The generated PDFs themselves.** `generatePromissoryNote`, `generateWarrantyDeed`, `generateDeedOfTrust`, `generateLandContract`, `generateOfferLetter`, `generateSettlementStatement` — none of them include a disclaimer page or footer. A user generates a TX deed of trust, sends it to a borrower, and there is nothing in the document that says "this was generated by an automated tool, you should have it reviewed by a TX-licensed attorney before signing." The disclaimer exists only in the AcreOS UI, not in the artifact that leaves AcreOS.
2. **The closing checklist.** `closingChecklistGenerator.ts` produces a list of actions; one of them is "Prepare deed (Warranty Deed for Texas)" with a 7-day-pre-closing due date. There is no item "Have an attorney review the deed before signing" — even in attorney-required states like GA and NC.
3. **The dunning + default-notice flow.** When AcreOS escalates a borrower to `default_notice`, no disclaimer surfaces saying "the next steps require state-specific legal action — consult a foreclosure attorney."
4. **Email templates that mention legal actions.** `onboarding.ts:237` ships a direct-mail template that promises "I take over your existing mortgage payments — you get relief, I get the property." This is *subject-to* — a creative-finance technique that is regulated, that violates many lenders' due-on-sale clauses, and that some state bars consider unauthorized practice of law when offered by a non-attorney. No disclaimer accompanies the template. No "consult an attorney about due-on-sale risk before sending this."

**Action — five additions, all small:**

1. **Disclaimer page on every generated legal PDF.** A final page (or a footer) that reads, with org branding: "This document was generated by AcreOS based on user-supplied data. AcreOS is not a law firm. This document is not legal advice. You should have this document reviewed by a [State]-licensed real estate attorney before execution. AcreOS makes no warranty as to the legal sufficiency of this document for any specific transaction." 30-min change, applies to all six generators in `documents.ts`.
2. **Attorney-review checklist item** for any state where `attorneyStateForClosing === true` (currently GA, NC) — and added as advisory in every state for any deal-of-deed-of-trust transaction.
3. **Default-notice attorney warning.** When the dunning stage flips to `default_notice`, the UI surfaces a banner: "The next phase of collection requires state-specific legal action. We strongly recommend retaining a [State] foreclosure attorney before sending the notice of default. AcreOS can generate a draft notice; the attorney should review and execute it."
4. **Subject-to / creative-finance template warnings.** Any direct-mail template that mentions "take over payments," "subject-to," "wrap," "lease option" carries an inline disclaimer when the operator selects it.
5. **One-time first-use modal.** First time an operator generates *any* legal document in AcreOS, surface a modal: "AcreOS generates legal documents based on your inputs and our state-specific templates. AcreOS is not a law firm. Templates are starting points, not finished documents. We strongly recommend an attorney review every transaction-defining document before execution. By continuing, you acknowledge that AcreOS is not your attorney." Acknowledged once per org, stored in `org.acknowledgedLegalDisclaimer = timestamp`.

---

## 11. Recommendations to make AcreOS attorney-friendly

Six categories, prioritized.

### Priority 1 — must-ship before any production deed-of-trust closes (2 weeks)

1. **Lead-paint disclosure hard block** on warranty-deed generation when `property.hasStructure === true` and yearBuilt < 1978 or unknown.
2. **Witness-line injection** on every deed and recorded contract for FL, NC, AL — wherever `witnessCount > 0` in `stateDocumentConfig.ts`.
3. **Disclaimer page on every generated legal PDF.**
4. **Texas §5.069 enforcement** — refuse to generate a TX contract for deed; redirect to deed-of-trust template.
5. **Wholesaling-license attestation gate** in IL, OK, SC, TN before recommending wholesale exit.
6. **Unify the two usury databases.** Pick `usuryCeiling.ts`, deprecate `usury.ts`.

### Priority 2 — must-ship before scaling user count past 100 (4-6 weeks)

7. **State-specific seller's-disclosure form generator** for TX, FL, CA, GA, NC, OH (the high-volume states for AcreOS users). Five additional states per quarter after that.
8. **Notice-of-default generator** with cure-period tracking — TX §51.002, CA §2924, FL §697.07 first; rest of states phased.
9. **Notice-of-trustee-sale generator** for deed-of-trust states.
10. **Title-commitment integration** with one underwriter or aggregator. Simplifile + First American is the most-leveraged choice.
11. **Per-state state-of-support flag** on document generation. Disable for unsupported states; watermark "DRAFT — DO NOT USE WITHOUT ATTORNEY REVIEW" for advisory-only states.
12. **Promissory-note clause completeness pass.** Add the nine missing clauses listed in §5.1.
13. **Deed-of-trust completeness pass.** Add the six missing items listed in §5.2.

### Priority 3 — must-ship to be defensible at scale (3 months)

14. **TREC One-to-Four Family / TREC Unimproved Property template** for TX, attorney-reviewed.
15. **FAR/BAR Vacant Land Contract** for FL, attorney-reviewed.
16. **Simplifile e-recording integration.**
17. **Foreclosure / forfeiture state machine** — full per-state process with date-tracking and document milestones.
18. **REO-transition workflow** when foreclosure completes.
19. **Quarterly recording-fee + transfer-tax data refresh job.**

### Priority 4 — to be best-in-class (6 months)

20. **Per-state attorney partnership network.** Surface "Find an AcreOS-vetted [State] attorney" inside the platform. Refer-out for any document execution where the operator has not retained counsel. Take a referral fee or pass through; either way, the relationship makes AcreOS more legally defensible.
21. **CFPB Section 8 (RESPA) compliance scan** for any settlement statement that includes a referral-fee allocation.
22. **State-bar UPL monitoring.** When a state's bar association publishes guidance that AcreOS-style automated document generation may constitute UPL (unauthorized practice of law) in that state, the product needs to know and adapt — surface it to the user, possibly disable generation in that state.

### What I would *not* prioritize

- Building proprietary attorney-review marketplaces from scratch. Partner with LegalShield, Avvo, or per-state RE-attorney associations rather than recreating the Yelp-for-attorneys experience.
- Building a notarization service from scratch. Integrate with Notarize, Proof.com (formerly Notarize), or the per-state RON authority.
- Translating any of the above into Spanish. The UPL exposure of a Spanish-language deed of trust generated by an automated tool is materially higher than the English version because most states' notary acknowledgment statutes specifically require the document be in English unless a court-certified translator is involved.

---

## Closing note

I have written this audit as a transaction attorney would brief a client who is buying a software product to run a seller-financed land book. The honest summary: the team has built more state-aware transaction infrastructure than I have seen in any LandTech product in the past decade, and the bones are unusually good. The state document config, the usury databases, the Dodd-Frank checker, the closing-checklist and cost-estimator services, the title-chain service — these are real legal infrastructure, not marketing surface. Whoever is doing this work is doing it carefully.

The gaps are not in the bones. They are in the connective tissue between the metadata and the documents, and in the long tail of *what happens when things go wrong* — the foreclosure, the wholesaling-license citation, the lead-paint enforcement action, the contested signing. When deals close on time and borrowers pay on time, AcreOS is excellent. When they do not, AcreOS today walks the operator to the edge of a legal cliff and waves goodbye.

Six weeks of focused legal-template + foreclosure-flow + wholesaling-gate work — items 1-13 above — moves the product from "an attorney would not be embarrassed to see this in front of a client" to "an attorney would actively recommend this to a client and earn a referral fee from the related closing work." That is the bar I would ship at, and the bar at which this product becomes defensible against the regulatory wind that is already blowing through this space.

— Whitman Ashcroft
