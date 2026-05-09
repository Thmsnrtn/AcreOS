# Fix-and-Flip vertical schema

ARV calc + rehab budget + contractor management.

## Core tables

| Table | Purpose |
|---|---|
| `fix_flip_projects` | Project per property. |
| `rehab_budgets` | Line-item rehab estimates. |
| `rehab_actuals` | Actual costs as work progresses. |
| `construction_draws` | Draw schedule + status. |
| `contractors` | Contractor directory. |
| `contractor_invoices` | Per-contractor invoice tracking → 1099-NEC. |
| `arv_assessments` | After-repair value estimates. |

## FK relationships within FF

```
fix_flip_projects ─→ rehab_budgets
                ↓
              rehab_actuals
                ↓
            construction_draws
                ↓
            contractor_invoices ─→ contractors
                                       ↓
                                  form1099NecPdf
```

## Cross-vertical join points

- `fix_flip_projects.property_id` → `properties.id` (Land)
- `contractors.organization_id` → `organizations.id`
- `contractor_invoices.contractor_id` → `contractors.id`
- `arv_assessments.property_id` → `properties.id`

## Known cliffs

- **1099-NEC generator** lives at `server/services/form1099NecPdf.ts`.
  FF-3 era. Audited against Olympia §1 critique post-shipping.
- **Hallucination detector** (panel-300 #7) checks ARV-vs-comp
  reasonableness — proposed ARV ±50% off comp median flags.
- **No GAAP-shaped recognition** for project profit; uses
  cash-basis (revenue at close, costs as incurred). Real GAAP
  shape would require WIP ledger, deferred until reqs surface.

## Migration history pointers

- FF-1 (project + rehab tables).
- FF-3 (1099-NEC generator + signed-form hash).
- panel-300 #7 (ARV hallucination detector).
