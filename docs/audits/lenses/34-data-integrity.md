# Lens 34 -- Data Integrity Specialist Audit

**Auditor persona:** Data integrity specialist evaluating validation, consistency guarantees, backup/restore, and whether user data is safe against corruption, loss, and silent inconsistency.

**Date:** 2026-04-15

---

## Executive Summary

AcreOS handles financial data (credit balances, loan notes, payments, escrow accounts), deal pipeline state machines, and multi-tenant user data across 429 Drizzle tables. The system has **critical data corruption vectors in its financial operations**: the credit ledger (`addCredits` / `deductCredits`) performs a balance update and a transaction-log insert as two separate, non-transactional statements, meaning a failure between them silently desynchronizes the ledger from the balance. The payment-to-note-balance mutation has the same race condition. Deal pipeline status transitions are defined but the enforcement map is dead code -- deals can skip from `negotiating` to `closed` without passing through required intermediate states. Of 840 `req.body` references across route files, only 139 pass through Zod validation; the note update endpoint passes raw `req.body` directly to the database, allowing arbitrary field injection on a financial record. There are no Postgres CHECK constraints on any financial column -- negative credit balances, negative loan balances, and negative payment amounts are all structurally possible. Backup relies solely on Fly.io daily snapshots with 7-day retention and no tested automated restore procedure.

---

## Findings

### DI-001: Credit balance and transaction log are not atomically consistent

**Severity:** P0

**Description:** `CreditService.addCredits()` and `CreditService.deductCredits()` each perform two separate database operations: (1) UPDATE the organization's `creditBalance`, then (2) INSERT into `creditTransactions`. If the process crashes, the connection is lost, or the insert fails after the update succeeds, the organization's balance will be changed but no transaction record will exist. This creates a silent ledger-balance divergence that is invisible to both the user and the reconciliation system. The same pattern appears in `applyCreditPackPurchase()` and `applyMonthlyAllowance()` -- four separate call sites with the same non-transactional two-step pattern.

**Evidence:**
```
server/services/credits.ts:46-68  (addCredits)
server/services/credits.ts:92-122 (deductCredits)
server/services/credits.ts:167-191 (applyCreditPackPurchase)
server/services/credits.ts:423-444 (applyMonthlyAllowance in UsageMeteringService)
```

Each performs `db.update(organizations)` followed by `db.insert(creditTransactions)` with no wrapping transaction. The `withTransaction` helper exists in `server/db.ts` but is not used anywhere in the credits service.

**Impact:** Financial data corruption. An organization may have credits deducted but no record of the deduction (or vice versa). During a reconciliation audit, the `creditBalance` column will not match `SUM(amountCents)` from `creditTransactions`. The `balanceAfterCents` column on the transaction record is computed from the update's return value, meaning partial failures create permanently inconsistent audit trails.

---

### DI-002: Payment-to-note-balance mutation is a read-modify-write race condition

**Severity:** P0

**Description:** `storage.createPayment()` inserts a payment, then reads the note's `currentBalance`, subtracts `principalAmount` in JavaScript, and writes the new balance back. Two concurrent payments on the same note will both read the same starting balance, each compute their own subtraction, and the last write wins -- one payment's principal reduction is silently lost.

**Evidence:**
```
server/storage.ts:1841-1857
  async createPayment(payment: InsertPayment) {
    const [newPayment] = await db.insert(payments).values(payment).returning();
    if (payment.status === "completed") {
      const [note] = await db.select().from(notes).where(eq(notes.id, payment.noteId));
      if (note) {
        const newBalance = Number(note.currentBalance) - Number(payment.principalAmount);
        await db.update(notes).set({
          currentBalance: String(Math.max(0, newBalance)),
          ...
```

The same race exists in the Stripe webhook handler `processBorrowerPortalPayment()` (server/webhookHandlers.ts:656), which also performs a read-modify-write on `currentBalance` outside a transaction.

**Impact:** Incorrect note balances leading to wrong payoff quotes, incorrect delinquency assessments, and potential legal liability. Stripe webhooks can be retried, making concurrent execution a realistic scenario.

---

### DI-003: Deal status transition enforcement is dead code

**Severity:** P0

