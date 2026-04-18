# Lens 051 -- Concurrency / Race Condition Hunter

Auditor: Concurrency & Race Condition Specialist
Date: 2026-04-18
Scope: `server/` -- all route handlers, services, middleware, storage layer

---

## Executive Summary

AcreOS runs on a single-threaded Node.js process behind two Fly.io instances. Despite being single-threaded per instance, every `await` is a yield point where concurrent HTTP requests can interleave. With two machines, true concurrent writes to Postgres happen routinely. This audit found **4 P0**, **7 P1**, and **5 P2** concurrency defects. The most critical are in credit/payment processing and org creation where real money or data integrity is at stake.

---

## Findings

### RACE-001: Credit deduction is non-transactional -- balance update and ledger insert are separate operations (P0)

**File:** `server/services/credits.ts`, lines 96-136
**Pattern:** Read-modify-write without transaction

`deductCredits()` performs an atomic SQL balance decrement (good -- uses `WHERE balance >= amount`), but the subsequent `INSERT INTO credit_transactions` happens in a **separate** database statement outside any transaction. If the process crashes or the insert fails after the balance decrement, the credit balance is deducted but no ledger entry exists. The balance and the ledger are now permanently out of sync.

Compare with `addCredits()` at line 48 which correctly uses `withTransaction()`.

```typescript
// Line 96-107: UPDATE happens outside any transaction
const [updated] = await db
  .update(organizations)
  .set({ creditBalance: sql`...::numeric - ${amountCents}` })
  .where(...)
  .returning(...);

// Line 112-125: INSERT happens in a separate statement
const [transaction] = await db
  .insert(creditTransactions)
  .values({...})
  .returning();
```

**Impact:** Credit balance deducted but no audit trail. Customer disputes become unresolvable. Under load, this will eventually happen.

---

### RACE-002: Credit pack purchase (`applyCreditPackPurchase`) is non-transactional -- balance and ledger can desync (P0)

**File:** `server/services/credits.ts`, lines 198-234
**Pattern:** Non-atomic read-modify-write

`applyCreditPackPurchase()` updates the organization credit balance in one SQL statement, then inserts a credit transaction record in a second statement. No transaction wraps both operations. A crash between the two statements adds credits without a ledger entry, or records a ledger entry for credits that were never added.

Additionally, there is **no idempotency guard** on the `applyCreditPackPurchase()` method itself. While the webhook handler has event-level dedup (RACE-005), a re-delivery that arrives between the `isDuplicate` check and the `markProcessed` call could trigger a double credit grant.

---

### RACE-003: Stripe webhook idempotency has a TOCTOU gap (P0)

**File:** `server/webhookHandlers.ts`, lines 30-56, 59-86
**Pattern:** Check-then-act with async gap

The `processWebhook()` method checks `isDuplicate(event.id)` at line 73, then processes the event, then calls `markProcessed()` at line 84. Between the `isDuplicate` check and the `markProcessed` write, a duplicate delivery of the same Stripe event (which Stripe does routinely under network timeouts) can pass the check on both Fly.io instances simultaneously.

```typescript
// Line 73: CHECK -- no lock held
if (await WebhookHandlers.isDuplicate(event.id)) { return; }

// Line 80: ACT -- gap between check and this line
await WebhookHandlers.dispatchEvent(event);

// Line 84: MARK -- too late, second instance already passed the check
await WebhookHandlers.markProcessed(event.id, event.type);
```

This is classic TOCTOU. With two Fly.io machines, both can pass the `isDuplicate` check and process the same `checkout.session.completed` event, leading to double credit grants or double subscription activations.

**Fix direction:** Use `INSERT ... ON CONFLICT DO NOTHING RETURNING` as an atomic claim before processing, rather than SELECT-then-INSERT.

---

### RACE-004: Monthly credit allowance has a TOCTOU race for double-granting (P0)

**File:** `server/services/credits.ts`, lines 462-505 (`UsageMeteringService.applyMonthlyAllowance`)
**Also:** `server/services/credits.ts`, lines 236-264 (`CreditService.applyMonthlyAllowance`)
**Pattern:** Check-then-act with async gap

