# Title-Company Partner Audit — AcreOS

**Author:** Hartwell Chin — EVP, regional title insurance company (TX-based, FL/OK/NM affiliate offices). 19 years in title; before that, 5 years at First American on the agency side. AcreOS sends my underwriters roughly 28-32 closings/month across the four states; we are evaluating whether to deepen the integration to a multi-tenant API tier with a volume-based fee schedule and webhook event flow.
**Date:** 2026-05-01
**Lens:** "I am the back-office that AcreOS users pay $850-$1,400 per file to make their deeds record. Today I see AcreOS as a fax-and-PDF customer with unusually clean data. To go further — to put us inside their checklist UI and to wire commitments + policies back into their deal record — I need an API surface that doesn't exist yet, a security posture for wire instructions that I can defend to my E&O carrier, and a fee schedule that pays for the engineering on my side. This audit covers what would have to be true for that deal to close."
**Read in full:** Whitman's transaction-attorney audit (`whitman-transaction-attorney.md` §6 recording integration, §7 title-commitment integration, §10 disclaimers); `server/services/titleSearchService.ts` (288 lines — PropStream/ATTOM wrapper, **not** a title-commitment integration); `server/services/titleChainService.ts` (756 lines — public-records narrative, includes the wire-fraud advisory string at `:510`); `server/services/closingChecklistGenerator.ts:49-60` (the title-related to-dos that today have no execution path); `server/routes-closing.ts` (286 lines — checklist CRUD, no order endpoint); `server/services/webhookDispatcher.ts` (310 lines — outbound webhook framework, HMAC-signed, but **no** title.* event types); `server/services/closingCostEstimator.ts`; `server/services/countyRecordingFees.ts`.

---

## 1. 30-second verdict

**AcreOS today is a high-quality manual-handoff partner. Tomorrow, with six engineering deliverables, it can be a real API partner — and that's the difference between $1,150 average per file and $895 average per file at scale, plus 40% margin expansion on my side that I'd share in the form of volume rebates back to the AcreOS Treasury surface.** What I see today: clean intake data (parcels are correctly identified, sellers/buyers are correctly named, closing dates are realistic), a closing-checklist UI that already includes "Order title search" + "Review title commitment" as line items, and a webhook framework that already supports HMAC-signed outbound events with retry/backoff. What I do **not** see: a title-order endpoint, any inbound webhook for title-status events back into AcreOS, any wire-instructions delivery surface that meets ALTA Best Practices Pillar 2, any commitment/policy/Schedule-B exchange format, and any volume-pricing tier that lets a partner amortize the integration cost. The bones are right; the partner-API tier does not exist. **Six weeks of focused work moves AcreOS from "fax-and-PDF customer" to "the LandTech platform we put on our agency-marketing slides."**

---

## 2. Integration gaps — what's actually missing

### 2.1 No title-order endpoint, period

The `closingChecklistGenerator` (`closingChecklistGenerator.ts:49`) injects an `"Order title search"` checklist item with a -21-day-pre-closing due date. Excellent — that's the right calendar position. **What it does not do is order anything.** The user clicks the checkbox; on my side, I receive nothing. The actual order arrives via email from the operator's personal Gmail with a property address, an APN, and a buyer/seller name pasted into the body — same workflow my staff has been running since 2008.

There is no `POST /api/title-orders` endpoint. There is no partner registry where I can register my agency's API credentials and webhook receiver. The `routes-closing.ts` surface (286 lines) is purely internal CRUD against `dealChecklists`. Nothing leaves the system at the moment the operator marks "Order title search" complete.

### 2.2 No title-status webhooks back into AcreOS

The outbound webhook dispatcher (`webhookDispatcher.ts`) supports 25+ event types — `lead.created`, `deal.stage_changed`, `note.delinquent`, etc. **It does not support a single `title.*` event.** That is fine for outbound (the dispatcher is for AcreOS → integrators). What does not exist is the **inbound** side: I have no way to push `title.search_complete`, `title.commitment_issued`, `title.exception_added`, `title.cleared_to_close`, `title.policy_issued` back to AcreOS so it can advance the deal stage automatically.

Today my staff calls the operator at -14 days, -7 days, -3 days, and at recording. That's four phone calls per file × 30 files/month = 120 phone calls/month from my office to AcreOS users. At an average of 8 minutes per call, that's 16 hours/month of escrow-officer time on my side that should be a 200ms HTTP POST.

