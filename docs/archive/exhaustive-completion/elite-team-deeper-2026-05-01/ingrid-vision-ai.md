# Ingrid Christiansen — Vision-AI / Geospatial Imagery Audit

**Wave 3 · Elite-Team-Deeper · 2026-05-01**
*41, Oakland CA. Six years on Google Earth Engine writing pixel pipelines for a 3,000-county forest-carbon program; four years at Descartes Labs training building-detection and crop-class CNNs against NAIP + PlanetScope. I have personally trained a model that found 11,000 unpermitted ag wells across the San Joaquin Valley from 2018 NAIP, and another that classified 28 timber-stand age cohorts from a 4-band stack at sub-acre resolution. AcreOS markets a `/vision-ai` page; that's the one I came to look at.*

---

## 1. One-line verdict

**C. The plumbing is mostly there; the imagery is air.** AcreOS has a `/vision-ai` page (`client/src/pages/vision-ai.tsx`), a `visionAI` service (`server/services/visionAI.ts`), a separate `computerVisionService` (`server/services/computerVision.ts`), three relevant tables (`propertyPhotos`, `photoAnalysis`, `satelliteSnapshots`, plus an `satelliteAnalysis` table I found at `shared/schema.ts:10546`), a BullMQ job (`server/jobs/satelliteImageUpdate.ts`), and a `routes-portfolio-sentinel` surface that is conceptually pointed exactly where I'd point it: scheduled re-imaging + change detection + alerting on a portfolio of parcels. Architecture: A-minus.

**The execution is currently:** every imagery API is mocked or a hash-of-URL heuristic. The `/api/vision-ai` analyze flow is GPT-4-Vision being asked "is there a building, yes/no" against an arbitrary user-uploaded photo — which is **not satellite imagery analysis, it's a chat-bot looking at a snapshot**. The change-detection in `visionAI.ts:323-388` sends two image URLs to GPT-4V and asks it for a JSON of differences in natural language. That is not change detection. That is asking a language model to confabulate change detection. The Python YOLOv8 subprocess in `computerVision.ts:211` doesn't exist — `python3 -m acros_vision` is referenced but no module ships, so every call falls through to `heuristic_fallback` which generates a polygon from a string hash (`computerVision.ts:266`). Every NDVI value in the system is currently `Math.random() * 0.6 + 0.2` (`satelliteImageUpdate.ts:65`).

**This is fine for shipping a UI**. It is not fine for charging $49/mo and calling it Vision AI. The deal-killer for me is that a power user — Della, Vesta, anyone — will look at a "change detected: vegetation_removal" alert that came from `(seed % 4)` and conclude the entire platform is theatrical. **You have one credibility budget per user; this surface is the fastest way to spend it.**

The good news: the surface area is correct, the schema is correct, the job topology is correct. Replacing four functions with real provider calls flips this from C to A-minus in a single quarter.

---

## 2. Imagery provider strategy — what AcreOS should actually wire

The provider registry (`server/services/providers/`) is Attom / BatchData / Regrid / open-data — all tabular. There is **no imagery provider**. Add a fifth category: `imagery`. Here is the cost/coverage/cadence/resolution matrix a Land Investor platform actually needs.

| Provider | Resolution | Cadence | Coverage | License | $/parcel-snap | Right use |
|---|---|---|---|---|---|---|
| **NAIP** (USDA) | 0.6–1.0 m, 4-band (RGB+NIR) | every 2-3 yr per state, leaf-on | CONUS only | **Public domain** | Free (S3 requester-pays + compute) | Baseline. Every parcel gets a NAIP tile cached at ingest. NIR band enables real NDVI, not the random one in the code today. |
| **Sentinel-2** (ESA Copernicus) | 10 m, 13-band | 5-day revisit | Global | Public domain (CC-BY-equiv) | Free via AWS Open Data (`sentinel-s2-l2a-cogs`) | Change detection + cloud-aware time series. The job at `satelliteImageUpdate.ts` already says `provider: "sentinel-2"` — it's mocked but the intent is right. |
| **Landsat-8/9** (USGS) | 30 m, 11-band incl. thermal | 16-day revisit per sat, 8-day stacked | Global, back to 1972 for older sats | Public domain | Free | Long-baseline change (5-yr, 10-yr) for "this used to be timber" stories. |
| **Planet PlanetScope** | 3 m, 4-band | **Daily** | Global | Commercial, $$$ | ~$0.02–0.10/sq-km/snap, NICFI tropics free | Tier-gated for institutional / Della-style timber clients. Daily cadence is the unique value. |
| **Maxar / Vivid** | 30–50 cm | quarterly basemap, on-demand tasking | Global | Commercial, $$$$ | $15–50/sq-km basemap pull, ~$25–35/sq-km tasked | Premium tier only. The picture you put on a hunting-land listing. |
| **Nearmap / EagleView** | 7–15 cm aerial + oblique | 3–6× per yr in covered metros | US metros, partial | Commercial | Subscription, ~$300–800/mo all-you-can-eat | Best ROI for urban-edge / infill operators (Ezekiel-style). Useless for rural Greene County. |
| **NICFI Planet basemap** | 4.7 m | monthly | Tropics 30°N–30°S | Free | Free | International expansion (Cassiopeia). |

