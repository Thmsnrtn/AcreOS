# Lens 50 -- Edge Cases & Boundary Conditions

Auditor: Edge Case Specialist
Date: 2026-04-15
Status: AUDIT COMPLETE

---

## Executive Summary

AcreOS has significant exposure to data corruption through concurrent access patterns, incorrect financial calculations under edge conditions, and timezone-naive date handling. Only one entity (deals) has optimistic locking, while every other write path -- including financial note balances, credit balances, and organization settings -- is vulnerable to lost-update races. The custom CSV parser silently mishandles Unicode and multi-line fields. Several dashboard endpoints load unbounded datasets into memory, creating a latent OOM risk as tenants grow.

---

## P0 -- Data Corruption on Concurrent Access

### 50-P0-01: Borrower payment creates payment + updates note balance without a transaction

**Files:** `server/routes-borrower.ts:427-464`, `server/webhookHandlers.ts:641-669`

Both the borrower portal payment verification (`/api/portal/:accessToken/verify-payment`) and the Stripe webhook handler (`WebhookHandlers.processBorrowerPortalPayment`) execute a three-step sequence -- create payment record, update note balance, update amortization schedule -- as separate queries with no wrapping database transaction. If the process crashes or a query fails between steps, the payment is recorded but the balance is never decremented (or vice versa), leaving the note in an inconsistent state.

The duplicate-check (`existingPayments.some(p => p.transactionId === sessionId)`) is also not atomic: two concurrent requests (e.g., webhook retry + user polling) can both pass the check before either inserts, resulting in a double payment record and double balance deduction.

**Impact:** Financial data corruption -- note balances diverge from actual payment history. In a loan servicing product, this is a regulatory-grade defect.

### 50-P0-02: Credit balance update + transaction log are not atomic

**File:** `server/services/credits.ts:46-68` (addCredits), `server/services/credits.ts:92-121` (deductCredits)

`addCredits` and `deductCredits` each execute two separate queries: (1) UPDATE the organization's `creditBalance` column, (2) INSERT a `creditTransactions` row. These are not wrapped in a database transaction. If the insert fails after the update succeeds, credits are added/removed with no audit trail. The `balanceAfterCents` stored in the transaction row is derived from the RETURNING clause of the first query, so it will be correct only if no concurrent operation modifies the balance between the two statements.

Additionally, `applyCreditPackPurchase` at line 167 has the same pattern and no idempotency guard on the Stripe session ID -- if the Stripe webhook fires twice before the first completes, the same pack can be applied twice.

**Impact:** Credit balance corruption; potential double-charge or double-credit on webhook retries.

### 50-P0-03: Organization settings read-modify-write race condition

**Files:** `server/storage.ts:1191-1211` (updateOrganizationAISettings), `server/routes-campaigns.ts:1127`, `server/routes-import-export.ts:434`, `server/services/onboarding.ts:489+`

Multiple code paths follow a pattern: read `org.settings`, spread existing settings with new values, then write the merged object back. Example from `updateOrganizationAISettings`:

```typescript
const currentSettings = org.settings || {};
const updatedSettings = { ...currentSettings, aiSettings: { ...currentSettings.aiSettings, ...aiSettings } };
await db.update(organizations).set({ settings: updatedSettings }).where(...);
```

Two concurrent requests modifying different settings keys (e.g., one updating `mailMode`, another updating `aiSettings`) will cause one to silently overwrite the other's changes. This is the classic lost-update problem. At least 8 code paths use this pattern across campaigns, onboarding, retention policies, and AI settings.

**Impact:** Silent data loss on organization configuration, potentially reverting critical settings like `mailMode` from 'live' back to 'test'.

### 50-P0-04: Lead, property, and note updates have no concurrency protection

**Files:** `server/storage.ts:1334-1340` (updateLead), `server/storage.ts:1615-1621` (updateProperty), `server/storage.ts:1805-1811` (updateNote)

Only `updateDeal` (line 1702) supports optimistic locking via an optional `expectedUpdatedAt` parameter. All other entity update methods (`updateLead`, `updateProperty`, `updateNote`) do a blind `UPDATE ... SET ... WHERE id = ?` with no version check. Two team members editing the same lead concurrently will silently lose one set of changes.

The deal optimistic lock is also not used in practice -- the route handler at `routes-deals.ts:232` calls `storage.updateDeal(dealId, validated)` without passing `expectedUpdatedAt`, so even the deal path is unprotected.

**Impact:** Last-write-wins data loss across the entire CRM.

### 50-P0-05: Document template version increment is not atomic

**File:** `server/storage.ts:4918-4931`

`updateDocumentTemplate` reads the current version with a SELECT, increments it in JavaScript (`currentVersion + 1`), then writes the new version back. Two concurrent updates will read the same version number and both write `version + 1`, losing one version increment. This breaks the version history chain.

