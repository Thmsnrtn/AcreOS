# Lens 32 -- Billing Operations Specialist

**Auditor perspective:** Stripe webhook handling, subscription lifecycle, dunning, refunds, proration, credit metering, and billing edge cases.
**Date:** 2026-04-15
**Scope:** `server/routes-billing.ts`, `server/stripeService.ts`, `server/webhookHandlers.ts`, `server/stripeClient.ts`, `server/services/dunning.ts`, `server/routes-dunning.ts`, `server/services/credits.ts`, `server/services/stripeConnect.ts`, `server/services/trialService.ts`, `server/middleware/idempotency.ts`

---

## Architecture Summary

AcreOS billing has four subsystems:

1. **Subscription billing** -- Stripe Checkout for plan selection, Customer Portal for management, webhook-driven state sync. Tiers: free, sprout, starter, pro, scale, enterprise.
2. **Credit metering** -- Prepaid credit balance stored on the organization record (`creditBalance`). Usage-based deductions for premium lookups, AI calls, campaigns. One-time credit pack purchases via Stripe Checkout (mode: `payment`).
3. **Dunning engine** -- Multi-stage (grace_period -> warning -> restricted -> suspended -> cancelled) with email notifications at days 0, 2, 6, 13. Automatic tier downgrade at suspension/cancellation. Scheduled task runs every 6 hours.
4. **Stripe Connect** -- Per-organization connected accounts for collecting borrower payments on seller-financed notes. Application fee of 2.5%.

The main webhook endpoint (`/api/stripe/webhook`) is registered in `server/index.ts` before `express.json()`, correctly receiving raw buffers. A second webhook endpoint (`/api/stripe/connect/webhook`) is registered inside `routes-billing.ts`.

---

## Findings

### P0 -- Wrong Charges / Revenue Loss

#### P0-1: Connect webhook shares the main webhook secret -- signature verification will fail for Connect events

**Files:** `server/routes-billing.ts:643`

The Connect webhook endpoint at `/api/stripe/connect/webhook` uses `process.env.STRIPE_WEBHOOK_SECRET` to verify event signatures. However, Stripe Connect webhooks are signed with a separate webhook secret (the one configured for the Connect endpoint in the Stripe Dashboard). If the Connect endpoint is registered in Stripe with its own secret, signature verification will always fail because the code uses the wrong secret. If it happens to share the same secret (single webhook endpoint registered in Stripe for both), then events may be double-processed by both the main handler and the Connect handler since the same events would be routed to both.

There is no `STRIPE_CONNECT_WEBHOOK_SECRET` environment variable defined anywhere in the codebase.

#### P0-2: Duplicate dunning invocation -- both `invoice.payment_succeeded` and `invoice.paid` call the same dunning recovery path

**Files:** `server/webhookHandlers.ts:107-112, 146-150`

The `dispatchEvent` method handles both `invoice.payment_succeeded` (line 111) and `invoice.paid` (line 146). Both handlers look up the org and call `dunningService.handlePaymentSucceeded()`. For any successful subscription payment, Stripe fires both events. While the dunning service is idempotent (checks `dunningStage !== 'none'`), the second call to `processInvoicePaid` still runs the full flow: DB lookup, event resolution, org update, email dispatch. This is wasteful and risks sending duplicate recovery emails if the first handler partially succeeds (e.g., clears dunning stage but fails on email, then the org re-lookup in `processInvoicePaid` sees stage as `none` and skips -- but if timing overlaps, both could fire emails).

#### P0-3: Auto-top-up `checkAutoTopUp` is defined but never called -- credits will silently exhaust

**Files:** `server/services/credits.ts:386-404`

The `checkAutoTopUp` method exists and correctly checks the balance against the threshold, but no code path in the entire codebase actually calls it. After a credit deduction, the system never checks whether auto-top-up should trigger. Users who configure auto-top-up will have a false sense of security: their balance will drop to zero and their operations will fail silently. There is also no Stripe charge created when auto-top-up fires -- the method only returns `{ shouldTopUp: true, amountCents }` but there is no caller to act on it.

---

### P1 -- Missing Webhook Handler / Broken Flow

#### P1-1: No handler for `charge.dispute.created` -- disputes go unnoticed

**Files:** `server/webhookHandlers.ts:87-159`, `server/routes-setup.ts:385`

