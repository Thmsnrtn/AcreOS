# E-Sign Legal Defensibility Audit — AcreOS

**Author:** Marguerite Fontaine — 12 yrs DocuSign Legal + EchoSign Compliance, Wave 2 of the 87-persona deep audit
**Date:** 2026-05-01
**Lens:** "ESIGN and UETA do not require a fancy product. They require five elements, captured every time, in a way you can prove on a Tuesday in front of a judge eighteen months later. The thing that gets contracts thrown out is never the signature; it's the gap between the signature and what surrounds it."
**Read in full:** `server/services/eSigningService.ts`, `server/services/signingTokens.ts`, `server/routes-public-sign.ts`, `server/routes-doc-system.ts:725-955`, `server/routes-elite-features.ts:240-312, 633-655`, `server/storage.ts:5638-5680`, `shared/schema.ts:4757-4842`, `client/src/pages/sign-document.tsx`, `client/src/components/signature-capture.tsx`, `server/services/stateDocumentConfig.ts`, plus Sam §5 and Hessam §2.4.

---

## 1. One-line verdict

**Legally defensible for low-stakes consumer documents (a buyer-info packet, an NDA). Not defensible for the documents AcreOS actually ships — promissory notes, deeds, land contracts.** The native flow captures four-and-a-half of the five ESIGN elements, but the ones it misses (document integrity, identity attestation) are exactly the ones that a contested signing turns on. The Dropbox Sign path is in better shape on the legal-element axis but bleeds on webhook idempotency (Hessam §2.4) and never lands the signed PDF locally. **Two weeks of focused work moves AcreOS from "could lose a $50k deed-of-trust dispute" to "would survive."**

---

## 2. ESIGN Act 5-Element Audit

ESIGN §101 + UETA §§7-12 require, for an electronic signature to have the same legal effect as a wet-ink one:

| # | Element | UETA / ESIGN cite | AcreOS native | AcreOS via Dropbox Sign | File:line evidence |
|---|---------|-------------------|---------------|-------------------------|---------------------|
| **1** | **Intent to sign** — affirmative act demonstrating signer meant to bind | UETA §2(8), §9 | **PARTIAL** | PASS | `routes-public-sign.ts:96-145` accepts `consentGiven` but **never reads/enforces it** (line 143: `consentGiven: consentGiven !== false` — silently coerces undefined→true). Client always sends `true` (`sign-document.tsx:128`). |
| **2** | **Consent to electronic records** — disclosure that signer consents to do business electronically, plus right to withdraw | ESIGN §101(c) for consumer transactions | **FAIL** | PARTIAL | No consumer-disclosure block in `sign-document.tsx`. The `consentText` (`routes-public-sign.ts:144-145`) covers binding effect, **not** the §101(c) consumer disclosure (paper-copy availability, hardware/software requirements, withdrawal procedure). |
| **3** | **Signature attribution** — process to attribute signature to the person | UETA §9 | **PARTIAL** | PASS | HMAC token binds to signerId (`signingTokens.ts:33-37`) ✓. But never confirms "you are signing as Jane Smith, jane@…". Anyone with the URL can sign. No verification of name typed vs name on file. |
| **4** | **Document integrity / association** — record of agreement linked to signature, retained without alteration | ESIGN §101(d), UETA §12 | **FAIL** | **FAIL** | No content hash captured at sign time (`schema.ts:4811-4842` — no `documentContentHash` column). Document body is mutable post-sign (Sam R2 — `routes-doc-system.ts:725-753` accepts `content` updates with no status guard). Dropbox Sign holds the immutable original on their side, but AcreOS never fetches and pins the signed PDF (Hessam §2.4) — so AcreOS's own record of the signed agreement is *not* tamper-evident. |
| **5** | **Record retention / accessibility** — capable of accurate reproduction for later reference | ESIGN §101(d)(1)(B), UETA §12(d) | **PARTIAL** | **FAIL** | `signatures.signatureData` (PNG) + `generated_documents.content` (text) preserved indefinitely ✓. But: no signed-PDF archive (Dropbox Sign side only); no completion certificate; no chain-of-custody log. Customer cannot today click "Download signed copy" and get the legally-sufficient artifact. |