**Impact:** Document versioning becomes unreliable; restoring to a "previous version" may restore the wrong content.

### 50-P0-06: Bulk operations in routes-bulk.ts bypass soft-delete, skip audit log, and run without transactions

**File:** `server/routes-bulk.ts:70-86`

`POST /api/bulk/leads/delete` calls `db.delete(leads)` -- a hard delete -- while the rest of the system uses soft-delete (`status: 'deleted'`). This contradicts the Task 223 policy enforced in `storage.ts:1342` and destroys audit-trail data permanently. Bulk update and delete operations also lack audit log entries and do not run within a transaction, so partial failures leave the dataset in an inconsistent state.

**Impact:** Permanent data loss via hard-delete; broken audit trail; partial bulk operations.

---

## P1 -- Incorrect Timezone Handling

### 50-P1-01: All date comparisons use server-local time via `new Date()` without timezone awareness

**Files:** `server/routes-dashboard.ts:36-40`, `server/routes.ts:1734-1736`, `server/routes-borrower.ts:547-551`, and 30+ other locations

Date boundaries for "today", "this week", and "this month" are calculated using `new Date()` which uses the server's system timezone (UTC on Fly.io). Example:

```typescript
const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
```

This means a user in PST sees their "today" tasks list shift at 4 PM (or 5 PM during daylight saving). Tasks due "today" in the user's timezone may appear as overdue or not-yet-due. The system has no concept of user timezone -- there is no `timezone` field on the organization or user model.

The only timezone reference in the codebase is a hardcoded `'America/Chicago'` in `routes-call-routing.ts:22`.

**Impact:** Incorrect "due today" / "overdue" classification; incorrect dashboard metrics for "this week" / "this month" boundaries; potential late-fee miscalculations.

### 50-P1-02: Payoff interest accrual uses 365-day year uniformly

**File:** `server/routes-borrower.ts:545`

```typescript
const dailyRate = interestRate / 100 / 365;
```

Financial convention varies: many lenders use 360-day year (30/360), others use actual/365 or actual/360. The hardcoded 365-day divisor may produce incorrect payoff amounts depending on the note's contractual basis, and there is no per-note configuration for day-count convention.

**Impact:** Payoff quotes may be wrong by a small but legally meaningful amount.

### 50-P1-03: Next payment date calculation uses `setMonth()` which silently shifts dates

**Files:** `server/routes-borrower.ts:456-457`, `server/webhookHandlers.ts:667-668`

```typescript
const nextPaymentDate = new Date(note.nextPaymentDate || new Date());
nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);
```

`setMonth()` on January 31 produces March 3 (not February 28), shifting all subsequent payments forward. For a note with payment day 31, this will cascade into progressively wrong dates. The `paymentDayOfMonth` field exists on the note schema but is not used in this calculation.

**Impact:** Payment due dates drift for notes with payment days 29-31; borrowers receive incorrect due date information.

### 50-P1-04: Dashboard "30 days ago" calculation does not account for DST transitions

**File:** `server/routes-dashboard.ts:39-40`

```typescript
const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
```

This subtracts exactly 30 * 86400 * 1000 milliseconds, which is not 30 calendar days across a DST boundary. Depending on server locale and transition timing, the cutoff could be off by one hour, potentially excluding or including deals at the boundary.

**Impact:** Minor metric inaccuracy in dashboard charts near DST transitions.

---

## P2 -- Missing Boundary Checks

### 50-P2-01: CSV parser does not handle BOM, multi-line quoted fields, or non-UTF-8 encodings

**File:** `server/services/importExport.ts:37-89`

The custom `parseCSV` function:
- Splits on `\r?\n` first, then parses each line. This breaks on RFC 4180-compliant CSV files with newlines inside quoted fields (e.g., a multi-line address).
- Does not strip the UTF-8 BOM (`\xEF\xBB\xBF`) that Excel on Windows prepends. The first header will be `"\uFEFF"firstName"` instead of `"firstName"`, causing silent column mapping failures.
- Calls `buffer.toString("utf-8")` unconditionally; files saved in Latin-1 or Windows-1252 will produce mojibake for accented characters in names/addresses.

**Impact:** Silent data corruption on CSV import for files exported from Excel (Windows), or files containing multi-line address fields or non-ASCII characters (common in Spanish-language property records).

### 50-P2-02: Dashboard endpoints load entire datasets into memory with no pagination or limit

**Files:** `server/routes-dashboard.ts:43-45`, `server/routes-analytics.ts:171-172`, `server/routes-leads.ts:211`, `server/ai/tools.ts:915+`

