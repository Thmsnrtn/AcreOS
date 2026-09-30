# Quality directive 2026-09-29 — reconciliation at HEAD and the work queue

**Sources.** Two read-only documents the founder supplied on 2026-09-29, preserved verbatim:
[the onboarding and feature-quality review](research-2026-09-29-onboarding-and-feature-quality-review.md)
and [the customer and founder quality directive](research-2026-09-29-customer-and-founder-quality-directive.md).
Their source claims were pinned to `a2dc971`, `b8dd697` and `457e6e1`.

**Method.** Each case was re-read at HEAD `6b730aa` (2026-09-30, branch
`claude/acreos-maturity-research-findings-nhj3a1`) by two independent read-only passes. They quoted the
deciding lines, checked reachability (mounted route, client caller), and noted any test that pins
the current behaviour. Every verdict below is **source-level**. None observes a deployment, a
connected provider or a customer, and none claims a customer was harmed.

**How this queue is used.** This document is the queue. A case gets a `DEFECT-` registry entry when
it is fixed (with its falsifying test), or when it is deliberately left open with a reason. That
follows the directive: *a small number of coherent repairs, not a ticket avalanche*. Order follows
the directive's gates: the land-investor first-mail wedge (G0) first, then reachable false claims
and unsafe effects, then money/cost/demo truth, deal evidence, setup durability, and founder
operation at scale.

## Status legend

- **FIXED** — repaired, with a test that fails without the repair.
- **QUEUED** — reproduced at HEAD and scheduled in the slice named in the table.
- **INAPPLICABLE** — the premise does not hold at HEAD.

## G0 — first physical mail (Outreach composer → queue → flusher → Lob)

| Case | At HEAD `6b730aa` | Status |
|---|---|---|
| A selected marketing list mailed by its **states** only (or with no condition at all) | `resolveAudience` unioned `filters.states`; a list has no member records | **FIXED** — DEFECT-0191 (refused) |
| Counties and acreage ignored; silent 50,000 cap | shown in the composer, never read | **FIXED** — DEFECT-0191 |
| `Idempotency-Key` ignored; debit keyed on `Date.now()`; lost response + click queued twice | no stable operation identity | **FIXED** — DEFECT-0192 |
| Audience read twice (queue, then quote); count charged ≠ pieces written | `buildQuote` re-resolved | **FIXED** — DEFECT-0192 |
| Free allowance checked outside the transaction (concurrent race) | two sends both pass | **FIXED** — DEFECT-0192 |
| "Preview all" called a route that did not exist | the error was swallowed behind a placeholder | **FIXED** — DEFECT-0197 |
| A STOP during the 30-minute hold still mailed | the flusher never re-read the lead | **FIXED** — DEFECT-0193 |
| Queueing recorded `first_mailer_sent` (the email/SMS event) | the founder card read "Email/SMS out" for queued mail | **FIXED** — DEFECT-0194 |
| "Sent" counted failed pieces; template rates counted pieceCount once per joined piece (×n); cohort spend ×n | results queries | **FIXED** — DEFECT-0195 |
| An early Lob event (before provider-id write-back) was acknowledged and lost; `created` stamped `printedAt` | `lob-webhooks.ts` | **FIXED** — DEFECT-0196 |
| Scan ≠ reply; no attributable return path; offline replies not recordable | QR goes to a constant public page | QUEUED — G0 follow-up (needs design-partner input on the reply channel) |
| Campaign `POST /api/campaigns/:id/send-direct-mail`: provider-accepted piece refunded on a local write failure; a new order (and key) per click; activation uses the *requested* test mode | reachable from `/campaigns` | **FIXED** — DEFECT-0242 (the test-mode point was already fixed at HEAD) |
| Checklist "Pull your first county list" is a CSV import | `onboarding-checklist.ts` | **FIXED** — renamed "Import your county list" |
| County coverage "covered" after a one-feature probe while redistribution stays `review-required` | `coverageLedger.ts`, `routes-county-coverage.ts` | QUEUED — county status vocabulary (endpoint / lookup / list-ready / rights-qualified) goes in with the Regrid list builder |

## Reachable false claims and unsafe effects (H2)

| Case | At HEAD | Status |
|---|---|---|
| Graph `sendMail` returns an empty 202; `authedFetch` parses JSON, so an accepted send returns 500 and the UI invites a resend | `mailboxClient.ts:290`; no test | **FIXED** — DEFECT-0204 |
| Mailbox identity: the row is resolved by org only and the *requester's* token is used; the first linked account is picked; no external-account id stored | `routes-mailbox.ts:46-59`, `clerkMailbox.ts:53,76` | **FIXED** — DEFECT-0204 (linking user only; token matched by external account) |
| MCP: `remember_fact` (writes `paxMemory`) and `spawn_subagent` (runs a billed LLM loop) have `scope: null` and are exposed as read-only to a key with no scopes; three data reads are unscoped | `intentScopes.ts`, `safeIntents.ts:51-53`; pinned by `mcpStreamableHttp.test.ts` | **FIXED** — DEFECT-0205 (positive allowlist) |
| FEMA: empty features are reported as Zone X / low risk; `lastUpdated` is the lookup instant; the empty result is cached | `data-source-broker.ts:1022-1035` | **FIXED** — DEFECT-0206 (also: the diligence lookup still called the retired host, and a failure returned Zone X) |
| Broker cache: key is category + rounded point; a cache hit precedes the tier check (`maxTier:"free"` can receive a paid-tier row) | `data-source-broker.ts:383,486,636` | **FIXED** — DEFECT-0207 |
| Broker cache leaks a restricted / BYOK result across orgs | every broker source is public federal/county data; `byokKeys` is never supplied | **INAPPLICABLE** — the restricted surface is the provider registry (license-guarded) |

