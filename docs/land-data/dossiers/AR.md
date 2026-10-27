# AR — Arkansas CAMP parcel polygons (Arkansas GIS Office)

> **Draft dossier (D2a, 2026-10-24).** Status: **unresolved**. Nothing here permits ingest; the build stays dry-run only until every use class is resolved from the terms' own words. No license is inferred.

## Source in code

- Endpoint: `https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer` layer `6` (PARCEL_POLYGON_CAMP) —
  `server/services/statewideParcelEndpoints.ts` (verified live 2026-07-13).
- Field map (seeded): `parcelid`, `ownername`, `adrlabel`, `assessvalue`, `totalvalue`, `parcellgl`.
- Build: `ar_statewide_cadastral_v1` (0288, inactive). Cadence: semi-annual (D1 package, `statewideSourceRegistry.ts`).
- Terms URL in code: `https://gis.arkansas.gov/` (a site root, not a terms page).

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

- https://gis.arkansas.gov/metadata/HTML/asdi.planning_cadastre.PARCEL_POLYGON_CAMP_export.html — the layer's metadata (use constraints).
- https://gis.arkansas.gov/product/parcel-polygon-county-assessor-mapping-program-polygon/ — the product page (source URL in code).
- https://gis.arkansas.gov/?p=27755 — "Data Description".

## Exactly what must be read to resolve

1. The CAMP polygon metadata's **Use Constraints / Access Constraints** sections, verbatim.
2. The Arkansas GIS Office's general data-distribution or terms page (the code's terms URL is only the site root — the real page must be found and recorded).
3. **Ark. Code Ann. § 15-21-504**, which the search listing indicates the metadata cites (digital cadastral data is not a legal boundary) — confirm whether it says anything about commercial use, or only about legal-boundary reliance.