```typescript
const allLeads = await storage.getLeads(org.id);
const allDeals = await storage.getDeals(org.id);
const allProperties = await storage.getProperties(org.id);
```

`getLeads`, `getDeals`, and `getProperties` have no LIMIT clause. For an organization with 50,000+ leads, these queries will load all rows into Node.js memory simultaneously. With 3 concurrent dashboard loads on a 4GB Fly.io machine, this can trigger OOM kills. Paginated variants (`getLeadsPaginated`, etc.) exist but are not used by the dashboard or AI tool handlers.

**Impact:** Server OOM crash under moderate data volume; affects all tenants on the shared instance.

### 50-P2-03: `parseInt` and `Number()` on user-supplied params without NaN checks

**Files:** `server/routes-bulk.ts:31`, `server/routes-disposition.ts:25+`, `server/routes-maintenance.ts:24+`, `server/routes-founder-v7.ts:54+`

Multiple route handlers parse URL parameters with `parseInt(req.params.id)` or `Number(req.params.id)` without checking for NaN. Example:

```typescript
const propertyId = parseInt(req.params.propertyId);
```

If `propertyId` is `"abc"`, `parseInt` returns `NaN`, which is then used in a database query. Drizzle ORM may pass NaN as a parameter, causing unexpected query behavior or a Postgres error that surfaces as a 500.

**Impact:** Unhandled 500 errors on malformed URLs; poor error messages for API consumers.

### 50-P2-04: Filename sanitization strips all Unicode characters from uploaded filenames

**File:** `server/middleware/fileUploadSecurity.ts:83`

```typescript
file.originalname = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_");
```

This regex replaces every non-ASCII character with underscore. A file named "contrato_de_compraventa.pdf" becomes "contrato_de_compraventa.pdf" (fine), but "contrato_compra_Jose.pdf" with an accented e becomes "contrato_compra_Jos_.pdf". CJK filenames become entirely underscores.

**Impact:** Filename information loss for non-English-speaking users; confusing file names in document management.

### 50-P2-05: Credit deduction allows negative balance

**File:** `server/services/credits.ts:92-103`

The `deductCredits` method uses a conditional UPDATE:

```typescript
sql`COALESCE(${organizations.creditBalance}, '0')::numeric >= ${amountCents}`
```

This correctly prevents deduction below zero in the WHERE clause. However, `hasEnoughCredits` (line 124-142) performs a separate SELECT to check the balance before the route handler calls `deductCredits`. Between the check and the deduction, another request can drain the balance, causing the deduction to fail silently (returns null). The caller in many places does not check for the null return, proceeding as if credits were deducted, which means the user gets the service for free.

**Impact:** Credit bypass -- users may consume paid services (AI chat, document generation) without being charged.

### 50-P2-06: Export endpoint streams entire dataset without size limit

**File:** `server/routes-import-export.ts:208-272`

The export endpoint fetches all records for an entity type and serializes them to CSV or JSON in memory before sending. For an org with 100,000 leads, this will generate a multi-megabyte response. Combined with the fact that `getLeadsData` has no LIMIT, this can cause memory pressure and long response times. There is no streaming, no pagination of the export, and no background job for large exports.

**Impact:** Request timeout or OOM on large exports; poor user experience.

### 50-P2-07: Financial calculations use floating-point arithmetic via `toFixed(2)` and `Number()`

**Files:** `server/routes-borrower.ts:416-422`, `server/webhookHandlers.ts:632-638`

Loan payment splitting uses:

```typescript
principalAmount = Number((nextPendingPayment.principal * ratio).toFixed(2));
interestAmount = Number((nextPendingPayment.interest * ratio).toFixed(2));
```

Floating-point multiplication followed by `toFixed(2)` introduces rounding errors. For a $1,000.005 result, `toFixed(2)` produces "1000.00" (rounds down due to IEEE 754 representation), losing half a cent. Over many payments, these rounding errors compound. The split also does not verify that `principalAmount + interestAmount === paymentAmount`, so rounding can cause a penny discrepancy per payment.

Additionally, `Math.round(paymentAmount * 100)` at line 263 is used for Stripe's `unit_amount` (cents), which can produce incorrect values for amounts like $19.995 (IEEE 754 representation of 19.995 * 100 is 1999.4999... which rounds to 1999, not 2000).

**Impact:** Penny-level rounding errors in loan amortization; potential regulatory/accounting issues over the life of a note.

### 50-P2-08: Bulk delete reports `parsedIds.length` as count regardless of how many rows were actually deleted

**File:** `server/routes-bulk.ts:76-82`

```typescript
await db.delete(leads).where(and(...));
res.json({ success: true, deleted: parsedIds.length });
```

The response always claims all requested IDs were deleted, even if some IDs did not exist or belonged to a different organization. This applies to all bulk operations -- the response count is the input count, not the actual affected row count.

