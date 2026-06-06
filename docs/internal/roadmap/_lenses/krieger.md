# Krieger — Customer-Surface UX lens on the data roadmap

**Author:** Krieger Voss, Customer-Surface UX
**Date:** 2026-06-06
**Lens:** How open-source parcel/land data *renders* across viewports, themes, and input modes. The map door, parcel cards, soil/flood/topo overlays, and every loading/empty/error state in between. Make free data feel premium and effortless on a 390px iPhone at 7am AND a 27-inch monitor at 3pm.

The standard, applied to data: a customer should never be able to tell that the flood overlay is a free FEMA raster and not a $400/mo Regrid feed. The *felt* quality is in the loading choreography, the legend, the attribution, the empty states, and the fact that nothing ever silently fails.

---

## What I found in the repo (grounded)

The bones are good and the open-data plumbing already exists. Findings, with files:

1. **The overlays are already free open data** — `client/src/components/property-map.tsx:48-53` wires FEMA NFHL flood, USGS NLCD land-use, USDA Cropland (CDL), USDA CLU, USGS hillshade, and USGS Topo straight from public ArcGIS `export` endpoints. Plus Mapbox vector terrain contours + DEM hillshade. This is *exactly* the free-tier-feels-premium substrate the founder wants. **But the UX around these layers is thin.**

2. **Overlay loading is faked and inconsistent.** Only FEMA has a loading affordance, and it's a lie: `setTimeout(() => setFemaLoading(false), 1000)` at `property-map.tsx:954` — a fixed 1s spinner that has no relationship to whether the raster tiles actually arrived. The other ~9 toggleable overlays (zoning, cropland, CLU, hillshade, slope, contours, OSM buildings) flip on with **zero** loading feedback. On a throttled 4G phone a USDA tile can take 4-8s; the toggle looks broken.

3. **Tile errors are swallowed silently.** `property-map.tsx:2969` — `mapInstance.on("error", () => { /* suppress to avoid console spam */ })`. When a free county/federal GIS server is down (and they go down — FEMA NFHL and the USDA WMS both have rough SLAs), the overlay simply never appears and the customer gets *nothing*: no toast, no "this layer is temporarily unavailable," no retry. This is the single biggest felt-quality gap in the whole data story. Free data's reliability problem becomes the customer's confusion problem.

4. **No overlay legend.** The only legend in the file is the deal-status pin legend (`property-map.tsx:2540`). A FEMA flood raster is a wash of blue/orange polygons with no key; an NLCD land-cover raster is a rainbow with no key; the slope-gradient hillshade is "dark red = steep" (`property-map.tsx:904`) but the customer is never told that. Premium data products *always* ship a legend. Ours renders colored mystery.

5. **The Map-door intelligence panel is mostly synthetic fallback data.** `client/src/pages/maps.tsx:276-300` — `PropertyIntelligencePanel` fills slope, solar, flood zone "X", soil quality 65, etc. with hardcoded defaults when the AVM endpoint returns nothing. The flood ScoreRing, the Environmental Risk Radar, the slope-aspect tooltip (`getSlopeAspectLabel((lat*13.7 + lng*7.3) % 360)` at `maps.tsx:565` — a *fabricated* azimuth from a hash of coordinates). This is the opposite of premium: it's confidently-wrong data with no provenance. A first customer who knows their own parcel will catch the fake number and lose trust in everything else. We must label provenance and show honest empty states, not invent values.

6. **Customer-facing env-var leak.** `property-map.tsx:2092-2097` — the unconfigured-map fallback literally prints `"Please configure VITE_MAPBOX_ACCESS_TOKEN, or set VITE_MAP_ENGINE=maplibre"` to the customer. That's a developer string on a customer surface. Violates the "no copy-from-screenshot / truth-engine" posture and looks broken.

7. **Map-door panel is desktop-only.** `maps.tsx:1290` renders `PropertyIntelligencePanel` as a fixed `w-80` left-bordered side panel (`maps.tsx:306`). On a 390px phone there's no room for an 320px panel beside the map. Tapping a pin on mobile needs a bottom sheet, not a side panel. The parcel *detail* page handles mobile via `MobilePropertyDetail`, but the **Map door's** selected-pin experience does not — this is the highest-volume mobile path (driving-for-dollars) and it's the least mobile-considered.

8. **Overlay state isn't keyboard- or screen-reader-legible.** The layer toggles live in a Collapsible with checkboxes (good), but there's no live-region announcement when a layer finishes loading or fails, and the slope/flood color semantics are conveyed by color alone (WCAG 1.4.1 use-of-color failure).

---

## Top work items (priority order)