**The default tier** should be: NAIP (cached forever per parcel), Sentinel-2 (auto-refresh monthly, more often during change events), Landsat (on-demand for >5-yr baseline). That's three free or near-free providers covering 95% of the use cases. **No customer should ever see "vision-ai" without a real NAIP tile underneath**.

Add `server/services/providers/naip-provider.ts`, `sentinel-provider.ts`, `landsat-provider.ts` mirroring the Attom shape (tier-aware, cache-backed, circuit-breaking). The schema field already exists: `satelliteSnapshots.provider` accepts strings.

---

## 3. The four functions that have to become real

In priority order, by user-visible damage.

### 3a. `computerVision.calculateNDVI` (`computerVision.ts:76-94`)

Currently `min + ((seed % 10000) / 10000) * (max - min)` derived from a URL hash. **NDVI is the single most useful pixel-derived number on a parcel**: it's the proxy for crop health (Frederick), pasture quality (Della's cow-calf cover), timber-stand vigor, and the leading indicator of clear-cut events. Wiring it correctly is **literally an arithmetic function** on two band reads:

```ts
// Sentinel-2 L2A: B08 (NIR, 10 m) and B04 (Red, 10 m)
// NAIP: band 4 (NIR) and band 1 (Red)
// Read parcel-clipped tiles via gdal/cog-reader, mask cloud (S2 SCL band) or NDWI shadows,
// compute pixelwise (NIR - Red) / (NIR + Red), aggregate within parcel polygon.
```

A 4-day Python (or rasterio-via-Worker) build replaces a placebo with a real number. **Della's request for "stand age proxy from imagery" reduces to a multi-year NDVI trajectory** — a 12-yr loblolly NDVI saturates near 0.85 by mid-summer; a 5-yr stand sits at 0.55. AcreOS's existing time-series schema (`satelliteSnapshots`) is the right shape; just give it real numbers.

### 3b. `visionAI.detectChanges` (`visionAI.ts:323-388`)

Currently: pass two image URLs to GPT-4V, ask it to JSON-describe the diff in English. **GPT-4V is not a change detector**. It hallucinates "I see new construction in the upper-right" against blank tiles in QA. The right architecture is the one already partially scaffolded in `computerVision.compareBeforeAfter` plus `satelliteImageUpdate.ts`'s `ChangeMetrics`:

1. Pull two parcel-clipped Sentinel-2 (or NAIP) tiles aligned to the same boundary.
2. Compute per-pixel differences on three indices: NDVI (vegetation), NDBI (built-up: SWIR/NIR), NDWI (water).
3. Threshold + connected-components to extract change polygons.
4. Classify each polygon: NDVI drop ≥0.25 over ≥0.25 ac → **vegetation removal / clear-cut / harvest**. NDBI gain ≥0.15 over a sub-acre cluster → **new structure / impervious surface**. NDWI swing → **flood / drawdown**.
5. *Then* — and only then — pass the change polygons + before/after crops to GPT-4V for a human-readable summary. Use the LM as a narration layer, not a detection layer.

