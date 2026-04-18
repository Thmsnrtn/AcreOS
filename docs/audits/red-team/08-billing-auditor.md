# Red Team Review #08: Billing Auditor

**Persona**: CFO / finance controller who demands full transparency on every charge, verifiable billing accuracy, and audit-grade financial integrity.
**Reviewer**: Billing Red Team
**Date**: 2026-04-18
**Scope**: Credit system accuracy, subscription tier enforcement, invoices, usage tracking, overage handling, trial logic, proration, tax, multi-currency, and audit trail.

---

## Summary

| #  | Area                          | Verdict     |
|----|-------------------------------|-------------|
| 1  | Credit system accuracy        | CONCERN     |
| 2  | Subscription tier enforcement | CONCERN     |
| 3  | Invoice / receipt generation  | PASS        |
| 4  | Usage tracking                | PASS        |
| 5  | Overage charges               | PASS        |
| 6  | Trial period                  | PASS        |
| 7  | Proration                     | PASS        |
| 8  | Tax handling                  | FAIL        |
| 9  | Multi-currency support        | FAIL        |
| 10 | Audit trail                   | CONCERN     |

**Overall**: 4 PASS, 3 CONCERN, 2 FAIL (1 systemic risk)

---

## 1. Credit System Accuracy

**Verdict: CONCERN**

The credit ledger design is sound in principle -- atomic SQL deductions with a `>= amountCents` guard -- but two specific paths lack transactional wrapping, creating a ledger-desync window.

**What works well**:
- `addCredits()` is wrapped in `withTransaction()` so balance update and transaction log are atomic (`server/services/credits.ts:48`). This was explicitly fixed as P0 DI-001.
- `deductCredits()` uses a conditional UPDATE with `WHERE balance >= amount`, preventing negative balances (`credits.ts:96-107`). The SQL-level check is race-safe for single-row updates.
- `applyMonthlyAllowance()` uses `INSERT ... ON CONFLICT DO NOTHING` inside a transaction to prevent double-granting (DEFECT-0007 fix, `credits.ts:248-292`).
- Founder accounts correctly bypass deduction but still log a $0 debit transaction (`credits.ts:81-94`), preserving auditability.

**What does NOT work**:
- `applyCreditPackPurchase()` (`credits.ts:198-234`) performs TWO separate `db` calls (UPDATE balance, then INSERT transaction) **without** `withTransaction()`. If the process crashes between lines 209 and 219, the balance increases but no transaction record exists. This is the exact pattern that `addCredits()` was fixed for (DI-001), but the fix was not applied to `applyCreditPackPurchase()`.
- `deductCredits()` (`credits.ts:96-123`) has the same non-transactional pattern: the balance UPDATE and transaction INSERT are separate `db` calls. If the INSERT fails after the UPDATE succeeds, the balance is decremented but there is no ledger entry. The conditional WHERE clause protects against going negative but does not protect against orphaned balance changes.

**Evidence**:
```
// credits.ts:209 — UPDATE (no tx)
const [updated] = await db.update(organizations).set(...)
// credits.ts:219 — INSERT (no tx, separate call)
const [transaction] = await db.insert(creditTransactions).values(...)
```

Compare with the correctly wrapped `addCredits()`:
```
// credits.ts:48 — BOTH inside withTransaction()
return await withTransaction(async (tx) => {
  const [updated] = await tx.update(organizations)...
  const [transaction] = await tx.insert(creditTransactions)...
});
```

**Risk**: Medium. Stripe webhook-triggered credit purchases could leave orphaned balance changes without matching transaction records. A CFO reconciling credit_transactions against organization.creditBalance would find mismatches.

**Recommendation**: Wrap `applyCreditPackPurchase()` and `deductCredits()` in `withTransaction()`, identical to the existing `addCredits()` pattern.

---

## 2. Subscription Tier Enforcement

**Verdict: CONCERN**

Tier enforcement is functional but there is a significant source-of-truth split between two independent tier definition systems that could drift.

