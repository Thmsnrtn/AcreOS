# Note Investor vertical schema

The second-easiest GTM (Caspar's wedge). Land + Notes is the panel-300
D2 default recommendation.

## Core tables

| Table | Purpose |
|---|---|
| `notes` | Note instruments. One row per note (principal, rate, term, dates). |
| `note_payments` | Payment history per note. |
| `note_amortization_schedules` | Generated schedules (per-note, per-event). |
| `notes_documents` | Note-related documents (lender statements, payoff). |
| `notes_holders` | Multi-holder note ownership (joint ventures). |

## FK relationships within Notes

```
notes ─→ note_payments
   ↓
note_amortization_schedules
   ↓
notes_documents
```

Each `notes` row optionally links back to a `deals.id` (Land) when the
note was originated through an AcreOS-managed seller-financed sale.

## Cross-vertical join points

- `notes.deal_id` → `deals.id` (Land)
- `notes.organization_id` → `organizations.id` (cross-cutting)
- `notes.id` → `legal_holds_scope.entity_id` when entity_type='note'

## Known cliffs

- **Amortization library lives in `client/src/lib/amortization.ts`**
  but is consumed server-side too. FW-WENDELL-1 caught two real
  rounding bugs in this code via the 1,000-sched paranoia test.
  ANY edit to that file MUST re-run the paranoia test
  (`npx vitest run tests/unit/amortizationParanoia.test.ts`).
- **`notes.amount_financed` vs `notes.principal_balance`** — the
  former is original loan amount; the latter is current balance.
  P&L surfaces (multi-vertical P&L, founder/financials) coerce to
  current-balance for run-rate math.
- **No 1098/1099-INT auto-generation yet.** RS-9 is deferred until
  customer ask. When it lands, hooks into existing
  `form1099NecPdf.ts` shape.

## Migration history pointers

- NI-* commits (early Note Investor work).
- FW-WENDELL-1 — bug fixes in amortization library.
- panel-300 #22 — multi-vertical P&L that aggregates note revenue.
