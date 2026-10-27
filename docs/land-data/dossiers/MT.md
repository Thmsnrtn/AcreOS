# MT — Montana Cadastral (MSDI, Montana State Library)

> **Draft dossier (D2a, 2026-10-24).** Status: **unresolved**. Nothing here permits ingest; the build stays dry-run only until every use class is resolved from the terms' own words. No license is inferred.

## Source in code

- Endpoint: `https://gisservicemt.gov/arcgis/rest/services/MSDI_Framework/Parcels/MapServer` layer `0` —
  `server/services/statewideParcelEndpoints.ts` (verified live 2026-07-13).
- Field map (seeded): `PARCELID`, `OwnerName`, `AddressLine1`, `GISAcres`, `TotalValue`, `LegalDescriptionShort`.
- Build: `mt_statewide_cadastral_v1` (0288, inactive). Cadence: monthly (D1 package).
- Terms URL in code: `https://msl.mt.gov/geoinfo/msdi/cadastral/`.

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

## Candidate pages to read

- https://msl.mt.gov/geoinfo/msdi/cadastral/ — the terms URL in code (not reached).
- The layer's own `iteminfo` (`.../MSDI_Framework/Parcels/MapServer/0/info/iteminfo`) — license / use constraints (not reached).

## Exactly what must be read to resolve

1. The MSDI Cadastral page and the layer metadata's use constraints, verbatim.
2. Montana Department of Revenue terms for the ORION appraisal attributes the layer carries (owner names, values) — the attributes come from DOR, so DOR's conditions may govern display and resale separately from the geometry.
3. Whether county-maintained counties (the search listing names several) carry their own terms.
