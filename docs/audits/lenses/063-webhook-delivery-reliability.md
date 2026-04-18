# Lens 063 — Webhook Delivery Reliability

**Auditor:** Webhook Delivery Reliability Reviewer
**Tier:** 2
**Date:** 2026-04-18
**Status:** ISSUES FOUND

---

## Scope

Every inbound webhook endpoint in the codebase was examined for:
signature verification, idempotency, out-of-order event tolerance,
guaranteed 200 response to prevent infinite retries, error isolation,
and logging for debugging failed events.

## Inventory of Webhook Endpoints

| # | Route | Source | File |
|---|-------|--------|------|
| 1 | `POST /api/stripe/webhook` | Stripe (subscription billing) | `server/index.ts` -> `server/webhookHandlers.ts` |
| 2 | `POST /api/stripe/connect/webhook` | Stripe Connect (payment acceptance) | `server/routes-billing.ts` |
| 3 | `POST /api/webhooks/twilio/sms` | Twilio (inbound SMS) | `server/routes-misc.ts` |
| 4 | `POST /api/webhooks/twilio/sms-status` | Twilio (delivery status) | `server/routes-misc.ts` |
| 5 | `POST /api/webhooks/twilio/recording-status` | Twilio (recording ready) | `server/routes-misc.ts` |
| 6 | `POST /webhook/twilio/recording-complete` | Twilio (call recording) | `server/routes-voice.ts` |
| 7 | `POST /webhook/disclosure` | Twilio (TCPA disclosure TwiML) | `server/routes-voice.ts` |
| 8 | `POST /api/webhooks/dropbox-sign` | Dropbox Sign (e-signing) | `server/routes-elite-features.ts` |
| 9 | `GET/POST /api/webhooks/meta-lead-ads` | Meta (lead ad submissions) | `server/routes-elite-features.ts` |
| 10 | `POST /api/webhooks/actum` | Actum (ACH returns) | `server/routes-elite-features.ts` |
| 11 | `POST /api/webhooks/inbound-email` | SES/SNS (inbound email) | `server/routes-inbound-email.ts` |
| 12 | `POST /call-routing/route` | Internal/Twilio (call routing) | `server/routes-call-routing.ts` |

Additionally, there is an **outbound** webhook dispatcher (`server/services/webhookDispatcher.ts`) that dispatches events to customer-registered endpoints. This is not an inbound handler but is included in findings for completeness.

---

## Detailed Findings by Handler

### 1. Stripe Main Webhook (`/api/stripe/webhook`)

**File:** `server/index.ts` (route), `server/webhookHandlers.ts` (handler)

| Check | Status | Detail |
|-------|--------|--------|
| Signature verification | PASS | Uses `stripe.webhooks.constructEvent()` with `STRIPE_WEBHOOK_SECRET`. Throws if secret missing. |
| Raw body handling | PASS | Route uses `express.raw({ type: 'application/json' })` and is registered before `express.json()`. Buffer check present. |
| Idempotency | PASS | Checks `stripeProcessedEvents` table before processing; marks processed in `finally` block with `onConflictDoNothing()`. |
| Always returns 200 | PASS | The route in `index.ts` always returns `res.status(200)` after `processWebhook()`. If `processWebhook` throws (signature failure), returns 400 which is correct -- Stripe should not retry invalid signatures. |
| Error isolation | PASS | Each event handler is wrapped in individual try/catch blocks. Failures are logged but do not propagate. |
| Logging | PASS | Structured logger used throughout. Event ID and type logged on skip, error, and success. |
| Out-of-order handling | PARTIAL | See issues below. |

**Issues:**

- **WH-001 (Medium): Double `markProcessed` calls.** Several branches inside `dispatchEvent()` call `markProcessed` explicitly (lines 102, 125, 136, 143, 150, 160) even though `processWebhook()` already calls `markProcessed` in the `finally` block (line 84). The `onConflictDoNothing()` prevents errors, but this is wasteful (extra DB round-trip per event) and confusing. Some event types (`invoice.payment_failed`, `invoice.payment_succeeded`, `customer.subscription.deleted`, `customer.subscription.trial_will_end`) rely solely on the `finally` block, while others call it redundantly. This inconsistency suggests the `finally` pattern was added later without cleaning up the earlier explicit calls.

