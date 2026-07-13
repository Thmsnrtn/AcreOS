# Open-Data Program — free/unencumbered data across the whole platform

_Founder directive 2026-07-13: "be as deep as possible and really pull in and
aggregate as much free open source unencumbered data as possible … across every
aspect of this platform regarding data. Maps, map quality, etc."_

_Synthesized from four parallel research streams (2026-07-13). Full evidence and
citations live in the companion docs — this doc is the registry summary + the
phased build plan._

| Companion doc | Covers |
|---|---|
| `open-data-platform-inventory.md` | What the platform ingests TODAY (3 data layers, per-provider table, real-vs-stub DD checks, the 11-item GAPS list this program is keyed to) |
| `open-data-duediligence.md` | Environmental / due-diligence / risk sources (flood, wetlands, soils, EPA, wildfire, seismic, broadband…) |
| `open-data-maps.md` | Basemaps, aerial imagery, elevation, hydrography, boundaries, land cover, buildings — with the recommended self-host stack |
| `open-data-market-signals.md` | Parcels, addresses, land values, migration, employment, permits, foreclosure, schools, crime |
| `residential-data-sources.md` | Residential property values specifically (founder question 2026-07-13) |

## Program principles

1. **License-verified or it doesn't ship.** Every source below has a verified
   license class. "Unclear" sources need per-source verification before ingest.
   US-government public domain is the backbone; ODbL (OSM/Overture) is fine for
   rendered tiles with attribution but its share-alike clause means we never
   merge ODbL data into a database we redistribute.
2. **Everything flows through the existing seams.** New sources register in the
   provider registry (`server/services/providers/`) or as `etlOrchestrator`
   jobs — never a fourth ad-hoc fetch layer. The DD engine's direct-fetch
   pattern is grandfathered, not extended.
3. **No fabricated data.** A check that can't reach its source reports that,
   never a guessed value. (House rule; also why `slope: "unknown"` existed —
   the fix is real data, not a plausible number.)
4. **Free first, paid only where free is structurally impossible** (national
   parcels outside the free states, skip-trace/contactability, MLS comps,
   school ratings).

## The registry at a glance (license-verified)

**Public domain, no key, ingest freely:** FEMA NFHL + NRI + OpenFEMA · USFWS
NWI · USDA NRCS SSURGO/SDA · EPA Envirofacts/FRS/ECHO/UST Finder · USFS WHP +
Wildfire Risk to Communities · USGS 3DEP (1 m DEM + lidar) / 3DHP / EPQS /
seismic design / NWIS · NOAA normals + storm events · Census TIGER (CC0) + ACS
+ BPS permits + PEP · IRS SOI migration · BLS LAUS/QCEW · BEA regional (free
key) · USDA NAIP imagery + NASS CDL/QuickStats + ERS · DOT NAD addresses (~80M
pts) · BLM PLSS CadNSDI + mining claims · PAD-US · NLCD · FRA rail · FBI CDE.

**Free with real terms:** FCC BDC broadband (public availability data; the
CostQuest location Fabric underneath is licensed — store availability results
only, never Fabric records) · state parcel programs (public record, per-state
disclaimers; KS unclear) · state well logs (TX/WA/MN verified open, others
vary) · OpenAddresses (per-source license mix — compliance burden real).

**ODbL (attribution + share-alike):** OSM-derived basemaps (Protomaps,
OpenFreeMap) and Overture buildings. On-map `© OpenStreetMap contributors` +
ODbL link; tiles are Produced Works (attribution only); merged databases would
be share-alike — don't redistribute merged DBs.

**Confirmed NOT usable (do not wire, do not retry):**

| Source | Why |
|---|---|
| HUD USPS vacancy | Free registration but sublicense restricted to gov/non-profit — a for-profit SaaS is ineligible |
| First Street flood/climate | API + bulk are paid for commercial use |
| U-Haul / United Van Lines migration | Proprietary; press releases only |
| GreatSchools ratings | Paid partner license (raw NCES/EDFacts is free — build our own index if ever needed) |
| HIFLD Open | Discontinued Aug 2025, portal offline; archives go stale — the broker's HIFLD hospital/fire/school endpoints need replacement, not extension |
| PHMSA pipelines | Public viewer only; GIS restricted to government |
| ND oil & gas | Paid subscription ($100–500/yr) — build TX/OK first |
| osm.org tiles | OSMF policy prohibits production hotlinking; blocked without notice |
| Stadia Maps free tier | Explicitly non-commercial. ⚠️ `client/src/lib/map-engine.ts` comments claim otherwise and use Stadia URLs for the MapLibre path. Not live (flag-gated, Mapbox is default) but it's a compliance bug: Phase 4 replaces Stadia with self-hosted Protomaps/OpenFreeMap and fixes the comment |
| MapTiler free tier | 100k req/mo then month-long suspension + mandatory logo — prototyping only |
| Esri-hosted NAIP | Third-party commercial reuse terms unclear — use AWS/USGS NAIP instead |
| Skip-trace "free" paths | DPPA bars DMV data for marketing; voter files state-restricted. Stays a paid per-lookup provider category, permanently |
| Tax/assessment national | No free national source exists (county-authoritative); free statewide composites + paid Regrid/ATTOM remain the model |
| Foreclosure national | Underlying county records are free but only county-by-county; free at scale = per-county scrapers for target counties only |

## Phased build plan (value-per-effort, keyed to the inventory GAPS list)

Effort scale: S = hours, M = days, L = 1–2 weeks.

### Phase 1 — Due-diligence honesty + risk depth (no keys, no cost) — BUILD NOW