**What works well**:
- `checkUsageLimit()` in `server/services/usageLimits.ts` enforces per-resource caps (leads, properties, notes, AI requests) with proper founder bypass (`usageLimits.ts:200-241`).
- `getAllUsageLimits()` returns current counts plus limits with percentage calculations, powering the settings page usage dashboard (`usageLimits.ts:243-293`).
- `UsageLimitError` returns a 429 with clear messaging about the resource type and limit (`usageLimits.ts:295-317`).
- Seat enforcement is thorough: `canAddMoreSeats()` validates against max seats, and `getSeatInfo()` correctly handles per-tier seat pricing (`usageLimits.ts:427-458`).

**What does NOT work**:
- There are TWO separate tier definition objects that do NOT agree on tiers or limits:
  - `TIER_LIMITS` in `server/services/usageLimits.ts` defines 5 tiers: `free`, `starter`, `pro`, `scale`, `enterprise` (lines 46-108).
  - `SUBSCRIPTION_TIERS` in `shared/schema.ts` defines 6 tiers: `free`, `sprout`, `starter`, `pro`, `scale`, `enterprise` (lines 2894-3091).
  - The `sprout` tier ($29/mo) exists in the schema but has no entry in `TIER_LIMITS`, meaning a user on the sprout tier would fall through to `free` limits via `normalizeTier()` (which defaults unknown tiers to `free`, line 128).
  - Limit values disagree: `TIER_LIMITS.free.leads = 10` but `SUBSCRIPTION_TIERS.free.limits.leads = 50`. A customer billed at the free tier could either create 10 leads or 50, depending on which code path checks the limit.
  - `TIER_LIMITS.starter.leads = 250` but `SUBSCRIPTION_TIERS.starter.limits.leads = 500`. A paying Starter customer might be blocked at 250 when they were promised 500.
  - `TIER_LIMITS.pro.leads = 500` but `SUBSCRIPTION_TIERS.pro.limits.leads = 5000`. A Pro customer paying $179/mo gets a 10x lower lead limit than documented.

**Evidence**:
```
// usageLimits.ts:47-50 (enforcement code)
free: { leads: 10, properties: 3, notes: 2, ai_requests: 25, ... }

// schema.ts:2896-2907 (billing/pricing display)
free: { limits: { leads: 50, properties: 10, notes: 5, ... } }
```

**Risk**: High. Customers see one set of limits on the pricing page (from `SUBSCRIPTION_TIERS`) but are enforced against a different, lower set (from `TIER_LIMITS`). This creates billing disputes, support tickets, and potential legal exposure for false advertising.

**Recommendation**: Consolidate to a single source of truth. `TIER_LIMITS` in `usageLimits.ts` should be derived from `SUBSCRIPTION_TIERS` in `schema.ts`, or vice versa. The `sprout` tier must be added to `TIER_LIMITS` or removed from `SUBSCRIPTION_TIERS`.

---

## 3. Invoice / Receipt Generation

**Verdict: PASS**

AcreOS delegates invoice and receipt management to Stripe, which is the correct approach for a SaaS platform.

**Evidence**:
- Stripe Customer Portal session creation is available via `POST /api/stripe/portal` (`routes-billing.ts:339-357`). The portal gives customers direct access to invoices, receipts, payment method management, and subscription history.
- Borrower portal payments send an email receipt after successful payment with amount paid, payment date, remaining balance, and next payment due date (`webhookHandlers.ts:674-701`).
- Refund receipts are sent via email when auto-approved refunds are processed (`routes-billing.ts:889-897`).
- Credit purchase transactions include `stripeCheckoutSessionId` and `stripePaymentIntentId` for full Stripe traceability (`credits.ts:226-229`).

**Gaps**: No AcreOS-native invoice PDF generation exists. All invoices are accessed through Stripe's portal. This is acceptable but means offline/PDF access depends on Stripe's uptime.

---

## 4. Usage Tracking

**Verdict: PASS**

Usage tracking is well-implemented with both summary and detail endpoints available to customers.

