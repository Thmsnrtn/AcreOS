# RON Acceptance & Notary Compliance Audit — AcreOS

**Author:** Eulalia Safadi — 46, founder of a 30+-state Remote Online Notarization (RON) provider, sister-of-record to a county recorder in Maricopa, AZ. Wave 3 of the deeper audit.
**Date:** 2026-05-01
**Lens:** "E-sign and RON are not the same product and they are not the same regulator. ESIGN gets you a typed name and an IP address. RON gets you a commissioned officer, a recorded video, an identity-proofed signer, and a journal entry that survives a 10-year audit by the Secretary of State. Land deeds need the second one. Most platforms ship the first and call it done — that's how you build paper that won't record."
**Read in full:** `server/services/stateDocumentConfig.ts:34-77, 79-405, 409-470` (state config + fallback), `server/services/titleChainService.ts:513-524` (the only RON mention in the codebase — and it's a *tip string*), `server/services/eSigningService.ts`, `server/routes-public-sign.ts:96-160`, `client/src/pages/sign-document.tsx:192-289`, `client/src/components/signature-capture.tsx`, `shared/schema.ts:4757-4842` (signatures table — no notarization columns), and `docs/exhaustive-completion/elite-team-deep-2026-05-01/marguerite-esign.md` (Wave 2 e-sign baseline).

---

## 1. One-line verdict

**AcreOS today has zero RON capability and treats notarization as a checkbox attribute on a state config row.** The native e-sign flow (per Marguerite, Wave 2) is *separately* legally thin; layered on top of that is a complete absence of any notary-officer flow, identity-proofing pipeline, audio-video recording capture, electronic notary journal, or jurisdictional enforcement of where RON is even legal. The single string `notaryRequired: true` on 17 state configs is treated as advisory text on a UI page (`state-documents.tsx:118`), not as a *gate* that blocks dispatch. The expert-tip in `titleChainService.ts:523` literally tells operators "RON available in most states" while the platform itself ships nothing of the sort. **Until RON is either built or explicitly out-of-scope with hard guards, every deed AcreOS dispatches into a notary-required state is paper that an operator must take to a third-party notary off-platform — and the platform doesn't tell them that, capture proof of it, or refuse to mark the document `signed` without it.**

---

## 2. RON vs IPEN vs E-Sign — the distinction AcreOS collapses

Three legally distinct things that AcreOS conflates into one "signature":

| Modality | What it is | Statute family | AcreOS support today |
|---|---|---|---|
| **E-sign** (ESIGN/UETA) | Electronic mark of intent on a record. No officer involved. | 15 USC §7001, UETA §§1-21 | Native + Dropbox Sign — see Marguerite Wave 2. |
| **IPEN** — In-Person Electronic Notarization | Signer physically present in front of commissioned notary; signature and seal applied electronically. | State notary acts (e.g. FL §117.021, TX Gov §406.084) | **None.** No notary user role exists. |
| **RON** — Remote Online Notarization | Signer and notary in different physical locations, connected by audio-video; identity proofed by KBA + credential analysis; session recorded; e-seal applied. Requires the *notary* to be commissioned in a RON-authorizing state. | State RON acts (e.g. VA §47.1-6.1 — first in 2011; FL §117.201-305; TX Gov §406.101-110; revised UETA-style state RON acts in 40+ states by 2026) | **None.** No A/V capture, no KBA integration, no credential analysis, no notary journal. |

The platform's `notaryRequired: true` flag does not distinguish among (a) wet-ink notary in physical office, (b) IPEN, (c) RON. A buyer signing a NM deed remotely from California has fundamentally different available paths depending on whether the notary is NM-commissioned (offering RON to an out-of-state signer is permitted in most states *if the document concerns property in the notary's commission state*), and the platform exposes none of that branching. The dispatch flow accepts the signature, marks `status='signed'`, and ships an artifact that **a county recorder will reject** because the acknowledgment block is unfilled.

---

## 3. State-by-State RON Acceptance — what the audit found vs reality on May 1, 2026

Per the IAEN/NNA tracker as of Q1 2026, RON is permanently authorized by statute in **44 states + DC**; six states have temporary or limited RON authority (CA SB-696 partial, NY ESRA + temporary EO carryover, SC partial, GA partial-statute pending, MA pilot, GA-pending). Six states' recorders have additional *acceptance* quirks separate from the *authorization* statute — i.e. RON is legal but the county recorder may bounce the document if the e-seal/audit-trail format doesn't match the state's standard.

### 3.1 The 17 states with `notaryRequired: true` in `STATE_DOCUMENT_CONFIGS`