### 2.3 No commitment / policy document exchange

When my underwriter issues a title commitment, the deliverable is a 12-25 page PDF: Schedule A (insured + amount), Schedule B-I (requirements before closing), Schedule B-II (exceptions from coverage). The operator needs to see this **inside the deal record**, not in a separate email thread. Today I email the PDF; the operator manually uploads it to AcreOS's document drawer (if they upload it at all — half the files I close have no commitment in AcreOS's records, which means at audit time the operator cannot prove they had one).

What I'd want: a `POST /api/deals/:id/title-documents` endpoint that accepts the PDF + a structured JSON payload with the parsed exceptions (so AcreOS can surface "Exception: unsatisfied 2018 mortgage to ABC Bank — $47,200" as a red banner on the deal page, the way Whitman recommended in §7 of his audit). Same for the issued policy at recording.

### 2.4 No wire-instructions delivery surface

This is the one that gets my E&O carrier involved. The single string in the AcreOS codebase that mentions wire fraud is at `titleChainService.ts:510`:

> "Wire 24-48 hours before closing to allow verification. Confirm wire instructions by phone — never from an email alone (wire fraud risk)."

That is **advice**. There is no **mechanism**. Today wire instructions move from my office to the buyer the same way they did in 2003: a PDF attachment to an email, sometimes encrypted with a password sent via SMS, sometimes not. **Wire fraud against title companies is the #1 cybercrime loss in the US RE industry — $446M in losses in 2022 per FBI IC3, of which an estimated 60% involves spoofed wire instructions.** ALTA Best Practices Pillar 2 (effective 2024 update) requires title agents to deliver wire instructions through a "secure delivery method that authenticates both sender and recipient." A PDF over SMTP does not qualify.

The opportunity for AcreOS: build a **secure document drawer with link-based authenticated delivery** (signed URL + buyer-side identity verification + view-once semantics + audit log) and let title companies push wire instructions into it via API. That's a wire-fraud-prevention feature my carrier would give me a 5-8% premium discount for, and that would let AcreOS market itself to title companies as the **only** LandTech that has solved this. There is no current implementation; the closest surrogate is the document drawer in the deals UI, which is unauthenticated SMTP-equivalent.

### 2.5 Agent-side data quality — legal description is the recurring failure

The single piece of input data my underwriters reject most often is the **legal description**. In AcreOS, `property.legalDescription` is a free-text field, populated either from county-assessor ingest (`countyAssessorIngest.ts:340` — pulls `item.legal_description` raw from whatever the county returns) or from operator entry. The county ingest is fine when the county provides a clean metes-and-bounds or platted-lot description. It is **not** fine when the county provides a tax-roll abbreviation like `"PT NW4 SEC 12 T2N R3W"` — which is a tax-assessor shorthand, not a recordable legal description.

Whitman flagged this from the attorney side at §5.2.5: "There is no field-level validation that `propertyDescription` is a real legal description." I'm flagging it from the title side: when I get an order with a tax-roll-abbreviation legal, my examiner has to pull the source deed from county records to construct the recordable legal — which is 30-45 minutes of additional work per file. That's roughly $32-$48 of underwriter time at our blended rate. On 30 files/month, that's $960-$1,440/month of waste that AcreOS could eliminate with a regex + a "this looks like a tax-roll abbreviation; we need the recordable legal from the source deed" warning at deal creation.

Specific failure patterns my staff sees from AcreOS files:

1. **Tax-roll abbreviations** — "PT NW4 SEC 12" instead of "the Northwest Quarter of the Northeast Quarter of Section 12, Township 2 North, Range 3 West, of the Sixth Principal Meridian, El Paso County, Colorado." The operator typed what was on the tax bill.
2. **Truncated metes-and-bounds** — long legal descriptions that hit a UI character limit and got cut off mid-call (".. thence N 47°22' E a distance of 230.4 feet to a point on the southerly").
3. **Wrong county** — operator typed the county where the closing is happening, not where the parcel sits. Cross-county is rare in land but does happen; my title plant is county-specific and I can't issue a commitment until this is fixed.
4. **Acreage discrepancy** — `property.calculatedAcres` from the GIS data and the recital in the legal description disagree by more than the 1% tolerance an underwriter accepts. AcreOS already has both numbers (`dataIntelligenceEngine.ts:40` references `parcel_boundaries_geojson` + `calculated_acres`); a comparison check is straightforward and not done.