The setup wizard registers `charge.dispute.created` as a webhook event type with Stripe, but the `dispatchEvent` method in `webhookHandlers.ts` has no case for it. Disputes will be logged as "Unhandled Stripe event type" and silently acknowledged. The org's subscription status will not be flagged, no system alert is created, and the founder is never notified. This is revenue-critical because Stripe disputes can result in automatic fund withdrawal and a $15 dispute fee.

#### P1-2: No handler for `charge.refunded` -- refund state not synced

**Files:** `server/webhookHandlers.ts:87-159`

When a refund is processed (either auto-approved via the self-serve flow or manually in Stripe Dashboard), the `charge.refunded` webhook event is not handled. The `refundRequests` table is updated within the auto-approve flow itself (lines 804-815), but if a refund is issued directly from the Stripe Dashboard (e.g., by a support agent), the local `refundRequests` table is never updated and the credit balance is not adjusted.

#### P1-3: No handler for `checkout.session.expired` -- abandoned checkouts invisible

**Files:** `server/webhookHandlers.ts:87-105`

When a Checkout Session expires (customer closes the tab, session times out after 24h), no event is handled. Previously identified in lens 28. This means:
- No analytics on checkout abandonment rate.
- No re-engagement trigger (e.g., "You left before completing checkout").
- For credit purchases, the idempotency key is consumed by creating the session, so a retry with the same key will return a cached response pointing to the expired session URL.

#### P1-4: Connect webhook handler has no idempotency check -- events can be double-processed

**Files:** `server/routes-billing.ts:636-687`, `server/services/stripeConnect.ts:324-392`

The main webhook handler (`webhookHandlers.ts`) checks `stripeProcessedEvents` table for duplicates before processing. The Connect webhook handler in `routes-billing.ts` passes events directly to `stripeConnectService.handleWebhookEvent()` with no deduplication. Stripe retries failed deliveries, so a network timeout that occurs after processing but before the 200 response will cause the same `payment_intent.succeeded` to be processed again, potentially recording duplicate payments on a note.

#### P1-5: Dunning routes have no founder/admin authorization -- any authenticated user can retry payments and cancel dunning cases

**Files:** `server/routes-dunning.ts:1-80`, `server/routes.ts:1003`

The dunning router is mounted with only `isAuthenticated` middleware: `app.use('/api/dunning', isAuthenticated, dunningRouter)`. There is no `getOrCreateOrg`, no `isFounder` check, no role-based access control. Any authenticated user can:
- `POST /api/dunning/:id/retry` -- trigger a Stripe `invoices.pay` call for any org's invoice
- `POST /api/dunning/:id/cancel` -- cancel any org's dunning case
- `POST /api/dunning/:id/resolve` -- resolve any org's dunning case
- `GET /api/dunning/summary` -- view all dunning data across all orgs
- `GET /api/dunning/cases` -- view all active dunning cases

This is both a security and billing integrity issue.

#### P1-6: Trial duration inconsistency -- ADR says 7 days, code implements 14 days

**Files:** `docs/adr/009-stripe-for-billing.md:43`, `server/services/trialService.ts:7`, `server/routes-billing.ts:303`

ADR 009 states "Trial period: 7 days (configured in Stripe Product, enforced in code)". The actual `TRIAL_DURATION_DAYS` constant is `14` in `trialService.ts`, and the Stripe checkout also passes `trialDays = 14` when `org.trialUsed` is false. This creates two problems: (a) the documented behavior does not match reality, (b) Stripe's trial_period_days and the local trial tracking may drift if only one is changed.

---

### P2 -- Edge Cases

#### P2-1: Stripe customer creation race condition between checkout and credit purchase

**Files:** `server/routes-billing.ts:148-160, 288-300`

Both `/api/stripe/checkout` and `/api/credits/purchase` create a Stripe customer if `org.stripeCustomerId` is null. If a user triggers both endpoints concurrently (e.g., two browser tabs), each will independently call `stripeService.createCustomer()` and `storage.updateOrganization()`. The idempotency key for `createCustomer` is based on `userId + email`, so Stripe will return the same customer, but the `updateOrganization` call in each transaction could interleave. While the `withTransaction` wrapper helps, the customer ID written by the first transaction could be overwritten by the second.

#### P2-2: `req.user as any` cast -- 5 occurrences bypass type safety

**Files:** `server/routes-billing.ts:151, 222, 291, 392, 493`

