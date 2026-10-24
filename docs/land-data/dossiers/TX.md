# TX — Texas — no beachhead county verified

> **Draft dossier (D2a, 2026-10-24).** Status: **unresolved**. Nothing here permits ingest; the build stays dry-run only until every use class is resolved from the terms' own words. No license is inferred.

## Source in code

- **None.** TX has no statewide row in `STATEWIDE_PARCEL_ENDPOINTS` and **no verified beachhead county**.
- `TX_BEACHHEAD_COUNTIES` in `server/services/landData/statewideCadastral.ts` is **empty**, with its reason; every TX build (`buildSpecFor("TX")`, and `streamCounty`/`buildCounty` with any hand-built TX spec) refuses with that reason before any request is made (`tests/unit/txBeachhead.test.ts`).
- Nothing is faked: no county is listed to make TX look covered.

## What this session tried (2026-10-24)

- `WebFetch` to the state host: **failed** (`getaddrinfo ENOTFOUND` — the build
  container's network policy does not reach state hosts). No page of terms was
  fetched, so **this dossier contains no verbatim terms quote.**
- `WebSearch` (search-engine result listing only): returned the candidate
  URLs below. A search summary is not the source's words and is **not a
  reading**; nothing below is quoted from it, and no use class is resolved from it.

## Use classes — every one UNRESOLVED

| Use class | Status | What would resolve it |
|---|---|---|
| internal (keep a copy in our bucket / database) | unresolved — not read | the terms' own words permitting a copy to be stored and used commercially |
| display (show parcel attributes, incl. owner names, to customers) | unresolved — not read | words permitting public/commercial display; any owner-name or PII restriction |
| redistribution (customer exports, shared artifacts) | unresolved — not read | words permitting onward distribution, and its conditions (attribution, metadata unmodified) |
| resale (selling the data or derived records) | unresolved — not read | an explicit commercial-resale permission or prohibition |

A use class is resolved only by the terms' own words, read and dated by a
person or a session that can reach the host — never inferred from "free",
"public", a portal's tone, or another state's terms.

## Candidate pages to read (URLs from search results — not read, not verified)

- https://www.geographic.texas.gov/stratmap/land-parcels.html — TxGIO StratMap land parcels page / FAQ.
- https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer — a "most recent" statewide StratMap parcel service (a compilation from appraisal districts and their vendors).

## Exactly what must be read to resolve

1. TxGIO's StratMap land-parcel terms, and whether the compilation passes on each **appraisal district's / vendor's** conditions (the data is created by appraisal districts or their third-party vendors).
2. For each candidate beachhead county: that county appraisal district's own GIS terms, and a live check of its service (object-id, county scope, field names) — a county joins `TX_BEACHHEAD_COUNTIES` only with both.
3. Owner-name display rules for Texas appraisal data, if the terms reference any statute.