**Description:** `DEAL_STATUS_TRANSITIONS` is defined at line 189 of `routes-deals.ts` as a state machine map specifying valid transitions (e.g., `negotiating -> offer_sent | cancelled`). However, this map is **never referenced** anywhere in the codebase. The PUT `/api/deals/:id` handler at line 199 accepts any `status` value without checking whether the transition from the current status is valid. A deal can jump from `negotiating` directly to `closed`, bypassing `offer_sent`, `accepted`, and `in_escrow`.

**Evidence:**
```
server/routes-deals.ts:189  — DEAL_STATUS_TRANSITIONS defined
server/routes-deals.ts:199-232 — PUT handler does not reference DEAL_STATUS_TRANSITIONS
grep for "DEAL_STATUS_TRANSITIONS[" across server/ returns zero matches
```

**Impact:** Pipeline analytics become unreliable. Required approval gates (escrow, acceptance) can be skipped. Integration assumptions about deal lifecycle (e.g., triggering enrichment on acceptance, recording conversions on close) may fire on invalid state transitions.

---

### DI-004: Note update endpoint passes raw req.body to database without validation

**Severity:** P0

**Description:** The PUT `/api/notes/:id` endpoint at `routes-finance.ts:143` passes `req.body` directly to `storage.updateNote()` without any Zod schema validation. This means an attacker (or a buggy client) can set arbitrary fields on a note record -- including `currentBalance`, `originalPrincipal`, `organizationId`, `status`, `interestRate`, and `accessToken`. Compare this with the POST endpoint which correctly uses `insertNoteSchema.parse()`.

**Evidence:**
```
server/routes-finance.ts:143
  const note = await storage.updateNote(noteId, req.body);
```

The `updateNote` method in `storage.ts` simply spreads whatever it receives into a Drizzle `.set()` call (line 1807).

**Impact:** Any authenticated user who knows a note ID can overwrite any column on that note, including financial terms (interest rate, balance, payment amount), the organization ownership, and the borrower portal access token. This is both a data integrity and a security issue.

---

### DI-005: No database CHECK constraints on financial columns

**Severity:** P1

**Description:** The schema uses Postgres `numeric` type for all financial columns (`creditBalance`, `currentBalance`, `originalPrincipal`, `monthlyPayment`, `amount`, `principalAmount`, `interestAmount`, `taxEscrowBalance`, etc.) but defines no CHECK constraints to enforce invariants. There is no constraint preventing:
- Negative credit balances
- Negative loan balances
- Negative payment amounts
- Interest rates above 100% or below 0%
- Monthly payments exceeding the principal

The `numeric` columns also lack precision/scale specifications (`numeric("credit_balance")` rather than `numeric("credit_balance", { precision: 14, scale: 2 })`), meaning they accept arbitrary-precision decimals. A value like `0.000000001` cents is structurally valid.

**Evidence:**
```
shared/schema.ts:24   — creditBalance: numeric("credit_balance").default("0")
shared/schema.ts:777  — originalPrincipal: numeric("original_principal").notNull()
shared/schema.ts:778  — currentBalance: numeric("current_balance").notNull()
shared/schema.ts:874  — amount: numeric("amount").notNull()
```

Zero CHECK constraints found across all 35+ migration files. The application relies entirely on JavaScript validation, which is incomplete (see DI-004) and bypassable.

---

### DI-006: Inconsistent numeric parsing of financial values across codebase

**Severity:** P1

**Description:** The `creditBalance` field is stored as `numeric` (Postgres) which Drizzle returns as a string. Different parts of the codebase parse this string using different methods:
- `Number(org.creditBalance || 0)` -- credits.ts:36, storage.ts:3003
- `parseInt(org.creditBalance || '0')` -- alerting.ts:94 (truncates decimals)
- `parseFloat(org.creditBalance ?? "0")` -- agentTriggerMonitor.ts:531
- `Math.round(Number(org.creditBalance || '0'))` -- routes-campaigns.ts:1183

These produce different results for the same input. `parseInt("99.5")` returns `99` while `Number("99.5")` returns `99.5` and `Math.round(Number("99.5"))` returns `100`. The `creditBalance` is documented as "in cents" but there is no guarantee the stored value is an integer, and the inconsistent parsing means different subsystems see different balances for the same organization.

