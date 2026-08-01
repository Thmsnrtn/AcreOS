# AcreOS External Data Source Inventory

_Point-in-time inventory of every external data surface in the platform, taken
2026-07-13 as the baseline for `open-data-program.md`. File/line references are a
snapshot — the GAPS list at the bottom is the part that drives the program._

AcreOS has **three parallel data-access layers** that mostly overlap on the same upstreams:

1. **Provider Registry** (`server/services/providers/`) — the "canonical" abstraction with one cache + circuit-breaker + license contract. 5 registered providers.
2. **DataSourceBroker** (`server/services/data-source-broker.ts`) — ~30 hardcoded federal/open GIS endpoints. The registry's `open-data` provider wraps this as its fetch implementation.
3. **Due-Diligence Engine + parcel intelligence fusion** (`server/services/dueDiligenceEngine.ts`, `parcelIntelligenceFusion.ts`) — its *own* direct `fetch()` calls to many of the same federal endpoints, bypassing both the registry and broker.

Plus several standalone enrichment services (zoning, solar, skip-trace) wired directly to routes, not the registry.

---

## 1. Provider Registry (`server/services/providers/`)

Registration + ordering: `server/providers-init.ts`. Order = tier (free→starter→pro→enterprise), then cost, then perf score, then priority. Interfaces in `types.ts`; license/redistribution register in `data-licenses.ts`.

| Provider (machine name) | Category coverage | Free/Paid | Real/Stub | Data returned | Key / config | file:line |
|---|---|---|---|---|---|---|
| **county-gis** | parcel_data, owner_info | Free (priority 5, tried first) | Real (delegates to `parcel.ts:lookupFromCountyGIS`; DB-driven `county_gis_endpoints`) | Parcel of record, owner | none; needs seeded county endpoints | `county-gis-provider.ts:31-146` |
| **open-data** | parcel_data + ~24 env/land sub-kinds (flood_zone, wetlands, soil, tax_assessment, demographics, elevation, natural_hazards, public_lands, transportation, water_resources, climate, agricultural_values, land_cover, cropland, epa_frs, storm_history, plss, watershed, fema_nri, usda_clu, …) | Free (priority 10) | Real — wraps `DataSourceBroker` (federal endpoints) + `parcel.ts` | Env/land layers, demographics, ag values | none (optional keys) | `open-data-provider.ts:33-221` |
| **regrid** | parcel_data (3¢), comps (8¢), owner_info (5¢), valuation (5¢) | Paid, starter (priority 30) | Real — BYOK-first, delegates to `parcel.ts`/`comps.ts` | Parcel geometry, owner, comps, valuation | `REGRID_API_KEY` or org BYOK | `regrid-provider.ts:58-205` |
| **batchdata** | property_details (3¢), skip_trace (15¢), owner_info (5¢) | Paid, starter (priority 40) | Real — direct API `api.batchdata.com/api/v1` | Property details, **skip-trace contacts**, owner | `BATCHDATA_API_KEY` | `batchdata-provider.ts:64-189` |
| **attom** | property_details (5¢), valuation (10¢), comps (20¢), owner_info (8¢), structure (5¢) | Paid, pro (priority 50, most expensive) | Real — direct API `api.gateway.attomdata.com` | Property detail, AVM valuation, comps, owner, structure | `ATTOM_API_KEY` | `attom-provider.ts:117-315` |

Notes:
- Paid providers are governed by a **procurement gate** (2%-of-MRR floor rule; `provider-registry.ts:496-505`) and per-lookup credit metering (`debitPaidLookup`, `:566-597`).
- All three paid feeds are `license: "proprietary"`, `redistributable: "no"` → live-passthrough, never cached to the shared `provider_cache` (`data-licenses.ts:207-233`).
- Skip-trace is classified `"estimate"` not authoritative (`batchdata-provider.ts:143`).

---

## 2. Map Stack (client)

Renderer: `client/src/components/property-map.tsx` + engine config `client/src/lib/map-engine.ts`.

| Concern | Detail | Free/Paid | Key | file:line |
|---|---|---|---|---|
| Basemap engine | **Mapbox GL** default; MapLibre GL behind `VITE_MAP_ENGINE=maplibre` (migration Phase 1 — renderer swap not done) | Mapbox paid; MapLibre/Stadia free | `VITE_MAPBOX_ACCESS_TOKEN` (mapbox) / `VITE_STADIA_API_KEY` (optional) | `map-engine.ts:28-92`, `property-map.tsx:2-45` |
| Mapbox styles | satellite-streets-v12, outdoors-v12, streets-v12; terrain-DEM `mapbox://mapbox.mapbox-terrain-dem-v1` | Paid | Mapbox token | `map-engine.ts:53-58`, `property-map.tsx:1009-1017` |
| MapLibre styles | Stadia alidade_satellite / stamen_terrain / osm_bright | Free | Stadia (optional) | `map-engine.ts:59-75` |
| Static map (PDF/fallback) | Mapbox Static Images API or `staticmap.openstreetmap.de` | Mixed | — | `map-engine.ts:101-132` |