**Evidence**:
- `GET /api/usage/summary` returns per-action-type aggregates (count, total cost) for any billing month (`routes-billing.ts:44-54`, `credits.ts:389-411`).
- `GET /api/usage/records` returns individual usage records with timestamps, action types, quantities, and costs (`routes-billing.ts:56-66`, `credits.ts:413-419`).
- `GET /api/usage/rates` returns current per-action pricing, merging database overrides with schema defaults (`routes-billing.ts:68-87`).
- `POST /api/usage/estimate` provides pre-action cost estimates with current balance and insufficiency check (`routes-billing.ts:94-123`).
- `UsageDashboard` component (`client/src/components/usage-dashboard.tsx`) renders a bar chart of usage by category, transaction history, daily spend average, and credit balance -- exactly what a CFO would want.
- `estimateCampaignCostForOrg()` lets the user preview campaign costs before committing (`credits.ts:332-347`).

**Strength**: The `billingMonth` partitioning on `usageRecords` enables month-over-month comparison.

---

## 5. Overage Charges

**Verdict: PASS**

The system uses a pre-check model (debit before action) rather than post-usage billing, which prevents overage disputes entirely.

**Evidence**:
- `recordUsage()` calls `deductCredits()` before inserting the usage record (`credits.ts:360-368`). If credits are insufficient, the action is blocked and `insufficientCredits: true` is returned.
- The `deductCredits()` SQL WHERE clause (`balance >= amountCents`) makes it impossible to go negative (`credits.ts:104`).
- `hasEnoughCredits()` provides a pre-flight check that routes can call before expensive operations (`credits.ts:139-185`).
- The auto-top-up mechanism (`credits.ts:456-474`) is designed to prevent credit exhaustion for users who opt in, though it is not yet wired to Stripe (TODO at `credits.ts:129`).

**Gap**: Auto-top-up logs intent but does not actually charge the card. The TODO at line 129 means users who enable auto-top-up will still hit $0 and be blocked. This is a feature gap, not a billing integrity issue.

---

## 6. Trial Period

**Verdict: PASS**

Trial logic is well-bounded and properly prevents trial reuse.

**Evidence**:
- Trial duration is a fixed constant: `TRIAL_DURATION_DAYS = 14` (`server/services/trialService.ts:7`).
- `startTrial()` sets `trialUsed = true` atomically with the trial start, preventing a second trial (`trialService.ts:62-64`).
- `getTrialStatus()` checks `trialUsed` before allowing eligibility, and only allows trials for orgs on the `free` tier (`trialService.ts:49`).
- Trial expiration is handled by `expireTrials()`, which resets expired trial orgs to `free` tier with `active` status (`trialService.ts:94-115`).
- Stripe checkout passes `trialDays` only if `!org.trialUsed` (`routes-billing.ts:303`), preventing abandoned checkouts from consuming the trial -- the `trialUsed` flag is set in the webhook handler (`webhookHandlers.ts:181`), not at checkout creation.
- Trial credit spending is capped at 500 cents ($5) to prevent abuse (FRAUD-011, `credits.ts:149`), with per-trial-period debit tracking.
- `customer.subscription.trial_will_end` webhook triggers a system alert 3 days before expiry (`webhookHandlers.ts:442-470`).

**Minor inconsistency**: The settings page text says "7-day free trial" (`settings.tsx:904`) but the service enforces 14 days. The user gets more than promised, so this is cosmetic but should be corrected.

---

## 7. Proration

**Verdict: PASS**

Proration is handled by Stripe, which is the correct delegation pattern.

**Evidence**:
- Subscription changes flow through Stripe's `customer.subscription.updated` webhook (`webhookHandlers.ts:361-437`), which reads the new tier from product metadata and updates the org.
- Stripe handles proration natively when subscriptions are updated via the Customer Portal (`routes-billing.ts:339-357`). AcreOS redirects to the portal for all plan changes, which means Stripe's default proration behavior (prorate upgrades, credit downgrades) applies.
- Subscription events are logged with `fromTier` and `toTier` for analytics and dispute resolution (`webhookHandlers.ts:404-411`).

**Note**: AcreOS does not implement custom proration logic, which means it inherits Stripe's defaults. This is appropriate and avoids the complexity and error risk of custom proration calculations.

---

## 8. Tax Handling

**Verdict: FAIL**

There is no evidence of sales tax / VAT configuration anywhere in the billing stack.

