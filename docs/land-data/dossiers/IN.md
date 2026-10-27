# IN — Indiana statewide parcels (IndianaMap / IGIO)

> **Draft dossier (D2a, 2026-10-24).** Status: **unresolved**. Nothing here permits ingest; the build stays dry-run only until every use class is resolved from the terms' own words. No license is inferred.

## Source in code

- **None seeded.** IN has no row in `STATEWIDE_PARCEL_ENDPOINTS`; `buildSpecFor("IN")` refuses
  ("no verified statewide layer"), pinned by `tests/unit/statewideCadastral.test.ts`.
- No endpoint, field map or terms URL is in code. Nothing below is a verified endpoint.

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

- https://gisdata.in.gov/server/rest/services/Hosted/Parcels_Boundaries_of_Indiana_2013/FeatureServer?f=pjson — a hosted statewide parcel-boundaries service (the name says 2013; currency unknown).
- https://secure.in.gov/gis/files/92_of_92_GIO_Press_Release.pdf — IGIO press release on county data sharing.
- IndianaMap / Indiana GIO data portal pages (no specific terms URL found).

## Exactly what must be read to resolve

1. The current IndianaMap parcel dataset's own page and its license / use-constraints text.
2. The county–state **data-sharing agreements** under which the 92 counties contribute parcels — they govern what the state may pass on, and are referenced but not quoted anywhere found.
3. A live check of the layer: current vintage, object-id field, county field, and which fields carry owner / value attributes (if any) — required before a seed row exists.