Mapping each against RON statute as of May 2026:

| State | Witnesses req. | RON statute | RON-friendly recorders | AcreOS today |
|---|---|---|---|---|
| AL | 2 | Act 2021-326, eff. Mar 2022 | Mixed by county | Silent — no RON path; witness-flow also missing (Marguerite §3.6) |
| AZ | 0 | ARS §41-371 et seq., eff. Jul 2020 | Yes, statewide | Silent |
| **CA** | 0 | SB-696 (2024) — limited rollout, full effective Jan 2030; AB-2424 partial | **Mixed — many CA recorders still reject RON** | Silent. Marguerite §3.3 caught this for CA specifically. |
| CO | 0 | CRS §24-21-514.5, eff. Jan 2021 | Yes | Silent |
| **FL** | 2 | §117.201-305, eff. Jan 2020 (oldest modern RON statute) | Yes — FL is RON-mature | Silent. Witness count of 2 means RON session must include 2 *electronic witnesses*, which AcreOS has no concept of. |
| **GA** | 2 | HB 334 partial (2024); full GA RON statute pending | Mixed — many counties reject | Silent |
| ID | 0 | Idaho Code §51-114, eff. 2020 | Yes | Silent |
| MI | 0 | MCL §55.265 et seq., eff. 2018 | Yes | Silent |
| MO | 0 | RSMo §486.1100 et seq., eff. 2021 | Yes | Silent |
| NM | 0 | NMSA §14-14A-13, eff. Jan 2022 | Yes | Silent |
| NV | 0 | NRS §240.181 et seq., eff. 2018 | Yes | Silent |
| **NC** | 1+2 (2 for deeds) | SB-552 (2023), eff. Jul 2024 — **expired sunset and re-enacted; check effective rules** | Mixed | Silent |
| OH | 0 | ORC §147.60-66, eff. Sep 2019 | Yes | Silent |
| OR | 0 | ORS §194.305 et seq., eff. Jan 2022 | Yes | Silent |
| **TX** | 0 | Tex. Gov. Code §406.101-110, eff. Jul 2018 | Yes — TX is RON-mature | Silent. Marguerite §3.2 caught state-content gaps separately. |
| **WA** | 0 | RCW §42.45.280, eff. 2020 | **Mixed — King County and a handful of others have rejected RON deeds with non-WA-commissioned notaries** | Silent |
| WY | 0 | W.S. §32-3-101 et seq., eff. Jul 2021 | Yes | Silent |

### 3.2 The bigger problem: states **not** in `STATE_DOCUMENT_CONFIGS` at all

The fallback config (`stateDocumentConfig.ts:418-425`) auto-generates `notaryRequired: true, witnessCount: 0` for every state not explicitly listed. That sweeps up:

- **NY** — RON authorized by S1780C (eff. Jan 2023) but *NY ESRA* (per Marguerite §3.1) carves out negotiable instruments. RON for a NY deed is legal; RON for a NY promissory note is not necessarily safe.
- **IL** — RON Act eff. Jul 2022 but IL recorders quirky on out-of-state notaries
- **PA** — Act 97 eff. Oct 2020, but PA Department of State's seal format is strict
- **VA** — first RON state in the country (2011), the most mature; AcreOS treats it as fallback default
- **MA** — pilot only, RON not generally authorized for deeds as of May 2026
- **SC** — partial; deeds specifically require IPEN or wet-ink

**Action**: every state with `notaryRequired === true` (which today is *every state*, because the fallback default is `true`) needs an explicit `ronStatus: 'authorized' | 'partial' | 'pending' | 'unauthorized'` and `ronAcceptanceByRecorder: 'wide' | 'mixed' | 'narrow'` field. No deed gets dispatched to a `'unauthorized'` or `'narrow'`-recorder state via a remote-only flow without the operator seeing a hard block.

---

## 4. Identity Verification — the gap that voids a notarial act

A RON statute, in every state that has one, requires the notary to identify the signer by **two of three** methods:

1. **Personal knowledge** (notary actually knows the signer) — does not apply remotely
2. **Credible witness** — sworn third party — does not apply in most RON flows
3. **Multi-factor identity proofing**:
   - **KBA (Knowledge-Based Authentication)** — minimum 5 questions from public/proprietary records, signer must answer 4 of 5 correctly within 2 minutes, and may not retake within 24 hours of failing
   - **Credential analysis** — automated forensic check of the government ID (driver's license, passport): hologram, microprint, MRZ checksum, expiration, photo-vs-selfie biometric match

AcreOS today does **none** of this. The `signature-capture.tsx` component asks for a free-text "full legal name" (Marguerite §6) and that is the entire identity story. Compare to what FL §117.295 *requires* the notary to do before applying the e-seal:

- Verify identity by personal knowledge OR by KBA + credential analysis
- Confirm the signer is physically located in a permitted jurisdiction (most states allow signer-anywhere; a few — NV, MT — limit)
- Record the entire A/V session for **10 years** (FL), 7 years (TX), 5 years (most other states)
- Make a journal entry capturing: date/time, document type, identification method, fee charged, location of signer (state-level granularity), and any unusual circumstances

**Concrete consequence:** if AcreOS today shipped a deed signed via the native flow into Florida, and someone later contested it on identity grounds, the document is not just "weakly evidenced" (Marguerite's framing) — it is **not a valid notarial act under FL law**, full stop, because no notary participated. The county recorder would reject it on intake; if it slipped through and was challenged later, the deed is voidable for lack of acknowledgment.

The KBA stack to integrate (industry standard providers): LexisNexis InstantID Q&A, Equifax IDology, Experian CrossCore. Pricing is $1.50–$3.00 per signer, per attempt. Credential analysis providers: Mitek, Jumio, Onfido. Pricing is $0.75–$2.00 per scan. **A real RON session costs the platform $5–$10 in identity-proofing alone, before notary fee.** This is why most e-sign-only platforms decline to enter the RON market — the unit economics force a per-document fee model rather than a flat subscription.

---

## 5. Audio-Video Recording — the artifact that turns a signature into a notarial act

Every state RON statute requires the *entire signing session* to be recorded as a single A/V file, retained by the notary (or an authorized custodian) for the statutory retention period. Required to be captured:

- Signer's face and government ID, both visible at sufficient resolution to read the ID
- Audio of the notary asking the KBA questions and receiving answers
- Audio of the notary asking "do you sign this freely and voluntarily?" and the signer answering yes
- The act of signing (cursor-on-document or signature-pad-stroke visible in screen capture)
- The notary applying the e-seal

The recording must be:
- **Unedited** (timestamps matching real time; no cuts)
- **Tamper-evident** (cryptographic hash of the file, ideally chained to a notary-journal entry hash)
- **Retrievable on subpoena** within 5–10 business days in most states

AcreOS schema: `signatures` table (`shared/schema.ts:4811-4842`) has no `sessionRecordingUrl`, no `sessionRecordingHash`, no `recordingDurationSec`, no `recordingRetentionUntil`. The Dropbox Sign integration has no comparable artifact — Dropbox Sign is e-sign, not RON, and does not generate an A/V session recording at all. Even if AcreOS contracted with a RON provider tomorrow (Notarize, Proof, BlueNotary, OneNotary, Stavvy), the schema has nowhere to land the recording reference. **Add `notary_sessions` table** with: `id, signatureId (FK), notaryId, notaryCommissionState, ronProvider, sessionStartedAt, sessionEndedAt, recordingUrl, recordingSha256, kbaProvider, kbaPassedAt, credentialAnalysisProvider, credentialAnalysisPassedAt, signerLocationState, journalEntryId, retentionUntil`.

---

## 6. Electronic Notary Journal — the official record AcreOS doesn't generate

A notary journal (in every state with notary statutes — all 50) is a chronological log of every notarial act the notary performs, retained for the duration of the commission plus 5–10 years. For RON, the journal is electronic and must capture:

- Sequence number (monotonic, per-notary, no gaps)
- Date, time, and time zone of the act
- Type of notarial act (acknowledgment / jurat / oath / copy certification)
- Title or description of the document
- Name and address of each principal signer
- Identification method used and details (KBA passed Y/N, credential analysis result, ID type and number — *but **not** ID number stored in plaintext under most state rules; hash or partial-mask*)
- Fee charged
- Notary's seal-application timestamp
- Signer's location state at time of signing

The journal is **the notary's** record, not the platform's. But AcreOS today has no notary user concept at all (no `users.role === 'notary'`, no `notary_commissions` table linking a user to (state, commission-id, expiration, e-seal-cert-thumbprint), no per-notary journal sequence counter). If AcreOS decides to operate as a RON platform itself rather than re-selling a third party — which is almost certainly the wrong choice for a Year-1 founder, but it's the question that matters here — every one of these tables has to exist, plus a Secretary-of-State-specific export format because notary commissions are audited by SOS in most states and the journal export must match the SOS template.

---

## 7. Jurisdictional Compliance — where RON is + isn't valid

Three layered jurisdictional questions, all of which AcreOS gets wrong by default:

### 7.1 The notary's commission state

The notary must hold an **active RON commission** from a state that has authorized RON. A wet-ink notary commission is *not* the same as a RON commission in most states — the notary must take a separate course, pass an exam, post a bond, and register with the SOS as a RON-authorized notary, plus register the e-seal certificate's thumbprint. AcreOS has no `notary_commissions` table; it has no concept of which commission state is appropriate for a given document.

The rule of thumb across states: the notary's commission state must accept RON, AND the document must concern a transaction that the notary's commission state allows them to notarize. For deeds concerning real property, all 44 RON states allow their commissioned notaries to notarize a deed for property located in *any* US state — but the *recording* state's recorder may reject if local rules require an in-state notary (rare for RON, common for IPEN historically; check WA, GA, SC).

### 7.2 The signer's physical location at signing

Most state RON statutes allow the signer to be physically located *anywhere* (including outside the US, with extra constraints — e.g. military bases, embassies). Three quirks:

- **Some states** (NV §240.1655) limit RON for *military signers abroad* differently from civilian signers
- **CFPB and OFAC sanctions** apply: a signer located in a sanctioned jurisdiction (Iran, North Korea, parts of Ukraine) cannot lawfully transact, and the notary is on the hook for declining
- **Confirming signer location** requires geolocation by IP + signer self-attestation; the AcreOS platform captures neither the IP-derived location nor a self-attestation of state-of-physical-presence

### 7.3 The recorder's acceptance

Even when (1) and (2) are satisfied, the **county recorder** in the property state may have its own quirks:

- **Format**: the e-seal file format (PDF/A with embedded XAdES signature is the most widely accepted; some recorders still require PDF/A-2B specifically; some require PKCS#7 detached signature)
- **Cover sheet**: many counties require a state-specific cover sheet that must be printed, scanned, and re-attached
- **e-Recording vendor**: most CA, FL, TX urban counties accept e-Recording via Simplifile, CSC, or ePN; rural counties often reject and require physical mailing of the printed signed PDF

The platform has zero visibility into recorder-level acceptance. Adding a `county_recorder_profiles` table (state, countyFips, eRecordingVendor, acceptsRON, acceptsIPEN, requiresPhysicalCoverSheet, lastVerifiedAt) is a 2-week side project, but the alternative is shipping deeds that won't record and finding out from the customer.

---

## 8. The RON Roadmap — Two Tracks

### Track A — "Out of scope, but visibly" (1 week)

The honest minimum: AcreOS does not offer RON, does not pretend to, and refuses to mark a notary-required document as `signed` without external proof.

1. **Day 1**: Add `notarizationStatus` enum to `generated_documents`: `not_required | required_pending | externally_notarized | ron_completed`. Default to `not_required` unless `STATE_DOCUMENT_CONFIGS[state].notaryRequired === true` and `documentType ∈ {deed, deed_of_trust, mortgage, security_deed}`.
2. **Day 2**: When `notarizationStatus === required_pending`, the `markSigned` transition (`routes-public-sign.ts:152-158`) is **blocked**. The status instead transitions to `awaiting_external_notarization`. Operator must upload a notarized PDF + acknowledgment block before `signed` is reached.
3. **Day 3**: Public sign page (per Marguerite §6) gains a state-aware banner: "This document requires notarization in [State]. Your electronic signature is captured here, but the document cannot be recorded until a notary public completes the acknowledgment in person or via Remote Online Notarization." Block the "Apply signature" button entirely if `ronStatus === 'unauthorized'` for the property state.
4. **Day 4**: Operator-side "external notarization upload" flow: PDF upload + structured fields (notary name, commission state, commission expiration, RON-Y/N, notary seal image, journal-reference). Validate that commission state is in the RON-authorized list if `RON-Y`.
5. **Day 5**: Title-chain expert tip (`titleChainService.ts:521-524`) loses the "RON available in most states" prose. Replace with: "Notarization is the seller's responsibility. Use a RON provider (Notarize, Proof, OneNotary, BlueNotary) if remote — verify your county recorder accepts the chosen provider's e-seal format. Upload the notarized PDF here when complete."
6. **Day 6**: `STATE_DOCUMENT_CONFIGS` extension — add `ronStatus` and `ronAcceptanceByRecorder` to every state. Default fallback flips to `ronStatus: 'unknown'`, which gates as `'unauthorized'` until manually verified.
7. **Day 7**: Audit-log entries for every transition through the new states. The chain is: `dispatched → opened → e-signed → awaiting_external_notarization → externally_notarized → recorded`.

**Result after Track A**: the platform stops shipping un-notarized deeds with `signed` stamps. Operators have an explicit, blocking workflow for the notary step. AcreOS doesn't pretend to do RON; it makes the gap visible and fillable.

### Track B — "Re-sell a RON provider" (4–6 weeks)

The right Year-2 move: AcreOS embeds a partner RON provider via API. Recommended candidates and rough integration cost:

| Provider | Strengths | API maturity | Per-session pricing (2026) |
|---|---|---|---|
| **Proof (formerly Notarize)** | Largest network of RON notaries, all 50 states reachable, mature recorder relationships | Excellent — REST + webhooks | $25 (consumer) / negotiable bulk |
| **OneNotary** | Lower price, growing network, good API | Good | $15–$25 |
| **BlueNotary** | Strong UI/UX, KBA + cred-analysis bundled | Good | $25 |
| **Stavvy** | Real-estate-vertical focus, integrates with title software | Excellent for RE | $30 + setup |

Integration shape (4-6 week build):

1. **Week 1**: Provider selection + contract. Sandbox API access. New `notary_sessions` table per §5. New `notary_session_events` (provider webhook log, idempotent — see Hessam §2.4 / Marguerite §4 for the shape).
2. **Week 2**: Dispatch flow extension — when `notarizationStatus === required_pending`, operator can choose "Send to RON" instead of "Notarize externally." This calls the provider's `POST /sessions` with the document PDF, signer email + phone, and document metadata. Provider returns a session URL + ID.
3. **Week 3**: Signer flow — signer receives provider-branded email (or AcreOS-branded white-label if the provider supports it; OneNotary, Stavvy do, Proof does for enterprise tier only). Signer completes KBA + cred-analysis + A/V session with provider's notary. Provider webhook fires on completion.
4. **Week 4**: Webhook handler — atomic claim, fetch the signed-and-sealed PDF from provider, fetch the A/V recording reference, persist to `notary_sessions`. Transition document to `ron_completed`. Generate AcreOS completion certificate (per Marguerite §4 item 7) including RON session metadata.
5. **Week 5**: Recorder integration — for documents in counties with e-Recording (Simplifile, CSC, ePN), wire the e-Recording API. For others, generate a printable cover sheet + recording packet.
6. **Week 6**: QA on a real deed in three states (TX, FL, CA — covering RON-mature, witness-required, and partial-RON respectively). Recorder feedback loop. Fix recorder-rejection edge cases.

**Result after Track B**: AcreOS becomes a vertically-integrated land-deal platform that can take a deal from offer to recorded deed without the operator ever leaving the app. This is a moat. It is also the right scope for Year 2, not Year 1.

---

## 9. The Three Things I Would Tell Thomas Today

1. **Stop the bleed first.** Track A is one week of work and it stops the platform from quietly shipping un-recordable deeds. Do that before any feature work that depends on "the document is signed."
2. **Don't build RON in-house.** A RON provider is a regulated entity in every state it operates — bonded, insured, audited by the SOS, with a network of commissioned notaries the platform doesn't manage. The build-vs-buy math is not close. Re-sell Proof or OneNotary; integrate; resist the urge to disintermediate.
3. **Accept that 6 of 50 states will be hard.** CA RON is partial until 2030; NY has the ESRA negotiable-instrument carve-out; SC requires IPEN for deeds; MA pilot-only; GA pending; WA recorder-quirky. For these, AcreOS has to either (a) accept the user must do an in-person notary off-platform and let the platform reflect that gracefully, or (b) decline to operate in that state for deeds. Both are defensible — pretending the platform handles all 50 isn't.

---

## Closing Note

The Wave 2 e-sign audit (Marguerite) closed with "AcreOS today can answer two of the five ESIGN elements confidently." For RON, the analogous score is zero of five — there is no notary, no identity-proofing, no A/V capture, no journal, no jurisdictional gating. The platform's `notaryRequired: true` flag is a label on a UI page, not an enforcement boundary. That is fine for Year 1 if and only if the platform refuses to mark notarization-required documents as `signed` without external proof. It is not fine to ship as-is, where a deed in Florida marks itself signed off a typed name and an IP address.

The good news: RON is a solved problem in the industry — Proof has been doing this since 2011, and the API surface is mature and inexpensive to embed. The decision is not "build or skip"; it is "embed in Year 2, gracefully refuse in Year 1." That's the right shape of the answer.

— Eulalia Safadi
