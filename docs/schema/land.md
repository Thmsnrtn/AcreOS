# Land vertical schema

The wedge product. Most of AcreOS history lives here.

## Core tables

| Table | Purpose |
|---|---|
| `leads` | Acquisition pipeline. One row per lead (seller, address, contact). |
| `properties` | Parcels. One row per parcel (apn, county, acres). |
| `deals` | Active deals. One row per deal (lead → property → offer). |
| `offers` | Offer history per deal (cash / terms / counter). |
| `comps` | Comparable sales for valuation. |
| `mailers` | Direct-mail campaigns. |
| `mailer_recipients` | Per-recipient mailer state. |
| `auction_readiness_checklists` | Pre-close auction sign-offs (panel-300 #30). |
| `cma_reports` | Comp-set composition + valuation low/mid/high (panel-300 #30). |
| `lien_search_records` | Per-property lien-type registry (panel-300 #30). |

## FK relationships within Land

```
leads ←─ deals ─→ properties
            ↓
         offers
            ↓
   subdivision_plans (cross-vertical: SD)
```

## Cross-vertical join points

- `properties.id` → `rental_leases.property_id` (BH)
- `properties.id` → `auction_readiness_checklists.property_id`
- `properties.id` → `lien_search_records.property_id`
- `properties.id` → `cma_reports.property_id`
- `deals.id` → `notes.deal_id` (NI seller-financing)
- `deals.id` → `disclosure_timing_scheduled.deal_id` (panel-300 #10)

## Known cliffs

- **`leads.address` is unstructured text.** No street/city/state/zip
  decomposition; downstream geocoding (Mapbox/Regrid) re-parses on
  every read. A normalize migration is in the panel-300 90-day
  backlog (#90-9 carries map-default).
- **`deals.cashOffer` and `deals.assignmentFee` are numeric strings**
  (Drizzle `numeric()`). Multi-vertical P&L (panel-300 #22) coerces
  to cents at read time.
- **`comps` does not link back to `cma_reports`** — comps are picked
  per-CMA via `cma_reports.comp_ids` jsonb. Reverse-lookup ("which
  CMAs cite this comp?") requires a jsonb path query.

## Migration history pointers

- 0001 — initial leads/properties.
- 0017 — Drizzle journal cutoff (panel-300 T12 flagged).
- 254c9838 — landStatus column (P0-18 LAR overlay).
- FW-WENDELL-1 — note-ledger paranoia test exposed amortization
  drift (client/src/lib/amortization.ts).
- panel-300 #30 — cma_reports + auction_readiness_checklists +
  lien_search_records.