**Score: 1.5 / 5 elements unambiguously satisfied.** The ones that fail (2, 4) are the elements judges look at *first* in a contested signing — because they're the elements that distinguish a real signing ceremony from someone forwarding a link.

### 2.1 Why the consent capture fails the smell test

`routes-public-sign.ts:143` reads `consentGiven: consentGiven !== false`. This means: missing field → consent recorded as `true`. Empty string → `true`. The literal `false` is the only value that records `false`. From a courtroom perspective, this is the same as no consent capture at all — the field's value is a function of what the *client* sent, and the server cannot distinguish "user clicked the box" from "user's browser dropped the field." A defending attorney who deposes the AcreOS engineer who wrote that line walks away with the case. Replace with `consentGiven: consentGiven === true` and require the client to send it explicitly; reject the request if absent.

The hard-coded `consentText` (line 144) also has no version, no `consentTextHash`, and no link to the consent-text version that was *displayed to the signer*. Best-practice: store both the rendered text the user saw (denormalized into the `signatures` row) and a hash of it. If you ever change the text, every prior signature still has a verbatim record of what was agreed to.

---

## 3. State Variant Gaps

UETA was adopted by 47 states + DC. The three holdouts (NY, IL, WA) have their own statutes. Real-estate transactions add a layer of state-specific quirks on top.

### 3.1 New York — `server/services/stateDocumentConfig.ts:409`

NY is the largest gap. NY adopted the **Electronic Signatures and Records Act (ESRA, NY State Tech Law §301-309)** *instead* of UETA. Material differences AcreOS does not handle:

- **NY State Tech Law §307** carves out wills, trusts, health-care proxies, and **negotiable instruments** from electronic-signature validity. A promissory note can be argued to be a negotiable instrument under NY UCC §3-104 — meaning AcreOS-signed notes from a NY borrower may be legally void on their face.
- **NY Real Property Law §309-a / §309-b** requires acknowledgment-style notarization for any deed or mortgage; the form of acknowledgment is statutorily prescribed. A canvas-drawn signature is not an acknowledgment.
- **NY exists only as a label in `STATE_DOCUMENT_CONFIGS_FALLBACK`** (`stateDocumentConfig.ts:409`) — there's no full config object. The flow `getStateConfig("NY")` returns the auto-generated fallback (`:425` `notaryRequired: true, witnessCount: 0`), which is wrong on at least three counts (negotiable-instrument carve-out, acknowledgment form, NY-specific recording-tax disclosures).

**Action: do not enable native e-sign for NY-state documents until a NY-specific config + carve-out logic exist. Block at the dispatch endpoint.**

### 3.2 Texas — `stateDocumentConfig.ts:360-379`

- TX has the strictest **Property Code §5.061-5.086** for contracts-for-deed (executory contracts). The config (`:367`) flags this prose-only ("CAUTION: …") but the doc-generation pipeline does **not** enforce: 7-day right of rescission disclosure, annual-accounting disclosure, recordation within 30 days of execution. A signed contract-for-deed missing the §5.069 statutory notices is voidable by the buyer at any time.
- **TX Property Code §11.008** requires real-estate-transaction documents to include a specific 14-pt-bold disclosure about boundary/survey rights. Native e-sign embeds nothing of this.
- TX recognizes UETA (§322.001 et seq.) so the e-sign itself is fine — the *contents* of the signed doc are the gap.

**Action: state-aware doc-generator must inject §5.069 + §11.008 blocks when `state==='TX'` and document type ∈ {contract for deed, deed of trust}. Block dispatch if missing.**

### 3.3 California — `stateDocumentConfig.ts:120-139`

- **CA Civil Code §1633.1-§1633.17 (UETA)** is adopted; e-sign is fine.
- **CA SB-303 (2023)** requires that electronic signatures on residential real-estate documents include a specific consumer disclosure: name, license number of agent (if applicable), and a "you may consult an attorney" notice. AcreOS does not display this.
- **CA Civ. Code §1098 / §1098.5** requires Preliminary Change of Ownership Report (PCOR) for any deed transfer. Not blocked, not generated.
- **CA Notary Public §8205** and AB-2424 (2024) authorize **Remote Online Notarization (RON)** as of Jan 2024 — required for any in-state deed transfer that crosses the desk of a CA recorder. AcreOS has no RON integration; manual notary required, but the dispatch flow does not warn the operator.