Both `applyMonthlyAllowance` methods check whether an allowance was already applied for the current month by querying for an existing `creditTransactions` row, then if none found, insert the allowance. Between the SELECT and the INSERT, a concurrent invocation (e.g., from the `processMonthlyAllowances` batch running on two instances, or a cron overlap) can pass the check and double-grant monthly credits.

```typescript
// Line 466: CHECK
const existing = await db.query.creditTransactions.findFirst({
  where: and(..., sql`metadata->>'month' = ${currentMonth}`),
});
if (existing) return null; // skip

// Line 480-486: ACT -- gap between check and insert
await db.update(organizations).set({ creditBalance: ... });
await db.insert(creditTransactions).values({ ... });
```

Neither the balance update nor the transaction insert is inside a transaction with a `FOR UPDATE` lock or a `UNIQUE` constraint on `(organizationId, type, month)`.

---

### RACE-005: `getOrCreateOrg` middleware can create duplicate organizations for the same user (P1)

**File:** `server/middleware/getOrCreateOrg.ts`, lines 30-109
**Pattern:** Check-then-act without transaction or unique constraint

When a new user's browser fires multiple requests simultaneously (common on page load -- prefetch, API calls, etc.), each request independently calls `getOrganizationByOwner(userId)`, finds nothing, then calls `createOrganization()`. Without a `UNIQUE` constraint on `organizations.ownerId` or a transaction with `FOR UPDATE`, the same user can end up with multiple organizations.

```typescript
// Line 46: CHECK
let org = await storage.getOrganizationByOwner(userId);

// Line 48-68: ACT -- no lock, no unique constraint
if (!org) {
  org = await storage.createOrganization({...});
  await storage.createTeamMember({...});
}
```

**Impact:** Duplicate orgs lead to data fragmentation -- leads, deals, billing data split across two orgs for the same user. Hard to detect, hard to merge.

---

### RACE-006: Marketplace listing duplicate check is not atomic (P1)

**File:** `server/services/marketplace.ts`, lines 24-68 (`createListing`)
**Pattern:** Check-then-act without transaction

The method checks for an existing active/under_offer listing for the same property, then creates a new one. Between the SELECT and the INSERT, another request can pass the check.

```typescript
// Line 36-41: CHECK
const existing = await db.select()
  .from(marketplaceListings)
  .where(and(eq(propertyId), inArray(status, ["active", "under_offer"])))
  .limit(1);
if (existing.length > 0) throw new Error("Property is already listed");

// Line 52-68: ACT -- gap
const [listing] = await db.insert(marketplaceListings).values({...});
```

**Impact:** Same property listed twice on marketplace. Confusing for buyers, potential for double-sale.

---

### RACE-007: Marketplace bid acceptance and listing status update are non-transactional (P1)

**File:** `server/services/marketplace.ts`, lines 324-397 (`respondToBid`)
**Pattern:** Non-atomic multi-table update

When a seller accepts a bid, three separate operations happen without a transaction:
1. Update bid status to `accepted` (line 358)
2. Update listing status to `under_offer` (line 369)
3. Create deal room (line 374)

If the process crashes after step 1 but before step 2, the bid is accepted but the listing remains `active`, allowing other bids to be accepted too. Multiple accepted bids on the same listing.

---

### RACE-008: Marketplace `completeTransaction` is non-transactional (P1)

**File:** `server/services/marketplace.ts`, lines 432-512
**Pattern:** Non-atomic multi-table financial operation

This method:
1. Inserts a marketplace transaction (line 450)
2. Updates listing status to `sold` (line 465)
3. Closes the deal room (line 473)
4. Creates a Stripe PaymentIntent (line 491)
5. Updates transaction with PaymentIntent ID (line 503)

None of these are in a transaction. A crash at any point leaves the system in an inconsistent state -- a listing marked sold with no transaction record, or a transaction without the listing being marked sold.

---

### RACE-009: Campaign email/SMS send has TOCTOU on credit check and no send-level idempotency (P1)

**File:** `server/routes-campaigns.ts`, lines 1571-1672 (email), lines 1675-1727+ (SMS)
**Pattern:** Check-then-act with large async gap