The CLAUDE.md engineering standards explicitly state "Never use `(req as any)`" and require using `AuthenticatedRequest`. Billing routes use `req.user as any` to access `user.email`, `user.id`, and `user.claims.sub`. If the user object shape changes (e.g., Clerk updates), these casts will fail silently at runtime, potentially creating Stripe customers with undefined emails or null user IDs.

#### P2-3: `(req as any).organization` in trial routes instead of `req.organization`

**Files:** `server/routes-billing.ts:591, 606, 625`

Three trial-related route handlers use `(req as any).organization` despite the middleware already attaching `organization` to the request via `getOrCreateOrg`. This violates the codebase standard and bypasses TypeScript safety.

#### P2-4: Credit pack purchase uses `pack.priceCents` for Stripe but `pack.amountCents` for credit deposit -- currently equal but fragile

**Files:** `server/routes-billing.ts:165, 173`, `shared/schema.ts:2872-2877`

The checkout session charges `pack.priceCents` to the customer, while the webhook handler deposits `pack.amountCents` in credits. Currently both values are identical for all packs ($10 pack = 1000 priceCents = 1000 amountCents). However, if a promotional pack is introduced where `amountCents > priceCents` (e.g., "buy $25, get $30 in credits"), the metadata only carries `packId`, and the credit deposit is derived from the schema definition. If the schema is updated after a checkout session is created but before the webhook fires, the customer could receive different credits than what was advertised at checkout time.

#### P2-5: `estimateCampaignCost` returns hardcoded `insufficientCredits: false` and `balance: 0`

**Files:** `server/services/credits.ts:251-259`

The `estimateCampaignCost` method (without org context) always returns `insufficientCredits: false` and `balance: 0`, regardless of the actual cost. This method should either be removed or require an org ID. The org-aware variant `estimateCampaignCostForOrg` exists and works correctly, but callers using the wrong method will never see an insufficient-credits warning.

#### P2-6: Refund auto-approval threshold is hardcoded with no admin override

**Files:** `server/routes-billing.ts:788`

The $50 auto-approve threshold for refunds (`const autoApproveThreshold = 5000`) is hardcoded. There is no admin panel setting, no per-tier configuration, and no ability to disable auto-refunds entirely. A malicious or mistaken user could repeatedly request auto-refunds of amounts up to $50 without any human review. The only protection is that refunds are against the most recent charge, so the same charge cannot be refunded twice (Stripe prevents this), but there is no rate limiting on refund requests per org.

#### P2-7: Monthly credit allowance can be applied multiple times if `applyMonthlyAllowance` on `UsageMeteringService` is called instead of `CreditService`

**Files:** `server/services/credits.ts:194-222, 407-448`

There are two `applyMonthlyAllowance` implementations:
1. `CreditService.applyMonthlyAllowance` (line 194) checks for duplicate application by querying `creditTransactions` for a matching `type: "monthly_allowance"` and `metadata.month`.
2. `UsageMeteringService.applyMonthlyAllowance` (line 407) does NOT check for duplicates. It uses `type: "allowance"` (different string), so even if the CreditService method ran first, UsageMeteringService would not detect it.

If `processMonthlyAllowances()` (line 451) is called multiple times in the same month (e.g., server restart, manual trigger), credits could be doubled.

#### P2-8: Connect webhook registered inside billing routes -- body parsing conflict risk

**Files:** `server/routes-billing.ts:636`

The Connect webhook endpoint uses `express.raw({ type: "application/json" })` middleware inline. However, `routes-billing.ts` is registered via `registerBillingRoutes(app)` which runs after `express.json()` has been applied globally in `server/index.ts:236`. The inline `express.raw()` may not override the already-parsed body, causing signature verification to fail because `req.body` would be a parsed object instead of a Buffer. The main webhook endpoint avoids this by being registered before `express.json()` in `index.ts:206`. This Connect endpoint does not have the same protection.

#### P2-9: Subscription cancellation sets `dunningStage: 'cancelled'` even if org was never in dunning

**Files:** `server/webhookHandlers.ts:323`

When `customer.subscription.deleted` fires, the handler unconditionally sets `dunningStage: 'cancelled'`. If the customer voluntarily cancelled (not due to payment failure), their dunning stage is set to `cancelled` even though they were never in dunning. This could confuse dunning summary reports and the founder dashboard, showing voluntary cancellations as dunning outcomes.

#### P2-10: No webhook handler for `customer.subscription.trial_will_end` marking as processed