## Money, cost and demo truth (H3)

| Case | At HEAD | Status |
|---|---|---|
| Rent Roll posts one request per allocation line although the server allocates one payment atomically | `rent-roll.tsx:955-990`; pinned by `waveDTaxRentSurfaces.test.tsx` | **FIXED** — DEFECT-0214 (one POST + durable operation key on both payment ledgers) |
| Finance summary includes sample deals/notes; accepted price shown as "Collected MTD" | `routes-finance.ts:927,1004`; `realDeal()`/`realNote()` exist but are not used there | **FIXED** — DEFECT-0216 (also list price as sale proceeds) |
| Acquired-note NSF reversal stores any `originalPaymentId` unchecked | `routes-notes.ts:1740-1805` | **FIXED** — DEFECT-0215 |
| Founder "MRR" is 30-day posted revenue (annual/one-time included, refunds not netted); `crossedAt` is read time | `routes-finance-ledger.ts:59-71,479` | **FIXED** — DEFECT-0217 |
| Registry: a present BYOK row skips the balance check; a failed BYOK resolve falls back to the platform key without re-checking; debit not awaited; event id = fingerprint + day (no org) | `provider-registry.ts:177-201,264-271,305,646` | **FIXED** — DEFECT-0218. (Charging the *reported* cost rather than the list price was fixed as DEFECT-0199.) |

## Deal evidence (H4)

| Case | At HEAD | Status |
|---|---|---|
| Creating a deal records `first_offer_made`; the real offer-sent transition exists but does not emit it | `routes-deals.ts:703-713` vs `:1115` | **FIXED** — DEFECT-0230 |
| Entering escrow emits `contract.signed` with no document; e-sign receipts exist (`signatures`, `generated_documents.signedAt`) but are not linked | `routes-deals.ts:790-797`; pinned by `wholesaleEvents.test.ts:51` | **FIXED** — DEFECT-0231 (attestation UI: OPEN DEFECT-0232) |
| A close sends `acceptedAmount` as a high-quality sale to training and the market network regardless of deal type or sample lineage; no dedupe key, no retraction | `routes-deals.ts:907,928-956,1094` (consent + 5-operator floor already applied, DEFECT-0159) | **FIXED** — DEFECT-0233 (network retraction: OPEN DEFECT-0235) |
| Valuation comps: state-only query, `distance: 0` under a 50-mile limit, +30 ZIP points for two empty ZIPs, +15 "nearest < 5 mi" on every valuation | `acreOSValuation.ts:810-846,907,1110` | **FIXED** — DEFECT-0234 (and the AVM flood adjustment, DEFECT-0221) |

## Setup durability and founder operation (H5)

| Case | At HEAD | Status |
|---|---|---|
| Onboarding step 1 advances after `Promise.allSettled` failures; `/complete` returns success after persona/preference failures | `onboarding-v2.tsx:654-666`, `routes-onboarding.ts:92-147` | **FIXED** — DEFECT-0236 |
| Any member's *personal* persona change rewrites the org's business type | `routes-persona.ts:91-133` | **FIXED** — DEFECT-0237 |
| Sample seeder: a partial seed cannot resume (skips when any marker exists) | `sampleSeeder.ts:676-731`; pinned by `sampleSeeder.test.ts` | **FIXED** — DEFECT-0238 |
| Founder funnel bars divide a 50-row, unwindowed list by a 30-day total; the activation denominator is every org ever | `onboarding-funnel.tsx:187-207`, `activation.ts:99-114` | **FIXED** — DEFECT-0239 (founder script removes the queue-written rows) |
| Workflow run marked `completed` after an unavailable/blocked step | `workflow-engine.ts:2213-2260`; pinned by `workflowActionHonesty.test.ts:254-293` | **FIXED** — DEFECT-0240 (`completed_with_gaps`) |
| Today runs the portfolio health job inside every GET and reads all leads/properties | `routes-today.ts:548,611,1276` | OPEN — DEFECT-0243 (leads/properties already capped; the per-GET job waits on a measurement) |
| `/api/market-intelligence/public/data` returns fixed state prices with a fresh timestamp; no caller | `routes-market-intelligence.ts:116-131` | **FIXED** — DEFECT-0241 (removed) |

## Independent audit of `6b730aa` (parcel layering) — folded into this slice