The credit check at line 1583 verifies the org has enough credits for the batch, but the actual deduction happens at line 1653 after all emails are sent. Between the check and the deduction:
- Another request could deplete credits
- The send loop takes significant wall-clock time (rate-limited at 5/sec)
- If the process crashes mid-loop, emails are sent but credits are never deducted

Additionally, there is **no per-recipient send tracking**. If the request times out at the HTTP level and the client retries, the same leads receive duplicate emails. No `sent_to` record is checked before each send.

```typescript
// Line 1583: CHECK -- credit balance sufficient
const hasCredits = await creditService.hasEnoughCredits(org.id, emailCost);

// Lines 1623-1650: SEND LOOP -- takes seconds to minutes
for (const lead of validLeads) {
  await emailService.sendEmail({...});
  results.sent++;
}

// Line 1653: DEDUCT -- happens after all sends, if at all
await creditService.deductCredits(org.id, results.sent * costPerEmail, ...);
```

**Impact:** Over-sending (duplicates to recipients), under-charging (credits never deducted), or double-charging (retry sends same batch).

---

### RACE-010: AI credit check (`callWithCreditCheck`) has TOCTOU between check and deduction (P1)

**File:** `server/utils/openaiClient.ts`, lines 47-72
**Pattern:** Check-then-act across an external API call

`hasEnoughCredits()` is checked, then the AI API is called (could take seconds), then `deductCredits()` happens. Between the check and the deduction, concurrent AI requests from the same org can all pass the credit check, make expensive API calls, and then each deduct credits -- potentially driving the balance negative.

The `deductCredits()` method does have a `WHERE balance >= amount` guard, but by that point the API call is already made and the org has consumed resources without paying. The `deductCredits` failure is caught and swallowed at line 67-68, meaning the org gets free AI calls.

```typescript
// Line 56: CHECK
const hasCredits = await creditService.hasEnoughCredits(organizationId, costCents);

// Line 62: EXPENSIVE OPERATION (seconds of wall time)
const result = await openAICircuitBreaker.call(fn);

// Line 65-68: DEDUCT -- failure swallowed!
await creditService.deductCredits(...).catch((err) => {
  logger.error("[AI] Failed to deduct credits...");
});
```

---

### RACE-011: Usage limit gate has TOCTOU between count check and record creation (P1)

**File:** `server/middleware/usageLimitGate.ts` + `server/services/usageLimits.ts`, lines 200-241
**Also:** `server/routes-leads.ts`, line 321 (double-check at line 325)
**Pattern:** Check-then-act

`checkUsageLimit()` counts existing records (e.g., leads), then the route handler creates a new record. Between the count and the insert, concurrent requests can exceed the limit. For leads, the check is even performed **twice** (once in the middleware at line 321, once inline at line 325), but neither is atomic with the insert.

The lead import endpoint at line 891 has the same issue on a larger scale -- it checks the limit against `current + csvData.length`, but another import or create request can interleave and exceed the limit.

**Impact:** Tier limits exceeded. Free-tier users can have more records than allowed.

---

### RACE-012: Referral credit activation can double-reward (P1 reduced from P0 -- $1 amounts limit blast radius)

**File:** `server/routes-referral.ts`, lines 146-199
**Pattern:** Check-then-act without transaction

The referral activation checks `if (referral.status === "converted") return`, then updates the status and credits both the referrer and referee orgs. No transaction wraps the check+update. Two simultaneous calls (e.g., from a user double-clicking) can both pass the check and double-grant credits.

```typescript
// Line 159: CHECK
if (referral.status === "converted") return;

// Line 165: ACT
await db.update(referrals).set({ status: "converted", ... });

// Lines 178-190: CREDIT BOTH ORGS -- separate raw SQL executions
await db.execute(sql`UPDATE organizations SET referral_credits = ... + ${creditAmount} ...`);
await db.execute(sql`UPDATE organizations SET referral_credits = ... + ${creditAmount} ...`);
```

---

### RACE-013: Stripe customer creation race on concurrent first-purchase requests (P2)

**File:** `server/routes-billing.ts`, lines 148-160 and lines 288-300
**Pattern:** Check-then-act with external side effect