### 2.6 No volume-pricing surface

When AcreOS sends me 30 files/month at $1,150 average, our retail rate, I net roughly $310 per file after underwriter premium remittance, search costs, and overhead. At 60 files/month I'd net closer to $390 per file — fixed costs amortize. **None of that volume premium is shared with AcreOS or the AcreOS user today.** That's a missed deal: a partner-tier API with a 15-30% volume rebate to AcreOS would let AcreOS users save $170-$345 per closing while expanding my margin and consolidating my LandTech distribution. There is no surface in AcreOS today to negotiate, track, or apply such a rebate. Stripe's metered-billing primitive is in place for AcreOS subscriptions; nothing analogous for partner-side volume credits.

---

## 3. Partner-API spec recommendation

Six endpoints + three webhook event categories. Build these in this order; this is what I would commit to integrating against.

### 3.1 `POST /api/title-orders`

**Auth:** Partner API key (separate from end-user OAuth — partners are organizations registered in `organizationIntegrations` with role `title_partner`).

**Request body:**

```json
{
  "dealId": 47291,
  "orderType": "purchase" | "refinance" | "seller_finance",
  "property": {
    "apn": "1234567890",
    "state": "TX",
    "county": "Travis",
    "legalDescription": "Lot 42, Block 3, …",
    "address": { … }
  },
  "parties": {
    "buyer": { "name": "…", "entity": false, "tin_last4": "4321" },
    "seller": { "name": "…", "entity": true, "tin_last4": "9876" }
  },
  "purchasePrice": 87500,
  "closingDate": "2026-05-21",
  "lender": null | { "name": "…", "loanAmount": … },
  "specialRequests": ["mineral_search", "easement_review"]
}
```

**Response:** `{ orderId: "tco_…", status: "received", estimatedCommitmentDate: "2026-05-07", invoiceAmount: 1150.00 }`. Synchronous 201 with an order ID; everything that follows is asynchronous via webhooks.

**Validation requirements:** legal description must pass the data-quality regex (§4.2 below). Tax-roll abbreviations get a 422 with `{ error: "legal_description_invalid", details: "looks like tax-roll abbreviation; require recordable legal from source deed" }`. APN must pass state-specific format check (TX = 17 digits, CA = 13 with hyphens, etc.).

### 3.2 `POST /api/title-orders/:id/documents` (partner → AcreOS, inbound)

**Purpose:** title company pushes commitment, policy, payoff statements, recorded-deed copy, etc., back into the deal record.

**Body:** multipart/form-data — PDF + structured JSON metadata. JSON shape for a commitment:

```json
{
  "documentType": "title_commitment",
  "schedule_a": { "insured": "…", "amount": 87500, "effective_date": "…" },
  "schedule_b_i_requirements": [
    { "id": "req-1", "text": "Pay off existing mortgage to ABC Bank", "amount": 47200 }
  ],
  "schedule_b_ii_exceptions": [
    { "id": "exc-1", "category": "mineral_severance", "text": "…", "severity": "high" }
  ],
  "underwriter": "First American",
  "cleared_to_close": false
}
```

AcreOS parses this and surfaces high-severity exceptions on the deal-detail page as a red banner; refuses to advance the closing checklist past `title-review` until `cleared_to_close === true`. Whitman recommended this same parsing surface at §7.2 — it's the right call.

### 3.3 `POST /api/title-orders/:id/wire-instructions` (partner → AcreOS, secure)

**This is the deal-defining endpoint.** Title company posts wire instructions to AcreOS; AcreOS stores them encrypted-at-rest, generates a single-use signed URL, sends an SMS+email to the buyer of record with the URL, requires KBA (knowledge-based auth — last 4 of SSN, DOB, prior address) before display, displays the instructions once with a 30-minute timer, audit-logs every view, and notifies the title company via webhook (`wire_instructions.viewed_by_buyer`) when the buyer has actually viewed them.