**Evidence:**
```
server/services/credits.ts:36          — Number(org?.creditBalance || 0)
server/services/alerting.ts:94         — parseInt(org.creditBalance || '0')
server/services/agentTriggerMonitor.ts:531 — parseFloat(org.creditBalance ?? "0")
server/routes-campaigns.ts:1183        — Math.round(Number(org.creditBalance || '0'))
```

**Impact:** Different subsystems may make different decisions about whether an organization has sufficient credits. The alerting system (using parseInt) could see a lower balance than the credit service (using Number), causing false or missed low-balance alerts.

---

### DI-007: Update/delete methods omit organizationId from WHERE clause

**Severity:** P1

**Description:** The storage layer's `updateNote()`, `updateLead()`, `updateProperty()`, `updatePayment()`, and `deleteNote()` methods filter only by the entity's `id`, not by `organizationId`. While route handlers verify ownership by first calling `getNote(orgId, noteId)`, the actual mutation runs `WHERE id = $1` only. If a TOCTOU (time-of-check/time-of-use) gap exists, or if any code path calls these methods without a prior ownership check, a cross-tenant data mutation is possible.

**Evidence:**
```
server/storage.ts:1805-1811 — updateNote: WHERE eq(notes.id, id)
server/storage.ts:1334-1338 — updateLead: WHERE eq(leads.id, id)
server/storage.ts:1615-1619 — updateProperty: WHERE eq(properties.id, id)
server/storage.ts:1860-1862 — updatePayment: WHERE eq(payments.id, id)
server/storage.ts:1813-1814 — deleteNote: WHERE eq(notes.id, id)
```

Note: `deleteNote` performs a hard DELETE, not a soft delete, while `bulkDeleteDeals` uses soft delete. This inconsistency compounds the risk.

**Impact:** Multi-tenant data isolation relies on application-level checks rather than database-level enforcement. Any bug that allows a request to bypass the ownership check results in cross-tenant data access or mutation.

---

### DI-008: Only 17% of request body accesses use Zod validation

**Severity:** P1

**Description:** Across 112 route files, there are 840 references to `req.body`. Only 139 of these (from 24 files) pass through Zod `safeParse()` or `.parse()`. The remaining ~700 accesses use `req.body` directly, trusting client input without server-side schema validation. This affects financial endpoints (note update), configuration endpoints, AI operation endpoints, and more.

**Evidence:**
```
Total req.body references across route files: 840
Total passing through .parse() or .safeParse(): 139
Validation coverage: ~17%
```

Key unvalidated endpoints include:
- PUT /api/notes/:id (financial record update) -- routes-finance.ts:143
- POST /api/notes/calculate-payment (financial calculation) -- routes-finance.ts:201
- Multiple endpoints in routes-admin.ts (65 req.body refs, 28 validated)
- routes-va-engine.ts (43 req.body refs, 1 validated)

**Impact:** Malformed or malicious input can cause unexpected behavior, type coercion errors, or injection of unexpected fields into database records. The Drizzle ORM provides some type safety at the TypeScript level, but this is compile-time only and does not protect against runtime input.

---

### DI-009: Borrower portal payment double-processes note balance

**Severity:** P1

**Description:** The Stripe webhook handler `processBorrowerPortalPayment()` calls `storage.createPayment()` (which itself updates the note balance), and then separately computes and writes a new balance via `storage.updateNote()`. This means the note balance is decremented twice for a single payment -- once inside `createPayment` and once explicitly in the webhook handler.

**Evidence:**
```
server/webhookHandlers.ts:641-676
  await storage.createPayment({...});          // line 641 — triggers balance update inside createPayment
  const newBalance = Math.max(0, Number(note.currentBalance) - principalAmount);  // line 656
  await storage.updateNote(note.id, {
    currentBalance: newBalance.toString(),      // line 671 — second balance update
    ...
  });
```

Note: `createPayment` (storage.ts:1841-1857) updates the balance when `payment.status === "completed"`, and the webhook passes `status: 'completed'` at line 653.