Both the credit purchase and subscription checkout endpoints check `org.stripeCustomerId`, and if null, create a Stripe customer and save the ID. The `withTransaction()` wraps the DB save, but the `org.stripeCustomerId` check uses the **stale** `req.organization` value hydrated at middleware time. Two concurrent requests from a new user (e.g., double-click on "Subscribe") both read `null`, both create Stripe customers, and the second `updateOrganization` overwrites the first. The org now has two Stripe customers but only the second ID is stored; the first customer is orphaned in Stripe.

The `stripeService.createCustomer` call uses an idempotency key seeded with `(userId, email)`, which mitigates this for **identical** payloads but does not prevent orphaned customers if any parameter differs.

---

### RACE-014: `startTrial()` has TOCTOU for double-trial-start (P2)

**File:** `server/services/trialService.ts`, lines 57-88
**Pattern:** Check-then-act

`getTrialStatus()` checks `trialUsed`, then `startTrial()` sets `trialUsed = true`. Between the check and the update, concurrent requests can start multiple trials. The `UPDATE` at line 69 has no `WHERE trialUsed = false` guard.

```typescript
const status = await getTrialStatus(organizationId); // CHECK
if (status.trialUsed) throw new Error("already used");
// ... gap ...
await db.update(organizations).set({ trialUsed: true, ... }); // ACT -- no WHERE guard
```

---

### RACE-015: Marketplace premium upgrade deducts credits after applying upgrade (P2)

**File:** `server/services/marketplace.ts`, lines 735-781 (`upgradeToPremium`)
**Pattern:** Side effect before payment confirmation

The listing is upgraded to premium (line 751) **before** credits are deducted (line 762). If the credit deduction fails (insufficient funds), the upgrade is rolled back (line 769), but between the initial update and the rollback, the listing is visible as premium to all marketplace viewers. This is a minor UI inconsistency but represents an incorrect ordering of operations.

---

### RACE-016: In-memory idempotency middleware is per-instance, not cluster-wide (P2)

**File:** `server/middleware/idempotency.ts`, lines 36-89
**Pattern:** Non-shared state in multi-instance deployment

When Redis is unavailable (which the orientation doc notes -- Redis package was missing in production), the idempotency middleware falls back to an in-memory `Map`. With two Fly.io instances, the same idempotency key on different instances will not be detected as duplicate. This defeats the purpose of idempotency on payment mutations when Redis is down.

---

### RACE-017: Borrower portal payment creates checkout sessions without atomic claim (P2)

**File:** `server/routes-borrower.ts`, lines 220-280
**Pattern:** Overwrite without check

When a borrower initiates payment, a Stripe checkout session is created and the session ID is stored on the note at line 274. If the borrower clicks "Pay" twice quickly, two checkout sessions are created. The second `updateNote` overwrites `pendingCheckoutSessionId` with the new session ID. If the borrower completes payment on the first (now-orphaned) session, the webhook verification at `webhookHandlers.ts:612` fails because `note.pendingCheckoutSessionId !== session.id`, and the payment is silently dropped despite the borrower being charged.

---

### RACE-018: Investor profile `getOrCreate` pattern has no unique constraint guard (P3 -- backlog)

**File:** `server/services/marketplace.ts`, lines 517-551 (`getInvestorProfile`)
**Pattern:** Check-then-act on profile creation

Concurrent calls can create duplicate investor profiles for the same organization. Low severity because profiles are read-mostly and duplicates are cosmetic.

---

## Summary Table

