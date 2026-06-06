# `financial_ledger` is the System of Record

**Status:** ratified 2026-06-06 (Lena CFO + Iris CTO, Tahoe lock-in L6)
**Schema:** `shared/schema/finance.ts` → `financialLedger`
**Service:** `server/services/financial-ledger.ts`
**Reader routes:** `server/routes-finance-ledger.ts` (mounted at `/api/founder/finance`)
**Invariant:** `server/services/financial-ledger-invariant.ts` (startup assertion)

---

## Why this exists

Until 2026-06-06, AcreOS treated the `financial_ledger` table as an *internal*
representation of money flow that would eventually be reconciled against an
external bookkeeping system (likely QuickBooks Online). The assumption was that
QBO would be the system of record and our ledger would be a downstream cache.

The Tahoe horizon audit (Lena, L6) flipped that posture. `financial_ledger` is
already shaped like a double-entry ledger — append-only, signed-amount cents,
idempotent via `external_event_id`, five-bucket allocation per
`shared/billing/allocation-policy.ts`, per-org attribution, audit-traceable
`postedBy` — so promoting it to the canonical system of record is purely a
documentation + invariant change. The code is already there.

**Every dollar that moves through AcreOS lives first in `financial_ledger`. Every
external system — including QuickBooks Online when we wire it up — consumes
from it.**

---

## What this means concretely

### Money IN

Every inbound dollar lands in `financial_ledger` before anything else happens:

| Source | Entry point | Function |
| --- | --- | --- |
| Stripe payment | `server/services/stripe-webhook*` | `postRevenue()` (5-row allocation split) |
| Founder manual draw-in | future founder studio surface | `postRevenue()` w/ `postedBy=founder:<id>` |
| Future processors (Apple Pay, ACH direct) | future processor adapters | `postRevenue()` |

Any code path that recognises revenue but does NOT call `postRevenue()` is a
bug. The five-bucket split (`tax_reserve` 25% / `refund_reserve` 10% /
`profit_reserve` 5% / `owner_draw` 5% / `opex_available` 55%) is the canonical
allocation; downstream consumers do not get to re-allocate.

### Money OUT

Every outbound dollar debits `opex_available` via `financial_ledger`:

| Sink | Entry point | Function |
| --- | --- | --- |
| AI provider charges (OpenRouter, Anthropic, OpenAI) | `server/services/aiRouter*` / `dailyAiCostGuard` | `postOpexSpent()` |
| Communications (Twilio, Telnyx, SendGrid, Lob, PostGrid) | provider invoice ingestion | `postOpexSpent()` |
| Stripe fees | `stripe-webhook*` | `postOpexSpent(category='stripe_fee')` |
| Infrastructure (Fly, Neon, Sentry) | future infra ingest | `postOpexSpent(category='infra')` |
| Founder draws-out (compensation paid) | future founder studio | `manual_transfer` from `owner_draw` |
| Refunds / chargebacks | `stripe-webhook*` | `postRefund()` |

### The 5 buckets are canonical

Names are exactly: `tax_reserve`, `refund_reserve`, `profit_reserve`,
`owner_draw`, `opex_available`. They are defined in
`shared/billing/allocation-policy.ts` and validated at every service boundary
via `assertValidAllocationPolicy()`. No parallel ledgers. No alternative
allocation schemes. The percentages are tunable via the
`allocation.policy` founder setting; the bucket NAMES are not.

---

## QBO ingestion (future)

When QBO ingestion ships:

1. QBO becomes a **SYNC destination**, not a source of truth.
2. Every `financial_ledger` row that represents an external-facing flow is
   pushed to QBO as a journal entry.
3. `financial_ledger` reconciles AGAINST QBO (looking for missing entries on
   the QBO side, or QBO entries with no upstream ledger row) — never the
   reverse.
4. If a discrepancy is found, the human resolution path is: fix the source
   webhook / ingestion so it produces the missing ledger row, then re-sync to
   QBO. We do not insert directly into QBO to "fix" a gap.

The reconciliation report (future surface) will live at
`/api/founder/finance/qbo-reconciliation`.

---

## Runtime invariant

On every server startup (`server/index.ts` boot path), the invariant module
`server/services/financial-ledger-invariant.ts` asserts:

1. The `financial_ledger` table exists (catches misconfigured / wrong DB
   credentials before any webhook can post).
2. A bucket-balance probe over the table runs successfully (catches schema
   drift where the table exists but the expected columns are missing).

If the assertion fails the server still boots (we never block boot on a
finance-only check — the platform must stay reachable), but a `logger.error`
fires with the structured tag `financial_ledger.invariant_failed` and Sentry
captures the exception. The error is loud enough that the next deploy cycle
will catch it.

---

## Reserve floor

Codified in `shared/finance/reserve-floor.ts`. The current rule:

> Tax + refund + profit reserves combined MUST equal at least
> `RESERVE_FLOOR_MIN_FRACTION` (0.30) of trailing-90-day revenue.

The reserve floor is checked nightly (extended into `runScheduledJobs.ts`) and
recorded to `reserve_floor_check`. It does NOT block any work — it is a signal
to the founder cockpit, surfaced at `/api/admin/finance/reserve-floor`.

When opex spend drains reserves below the floor, the next allocation policy
adjustment proposal should push more of incoming revenue into reserves until
the floor is recovered.

---

## What this is NOT

- This is not an accounting framework (we are not GAAP-compliant by virtue of
  this document — `financial_ledger` is *built* to make GAAP/ASC 606
  alignment cheap when we ship deferred-revenue recognition, but the lockstep
  is in `server/services/recognitionWorker.ts`, not here).
- This is not a tax determination engine. `tax_reserve` is a set-aside, not a
  remittance. Quarterly tax calculations live in a future surface and read
  `financial_ledger` like everyone else.
- This is not a budget. Budgets / forecasts live in
  `server/services/costOptimizer.ts` and consume `financial_ledger` as their
  ground-truth past.

---

## Amendment protocol

This document is a load-bearing posture decision. Changing the
"system-of-record" claim (e.g. making QBO authoritative) requires:

1. Founder sign-off (Tom).
2. A schema migration that captures the cutover point (a `posture_history`
   row would be appropriate).
3. An updated copy of this document on the new branch, with the old version
   preserved in git history.

Routine corrections (fixing a typo, adding a new sink to the OUT table, etc.)
do not require sign-off — those are normal PR-level edits.
