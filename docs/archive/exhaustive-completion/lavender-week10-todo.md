# Lavender Week 10 — Monthly-Close Pipeline TODO

This file tracks the deferred work for the monthly-close foundation. Week 6
shipped the schema + seed (`chart_of_accounts`, `account_ledger_entries`,
`seedChartOfAccountsForOrg`). Week 10 builds the pipeline on top.

## Scope (Week 10)

### 1. Stripe-event-driven ledger writes
- Subscribe to `invoice.payment_succeeded`, `charge.refunded`,
  `charge.dispute.funds_withdrawn`, `payout.paid`.
- Map each event to a balanced pair of `account_ledger_entries` rows
  (e.g. invoice payment ⇒ DR 1000 Cash / CR 4000 Subscription Revenue).
- Idempotency keyed on `referenceType="stripe_event"` +
  `referenceId=event.id`.
- Write inside a single DB transaction so partial pairs are impossible.

### 2. Recognition worker
- Cron-driven service (likely hourly) that converts deferred-revenue
  bookings into recognised revenue by period.
- For annual subscriptions: amortise across 12 months on
  `1/12 * total` schedule, posting DR 2050 Deferred Revenue / CR 4000
  Subscription Revenue.
- Persist a `recognition_schedules` table to track remaining balance
  per source invoice.

### 3. Trial-balance generator
- `GET /api/founder/accounting/trial-balance?asOf=YYYY-MM-DD`
- Aggregates `SUM(debit) - SUM(credit)` per account up to `asOf`.
- Returns by account-type, with debit-side / credit-side totals that
  must net to zero (sanity check; surface a 500 with diagnostic if
  not).
- UI surface: founder dashboard `/founder/accounting/trial-balance`.

### 4. GL-PDF export
- `GET /api/founder/accounting/general-ledger.pdf?from=&to=`
- Per-account drilldown with running balance.
- Uses the same PDF stack as 1099 generator
  (`server/services/pdfGenerator.ts`).

### 5. IIF / QBO journal export
- `GET /api/founder/accounting/journal.iif?from=&to=`
- `GET /api/founder/accounting/journal.qbo?from=&to=` (OFX-flavoured)
- Maps AcreOS accountType → QBO account type taxonomy.
- Customer-defined `accountNumber` is preserved verbatim so importing
  back into QBO is lossless.

### 6. UI
- `client/src/pages/founder/accounting/ChartOfAccounts.tsx` — tree view
  with rename / reparent / activate-deactivate.
- `client/src/pages/founder/accounting/JournalEntry.tsx` — manual entry
  form with debit/credit balance check before submit.

## Out of scope (later)

- Multi-currency. Single-org single-currency for v1.
- Period close + lockout. Trial-balance is read-only in Week 10; locks
  ship in Week 12.
- Audit-log integration. Already covered by the global `audit_events`
  table — wire on touch.

## Foundation already shipped (Week 6)

- `migrations/0042_chart_of_accounts.sql`
- `shared/schema.ts` — `chartOfAccounts`, `accountLedgerEntries`,
  relations, insert schemas, `AccountType` union.
- `server/services/chartOfAccountsSeed.ts` —
  `seedChartOfAccountsForOrg(orgId)`, idempotent, 15 default accounts.
- Wired into `storage.createOrganization` so every new org boots with a
  default chart.
- `tests/unit/chartOfAccountsSeed.test.ts` — verifies seed produces 15
  accounts and that the debit-XOR-credit constraint shape is enforced.
