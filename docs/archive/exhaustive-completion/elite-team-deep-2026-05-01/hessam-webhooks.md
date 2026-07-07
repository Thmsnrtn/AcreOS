# Webhook Ingestion Audit — AcreOS

**Author:** Hessam Mortazavi, Webhooks Platform (ex-Stripe)
**Date:** 2026-05-01
**Lens:** "Webhooks are easy to write and devastating to get wrong. Signature, replay, idempotency, ordering, dead-letter — every one of those failures looks like a refund or a TCPA fine in someone's inbox six months later."

Read by Hessam: `server/webhookHandlers.ts`, `server/index.ts:233-259` (Stripe mount), `server/middleware/twilioSignature.ts`, `server/routes-misc.ts:300-460` (Twilio inbound + status), `server/routes-voice.ts:79-300` (recording), `server/routes-elite-features.ts:288-312` (Dropbox Sign), `server/services/eSigningService.ts:243-295` (e-sign processor), `server/services/smsService.ts:307-421` (handleIncomingSMS), `server/stripeClient.ts`, `shared/schema.ts:10100-10108` (stripeProcessedEvents), `shared/schema.ts:1477+10285` (messages.externalId).

---

## 1. One-line verdict

**Stripe is solid; everything else has at least one P0 hole.** Twilio inbound has no MessageSid replay protection, Dropbox Sign has no event-level idempotency, SendGrid event webhooks are not implemented at all, and there is no per-source webhook observability. The Stripe handler itself is fine until Stripe ships their next API rev — which auto-applies because the SDK has no `apiVersion` pin.

---

## 2. Per-source audit

### 2.1 Stripe — `server/webhookHandlers.ts` + `server/index.ts:233-259`

| Property | Status | Detail |
|---|---|---|
| Signature verification | **Pass** | `stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET`, fails closed if absent. Raw `Buffer` body enforced (handler explicitly rejects non-Buffer). |
| Idempotency | **Pass** | `INSERT … ON CONFLICT DO NOTHING RETURNING id` on `stripe_processed_events`. Atomic claim, no TOCTOU. |
| Replay | **Pass** | Stripe signature includes a timestamp; SDK rejects > 5 min skew by default. Verified by `constructEvent`. |
| Ordering | **Partial** | No explicit ordering, but the `subscription.updated` handler retrieves the *current* price/state from Stripe rather than relying on the event's snapshot for tier (`webhookHandlers.ts:389`). That defeats most out-of-order-delivery harm. |
| Error path | **Pass** | Errors are logged but not re-thrown to the HTTP handler — Stripe gets 200 even on inner failure. This is **deliberate and correct** to prevent infinite Stripe retries on poison events, but means a silent failure leaves the org in a stale state. No alert wired. |
| Unhandled types | **Logged only** | `[webhook] Unhandled Stripe event type: …` — line 153. No metric, no alert. |
| **Hidden risk** | **Stripe SDK has no pinned `apiVersion`** (`stripeClient.ts:77`). The Stripe SDK defaults to the account's pinned version on the dashboard, but if the dashboard version is upgraded (manual or auto) the *event payload shape changes silently*. Two example breaks shipping in late 2025 / early 2026: `Invoice.subscription` removed (now `Invoice.parent.subscription_details.subscription`); `Subscription.current_period_end` removed (now lives on subscription items). Both are accessed in this file (`webhookHandlers.ts:249-251` for `(invoice as any).subscription`). The cast hides the risk. |

What's still missing on Stripe specifically:

1. **Pin `apiVersion: '2024-11-20.acacia'`** (or whichever rev you have today) in `new Stripe(...)`. Without it, a Stripe-side dashboard change silently breaks `processPaymentFailed`.
2. **Event-type whitelist + alert on unhandled.** Today an unhandled type = log line; Stripe will eventually deprecate ones you do handle. Emit a counter `webhook_unhandled_event_total{event_type=…}`.
3. **Disposition ledger.** The `stripe_processed_events` table records *that* the event was claimed, not *what happened with it*. Add columns: `dispatch_status` (success/error/skipped), `dispatch_error`, `dispatch_completed_at`. Without these, you cannot answer "was this customer's `subscription.updated` actually applied to our DB?" without grep-ing logs.
4. **Charge-dispute response action.** Today `processChargeDispute` writes a system alert. There is no automatic evidence-submission deadline tracker. Stripe gives you ~21 days; a missed window is automatic loss. P1.
5. **`payment_intent.requires_action` / `setup_intent.*`** — none of these are handled. Pre-100, may be fine; post-100 with SCA-region customers, expect 3DS challenges to silently leak.

### 2.2 Twilio — `server/routes-misc.ts:300-460` + `server/middleware/twilioSignature.ts`

| Property | Status | Detail |
|---|---|---|
| Signature verification | **Pass** | HMAC-SHA1 of full URL + sorted POST params, timing-safe comparison. Reverse-proxy host/proto correctly read from `x-forwarded-*`. Fails closed in production if `TWILIO_AUTH_TOKEN` missing. |
| Replay (MessageSid dedup) | **FAIL — P0** | `handleIncomingSMS` (`smsService.ts:401-411`) inserts directly into `messages` with `externalId: messageSid`. The `externalId` column has **no unique constraint, no index** (`shared/schema.ts:1477+10285`). Twilio retries (Twilio retries up to 11× over 24h on non-2xx) will create duplicate `messages` rows, duplicate Pax nudges, duplicate auto-replies. The TCPA opt-out path *does* exit early on STOP keyword, but the regular inbound path has no claim. |
| STOP keyword handling | **Pass (functionally)** | Both routes-misc.ts (TCPA) and smsService.ts (SMS_STOP_WORDS) handle STOP. **However, two paths run the STOP logic**, and they don't agree on the canonical opt-out store: `routes-misc.ts:339` calls `processOptKeyword` (TCPA module), then short-circuits before `handleIncomingSMS` runs — so the smsService STOP logic at `smsService.ts:319` is dead code on the webhook path. Audit which is canonical; remove the other or you'll have drift. |
| Phone-number validation | **Weak** | The `cleanTo`/`last10Digits` matcher uses `.includes()` (line 325, 356) rather than equality. `+15551234567` and `+15551234567890` (impossible but illustrative) would match by substring. More importantly, the matcher is O(N) over all leads in org — 50k-lead orgs will be slow. Add a phone-normalized index. |
| Status callbacks | **Partial** | `sms-status` updates `messages.status` by `externalId`. Replay-safe (idempotent UPDATE), but if the same MessageSid was inserted twice (see above), this updates *both* rows. |
| Recording status | **Partial** | `recording-status` (`routes-misc.ts:410`) responds 200 immediately, then triggers Whisper. **No idempotency on the transcription kickoff** — if Twilio retries, you pay OpenAI twice for the same recording. |

P0: add a unique index on `messages(externalId)` filtered to `WHERE externalId IS NOT NULL`. The insert in `handleIncomingSMS` then needs `.onConflictDoNothing()`. Mirror the Stripe atomic claim pattern.

### 2.3 SendGrid — **NOT IMPLEMENTED**

There is no SendGrid event webhook receiver. Searched: `/webhooks/sendgrid`, `sendgrid event`, `bounce`, `dropped`, `spamreport`, `unsubscribe webhook`. Nothing.

What this means:
- Bounces are not being recorded. AcreOS will keep sending to addresses Gmail has hard-bounced, which destroys IP reputation. Eventually all email lands in spam.
- Spam reports are not being recorded. CAN-SPAM compliance requires honoring unsubscribes within 10 business days; a SendGrid `unsubscribe` event from the recipient's mail client is the canonical signal. Today, AcreOS has no way to know.
- The `unsubscribeUrl` in `emailService.ts:212` produces a link, but there's no record of what the unsub UI does — verify it writes to a suppression table that `sendEmail` consults *before* every send. (I did not find one.)