### 1. Honest overlay lifecycle: real loading + real error + retry, per layer
- **Why it matters to first customers:** This is the make-or-break for "free data feels premium." Free GIS servers are flaky; a silent failure makes the whole app feel broken. A graceful "Flood layer is taking a moment…" → "Couldn't reach FEMA right now — retry" turns a free-data weakness into a moment of polish and honesty.
- **Goal:** rock-solid (+ flawless-ux)
- **Effort:** M
- **Phase:** 0
- **Dependencies:** none — pure client work on the existing layer machinery.
- **First step:** Replace the swallow at `property-map.tsx:2969` with a handler that inspects `e.sourceId`, maps it back to the owning layer, and routes to per-layer state. Wire MapLibre/Mapbox `sourcedataloading` / `sourcedata` / `error` events to a `Record<layerId, "loading"|"ready"|"error">`. Kill the fake `setTimeout` at `:954`. Render a small status chip per enabled layer in the layer panel (spinner / check / retry button). Add a one-line toast on first error per layer per session (debounced — don't spam carrier-NAT-shared sessions).

### 2. Overlay legend component (theme-aware, per active layer)
- **Why it matters:** A flood/soil/land-cover raster with no key is decoration, not intelligence. The legend is what makes a customer say "oh, this is real data." It's also the cheapest credibility upgrade we can ship.
- **Goal:** flawless-ux (+ data)
- **Effort:** M
- **Phase:** 0
- **Dependencies:** #1 (so legend only shows for successfully-loaded layers).
- **First step:** New `client/src/components/maps/OverlayLegend.tsx`. Hardcode the FEMA NFHL zone palette (AE/A/X/VE…), the NLCD land-cover classes, and the slope-gradient ramp from `property-map.tsx:904` (dark-red=steep → white-green=flat) so the legend matches the actual paint. Float it bottom-left, collapsible, with a count of active layers. Resolve all swatch colors from CSS vars so it survives the 10 theme×mode combos. Add `aria-label` text describing each band (fixes the color-only WCAG failure).

### 3. Mobile selected-pin experience on the Map door (bottom sheet, not side panel)
- **Why it matters:** Driving-for-dollars is the #1 mobile use case and the Map door's pin-tap currently has no mobile-fit surface — the `w-80` side panel at `maps.tsx:1290`/`:306` is unusable below ~700px. This is the single highest-volume customer mobile path.
- **Goal:** flawless-ux (+ happier-customers)
- **Effort:** M
- **Phase:** 0
- **Dependencies:** none.
- **First step:** In `maps.tsx`, branch on `useIsMobile()`: on mobile render `PropertyIntelligencePanel`'s content inside a `Sheet side="bottom"` (snap to ~55dvh, drag-to-expand to full) instead of the side div. Honor `env(safe-area-inset-bottom)` so it clears the home indicator and the 72px bottom nav. Verify the close button + all Quick-Action buttons hit 44×44 (the close button at `maps.tsx:329` is good — `min-h-11 min-w-11` — keep that pattern for the rest).

### 4. Data provenance + honest empty states in the intelligence panel
- **Why it matters:** Fabricated values (`maps.tsx:565` slope-aspect-from-hash, hardcoded soil 65, flood "X" default) are a trust bomb with a real customer who knows their parcel. Premium = honest. Show "—  ·  not yet pulled" with a "Fetch from county/FEMA/SSURGO" CTA instead of a confident fake number, and a tiny source tag ("FEMA NFHL", "USDA SSURGO") under real values.
- **Goal:** happier-customers (+ data)
- **Effort:** M
- **Phase:** 0→1
- **Dependencies:** coordinate with whoever owns the AVM/enrichment provider payload (Iris/Andrei) so each field can carry a `source` + `asOf`. UX can ship the empty-state + source-tag pattern first against a `source?: string` field that's initially null.
- **First step:** In `PropertyIntelligencePanel` (`maps.tsx:243`) stop coalescing to magic numbers in the `intel` useMemo (`:276-300`). Where the AVM returns nothing, render an explicit `EmptyState`-style "pull this data" affordance per section. Delete the synthetic slope-aspect hash entirely — show aspect only when real terrain data exists.

### 5. Kill the customer-facing env-var leak in the map fallback
- **Why it matters:** A customer seeing `VITE_MAPBOX_ACCESS_TOKEN` thinks the product is half-built. Tiny fix, outsized credibility cost if a first customer hits it.
- **Goal:** flawless-ux
- **Effort:** S
- **Phase:** 0
- **Dependencies:** none.
- **First step:** `property-map.tsx:2087-2101` — replace dev strings with a customer-safe "Map is temporarily unavailable — retry" + a refetch button. Log the real cause via `clientLogger`, never render it. Keep the dev hint behind `import.meta.env.DEV`.

### 6. Overlay performance budget on mobile (lazy-load + tile throttling cues)
- **Why it matters:** Stacking FEMA + NLCD + CDL + hillshade rasters on a throttled phone blows the LCP/TTI budget (mobile LCP < 2.5s is my floor). Customers toggle three layers, the map jank-stalls, it feels cheap.
- **Goal:** rock-solid
- **Effort:** S→M
- **Phase:** 1
- **Dependencies:** #1 (need the load events first to measure).
- **First step:** Cap concurrently-active raster overlays (soft limit ~2-3 with a "showing N of M" hint), and persist the last-used set via the existing `LAYER_STORAGE_KEY` (`property-map.tsx:55`) so we don't auto-load heavy layers on cold open. Instrument time-to-first-tile per layer and surface it in the Krieger audit ledger.

### 7. Cross-device + theme CI contract for the data overlays
- **Why it matters:** Overlays are the most theme-fragile surface (raster colors fixed, UI chrome theme-driven). Without a gate, a theme change silently breaks legend/contrast on one of 10 combos and we ship it.
- **Goal:** foundation
- **Effort:** M
- **Phase:** 1
- **Dependencies:** #1, #2.
- **First step:** Add a `map-overlay-contracts.spec.ts` to the cross-device matrix: for each viewport×theme, toggle each overlay, assert (a) a loading state appears, (b) a legend appears once ready, (c) no overlay leaves the canvas blank with no chrome, (d) legend swatch contrast ≥ 3:1 against panel bg.

---

## The open-data theme, from my lens

The founder's instinct is right and the repo is *already living it* — every overlay in `property-map.tsx` is a free federal/state source. The gap is not sourcing; it's **felt quality around free data**. Three principles:

- **Honesty is the premium feel.** Paid data (Regrid/Zamplo) wins on coverage and uptime, not on being prettier. We can match the *felt* quality of paid data for free if — and only if — we are scrupulously honest about loading, errors, provenance, and "not yet pulled." A free overlay with a real legend, a graceful retry, and a "USDA SSURGO · as of 2024" tag feels *more* trustworthy than a paid black-box number. Confident fake values (current state) feel *worse* than any honest gap.
- **The reliability tax is a UX problem, not a data problem.** Free GIS endpoints flake. We can't fix their SLA on $0 — so the customer-facing answer is the lifecycle UX of work item #1: never silently fail, always offer retry, always show source. That single discipline converts the free tier's biggest weakness into a visible-honesty strength.
- **Phased upgrade should be invisible to the customer's mental model.** When MRR justifies Regrid/PropGrid, it should slot into the **same** provider-registry + same legend + same source-tag + same lifecycle UX (the registry at `server/services/providers/` is built for exactly this — tier filtering + credit deduction). The customer just sees the source tag change from "County GIS" to "Regrid" and coverage fill in. Build the source-tag + lifecycle UX *now* against free data so the paid upgrade is a backend swap with zero customer-surface rework. **My low-cost recommendation:** ship work items #1, #2, #4 in Phase 0 — they cost only engineering time, require no paid feeds, and make today's free data indistinguishable from tomorrow's paid data in felt quality.

---

## Quick wins (ship this week)

- **Kill the env-var leak** (`property-map.tsx:2087`) — 15 min, removes a "looks broken" moment.
- **Delete the fake FEMA `setTimeout` spinner** (`property-map.tsx:954`) — stop lying about load state even before the full lifecycle work lands.
- **Add source tags under the real values** in the intelligence panel (FEMA/USGS/USDA) — pure presentational, instant credibility.
- **Add `aria-label`s describing the slope/flood color semantics** — fixes the WCAG color-only failure for screen readers and is a one-line-per-element change.
- **Persist + don't auto-load heavy overlays on cold map open** — flip the `DEFAULT_LAYER_STATE` heavy rasters to off (most already are; verify cropland/hillshade) so first paint is fast on mobile.

---

## Biggest risk if my area is ignored

**A first customer toggles the flood layer on their own parcel, it silently fails (free FEMA server hiccup) or shows a fabricated flood-zone "X," and they immediately stop trusting every number in the app.** The data story is the centerpiece of the pitch — if the *rendering* of that data is silently-failing, legend-less, or quietly fake, the free-data strategy backfires: instead of "wow, this is premium for free," the customer concludes "this is a cheap tool with made-up data." We don't get a second first-impression with our first paying customers. The fix is cheap (lifecycle UX + legend + honesty), requires zero paid feeds, and is the difference between the open-data bet feeling premium and feeling broken.
