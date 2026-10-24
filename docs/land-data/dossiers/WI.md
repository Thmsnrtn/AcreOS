# WI — Wisconsin Statewide Parcel Map Initiative (V12)

> **Draft dossier (D2a, 2026-10-24).** Status: **unresolved**. Nothing here permits ingest; the build stays dry-run only until every use class is resolved from the terms' own words. No license is inferred.

## Source in code

- Endpoint: `https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels_DB/FeatureServer` layer `0` —
  `server/services/statewideParcelEndpoints.ts` (verified live 2026-07-28 via the discovery pipeline).
- Field map (seeded): `PARCELID`, `OWNERNME1`, `SITEADRESS`, `DEEDACRES`, `CNTASSDVALUE`, `ESTFMKVALUE`, `NETPRPTA`.
- Build: `wi_statewide_cadastral_v1` (0288, inactive).
- Terms URL in code: `https://www.arcgis.com/home/item.html?id=2386813b23ea4e51a009f7d1d6b76e02`.

## What the repo already records (not re-read this session)

The seed comment records the item's license line as *"This data free for public
consumption as of: 06/30/2026"* (reviewed 2026-07-28 by an earlier session).
This session did **not** read it. Even as recorded, "free for public
consumption" does not by its words decide commercial storage, display of owner
names, redistribution or resale — so it resolves no use class here.

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

- https://www.arcgis.com/home/item.html?id=2386813b23ea4e51a009f7d1d6b76e02 — the item (terms URL in code).
- https://sco.wisc.edu/parcels/data/assets/V12/V12_Wisconsin_Statewide_Parcels_Schema_Documentation.pdf — V12 schema documentation.
- https://doa.wi.gov/DIR/V12_Final_Report.pdf — V12 final report.
- https://www.sco.wisc.edu/parcels/data/ — SCO parcels data page.

## Exactly what must be read to resolve

1. The item page's full description, `licenseInfo` and "Terms of Use" sections, verbatim, dated.
2. The V12 final report / SCO data page for any statement on commercial use or redistribution.
3. The WLIP statute behind the statewide parcel map (Act 20 of 2013; the section number is not recorded in this repo — find it from the program page), only if the terms point to it.