This solves the wire-fraud problem in a way no other LandTech does today. ALTA's 2024 Best Practices Pillar 2 explicitly endorses this exact pattern. My E&O carrier (Old Republic Specialty) gives a 7% premium discount for agencies that can document this delivery method. **This single endpoint, done correctly, is the reason a title company would exclusively recommend AcreOS to its agent network over Qualia or SoftPro.**

### 3.4 Webhook events — `title.*` family

Outbound from AcreOS to title-partner receivers (registered in `organizationIntegrations`):

- `title.order_created` — fires immediately on `POST /api/title-orders`
- `title.order_cancelled` — operator cancelled before commitment
- `title.deal_closing_date_changed` — closing moved; partner needs to know to re-shuffle the queue
- `title.deal_buyer_changed` — rare but happens; new commitment will be needed

Outbound from partner to AcreOS (the partner POSTs to AcreOS's inbound receiver):

- `title.search_complete` — initial search done; advances `title-search` checklist item
- `title.commitment_issued` — commitment PDF + JSON delivered; advances `title-review`
- `title.exception_resolved` — a Schedule B-II item has been cleared
- `title.cleared_to_close` — final clear; advances `execute-closing`
- `title.policy_issued` — final policy at recording; closes the file
- `title.recording_complete` — county confirmed recording; populates `recordingNumber` field
- `wire_instructions.delivered` — partner confirmed wire instructions are loaded into the secure drawer

Each event signed HMAC-SHA256 (the existing dispatcher at `webhookDispatcher.ts:92` already does this — extend the same pattern to inbound).

### 3.5 `GET /api/title-orders/:id/status`

Polling fallback for partners who can't run a webhook receiver. Returns full order state. Rate-limited to 1 request per 60 seconds per partner.

### 3.6 `POST /api/title-orders/:id/closing-disbursement`

At recording, partner posts the final settlement statement breakdown — buyer's funds in, seller's net out, lender payoff, recording fees, transfer tax, escrow fees, title premium, agent commissions if any. AcreOS uses this to populate the deal's financial record automatically. Today this is hand-keyed by the operator from a PDF settlement statement. Eliminating that data entry step is worth ~15 minutes per closing on the operator side.

---

## 4. Security requirements

Five non-negotiable items. My E&O carrier reviews these annually; if any one is missing, I cannot extend my agency's coverage to wire instructions delivered through AcreOS.

1. **Wire-instructions encryption at rest with org-scoped key.** AES-256-GCM, key per AcreOS organization, key rotation every 90 days. Wire instructions are never stored in plaintext anywhere in the database. The decryption key is held only in the application memory at the moment a buyer with valid KBA requests the view.
2. **Buyer-side KBA before view.** Three out of five challenge questions correct (last 4 of SSN, DOB, prior address city, lender on prior loan, vehicle make), pulled from the public-records data AcreOS already has via `titleSearchService.ts`. Three failed attempts = lockout + alert to title partner. This is the same KBA pattern Notarize and Proof.com use for RON.
3. **View-once semantics with 30-minute timer.** After view, the URL is invalidated. Buyer needs to wire? They have the instructions. Buyer needs to re-confirm the routing number? Phone call to the title company. This forces the right behavior.
4. **Audit log: every event, immutable, 7-year retention.** Every issue, view, attempted view, KBA challenge result, IP address, user-agent. ALTA Pillar 2 requires 7-year retention for wire-related audit trails. AcreOS's existing audit-log infrastructure in `routes-admin.ts` is per-org but not immutable; for this surface, an append-only log with content-addressed storage is required.
5. **Partner API key rotation + per-key scope.** Partners get scoped keys (read-only, write-only, full) with rotation every 90 days and a hard 12-month expiration. Compromised key = revoke without disrupting other partners. Today AcreOS's API key model is single-scope and indefinite-lifetime; this needs to be tightened for partner tier.

Two additional items that are best-practice but not deal-killers if deferred to v2:

6. **SOC 2 Type II report.** Required by my E&O carrier for any vendor handling wire instructions. AcreOS does not have one as of 2026-05-01. ETA from AcreOS founder at our last call: "Q3 2026 target." That's acceptable if the rest of the integration ships first; we can run on a vendor-questionnaire basis until the SOC 2 lands.
7. **Geo-fenced KBA challenge.** If the buyer's IP geolocates outside the US (or outside the state of closing), force step-up to phone-based verification. Wire-fraud rings frequently operate from VPN-tunneled foreign IPs against KBA challenges they have pre-researched on the buyer.

---

## 5. Volume economics

The deal that makes this integration mutually viable:

| Tier | Files/month | Per-file rate (TX baseline) | Rebate to AcreOS Treasury | Effective cost to operator |
|---|---|---|---|---|
| **Bronze (current)** | 0-15 | $1,150 | $0 | $1,150 |
| **Silver** | 16-40 | $995 | $50/file rebate | $945 |
| **Gold** | 41-100 | $895 | $90/file rebate | $805 |
| **Platinum** | 100+ | $795 | $130/file rebate | $665 |

At AcreOS's current 28-32 files/month with our agency, we're a Silver tier — operators save $205/file vs. retail, AcreOS Treasury collects $50/file ($1,400-$1,600/month) which approximately covers the per-org platform fee for an active investor. At Gold (which AcreOS users would hit by aggregating across our multi-state agency network), the per-file savings jump to $345 and AcreOS collects $90/file. The Treasury surface to track this — accruing partner rebates per-org per-month, surfacing them in the billing UI, applying them as credits against the AcreOS subscription — does not exist today. Stripe's metered billing primitives are in place; the partner-rebate ledger isn't.

The other side of this: I'd commit to **fixed-rate pricing** for AcreOS deals (no last-minute surprise charges for "additional examiner time" when the legal description is messy), provided AcreOS commits to the data-quality validation in §3.1. That's a real concession on my side — today my margin on messy files is negative. Push the validation upstream and I can commit to a published rate card.

What this looks like in absolute dollars at AcreOS's projected scale: at 1,000 active investors averaging 4 closings/year through partner-tier title companies, that's 4,000 files/year × $90 average rebate = **$360k/year of partner-rebate revenue to AcreOS** that does not exist today and that flows through with near-zero marginal cost once the integration is built. The engineering investment is six weeks; the revenue is recurring. This is a textbook positive-NPV deal that is currently leaving the table because the API doesn't exist.

---

## 6. Deal-killer

**The wire-instructions surface.** Everything else in this audit is incremental — better data quality saves my underwriters time, better webhooks save my staff phone calls, better commitment exchange saves the operator data entry. Those are nice-to-haves that move the integration from manual to automated.

The wire-instructions piece is **categorical**. Either AcreOS solves it the way ALTA Pillar 2 prescribes — encrypted at rest, KBA-gated, view-once, audit-logged — or my E&O carrier will not let me deliver wire instructions through the AcreOS surface, period. And if I can't deliver wire instructions through AcreOS, then the only way to actually close a deal is the old fax-and-PDF path, which means everything else AcreOS builds on top is decoration. The deal cannot close inside AcreOS without the wire surface.

This is also the surface most likely to get either side into the news for the wrong reasons. A single $400k wire fraud loss attributable to AcreOS's delivery method — even if technically the user's fault for clicking a phishing link — is a brand event AcreOS cannot afford. Wire fraud is the only LandTech failure mode that makes the *Wall Street Journal*. Build the secure drawer correctly the first time, or do not let title companies use AcreOS for wire-instruction delivery at all. There is no middle position that's defensible.

If I had to rank the six deliverables by "would I sign a partnership agreement without it":

1. **Wire-instructions secure drawer with KBA + view-once + audit log** — categorical. No deal without this.
2. **Title-order endpoint + commitment-document inbound endpoint** — categorical. The integration has to mean something.
3. **Title-status webhook events (both directions)** — strong preference. Without this we're polling, which works but is ugly.
4. **Legal-description validation upstream** — strong preference. Determines whether I can commit to fixed-rate pricing.
5. **Volume-rebate ledger** — preference. Without this, the deal still pencils for both sides at retail rates; the rebate just makes it more attractive.
6. **SOC 2 Type II** — deferred. We can run on a vendor questionnaire for 6-9 months while AcreOS pursues the audit.

Six weeks for items 1-4. Items 5-6 in parallel on a longer timeline. Ship items 1-4 and AcreOS becomes the LandTech platform that title companies actively recommend. Skip item 1 and AcreOS is, at best, a fax-and-PDF customer with unusually clean data.

— Hartwell Chin, EVP