**Files:** `server/webhookHandlers.ts:153-155`

The `processTrialWillEnd` handler is dispatched via `return WebhookHandlers.processTrialWillEnd(...)`. Unlike the `customer.subscription.created`, `paused`, and `resumed` handlers, this one does not explicitly call `markProcessed` after processing. The `finally` block in `processWebhook` will call `markProcessed`, but only if the handler does not throw. If `processTrialWillEnd` throws (e.g., `createSystemAlert` fails), the event is caught by the outer try/catch and `markProcessed` IS called in the `finally` block -- so this is safe. However, the inconsistent pattern (some handlers call `markProcessed` explicitly while others rely on `finally`) is confusing and prone to bugs if refactored.

#### P2-11: New Stripe client instantiated on every request -- no connection reuse

**Files:** `server/stripeClient.ts:19-21`

`getUncachableStripeClient()` creates a `new Stripe(getSecretKey())` on every call. The Stripe SDK recommends creating a single client instance and reusing it. Creating a new instance per request means no HTTP keep-alive reuse, no connection pooling, and increased latency. The name "uncachable" suggests this was intentional, but there is no documented reason for it.

#### P2-12: `processSubscriptionUpdated` makes an extra Stripe API call to determine tier

**Files:** `server/webhookHandlers.ts:395-399`

On every `customer.subscription.updated` event, the handler retrieves the price with `expand: ['product']` to read `product.metadata.tier`. This is an additional Stripe API call per webhook event. The subscription object itself contains `items.data[0].price`, which already has the price ID. The product metadata could be cached or the tier could be stored in the price metadata to avoid this extra call.

---

## Summary Table

| Priority | Count | Issues |
|----------|-------|--------|
| P0 | 3 | Connect webhook wrong secret; duplicate dunning recovery emails; auto-top-up never triggers |
| P1 | 6 | No dispute handler; no refund webhook; no expired checkout handler; Connect no idempotency; dunning routes unauthenticated; trial duration mismatch |
| P2 | 12 | Customer creation race; `req as any` casts; trial route casts; credit pack price/amount coupling; campaign cost stub; refund threshold hardcoded; duplicate monthly allowance; Connect body parsing; cancellation dunning stage; inconsistent markProcessed; Stripe client per-request; extra API call per webhook |

**Total findings: 21**

---

## What Works Well

1. **Webhook signature verification** -- The main webhook endpoint correctly uses `constructEvent` with cryptographic signature validation, and is registered before `express.json()` to preserve the raw Buffer.
2. **Event idempotency** -- The `stripeProcessedEvents` table with `onConflictDoNothing` prevents reprocessing of already-handled events for the main webhook path.
3. **Idempotency keys on mutations** -- Credit purchases and subscription checkouts use deterministic SHA-256 idempotency keys sent to Stripe, preventing duplicate charges.
4. **Dunning email templates** -- The dunning service has well-crafted, progressive email templates (friendly -> warning -> final notice -> recovery success) with clear CTAs.
5. **Circuit breaker on Stripe calls** -- `stripeCircuitBreaker` protects against cascading failures when Stripe is down.
6. **Comprehensive subscription state mapping** -- The `processSubscriptionUpdated` handler maps all Stripe subscription statuses to internal statuses and logs tier changes.
7. **Borrower payment security** -- The `processBorrowerPortalPayment` handler verifies `pendingCheckoutSessionId` matches the session ID to prevent replay attacks.
8. **Structured audit logging** -- Billing mutations (auto-top-up changes, Connect account creation/disconnection) create audit log entries.

---

## Recommended Fix Priority

1. **Fix Connect webhook secret** -- Add `STRIPE_CONNECT_WEBHOOK_SECRET` env var and use it in the Connect webhook handler.
2. **Add auth to dunning routes** -- Add `getOrCreateOrg` and `isFounder` checks to all dunning endpoints.
3. **Implement auto-top-up trigger** -- Call `checkAutoTopUp` after every credit deduction in `deductCredits`, and create a Stripe charge when triggered.
4. **Add dispute webhook handler** -- Create a `processDisputeCreated` handler that flags the org, creates a system alert, and notifies the founder.
5. **Deduplicate invoice.paid / invoice.payment_succeeded** -- Remove one handler or guard both with a state check that prevents double email dispatch.
6. **Move Connect webhook before express.json()** -- Register it in `index.ts` alongside the main webhook endpoint.