- **WH-002 (Medium): No out-of-order event protection.** If `customer.subscription.updated` arrives before `checkout.session.completed`, the handler will fail to find the organization by Stripe customer ID (because the customer may not yet be linked to the org). The `processSubscriptionCheckoutCompleted` handler sets the `stripeSubscriptionId`, but if `processSubscriptionUpdated` fires first, it looks up the org by `customerId` -- which should work because `customerId` is set during checkout creation. However, there is no explicit guard or requeue mechanism if the org lookup fails. The handler silently returns, and the event is marked as processed, permanently losing that state change.

- **WH-003 (Low): No dead letter queue.** Failed events are logged and marked as processed but never placed into a retry or dead letter mechanism. If a transient database failure occurs during `dispatchEvent()`, the event is permanently lost because `markProcessed` in the `finally` block records it as handled.

### 2. Stripe Connect Webhook (`/api/stripe/connect/webhook`)

**File:** `server/routes-billing.ts` (lines 636-715)

| Check | Status | Detail |
|-------|--------|--------|
| Signature verification | PASS | Uses `stripe.webhooks.constructEvent()` with `STRIPE_CONNECT_WEBHOOK_SECRET` (falls back to `STRIPE_WEBHOOK_SECRET`). |
| Raw body handling | PASS | Route uses `express.raw({ type: 'application/json' })`. |
| Idempotency | PASS | Checks `stripeProcessedEvents` table. Marks processed in `finally` block. |
| Always returns 200 | FAIL | See issue below. |
| Error isolation | PASS | `handleWebhookEvent` uses a `switch` with individual case logic. |
| Logging | PASS | Event type, ID, and timestamp logged. |

**Issues:**

- **WH-004 (High): Returns 500 on processing errors.** The outer catch block (line 708-714) calls `Errors.internal(res, err)`, which returns HTTP 500. Stripe interprets 5xx responses as transient failures and will retry the event. Since the event was already marked as processed in the `finally` block, the retry will be caught by the idempotency check and silently skipped -- this is self-healing but wasteful. However, if the error occurs *before* the `try/finally` block (e.g., during signature verification or the idempotency check itself), Stripe will retry indefinitely. The handler should always return 200 after receiving a valid signature.

- **WH-005 (Low): Fallback webhook secret.** The handler falls back to `STRIPE_WEBHOOK_SECRET` if `STRIPE_CONNECT_WEBHOOK_SECRET` is not set. In production, the main and connect webhooks use different signing secrets. Using the wrong secret will cause silent signature verification failures.

### 3. Twilio SMS Webhook (`/api/webhooks/twilio/sms`)

**File:** `server/routes-misc.ts` (lines 287-362)

| Check | Status | Detail |
|-------|--------|--------|
| Signature verification | PASS | Uses `verifyTwilioSignature` middleware with HMAC-SHA1 and timing-safe comparison. Rejects in production if `TWILIO_AUTH_TOKEN` is missing. |
| Idempotency | FAIL | No duplicate detection. Twilio provides `MessageSid` but it is not checked against a processed-events table. |
| Always returns 200 | FAIL | See issue below. |
| Error isolation | PARTIAL | Inner processing is wrapped in try/catch but outer catch returns 500. |
| Logging | PASS | Structured logging with message details. |

**Issues:**

- **WH-006 (High): Returns 400/500 on errors, triggering Twilio retries.** Invalid payload returns `res.status(400)` (line 292). Outer catch returns `res.status(500)` (line 360). Twilio will retry on non-2xx responses, potentially creating duplicate processing for messages that *partially* succeeded. The handler should always return 200 with TwiML `<Response/>` and log the error internally.

- **WH-007 (Medium): No idempotency on SMS processing.** `MessageSid` is available in the payload but is never checked for duplicates. If Twilio retries (due to a timeout or transient 5xx), the same SMS will be processed and stored again, potentially sending duplicate auto-replies.

### 4. Twilio SMS Status Webhook (`/api/webhooks/twilio/sms-status`)

**File:** `server/routes-misc.ts` (lines 364-392)

| Check | Status | Detail |
|-------|--------|--------|
| Signature verification | PASS | Uses `verifyTwilioSignature` middleware. |
| Idempotency | PASS (inherent) | Status updates are idempotent by nature (SET status = X WHERE externalId = Y). |
| Always returns 200 | PASS | Returns `res.status(200).send("OK")` immediately before processing. |
| Error isolation | PASS | Processing happens after response is sent. |
| Logging | PASS | Warns on error codes. |