**Evidence**:
- `stripeService.createCheckoutSession()` does not set `automatic_tax: { enabled: true }` (`server/stripeService.ts:32-61`). The session config includes `payment_method_types`, `line_items`, and `mode`, but no tax parameters.
- `stripeService.createCreditPurchaseCheckout()` similarly has no tax configuration (`stripeService.ts:63-92`).
- No references to `automatic_tax`, `tax_id_collection`, `tax_behavior`, or `tax_rates` exist anywhere in the Stripe service or billing routes (confirmed by grep for `tax` in `stripeService.ts` returning zero matches).
- Stripe Connect `createPaymentIntent()` passes `amount` and `currency` but no tax calculation (`stripeConnect.ts:223-266`).

**Risk**: Critical for US-based SaaS. Many US states now require sales tax on SaaS subscriptions (e.g., Texas, New York, Pennsylvania, Connecticut, and others). Operating without tax collection could result in back-tax liability and penalties. For international customers, VAT obligations in the EU/UK are even stricter.

**Recommendation**: Enable Stripe Tax (`automatic_tax: { enabled: true }`) on all checkout sessions and payment intents. This requires configuring tax registration in the Stripe Dashboard for applicable jurisdictions. This is a one-line change per checkout session but requires a Stripe Dashboard configuration step.

---

## 9. Multi-Currency Support

**Verdict: FAIL**

All billing is hardcoded to USD with no path for international customers to pay in their local currency.

**Evidence**:
- `createCreditPurchaseCheckout()` hardcodes `currency: 'usd'` in the price_data (`stripeService.ts:78`).
- `createPaymentIntent()` in Stripe Connect defaults to `currency: string = "usd"` (`stripeConnect.ts:226`).
- `CREDIT_PACKS` in the schema defines prices only in cents (USD) with no currency indicator (`shared/schema.ts:2881-2886`).
- `SUBSCRIPTION_TIERS` defines `price` as a bare number (29, 59, 179, etc.) with no currency field (`shared/schema.ts:2894-3091`).
- No currency selection UI exists in the billing settings or checkout flow.

**Risk**: Medium. AcreOS markets to "real estate professionals" which is primarily a US market, but international customers (Canada, Australia, UK) exist in the real estate space. Non-USD customers will pay conversion fees on every transaction. Stripe supports 135+ currencies natively.

**Recommendation**: For V1, document that billing is USD-only. For V2, add a `currency` field to the checkout session creation that defaults to USD but can be overridden based on customer locale or preference.

---

## 10. Audit Trail

**Verdict: CONCERN**

Credit transaction history is available but the broader billing audit trail has gaps.

**What works well**:
- `GET /api/credits/transactions` returns the full credit transaction history with type, amount, balance-after, description, and timestamp (`routes-billing.ts:32-42`). Capped at 100 records per request.
- Every credit operation (purchase, debit, monthly allowance, founder bypass) creates a `creditTransactions` record with metadata (`credits.ts` passim).
- Subscription lifecycle events (create, update, cancel, pause, resume) are logged to `subscription_events` via `storage.logSubscriptionEvent()` (`webhookHandlers.ts:321-326, 404-411, 487-493, 515-521`).
- Billing-related admin actions (auto-top-up changes, Stripe Connect setup/disconnect) create audit log entries (`routes-billing.ts:222-234, 421-433, 492-505`).
- Stripe webhook events are recorded in `stripe_processed_events` for idempotency and auditability (`webhookHandlers.ts:32-45`).
- Dunning events create a detailed history with stage transitions, notification tracking, and resolution types (`server/services/dunning.ts`).
- Cancellation surveys are persisted with reason, feedback, and previous tier (`routes-billing.ts:753-759`).
- Refund requests include Stripe charge ID, payment intent ID, amount, approval status, and processing metadata (`routes-billing.ts:834-843`).

