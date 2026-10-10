# W2 — Land-data foundation, Tennessee showcase (2026-10-10)

What was built, what is real versus a fixture, what each source's terms allow,
and what still needs a person. Written by the W2 build session; every number
below was measured in that session.

## Sources and their terms (read 2026-10-10)

| Source | Used for | Terms, as read | May AcreOS store it? |
|---|---|---|---|
| TNMap "Tennessee Property Boundaries Public Use" feature service (2,141,289 parcels, 86 counties) | the existing live point lookup; the 20-parcel accuracy sample | Item description: "This service is not intended for commercial use. For commercial purposes, we recommend that you download the data at the Tennessee Comptroller of the Treasury's webpage." | **No.** Registered as `redistributable: "no"`. |
| TN Comptroller per-county parcel download (shapefile + Assessment_Data dbf) | the production showcase input | "The shapefile data can be used in a commercial application." Form-gated; "we do not offer … any recurring extracts or other automated downloads". | **Yes, with attribution** — but a person downloads each county. |
| Census TIGERweb (roads, places, counties) | frontage, access, distance to town, county list | Public domain | Yes |
| USFWS NWI wetlands | buildable acres | Public domain | Yes |
| FEMA NFHL (flood zones, FIRM panels) | buildable acres | Public domain | Yes |
| USGS 3DEP 1/3 arc-second COGs (range reads) | slope | Public domain | Yes |
| USGS PAD-US 4.1 (Fee Managers) | public-land adjacency | Public domain | Yes |
| HIFLD transmission lines | distance to power | HIFLD Open discontinued Aug 2025; the copies online are archived Living Atlas items under the **Esri Master License Agreement** | **Refused** — the fact reports unavailable with the reason. |
| HUD Fair Market Rents API | national dataset | Public domain; needs a free HUD USER token | Yes, once the token is set |
| Census ACS API | national dataset | Public domain; the API now rejects keyless calls ("Missing Key") | Yes, once CENSUS_API_KEY is set |
| LEHD LODES 8 (2023 WAC) | jobs by county | Public domain | Yes |
| TDOT Traffic Points | TN traffic counts | "Classified for Public use, Open Data" | Yes, with attribution |
| FEMA RAPT Mobile Home Parks | manufactured-home parks | "None (Public Use)" | Yes |
| OpenFreeMap (vector basemap) | maps | OSM/OpenMapTiles, ODbL attribution | Tiles only (Produced Work) |
| USGS The National Map NAIP imagery | maps, static aerials | Public domain | Yes |
| AWS terrain tiles (terrarium) | 3D terrain, hillshade, contours | Open data, attribution | Yes |

robots.txt was checked for the hosts fetched in bulk (comptroller.tn.gov allows
all; lehd.ces.census.gov disallows nothing). Every source is in
`server/services/providers/data-licenses.ts`.

## Network access in the build session

Outbound HTTPS through the session proxy reached every source above. Blocked or
refused: `gis.apfo.usda.gov` (no response), the NAIP ImageServer *tile*
endpoint (404 — the cached USGSImageryOnly tiles and the NAIP exportImage
endpoint both work), the Census API without a key, HUD without a token,
shelbycountytn.gov / azwater.gov / agriculture.ks.gov (HTTP 403 to automated
requests).

## What landed for real, and what is a fixture

- **Real, committed:** the county source census for all 95 TN counties
  (`shared/landData/countySourceCensus.tn.json`), the simplified TN county
  shapes for the coverage map, the 20-parcel labelled accuracy sample.
- **Real, local only (deleted at the end of the session):** a GeoParquet
  (20 rows, 197,817 bytes, read back by parquetjs-lite AND independently by
  pyarrow + shapely) and a PMTiles archive (43 tiles, z10–15, read back with
  the `pmtiles` reader the client uses), built by
  `scripts/land-data/build-tn-showcase.ts --sample …` from the 20 sample
  parcels with live context layers.
- **Not landed:** no bytes in any bucket. The corpora manifest therefore still
  reports `not_provisioned` for every corpus — the new `ingested` status is
  reachable only through a bucket-confirmed upload receipt.

## The accuracy gate

`tests/unit/landDataAccuracyGate.test.ts` recomputes every fact on the sample
and compares it with labels the publishing servers produced themselves
(ArcGIS spatial queries with the parcel polygon and a metre buffer; USGS EPQS
elevations). Measured on 2026-10-10:

| Fact | Agreed | Shown to customers |
|---|---|---|
| Road frontage | 20 / 20 | yes |
| Road access (indication) | 20 / 20 | yes |
| Buildable acres | 19 / 20 (one wetland sliver under the 10 m sample grid) | yes |
| Next to public land | 20 / 20 | yes |
| Distance to the nearest town | 20 / 20 | yes |
| Distance to a transmission line | no sample (source refused on terms) | **no** |
| Out-of-state owner | no sample (needs the Comptroller roll) | **no** |

Sample strata: 4 parcels within 30 m of public land, 1 intersecting a 1% flood
zone (only one ≥ 2-acre parcel in the sample box did), 4 with no access road,
11 by hash order. The flood check therefore rests on a single positive — a
larger county run should add more before the flood component is trusted on
its own.

## Mutation record (each run, then reverted)

| Mutation | Gate | Result |
|---|---|---|
| Frontage tolerance 20 m → 2 m | accuracy gate | red (2 tests) |
| Mark out-of-state owner "passed" with no sample | accuracy gate | red (3) |
| Route serializer bypasses the projection | accuracy gate | red (1) |
| Public-land adjacency 30 m → 300 m | accuracy gate | red (1) |
| Slope ×0.1 | accuracy gate | red (1) |
| Pipeline ignores the row's redistributable posture | pipeline | red |
| Upload skips the HEAD byte check | pipeline | red |
| Pipeline ignores the licence register | pipeline | red |
| Crosswalk area tolerance 2% → 90% | pipeline | red |
| WKB writes x twice | pipeline | red (2) |
| Census coverage claims storable for any source | registries | red |
| TN public service made redistributable | registries | red |
| Easements warning dropped | registries | red |
| HUD refusal removed | registries | red (2) |
| Alignment tolerance 0.15 → 0.5 | registries | **green at first** — the test derived its input from the constant; rewritten with fixed numbers, then red |
| Receipt validity always true | corpora | red |
| Any receipt counts for every corpus | corpora | red |
| EDDM map back on mapbox:// | map engine | red |
| Subdivision editor imports mapbox-gl | map engine | red |

Failing tests that found real defects first: the accuracy registry's stale
counts (claimed 14/14, measured 20/20 and 19/20), and the shapefile reader's
inverted ring orientation (holes read as separate polygons).

## Founder actions

1. **Create the open-data bucket** (Cloudflare R2 recommended) and set
   `OPEN_DATA_BUCKET_ENDPOINT`, `_NAME`, `_ACCESS_KEY_ID`, `_SECRET`.
2. **Download the Comptroller county files** (form at the parcel-data page;
   no automated downloads are offered), starting with the showcase counties,
   then run `build-tn-showcase.ts --comptroller <dir>` with the
   Assessment_Data field names for mailing state and improvement value from
   the download's own field dictionary. That run produces the real artifacts,
   the out-of-state-owner sample, and (with the bucket set) the receipts.
3. **Confirm the reading of the Comptroller terms** ("can be used in a
   commercial application") — registered as attribution-required.
4. **Decide on the existing TN live point lookup**, which uses the service the
   state marks not for commercial use (a pre-W2 seam).
5. **Free keys:** `HUD_USER_API_TOKEN` and `CENSUS_API_KEY`.
6. **Distance to power:** choose a source with open terms (none wired).