Overlay layers (`LayerState`, `property-map.tsx:644-670`), all free federal/state GIS rasters:

| Layer | Source | URL const | file:line |
|---|---|---|---|
| FEMA Flood Zones | FEMA NFHL MapServer `/export` | `FEMA_NFHL_URL` | `property-map.tsx:52, 1083-1114` |
| Zoning / Land Use | USGS ScienceBase land-use MapServer | `USGS_LAND_USE_URL` | `:53, 1152` |
| USDA Cropland (CDL) | USDA CropScape WMS raster | `USDA_CDL_URL` | `:54` |
| USDA Farm Units (CLU) | USDA common_land_unit MapServer | `USDA_CLU_URL` | `:55` |
| USGS Hillshade | USGS ShadedRelief MapServer | `USGS_HILLSHADE_URL` | `:56` |
| USGS Topo | national map basemap | `USGS_TOPO_URL` | `:57` |
| Terrain contours / hypsometric / slope | Mapbox terrain-DEM | (mapbox) | `:1219, 1833` |
| OSM Buildings | Mapbox vector | (mapbox) | layer state |
| Nearby parcels | AcreOS backend `/api/... parcels` | server | `:1389-1522` |

**Gap in map layers:** there is **no wetlands overlay**, no soil overlay, no aerial-imagery-quality layer, and no risk-index (NRI) overlay on the client map — those datasets are only reachable via the DD engine/broker server-side, not rendered as map layers.

---

## 3. Due-Diligence Engine (`server/services/dueDiligenceEngine.ts`)

Each check makes its **own direct `fetch()`** (not via registry/broker). All free federal/open. One stub.

