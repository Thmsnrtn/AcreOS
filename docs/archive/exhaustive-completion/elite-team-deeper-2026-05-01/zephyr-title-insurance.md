# Title-Insurance Underwriter Audit — AcreOS

**Author:** Zephyr Demetriou — 53, EVP Underwriting, national title insurer (top-5 by direct premium written). 27 years on the underwriting desk; rural-land specialty group for the last 11. Wave 3 of the AcreOS audit.
**Date:** 2026-05-01
**Lens:** "I do not insure software. I insure title. The question I ask of every record AcreOS produces — every chain it reconstructs, every legal description it embeds in a deed, every Schedule B exception it parses — is a single question: *would my closer accept this and bind a policy on it?* If the answer is no, the operator standing at the closing table has paid for software that stops one step short of where the actual money changes hands. AcreOS is the closest thing to a closer-friendly product I have seen come out of LandTech. It is also one revision cycle away from being something I would actively partner with."
**Read in full:** Whitman Ashcroft (transaction attorney) §7 + §11; Marguerite Fontaine (e-sign) §3 + §5; `server/services/titleChainService.ts` (756 lines), `server/services/titleSearchService.ts` (288 lines), `server/services/legalIntelligence.ts` (193 lines — adverse possession + tax-lien context), `server/services/countyRecordingFees.ts`, `server/services/closingChecklistGenerator.ts`, `server/services/stateDocumentConfig.ts:79-525`, plus Cyril (GIS) on county-data quality and Marcus/Rina on tax-deed/quiet-title workflow.

---

## 1. One-line verdict

**For pre-offer due diligence and closer-side coordination — yes, today, with the caveats below. For binding a policy directly off AcreOS-generated artifacts — no, and it should never aspire to. The right product posture is "AcreOS feeds the title underwriter; the title underwriter binds."** What AcreOS calls a "title chain" is a public-records narrative — extremely useful as a screen, materially incomplete as a commitment basis. What AcreOS calls a "Schedule B exception parser" is a regex over OCR text — useful for triage, dangerous as the system of record. What AcreOS does *not* do — and where six weeks of focused work would change the underwriting math — is feed underwriters a structured pre-commitment package that lets us turn around a commitment in 48 hours rather than 10 days. **The path forward is not "become a title plant." The path forward is "become the best feeder system any title underwriter has ever seen."** That is a defensible product position; the other one is uninsurable in itself.

---

## 2. Title-chain quality from county data

`titleChainService.ts:126-279` — `analyzeChainOfTitle` — is the heart of the surface. It takes an event list, sorts by date, looks for unresolved liens, lis pendens, tax sales, probate events, environmental notes, conservation easements, and chain gaps where `transfers[i-1].grantee !== transfers[i].grantor`. It assigns a letter grade A-D and an `isMarketable` boolean. Cyril's audit established the upstream defect: the *event list* is reconstructed from county-recorder OCR + GIS overlays + tax-records joins, and the join keys (APN, owner name, instrument number) are wrong or missing in roughly one parcel in seven. **Garbage in, lettered grade out.**

What the analyzer gets right: the gap-detection logic (`titleChainService.ts:188-201`) is correct and is the single most-valuable thing in the file — a missing deed in the chain is the highest-frequency reason an underwriter rejects a commitment, and detecting it pre-offer saves a closing. The conservation-easement flag (`:179-184`) is correct. The tax-sale redemption-period flag (`:160-164`) is correct in *kind* but vague in *content* — "varies by state: 6 months–3 years" understates the spread (TX is 6 months for non-homestead per `legalIntelligence.ts:121`; CO is 36 months; CA is 60 months).

What it gets wrong from a binding-underwriter's perspective:

1. **No chain-length minimum.** Standard ALTA underwriting requires a **40-year chain** for residential, **60-year** for commercial / unimproved land (some carriers — including ours — require 50 for raw acreage). `analyzeChainOfTitle` accepts any event count, including a 3-event chain spanning 12 years, and assigns titleGrade=A if there are no clouds. A 12-year clean chain is not insurable; it is a chain that has not been examined long enough. **Add `chainSpanYears` and `requiresExtendedSearch: boolean` to the return type. Below 40 yr, mark uninsurable-pending-extended-search.**
2. **No name-variation reconciliation.** The grantor/grantee match is a literal `prevGrantee !== currGrantor` comparison (`:192`). "John P. Smith" → "John Smith" → "John Paul Smith" is three apparent gaps on a clean chain. Real title plants run name-variation libraries (Soundex, common-abbreviation tables, marital-name change handlers). Without this, the analyzer over-flags clean chains.
3. **No instrument-number sequencing.** A real chain examiner verifies that recorded instrument numbers monotonically increase between transfers — out-of-sequence numbers indicate a missed recording or a void/re-recorded instrument. `TitleEvent.instrumentNumber` is captured (`:65`) but never validated for sequence.
4. **Adverse-possession risk not pulled into the chain analysis.** `legalIntelligence.ts:36-52` knows that GA requires 20 years for AP, OH requires 21, NC requires 20. If the most recent transfer is 22 years ago and the property is in GA, every parcel along the boundary is a latent AP claimant. The chain analyzer never asks the question. **Cross-reference: when most-recent transfer date > state's `yearsRequired - 2`, surface "AP-window-open" as a chain note.**
5. **Probate flag is binary; quiet-title flag is missing.** `titleChainService.ts:166-169` flags probate events but not the broader **heir-property** problem — multi-generational unsegmented inheritance, common in southern Black-owned rural land and in Hispanic land-grant states (NM, CO). The cure is a quiet-title action. There is no `quiet_title_required` event type; there is no recommended-action that names the action.

**Action for the underwriting feeder:** the analyzer should output not a letter grade but a structured "underwriter packet" — chain span, name-variation flags, instrument-sequence anomalies, AP-window-open flag, heir-property suspect flag, and the public-records source provenance for each event. That packet, attached to the commitment request we receive, would let our examiners turn around a commitment in 48 hours instead of 10 days. The letter grade is consumer-facing fine; the packet is what makes the commercial relationship work.

---

## 3. AcreOS-generated legal description accuracy — Whitman §5.2 item 5 reframed

Whitman flagged that `propertyDescription` on the deed of trust template is a free-text string with no validation that it is a real legal description (`documents.ts` rendering of `propertyDescription` as-is). From the title-insurance side this is *the* highest-frequency reason recorded deeds get rejected at the underwriter's curative review — **not** at the recorder's office (recorders rarely reject for legal-description quality), but at the *next* closing, when the buyer's title company examines the chain and refuses to insure because the grantor's grant deed described "10 acres in Travis County" rather than "Lot 14, Block B, Sunnybrook Acres Subdivision, Section 2, recorded in Plat Book 42, Page 17, Travis County Records, Texas."

This is the defect that takes a parcel out of the marketable-title universe for years. It is fixable in software; it is rarely fixable post-recording.

**What AcreOS should do — three-tier validation on `propertyDescription` before any deed, deed of trust, contract for deed, or warranty deed renders:**

1. **Tier 1 — surface-form checks (1 day).** Reject pure prose ("10 acres at the corner of Smith and Jones Roads"). Require either:
   - A platted-lot pattern: `/Lot\s+\w+,?\s+Block\s+\w+/i` plus a plat-book/page reference; or
   - A metes-and-bounds pattern: presence of bearings (`/N\s*\d+\s*[°deg]/i`), distances (`/\d+(\.\d+)?\s*(feet|ft)/i`), and a closing call (`POB`, `Point of Beginning`); or
   - A government-survey pattern (PLSS): township-range-section (`/T\d+[NS]\s+R\d+[EW]\s+Sec\s+\d+/i`) — the standard for most rural Western land.

2. **Tier 2 — county-source verification (1 week).** When AcreOS pulls a parcel from county records and assigns an APN, it has access to the *recorded* legal description in the assessor's system. Surface that description in the deed-render UI as a side-by-side: "What you typed | What the county has on file." If they differ, refuse to render without operator override + override-reason logged.

3. **Tier 3 — survey-attached requirement (long-tail).** For metes-and-bounds parcels — which underwriters require for any acreage tract not within a recorded subdivision — require a recorded survey number (`/Survey\s+#\s*\d+/i` or similar) and surface a checklist item: "Recorded survey exhibit attached to deed."

**Critical: lenders' policies and owner's policies both have a *survey exception* by default** — Schedule B-II "matters that an accurate survey would disclose." That exception is removed only if a recent survey is supplied at closing. AcreOS knows this implicitly (the closing checklist mentions survey) but does not enforce: a deed of trust rendered with a metes-and-bounds description and no attached survey will get a B-II survey exception every time. The operator who thinks they have insured title actually has insured title *with* a survey exception, which means the lender carries unsurveyed-boundary risk. Surface this in the closing UI; do not let it be silent.

---

## 4. Schedule B exception handling — `parseScheduleBException`