This matters for product reasons. A Vesta-style hunting-tract operator gets a real "your neighbor clear-cut 18 acres on the north boundary in March" alert. A Della-style timberland operator gets "your stand thinned: pre-NDVI 0.78 → post 0.62, est 30% basal-area removal — verify against your last forester's report." A Frederick-style farmland operator gets "irrigation pivot dropped to dryland NDVI for the SE 80 in late June — confirm pump status." None of these come out of GPT-4V. All of them come out of two 10-meter rasters and an arithmetic kernel.

### 3c. `computerVision.detectBoundaries` (`computerVision.ts:51-70`)

Currently: hash-of-URL → fake polygon. The fix here is *not* a custom CV model — it's a triangulation layer. AcreOS already has authoritative parcel polygons via Regrid + state GIS sources. The boundary-from-imagery problem is really three sub-problems:

1. **Boundary verification** — does the deeded polygon *match what's on the ground*? Run a Sobel/Canny edge detection on the NAIP tile at parcel edges; flag mismatches > 5 m as candidate **encroachment**, **fence-out-of-place**, or **stale GIS**. This is genuinely high-value: encroachment claims, adverse-possession risk, neighbor disputes (Alaric's bread and butter).
2. **Improvement footprints** — segment buildings inside the polygon (Mask R-CNN on NAIP, ~93% IoU on rural structures with a 200-image fine-tune; or use the public **Microsoft Building Footprints** dataset which already covers CONUS). Cross-check against assessor improvement count for tax-assessment-discrepancy alerts (Bartholomew's audit case).
3. **Access** — line-segment Hough on roads and trails, with a public-road join to OSM. The "no road frontage" parcel that secretly has a logging trail is a $30K finding.

Microsoft Building Footprints + OSM is **free and CONUS-complete** — there is no excuse for shipping fake polygons when authoritative ones can be ingested in a weekend.

### 3d. `visionAI.analyzePhoto` — quality, not classification

The user-uploaded property photo flow (`field-scout.tsx` → `visionAI.analyzePhoto`) is conceptually fine — these are *Aurelio's* knee-deep-in-johnsongrass field photos, not satellite. GPT-4V is acceptable here as a feature extractor for marketing copy. **But it is currently the only real model in the stack**, which gives a misleading impression that vision-AI works. Re-scope this surface as **listing-photo intelligence** — quality, marketability, hero-shot picking. Stop having it answer questions ("is there water") that the actual satellite layer should answer with infinitely higher precision.

---

## 4. AcreOS-specific high-leverage CV problems

These are problems where having a proper imagery pipeline lets AcreOS ship features no land CRM in the market has.

### 4a. Timber stand age + species classification — **the Della unlock**

Della's deal-killer (`della-georgia-timber.md` §7) is that AcreOS treats a 28-yr loblolly stand the same as bare land. CV solves this. Inputs: NAIP NIR, Sentinel-2 multi-temporal NDVI trajectory, NLCD land-cover, USDA Forest Service stand-data raster (free). Output per parcel: dominant species (loblolly / slash / longleaf / hardwood / mixed), age cohort estimate (±3 yr), basal-area proxy. Train on **FIA (Forest Inventory & Analysis)** plot data from USDA — they ship 130,000+ georeferenced plots with full species/age/basal-area, which is the largest ground-truth labeled forestry dataset in the world, and **free**. A ResNet-50 fine-tuned on FIA → NAIP achieves ~76% age-class top-1 in published literature. That is more than enough to flag "this stand is 25-30 yr — call your forester before listing."

This single feature is what flips Della from $20 trial to $49 paying. It does not require Maxar; it requires NAIP, FIA labels, and a 4-week ML build.

### 4b. Trail-cam wildlife classification — **the Vesta unlock**

Vesta's request (`vesta-hunting.md` §5) for SD-card bulk import + auto-cull of 1,400 photos to the 60 antlered-buck shots is a **textbook image classification problem with a fully-solved open-source model**. Use **MegaDetector v5** (Microsoft AI for Earth, MIT license) — it ships pretrained on 12M+ camera-trap images across global ecosystems, runs at ~30 fps on a single GPU, and outputs `animal | person | vehicle | empty` with bounding boxes. Stack a second-stage species classifier on top using **Wildlife Insights API** (free for non-commercial; paid tier for AcreOS) which does deer / hog / turkey / coyote / etc. at >90% on Southeastern fauna.

Antler-vs-doe discrimination is the only custom-model layer needed; a fine-tuned EfficientNet-B0 on ~5,000 deer crops hits >95% (deer with antlers is a topologically distinct class). Buck individual ID ("Tank") is harder — that's effectively re-ID, ~80% with current open models, "good enough to suggest, human-verify."

**Deployment shape:** server-side queue, on bulk SD-folder upload to a parcel. Process at 200 photos/min on a single T4. Cull view shows the 5% of photos with `animal=true && score>0.6 && has_antlers=true`. That's a 4-hr Sunday ritual collapsed to 15 minutes — exactly what Vesta asked for.

Privacy face-blur (Vesta §5.4): MegaDetector already returns `person` boxes; pipe through OpenCV Gaussian blur on those boxes before any export bundle. Two-line addition.

### 4c. Aurelio-side: parcel-from-photo reverse lookup

Aurelio's audit flagged a real bug (`aurelio-field-mobile.md` §4): photos use the *lead's* parcel, not the GPS-derived parcel. CV adds a verification: at upload, run a quick "is this image consistent with the GPS-claimed parcel" check — compare hue/cover statistics against the cached NAIP tile for that parcel. If a photo says `lat/lng = parcel A` but its color profile screams "row crop" while parcel A is forested in NAIP, flag for review. Catches both data-entry mistakes and the user-standing-across-the-road case.

### 4d. Encroachment and unauthorized-use detection — the moat feature

This is the AcreOS-defining feature nobody else has. Take the deeded parcel polygon (Regrid). Take the Microsoft Building Footprints layer. Spatial-difference: are there building footprints **across the parcel boundary, on the neighbor's land, within 25 ft of the line**? That's a candidate encroachment — neighbor's barn 6 ft over the line, neighbor's pole shed straddling the easement. Same logic for fences (Hough lines on NAIP). Same logic for active land use (cropped rows extending past the boundary into your client's parcel = unauthorized cultivation, real money in the West).

Pipeline: every parcel ingest fires a one-time "encroachment scan." Re-runs annually on NAIP refresh. Surfaces as a parcel-detail tile: "1 candidate encroachment — neighbor structure 3.4 ft over north line. [Review]." This is a $200/parcel survey deliverable being given away for $0.04 of compute. Alaric's disputes practice would print the report.

### 4e. Solar-panel + cell-tower + billboard detection

Della (§3) mentioned cell-tower and solar leases. These are visible from space. Solar-panel arrays have a distinctive spectral signature (low NIR, high blue, regular-grid). Cell towers cast a circular ground-clearance footprint. Billboards are a structure-near-highway pattern. Each is a one-class detector, each unlocks a "passive income that runs with the land" disclosure on the listing. None require Maxar; all are doable on NAIP.

---

## 5. Schema reality-check

What's in `shared/schema.ts:9789` (`satelliteSnapshots`) and `:10546` (`satelliteAnalysis`) is correct in spirit. Three additions:

```ts
satelliteSnapshots:
  + bbox: jsonb // [minX, minY, maxX, maxY] for parcel-clipped tile lookup
  + bandCount: integer // 3=RGB, 4=RGB+NIR, 13=Sentinel-2 full
  + cogUrl: text // Cloud-Optimized GeoTIFF location for tile-server pulls
  + maskUrl: text // cloud/shadow mask sidecar (S2 SCL or QA-band)
  + license: text // public_domain | cc-by | commercial
  + costCents: integer // 0 for NAIP, real for Planet/Maxar; tier-gating

satelliteAnalysis:
  + indices: jsonb // { ndvi, ndbi, ndwi, nbr, evi } per snapshot
  + changePolygons: jsonb // GeoJSON FeatureCollection with class+severity+area
  + segmentationUrl: text // PNG mask URL for visual overlay

new table: trail_cam_photos
  // (Vesta's §5 — this needs to exist as a separate type from propertyPhotos
  //  because volume, lifecycle, and privacy are all different)
```

Also: `propertyPhotos.gpsCoordinates` is `{lat, lng}` only — store **bearing + accuracy** (Aurelio captures both); these matter for reverse-parcel verification.

---

## 6. The 8-week vision-AI sprint

### Week 1 — kill the placebos, ship truth
- Mark the current `/vision-ai` page as `BETA — sample data` until real providers wire (no more theatre)
- Replace `Math.random()` NDVI in `satelliteImageUpdate.ts:65` with **NaN until provider wired** — "no data yet" beats "fake data"
- Same for `computerVision.heuristicPropertyAnalysis`: return `confidence: null, source: 'unavailable'`

### Week 2-3 — NAIP provider
- `server/services/providers/naip-provider.ts` — pull from USDA NRCS S3 (`s3://naip-source-cog/*`), cache parcel-clipped COG per parcel
- One-time backfill: every existing parcel gets a NAIP tile
- Parcel-detail tile shows real aerial imagery

### Week 4 — Sentinel-2 provider + real NDVI
- `sentinel-provider.ts` against `s3://sentinel-s2-l2a-cogs/`
- `computerVisionService.calculateNDVI` reads two bands, returns real number
- Wire into `satelliteImageUpdate` job — monthly auto-refresh, real change scores

### Week 5 — Building Footprints + boundary verification
- Ingest Microsoft Global Building Footprints (CONUS subset, ~130M polygons, GeoJSONL)
- Spatial-join against parcel polygons → encroachment candidate flags
- Parcel-detail "Encroachment scan" tile

### Week 6 — Real change detection
- Replace `visionAI.detectChanges` GPT-4V call with index-difference + connected-component algorithm
- GPT-4V kept *only* as a narration layer over real change polygons
- Portfolio Sentinel alerts get real bodies

### Week 7 — Trail-cam (Vesta unlock)
- New `trail_cam_photos` table + bulk-folder upload UI
- MegaDetector v5 server-side classifier (Python + ONNX runtime, single GPU)
- Antlered/doe fine-tune on existing user data
- Privacy face-blur on export

### Week 8 — Timber stand age (Della unlock)
- Train a NAIP+Sentinel time-series model on FIA plot ground truth
- Per-parcel "Estimated stand age" tile + species hint
- Caveat with confidence interval; never display as fact

---

## Appendix — files I read

- `/Users/user/AcreOS/AcreOS/server/services/visionAI.ts` — 589 lines; OpenAI-Vision wrapper + change-detection-by-LM. Replace change-detection logic, keep photo-quality scoring.
- `/Users/user/AcreOS/AcreOS/server/services/computerVision.ts` — 294 lines; Python YOLOv8 subprocess that doesn't exist + heuristic fallbacks based on URL hash. **The most "fake it til you make it" file in the repo.**
- `/Users/user/AcreOS/AcreOS/server/jobs/satelliteImageUpdate.ts` — 200+ lines; correct topology, mocked provider (`fetchSatelliteImagery` at :49), random NDVI at :65.
- `/Users/user/AcreOS/AcreOS/shared/schema.ts:9706` (`propertyPhotos`), `:9750` (`photoAnalysis`), `:9789` (`satelliteSnapshots`), `:10546` (`satelliteAnalysis`) — schema is sound, just needs the additions in §5.
- `/Users/user/AcreOS/AcreOS/server/routes-vision-ai.ts` — REST surface, fine.
- `/Users/user/AcreOS/AcreOS/server/routes-vision-scan.ts` — second vision route file; consolidate.
- `/Users/user/AcreOS/AcreOS/server/routes-portfolio-sentinel.ts` — alert/monitor topology already exists, well-shaped for change-detection-driven alerts once the imagery is real.
- `/Users/user/AcreOS/AcreOS/client/src/pages/vision-ai.tsx` — Before/After slider component is genuinely well-built (a11y-correct, keyboard-driven). Worth keeping.
- `/Users/user/AcreOS/AcreOS/server/services/providers/` — Attom/BatchData/Regrid/open-data; **no imagery category yet**. Add NAIP, Sentinel-2, Landsat, optionally Planet/Maxar at higher tiers.
- `/Users/user/AcreOS/AcreOS/tests/unit/visionAI.test.ts` — pure-helper tests including `hasTimber` boolean. Right idea; expand to species + age once real models ship.

---

*— Ingrid Christiansen*
*Pixels are testimony. Right now AcreOS is testifying about pixels it has not actually seen. Wire NAIP first, ship truth before stories.*
