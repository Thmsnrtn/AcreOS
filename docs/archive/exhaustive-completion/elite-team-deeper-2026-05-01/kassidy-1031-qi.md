# Kassidy Blaine — AcreOS 1031 Qualified Intermediary Audit

**Role:** Founder, Blaine Exchange Services LLC. 18-year QI. ~340 active exchanges/yr; ~$240M of bonded funds at peak. Texas Department of Banking § 51 compliant; FEA-bonded; $5M E&O.
**Wave:** 3 of 87-persona AcreOS audit, QI lens.
**Date:** 2026-05-01.
**Surfaces reviewed:** `server/services/exchange1031.ts`, `server/routes-exchange-1031.ts`, `client/src/pages/exchange-1031.tsx`, `tests/unit/exchange1031.test.ts`, plus Zerah Hollingsworth's tax-attorney audit (`docs/exhaustive-completion/elite-team-deep-2026-05-01/zerah-tax-attorney.md`) for the upstream basis-and-recapture context I rely on at exchange close.

I read Zerah. He's right on the persistence stub and right on boot, and his sprint plan covers the tax-attorney facing surface. I'm here for a different question: would I, as a QI, accept funds that originate from an AcreOS-tracked exchange, and would I plug my back-office into theirs? Today the answer is no on both counts. Let me show you why and exactly what unblocks it.

---

## 1. 30-second verdict

**AcreOS today is a deadline calendar with a PDF generator stapled to it. It is not an exchange-management platform.** The 45/180-day math is correct, the alert ladder is well-graded, and the identification-letter template cites the right CFR. Below that, every load-bearing piece of an exchange — the Exchange Agreement, the Assignment of Sale, the QI's wire-receipt confirmation, the bonded-funds ledger, the Form 8824 worksheet — is absent. The data layer is stubbed (`listExchanges` returns `[]`, `createExchange` returns `{}`). Five of my exchanges have failed because of clients who tracked deadlines in spreadsheets; this UI would have failed them the same way, with prettier typography.

I would not accept a referral from an AcreOS user without first re-doing the intake on my own forms. I would not let my back-office write to AcreOS's exchange record. And I will not build a partner integration against a service whose persistence layer is `return null`.

Get items 1, 3, and 7 in §3 below shipped and I will pilot a partner-API. Get items 1–10 shipped and I will recommend AcreOS to the FEA membership.

---

## 2. Integration gaps — what's missing between AcreOS and a real QI

The exchange lifecycle runs across eight events. AcreOS surfaces three of them as data and zero of them as integrations.

| # | Event | Owner | AcreOS today |
|---|---|---|---|
| 1 | Exchange Agreement signed pre-close | QI + taxpayer | Not modeled. No document, no signature event, no template. |
| 2 | Assignment of Sale Contract to QI | Closer + QI | Not modeled. The QI must be assigned into the relinquished sale contract before closing or the exchange is invalid. |
| 3 | Sale closes; proceeds wired to QI escrow | Title co. → QI | Modeled as `saleCloseDate` only. No wire confirmation, no funds-receipt event, no escrow account number. |
| 4 | 45-day identification letter sent | Taxpayer → QI | Template exists, no transmission, no QI ack, no postmark archive. |
| 5 | QI countersigns / acknowledges identification | QI → taxpayer | Not modeled. |
| 6 | Replacement contract signed; assigned to QI | Closer + QI | Not modeled. |
| 7 | QI wires funds to replacement closing | QI → title co. | Not modeled. No release authorization, no wire detail, no audit trail. |
| 8 | Form 8824 generated for taxpayer's return | Taxpayer's CPA | Not modeled. There is no Form 8824 anywhere in the codebase. |

**The missing piece I will call out hardest:** there is no `qi_organization` record. AcreOS captures `qualifiedIntermediaryName` and `qualifiedIntermediaryEmail` as free text on the exchange. That means every user types my firm's name slightly differently, my email is in 14 variants, and there is no way for me to receive a structured referral, no way to ack receipt of funds back into AcreOS, and no way for my E&O carrier to verify which exchanges I'm on the hook for via a single source.