**Impact:** Each borrower portal payment may reduce the note balance by double the principal amount. A $500 principal payment would reduce the balance by $1000. This produces incorrect payoff dates, wrong amortization schedules, and potential overcharging of borrowers who pay off early based on an artificially low balance.

---

### DI-010: Credit deduction uses WHERE-based check instead of SELECT FOR UPDATE

**Severity:** P1

**Description:** `CreditService.deductCredits()` uses an optimistic check pattern: `WHERE credit_balance >= amountCents`. This is safe against going negative but is not safe against concurrent deductions draining the balance below what two concurrent checks each saw as sufficient. Two concurrent deductions of 500 cents against a 600-cent balance could both succeed because each UPDATE's WHERE evaluates before the other's write is committed (depending on isolation level). The default Postgres isolation level is READ COMMITTED, which allows this.

**Evidence:**
```
server/services/credits.ts:92-103
  const [updated] = await db
    .update(organizations)
    .set({
      creditBalance: sql`COALESCE(...) - ${amountCents}`
    })
    .where(
      and(
        eq(organizations.id, organizationId),
        sql`COALESCE(...) >= ${amountCents}`
      )
    )
```

No transaction wrapping, no SELECT FOR UPDATE, no advisory lock.

**Impact:** Under concurrent load, organizations may overdraw their credit balance. The WHERE check provides protection within a single statement, but without SERIALIZABLE isolation or advisory locking, the check-and-decrement is not linearizable.

**Note:** In practice, the single-statement `UPDATE ... WHERE balance >= X SET balance = balance - X` is atomic within Postgres (the WHERE and SET execute within the same row lock). This reduces severity from P0 to P1 -- the real risk is that the subsequent `INSERT INTO credit_transactions` is outside the same transaction (see DI-001), not the balance decrement itself.

---

### DI-011: No foreign key ON DELETE behavior defined for most relationships

**Severity:** P1

**Description:** Of ~189 foreign key references to `organizations.id` in the schema, only 3 specify ON DELETE behavior (2 `cascade`, 1 `set null`). The remaining ~186 use the Postgres default of `ON DELETE NO ACTION`, which means deleting an organization would fail with a foreign key violation rather than cascading or cleaning up child records. More critically, deleting a note (which is a hard DELETE via `storage.deleteNote`) will leave orphaned payment records, payment reminders, tax escrow payments, and borrower payment profiles pointing to a non-existent note.

**Evidence:**
```
shared/schema.ts — only 3 lines with onDelete:
  line 10075: { onDelete: "cascade" }
  line 11026: { onDelete: "set null" }
  line 11043: { onDelete: "set null" }
```

`storage.deleteNote(id)` performs `db.delete(notes).where(eq(notes.id, id))` with no cascade handling for child `payments`, `paymentReminders`, or `taxEscrowPayments` records.

**Impact:** Hard-deleting a note will either fail with a FK violation (if the database enforces it) or leave orphaned child records (if FKs were not created). Payment history becomes disconnected from its parent note. The borrower portal may crash when loading payments for a deleted note.

---

### DI-012: Soft delete vs hard delete inconsistency across entity types

**Severity:** P2

**Description:** Different entity types use different deletion strategies with no documented policy:
- **Leads:** Soft delete via `deletedAt` timestamp (schema.ts:362)
- **Deals:** Soft delete via `status: "deleted"` (storage.ts:1728)
- **Properties:** Soft delete via `status: "deleted"` check in queries
- **Notes:** Hard DELETE (storage.ts:1813-1814) despite having a `deletedAt` column (schema.ts:857)

Notes have a `deletedAt` column defined in the schema but `deleteNote()` performs a destructive `db.delete()` instead of a soft delete. This is particularly concerning because notes are financial records that may need to be retained for legal compliance, audit trails, and tax reporting.

**Evidence:**
```
shared/schema.ts:857 — deletedAt: timestamp("deleted_at") [on notes table]
server/storage.ts:1813 — await db.delete(notes).where(eq(notes.id, id)); [hard delete]
```

**Impact:** Permanently destroyed financial records. If a note is deleted, the payment history, amortization schedule, and escrow records associated with it lose their parent context. There is no way to recover or audit the deleted note data.

---

### DI-013: Status fields use free-text instead of Postgres ENUMs or CHECK constraints