| # | Item | Gap | Effort | What ships |
|---|---|---|---|---|
| 1.1 | **Superfund stub → real EPA SEMS/FRS** | #3 | S | `checkSuperfund` (dueDiligenceEngine.ts:439) queries EPA Envirofacts SEMS + FRS radius instead of returning hardcoded zeros. The single worst honesty gap in DD — the check *looks* real to customers today |
| 1.2 | **FEMA NRI multi-hazard risk panel** | #7 | S–M | The broker already hits the NRI endpoint for wildfire only; surface the full 18-hazard composite (EAL, risk + social-vulnerability percentiles) as a DD risk section. One endpoint, county/tract grain, entire "risk score" feature |
| 1.3 | **Real slope from 3DEP sampling** | #1 | M | Replace `slope: "unknown"` (dueDiligenceEngine.ts:562) with multi-point EPQS elevation sampling across the parcel → slope/relief classification. Honest values from public-domain data; full DEM pipeline deferred to Phase 4 |
| 1.4 | **Wetlands + soil map overlays** | #6 | S | NWI and SDA data already flow server-side but aren't map layers. Add NWI (USFWS MapServer export) and SSURGO (SDM WMS) raster overlays to `property-map.tsx` beside the existing FEMA/CDL/CLU toggles |
| 1.5 | **USDA NASS key** | #11 | S | Free signup; `USDA_NASS_API_KEY` empty-string default silently degrades land-value trends + blind-offer anchors. → founder key list |

### Phase 2 — Market signals into County Opportunity Score (free keys at most)

| # | Item | Gap | Effort | What ships |
|---|---|---|---|---|
| 2.1 | IRS SOI county-to-county migration (with AGI) | #4 | M | Annual CSV ingest via etlOrchestrator → income-weighted net-inflow signal, 1–3 years ahead of land prices |
| 2.2 | Census BPS building permits | #4 | S–M | Monthly county/place permit counts — the land→houses conversion event; "path of growth" scoring |
| 2.3 | BLS QCEW + LAUS, BEA county income | #4 | M | Employment/wage/income trajectory = economic-durability leg of county scoring; QCEW is keyless CSV |
| 2.4 | NASS county cash rents deepening | #4 | S | Cash rent ÷ price per acre = free income-yield floor ("cap rate for land") |

### Phase 3 — Statewide parcel ETL (the biggest free unlock)

Free statewide parcel polygons + attributes (assessed values, land-use codes,
owner mailing addresses) directly replace per-parcel Regrid spend for lead gen
in **10+ states**: FL (10.8M parcels, all 67 counties), MT, NC, NJ, WA, AR, TN,
NY (~38 counties), OR (maturing), + verify WI/UT/MD/VT/MA/KS. Wire as
`etlOrchestrator` jobs (the seam exists — migration 0070 seeded jobs prove the
pattern) feeding `parcel_snapshots`, registered ahead of Regrid in the
provider order so free states never hit the paid path (gap #5, and the
"free-miss-by-county" telemetry finally gets a real fix). Effort: M per state
after the first (L). Order by market priority: FL → NC → TN → AR → MT first
(land-deal volume), then the rest.

### Phase 4 — Map quality + independence track

The full recipe with costs/licensing is in `open-data-maps.md` §"Recommended
map stack". Sequence:

1. Complete the MapLibre Phase-2 renderer swap (seam exists in
   `map-engine.ts`), pointing at **self-hosted Protomaps PMTiles on Cloudflare
   R2** (primary) + **OpenFreeMap** (fallback/dev) — removes the Stadia
   non-commercial problem and makes Mapbox optional rather than default. (~1
   day + R2 account; ~$5–15/mo)
2. **NAIP aerial imagery** self-host from AWS `naip-visualization` COGs
   (process in us-west-2 — bucket is Requester-Pays), pre-baked for active
   markets first; state 6-inch ortho (NC/VT/TX verified) layered on top.
   Biggest lift: ~1–2 weeks. (gap #2)
3. **3DEP terrain-RGB** tiles → sharp hillshade + honest slope/contour
   analytics client-side (upgrades Phase 1.3's sampling approach).
4. **PLSS section/township/range overlay** (BLM CadNSDI) — the killer feature
   for rural land — plus PAD-US public lands, 3DHP water, TIGER boundaries.
5. **Overture buildings** as a tile overlay (ODbL, attribution covered by the
   OSM line).

Total recurring cost of the whole stack: **~$10–30/mo** (R2). The spend is
engineering time, not licenses.

### Phase 5 — New DD checks (net-new customer value)

USFS wildfire WHP (30 m raster identify) · FCC BDC broadband availability
(free token; differentiating rural-livability signal) · USGS seismic design
(single GET, lowest-effort net-new) · NOAA storm-event history · BLM mining
claims (fully open REST + bulk; prioritize when western acreage volume grows).
Replace the broker's dead HIFLD school/hospital/fire endpoints with state/
Overture/NCES equivalents.

### Deliberately not scheduled

Foreclosure per-county scrapers (build per target county when a market
justifies it) · tax-delinquent ingestion (gap #9 — needs the browser-scrape
path or a paid source; keep the stub honest) · zoning at scale (gap #10 — no
free national layer exists; Zoneomics stays per-parcel paid) · crime/school
indexes (weak signals for rural land; raw NCES/FBI data is free if a vertical
ever needs it).

## Founder involvement

Almost none — that's the point of this program. The only items on the founder
list: the **free** USDA NASS key (Phase 1.5), a **free** FCC account token
when Phase 5 broadband lands, free BEA/BLS registration keys (Phase 2), and a
**Cloudflare R2 account** (~$10–30/mo) when Phase 4 starts. Everything else
needs no keys, no contracts, no spend.