**Action: when `state==='CA'` and doc is a deed, dispatch must surface "California requires notarization before recording — this signature is not sufficient." Add SB-303 disclosure block to the public sign page.**

### 3.4 Illinois — fallback config only

IL adopted **UETA in 2021** (replacing the older Electronic Commerce Security Act). Modern IL config doesn't exist in `STATE_DOCUMENT_CONFIGS` — falls back to the generic. IL recording fees + transfer-tax structure are wrong in `stateDocumentConfig.ts:484-489`.

### 3.5 Washington — fallback config only at `:381-396`

WA adopted UETA in 2020 (replacing the 1996 Washington E-Auth Act). Config exists but is thin. WA's quirk: **RCW 64.04.020** — deeds must be acknowledged before "an authorized officer" — interpreted by some county recorders as excluding remote online notarization unless the signing was done under WA RON (RCW 42.45.280, effective 2020). Signaling missing.

### 3.6 The four other 2-witness states quietly broken

`STATE_DOCUMENT_CONFIGS` correctly flags FL (`:168 witnessCount: 2`), NC (`:308 witnessCount: 2`), AL (`:88 witnessCount: 2`). These statutory witness requirements (FL Stat. §689.01, NC Gen. Stat. §47-38, AL Code §35-4-20) are *invalidating* — a deed without the required witness signatures is void as to third parties (i.e. unrecordable) regardless of how many parties signed it. The native flow has no witness-signing concept: there's no `signers[i].role === 'witness'` enforcement, no separate witness-token generation, no UI for a witness to attest to having watched the signer sign. An AcreOS-signed FL deed today is paper that won't record. The operator has no way to know this from the dispatch UI.

**Action: when `STATE_DOCUMENT_CONFIGS[state].witnessCount > 0`, dispatch flow must require N additional witness signers before allowing send. Witness signing flow needs a "I personally witnessed [Name] sign this document on [date]" attestation distinct from the principal-signer flow.**

---

## 4. Audit-Trail Completeness

What `signatures` table captures today (`schema.ts:4811-4834`):

| Field | Captured | Quality |
|---|---|---|
| Signer name | ✓ | But typed-name on capture (`signature-capture.tsx:208-219`) is free-text; no validation against `doc.signers[i].name` |
| Signer email | ✓ | But not the email URL was *delivered* to — Sam §5 |
| Signer role | ✓ | |
| Signature image (PNG b64) | ✓ | `signatureData` |
| Signature type | ✓ | drawn / typed |
| IP address | ✓ | `routes-public-sign.ts:141` — but uses `req.ip || x-forwarded-for[0]` which is the proxy IP unless `trust proxy` is set correctly (verify) |
| User agent | ✓ | |
| Consent text | ✓ | Hard-coded, not versioned |
| Consent given (boolean) | partial | Coerces undefined→true |
| Signed-at timestamp | ✓ | `defaultNow()`; server clock — adequate |

**What's missing — the seven gaps that lose a contested signing:**

1. **Document content hash at sign time** (`signatures.documentContentHash`). Without this, the chain "this signature → this exact text" cannot be re-proven. Add `sha256(content)` column; populate inside the same transaction as `createSignature`.
2. **Token issued-at + email-of-record audit** — when was the link issued? to which email? on whose authority? `routes-doc-system.ts:931-939` constructs the URL but writes nothing to `audit_log`. If a signer claims "I never got that email," AcreOS has no record.
3. **Identity-confirmation step** — the public page renders "Signing as Jane Smith" but never *asks* the signer to confirm. Best-practice flow: a checkbox "I am Jane Smith and the email this was sent to is jane@example.com" before the signature pad becomes active. Without it, "that wasn't me" challenges have nothing to push back on.
4. **Geolocation hint** — neither captured nor displayed. Optional but cheap (Cloudflare IP→country header). Material if disputing whether signer was in-state for state-law purposes.
5. **Witness/notary slot** — `signatures.signerRole` accepts `'witness'`/`'notary'` (line 4818) but no flow generates witness signing tokens or enforces witness-count from `STATE_DOCUMENT_CONFIGS[state].witnessCount`. FL/NC require 2; GA requires 1. Native flow ignores all of this.
6. **Tamper-evident log chain** — Sam §4 noted `audit_log` has no hash chain and is overwritable. For e-sign specifically, this means a sufficiently-privileged DB user can rewrite history. Add an append-only constraint (`REVOKE UPDATE,DELETE`) and an HMAC-chained log row per signing event.
7. **Completion certificate** — the artifact courts ask for: a single PDF that contains `[document content + each signature image with signer-identity panel + audit trail (IP, UA, ts, email-of-record, document hash before/after)]`. Today this does not exist. Generated on-the-fly with `pdfkit` (already used in `routes-finance.ts:965`) is fine — just generate it at completion and pin to object storage with a content-addressed key.