**What does NOT work**:
- There is no endpoint to retrieve `subscription_events` for a specific organization from the client side. The `logSubscriptionEvent()` method writes records, but no corresponding API route exposes them to the billing dashboard. A CFO cannot see "when did I upgrade?" or "when was my plan changed?" without contacting support.
- `credit_transactions` are capped at 100 per request with no pagination (offset/cursor) support (`routes-billing.ts:36`). An organization with heavy usage would lose visibility into older transactions.
- No export (CSV/PDF) capability exists for billing history. Enterprise customers typically need this for accounting reconciliation.
- The `stripe_processed_events` table is internal and not exposed to customers, which is correct, but there is no admin endpoint to query it for support cases.

**Recommendation**: Add a `GET /api/subscription/events` endpoint to expose subscription history to the billing dashboard. Add pagination to the credits transaction endpoint. Consider a billing export endpoint for enterprise accounts.

---

## Cross-Cutting Concerns

### Idempotency (Positive Finding)

The idempotency middleware (`server/middleware/idempotency.ts`) is applied to both `POST /api/credits/purchase` and `POST /api/stripe/checkout` (`routes-billing.ts:130, 277`). This prevents duplicate charges from network retries or double-clicks.

Additionally, Stripe checkout sessions use deterministic idempotency keys derived from `(operation, customerId, priceId, organizationId)` (`stripeService.ts:59`), preventing duplicate sessions even without the middleware.

Webhook handlers use atomic `INSERT ... ON CONFLICT DO NOTHING RETURNING id` for event claiming (`webhookHandlers.ts:34-38`), eliminating the TOCTOU race condition from DEFECT-0006.

### Dunning Flow (Positive Finding)

The dunning system (`server/services/dunning.ts`) is comprehensive:
- 4-stage escalation: grace_period (3 days) -> warning (7 days) -> restricted (14 days) -> cancelled (21 days).
- Scheduled email notifications at days 0, 2, 6, and 13 with professional, non-aggressive templates.
- Access restriction at the restricted stage (`hasRestrictedAccess()`, `dunning.ts:348-351`).
- Auto-downgrade to free tier at suspended/cancelled stages (`dunning.ts:389-411`).
- High-value customer alerts for invoices over $100 (`dunning.ts:196`).
- Recovery emails on successful payment, restoring full access (`dunning.ts:256`).

### Refund Flow (Positive Finding)

Self-serve refunds under $50 are auto-approved (`routes-billing.ts:832`), with a 30-day rate limit preventing abuse (`routes-billing.ts:799-812`). Auto-approved refunds cancel the subscription and downgrade to free tier atomically (`routes-billing.ts:846-887`). Higher refunds require manual approval. Confirmation emails are sent.

---

## Verdicts Summary

| Verdict | Count | Items |
|---------|-------|-------|
| PASS    | 4     | Invoices, Usage Tracking, Overage Charges, Trial Period, Proration |
| CONCERN | 3     | Credit System Accuracy, Tier Enforcement, Audit Trail |
| FAIL    | 2     | Tax Handling, Multi-Currency |

### Priority Fixes

1. **P0 -- Tier limit mismatch**: Consolidate `TIER_LIMITS` (usageLimits.ts) and `SUBSCRIPTION_TIERS` (schema.ts) into a single source of truth. Customers are being enforced at lower limits than what is displayed on pricing pages. This is a billing integrity violation.
2. **P1 -- Non-transactional credit operations**: Wrap `applyCreditPackPurchase()` and `deductCredits()` in `withTransaction()` to match the existing pattern in `addCredits()`.
3. **P1 -- Tax collection**: Enable `automatic_tax: { enabled: true }` on all Stripe checkout sessions and configure tax registrations in the Stripe Dashboard.
4. **P2 -- Subscription event visibility**: Add `GET /api/subscription/events` endpoint so customers can view their billing history.
5. **P2 -- Transaction pagination**: Add cursor-based pagination to `GET /api/credits/transactions`.
6. **P3 -- Auto-top-up wiring**: Complete the TODO at `credits.ts:129` to wire auto-top-up to Stripe PaymentIntents.
7. **P3 -- Trial day discrepancy**: Update the settings page trial text from "7-day" to "14-day" to match the service constant.
8. **P3 -- Multi-currency**: Document USD-only billing for V1. Plan currency support for V2.

---

*Reviewed by Billing Auditor red team persona. All file paths and line numbers verified against codebase as of 2026-04-18.*
