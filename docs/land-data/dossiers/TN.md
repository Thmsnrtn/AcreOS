# TN — Tennessee — Comptroller per-county download (county by county)

> **Draft dossier (D2a, 2026-10-24).** Status: **unresolved**. Nothing here permits ingest; the build stays dry-run only until every use class is resolved from the terms' own words. No license is inferred.

## Source in code

- **No statewide source may be used.** The TNMap "Tennessee Property Boundaries Public Use" service is non-commercial and blocked on every fetch (founder decision 2026-10-11; `server/services/landData/tnParcelSources.ts`, `blockedOutboundSources.ts`). That is why the TN path is county by county — `resolveTnCounty()` in `server/services/landData/tnComptrollerCounty.ts` refuses every statewide request.
- The storable source: the **Comptroller per-county shapefile download** — page
  `https://comptroller.tn.gov/office-functions/pa/gisredistricting/redistricting-and-land-use-maps/parcel-data.html`
  (`TN_COMPTROLLER_DOWNLOAD`), offered through a request form, no automated or recurring extracts. Loader: `scripts/land-data/build-tn-showcase.ts --comptroller <dir>`.
- Nine counties maintain their own parcels and are not in the download (Chester, Davidson, Hamilton, Hickman, Knox, Montgomery, Rutherford, Shelby, Williamson) — each needs a county-direct source.

## What the repo already records (not re-read this session)

`tnParcelSources.ts` records the download page's sentence *"The shapefile data
can be used in a commercial application."* (terms read 2026-10-10, earlier
session), and `countySourceCensus.tn.json` marks the source `mayStore: true`,
`verification: terms_read`. This session could not reach `comptroller.tn.gov`
(`ENOTFOUND`) and did not re-read it.

## Use classes

| Use class | Status | Note |
|---|---|---|
| internal | resolved in repo (earlier session, 2026-10-10) — not re-read here | "can be used in a commercial application" is the recorded basis for `mayStore: true` |
| display | **unresolved** | the recorded sentence does not address public display of the Assessment_Data owner fields; the showcase PMTiles carries no owner fields |
| redistribution | **unresolved** | not addressed by the recorded sentence |
| resale | **unresolved** | not addressed by the recorded sentence |

## What this session tried (2026-10-24)

- `WebFetch` to the state host: **failed** (`getaddrinfo ENOTFOUND` — the build
  container's network policy does not reach state hosts). No page of terms was
  fetched, so **this dossier contains no verbatim terms quote.**
- `WebSearch` (search-engine result listing only): returned the candidate
  URLs below. A search summary is not the source's words and is **not a
  reading**; nothing below is quoted from it, and no use class is resolved from it.

## Exactly what must be read to resolve

1. The full Comptroller parcel-data page and the request form's own terms/acknowledgement text, verbatim, dated — especially anything on redistribution, resale, or owner/PII fields.
2. The download's field dictionary (it names the Assessment_Data mailing-state and improvement-value fields the loader requires as flags — never guessed).
3. For each of the nine self-maintained counties: that county's own terms (the county source census tracks them).