| Finding | Status |
|---|---|
| The Regrid provider's **comps** path dropped the registry's BYOK key, comps read only the legacy credential store, and comps were cached by coordinate for every org | **FIXED** — DEFECT-0198 |
| The registry debited the list price for a lookup the provider answered free | **FIXED** — DEFECT-0199 |
| Regrid-first on **AcreOS's platform key** made direct routes (drive mode, field scout, bulk fetch) pay for data the county publishes free, with no credit debit | **FIXED** — DEFECT-0200: the org's own key goes first, the platform licence goes behind free county data |
| Proprietary Regrid facts recorded in the observation log with no org read as platform data | **FIXED** — DEFECT-0201 |
| "Unknown Owner" / "Unknown" placeholders in the deal machine and dossier; entity owners greeted "Dear ," | **FIXED** — DEFECT-0201 |
| County GIS rows cached globally although each endpoint's redistribution is `review-required` | OPEN — DEFECT-0202 |

## Independent audit of `0133993` (first-mail slice)

| Finding | Status |
|---|---|
| County regex received `s+county$`; multi-state counties matched every same-named county; debit before the lock (double debit on a concurrent retry); free allowance counted shipments and failed pieces; printed copy unmerged; cost = quote not pieces sent; Send enabled over a stale preview; undated Lob event retried for ever; comps cache shared across caller keys; `first_letter_sent` on a test key | **FIXED** — DEFECT-0203 |

## Independent audit of `60ebfd9` (H2) — folded into the H3 change

| Finding | Status |
|---|---|
| Outlook replies 400'd on a non-`x-` header; two linked accounts could not connect; any member could disconnect a teammate's mailbox | **FIXED** — DEFECT-0208 |
| A third FEMA caller still invented Zone X; pods, lead scoring and the radar read the "Zone X" label wrongly; edge codes, shaded X, stale cache rows, disabled sources | **FIXED** — DEFECT-0209 |
| `/mcp` ignored key scopes; a notes-only key read lead names; an allowlisted intent could spend | **FIXED** — DEFECT-0210 |
| Credit-pool refunds never returned credit (pool or purchased) | **FIXED** — DEFECT-0211 |
| Printed letter collapsed paragraphs and read typed markup | **FIXED** — DEFECT-0212 |
| Crash window between the mail debit and the shipment commit | OPEN — DEFECT-0213 |

## Independent audit of `0e54c75` (H3) — folded into the H4 change

| Finding | Status |
|---|---|
| Note-payment clients minted a key per click; edited resubmission replayed; wrapped 23505 unread | **FIXED** — DEFECT-0219 |
| Unused half-open probe jammed a provider breaker | **FIXED** — DEFECT-0220 |
| AVM flood adjustment never applied; three scorers read labels as codes | **FIXED** — DEFECT-0221 |
| NSF preview "no change"; non-cash reversals; applied partials | **FIXED** — DEFECT-0222 |
| stdio MCP refused; /mcp summary any-of | **FIXED** — DEFECT-0223 |
| Trigger card broken; studio triggers read an unwritten MRR | **FIXED** — DEFECT-0224 (two ladders: OPEN DEFECT-0225) |
| Gauge vs gate; refund without original; overflow as pool usage | **FIXED** — DEFECT-0226 (two-transaction refund, month netting: OPEN DEFECT-0227) |
| Draft/duplicate assignment fees; PDF and waterfall counted samples | **FIXED** — DEFECT-0228 (Today cash strip: OPEN DEFECT-0229, H5) |

## Independent audits of `92bf405` (H3 fixes) and `e3debe0` (H4) — folded into the H5 change

| Finding | Status |
|---|---|
| Seller-financing read any note on the parcel; Close & Carry left a cash-sale label; a re-close stayed retracted; an acquisition was paired as the AVM's actual sale | **FIXED** — DEFECT-0245 |
| Offer and reopen evidence recorded on one stage-change path of seven; bulk-stage-update emitted nothing | **FIXED** — DEFECT-0246 (close side effects on the other paths: OPEN DEFECT-0244) |
| A "final" document counted as signed; NULL-first ordering | **FIXED** — DEFECT-0247 |
| A persisted half_open breaker refused everyone; a lost probe was never reclaimed | **FIXED** — DEFECT-0248 |
| Finance-page "Record payment" 400'd every time, split in float, ignored its key | **FIXED** — DEFECT-0249 |
| Payment keys without the note; reversal replay ignored its original | **FIXED** — DEFECT-0250 |
| Approve-trigger card without a trigger; deferral days ignored | **FIXED** — DEFECT-0251 |
| DEFECT-0233 claimed a network test was red-checked; it was not | Corrected in the registry |

## What remains outside any code change

These need outside proof or a founder decision, as the directive's own limits section says:

- **Provider accounts:** a Lob live key and webhook secret, and a real Outlook/Gmail account for the mail cases.
- **Design-partner evidence:** which reply channel real recipients use.
- **Deployment:** a deployed build to measure Today at 10,000 records.
- **Licensing:** the Regrid licence, and the per-county redistribution review.