| Check | Source (real API) | Real/Stub | file:line |
|---|---|---|---|
| Flood zone | FEMA NFHL MapServer/28 query | Real | `:231-295` |
| Wetlands | USFWS NWI ArcGIS MapServer/0 | Real | `:304-372` |
| Environmental hazards | EPA `data.epa.gov/efservice/RCRA_FACILITIES` | Real | `:381-437` |
| Superfund (fallback) | — returns hardcoded zeros | **STUB** | `:439-448` |
| Road access | OpenStreetMap **Overpass API** | Real | `:455-535` |
| Elevation | USGS EPQS `epqs.nationalmap.gov` | Real (single-point; slope "unknown" — can't derive slope) | `:542-580` |
| Soil | USDA SDA `SDMDataAccess.sc.egov.usda.gov` | Real | `:586-629` |
| Land cover | MRLC NLCD WMS GetFeatureInfo | Real | `:640` |
| Public lands | BLM SMA ArcGIS | Real | `:700` |
| Endangered species | USFWS ServCAT `ecos.fws.gov` | Real | `:744` |
| Wildfire risk | FEMA **NRI** county API | Real | `:774-808` |
| Soil SSURGO (detailed: pH, hydric, NCCPI) | USDA SDA `sdmdataaccess.nrcs.usda.gov` | Real | `:816-839` |

`parcelIntelligenceFusion.ts` ("Parcel Fusion") composes DD checks (FEMA/NWI/EPA/OSM/USDA WSS/USGS 3DEP) + USDA NASS land values + Census ACS into one report (`:204-239`); results persisted via `land-intelligence-store`.

---

## 4. GIS Services / county integrations

| Component | Purpose | file:line |
|---|---|---|
| `gisRepo.ts` | CRUD for `county_gis_endpoints` (operator/scan-contributed), `data_sources` registry, `data_source_cache`, `discovered_endpoints` (approve/reject flow), `parcel_snapshots` | whole file |
| `ssrf-guard.ts` | Blocks private/loopback/link-local/metadata + non-https on operator-contributed county URLs (write-time) | `:24-79` |
| `fetchGeo.ts` | Hardened fetch for all free geo upstreams: timeout, retry+jitter, per-host token bucket + concurrency, contactable UA (`AcreOS-DataBot`), SSRF reuse | whole file |
| County GIS (broker) | `getSourcesForCategory` maps categories→`data_sources` rows (`county_gis`, `assessor`, etc.), ILIKE-matched, DB-driven | `data-source-broker.ts:171-217` |

**Broker's ~30 hardcoded federal endpoints** (`data-source-broker.ts`, all free/public-domain): FEMA NFHL flood + firm panels (`:715,958,1014`); USFWS NWI wetlands (`:748`); USDA SSURGO soil (`:773`); EPA TRI/FRS (`:843,1743`); HIFLD hospitals/fire/schools via ArcGIS (`:905-913`); USGS earthquakes (`:972`); WFIGS wildfire perimeters (`:991`); Census geocoder + ACS (`:1058,1087`); BLM SMA/PLSS (`:1168,1855`); NPS (`:1188`); USDA Forest Service (`:1208`); DOT NHPN/NBI/rail (`:1250-1288`); Census TIGER roads (`:1307`); USGS NWIS water (`:1355-1376`); USGS WBD watershed (`:1404,1915`); USGS EPQS + open-elevation (`:1442,1462`); NOAA NCEI + Open-Meteo climate (`:1487,1491`); USDA ERS land values (`:1553`); USDA NASS QuickStats (`:1584`); MRLC NLCD land cover (`:1618`); USDA CropScape (`:1664,1707`); FCC census block (`:1810`); NOAA storm events (`:1830`); EPA WATERS (`:1890`); FEMA NRI (`:1945`); USDA CLU (`:1979`).

---

## 5. Data-Intel Routes (`server/routes-data-intelligence.ts`)

Wired at `routes.ts:1468-1469` ("USDA NASS, Census, Parcel Fusion, Blind Offer Calculator").

| Feature | Backing service | Source | Real/Stub | file:line |
|---|---|---|---|---|
| County snapshot | `usdaNassService` + `censusDataService` + `countyOpportunityScore` | USDA NASS QuickStats, Census ACS | Real | `:56-60`, `usdaNassService.ts:8-31`, `censusDataService.ts:23-36` |
| Land-value trend | `usdaNassService` | USDA NASS QuickStats (`quickstats.nass.usda.gov`) | Real; needs `USDA_NASS_API_KEY` (empty string default → will fail unkeyed) | `usdaNassService.ts:9,31` |
| Blind offer | `blindOfferCalculator` | USDA NASS pastureland value as comp anchor + user comps | Real | `blindOfferCalculator.ts:194,294-315` |
| Parcel intelligence ("Parcel Fusion") | `parcelIntelligenceFusion` | FEMA+NWI+EPA+OSM+USDA+USGS+Census fusion | Real | `routes-data-intelligence.ts:252-284` |
| Census county opportunity / disaster signals | `censusDataService` | Census ACS + FEMA disaster declarations API | Real; `CENSUS_API_KEY` optional | `censusDataService.ts:24-25,577` |

County opportunity score explicitly notes it **lacks live market data** (sales velocity, DOM, active listings) on the free tier — `parcelIntelligenceFusion.ts:284`.

---

## 6. Regrid integration

- **On-demand lookups**: via `regrid-provider.ts` → `parcel.ts` (`lookupParcelByCoordinates`, `lookupParcelByAPN`) and `comps.ts`. Returns parcel geometry, owner, comps, and a derived valuation. BYOK-first then `REGRID_API_KEY`. Pay-per-call, 3–8¢, `minMonthlyCommitCents: 0`. No stated tier/plan in code (generic v2 API: `app.regrid.com/api/v2/parcels`).
- **Bulk ETL**: `etlHandlers.ts:regridEtlHandler` pulls `/api/v2/parcels?since=…` paginated, upserts `parcel_snapshots`, captures widened facts (assessed value, last sale price/date, centroid, boundary) into the observation log (`:113-259`).
- Regrid is `proprietary` / `redistributable: no` — never persisted to the shared redistributable cache (`data-licenses.ts:207-215`).

---

## 7. ETL / scheduled ingestion

| Job | Source | Schedule | Enabled? | Real/Stub | file:line |
|---|---|---|---|---|---|
| `regrid_parcels_v1` | Regrid `/api/v2/parcels` | `*/30 * * * *` | **false (seeded disabled)** | Real handler; no-ops without `REGRID_API_KEY` | `migrations/0070_etl_orchestrator.sql:79`, `etlHandlers.ts:146-280` |
| `fema_flood_zones_v1` | FEMA NFHL MapServer/28 | `0 */6 * * *` | **false (seeded disabled)** | Real handler | `migrations/0070_...sql:80`, `etlHandlers.ts:364-428` |
| County assessor ingest | ATTOM saleshistory + tax-delinquent list | Nightly 11 PM UTC | Registered | ATTOM real (`fetchAttomComparables`); **tax-delinquent list is a STUB** (returns `[]`, "queued for browser scrape") | `jobs/countyAssessorIngest.ts:141-207, 241-253, 698-708` |
| Others | `dataSourceProbe` | — | — | probe/health-oriented | `server/jobs/` |

> 2026-08-01 correction: this row previously listed `dataIngestJob`, `satelliteImageUpdate`, and `valuationModelRetrain` as running "via `scheduler.ts` self-rescheduling" — refuted on verification: none of the three was registered with `scheduler.ts` (or any scheduler); all three were module orphans and were deleted 2026-08-01 (see the deletion ledger).

Orchestrator: `etlOrchestrator.ts` (watermark, DLQ, cron via `etl_jobs.schedule`, advisory-lock). ETL handlers registered by `registerReferenceEtlHandlers()`.

---

## Additional standalone enrichment services (not in registry)

| Service | Source(s) | Free/Paid | Real/Stub | file:line |
|---|---|---|---|---|
| Zoning | Zoneomics primary → ATTOM fallback → **mock** dev fallback | Paid | Real + mock fallback | `zoningService.ts:5-10,45-144` |
| Solar potential | NREL `developer.nrel.gov/api/solar` | Free (keyed) | Real | `solarPotentialService.ts:42-79` |
| Skip tracing | BatchSkipTracing + REISkip | Paid | Real | `skipTracingService.ts:13-155` |
| Listing syndication | LANDFLIP (`LANDFLIP_API_KEY`) | Paid | — | `listingSyndication.ts` |

`.env.example` also provisions **unwired/commented** key slots: `PROPSTREAM_API_KEY`, `NEWS_API_KEY`, `LANDCOM_API_KEY`, `ACTUM_API_KEY`, `PCM_API_KEY`, `COUNTY_API_KEY` (`.env.example:148-293`).

---

# GAPS (surfaces want it; platform lacks it today)

1. **Slope / terrain analytics** — DD elevation check is single-point only and literally returns `slope: "unknown"` (`dueDiligenceEngine.ts:562`). No DEM-derived slope/aspect despite the map having a `slopeGradient` toggle and Mapbox terrain-DEM available. High-value for land buyers.
2. **Aerial / imagery quality** — imagery is just Mapbox/Stadia satellite basemap tiles. No NAIP high-res aerial, no imagery-date/quality metadata, no change detection. (The `satelliteImageUpdate` job that gestured at this was deleted 2026-08-01 — it was an orphan with no imagery-ingest source ever wired.)
3. **Superfund contamination** — `checkSuperfund` is a hardcoded stub returning zeros (`:439-448`); only RCRA facilities are real. EPA ECHO / ATTAINS plume data referenced in copy but not called.
4. **Live market / comps context** — county opportunity score self-declares missing sales velocity, days-on-market, active listings on the free tier (`parcelIntelligenceFusion.ts:284`). Comps depend on paid Regrid/ATTOM; no free MLS-adjacent signal.
5. **Statewide/national parcels** — parcel coverage is county-by-county (`county_gis_endpoints`, operator/scan-contributed) or paid Regrid. No bulk statewide open parcel layer; free tier has patchy coverage and a "free-miss-by-county" telemetry signal explicitly built to flag the gaps (`provider-registry.ts:350-355`).
6. **Wetlands / soil / risk-index map layers** — these datasets exist server-side (broker + DD engine) but are **not** rendered as client map overlays; only flood, zoning, cropland, CLU, hillshade are on the map.
7. **FEMA NRI risk indices** — NRI is called only for wildfire rating in DD (`:774`) and in the broker (`fema_nri`), but the multi-hazard composite (flood/heat/drought/earthquake risk scores available in the same endpoint, `data-source-broker.ts:1945`) isn't surfaced as a risk panel or map layer.
8. **School / crime / neighborhood context** — HIFLD schools/hospitals/fire stations are fetched by the broker (`infrastructure`) but there is no school-rating, crime, or demographic-desirability index. No crime dataset anywhere.
9. **Tax-delinquent lists** — the #1 motivated-seller signal per the code's own comments is a stub (`countyAssessorIngest.ts:246-253`); relies on an unbuilt browser-scrape path.
10. **Zoning at scale** — only Zoneomics (paid, per-parcel) or a mock; no free statewide zoning layer, and USGS land-use raster is coarse.
11. **USDA NASS keying** — `USDA_NASS_API_KEY` defaults to empty string (`usdaNassService.ts:31`); land-value trends/blind-offer anchors silently degrade unkeyed.

Both seeded bulk ETL jobs (Regrid, FEMA) ship **disabled** (`false` in migration 0070), so today there is effectively **no scheduled external-dataset ingestion running** except the nightly ATTOM county assessor job (paid, partial).
