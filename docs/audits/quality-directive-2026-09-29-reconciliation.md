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
| Campaign `POST /api/campaigns/:id/send-direct-mail`: provider-accepted piece refunded on a local write failure; a new order (and key) per click; activation uses the *requested* test mode | reachable from `/campaigns` | QUEUED — H5 |
| Checklist "Pull your first county list" is a CSV import | `onboarding-checklist.ts` | **FIXED** — renamed "Import your county list" |
| County coverage "covered" after a one-feature probe while redistribution stays `review-required` | `coverageLedger.ts`, `routes-county-coverage.ts` | QUEUED — county status vocabulary (endpoint / lookup / list-ready / rights-qualified) goes in with the Regrid list builder |

## Reachable false claims and unsafe effects (H2)

| Case | At HEAD | Status |
|---|---|---|
| Graph `sendMail` returns an empty 202; `authedFetch` parses JSON, so an accepted send returns 500 and the UI invites a resend | `mailboxClient.ts:290`; no test | QUEUED — H2 (first) |
| Mailbox identity: the row is resolved by org only and the *requester's* token is used; the first linked account is picked; no external-account id stored | `routes-mailbox.ts:46-59`, `clerkMailbox.ts:53,76` | QUEUED — H2 |
| MCP: `remember_fact` (writes `paxMemory`) and `spawn_subagent` (runs a billed LLM loop) have `scope: null` and are exposed as read-only to a key with no scopes; three data reads are unscoped | `intentScopes.ts`, `safeIntents.ts:51-53`; pinned by `mcpStreamableHttp.test.ts` | QUEUED — H2 |
| FEMA: empty features are reported as Zone X / low risk; `lastUpdated` is the lookup instant; the empty result is cached | `data-source-broker.ts:1022-1035` | QUEUED — H2 |
| Broker cache: key is category + rounded point; a cache hit precedes the tier check (`maxTier:"free"` can receive a paid-tier row) | `data-source-broker.ts:383,486,636` | QUEUED — H2 (tier on cache hits) |
| Broker cache leaks a restricted / BYOK result across orgs | every broker source is public federal/county data; `byokKeys` is never supplied | **INAPPLICABLE** — the restricted surface is the provider registry (license-guarded) |

## Money, cost and demo truth (H3)

| Case | At HEAD | Status |
|---|---|---|
| Rent Roll posts one request per allocation line although the server allocates one payment atomically | `rent-roll.tsx:955-990`; pinned by `waveDTaxRentSurfaces.test.tsx` | QUEUED — H3 |
| Finance summary includes sample deals/notes; accepted price shown as "Collected MTD" | `routes-finance.ts:927,1004`; `realDeal()`/`realNote()` exist but are not used there | QUEUED — H3 |
| Acquired-note NSF reversal stores any `originalPaymentId` unchecked | `routes-notes.ts:1740-1805` | QUEUED — H3 |
| Founder "MRR" is 30-day posted revenue (annual/one-time included, refunds not netted); `crossedAt` is read time | `routes-finance-ledger.ts:59-71,479` | QUEUED — H3 |
| Registry: a present BYOK row skips the balance check; a failed BYOK resolve falls back to the platform key without re-checking; debit not awaited; event id = fingerprint + day (no org) | `provider-registry.ts:177-201,264-271,305,646` | QUEUED — H3. (Charging the *reported* cost rather than the list price was fixed as DEFECT-0199.) |

## Deal evidence (H4)

| Case | At HEAD | Status |
|---|---|---|
| Creating a deal records `first_offer_made`; the real offer-sent transition exists but does not emit it | `routes-deals.ts:703-713` vs `:1115` | QUEUED — H4 |
| Entering escrow emits `contract.signed` with no document; e-sign receipts exist (`signatures`, `generated_documents.signedAt`) but are not linked | `routes-deals.ts:790-797`; pinned by `wholesaleEvents.test.ts:51` | QUEUED — H4 |
| A close sends `acceptedAmount` as a high-quality sale to training and the market network regardless of deal type or sample lineage; no dedupe key, no retraction | `routes-deals.ts:907,928-956,1094` (consent + 5-operator floor already applied, DEFECT-0159) | QUEUED — H4 |
| Valuation comps: state-only query, `distance: 0` under a 50-mile limit, +30 ZIP points for two empty ZIPs, +15 "nearest < 5 mi" on every valuation | `acreOSValuation.ts:810-846,907,1110` | QUEUED — H4 |

## Setup durability and founder operation (H5)

| Case | At HEAD | Status |
|---|---|---|
| Onboarding step 1 advances after `Promise.allSettled` failures; `/complete` returns success after persona/preference failures | `onboarding-v2.tsx:654-666`, `routes-onboarding.ts:92-147` | QUEUED — H5 |
| Any member's *personal* persona change rewrites the org's business type | `routes-persona.ts:91-133` | QUEUED — H5 |
| Sample seeder: a partial seed cannot resume (skips when any marker exists) | `sampleSeeder.ts:676-731`; pinned by `sampleSeeder.test.ts` | QUEUED — H5 |
| Founder funnel bars divide a 50-row, unwindowed list by a 30-day total; the activation denominator is every org ever | `onboarding-funnel.tsx:187-207`, `activation.ts:99-114` | QUEUED — H5 |
| Workflow run marked `completed` after an unavailable/blocked step | `workflow-engine.ts:2213-2260`; pinned by `workflowActionHonesty.test.ts:254-293` | QUEUED — H5 |
| Today runs the portfolio health job inside every GET and reads all leads/properties | `routes-today.ts:548,611,1276` | QUEUED — H5 (measure first) |
| `/api/market-intelligence/public/data` returns fixed state prices with a fresh timestamp; no caller | `routes-market-intelligence.ts:116-131` | QUEUED — H5 (delete) |

## Independent audit of `6b730aa` (parcel layering) — folded into this slice

| Finding | Status |
|---|---|
| The Regrid provider's **comps** path dropped the registry's BYOK key, comps read only the legacy credential store, and comps were cached by coordinate for every org | **FIXED** — DEFECT-0198 |
| The registry debited the list price for a lookup the provider answered free | **FIXED** — DEFECT-0199 |
| Regrid-first on **AcreOS's platform key** made direct routes (drive mode, field scout, bulk fetch) pay for data the county publishes free, with no credit debit | **FIXED** — DEFECT-0200: the org's own key goes first, the platform licence goes behind free county data |
| Proprietary Regrid facts recorded in the observation log with no org read as platform data | **FIXED** — DEFECT-0201 |
| "Unknown Owner" / "Unknown" placeholders in the deal machine and dossier; entity owners greeted "Dear ," | **FIXED** — DEFECT-0201 |
| County GIS rows cached globally although each endpoint's redistribution is `review-required` | OPEN — DEFECT-0202 |

## What remains outside any code change

These need outside proof or a founder decision, as the directive's own limits section says:

- **Provider accounts:** a Lob live key and webhook secret, and a real Outlook/Gmail account for the mail cases.
- **Design-partner evidence:** which reply channel real recipients use.
- **Deployment:** a deployed build to measure Today at 10,000 records.
- **Licensing:** the Regrid licence, and the per-county redistribution review.