This handler follows best practices: respond 200 immediately, then process asynchronously.

### 5. Twilio Recording Status Webhook (`/api/webhooks/twilio/recording-status`)

**File:** `server/routes-misc.ts` (lines 394-435)

| Check | Status | Detail |
|-------|--------|--------|
| Signature verification | PASS | Uses `verifyTwilioSignature` middleware. |
| Always returns 200 | PASS | Returns 200 immediately before processing. |
| Idempotency | FAIL | No duplicate detection for `RecordingSid`. |
| Error isolation | PASS | Errors are caught after 200 is already sent. |

### 6. Twilio Recording Complete Webhook (`/webhook/twilio/recording-complete`)

**File:** `server/routes-voice.ts` (lines 83-163)

| Check | Status | Detail |
|-------|--------|--------|
| Signature verification | PASS | Uses `verifyTwilioSignature` middleware. |
| Always returns 200 | PASS | Returns 200 in both success and error paths. Comment explicitly states "Still return 200 so Twilio doesn't retry indefinitely." |
| Idempotency | FAIL | No duplicate detection. If Twilio retries, the `completeCall` and agent event creation will run again. |
| Error isolation | PASS | Full try/catch with 200 fallback. |
| Logging | PASS | Detailed structured logging. |

### 7. Twilio Disclosure Webhook (`/webhook/disclosure`)

**File:** `server/routes-voice.ts` (lines 267-282)

| Check | Status | Detail |
|-------|--------|--------|
| Signature verification | PASS | Uses `verifyTwilioSignature` middleware. |
| Always returns 200 | PASS | Returns TwiML with 200 in both paths. |
| Idempotency | N/A | Stateless TwiML generator. |

No issues. This is a simple TwiML responder.

### 8. Dropbox Sign Webhook (`/api/webhooks/dropbox-sign`)

**File:** `server/routes-elite-features.ts` (lines 270-278)

| Check | Status | Detail |
|-------|--------|--------|
| Signature verification | FAIL | Comment says "signature verified by HMAC header" but no verification code exists. The handler directly calls `processDropboxSignWebhook(req.body)` without checking any signature. |
| Idempotency | FAIL | No duplicate event tracking. Dropbox Sign can retry webhooks. |
| Always returns 200 | FAIL | Returns 500 on processing errors (line 276). |
| Error isolation | FAIL | Single try/catch; any error aborts all processing. |
| Logging | PASS | Errors logged. |

**Issues:**

- **WH-008 (Critical): No signature verification.** The comment on line 269 claims "signature verified by HMAC header" but no such verification exists in either the route or the `processDropboxSignWebhook` function. Dropbox Sign sends an HMAC-SHA256 signature in the request headers that must be verified against the API key. This endpoint is completely unauthenticated -- any attacker can forge webhook payloads to change document signing status.

- **WH-009 (High): Returns 500 on errors.** Dropbox Sign will retry on non-2xx, potentially causing repeated processing attempts.

- **WH-010 (Medium): No idempotency.** The same `signature_request_signed` event processed twice will issue redundant DB updates. While the updates are SET-based (idempotent in effect), there is no guard against partially-processed retries.

### 9. Meta Lead Ads Webhook (`/api/webhooks/meta-lead-ads`)

**File:** `server/routes-elite-features.ts` (lines 314-345)

| Check | Status | Detail |
|-------|--------|--------|
| Signature verification (GET) | PARTIAL | GET endpoint verifies `hub.verify_token` against `META_WEBHOOK_VERIFY_TOKEN` -- this is the subscription verification challenge, not payload signature. |
| Signature verification (POST) | FAIL | No `X-Hub-Signature-256` header verification on POST requests. Meta signs every webhook payload with the app secret. |
| Idempotency | FAIL | No duplicate detection for `leadgen_id`. |
| Always returns 200 | FAIL | Returns 500 on errors (line 343). Meta will retry. |
| Error isolation | FAIL | A single bad entry in the batch aborts the entire loop. |
| Logging | PASS | Errors logged. |

**Issues:**

- **WH-011 (Critical): No payload signature verification.** Meta sends an `X-Hub-Signature-256` header containing an HMAC-SHA256 of the payload signed with the app secret. This is not verified, meaning any party can forge lead submissions.