A real integration needs a QI directory (FEA member registry would be a fine seed) with a stable `qiOrgId` foreign key on the exchange.

---

## 3. 1031-specific feature audit

Ranked by what a missed step costs the taxpayer (a failed exchange = full taxation of the relinquished gain + state).

### 3.1 — 45-day identification automation: B-minus

What's right: deadline calculated correctly via `addDays(saleCloseDate, 45)`. Tiered alerts at 15/7/<0 days. The "no candidates identified" warning at d ≤ 30 is the right nudge.

What's missing:
1. **Alert delivery.** `getExchangeAlerts` returns alerts; no scheduled job emails them, surfaces them in inbox, or pushes to mobile. An alert that nobody reads is a missed deadline waiting to happen.
2. **Three-property rule is the only path surfaced.** The 200% rule (any number of properties whose aggregate FMV ≤ 200% of relinquished value) and the 95% rule (any number, provided 95% by value are acquired) are not in the identification letter or the data model. Roughly 22% of my exchanges use one of these — usually 200% on a portfolio swap.
3. **No identification revocation.** Treas. Reg. § 1.1031(k)-1(c)(6) lets a taxpayer revoke and re-identify within the 45-day window if done in writing, signed, and delivered to the QI. AcreOS has no concept of identification version history.
4. **No transmission of record.** The identification letter must be received by the QI (or other party not the taxpayer or related party) by midnight of day 45. AcreOS prints a PDF; it does not certify delivery. I need a `transmittedAt`, `transmissionMethod` (`fax|email|certified_mail|api`), and a hash of the exact bytes sent.
5. **Related-party rules not warned.** § 1031(f) two-year holding rule on related-party exchanges is not flagged. If the replacement is acquired from a related party, a two-year clock starts and disposing of either inside two years voids the deferral.
6. **No like-kind warning for personal property.** Post-TCJA (2018), § 1031 only applies to real property. The product correctly defaults to land but does not warn if a user enters mineral rights, water rights, or a leasehold of < 30 years (which can fail like-kind). This is exactly the population AcreOS serves.

### 3.2 — 180-day exchange clock: B

Math is correct. Alert thresholds (30/14/<0) are reasonable. What's missing:
1. **April 15 truncation.** The 180-day clock is actually the lesser of 180 days *or* the due date of the taxpayer's return for the year of sale (incl. extensions). For sales after Oct 17, the 180 days runs past April 15, and a taxpayer who hasn't filed an extension loses days. AcreOS does not model this. **This silently fails roughly one in nine exchanges I see.**
2. **Disaster-area extensions.** Rev. Proc. 2018-58 lets the IRS extend 45/180 days during federally declared disasters. AcreOS has no override surface; I'd want a per-exchange `deadlineOverride` with audit trail and IRS notice citation.
3. **Weekend/holiday handling.** 45 and 180 days fall on whatever day they fall; there is no business-day adjustment in IRC. AcreOS gets this right by default (raw addDays). Worth a comment in code so the next engineer doesn't "fix" it.
4. **No partial-year cutover.** When the sale closes in Q4 and the exchange spans calendar years, the user needs to know the gain reports on the year-of-sale return (with Form 8824), not the year of replacement closing.

### 3.3 — Replacement property tracking: C

