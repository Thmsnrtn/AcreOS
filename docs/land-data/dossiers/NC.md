# NC — NC OneMap statewide parcels

> **Draft dossier (D2a, 2026-10-24).** Status: **unresolved**. Nothing here permits ingest; the build stays dry-run only until every use class is resolved from the terms' own words. No license is inferred.

## Source in code

- Endpoint: `https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer` layer `1` (polygons) —
  `server/services/statewideParcelEndpoints.ts` (verified live 2026-07-13 by point query).
- Field map (seeded): `parno` (apn), `ownname`, `siteadd`, `gisacres`, `parval`, `legdecfull`, `saledate`.
- Build: `nc_statewide_cadastral_v1` (migration 0288, inactive), `buildSpecFor("NC")`.
- Terms URL in code: `https://www.nconemap.gov/pages/parcels` (also the source URL).

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

- https://www.nconemap.gov/pages/parcels — the terms URL in code.
- https://it.nc.gov/documents/gicc/gicc-nconemap-disclaimer-20220511pdf/open — an NC OneMap disclaimer document.
- https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer/1/iteminfo?f=pjson — the layer's item info (license / access-constraints fields).
- https://it.nc.gov/documents/files/nc-parcels-brief/open — NC parcels program brief.

## Exactly what must be read to resolve

1. The NC OneMap parcels page and the disclaimer document above, in full — for any statement on commercial use, resale or redistribution.
2. The layer's `iteminfo` `licenseInfo` / `accessInformation` fields.
3. **N.C.G.S. § 132-10** (public records — geographical information systems), which the search listing indicates the disclaimer cites: whether a county may condition an electronic copy on a written promise not to resell or use it for trade or commercial purposes, and whether any NC county has done so for the data compiled here. The statute text itself must be read; nothing here relies on the search summary.
4. Whether the compiled layer inherits per-county conditions (it is a compilation of county data).
