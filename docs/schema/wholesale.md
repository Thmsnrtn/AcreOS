# Wholesale vertical schema

Assignment contracts, double-close, buyer-match.

## Core tables

| Table | Purpose |
|---|---|
| `wholesaler_state_rules` | State-specific assignment legality + license requirements. |
| `assignment_contracts` | Active assignments. |
| `buyer_pool_entries` | Buyers + criteria. |
| `buyer_matches` | Match candidates per deal. |
| `double_close_workflows` | Same-day double-close orchestration. |

## FK relationships within W

```
deals ─→ assignment_contracts
   ↓
buyer_matches ←─→ buyer_pool_entries
   ↓
double_close_workflows
```

## Cross-vertical join points

- `assignment_contracts.deal_id` → `deals.id` (Land)
- `buyer_pool_entries.organization_id` → `organizations.id`

## Known cliffs

- **`wholesaler_state_rules` is the SINGLE GATE** for assignment
  legality. Routes that generate assignment contracts MUST call
  `checkAssignmentCompliance(state)` from `routes-wholesaler-rules.ts`
  before doc generation. Block on `result.blocked`; warn (with ack)
  on `result.warn`.
- **Some states require licensing** (TX REC license, OH SB 217,
  IL B 2107) — block path. Other states allow with warnings (NV,
  PA, FL with caveats) — warn path.
- **Double-close workflow** is multi-step + multi-party + multi-
  document. State machine lives in code; rollback is manual.

## Migration history pointers

- W-1 (state-rule registry + dispatch gate).
- W-2 era (buyer-match, double-close).
- panel-300 — no W-specific changes; wholesale is feature-frozen
  per Caspar's wedge default (D2 RFC).