**Impact:** Misleading API response; client may believe records were deleted when they were not.

### 50-P2-09: `setMonth()` date overflow not handled in next payment calculation

**File:** `server/routes-borrower.ts:456-457`

When `nextPaymentDate` is the 31st of a month and `setMonth` advances to a month with fewer days, JavaScript silently overflows to the next month. For example, March 31 + 1 month = May 1 (not April 30). This means the borrower skips a month's payment date, and the pattern cascades to future payments.

Note: this is listed separately from P1-03 because the P1 item focuses on the timezone/DST aspect while this focuses on the day-of-month overflow which causes functional incorrectness.

### 50-P2-10: Upload routes use inconsistent file size limits

**Files:** Various upload configurations across the codebase:
- `routes-import-export.ts:22`: 5 MB
- `routes-ai.ts:1634`: 25 MB
- `routes-field-scout.ts:22`: 25 MB (voice), 10 MB (photos)
- `middleware/fileUploadSecurity.ts:63`: default 10 MB
- `routes-deal-rooms.ts:195`: checks `fileSize > 10 MB` but only in metadata -- actual file content is accepted from a URL without size enforcement

Most upload endpoints create their own multer instance instead of using the centralized `createUploadMiddleware` from `fileUploadSecurity.ts`, bypassing magic-byte validation and EXIF stripping.

**Impact:** Inconsistent security posture; uploads via certain endpoints skip content validation.

### 50-P2-11: TCPA stats endpoint loads all leads to count

**File:** `server/routes-import-export.ts:517-538`

```typescript
const [noConsent, optedOut, allLeads] = await Promise.all([
  storage.getLeadsWithoutConsent(orgId),
  storage.getLeadsOptedOut(orgId),
  storage.getLeads(orgId)
]);
```

Three full-table queries to count TCPA stats. For a large org this is three unbounded result sets loaded into memory just to call `.length` and `.filter().length`. A single SQL `COUNT` with conditional aggregation would be far more efficient.

**Impact:** Performance degradation and memory waste; compounds the OOM risk from P2-02.

---

## Summary Table

| ID | Priority | Category | Summary |
|----|----------|----------|---------|
| 50-P0-01 | P0 | Concurrency | Payment + balance update not in transaction |
| 50-P0-02 | P0 | Concurrency | Credit add/deduct not atomic with transaction log |
| 50-P0-03 | P0 | Concurrency | Org settings read-modify-write race |
| 50-P0-04 | P0 | Concurrency | Lead/property/note updates lack optimistic locking; deal lock unused |
| 50-P0-05 | P0 | Concurrency | Document template version increment not atomic |
| 50-P0-06 | P0 | Concurrency | Bulk delete uses hard-delete, skips audit, no transaction |
| 50-P1-01 | P1 | Timezone | Date boundaries use server time, no user timezone |
| 50-P1-02 | P1 | Financial | Payoff uses hardcoded 365-day year |
| 50-P1-03 | P1 | Timezone | `setMonth()` shifts payment dates across month boundaries |
| 50-P1-04 | P1 | Timezone | Dashboard "30 days" calculation ignores DST |
| 50-P2-01 | P2 | Boundary | CSV parser breaks on BOM, multi-line fields, non-UTF-8 |
| 50-P2-02 | P2 | Boundary | Dashboard loads unbounded datasets into memory |
| 50-P2-03 | P2 | Boundary | parseInt/Number without NaN guard on URL params |
| 50-P2-04 | P2 | Boundary | Filename sanitization strips all Unicode |
| 50-P2-05 | P2 | Boundary | Credit check-then-deduct race allows free usage |
| 50-P2-06 | P2 | Boundary | Export has no size limit or streaming |
| 50-P2-07 | P2 | Financial | Floating-point arithmetic in payment splitting |
| 50-P2-08 | P2 | Boundary | Bulk ops report input count, not actual affected count |
| 50-P2-09 | P2 | Boundary | setMonth day-of-month overflow skips months |
| 50-P2-10 | P2 | Boundary | Inconsistent upload size limits, bypassed validation |
| 50-P2-11 | P2 | Boundary | TCPA stats loads full lead set to count |

---

## Methodology

Searched for: `new Date()` / timezone patterns, `FOR UPDATE` / `transaction` / `optimistic` / `version` concurrency controls, `parseFloat` / `toFixed` / `Number()` financial math, `multer` / `upload` / `fileSize` upload handling, `getLeads` / `getDeals` unbounded queries, `parseCSV` Unicode handling, `updateOrganization` / `updateLead` / `updateNote` write patterns, and `bulkDelete` / `bulkUpdate` batch operations. Traced data flow through webhook handlers, borrower portal payments, credit service, and organization settings mutations.