The `ReplacementCandidate` model has the right shape: address, APN, identifiedDate, targetPrice, status. The UI scores candidates against relinquished sale price (a nice touch). But:
1. **No FMV / appraisal field.** For 200%-rule compliance, I need fair market value of each candidate at identification, not a target price.
2. **No identification-method flag.** Three-property vs 200% vs 95% determines whether a 4th candidate breaks the exchange or sits within rule. Without a flag, the system can't enforce.
3. **No earnest-money tracking.** Earnest money on a replacement contract is part of the boot calculation if returned, and is part of basis if forfeited.
4. **No "drop and swap" flag.** When a partnership distributes a TIC interest pre-sale to allow individual partners to exchange, the data model needs to know which partner is exchanging which percentage. Missing.
5. **The status enum is right** (`identified | under_contract | closed | dropped`) but no state-machine enforces transitions. A candidate can go from `dropped` back to `closed` via a buggy update.

### 3.4 — Boot calculation: D-plus

The UI's `BootMortgagePanel` does **price-only boot** (sale price minus replacement price) at a flat 20% rate. Real boot has three layers I owe my taxpayer at exchange close:

1. **Cash boot** — proceeds the QI did not redeploy. I know this; AcreOS doesn't, because there is no funds-flow ledger.
2. **Mortgage boot (debt relief)** — relinquished mortgage paid off > replacement mortgage assumed. § 1.1031(d)-2. The current panel ignores debt entirely.
3. **Other-property boot** — non-like-kind property received (a tractor, a truck, fixtures not affixed). N/A for most land exchanges but not zero.

The taxable gain on boot is the **lesser of total realized gain or total boot**, taxed first as unrecaptured § 1250 gain (25%) up to accumulated depreciation, then as LTCG. The flat 20% in `BootMortgagePanel` overstates for low-bracket taxpayers and *understates* for taxpayers with significant depreciation recapture. Zerah called the recapture math out at the basis layer; it bites again here at the exchange-close summary.

### 3.5 — Deferred tax math: C-minus

`estimateCapitalGains` uses 15% LTCG / 22% short-term flat. Reasonable for a Wendell-style sole proprietor; wrong for anyone in the 32%+ bracket (where LTCG = 20% + 3.8% NIIT) and wrong on state. Exchanges I run in CA, OR, NY, NJ owe state-level capital gain on top of federal — typically 5–13.3%. AcreOS shows a federal-only number and does not mention state. Zerah flagged the same on Wendell.

What I need at exchange close: a per-state deferral table.

```
                Federal LTCG   NIIT   State    Total deferred
California          20%       3.8%   13.3%      37.1%
Texas               15%        0%     0%        15.0%
New York            20%       3.8%   10.9%      34.7%
Florida             15%        0%     0%        15.0%
```

This is a 30-line lookup table. It changes the deferred-tax estimate by 2–2.5x for half my book.

### 3.6 — IRS Form 8824 generation: F

**There is zero Form 8824 in the codebase.** I grepped. The form is the legal artifact that ties the entire exchange together — without it the deferral does not appear on the taxpayer's return. Every CPA filing for my clients does this by hand. The math AcreOS already has is 80% of the form:

- Part I — Like-Kind Property Description (lines 1–7): we have addresses, dates, identification method needs adding.
- Part II — Related Party Exchange (lines 8–11): not modeled; needs related-party flag.
- Part III — Realized Gain, Recognized Gain, Basis (lines 12–25): needs the boot decomposition above + adjusted basis from `costBasisTracker` + accumulated depreciation from `depreciationService`.

The integration is: at exchange completion, generate an 8824 worksheet PDF that a CPA can transcribe to the actual form (or, ideally, an IRS-compliant fillable PDF). This is the deliverable that turns AcreOS from "deadline app" into "system of record for an exchange."

### 3.7 — Bonded-funds custody: N/A — and that's the problem

A QI is a fiduciary holding bonded escrow funds. The custody side is mine, not AcreOS's, and I would be alarmed if AcreOS tried to hold the funds. But the *visibility* into those funds is a partner-API question.

What I want to push to AcreOS from my back-office:

| Event | Payload | Why |
|---|---|---|
| `exchange.funds.received` | amount, wire ref, date, source bank | Confirms close and starts the 45/180 clock from a verified source rather than a self-reported `saleCloseDate`. |
| `exchange.funds.balance` | currentBalance, lastUpdated | Lets the taxpayer see the bonded balance without calling me. |
| `exchange.funds.released` | amount, wire ref, date, destination, replacementPropertyId | The wire that closes the replacement; populates Form 8824 line 16. |
| `exchange.funds.returned` | amount, date | Cash boot if any unused funds return to taxpayer at exchange end. Drives the boot calc. |
| `exchange.identification.acknowledged` | ackDate, ackMethod | Closes the 45-day loop with a counterparty record. |
| `exchange.completion.certified` | date, finalDocumentHash | Final QI sign-off; lets AcreOS lock the exchange record. |

None of these have an inbound endpoint today. Adding them is the difference between AcreOS being a deadline app the taxpayer maintains and AcreOS being a verified record the taxpayer's CPA, attorney, and QI all read from.

---

## 4. Partner-API spec (what I need to integrate Blaine Exchange Services)

A two-sided integration. AcreOS pushes exchange intake to me; I push fund and milestone events back. OAuth2 client-credentials flow, scoped per-org-per-QI.

### 4.1 — Outbound (AcreOS → QI)

`POST /partners/v1/exchanges` (initiate exchange with QI):

```json
{
  "acreosExchangeId": "exch_01HXYZ",
  "taxpayer": {
    "legalName": "Wendell H. Carter",
    "entityType": "sole_proprietor",
    "tin": "***-**-****", "tinType": "SSN",
    "addressLine1": "...", "city": "Austin", "state": "TX", "zip": "78701",
    "email": "wendell@...", "phone": "+1..."
  },
  "relinquishedProperty": {
    "address": {...},
    "apn": "R-123456",
    "saleContractId": "deal_01HXYZ",
    "saleCloseDate": "2026-05-15",
    "salePriceCents": 25000000,
    "adjustedBasisCents": 8000000,
    "accumulatedDepreciationCents": 0,
    "mortgagePayoffCents": 12000000,
    "buyer": { "name": "...", "closerEmail": "title@..." }
  },
  "exchangeType": "delayed | reverse | improvement | simultaneous",
  "identificationRule": "three_property | two_hundred_percent | ninety_five_percent",
  "callbackUrl": "https://api.acreos.io/webhooks/qi/blaine"
}
```

QI returns `{ qiExchangeId, exchangeAgreementUrl, escrowAccountLast4, status }`.

### 4.2 — Inbound (QI → AcreOS) webhook

`POST /api/webhooks/qi/{qiOrgId}` with HMAC-SHA256 signature, event types listed in §3.7. AcreOS verifies signature against the QI's registered public key, dedups on `eventId`, and writes to a new `exchange_events` table that feeds the audit trail and Form 8824 worksheet.

### 4.3 — Document exchange

`POST /partners/v1/exchanges/{id}/documents` with `{ kind: "exchange_agreement | assignment | id_letter | qi_ack | settlement_statement", url, sha256, signedAt }`. AcreOS stores in `exchange_documents`, surfaces in UI, and includes in the year-end ZIP.

### 4.4 — Required schema additions

Beyond what Zerah listed for `exchanges_1031`:

- `qi_organizations`: id, fea_member, legal_name, ein, bond_amount_cents, bond_carrier, e_o_carrier, e_o_amount_cents, partner_api_url, public_key.
- `exchange_documents`: id, exchange_id, kind, sha256, url, source (`acreos | qi | title | taxpayer`), signed_at.
- `exchange_events`: id, exchange_id, event_type, source, payload_json, occurred_at, dedup_key.
- `exchange_funds_ledger`: id, exchange_id, direction (`in | out`), amount_cents, wire_ref, occurred_at, qi_event_id.

### 4.5 — What I won't build against until it ships

The persistence stub. There is no point integrating against `async createExchange(_data) { return {}; }`. Day-1 of any partner conversation is "show me the table." This is the single non-negotiable.