### 4.1 The Dropbox Sign branch makes most of these worse, not better

The instinct is "we use Dropbox Sign for the harder stuff, so legal exposure lives over there." Read `eSigningService.ts:246-295` carefully — it's a status sync, not a signing system. AcreOS marks `generated_documents.signedAt = new Date()` *on the webhook receipt*, not the actual sign-time from the Dropbox Sign payload. So `signedAt` in AcreOS's DB is the timestamp the webhook fired, which is occasionally minutes after the actual signature, and (because the webhook handler is not idempotent — Hessam §2.4) is overwritten by every retry. AcreOS's record of "when was this signed" can drift by hours and is not the source of truth Dropbox Sign holds. In a discovery dispute, AcreOS's `signedAt` is impeachable on its face. Use `event.event_time` from the payload, not `new Date()`.

---

## 5. Document Integrity — Post-Sign Immutability Deep-Dive

This is the issue that kills AcreOS in court. Let me trace what happens today end to end:

1. Operator generates a doc → `generated_documents` row, `status='draft'`, `content` is the rendered text. ✓
2. Operator dispatches → `routes-doc-system.ts:918-925` sets `status='pending_signature'`, signers populated. No content hash captured.
3. External signer opens the link → `routes-public-sign.ts:23` returns `doc.content` (live read of the row).
4. Signer submits → `createSignature` row inserted; `signers[i].signedAt` updated; if all signed, `status='signed'`. **Content unchanged, but no hash recorded.**
5. **Anyone with operator-level access can now PUT `/api/generated-documents/:id`** (`routes-doc-system.ts:725-753`) and overwrite `content`. The `signatures` row still references the old text *conceptually* — but there's no hash to prove what the text was.

**Concrete attack scenario:** Bad-actor operator sells a 10-acre parcel for $50k via signed contract. Buyer pays. Six months later, operator edits `content` — changes the parcel description to a different (worse) parcel, or changes price terms — and re-renders the buyer-facing PDF on demand. Buyer sues. Operator says "you signed *this* document." The `signatures.signatureData` is unchanged, the `signedAt` is unchanged, the IP+UA are unchanged — but the document those reference is now the modified one. AcreOS has no cryptographic way to prove the original. **The signing was technically valid but the record is fraudulent and AcreOS cannot tell you it's fraudulent.**

**What it takes to fix, in order of effort:**

1. **15-min change**: in `storage.updateGeneratedDocument` (`storage.ts:5643`), reject any update where `existing.status ∈ {'signed','partially_signed','final'}` and the diff touches `content`, `name`, or `signers`. Allow only `status` transitions to `'archived'`.
2. **2-hour change**: add `documentContentHash text` to `signatures`. Compute `sha256(doc.content)` inside the `createSignature` call site (`routes-public-sign.ts:133-146`). Add a verification helper `verifySignatureIntegrity(signatureId)` that re-hashes `doc.content` and compares.
3. **1-day change**: server-side PDF generation at `allSigned===true`. Use `pdfkit` (already a dependency). Layout = original content + signature panel grid + audit-trail page. Hash the PDF, store hash on `generated_documents.signedPdfHash` + the PDF itself in object storage (S3-compatible) keyed by `signedPdfHash`. Read endpoints serve from object storage; mutation of the row's `content` post-sign is rejected entirely.
4. **2-day change**: integrity-verification endpoint `GET /api/generated-documents/:id/verify` that returns `{ contentMatchesHash, pdfMatchesHash, signaturesValid: [{signerId, integrity: 'ok'|'altered'}], lastVerifiedAt }`. Surface the result in the founder UI as a green/red badge.