- **WH-012 (Medium): Error in one entry kills the batch.** The handler iterates over `entries` and `changes` in a synchronous loop. If `processLeadAdSubmission` throws for one entry, the remaining entries are never processed.

- **WH-013 (Low): Hardcoded org ID fallback.** `DEFAULT_ORG_ID` fallback means lead ads from any page are always assigned to org 1, which is likely wrong in a multi-tenant system.

### 10. Actum ACH Webhook (`/api/webhooks/actum`)

**File:** `server/routes-elite-features.ts` (lines 418-425)

| Check | Status | Detail |
|-------|--------|--------|
| Signature verification | FAIL | No signature verification of any kind. |
| Idempotency | FAIL | No duplicate event detection. Same `transaction_id` could be processed multiple times. |
| Always returns 200 | FAIL | Returns 500 on errors (line 424). |
| Error isolation | FAIL | Single try/catch. |
| Logging | PASS | Errors logged. |

**Issues:**

- **WH-014 (Critical): No authentication or signature verification.** This endpoint processes ACH payment status updates (including returns and settlements) with zero authentication. An attacker can forge payment settlement events to mark payments as completed, or forge return events to create bogus ACH return records. This is a financial data integrity vulnerability.

- **WH-015 (High): No idempotency.** The same `transaction.settled` event processed twice will attempt redundant DB updates. Worse, a duplicated `transaction.returned` event could log duplicate ACH return records.

### 11. Inbound Email Webhook (`/api/webhooks/inbound-email`)

**File:** `server/routes-inbound-email.ts` (lines 32-48)

| Check | Status | Detail |
|-------|--------|--------|
| Signature verification | FAIL | No SNS message signature verification. AWS SNS signs its notifications. |
| Idempotency | PARTIAL | `messageId` is accepted in the schema but it is unclear if `processInboundEmail` checks for duplicates. |
| Always returns 200 | FAIL | Returns 422 on validation errors, 400 on processing errors. SNS will retry on non-2xx. |
| Error isolation | PASS | Single email per request. |
| Logging | IMPLICIT | Uses `Errors.*` helpers which log internally. |

**Issues:**

- **WH-016 (High): No SNS signature verification.** AWS SNS sends a signing certificate URL and signature with every notification. This endpoint does not verify the SNS signature, allowing forged inbound email events. An attacker could inject fake emails into lead threads.

- **WH-017 (Medium): Returns non-200 on validation errors.** SNS will retry the message, creating a retry storm for malformed payloads that will never pass validation.

### 12. Call Routing Webhook (`/call-routing/route`)

**File:** `server/routes-call-routing.ts` (lines 128-150)

| Check | Status | Detail |
|-------|--------|--------|
| Signature verification | FAIL | No Twilio signature verification (does not use `verifyTwilioSignature` middleware). |
| Idempotency | N/A | Appears to be a stateless stub that returns routing instructions. |
| Always returns 200 | PARTIAL | Returns 400 on validation errors, which is acceptable for a synchronous routing decision endpoint. |

**Issues:**

- **WH-018 (Medium): No signature verification on call routing.** Unlike the other Twilio webhook endpoints, this one does not use the `verifyTwilioSignature` middleware. Currently a stub, but if wired to Twilio in production, any party could forge routing requests.

---

## Outbound Webhook Dispatcher

**File:** `server/services/webhookDispatcher.ts`

While not an inbound webhook handler, this service dispatches events to customer-registered endpoints and has its own reliability concerns:

| Check | Status | Detail |
|-------|--------|--------|
| Payload signing | PASS | HMAC-SHA256 signature sent in `X-AcreOS-Signature` header when endpoint has a secret. |
| Retry with backoff | PASS | `fetchWithRetry` implements exponential backoff (1s, 2s, 4s) with 3 attempts. |
| Timeout | PASS | 10-second timeout per request via `AbortController`. |
| Error isolation | PASS | `Promise.allSettled` ensures one failing endpoint does not block others. |
| Dead letter / persistence | FAIL | Failed deliveries are logged but not persisted. No dead letter table or retry queue. |

**Issue:**