| ID | Severity | Category | File | Description |
|----|----------|----------|------|-------------|
| RACE-001 | **P0** | Lost update / Ledger desync | `services/credits.ts:96` | `deductCredits` balance + ledger not in transaction |
| RACE-002 | **P0** | Lost update / Ledger desync | `services/credits.ts:198` | `applyCreditPackPurchase` balance + ledger not in transaction |
| RACE-003 | **P0** | Double-processing | `webhookHandlers.ts:73` | Stripe webhook idempotency has TOCTOU gap (2 Fly instances) |
| RACE-004 | **P0** | Double-granting | `services/credits.ts:462` | Monthly allowance check-then-insert race |
| RACE-005 | **P1** | Duplicate records | `middleware/getOrCreateOrg.ts:46` | Concurrent first requests create duplicate orgs |
| RACE-006 | **P1** | Duplicate records | `services/marketplace.ts:36` | Listing duplicate check not atomic |
| RACE-007 | **P1** | Inconsistent state | `services/marketplace.ts:324` | Bid accept + listing update not transactional |
| RACE-008 | **P1** | Inconsistent state | `services/marketplace.ts:432` | `completeTransaction` multi-table without tx |
| RACE-009 | **P1** | Double-send / Under-charge | `routes-campaigns.ts:1571` | Campaign send: TOCTOU on credits, no per-send dedup |
| RACE-010 | **P1** | Over-consumption | `utils/openaiClient.ts:47` | AI credit check TOCTOU + swallowed deduction failure |
| RACE-011 | **P1** | Limit bypass | `services/usageLimits.ts:200` | Usage limit TOCTOU between count and insert |
| RACE-012 | **P1** | Double-reward | `routes-referral.ts:146` | Referral activation double-credit without tx |
| RACE-013 | **P2** | Orphaned resource | `routes-billing.ts:148` | Double Stripe customer creation race |
| RACE-014 | **P2** | Limit bypass | `services/trialService.ts:57` | Trial start TOCTOU (no WHERE guard on update) |
| RACE-015 | **P2** | UI inconsistency | `services/marketplace.ts:735` | Premium upgrade applied before payment |
| RACE-016 | **P2** | Partial idempotency | `middleware/idempotency.ts:36` | In-memory store not shared across instances |
| RACE-017 | **P2** | Dropped payment | `routes-borrower.ts:274` | Checkout session overwrite on double-click |
| RACE-018 | **P3** | Duplicate records | `services/marketplace.ts:517` | Investor profile get-or-create without unique constraint |

---

## Positive Findings (What Is Already Done Right)

1. **`createPayment` in `storage.ts:1846`** -- Uses `withTransaction`, `SELECT FOR UPDATE`, and optimistic locking with version column. This is the gold standard pattern in this codebase.
2. **`addCredits` in `credits.ts:48`** -- Correctly uses `withTransaction` to atomically update balance and insert ledger entry.
3. **`consumeTrialToken` in `storage.ts:1220`** -- Uses atomic `UPDATE ... WHERE trial_tokens > 0 RETURNING` pattern. No TOCTOU possible.
4. **`deductCredits` balance guard** -- The `WHERE balance >= amount` in the UPDATE prevents negative balances at the SQL level (though the non-transactional ledger insert is still problematic per RACE-001).
5. **Stripe webhook event dedup table** -- The `stripeProcessedEvents` table with `onConflictDoNothing` is the right idea, just needs to be the **gating** mechanism rather than a post-hoc record (RACE-003).
6. **Stripe API idempotency keys** -- `stripeService.ts` uses deterministic idempotency keys for `createCustomer`, `createCheckoutSession`, and `createCreditPurchaseCheckout`.
7. **View counter increment** -- `marketplace.ts:181` uses atomic `SET views = views + 1` SQL. Correct pattern for counters.

---

## Recommended Fix Priorities

### Must-fix before launch (P0)
- RACE-001 + RACE-002: Wrap `deductCredits` and `applyCreditPackPurchase` in `withTransaction`, matching the existing `addCredits` pattern.
- RACE-003: Replace SELECT-based `isDuplicate` with `INSERT INTO stripe_processed_events ... ON CONFLICT DO NOTHING RETURNING id` as an atomic claim before dispatching. Only process if the insert returns a row.
- RACE-004: Add a `UNIQUE` constraint on `(organization_id, type, metadata->>'month')` for credit transactions, or use `INSERT ... ON CONFLICT DO NOTHING` as the idempotency gate.

### Fix before scaling (P1)
- RACE-005: Add `UNIQUE` constraint on `organizations.ownerId` in schema.
- RACE-006/007/008: Wrap marketplace mutations in `withTransaction`.
- RACE-009: Deduct credits upfront (before send loop), refund partial on failure. Add per-recipient `campaign_sends` table for dedup.
- RACE-010: Deduct credits before making the API call; refund on failure.
- RACE-011: Use `INSERT ... SELECT ... WHERE (SELECT count) < limit` pattern or advisory locks.
- RACE-012: Wrap in transaction with `WHERE status != 'converted'` on the UPDATE.