---

## 6. Counterparty Intent Capture — Current vs Required

What `sign-document.tsx` shows the signer today (lines 192-289):

- Org name + document name (good)
- "Signing as <Name> (<role>)" subtitle (good — but no confirmation step)
- Document text in a scrollable box (good)
- `SignatureCapture` component
  - Full legal name field (free text — not pre-filled, not validated)
  - Draw vs Type tabs
  - Single consent checkbox: "I agree that this electronic signature is legally binding…"
  - Apply signature button
- Footer line: "By signing, you agree this electronic signature is legally binding… We log your IP address and browser as part of the signing audit trail."

**What ESIGN §101(c) requires for consumer transactions** (any signing where the counterparty is an individual, not a business — i.e. every seller AcreOS works with):

1. **Consent to electronic records (CER)** — must be a separate, affirmative consent *before* signing, not embedded in the binding-effect language. Must include:
   - "You have the right to receive this on paper. If you want a paper copy, [how to request]."
   - "If you withdraw consent, [consequences and how]."
   - "Hardware/software requirements: [browser, internet, ability to view PDFs]."
   - "How to update your contact email."
2. **Disclosure of the document type** with a brief plain-language summary ("This is a Promissory Note. By signing, you promise to pay $X over Y months.").
3. **Identity confirmation** — "I am Jane Smith, and I received this at jane@example.com" affirmation.
4. **Per-signature intent** — current "Apply signature" button label is acceptable but should be paired with a re-statement at click time.
5. **State-specific disclosures** — see §3 above. CA needs SB-303 block, TX needs §5.069/§11.008 inserts, NY needs the negotiable-instrument warning or the page should refuse to load.

**Concrete page redesign** (replaces lines 192-289 of `sign-document.tsx`, 30-min implementation):

```
┌─────────────────────────────────────────────┐
│ Step 1 of 4 — Confirm your identity         │
│                                             │
│ ☐ I am Jane Smith.                          │
│ ☐ I received this at jane@example.com.      │
│ ☐ I am at least 18 years old.               │
│                              [Continue →]   │
└─────────────────────────────────────────────┘
   ↓
┌─────────────────────────────────────────────┐
│ Step 2 of 4 — Consent to electronic records │
│                                             │
│ [full ESIGN §101(c) disclosure block]       │
│                                             │
│ ☐ I consent to do business electronically   │
│   and have read the disclosures above.      │
│                              [Continue →]   │
└─────────────────────────────────────────────┘
   ↓
┌─────────────────────────────────────────────┐
│ Step 3 of 4 — Review the document           │
│                                             │
│ [scrollable doc — must scroll to bottom     │
│  before Continue enables; tracked]          │
│                              [Continue →]   │
└─────────────────────────────────────────────┘
   ↓
┌─────────────────────────────────────────────┐
│ Step 4 of 4 — Sign                          │
│ [SignatureCapture component]                │
│                              [Sign now →]   │
└─────────────────────────────────────────────┘
```

Each step records its own row in the audit-trail log: `step_completed`, `step_name`, `timestamp`, `ip`, `ua`. The "scrolled to bottom" tracking is what survives a "I never read it" challenge.

---

## 7. The Legal-Defensibility Hardening Sprint (1–2 Weeks)

Ten items, dependency-ordered. Each is shippable independently but they compound.

### Week 1 — close the integrity hole