- **WH-019 (Medium): No persistent retry or dead letter for outbound webhooks.** If all 3 retries fail, the event is lost. The comment mentions "Retries with exponential backoff via BullMQ" but the actual implementation uses in-process `setTimeout` -- there is no BullMQ integration. Server restarts during retry windows lose all pending deliveries.

---

## Twilio Signature Verification Middleware

**File:** `server/middleware/twilioSignature.ts`

This middleware is well-implemented:
- Uses HMAC-SHA1 per Twilio's specification
- Handles `X-Forwarded-Proto` and `X-Forwarded-Host` for reverse proxy setups
- Uses `crypto.timingSafeEqual` to prevent timing attacks
- Catches buffer length mismatches (which `timingSafeEqual` throws on)
- Skips verification in non-production environments (acceptable for development)
- Rejects with 403 if `TWILIO_AUTH_TOKEN` is missing in production

No issues found.

---

## Summary of Issues

| ID | Severity | Handler | Issue |
|----|----------|---------|-------|
| WH-008 | CRITICAL | Dropbox Sign | No signature verification despite comment claiming it exists |
| WH-011 | CRITICAL | Meta Lead Ads | No `X-Hub-Signature-256` payload verification |
| WH-014 | CRITICAL | Actum ACH | No authentication or signature verification on financial webhook |
| WH-004 | HIGH | Stripe Connect | Returns 500 on errors, causing unnecessary retries |
| WH-006 | HIGH | Twilio SMS | Returns 400/500 on errors, triggering Twilio retries |
| WH-009 | HIGH | Dropbox Sign | Returns 500 on errors, triggering retries |
| WH-016 | HIGH | Inbound Email | No SNS signature verification |
| WH-015 | HIGH | Actum ACH | No idempotency on financial status updates |
| WH-001 | MEDIUM | Stripe Main | Redundant `markProcessed` calls in `dispatchEvent` |
| WH-002 | MEDIUM | Stripe Main | No out-of-order event protection (silent data loss) |
| WH-007 | MEDIUM | Twilio SMS | No idempotency -- duplicate SMS will be stored |
| WH-010 | MEDIUM | Dropbox Sign | No idempotency |
| WH-012 | MEDIUM | Meta Lead Ads | Error in one entry kills entire batch |
| WH-017 | MEDIUM | Inbound Email | Returns non-200 on validation errors causing retry storm |
| WH-018 | MEDIUM | Call Routing | No Twilio signature verification |
| WH-019 | MEDIUM | Outbound Dispatcher | No persistent retry or dead letter queue |
| WH-003 | LOW | Stripe Main | No dead letter queue for failed events |
| WH-005 | LOW | Stripe Connect | Fallback to wrong webhook secret |
| WH-013 | LOW | Meta Lead Ads | Hardcoded org ID fallback |

---

## Recommendations (Priority Order)

### Immediate (pre-launch)

1. **Add signature verification to Dropbox Sign, Meta Lead Ads (POST), Actum, and Inbound Email webhooks.** These are unauthenticated endpoints that process business-critical data. The Actum case is especially severe because it affects financial records.

2. **Always return 200 from webhook handlers after signature verification succeeds.** Returning 5xx causes the sender to retry, creating duplicate processing risk. Apply the same pattern used by `twilio/sms-status`: respond 200 immediately, then process.

3. **Add idempotency to Twilio SMS and Actum handlers.** For SMS, check `MessageSid` against a processed-events table. For Actum, check `transaction_id`. Both can reuse the `stripeProcessedEvents` pattern (or a shared `webhook_processed_events` table).

### Short-term

4. **Clean up double `markProcessed` calls in `webhookHandlers.ts`.** Remove the explicit calls inside `dispatchEvent()` branches and rely solely on the `finally` block in `processWebhook()`.

5. **Add error isolation to Meta Lead Ads batch processing.** Wrap each entry/change in its own try/catch so one failure does not abort the batch.

6. **Add a dead letter table for failed webhook events.** When processing fails, insert into a `webhook_dead_letters` table with the raw event payload, error message, and timestamp. This enables manual replay and debugging.

### Medium-term

7. **Implement outbound webhook persistence.** Replace in-process retry with a durable job queue (BullMQ or the existing job queue service) so that retries survive server restarts.

8. **Add out-of-order event handling for Stripe.** When `processSubscriptionUpdated` cannot find an org, either requeue the event with a short delay or store it in a pending-events table for later reconciliation.