`titleChainService.ts:286-378` is honest about what it is: a regex parser over commitment text. It tags each item as easement / restriction / mineral_rights / taxes / survey_matters / other, assigns a coarse severity, and produces an impact-on-value / impact-on-use blurb. As triage, it is fine. As the system of record for what the operator must clear before closing, it is dangerous.

What an underwriter looks at on Schedule B-II is *which exceptions can be removed by curative work, which can be insured around, and which are permanent encumbrances on title*. The parser does not draw these lines.

Specific defects:

1. **`canBeRemoved` is hard-coded.** Line 341-342: `const canBeRemoved = exType === "taxes" || exType === "restriction" ? true : false;`. This is wrong on both sides — many easements *can* be removed (an unutilized utility easement, abandoned for 20+ years, is releasable); many restrictions *cannot* (a recorded conservation easement runs with the land in perpetuity in most states). The categorical assignment by type is too coarse.

2. **No per-state mineral-rights nuance.** Mineral rights are flagged generically as "Surface rights intact, but subsurface access may be required." In TX, NM, OK, WV — severance is the default and the surface owner has *no* effective veto over subsurface entry. In a TX rural acquisition, "mineral rights" on Schedule B-II is a deal-shaping exception, not a footnote. The parser flattens this.

3. **No insurer-removability classification.** Real Schedule B-II review categorizes each exception:
   - **Standard exceptions** (every commitment has these — survey, mechanics' liens not yet recorded, taxes not yet due, parties in possession). Removable with affidavits + surveys.
   - **Special exceptions** (specific to this parcel — that 1937 easement, that 1962 restriction). Removable only by curative deed, release from grantee, or quiet title.
   - **Permanent encumbrances** (conservation easements, mineral severances, government takings). Not removable; insurance is bound subject to.

   `parseScheduleBException` does not distinguish. Add a `removability: "standard" | "curative_required" | "permanent"` field; populate from the regex tags + a small per-type lookup.

4. **No commitment-vs-policy distinction.** The exceptions on the commitment are *negotiable* until the policy issues — the buyer's attorney can demand the underwriter remove exceptions in exchange for affidavits, indemnities, escrow holds, etc. AcreOS treats the exceptions as fixed. The closing-coordination surface should let the operator mark each exception as "demanded removed," "willing to accept," "negotiating," and surface the response from the title company.

**Action:** rebuild `parseScheduleBException` as a structured classifier with the four-axis output (type, severity, removability, action-required), and surface a Schedule B negotiation board in the deal UI — one row per exception, status column, comment thread, attached curative document. This is the surface that makes AcreOS valuable to the *closer*, not just to the operator.

---

## 5. Quiet-title workflow — Marcus / Rina cross-cut

Marcus (tax-delinquent acquisition) and Rina (Florida tax-deed) operate squarely in the world of *clouded* title — title where the chain has a tax-sale event in it, where the prior owner has redemption rights that may or may not have lapsed, where heir-property questions are open, where the only path to marketable title is a quiet-title action. This is exactly the population that needs title insurance the *most* and gets it the *least*, because no underwriter binds a policy on a tax-deed-derived title without a completed quiet-title judgment in the chain.

What AcreOS has today: `titleChainService.ts:160-164` flags tax-sale events, recommends "Verify tax sale redemption period has expired." `legalIntelligence.ts:120-128` provides per-state redemption-period data. `closingChecklistGenerator.ts` includes generic title-search and title-review items.

What does **not** exist:

1. **No quiet-title action template.** A QT complaint is a state-court pleading with specific elements: legal description, chain of record, list of all known and unknown claimants (the "John Doe and all unknown heirs of …" boilerplate that is critical in heir-property states), service-by-publication affidavit, prayer for relief. AcreOS generates zero such pleadings. Whitman flagged this from the foreclosure side; it is identical in structure for QT.

2. **No service-by-publication workflow.** QT actions on tax-deed parcels require notice to all potential claimants — known by certified mail, unknown by publication in a paper of record for 4-6 consecutive weeks (state-specific). The operator has to coordinate this manually with a process server and a newspaper. AcreOS could automate the publication-notice generation, the proof-of-publication tracking, and the affidavit-of-completion artifact — all of which are filed exhibits in the QT case.

3. **No QT-judgment-recording milestone.** When the QT judgment enters, it must be recorded in the county where the parcel sits to clear the chain. The recorded judgment is the title-insurer-acceptable curative document. There is no closing checklist item for "QT judgment recorded — chain cleared as of [date]."

4. **No post-QT title commitment trigger.** Once the QT judgment is recorded, the parcel becomes insurable. AcreOS has no automated "your QT just cleared — would you like to order a commitment now?" workflow. The operator who just spent 9 months and $4-8k on a QT case should not have to remember to call a title company; the system should fire that step.

5. **Florida tax-deed specific (Rina's lens):** Florida is hybrid — the tax-deed itself does not transfer marketable title; a separate **tax-deed quiet-title** is required, and the redemption window is 24 months (`legalIntelligence.ts:122`). Florida-specific procedure: F.S. §65.071 governs the QT action on tax-deed parcels, with named-respondent service requirements that differ from the general QT statute (F.S. §65.011). AcreOS doesn't distinguish.

**Action — phased over a quarter, mirroring Whitman's foreclosure plan:**

- Week 1-2: `generateQuietTitleComplaint(state, parcelId, organizationId)` — TX, FL, GA, NC, CO first; expand quarterly.
- Week 3-4: Service-by-publication generator (publication-notice text per state) + tracker (which weeks published, in which paper).
- Week 5-6: Closing-checklist QT phase: complaint-filed → service-completed → default-judgment-or-trial → judgment-entered → judgment-recorded → commitment-eligible.
- Week 7-8: Florida-specific F.S. §65.071 path with the tax-deed redemption window watcher.
- Week 9-12: Underwriter-handoff trigger — when QT judgment is recorded, fire a workflow that pre-packages the post-QT commitment request to the chosen title underwriter.

This is the surface that takes AcreOS from "due-diligence tool for clean parcels" to "operating system for the cloud-title segment." That segment — tax-deed acquisition, heir-property cleanup, distressed-rural — is structurally the highest-margin segment in land investing, because the discount is the cure cost. AcreOS owning the cure workflow is enormously valuable.

---

## 6. Title-defect insurance product fit

Standard owner's title insurance covers title defects existing *as of the policy date*. It does not cover defects arising *after* — that is what a new policy at the next sale is for. For the AcreOS user population specifically, there are three product fits worth surfacing:

1. **Enhanced owner's policy (ALTA Homeowner's Policy / ALTA Residential Limited Coverage).** Covers post-policy events like adverse possession claims that ripen against the insured, encroachments built after closing, mechanics' liens on subsequent improvements. For a buy-and-hold land investor — Marcus, Rina, Della — this is the right product but is rarely offered by default. **AcreOS should surface "consider enhanced owner's policy" as a closing decision with the cost delta (typically 10-20% premium over standard) and the coverage delta.**

2. **Title-defect indemnity / title insurance bond.** When title cannot be cleared in time for a closing — open lien, unresolved heir, incomplete probate — but the parties want to close anyway, the underwriter may issue an indemnity (lender accepts; underwriter takes the risk and chases the cure post-closing). AcreOS should know which Schedule B-II exceptions are typically indemnity-removable and which are not, and surface this in the negotiation board described in §4.

3. **Specialty rural / unrecorded-easement coverage.** For the AcreOS population specifically — rural raw acreage — the most common claims our office sees are (a) **boundary disputes** with adjoining owners over fence lines that don't match recorded descriptions, (b) **prescriptive-easement** claims over historic ranch roads, and (c) **mineral-rights surprises** where severance is on record but the buyer didn't read past the deed. Each of these has specialty endorsements available (ALTA 9, ALTA 17, ALTA 35). AcreOS could earn referral economics by surfacing the right endorsement at the right moment in the closing flow.

**Underwriter-partnership posture:** AcreOS should not become an underwriter or a title agent (capital requirements, state licensure in 50 jurisdictions, E&O insurance, statutory deposits — a 24-36 month build before the first dollar of premium). AcreOS should partner with one or two underwriters (First American + Fidelity, or Stewart + Old Republic) and become the **best feeder system** they have. The economics are: AcreOS sends a structured commitment-request packet (chain analysis, parsed Schedule B history, title-search service output, signed deed copies, surveyor reports). The underwriter examines, binds, and pays AcreOS a commission split on the policy premium (industry standard is 50-70% to the agent of record, but a feeder split is more like 10-25%). On a $500/policy land-investor average, 20% on 5,000 policies/year is $500k/year in passive title revenue. Material business; not the main story.

---

## 7. The closer's view — what would change the inbound experience

I close my critique with the perspective of the closer who actually issues the commitment. When an AcreOS-originated transaction lands on my desk today, here is what I see:

- A deed (probably hand-modified by the operator after generation — content mutable per Marguerite §5).
- A promissory note (missing the promise-to-pay paragraph per Whitman §5.1).
- A "title search" PDF that is informational, not bindable.
- A closing-cost estimate that approximates the recording fees within 30%.
- An ad-hoc list of Schedule B negotiation points the operator typed in an email.

What I would *like* to see, and would pay AcreOS to deliver as a B2B feed:

- Structured commitment-request packet (JSON + PDFs): chain-analysis output with provenance, parsed historical Schedule B exceptions across the chain, current-owner full-name reconciliation, parcel boundary GIS export, recorded survey reference if any, prior policy reference if any.
- Deed and security instrument with cryptographic content hash + signing certificate (Marguerite §5 puts this in reach).
- Surveyor report attached and indexed.
- Disclosures pack: seller's disclosure, lead-paint disclosure if structures, flood-zone disclosure (Whitman §3 puts this in reach).
- Tax-status verification: current paid-through date from county treasurer API, redemption-period status if any tax-sale event in chain.

That packet — assembled, signed, hashable — is what would let me bind a commitment in 48 hours. Today my examiners spend 6-9 days assembling it themselves from county records. **The market for the feeder product I am describing is every title underwriter in the US, every closer at every title agency, and every lender that touches rural land. AcreOS is uniquely positioned to build it because AcreOS already touches every one of these data sources for its own product. The only thing missing is the export.**

---

## 8. Priorities — title-insurance lens

### Priority 1 — must-ship before recommending AcreOS to closers (4 weeks)

1. **Legal-description tier-1 + tier-2 validation** on every deed render (§3, items 1-2).
2. **Chain-span check + extended-search flag** for chains under 40 yr (§2, item 1).
3. **Schedule B exception four-axis classifier** + negotiation board UI (§4).
4. **AP-window-open flag** in chain analyzer when most-recent-transfer-age approaches state's AP threshold (§2, item 4).
5. **Survey-exception surfacing** in closing UI — make it impossible for the operator to think they have insured title when they have insured title-with-survey-exception (§3 final).

### Priority 2 — must-ship to own the cloud-title segment (8 weeks)

6. **Quiet-title complaint generator** for TX, FL, GA, NC, CO (§5 phased plan, weeks 1-2).
7. **Service-by-publication generator + tracker** (§5 weeks 3-4).
8. **QT-phase closing-checklist machine** with judgment-recorded milestone (§5 weeks 5-6).
9. **Florida F.S. §65.071 specialization** for tax-deed acquirers (§5 weeks 7-8).
10. **Heir-property suspect flag** — when chain shows multi-decade ownership without a deed event and state is in the heir-property belt (AL, GA, MS, NC, SC, LA, TX), surface the flag (§2 item 5).

### Priority 3 — feeder-system productization (12 weeks)

11. **Structured commitment-request packet export** — JSON + PDF bundle, signed and hashable, designed for direct ingestion by First American / Stewart / Old Republic / Fidelity (§7).
12. **Underwriter partnership** with one carrier; commission-split agreement; AcreOS-branded commitment turnaround SLA.
13. **Enhanced owner's policy** vs **standard policy** decision surface at closing with cost/coverage delta (§6 item 1).
14. **Specialty endorsement recommendation engine** — ALTA 9 / 17 / 35 surfaced when chain or parcel attributes match (§6 item 3).

### What I would *not* prioritize

- Becoming a title agent or underwriter directly. 24-36 months of regulatory build with no clear product-market-fit advantage over a partnership.
- Building a proprietary title plant. The TitlePoint / DataTrace / Property Insight oligopoly is entrenched; replication is a $50M+ project with 10-yr payback. Integrate.
- Real-time sync with county recorder systems beyond what is already architected. Cyril's audit covers this; the marginal title-insurance value of better county sync is real but small relative to the legal-description and Schedule B work above.

---

## Closing note

The work I have described is not infrastructure work — it is *connective* work. The infrastructure exists. The chain analyzer is in place. The state law data is in place. The closing checklist is in place. The piece that is missing is the discipline of **what an underwriter would do with this output, and how to structure the output so that an underwriter can actually use it.** Six-to-eight weeks of focused work on items 1-10 above takes AcreOS from "due-diligence tool that closers respect" to "feeder system that closers actively prefer to receive transactions from." That second position is the one with the partnership economics and the moat.

The cloud-title segment — Marcus, Rina, the heir-property cleanups, the tax-deed acquisitions — is structurally the segment where AcreOS can win the most. It is also the segment where a competing tool *cannot* win without rebuilding the title-chain analyzer, the legal-intelligence database, the state-document config, and the closing-coordination surface that AcreOS already has. The competitive moat for AcreOS in this segment is the depth of state-law coverage already shipped, and the only thing keeping it from being a moat is the gap between "we know this" and "we operationalize it." Close that gap and the segment is won.

— Zephyr Demetriou