---

## 5. Deal-killer

**The persistence stub is a regulatory liability, not just a TODO.**

Here's the sequence of events that makes me put the audit down:

1. A user starts a 1031 exchange in AcreOS at 4:55 PM on the day their sale closes.
2. The UI accepts the input. The status says "Open." The 45-day countdown is rendering.
3. `createExchange` returns `{}`. Nothing was persisted.
4. The user closes the tab. Forty-six days later they remember they need to identify properties.
5. They log back in. The exchange is gone. The deadline that was rendering is gone.
6. Their CPA receives a 1099-S from the title company in January. The full gain is recognized — about $90K of federal tax on a $300K Texas land sale, plus state if applicable.
7. The user calls a tax attorney and asks if AcreOS owes them the $90K.

A reasonable jury would say yes. The product represented to the user that it was tracking their § 1031 deadlines. It collected their inputs. It rendered a countdown. It told them an "Exchange may be invalid" warning at d > 45. None of this happened to data that existed. This is the kind of UX that turns into a software-malpractice claim in jurisdictions like Texas where reliance is the standard.

**Until `exchanges_1031` is a real table with real persistence, the page should render a banner reading "1031 tracker preview — do not rely on for deadline tracking."** That banner does not exist. Removing the page entirely until the persistence ships would be safer than what is shipped today.

This is the deal-killer. Everything else in this audit — the 200% rule, the Form 8824 worksheet, the QI partner API, the boot decomposition, the state-tax table, the disaster-area extension — is product work I'd be excited to partner on. But none of it matters if the system's record of an exchange is `{}`.

---

## 6. What I'd build with Thomas in two weeks

If you give me a sprint, here's the order:

**Day 1 — make persistence real.** Drop the stubs. Schema per §4.4. Real Drizzle queries. Backfill nothing — this is greenfield.

**Day 2 — fix the boot and tax math.** Decompose into cash boot, mortgage boot, other-property boot. State-tax lookup table. Wire `costBasisTracker.adjustedBasis` and depreciation accumulated into the close summary so recapture is split.

**Day 3 — Form 8824 worksheet PDF.** Take what we already have plus the recapture split and emit Part I + Part III. Mark Part II as "needs manual review" and surface a related-party flag on the exchange.

**Day 4 — identification rule selector + revocation.** UI picks 3-property / 200% / 95%; data model enforces; revocation creates a versioned identification record.

**Day 5 — alert delivery.** Daily cron through `getExchangeAlerts`, email + inbox + (optional) SMS at warning/critical. April-15 truncation logic on the 180-day clock.

**Days 6–8 — QI partner API.** OAuth2, outbound `POST /partners/v1/exchanges`, inbound webhook with HMAC verification, `qi_organizations` directory seeded with the FEA membership list (~430 firms, public).

**Days 9–10 — document layer.** Exchange Agreement template, Assignment of Sale template, Identification Letter (already done) + transmission record, QI Ack record. Year-end ZIP includes Form 8824 worksheet, all four documents, funds ledger, settlement statements.

After this sprint AcreOS has a defensible 1031 product. I would pilot the partner integration in week three.

---

## Bottom line

The 1031 surface in AcreOS today is the best-looking calendar widget in this category and the worst-implemented exchange platform. The skeleton — deadline math, alert ladder, identification template — is honest work. The flesh is missing on every dimension that makes an exchange a legal and financial event rather than a date on a screen: persistence, boot decomposition, Form 8824, QI integration, funds visibility.

Ship the persistence layer and the partner API and I will refer my book to AcreOS as the taxpayer-side dashboard. Ship the rest of the §3 audit and I will recommend it to the FEA.

Until then, what's there is theater. Pretty theater. But a 45-day countdown rendered against `{}` is the kind of theater that ends in a malpractice claim.

— Kassidy Blaine, CES®
Blaine Exchange Services LLC
