# Free/Open Data Sources for Map Quality — AcreOS (US Land/Real-Estate SaaS)

_Research report 2026-07-13 (Open-Data Program, task stream 2 of 4). Companion to
`open-data-program.md`. Every claim cited; licenses marked "unclear" where unverifiable._

All claims cited; licenses marked "unclear" where a primary statement could not be verified. Attribution obligations spelled out exactly where they exist.

## 1. Basemaps / tiles

| Layer/need | Source | Quality/resolution | License + attribution | Serving approach | Link |
|---|---|---|---|---|---|
| Vector basemap, zero cost hosted | **OpenFreeMap** (public instance) | OpenMapTiles schema, full planet, weekly updates | Software MIT; data ODbL. Required on-map attribution: **"OpenFreeMap © OpenMapTiles Data from OpenStreetMap"** (clickable links acceptable in web maps) | Hosted (no API key, no registration, **no stated request limits**, commercial use OK) or self-host via their deploy scripts (300 GB SSD / 4 GB RAM Ubuntu box for pre-built tiles) | [openfreemap.org](https://openfreemap.org/), [github.com/hyperknot/openfreemap](https://github.com/hyperknot/openfreemap) |
| Vector basemap, self-hosted | **Protomaps** (PMTiles) | OSM + Natural Earth basemap schema; free **daily planet builds** (~106 GB), or area extracts via CLI | Basemap code BSD-style open source; data ODbL → on-map **"© OpenStreetMap contributors"** + ODbL link required | Self-host: single `.pmtiles` file on S3/R2 + optional Cloudflare Worker. Real-world reports: ~$3/mo on R2 for a global tileset; 10M tile req/mo ≈ $11 on R2 vs ~$120 on S3 (egress). Setup ≈ 1 hour | [docs.protomaps.com/basemaps/downloads](https://docs.protomaps.com/basemaps/downloads), [maps.protomaps.com/builds](https://maps.protomaps.com/builds/), [R2 cost writeup](https://bonitotech.com/2024/03/19/how-we-reduced-our-mapping-costs-by-90-using-protomaps-and-cloudflare/) |
| Hosted free tier (fallback) | **MapTiler Cloud** free plan | Polished styles, satellite hybrid | Free plan: text attribution (MapTiler + OSM) **plus mandatory MapTiler logo linking to maptiler.com** | Hosted; free plan = **100,000 requests/mo** and a sessions cap — maps are **suspended for the rest of the month** when exceeded. Fine for prototyping, not production SaaS | [maptiler.com/cloud/pricing](https://www.maptiler.com/cloud/pricing/), [attribution docs](https://docs.maptiler.com/guides/map-design/attribution/add-attribution/) |
| Hosted free tier (fallback) | **Stadia Maps** free tier | High-quality styles incl. Stamen | Free tier is **explicitly non-commercial only** ("development, evaluation, and non-commercial use") — **not usable for AcreOS production** without a paid plan | Hosted API | [docs.stadiamaps.com/limits](https://docs.stadiamaps.com/limits/), [stadiamaps.com/pricing](https://stadiamaps.com/pricing/) |
| osm.org raster tiles | **tile.openstreetmap.org** | z0–19 raster | ODbL attribution required — but irrelevant: **the OSMF Tile Usage Policy prohibits heavy/production use**. It is a community-donated server for the OSM project; apps making heavy use are told to run their own tile servers, bulk/offline prefetch is banned, Referer/User-Agent required, and access is **blocked without notice** if usage degrades service. Hotlinking from a commercial SaaS violates the policy | Do not use in production | [operations.osmfoundation.org/policies/tiles](https://operations.osmfoundation.org/policies/tiles/) |

**Self-hosting effort:** US-only extract (`pmtiles extract` against a daily build) is a few GB–tens of GB and runs in minutes; full planet download is ~106 GB. Building from scratch with Planetiler needs ~64 GB RAM / 500 GB disk but is optional — pre-built builds exist. Ongoing cost on R2: single-digit dollars/month.

## 2. Aerial imagery

| Layer/need | Source | Quality/resolution | License + attribution | Serving approach | Link |
|---|---|---|---|---|---|
| National aerial | **USDA NAIP** | 60 cm standard since 2018, 30 cm option (≈half of 2025 states at 30 cm); leaf-on; **2–3 yr refresh cycle per state** | **Public domain** (US federal). No attribution legally required; "Courtesy USDA FSA" is courteous | (a) Self-host tiles from AWS Open Data: `naip-visualization` bucket = RGB **Cloud-Optimized GeoTIFFs** — note bucket is **Requester Pays** (free within us-west-2; you pay egress otherwise). Pre-tile to PMTiles/COG mosaics or serve via TiTiler. (b) USGS hosted: `USGSNAIPPlus` / `USGSNAIPImagery` ImageServer + WMS at imagery.nationalmap.gov — free but no SLA, not built to be a SaaS tile backend. (c) Esri's `naip.imagery1.arcgis.com` — terms for third-party commercial reuse **unclear**; avoid | [registry.opendata.aws/naip](https://registry.opendata.aws/naip/), [USGS NAIP archive](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip), [USGSNAIPPlus ImageServer](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer) |
| Legacy high-res urban | **USGS HRO** (folded into NAIPPlus service) | 6 in–1 m orthoimagery where flown | Public domain (USGS) | Same USGS ImageServer/WMS as above (NAIPPlus mixes NAIP + HRO) | [imagery.nationalmap.gov USGSNAIPPlus](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer) |
| State sub-foot imagery (verified examples) | **NC OneMap** | **6-inch (15 cm)** statewide, 4-yr cycle, 4-band since 2020 | Freely available to the public incl. private/commercial use (911-Board funded) | Hosted streaming image services + tile/county-mosaic downloads | [nconemap.gov/pages/imagery](https://www.nconemap.gov/pages/imagery) |
| | **Vermont VCGI** | **15 cm** statewide leaf-off (even years); 30 cm leaf-on odd years | "Freely available to the public and **unrestricted in use**" | Streaming services + tile/bulk download from VT Open Geodata Portal | [vcgi.vermont.gov imagery program](https://vcgi.vermont.gov/data-and-programs/imagery-program) |
| | **Texas TxGIO (StratMap)** | 0.5 m / 1 m statewide (higher-res regional buys) | Deliverables "placed in the **public domain**" after acceptance | Texas Imagery Service (hosted) + DataHub downloads | [tnris.org/stratmap/orthoimagery](https://tnris.org/stratmap/orthoimagery.html) |

Pattern: many states (NC, VT, TX, UT, NJ, IN…) publish sub-meter imagery free — worth a per-state lookup table in AcreOS that prefers state ortho where available and falls back to NAIP.

## 3. Elevation / terrain

| Layer/need | Source | Quality/resolution | License + attribution | Serving approach | Link |
|---|---|---|---|---|---|
| DEMs | **USGS 3DEP** | Seamless **1 m** (lidar-derived, COG, 10×10 km tiles), 1/3 arc-sec (~10 m), 1 arc-sec (~30 m) | **All 3DEP products are public domain.** Courtesy credit "Courtesy of the U.S. Geological Survey" appreciated, not required | Download COGs (National Map / AWS), derive your own products; or USGS 3DEP dynamic services (no SLA) | [usgs.gov 3DEP products](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services) |
| LiDAR point clouds | **3DEP LPC on AWS** | Full-density lidar, Entwine Point Tiles (streamable EPT/LAZ), free public bucket | Public domain | Stream EPT directly (Potree/deck.gl) or process with PDAL — no egress trickery, it's a standard Open Data bucket | [registry.opendata.aws/usgs-lidar](https://registry.opendata.aws/usgs-lidar/) |
| Slope/contours | Derived from 3DEP | 1 m DEM → sub-meter contours, slope, aspect, hillshade | Your derivative of public-domain data = yours, no restrictions | Self-generate (GDAL `gdaldem`/`gdal_contour`, or on-the-fly from terrain-RGB tiles in MapLibre) | [usgs.gov 3DEP](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services) |
| Global terrain tiles (hillshade/3D) | **AWS Terrain Tiles** (Mapzen/Tilezen "terrarium") | z/x/y PNG terrarium-encoded elevation, global; **still live** on AWS Open Data (static S3, no auth, no requester-pays) | Mixed per-source; **attribution list required** per tilezen/joerd docs — for US sources: "Courtesy of the U.S. Geological Survey"; other countries have their own strings (e.g. Canada Open Government Licence, EU-DEM Copernicus notice). Composite license best marked **"open access, per-source attribution required"** | Hotlink the S3 bucket directly (free) or mirror; feed MapLibre `raster-dem` for hillshade + 3D terrain. Caveat: dataset is essentially frozen (Mapzen-era); for US-only quality, self-building terrain-RGB from 3DEP 1 m beats it | [registry.opendata.aws/terrain-tiles](https://registry.opendata.aws/terrain-tiles/), [attribution list](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) |

## 4. Hydrography / water

| Layer/need | Source | Quality/resolution | License + attribution | Serving approach | Link |
|---|---|---|---|---|---|
| Streams, lakes, watersheds | **USGS 3DHP** (successor to NHD/WBD/NHDPlus HR; NHD retired Oct 2023, still downloadable but unmaintained) | Lidar-derived (from 3DEP), replacing legacy 24k-scale NHD; quarterly service updates | Public domain (USGS) | Download (FGDB/GPKG) → bake into your vector tiles, or use USGS 3DHP web map services | [usgs.gov 3DHP data access](https://www.usgs.gov/3d-hydrography-program/access-3dhp-data-products), [NHD status](https://www.usgs.gov/national-hydrography/national-hydrography-dataset) |
| Flood zones | **FEMA NFHL** | Effective DFIRM flood hazard data; covers >90% of US population | US federal work — public domain (no explicit license statement found on service; treat attribution "FEMA NFHL" + effective-date disclaimer as best practice, since flood zones carry legal weight) | **Live WMS available**: `https://hazards.fema.gov/gis/nfhl/services/public/NFHLWMS/MapServer/WMSServer`, plus REST MapServer and state/county GIS downloads from the Map Service Center | [hazards.fema.gov NFHL WMS portal](https://hazards.fema.gov/femaportal/wps/portal/NFHLWMS/), [fema.gov NFHL](https://www.fema.gov/flood-maps/national-flood-hazard-layer), [REST](https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer) |

## 5. Boundaries / reference

| Layer/need | Source | Quality/resolution | License + attribution | Serving approach | Link |
|---|---|---|---|---|---|
| Roads, county/state/place boundaries, tracts | **Census TIGER/Line** | National, annual releases; positional accuracy modest but topology-complete | **Public domain** (data.gov catalogs releases under **CC0**); no attribution required | Download shapefiles → vector tiles (tippecanoe → PMTiles) | [census.gov TIGER/Line](https://www.census.gov/geographies/mapping-files/2024/geo/tiger-line-file.html), [CC0 example](https://catalog.data.gov/dataset/tiger-line-shapefile-current-nation-u-s-state-and-equivalent-entities) |
| Section-Township-Range (critical for rural land) | **BLM PLSS CadNSDI** | National PLSS grid: township, range, section (First Division) + intersected divisions | US federal (BLM) — public domain in practice; **no explicit license statement verified → mark "unclear (federal, assumed PD)"**; credit "BLM Cadastral/CadNSDI" recommended | BLM hosted MapServer (`gis.blm.gov/.../BLM_Natl_PLSS_CadNSDI/MapServer`) for low volume; for SaaS scale, download state GDBs and tile yourself | [BLM PLSS MapServer](https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer), [BLM hub dataset](https://gbp-blm-egis.hub.arcgis.com/datasets/BLM-EGIS::blm-national-plss-public-land-survey-system-polygons) |
| Address points | **National Address Database (NAD)** (USDOT) | ~80M address points; **coverage not uniform** — mix of full/partial/non-participating states | **Public domain** — "work of the federal government… not subject to copyright (17 U.S.C.)" | Bulk download (text/GDB releases) → geocoder or address-point overlay | [transportation.gov NAD](https://www.transportation.gov/gis/national-address-database), [disclaimer/PD statement](https://www.transportation.gov/mission/open/gis/national-address-database/national-address-database-nad-disclaimer) |
| Parcels (context) | State open-parcel programs, e.g. **Montana Cadastral** (first statewide cadastral DB; not for legal/survey use) and **Wisconsin Statewide Parcel Map** (free county + statewide downloads, hosted REST) | Varies by state/county | Varies — many statewide programs are free/open; **no free national layer exists** (national normalization is what Regrid/ReportAll sell). Mark per-state | Download per state → tile; or hosted state REST services | [svc.mt.gov/msl/cadastral](https://svc.mt.gov/msl/cadastral/), [sco.wisc.edu/data/parcels](https://www.sco.wisc.edu/data/parcels/) |

## 6. Land cover / use

| Layer/need | Source | Quality/resolution | License + attribution | Serving approach | Link |
|---|---|---|---|---|---|
| Land cover time series | **Annual NLCD** (USGS/MRLC) | 30 m, annual, 1985–2025, CONUS | Public domain (USGS federal data) | Download from MRLC/EarthExplorer/AWS S3 (us-west-2), or MRLC web services; pre-render to raster tiles for overlay | [usgs.gov Annual NLCD](https://www.usgs.gov/centers/eros/science/annual-national-land-cover-database), [mrlc.gov/data](https://www.mrlc.gov/data) |
| Crop-specific cover | **USDA NASS Cropland Data Layer** | 30 m historically; **10 m beginning with 2024** (30 m resample still published), annual, CONUS | "No copyright restrictions… public domain and free to redistribute"; NASS *appreciates* acknowledgment (not required) | Download via CroplandCROS / Geospatial Data Gateway → raster tiles | [NASS CDL FAQ](https://www.nass.usda.gov/Research_and_Science/Cropland/sarsfaqs2.php), [releases](https://www.nass.usda.gov/Research_and_Science/Cropland/Release/) |
| National forest boundaries, roads, trails | **USFS FSGeodata Clearinghouse** | National datasets (boundaries/ownership, roads, trails, insect/disease, etc.) | US federal — public domain in practice (no explicit statement verified → "unclear (federal, assumed PD)") | Shapefile/GDB downloads + hosted map services | [data.fs.usda.gov/geodata](https://data.fs.usda.gov/geodata/) |
| Protected/public lands | **PAD-US 4.x** (USGS GAP) | Official inventory of US protected areas, national GDB/shape/KMZ, per-state splits | **Public domain** (inclusion requires PD-distributable data) | Download → vector tiles; USGS also hosts viewers/services | [PAD-US overview](https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-overview), [download](https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-download) |

## 7. Buildings

| Layer/need | Source | Quality/resolution | License + attribution | Serving approach | Link |
|---|---|---|---|---|---|
| Building footprints | **Overture Maps — Buildings theme** (conflates OSM + Microsoft ML + Google Open Buildings + Esri community) | Global; best available open footprint conflation, monthly releases, GeoParquet on AWS/Azure | **ODbL** (because OSM is an input). Commercial use is fine, but: on-map attribution **"© OpenStreetMap contributors"** (Overture citation `Overture Maps Foundation, overturemaps.org` for publications), and **share-alike applies to derivative databases** — if you mix Overture buildings into your own database and distribute it, that derivative DB must be ODbL. Rendering tiles/maps (Produced Works) only needs attribution, not share-alike. Note: Overture's Places/Addresses themes are CDLA-Permissive-2.0 / per-source instead | Download GeoParquet (DuckDB spatial filter for US extract) → tippecanoe → PMTiles overlay | [docs.overturemaps.org/attribution](https://docs.overturemaps.org/attribution/), [buildings guide](https://docs.overturemaps.org/guides/buildings/), [registry.opendata.aws/overture](https://registry.opendata.aws/overture/) |

---

# Recommended map stack for AcreOS

Legally clean, commercial-safe, near-zero data cost:

**1. Basemap — Protomaps PMTiles on Cloudflare R2 (primary), OpenFreeMap public instance (fallback/dev).**
Download a daily Protomaps build, `pmtiles extract` a US pyramid, drop on R2 behind a Worker, render with MapLibre GL. Attribution: `© OpenStreetMap contributors` (+ ODbL link). Effort: **~1 day** including style tweaks; ~$5–15/mo at 10M tiles. OpenFreeMap costs $0 and allows commercial use, but it's one volunteer-run instance — fine as fallback, don't make it your only production dependency.

**2. Aerial — NAIP self-hosted + state ortho where available.**
Pull `naip-visualization` RGB COGs from AWS (run processing **in us-west-2** to dodge requester-pays egress), build a COG mosaic served by TiTiler/rio-tiler or pre-baked raster PMTiles for your active markets. Public domain, zero attribution burden. Layer state 6-inch imagery (NC, VT, TX verified above) on top by state. Effort: **the biggest lift in the stack — ~1–2 weeks** for a robust NAIP tiling pipeline for CONUS, or days if you pre-bake only states you sell in. Interim shortcut: USGS `USGSNAIPPlus` WMS (free, but no SLA — don't bet production on it).

**3. Terrain — 3DEP.**
Quick win: hotlink AWS Terrain Tiles (terrarium) as MapLibre `raster-dem` for hillshade + 3D — free, S3-static, needs the joerd attribution line ("Courtesy of the U.S. Geological Survey" for US). Quality win: generate your own terrain-RGB PMTiles from 3DEP 1 m DEMs (`rio rgbify`/gdal) — public domain, sharper hillshades and honest slope/contour analytics for land buyers. Effort: hours for hotlinking; **~2–4 days** for a 3DEP-derived pipeline per region.

**4. Parcels overlay — county/state sources, tiled as PMTiles.**
No free national layer exists; where AcreOS already licenses parcels, keep that. Supplement free statewide programs (Montana, Wisconsin, etc.) at $0. Tile with tippecanoe; keep parcel attributes in Postgres, geometry in tiles.

**5. Reference overlays — all public domain, all self-tiled:** PLSS section/township/range (BLM CadNSDI — the killer feature for rural land), FEMA NFHL flood zones (their WMS works out of the box for a live overlay; cache or pre-tile for speed), 3DHP water, PAD-US public lands, NLCD/CDL land-cover rasters, TIGER boundaries, USFS roads/trails. Effort: **~1 day per layer** for a download→tippecanoe→PMTiles→MapLibre-layer pipeline once the first one exists.

**6. Buildings — Overture buildings theme.** Only ODbL layer besides the basemap; attribution already satisfied by the OSM credit line. Keep it in tiles (Produced Work), don't merge it into a redistributed database unless you accept share-alike.

**Total attribution footprint of the whole stack:** one corner line — `© OpenStreetMap contributors` (basemap + buildings, ODbL link), plus `USDA FSA/USGS` courtesy credits if desired, plus the terrarium USGS line only while hotlinking AWS Terrain Tiles. Everything else is US-government public domain. **Recurring data cost: roughly $10–30/mo** (R2 storage + requests) — the spend is engineering time (~2–4 weeks for the full pipeline), not licenses.

**Explicitly avoid:** hotlinking `tile.openstreetmap.org` (policy-prohibited for production apps, blocked without notice), Stadia free tier (non-commercial only), MapTiler free tier in production (100k req/mo then suspension + mandatory logo), and Esri-hosted NAIP endpoints (reuse terms unclear).