**Severity:** P2

**Description:** All status columns across the schema use `text("status")` with no database-level constraint. Valid values are documented only in code comments (e.g., `// pending, active, paid_off, defaulted, foreclosed`). There are 30+ status columns across the schema, each accepting any arbitrary string. The application-level enforcement is partial -- Zod `createInsertSchema` generates schemas from Drizzle columns, but `text` columns produce `z.string()` with no enum restriction.

**Evidence:**
```
shared/schema.ts — 30+ instances of text("status") with comment-only validation:
  line 137: status: text("status") // pending, verified, failed
  line 668: status: text("status") // negotiating, offer_sent, ...
  line 807: status: text("status") // pending, active, paid_off, defaulted, foreclosed
  line 887: status: text("status") // pending, processing, completed, failed, refunded
```

**Impact:** Typos in status values (e.g., "actve" instead of "active") will be silently accepted and stored. Queries filtering by status may miss records with misspelled values. Dashboard aggregations will be incorrect.

---

### DI-014: Backup strategy relies on single provider with no tested automated restore

**Severity:** P2

**Description:** The disaster recovery plan documents daily automated snapshots via Fly.io Postgres with 7-day retention. The restore procedure is a manual runbook (`flyctl postgres restore`). There is no automated backup verification, no cross-region backup copy, and no evidence the restore procedure has been tested. The `.env.example` references an `DB_BACKUP_S3_BUCKET=acreos-db-backups` but this appears to be commented out and unused.

**Evidence:**
```
docs/disaster-recovery.md:17 — Daily snapshots, 7-day retention
.env.example:219-220 — DB_BACKUP_S3_BUCKET commented out
```

The DR plan specifies monthly restore testing ("Monthly: Test database backup restore to staging") but there is no automation, no CI job, and no evidence this has been performed.

**Impact:** If Fly.io's snapshot system fails or the database suffers corruption, the RPO of 1 hour is aspirational rather than guaranteed. Seven days of retention means any data corruption that goes unnoticed for a week may be unrecoverable.

---

### DI-015: Webhook handler marks events as processed even on unrecoverable errors

**Severity:** P2

**Description:** The `processWebhook` method in `webhookHandlers.ts` wraps event dispatch in a try/catch and calls `markProcessed()` in the `finally` block. This means if `dispatchEvent()` throws an unrecoverable error (e.g., database down, invalid data), the event is still marked as processed and will never be retried. For financial events like `checkout.session.completed` (credit purchases) and `invoice.payment_succeeded` (subscription payments), this means payment may succeed on Stripe's side but never be reflected in the application.

**Evidence:**
```
server/webhookHandlers.ts:77-84
  try {
    await WebhookHandlers.dispatchEvent(event);
  } catch (err: any) {
    logger.error(`[webhook] Unrecoverable error processing ${event.type} (${event.id})`, err);
  } finally {
    await WebhookHandlers.markProcessed(event.id, event.type);  // always marks processed
  }
```

**Impact:** Lost payment events. A customer pays for credits or a subscription, Stripe charges them, but the application never records the credits or activates the subscription. The idempotency check prevents reprocessing even if the webhook is retried by Stripe.

---

### DI-016: Idempotency middleware falls back to in-memory store across multiple instances

**Severity:** P2

**Description:** The idempotency middleware uses Redis when available but falls back to an in-memory `Map` when Redis is not configured (and Redis is noted as missing in the P0 orientation issues). With 2 Fly.io instances behind a load balancer, two requests with the same idempotency key can hit different instances and both be processed, since neither instance's in-memory store contains the other's key.

**Evidence:**
```
server/middleware/idempotency.ts:35 — const memStore = new Map<string, StoredResponse>();
server/middleware/idempotency.ts:77 — return memStore.get(key) ?? null;  // fallback
```

From orientation: "Redis package missing -- Cannot find package 'redis' in production."

**Impact:** Duplicate payment processing on credit purchases and subscription checkouts. The idempotency middleware is only applied to two routes (`/api/credits/purchase` and `/api/stripe/checkout`), and with Redis missing, it provides no protection against duplicate requests routed to different instances.

---

### DI-017: Optimistic locking only implemented for deals, not for notes or payments

