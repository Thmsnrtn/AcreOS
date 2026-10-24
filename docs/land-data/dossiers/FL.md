# FL — Florida DOR statewide cadastral (D1 golden source)

> **Draft dossier (D2a, 2026-10-24).** Status: **unresolved**. Nothing here permits ingest; the build stays dry-run only until every use class is resolved from the terms' own words. No license is inferred.

## Source in code

- Endpoint: `https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer` layer `0` —
  `server/services/statewideParcelEndpoints.ts` (verified live 2026-07-13).
- Field map (seeded): `PARCEL_ID`, `OWN_NAME`, `PHY_ADDR1`, `AV_NSD`, `JV`, `SALE_PRC1`, `S_LEGAL`.
- Build: `fl_statewide_cadastral_v1` (0287, inactive, `dryRun: true`). Cadence: annual, published each August (D1 package).
- Source URL: `https://geodata.floridagio.gov/datasets/FGIO::florida-statewide-parcels/about`; terms URL in code: `https://floridarevenue.com/property/Pages/Cofficial_GIS.aspx`.

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

## Candidate pages to read (URLs from search results — not read)

- https://www.floridarevenue.com/property/Pages/Cofficial_GIS.aspx — DOR "GIS and Cadastral Mapping" (terms URL in code).
- https://floridarevenue.com/property/Documents/new_map_guidelines.pdf — DOR cadastral mapping guidelines.
- https://geodata.floridagio.gov/datasets/FGIO::florida-statewide-parcels/about — FGIO dataset page (license field).

## Exactly what must be read to resolve

1. The FGIO dataset page's license text and the DOR page, verbatim.
2. Any Chapter 119, F.S. confidentiality condition attached to the compiled roll (a search listing indicates the hosted service descriptions ask users to report inadvertently released exempt records) — this bears directly on owner-name display.
3. Whether county property appraisers' own terms survive into the DOR compilation.
