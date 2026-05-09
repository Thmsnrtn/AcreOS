# Subdivision vertical schema

Lot subdivision, CC&R templates, permit tracking.

## Core tables

| Table | Purpose |
|---|---|
| `subdivision_plans` | Plan per parent property. |
| `subdivision_lots` | Per-lot rows after split. |
| `ccr_templates` | Per-state CC&R templates. |
| `permit_tracker_entries` | Per-permit status + dates. |
| `lot_pricing_calc` | Pricing by lot attributes. |

## FK relationships within SD

```
subdivision_plans ─→ subdivision_lots
       ↓
permit_tracker_entries
       ↓
ccr_templates (template registry, not FK)
       ↓
lot_pricing_calc
```

## Cross-vertical join points

- `subdivision_plans.parent_property_id` → `properties.id` (Land)
- `subdivision_lots.id` → can become `properties.id` after recording

## Known cliffs

- **Per-state subdivision rules** (minimum lot size, road
  requirements, septic requirements) are NOT in the schema today;
  operator validates per-state requirements out-of-band.
- **CC&R templates require attorney review** (`attorneyReviewedAt`
  on ccr_templates) before dispatch. Pattern matches
  wholesalerStateRules + lateFeeRules.
- **Lot pricing is heuristic, not algorithmic.** Operator inputs
  base price + multipliers; no comp-driven valuation yet.

## Migration history pointers

- SD-1, SD-2 (subdivision plan, lots, CC&R).
- subdivision_plans.attorneyReviewedAt added with attorney review
  workflow.