**Severity:** P2

**Description:** `storage.updateDeal()` implements optimistic locking via an `expectedUpdatedAt` parameter (Task 219). However, `updateNote()`, `updatePayment()`, `updateLead()`, and `updateProperty()` have no optimistic locking. For financial records (notes and payments), concurrent updates from the UI, the borrower portal, automated payment processing, and the finance agent can overwrite each other's changes silently.

**Evidence:**
```
server/storage.ts:1702-1722 — updateDeal has optimistic locking
server/storage.ts:1805-1811 — updateNote has NO optimistic locking
server/storage.ts:1860-1862 — updatePayment has NO optimistic locking
```

**Impact:** Last-write-wins on financial records. A delinquency status update from the finance agent can be overwritten by a concurrent manual edit, or vice versa, with no conflict detection.

---

### DI-018: usageRecords insert not transactional with credit deduction

**Severity:** P2

**Description:** `UsageMeteringService.recordUsage()` first calls `deductCredits()` and then inserts a usage record. If the insert fails, credits are deducted but no usage record exists. There is no compensating transaction to refund the credits.

**Evidence:**
```
server/services/credits.ts:290-316
  const deductResult = await this.creditService.deductCredits(...);
  if (!deductResult) {
    return { record: null, deducted: false, insufficientCredits: true };
  }
  const [record] = await db.insert(usageRecords).values({...}).returning();
  return { record, deducted: autoDeduct && totalCost > 0, insufficientCredits: false };
```

No transaction wrapping. If `db.insert(usageRecords)` throws, credits are lost.

**Impact:** Silent credit leakage. Usage tracking becomes inconsistent with actual credit consumption.

---

## Positive Observations

1. **Stripe webhook idempotency**: The `stripeProcessedEvents` table and duplicate-check pattern prevent reprocessing of already-handled Stripe events (though the always-mark-processed pattern in DI-015 undermines this).

2. **Audit logging**: Financial mutations (deal create/update, note create/update/delete) consistently write to the audit log with before/after snapshots, IP address, and user agent.

3. **Usury violation checks**: Both note creation and deal creation validate interest rates against state-specific usury limits before saving, preventing illegal financial terms.

4. **Import transactionality**: CSV lead and property imports are wrapped in `db.transaction()`, ensuring all-or-nothing batch inserts.

5. **Trial token atomic decrement**: `consumeTrialToken()` uses a single atomic SQL `UPDATE ... WHERE trial_tokens > 0`, preventing race conditions on token consumption.

6. **Optimistic locking on deals**: The deal update method supports conflict detection via `expectedUpdatedAt`, properly throwing on concurrent modification.

7. **Borrower portal security**: Session validation, httpOnly cookies, generic error messages to prevent information leakage, and checkout session ID verification to prevent replay attacks.

---

## Priority Summary

| ID | Title | Severity |
|----|-------|----------|
| DI-001 | Credit balance and transaction log not atomically consistent | P0 |
| DI-002 | Payment-to-note-balance race condition | P0 |
| DI-003 | Deal status transition enforcement is dead code | P0 |
| DI-004 | Note update passes raw req.body to database | P0 |
| DI-005 | No CHECK constraints on financial columns | P1 |
| DI-006 | Inconsistent numeric parsing of creditBalance | P1 |
| DI-007 | Update/delete methods omit organizationId from WHERE | P1 |
| DI-008 | Only 17% of req.body accesses use Zod validation | P1 |
| DI-009 | Borrower portal payment double-decrements note balance | P1 |
| DI-010 | Credit deduction lacks transaction isolation | P1 |
| DI-011 | No ON DELETE behavior for most foreign keys | P1 |
| DI-012 | Soft delete vs hard delete inconsistency | P2 |
| DI-013 | Status fields use free-text instead of ENUMs | P2 |
| DI-014 | Backup relies on single provider with no tested restore | P2 |
| DI-015 | Webhook marks events processed even on failure | P2 |
| DI-016 | Idempotency middleware falls back to per-instance memory | P2 |
| DI-017 | No optimistic locking on notes or payments | P2 |
| DI-018 | usageRecords insert not transactional with credit deduction | P2 |
