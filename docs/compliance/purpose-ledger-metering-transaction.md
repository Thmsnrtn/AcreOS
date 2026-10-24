# Purpose ledger and metering: one transaction or compensation?

**Decision memo for the COO (Muse). D2e, 2026-10-24. Recommendation only: nothing here has been implemented.**

This memo is about money, because it touches where a credit debit is committed. Changing that is
founder/COO-gated. The memo was written by reading the code; nothing was run against a database.
Line numbers are for commit `8d949e85`.

## The decision

The purpose-ledger row for a paid skip trace is written **after** the credit-pool debit has
already committed, on a separate connection. If writing the purpose row fails, the debit is
**refunded**. That is a compensation design. The question is whether to move the debit and the
purpose row into **one database transaction**, so they commit together or not at all.

**Recommendation: yes. Use one transaction for the debit and the purpose row (Option B).** Keep
compensation only for the step that cannot sit inside a transaction, which is the vendor call.
Add a read-only detector for orphaned debits (Option C) either way; that part needs no metering
change. Separately, make refund failure visible, so the route stops saying "Nothing was charged"
in cases where it cannot know that.

## What the code does today

There are two paid doors. Both are in `server/routes-skip-tracing.ts` (mounted under `/api/skip-tracing`).

### `POST /trace/:leadId` (line 352)

| Step | Code | Commits on |
|---|---|---|
| 1. FCRA gate (purpose, justification, attestation) | `gateSkipTracePermitted` | nothing (refusal costs nothing) |
| 2. Load the lead | `storage.getLead` | nothing |
| 3. **Debit 1 unit** | `poolDebit({ action: "skip_trace", externalEventId: skip:trace:{org}:{lead}:{ms} })` (l. 373) | **commit #1**: a `financial_ledger` row on the global connection (no `tx` passed) |
| 4. **Purpose row** | `recordPurpose({ surface: "skip_trace_call", meteringRef: "{traceKey}#{ledgerRowId}" })` (l. 402) | **commit #2**: a `purpose_ledger` row on the global connection |
| 4a. If 4 throws: refund, then 503 *"This lookup could not be recorded, so it was not run. Nothing was charged."* | `refundTrace` → `refundPoolDebit` (l. 413–415) | **commit #3**: refund row, in its own `withTransaction` |
| 5. Vendor call | `skipTracingService.trace(…, purpose)`, which refuses without a receipt | none (network call) |
| 5a. If 5 throws or `!success`: refund, then 503 | l. 429, 437 | commit #3' |
| 6. Persist the result onto `skip_traces` and the lead | `persistTraceResult` | commit #4 |

### `POST /batch` (line 461)

This door takes **one** debit for N leads (l. 504), then works through the leads one at a time:
it writes a purpose row and makes a vendor call for each lead (l. 529). A failed purpose write or
a failed lookup counts that lead as failed. At the end the route refunds
`Math.round(debited × failed / N)` (l. 566).

### `POST /api/skip-traces` (`server/routes-leads.ts:2132`)

This door has **no customer debit**. AcreOS's own vendor cost is posted after the call, as an
opex row, by `skipTracingService` (`postOpexSpent`, non-fatal). There is no metering event for a
purpose row to join, so this memo does not apply to it. It is still listed under open questions,
because a paid lookup that does not draw on the customer's pool is a pricing matter.

## What the compensation design guarantees

1. **No vendor call without a purpose row.** `skipTracingService.trace()` refuses unless it is
   given a receipt, so there is no path from a debit to a vendor call that skips step 4. This
   holds even if the process crashes, because a crash before step 4 also stops step 5.
2. **Every purpose row on a paid door names the debit it rode on.** `metering_ref` is set to
   `"{externalEventId}#{financial_ledger.id}"`. The id is `no-debit` when there was no debit,
   which happens for founders, BYOK and zero-cost cases.
3. **When the purpose write fails with an error the process sees, a refund is attempted** and
   the lookup is refused.
