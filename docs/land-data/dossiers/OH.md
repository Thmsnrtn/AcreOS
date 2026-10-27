# OH — Ohio statewide parcels (OGRIP / ODNR)

> **Draft dossier (D2a, 2026-10-24).** Status: **unresolved**. Nothing here permits ingest; the build stays dry-run only until every use class is resolved from the terms' own words. No license is inferred.

## Source in code

- **None seeded.** OH has no row in `STATEWIDE_PARCEL_ENDPOINTS`; `buildSpecFor("OH")` refuses, pinned by `tests/unit/statewideCadastral.test.ts`.
- No endpoint, field map or terms URL is in code.

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

- https://gis1.oit.ohio.gov/geodatadownload/ — OGRIP geodata download site.
- https://gis.ohiodnr.gov/arcgis/rest/services/OIT_Services/odnr_landbase_v2/MapServer/4/iteminfo?f=pjson — an ODNR "statewide parcels" item (search listing indicates a blank license field; must be confirmed by reading).
- https://www.co.fairfield.oh.us/auditor/pdf/PRESS-OGRIP-02.01.24.pdf — a county press release about the OGRIP parcel program.

## Exactly what must be read to resolve

1. The OGRIP statewide parcel program's published terms (if any) and the download page's license text.
2. The ODNR statewide-parcels item's `licenseInfo` and access constraints.
3. Whether the program's distribution is limited to "county and state stakeholders" (a search listing suggests this) — if so, no public use class can be resolved from it.
4. Per-county auditor terms, where the state compilation defers to them.