1. **Day 1 AM — block post-sign mutation.** `storage.updateGeneratedDocument` (`storage.ts:5643`): if `existing.status ∈ {'signed','partially_signed','final'}` and the update touches `name | content | signers | esignEnvelopeId`, throw `Errors.forbidden(res, "Signed documents are immutable")`. Allow only `{status: 'archived'}` transitions. **0.5 day. Closes Sam R2.**
2. **Day 1 PM — add content hash.** Migration: `ALTER TABLE signatures ADD COLUMN document_content_hash text;`. In `routes-public-sign.ts:133` and `routes-doc-system.ts:769`, compute `sha256(doc.content || '')` and pass it. Add `verifySignatureIntegrity(sigId)`. **0.5 day.**
3. **Day 2 — Dropbox Sign atomic claim + signed-PDF fetch.** Per Hessam §2.4 — `esign_processed_events` table; atomic `INSERT…ON CONFLICT`; state-machine guard on `esignStatus`; on `signature_request_all_signed`, fetch the PDF from Dropbox Sign's `/signature_request/files/{id}` and persist locally (S3 + `signedPdfUrl`). **1 day.**
4. **Day 3 — server-side completion certificate.** When `allSigned===true` (`routes-public-sign.ts:152` and `eSigningService.ts:274`), generate a PDF using `pdfkit`. Layout: cover page (org, doc name, completion ts), document body, signature panel per signer (image, name, role, signedAt, IP, UA, consent text version), final audit-trail page (HMAC-chained event log: dispatched-at, opened-at, signed-at). Hash and store. **1 day.**
5. **Day 4 — token expiry + identity attestation API.** Add `iat` to HMAC payload (`signingTokens.ts:33`); reject when `now - iat > 14d`. Add `POST /api/public/sign/:docId/attest-identity` which records the three identity-confirmation checkboxes to a new `signing_events` table. **0.5 day. Closes Sam R5.**

### Week 2 — surface + state-law coverage

6. **Day 5 — public sign page redesign.** Implement the four-step flow in §6 above. Each step writes to `signing_events`. Scroll-to-bottom tracking. State-aware disclosure block (see §7 below). **1 day.**
7. **Day 6 — state-aware disclosure injector.** New module `server/services/stateLegalDisclosures.ts` that returns, given `(state, docType)`, the array of disclosure blocks to render in step 2 + 3. Cover CA SB-303, TX §5.069 + §11.008, NY ESRA carve-outs (block the flow entirely for NY negotiable instruments + deeds), FL 2-witness requirement, NC 2-witness requirement. **1 day.**
8. **Day 7 — fill in NY, IL config + RON gating.** Replace `STATE_DOCUMENT_CONFIGS_FALLBACK` for NY, IL with full configs. Add `requiresNotarization: bool`, `requiresRON: bool` flags. Block native-e-sign dispatch with a clear UX message when set. **0.5 day.**
9. **Day 8 — audit-trail fan-out + integrity endpoint.** Wire `audit_log` rows for: signing-link dispatched (with email-of-record), signing-page opened, identity-attested, doc-scrolled-to-bottom, signed, all-signed. New endpoint `GET /api/generated-documents/:id/verify` returns the integrity check result. Surface in operator UI with green/red badge. **1 day.**
10. **Day 9 — audit-log lockdown + retention policy.** Migration `REVOKE UPDATE, DELETE ON signatures, signing_events FROM acreos_app;`. Document a 7-year retention policy for signed-doc artifacts (matches IRS substantiation + statute of limitations on contract claims in most states). Add `signed_pdf_archive` cold-storage tier. **0.5 day.**

**Total: 7.5 engineer-days.** Reviewer rotation: items 1-2 + 8 by whoever owns auth/integrity. Items 3-4 by whoever owns documents. Items 5-7 by whoever owns the public sign UX. Item 9-10 by whoever owns ops + DBA.

---

## Closing Note

The team has done the hard parts already: HMAC signing tokens with timing-safe compare; consent text captured; IP + UA + signedAt on every signature row; per-signer URL rotation; 410-Gone on expiry; canvas + typed signature with proper accessibility. The shape of a real e-sign system is here.

The gaps are not about cryptography or even product polish — they are about *evidentiary completeness*. ESIGN and UETA are ultimately rules about what a record has to look like a year after the signing, when one party says "that's not what I agreed to." The five elements aren't features; they're the questions a judge asks, in order. AcreOS today can answer two of them confidently, two with a "well, mostly," and one — document integrity — with "we trust our database." That last answer is the one that loses cases.

The 7.5-day sprint above closes the legal gap. The harder, longer-tail work — full RON integration, witness-signing flows for FL/NC, NY ESRA-compliant alternative for negotiable instruments — is post-launch. But the first sprint takes AcreOS from "exposes Thomas to personal liability the first time a deed-of-trust signing is contested" to "would survive an attorney's discovery request without embarrassment." That's the bar I'd ship at.

— Marguerite Fontaine