4. **The purpose ledger is append-only.** Migration 0289 adds triggers, pinned by
   `tests/integration/purposeLedgerAppendOnly.db.test.ts`. Rows that record attempts are never
   rewritten.

## Where it can fail

| # | Window | What happens | How often | Detectable? |
|---|---|---|---|---|
| F1 | **The process dies, or the connection or pool drops, between commit #1 and commit #2** (after the debit, before or while writing the purpose row) | The debit stands. There is no purpose row, no lookup and no refund. The customer has paid for nothing. A retry does **not** replay the debit, because `externalEventId` includes `clock.nowMs()`, so every attempt is a new debit. | Rare: two sequential writes milliseconds apart. Deploys and restarts make it more likely. | Yes, but nothing checks today. Look for a `financial_ledger` row with `external_event_id LIKE 'skip:trace:%'` that has no `purpose_ledger.metering_ref` starting with it and no `…:refund` row. |
| F2 | **The refund itself fails** (step 4a or 5a) | `refundPoolDebit` catches every error, logs `[credit-pool] refund failed` (`creditPool.ts:712`) and returns `void`. The route cannot tell, and at l. 415 it still tells the customer **"Nothing was charged."** That sentence is then false. | It needs a database failure on the refund right after one on the purpose write. The two are correlated (same database), so this is less rare than it sounds. | Only from the error log. |
| F3 | Commit #2 succeeds, but the client times out before the response | The customer sees an error. The purpose row and the debit both stand, and the lookup may have run. This is consistent, but the customer may run it again and be charged twice. | Ordinary network behaviour. | Yes: two rows. |
| F4 | The vendor fails after the purpose row is written | The refund runs. The purpose row stays and records a declared purpose for an attempt that returned no data. | Any provider outage. | Yes. The row has no matching `skip_traces` result. |
| F5 | The process dies after the vendor call, before `persistTraceResult` | AcreOS paid the vendor, the customer was debited and the purpose row exists, but the result is lost. | Rare. | Partly, through the opex row (`postOpexSpent`). |
| F6 | **Batch:** the process dies partway through | The debit for all N units stands. Purpose rows exist only for the leads that were attempted. There is no refund for the rest. | Rare, but the window is long: N sequential vendor calls. | Yes. Compare the debit's units with the number of purpose rows that carry `metering_ref` `skip:batch:…`. |
| F7 | **Batch:** the refund is rounded | The refund is rounded to the cent, so a batch can be over- or under-refunded by under 1¢. | Every partial failure. | Not material. |
| F8 | A refund lands in a later month | The refund goes to `refund_prior_period` and is not netted against the new month's pool (DEFECT-0227). | Month-end. | This is intended. |

F1 and F2 are the reason for this memo. F3–F8 exist under **either** design, because the vendor
call cannot be part of a database transaction.

## What one transaction would change (Option B)

The pieces already exist:

- `poolDebit` accepts `tx` (`PoolDebitArgs.tx`, `creditPool.ts:133–138`). It was added for
  DEFECT-0213, where the mail queue had the same crash-between-commits defect.
- `recordPurpose(entry, tx)` already joins a caller's transaction (`server/services/purposeLedger.ts`).
- There is precedent to copy: `POST /api/outreach/mail/queue` (`server/routes-outreach-mail.ts:822–965`)
  debits inside `db.transaction`. It throws `PoolRefusal` to roll back when the debit is refused,
  and calls `creditService.afterDebitCommitted(orgId)` **after** the commit when the debit was
  paid from purchased credits.

The shape would be:

