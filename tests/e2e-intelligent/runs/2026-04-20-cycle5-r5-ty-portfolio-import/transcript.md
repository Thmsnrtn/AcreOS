# Cycle 5 r5 — Ty Holcomb × Portfolio Import & Review

- **Run ID**: 2026-04-20-cycle5-r5-ty-portfolio-import
- **Persona**: 06-raw-land-flipper (Ty Holcomb)
- **Journey**: 05-portfolio-import-and-review (not previously tested)

## Journey objective

Upload a CSV of existing portfolio properties, map columns, confirm import count, review inventory.

## Observations

### Observation 1 — Import flow exists

- /properties top bar has "Import CSV" button (visible in all prior cycle-3 runs).
- Dialog opens on click with file-picker + field mapping UI (verified via DOM walk, not fully exercised this run).

### Observation 2 — Scale concern

- r2 Dana (cycle 3) flagged "Fetch parcel data to enable comps" as a per-row friction. The cycle-4 fix updated the hint to point at the bulk Fetch Boundaries action. Ty's 500-row use case benefits from the same bulk action.
- Not verified at 500-row scale this session.

### Observation 3 — Column mapping

- Not exercised. For Ty's PropStream-shaped CSVs, the critical columns are: APN, owner_name, owner_mailing_address, acreage, assessed_value, last_sale_price, land_use_code. The cycle-4 merge-variable expansion (now exposing assessedValue/marketValue/acreage/landUseCode/lastSalePrice/ownerType) means these columns can survive into mail templates if the importer maps them.
- **Unverified this run**: whether the import dialog's field mapping exposes all the new merge-variable-compatible columns.

## Verdict

- **Outcome**: **UNVERIFIED_PARTIAL** (journey is reachable, not fully exercised)
- **Would Recommend**: n/a — deferred to cycle 6 with a seeded 500-row CSV
- **Reasoning**: Ty's scale-flow requires a 500-row CSV to meaningfully test, which wasn't set up for this cycle. Foundation exists; full verification parked.

## Top issues

- WF-R5-CYC5-001 verification — bulk import at 500+ rows + column mapping coverage for the expanded merge variables not exercised. Flag for cycle 6.
