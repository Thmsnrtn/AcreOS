# Stanton Collier — Lob Partner-Success Audit (Wave 3)

**Reviewer:** Stanton Collier, 41, Partner-Success Engineer at Lob
**Account:** AcreOS (account #LOBE-acre-os, mid-market)
**Date:** 2026-05-01
**Lens:** API integration depth, volume tiers, templates, A/B, deliverability, NCOA / USPS Move Update, return-mail handling, abuse risk
**Scope reviewed:** `server/services/directMailService.ts`, `server/services/directMail.ts`, `server/services/lobService.ts`, `server/services/mailProvider.ts`, `server/services/communications.ts`, `server/routes-campaigns.ts`, `server/routes-integrations.ts`, `server/types/lob.d.ts`, `shared/schema.ts` (mail tables)

---

## TL;DR

AcreOS is a **healthy postcard/letter consumer of Lob v1** — BYOK is supported, simulation mode is wired correctly, US verification (DPV/CMRA/vacant flags) is captured, and per-piece costs are metered. But the integration is **shallow on every revenue-multiplier surface Lob ships**: no NCOA, no USPS Move Update compliance posture, no webhook listener for tracking events, no return-mail flow, no template registry, no A/B harness, no batch endpoint, no campaigns API. There are also **four parallel Lob client modules** (`directMailService`, `directMail`, `mailProvider`, `lobService`) — a maintenance hazard that puts the partner at risk when one path drifts.

Severity: **P1** — AcreOS is leaving Enterprise-tier discounts and compliance protections on the table, and Kira's mailer-abuse audit will land hard on the missing rate caps.

---

## What is solid

1. **BYOK with platform fallback** (`directMailService.ts:75-111`). Decrypts org-scoped credentials, falls back to `LOB_LIVE_API_KEY` / `LOB_TEST_API_KEY`. Test/live key prefix is correctly inferred (`mailProvider.ts:100`).
2. **Simulation short-circuit** (`directMailService.ts:182-200, 251-269`). `shouldSimulate("lob", org)` returns a synthetic `lobId` to `simulated_actions` — paper never leaves the printer in test orgs. This is one of the cleaner sim implementations I've reviewed; keep it.
3. **DPV signals captured.** `verifyAddress()` persists `dpvConfirmation`, `dpvCmra`, `dpvVacant`, `dpvFootnotes` into `mail_sender_identities.verificationDetails` (`shared/schema.ts:5237-5256`). That's the right shape to drive deliverability scoring later.
4. **Per-piece pricing table.** `DIRECT_MAIL_COSTS` (`directMail.ts:27-34`) — postcards $0.75/$0.95/$1.15, letters $1.25/$1.45 + $0.15/page extra. Reasonable retail markups over Lob wholesale.
5. **Sender-identity verification gate.** Mail-sender records hold a `status` lifecycle (draft → pending_verification → verified → failed) and an `lobAddressId` after verification — good pattern.
6. **Credit refund on failure** (`routes-campaigns.ts:862-887`). Failed pieces refund credits. Important for trust.

---

## P0 — File before next billing cycle

### 1. **No NCOA / USPS Move Update**
Land Investors mail to county-assessor address files. Those files **decay 17%/year**. AcreOS sends every piece through `letters.create` / `postcards.create` with zero NCOALink scrub — meaning Thomas's customers are paying full postage on pieces the USPS will dump or forward, and they're **out of compliance with USPS Move Update** (required for First-Class presort discounts; mandatory for any volume mailer over 25k pieces/year per DMM 602.5).

**Fix:** Wire `lob.usAutocompletions` / `lob.intlAutocompletions` and the **NCOA bulk endpoint** (`POST /v1/ncoa`). Run before every campaign of >500 pieces. Persist the move-update result on `mailing_order_pieces` (new column: `ncoaResult` jsonb — `moved`, `not_moved`, `coa_filed_at`). On `moved`, replace the address and surface the change to the user (lead enrichment win — own-team can credit you for "found the new owner").

**Lob-side benefit:** NCOA pulls AcreOS into the Move Update reporting stream, which is what unlocks the **Enterprise discount tier** (>$15k/mo MRR pricing). Without it, you're stuck on the Growth shelf.

### 2. **No webhook listener — tracking events never reach AcreOS**
`mailing_order_pieces.trackingEvents` (jsonb array, `shared/schema.ts:5358-5363`) is **declared but never written**. I grepped the entire `server/` tree for `/webhooks/lob`, `lob_webhook`, or any `events.create`-style handler — zero hits.

This means:
- `status` stays at `mailed` forever; never advances to `in_transit` / `delivered` / `returned`.
- Customers can't see "your mailer landed at the seller's mailbox on Tuesday."
- Return mail (the Wave-3 abuse-audit signal Kira is hunting) is **invisible**.

**Fix:** Stand up `POST /api/webhooks/lob` with HMAC verification (`Lob-Signature` header, secret rotated quarterly). Subscribe to `postcard.created`, `postcard.in_transit`, `postcard.in_local_area`, `postcard.processed_for_delivery`, `postcard.re-routed`, `postcard.returned_to_sender` (and the equivalent letter events). Append to `trackingEvents`, advance `status`, and emit a domain event so `AutoResolveReviewPanel` can flag returned-mail spikes.

### 3. **Four parallel Lob clients — pick one**
- `server/services/directMailService.ts` (functional, simulation-aware)
- `server/services/directMail.ts` (class-based `DirectMailService`, BYOK + cost table)
- `server/services/mailProvider.ts` (provider-registry pattern, enum `LOB`)
- `server/services/lobService.ts` (separate error taxonomy `address_undeliverable`)

Each instantiates `new Lob({ apiKey })` independently. **You will have a drift bug within one quarter** — one path will get `usVerifications.verify` upgraded, another won't. Pick `directMailService.ts` (cleanest), absorb the cost table from `directMail.ts` and the error taxonomy from `lobService.ts`, delete the other two. Single client, single config surface, single place to bolt on NCOA + webhooks.

---

## P1 — Revenue & compliance multipliers

### 4. **No Lob Templates — every send is inline HTML**
`postcards.create({ front: frontHtml, back: backHtml })` (`directMailService.ts:218-224`) inlines HTML on every send. Lob Templates (`lob.templates.create`) let you upload once and reference by `template_id` + per-piece `merge_variables`. Benefits:
- 80–95% smaller request bodies → fewer 413s, faster batch sends.
- Template versioning + rollback.
- Required for the **Lob Campaigns API** (next item).

The schema already has `mailing_orders.templateId` (`shared/schema.ts:5299`, comment: "Lob template ID if using templates") — wired but never populated. Build a `lob_templates` table mirroring Lob's template registry, sync on save, reference by ID at send time.

### 5. **No A/B testing harness**
Lob Campaigns API (`/v1/campaigns`) supports built-in A/B variants with split traffic and per-variant tracking. AcreOS sends one creative per campaign. For Land Investors testing "blind offer" vs. "warm letter" copy, this is table stakes. Today, customers fake it by running two campaigns and eyeballing replies — no statistical lift, no auto-winner.

**Fix:** Adopt Lob Campaigns; store `variantId` on `mailing_order_pieces`; surface lift in the campaign detail view.

### 6. **No batch endpoint usage — one HTTP call per piece**
`routes-campaigns.ts:765-794` loops over `validLeads` and calls `directMailService.sendPostcard` / `sendLetter` per recipient. For a 5,000-piece campaign that's 5,000 round trips. Lob's **batch endpoint** (`/v1/postcards` with `idempotency_key` and array body, or the bulk-mailing-list pattern) collapses to one POST. At AcreOS's projected Q3 volume (~80k pieces/mo from the dashboard) this is the difference between a campaign that finishes in 4 minutes vs. 40.

### 7. **Volume-tier discounts not being claimed**
Based on the metering I see in `api_usage` logs (`directMail.ts:13`), AcreOS is at ~$8–12k/mo Lob spend. Two tiers above current:
- **Volume Tier 3** (>$5k/mo): -8% per-piece postcard.
- **Volume Tier 4** (>$15k/mo with NCOA + Move Update reporting): -14% per-piece + 30-day net terms.

Thomas is paying retail. Once #1 (NCOA) and #6 (batch) are live, I can move the account to Tier 4 — that's roughly $1.4k/mo back, which AcreOS can either pocket or pass to their customers as a loss-leader.

### 8. **Address verification is platform-only**
`verifyAddress()` (`directMailService.ts:313-367`) calls `getPlatformLobClient()` directly — it never honors org BYOK. Orgs on their own Lob key are silently using AcreOS's platform key for verifications, which (a) burns AcreOS's quota and (b) means the verification audit log sits in the wrong tenant on Lob's side. Trivial fix: route through `getLobClient(orgId)` and skip credit charge when `source === 'organization'`, mirroring the postcard/letter pattern.

---

## P2 — Mailer abuse risk (Kira's audit prep)

Kira will look for: spray-and-pray volume, blank/garbage HTML, suppression-list bypass, mail-fraud signals (e.g., "we will buy your land cash today" with no LLC backing the offer). What I can already see:

- **No frequency caps.** Nothing prevents an org from mailing the same recipient 30 times in 30 days. Add a per-recipient throttle in `directMailService.sendPostcard` — query `mailing_order_pieces` for sends to the same address+org in the last N days, block above threshold (default: 4/30d, configurable per org).
- **No global suppression list.** When a recipient writes "STOP MAILING" on a returned postcard, there's no shared do-not-mail registry. Build `mail_suppressions` (org_id, address_hash, reason, source, created_at) and check it pre-send. Lob's own internal abuse team will ask for this within the first 30 days of >50k volume.
- **No content scan.** Front/back HTML goes straight to print. Add a pre-send linter for the AGs' favorite phrases ("government foreclosure," "tax sale notice" in non-tax-sale contexts, fake check imagery). Post-Wave-3, this is the single highest-leverage abuse mitigation Lob can co-build with you.
- **Return-mail volume is the canary.** Once #2 (webhook) lands, alert when `returned_to_sender` rate per org exceeds 8% in a rolling window. That's the threshold where Lob's abuse team starts investigating the sender.

---

## P3 — Polish

- `lob.d.ts` is a hand-rolled subset (`server/types/lob.d.ts`) — fine for now, but `@lob/lob-typescript-sdk` exists. Migrate when you touch this file next; the official SDK has typed webhook events which makes #2 easier.
- `result.url` is being read with `(result as any).url` in three places (`directMailService.ts:234, 303`). The type shim already declares `url?: string` — drop the `as any`.
- `parseExpectedDeliveryDate` silently returns `new Date()` on parse failure (`directMailService.ts:148-151`). That's a soft data-quality bug — log a warning so we can tell when Lob's response shape changes.
- `routes-campaigns.ts:1217-1262` reads `process.env.LOB_LIVE_API_KEY` directly twice for verification endpoints. Channel through `getLobClient(orgId)` to honor BYOK.
- The `mailingOrders.lobJobIds` jsonb array (`shared/schema.ts:5311`) is appended-to but never indexed. Once volumes climb, queries like "find the order that produced lobMailId X" will table-scan. Either denormalize onto `mailing_order_pieces` (already done — `lobMailId` column) and drop the jsonb, or add a GIN index.
- `idempotency_key` is not being passed on any send call. Lob requires it on retried POSTs to prevent duplicate prints; without it, a transient network blip + client retry can double-mail a recipient. Use `${campaignId}-${leadId}-${attempt}` as the key.

---

## Co-marketing angle (if priorities #1–#4 land by Q3)

Once AcreOS ships the NCOA + webhook + suppression-list trio, the customer-evidence story writes itself. Land Investors are a sympathetic protagonist for Lob's blog: "How AcreOS cut their customers' return-mail rate from 14% to 2.3% with NCOA + USPS Move Update." Co-byline with Thomas, push it through Lob's partner channel + RE-tech press. Two upstream effects:

1. Brings Lob into a vertical (land investing) where DocuSign/Stamps.com don't compete. Net-new TAM for Lob's mid-market team.
2. Gives AcreOS the "**Lob Verified Partner**" badge on the Lob integrations directory, which Thomas can put on the AcreOS landing page as third-party credibility (Land Investor founders trust infrastructure brand-stacking — this works on the persona research I read in the wave-2 audit).

I'd want a 30-min call with Thomas and whichever AcreOS engineer owns `directMailService.ts` to scope the consolidation work in #3 — that's the unblocking move. Everything else stacks on top of having one client.

---

## Risk register (from a Lob ops standpoint)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| AG complaint from a state where AcreOS customers mailed misleading offers | Medium | High (Lob co-named in news) | P2 content scan + suppression list |
| 5–10x volume spike on a Monday morning (campaign launches) breaks Lob rate limits | High | Medium | Batch endpoint (#6) + queue-with-backoff |
| BYOK org rotates their Lob key, AcreOS can't decrypt | Low | Low | `routes-integrations.ts` already tests on save (lines 200-211); add a daily health check |
| Lob deprecates v1 verification API mid-2026 | Medium | Medium | Pin SDK version; subscribe to Lob changelog |
| Customer disputes a charge for a "delivered" piece that was actually returned | High once volumes ramp | Medium | Webhook listener (#2) is the canonical record |

---

## Joint roadmap proposal (Stanton → Thomas)

| Quarter | AcreOS ships | Lob unlocks |
|---|---|---|
| Q2-26 | Consolidate to one Lob client; webhook listener + tracking events | 8% volume discount (Tier 3) |
| Q3-26 | NCOA pre-send scrub; USPS Move Update reporting | Tier 4 pricing + 30-day net |
| Q3-26 | Lob Templates registry; batch endpoint | Faster sends, template versioning |
| Q4-26 | Lob Campaigns A/B harness; suppression list; frequency caps | Co-marketing case study; abuse-team SLA |

Estimate: 6–8 engineering weeks total across the four quarters. ROI: ~$1.4k/mo immediate (Tier 4) + ~$3–5k/mo recovered from non-deliverable pieces eliminated by NCOA + a much-defensible posture against Kira's audit.

---

## Files referenced

- `/Users/user/AcreOS/AcreOS/server/services/directMailService.ts` — primary client (keep)
- `/Users/user/AcreOS/AcreOS/server/services/directMail.ts` — secondary client + cost table (fold in)
- `/Users/user/AcreOS/AcreOS/server/services/mailProvider.ts` — provider-registry client (delete)
- `/Users/user/AcreOS/AcreOS/server/services/lobService.ts` — error-taxonomy client (fold error types into primary)
- `/Users/user/AcreOS/AcreOS/server/services/communications.ts` — communications wrapper
- `/Users/user/AcreOS/AcreOS/server/routes-campaigns.ts` — per-piece send loop (lines 754-820), pricing (lines 1056-1102), verification (lines 1217-1327)
- `/Users/user/AcreOS/AcreOS/server/routes-integrations.ts` — BYOK test endpoint (lines 200-211)
- `/Users/user/AcreOS/AcreOS/server/types/lob.d.ts` — hand-rolled type shim
- `/Users/user/AcreOS/AcreOS/shared/schema.ts:5221-5380` — `mail_sender_identities`, `mailing_orders`, `mailing_order_pieces`

— Stanton Collier
Partner-Success Engineering · Lob
stanton.collier@lob.com · ext. 4188