```ts
const { debit, purpose } = await withTransaction(async (tx) => {
  const debit = await poolDebit({ …same args…, tx });
  if (!debit.allowed) throw new PoolRefusal(debit);                 // rolls back; nothing written
  const purpose = await recordPurpose({ …, meteringRef: `${traceKey}#${debit.ledgerRowId ?? "no-debit"}` }, tx);
  return { debit, purpose };                                        // both commit, or neither
});
if (debit.fundedBy === "purchased_credits") creditService.afterDebitCommitted(orgId);
// vendor call AFTER commit, never inside the transaction
```

What changes:

1. **F1 goes away.** Either both rows commit or neither does. There is no orphaned debit and no
   refund on this leg.
2. **F2 shrinks to the vendor-failure leg only.** The refund at l. 413 is deleted, and the l. 415
   message ("Nothing was charged") becomes true by construction, because a rolled-back
   transaction charged nothing.
3. **Error semantics change.** Inside a transaction, a failed debit statement aborts the
   transaction. `poolDebit`'s own `catch` returns `allowed: false`, and the caller has to throw to
   roll back (this is the `PoolRefusal` pattern). A purpose-write failure now rolls back the debit
   instead of refunding it. No refund row is written, so the financial ledger shows neither the
   debit nor a refund. That is cleaner, but anyone who reads the books by counting refund rows
   should know it has changed.
4. **The purchased-credit auto top-up moves after the commit.** `deductCredits` skips its own
   top-up when it is given a `tx`, so the door has to call `afterDebitCommitted`. The mail queue
   does this already. Forgetting it is the one real regression risk, and a test should pin it.
5. **Lock scope.** The pool gate is a single conditional `INSERT … WHERE (SELECT sum…) < pool`.
   Inside a transaction its row stays uncommitted until the purpose insert finishes, about one
   extra round-trip. Concurrent debits by the same org are already serialised by the atomic gate,
   so this window is milliseconds and holds no lock across the network.
6. **Batch.** The simplest correct version writes the debit and **all N purpose rows** in one
   transaction before any vendor call, then refunds per failed lookup as today. This turns F6
   into "rows for leads never attempted". Those rows are still true records of a declared
   purpose, but they overstate the lookups that happened. The alternative is one debit and one
   purpose row per lead inside a per-lead transaction. That is N small debits instead of one, and
   it changes how the pool gauge reports a batch. Both are metering-shape decisions for the COO.
7. **Nothing changes for founders and BYOK.** `poolDebit` returns early without writing, and the
   purpose row is still written with `metering_ref …#no-debit`.

What it does **not** fix: F3–F8. The vendor call is the step that cannot be undone, so the
vendor-failure refund stays.

## Options

| | Change | Fixes | Gated? | Effort |
|---|---|---|---|---|
| A | Status quo, with this memo as the record | – | – | 0 |
| **B (recommended)** | One transaction for debit + purpose row on both paid doors; refund only on vendor failure; `afterDebitCommitted` after commit; a test that kills the purpose insert and asserts no debit row | F1, most of F2, honest l. 415 copy | **Yes: changes where a debit commits** | Small: about 30 lines across two routes, plus tests modelled on the mail queue's |
| C (with A or B) | A read-only invariant watch: debits `skip:trace:%` / `skip:batch:%` with no matching purpose row and no refund, older than 10 minutes | Makes F1/F6 **visible** | No (read-only) | Small |
| D (with any) | Make `refundPoolDebit` return `{ refunded: boolean }` and make the route copy conditional ("We could not confirm the refund; support has been notified") | F2's false statement | **Yes: credit-pool code** | Small, but it touches every refund caller |

Why B: F1 is a customer charged for nothing, which this product's own rules forbid ("every paid
action must cover its own cost", and never claim an effect it did not have). The fix uses a
mechanism already in production for the mail queue, and it makes the customer-facing sentence at
l. 415 true by construction instead of hopefully. C is cheap insurance under any choice. D fixes a
real honesty defect, but it is a wider credit-pool change, so it should ship separately.

## Open questions for the COO

1. Approve B for `POST /trace/:leadId` and `POST /batch`? For the batch: one debit with N purpose
   rows written up front, or a per-lead transaction (see item 6)?
2. `POST /api/skip-traces` (`routes-leads.ts:2132`) runs a paid vendor lookup with **no customer
   debit**. Only AcreOS's opex is posted. Is that intended? This is a pricing question, so it is
   founder-gated and has not been touched.
3. Approve D (refund result plus honest copy) as its own change?