P0: implement `POST /api/webhooks/sendgrid/events`. Verify with SendGrid's signed event webhook (Ed25519 since 2021 — see SendGrid docs, header `X-Twilio-Email-Event-Webhook-Signature` + `X-Twilio-Email-Event-Webhook-Timestamp`). Idempotency key: `(sg_event_id)` from the payload — SendGrid emits one per event, persistent. Persist to a `email_events` table; update a `email_suppressions` table on `bounce` (hard), `dropped`, `spamreport`, `unsubscribe`. Make `emailService.sendEmail` consult `email_suppressions` before every send.

### 2.4 Dropbox Sign / e-sign — `server/routes-elite-features.ts:288-312`

| Property | Status | Detail |
|---|---|---|
| Signature verification | **Pass (with caveat)** | HMAC-SHA256 of `JSON.stringify(req.body)` against `DROPBOX_SIGN_WEBHOOK_KEY`. **Caveat:** if the key is unset, the route silently accepts unsigned webhooks (`if (webhookKey && signature)` short-circuits). Should fail-closed in production. |
| Idempotency | **FAIL — P0** | `processDropboxSignWebhook` (`eSigningService.ts:246`) does an unconditional `UPDATE` on `generated_documents`. Same event delivered twice = double-update (cosmetically idempotent for most fields, but `signedAt: new Date()` overwrites with the *retry's* timestamp, not the original). Worse: there is no log of "we already saw this event," so an out-of-order `signature_request_signed` arriving after `signature_request_all_signed` will downgrade `esignStatus` from `completed` → `partially_signed`. |
| Replay | **FAIL** | Dropbox Sign sends an `event.event_time` and `event.event_hash`. Neither is checked. A captured webhook can be replayed indefinitely. |
| Ordering | **FAIL** | The handler treats events as authoritative-of-now rather than reading the current row state. Out-of-order `signed` after `all_signed` regresses status. Fix: only accept transitions that move forward in a state machine. |
| Attachments | **Not handled** | The webhook payload doesn't pull the signed PDF; the system relies on a separate `getSignatureRequestStatus` poll to fetch URLs. **There's no `signedFileUrl` write in the webhook path.** Customers signing today get the row marked completed but no signed-PDF link until something else polls. |

P0:
1. **Add atomic claim**, mirroring Stripe: `INSERT INTO esign_processed_events (provider, event_id) VALUES (...) ON CONFLICT DO NOTHING`. Use `event.event_hash` (Dropbox Sign) or, if not present, a hash of `(provider, signature_request_id, event_type, event_time)`.
2. **State-machine guard**: only transition `pending → partially_signed → completed`. Reject backwards transitions.
3. **Fetch + persist signed PDF** on `signature_request_all_signed`/`completed`. Without this, "signed" is a lie until someone refreshes the page.
4. **Fail-closed on missing webhook key in production.**

### 2.5 AI provider error callbacks — **NOT WIRED**

OpenAI/Anthropic/etc. don't push webhooks to AcreOS for completion errors today (the SDK calls are synchronous). No action — but if/when AcreOS adopts batch APIs (OpenAI Batch, Anthropic Message Batches with status webhooks), revisit.

### 2.6 Outbound webhooks — `developerApiService.ts`

There's a customer-facing webhook *emitter* (`server/services/developerApiService.ts:237` — "All events are signed with HMAC-SHA256") and a `/webhooks` settings UI. That's outbound and out of Hessam's scope here, but **it should also have a dead-letter queue and retry policy** (see §5).

---

## 3. Edge cases + future-Stripe-API-version handling

The Stripe handler is solid for today's API rev. The risks are:

| Edge case | Today's handling | Recommendation |
|---|---|---|
| Stripe API version auto-bump on dashboard | SDK has no `apiVersion` pin — silently inherits whatever is on the dashboard | Pin explicitly. Block dashboard upgrades behind a code change. Add a CI test that constructs a fixture event of the pinned version. |
| New event type added by Stripe (e.g. `customer.tax_id.created`) | Falls into `Unhandled` log line | Emit `webhook_unhandled_event_total{event_type}` counter; alert if > 0 for unknown types. Triage in next sprint. |
| Out-of-order delivery (`subscription.updated` arrives before `subscription.created`) | `processSubscriptionUpdated` looks up org by Stripe customer; if not found, returns silently | Acceptable, but **emit a metric** `webhook_org_not_found_total`. Today it's invisible. |
| Stripe retries an event that failed our dispatch | We claim, then dispatch fails silently; Stripe stops retrying because we 200'd | Add a dispatch-status column (see §2.1.3). On dispatch failure, a separate sweeper retries from our table. Decouples Stripe's retry policy from ours. |
| Webhook secret rotation | Single env var | Support two secrets (`STRIPE_WEBHOOK_SECRET` and `STRIPE_WEBHOOK_SECRET_PREVIOUS`); accept either during a rotation window. Stripe supports two active endpoints, but this is simpler. |
| Payload size > 1mb | `express.raw()` has no explicit limit set on the Stripe route — inherits Express default of 100kb? Verify. The `express.json()` middleware is set to 1mb, but the raw mount is separate (line 235). | Set explicit limit: `express.raw({ type: 'application/json', limit: '256kb' })`. Stripe events fit. |
| Clock skew on the verifying instance | `constructEvent` uses 5-minute tolerance by default | Fine. But Ines's note about Fly.io NTP drift applies — log if `tolerance` is exercised. |

---

## 4. Dev/test workflow — recommendation

I see no documented webhook dev workflow. Today, the practical reality for an engineer changing `webhookHandlers.ts`:

1. Spin up Stripe CLI (`stripe listen --forward-to localhost:3000/api/stripe/webhook`) — works because the handler is signature-verified against `STRIPE_WEBHOOK_SECRET`, and `stripe listen` injects its own.
2. For Twilio: ngrok + manually curl the webhook URL with a forged signature (since `TWILIO_AUTH_TOKEN` is set), or set `NODE_ENV != production` to bypass.
3. For Dropbox Sign: same — manual ngrok + curl.
4. For SendGrid: doesn't exist, so n/a.

**Recommendation — add `scripts/webhook-replay.ts`:**

A CLI tool that takes a saved webhook payload (we can capture them in production by adding a "raw payload" log field, redacted) and replays it against the local dev server with a freshly-computed signature. Fixture directory: `tests/fixtures/webhooks/{stripe,twilio,dropbox-sign,sendgrid}/*.json`. Each fixture is a real (sanitized) production event. The tool:
- Loads the fixture
- Computes the signature using the local `*_WEBHOOK_SECRET` env
- POSTs to `localhost:PORT/api/webhooks/...`
- Reports 2xx/non-2xx + log tail

This is cheaper than ngrok for 90% of cases (you don't need real Stripe state) and gives a regression test corpus. CI runs `webhook-replay.ts --all` to confirm every fixture still 200s.

For the Stripe CLI path, document it in `docs/deployment-checklist.md` with the exact `stripe trigger` commands for the 11 event types we handle.

---

## 5. Dead-letter + retry policy proposal

Today there is no webhook DLQ. Stripe's claim-then-dispatch-then-log-and-200 pattern means a failed dispatch is **silently lost** — Stripe will not retry (we 200'd), and we have no reprocessing path. Same is true for Twilio status callbacks and Dropbox Sign.

**Proposed table: `webhook_dispatch_log`**

```
id            serial pk
source        text  -- 'stripe' | 'twilio_sms' | 'twilio_sms_status' | 'dropbox_sign' | 'sendgrid'
external_id   text  -- stripe event_id, twilio MessageSid, etc.
event_type    text
payload       jsonb -- redacted; full event for replay
received_at   timestamptz default now()
claimed_at    timestamptz
dispatch_status text  -- 'pending' | 'success' | 'error' | 'dead_lettered'
attempts      int default 0
last_error    text
last_attempt_at timestamptz
unique(source, external_id)
```

**Dispatch policy:**

- On webhook receipt: `INSERT … ON CONFLICT DO NOTHING` (atomic claim, single source-of-truth across all webhook sources).
- Synchronous dispatch in-request, with `try/catch`. On success, set `dispatch_status='success'`. On failure, set `dispatch_status='error'`, increment attempts, return 200 anyway (we already claimed).
- **Background sweeper** every 60s: `WHERE dispatch_status='error' AND attempts < 5 AND last_attempt_at < now() - exponential_backoff(attempts)`. Retries with the captured `payload`.
- After 5 attempts: `dispatch_status='dead_lettered'`. Founder alert. Manual replay UI in admin: `/founder/webhooks/dead-letter`.
- Backoff: 1m, 5m, 30m, 2h, 12h. After that, dead-letter.

**Replay UI:** A founder-only page lists dead-lettered events with `Replay` and `Mark resolved` buttons. Replay sets `attempts=0, dispatch_status='pending'` and the sweeper picks it up.

This lets AcreOS recover from any transient outage (DB blip, downstream API down) without operator intervention, and surface the genuinely-broken cases for human triage.

---

## 6. Observability dashboard spec

A single Grafana dashboard, `Webhook Ingestion`, with one row per source.

**Per source (Stripe, Twilio inbound, Twilio status, Twilio recording, Dropbox Sign, SendGrid):**

| Panel | Metric | Alert |
|---|---|---|
| Receive rate | `webhook_received_total{source}` (rate over 5m) | n/a |
| Claim rate (success / dup) | `webhook_claimed_total{source, outcome=claimed\|duplicate}` | Alert if duplicate rate > 10% — indicates upstream retry storm |
| Dispatch latency | `webhook_dispatch_duration_seconds{source}` histogram | p95 > 5s |
| Dispatch error rate | `webhook_dispatch_errors_total{source}` / `webhook_received_total{source}` | > 1% over 15m |
| Dead-letter count | `SELECT count(*) FROM webhook_dispatch_log WHERE dispatch_status='dead_lettered' AND created_at > now() - '24h'` | > 0 in 24h pages on-call |
| Lag (received → success) | `webhook_dispatch_lag_seconds{source}` | p95 > 30s |
| Signature failures | `webhook_signature_invalid_total{source}` | Spike alert (suggests forgery attempt or rotated secret) |

**Cross-source health row:**
- Total webhook DB pool wait time
- Webhook route 5xx rate
- Stripe events received in last hour vs same hour last week (anomaly detection — Stripe outage shows up here first)

**Per-source SLOs:**
- Stripe: 99.95% claim success, 99.5% dispatch success, p95 dispatch lag < 10s.
- Twilio inbound: 99.9% claim, 99% dispatch (some inbound SMS legitimately won't match a lead — that's not an error, that's a soft outcome — emit `webhook_dispatch_total{source='twilio_sms', outcome='no_match'}` distinct from `outcome='success'`).
- Dropbox Sign: 99.9% / 99.5% / p95 < 30s (PDF fetch dominates).
- SendGrid: 99.9% / 99.9% / p95 < 5s once implemented.

---

## 7. The 1-week webhook hardening sprint

**Day 1 (Mon) — close the Twilio replay hole:**
1. Migration: unique partial index `messages_external_id_unique` on `messages(external_id) WHERE external_id IS NOT NULL`. (½ day)
2. Wrap `handleIncomingSMS` insert in `.onConflictDoNothing()`; on conflict, return early with `success: true, dbMessageId: existing.id`. (½ day)
3. Same treatment for `messages` insert in the recording-status handler (Whisper kickoff guard — check if transcript already exists before paying OpenAI). (½ day)

**Day 2 (Tue) — Stripe robustness:**
4. Pin `apiVersion` in `stripeClient.ts`. Add a smoke test that constructs a known-good 2024-11-20 event payload and verifies `processSubscriptionUpdated` writes the expected row. (½ day)
5. Add `dispatch_status`, `dispatch_error`, `dispatch_completed_at` columns to `stripe_processed_events`. Wire the dispatch fn to update them. (½ day)
6. Set explicit `express.raw({ limit: '256kb' })` on the Stripe webhook mount. (¼ day)
7. Emit `webhook_unhandled_event_total{event_type}` counter. (¼ day)

**Day 3 (Wed) — Dropbox Sign idempotency:**
8. Create `esign_processed_events` table; mirror `stripe_processed_events` shape. (¼ day)
9. Atomic claim in `processDropboxSignWebhook`. (¼ day)
10. State-machine guard: reject backwards `esignStatus` transitions. (¼ day)
11. Fail-closed on missing `DROPBOX_SIGN_WEBHOOK_KEY` in production. (¼ day)
12. Fetch signed PDF on `all_signed`/`completed`; write `signedFileUrl` to `generated_documents`. (½ day)

**Day 4 (Thu) — SendGrid event webhook:**
13. New route `POST /api/webhooks/sendgrid/events` with Ed25519 signature verification. (½ day)
14. New tables: `email_events` (raw event log) + `email_suppressions` (canonical do-not-send list, keyed by email). (¼ day)
15. Ingest events; on `bounce` (hard) / `dropped` / `spamreport` / `unsubscribe`, upsert into `email_suppressions`. (¼ day)
16. Modify `emailService.sendEmail` to consult `email_suppressions` first. (½ day)

**Day 5 (Fri) — observability + DLQ:**
17. New shared table `webhook_dispatch_log` (single ledger across all sources). Migration + types. (½ day)
18. Refactor each source to write to the ledger on receipt + dispatch outcome. (½ day)
19. Background sweeper for `dispatch_status='error'` retries with exponential backoff. (½ day)
20. Prometheus counters/histograms for the dashboard spec. (¼ day)
21. Founder-only `/founder/webhooks/dead-letter` admin page with replay button. (¼ day)
22. `scripts/webhook-replay.ts` + fixture directory; document in `docs/deployment-checklist.md`. (½ day)

**Total:** ~5 engineer-days, in priority order. Items 1–3 (Twilio replay) are P0 blocker for any TCPA-careful customer. Items 4–7 (Stripe) are P0 before Stripe's next API rev rolls onto your account. Items 8–12 (Dropbox Sign) are P0 before counterparty signing is heavily used. Items 13–16 (SendGrid) are P0 before any meaningful campaign-email volume.

---

## Closing note

The Stripe handler is the work of someone who has been burned by webhooks before — atomic claim, raw-buffer enforcement, log-and-200 on dispatch failure. That instinct is exactly right. The gap is that *the same instinct hasn't been applied to the other four sources*. Twilio inbound is wide open to the same TOCTOU race that DEFECT-0006 fixed for Stripe. Dropbox Sign accepts unsigned webhooks if the key is unset. SendGrid events aren't ingested at all.

The five-day sprint above closes those gaps and gives the system a single cross-source `webhook_dispatch_log` ledger, which is the only piece of infrastructure that lets you answer the question that comes up at 3am during an incident: *"did we receive that event, did we process it, and if not, where is it now?"* Without that table, you're grepping logs across four services for an event ID you may not even have.

Pin the Stripe `apiVersion` today. The rest can wait until Monday.

— Hessam Mortazavi
