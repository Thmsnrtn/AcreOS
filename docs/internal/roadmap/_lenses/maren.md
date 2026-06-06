# Maren's Lens — CPO: Data Features That Move First-Customer Happiness

**Author:** Maren Solberg, CPO
**Date:** 2026-06-06
**Lens:** Ruthless MVP scoping of the parcel/land-data feature set. Must-have vs nice-to-have. Sequencing. What NOT to build yet.
**Standard:** Every item below carries a hypothesis, a smallest test, and a kill criterion. No feature ships on "investors will love it."

---

## The one-paragraph thesis

We already have a genuinely good open-data substrate — FEMA NFHL flood, SSURGO soils, USFWS wetlands, USGS 3DEP elevation, Census ACS + TIGER, NLCD land cover, USGS water — all wired through `server/services/data-source-broker.ts` and exposed via the `open-data` provider at cost 0. The engineering is largely *done*. The product problem is not "build more data sources." It is three things, in order: **(1) coverage** — county GIS parcel lookup is seeded for ~25 counties across 10 states (`seedCountyGisEndpoints` in `server/services/parcel.ts`), which means most first customers will type an APN and get nothing; **(2) trust** — `client/src/pages/maps.tsx` *fabricates* data when real lookups are absent (`floodZone ?? "X"`, `soilQuality ?? 65`, `slopeGrade ?? Math.abs(Math.sin(lat*0.1)*15)`), which is the single most dangerous thing in the product for a land investor making a buy/no-buy call; and **(3) legibility** — the open data we *do* have never shows the customer where it came from, how fresh it is, or how confident we are, so it reads as a black box. Fixing those three, in that order, makes the free tier feel premium without spending a dollar on Regrid/Zamplo/PropGrid.

---

## Top work items (prioritized)

### 1. Kill all synthetic data fallbacks on the Map intel surface
- **Goal served:** rock-solid + happier-customers (trust is the product).
- **Phase:** 0. **Effort:** S.
- **Hypothesis:** First customers will trust *fewer, honestly-labeled real fields* more than a complete-looking dashboard with fabricated numbers. If a customer ever catches one invented value (a "Flood Zone X" on a parcel that's actually in AE, a `Math.sin`-derived slope), they discount the entire platform — and for land deals that mistake is a five-figure error.
- **Smallest test:** Replace every `?? <hardcoded>` in the `intel` useMemo in `maps.tsx` (lines ~280–300) with explicit `null` + an "Unknown — not yet looked up" state. Ship to the first 3 customers.
- **Expected signal / success threshold:** Zero "the data was wrong" support contacts in first 30 days. Kill criterion: if honest-nulls cause customers to perceive the product as *empty* rather than *honest* (measured by activation drop), we add a "Look up real data" CTA rather than re-introducing fakes — we never re-introduce fakes.
- **Dependencies:** none.
- **First step:** Edit `client/src/pages/maps.tsx` lines 284–294; audit `comp-map-overlay.tsx` and `property-map.tsx` for the same pattern.

### 2. Data provenance + freshness chrome on every enrichment value
- **Goal served:** flawless-ux + happier-customers.
- **Phase:** 0–1. **Effort:** M.
- **Hypothesis:** Free open data *feels premium* when the customer can see it's authoritative. "Flood: Zone X — FEMA NFHL, layer effective 2024-03" beats "Flood: X" every time. The `LookupResult` already carries `provider`, `confidence`, `fetchedAt`, `cached` (`server/services/providers/types.ts`) — we just throw it away before render. `property-enrichment-widget.tsx` shows *zero* provenance today (grep confirmed).
- **Smallest test:** Add a small "source + as-of" line under the three highest-stakes cards (Flood, Soil, Wetlands) in `property-enrichment-widget.tsx`. A11y: source line is real text, not a tooltip-only.
- **Success threshold:** In a 5-customer interview, ≥4 spontaneously reference a source/date as a reason they trust a value. Kill criterion: if no one notices or values it after 30 days, demote to a single global "Data sources" disclosure instead of per-card.
- **Dependencies:** the enrichment route must pass `provider`/`fetchedAt`/`confidence` through to the client (currently flattened in `propertyEnrichmentService`).
- **First step:** Trace `enrichProperty` output shape in `server/services/property-enrichment.ts` → ensure `source` + `asOf` survive to `enrichedFields`; render in `property-enrichment-widget.tsx`.

### 3. County GIS coverage as a first-class, visible product surface
- **Goal served:** happier-customers + data.
- **Phase:** 0–1. **Effort:** M (data ops, not eng).
- **Hypothesis:** The #1 reason a first customer's APN lookup returns nothing is that their county isn't seeded (25 counties / 10 states today). Coverage breadth in the states our *actual first customers* operate in beats coverage depth anywhere. We don't know which states those are yet — so coverage should be demand-pulled, not pre-built nationwide.
- **Smallest test:** Add a "Request your county" affordance when `lookupFromCountyGIS` returns no endpoint, capturing (state, county). When a real customer hits it, hand-seed that county's ArcGIS REST endpoint within 48h (the seeding mechanism already exists — `seedCountyGisEndpoints`). This is a Wizard-of-Oz coverage engine.
- **Expected signal:** Which counties get requested = the coverage roadmap, written by customers. Success threshold: median request-to-coverage < 48h for first 10 requests. Kill criterion: if <2 counties get requested in 30 days, county-GIS demand is lower than assumed and we lean harder on coordinate-based open data (flood/soil/elevation, which need no county seeding).
- **Dependencies:** item 2 (so a freshly-seeded county shows provenance immediately).
- **First step:** Add the no-endpoint capture in the `parcel-detail` / lookup error path; store requests in a tiny table; Solene/Iris triage seed.

### 4. The "Land Snapshot" — one bundled, free, decision-grade view
- **Goal served:** happier-customers + flawless-ux.
- **Phase:** 1. **Effort:** M.
- **Hypothesis:** Investors don't want nine cards; they want *one answer to "should I look harder at this parcel?"* A single bundled snapshot — acreage, flood zone, wetlands %, soil capability class, slope, road/water/power flags, each with source + confidence, and an honest "what we don't know" list — is the premium feeling Regrid sells, assembled entirely from free sources we already query.
- **Smallest test:** Compose existing broker outputs (flood + soil + wetlands + elevation/slope) into one server-assembled `LandSnapshot` object behind the existing enrich route; render as the top section of `parcel-detail.tsx` overview tab. No new data sources.
- **Success threshold:** ≥60% of parcel-detail views in first 30 days expand/engage the snapshot; ≥1 customer interview names it as a reason to keep paying. Kill criterion: <20% engagement at 60 days → fold back into the card grid.
- **Dependencies:** items 1 + 2 (honest values + provenance are prerequisites — a bundled view of fabricated data is *worse* than scattered cards).
- **First step:** Define `LandSnapshot` type; assemble in `property-enrichment.ts`; render in `parcel-detail.tsx` overview.

### 5. Cache-first enrichment so the free tier is fast, not just free
- **Goal served:** flawless-ux + rock-solid.
- **Phase:** 1. **Effort:** S–M.
- **Hypothesis:** Open APIs (FEMA, SSURGO, Census) are slow and rate-limited; a 6-second enrichment feels cheap even when the data is excellent. `provider_cache` exists and the registry supports it — we should aggressively pre-warm on parcel-create and serve cache-first with a background refresh, so the customer's *perception* is instant.
- **Smallest test:** On property create, fire-and-forget a coordinate-based open-data enrich (flood/soil/elevation need only lat/lng — no county seeding). By the time the customer opens the parcel, it's warm.
- **Success threshold:** p75 parcel-detail "data visible" time < 800ms on a warm parcel. Kill criterion: if pre-warm cost (API rate limits / job load) exceeds the perceived-speed benefit, fall back to on-open with a good skeleton.
- **Dependencies:** runs on the worker (`runScheduledJobs.ts` / job infra per deploy arch).
- **First step:** Hook coordinate-enrich into the property-create path; confirm `provider_cache` TTL semantics in the registry.

### 6. Confidence-aware diligence checklist (data feeds the workflow)
- **Goal served:** happier-customers + data.
- **Phase:** 2. **Effort:** M.
- **Hypothesis:** The diligence checklist already has "Flood zone check" / "Environmental review / wetlands" items (`shared/schema.ts` ~3682). If our free data can *auto-satisfy or pre-flag* those items ("FEMA says Zone X — likely clears; verify"), the data stops being a lookup and becomes the workflow. That's the retention hook.
- **Smallest test:** Auto-annotate the two environmental checklist items with the latest open-data result + confidence; leave the check-off to the human.
- **Success threshold:** ≥40% of diligence checklists in target cohort show the auto-annotation engaged. Kill criterion: <15% → keep data and checklist separate.
- **Dependencies:** items 1, 2, 4.
- **First step:** Map broker categories → checklist item IDs; annotate at render in the diligence tab.

### 7. Pax answers grounded in real parcel data, with citations
- **Goal served:** happier-customers + flawless-ux.
- **Phase:** 2. **Effort:** M.
- **Hypothesis:** Customers will ask Pax "is this parcel buildable / floody / wet?" The answer is only trustworthy if Pax cites the *real* open-data result and refuses to guess when data is absent. This is where honest-nulls (item 1) pay off: Pax says "I don't have flood data for this parcel — want me to look it up?" instead of hallucinating.
- **Smallest test:** Give the Pax tool layer read access to the assembled `LandSnapshot` (item 4) with mandatory source citation; explicit "no data" path.
- **Success threshold:** Zero unsourced factual parcel claims in a 50-conversation audit. Kill criterion: this is a Beatrice compliance gate, not a soft metric — unsourced claims block ship.
- **Dependencies:** items 1, 2, 4; Beatrice pre-clearance.
- **First step:** Inventory current Pax parcel-tool context in `routes-ai.ts`; add snapshot + citation contract.

---

## The open-data theme, from the product lens

The instinct will be to chase breadth — "let's add USGS this, BLM that." Resist it. The customer-value curve of open data is steep at the front (flood + soil + wetlands + acreage + slope + road/water/power = the buy/no-buy decision) and flat after. **Six fields decide a land deal.** We already query all six. The product job is to make those six *trustworthy, fast, and legible*, not to add a seventh.

"Make the free tier feel premium" decomposes into exactly three levers, none of which cost money:
1. **Honesty** (item 1) — never fake a value; a real "Unknown" outperforms a fake number.
2. **Provenance** (item 2) — "FEMA NFHL, as-of 2024" is what premium feels like.
3. **Composition** (item 4) — one decision-grade snapshot, not a data dump.

The paid-data upgrade path (Regrid/Zamplo/PropGrid) is already architecturally clean: the provider registry does tier-filtering + credit deduction + priority ordering, and `county-gis` is wired at priority 5 so it's *tried before* paid Regrid (priority 30). That means when MRR justifies it, paid data slots in as a higher-confidence fallback **with no UI rewrite** — the provenance chrome (item 2) simply starts saying "Regrid" with confidence 95 instead of "County GIS" at 80. So the phased path is: **Phase 0–1 free only → Phase 2 add ATTOM/Regrid as paid fallback gated behind a tier (the plumbing exists) → Phase 3 owner/skip-trace paid categories.** Do not pre-build any paid integration UX now.

---

## Quick wins (ship this week, near-zero cost)

- **Remove the synthetic fallbacks in `maps.tsx`** (item 1) — highest trust-per-line-of-code edit in the repo.
- **Surface `confidence` + `fetchedAt` on the three highest-stakes enrichment cards** (Flood / Soil / Wetlands) — the data is already in `LookupResult`, we just drop it.
- **Add a "Request your county" capture** on the no-endpoint lookup path — turns our biggest coverage gap into a customer-authored roadmap.
- **Add an honest "What we don't know yet" line** to the enrichment widget — lists categories with no result, which paradoxically *increases* trust in the ones we do show.

## What NOT to build yet (explicit cuts)

- **No nationwide county GIS pre-seeding.** Demand-pull it (item 3). Seeding 3,000 counties speculatively is a data-ops sinkhole before we know which 5 states matter.
- **No paid-data integrations (Regrid/Zamplo/PropGrid) and no AVM/comps build.** The registry is ready; the *demand signal* and the *MRR* are not. The `valuation`/`comps` categories can wait for Phase 2+.
- **No new open-data sources** beyond the six decision fields (skip BLM detail, EPA detail, parcel-level census beyond tract, broadband, etc.) until the six are trustworthy + legible.
- **No map data overlays / vector tiles of parcels** yet — the point-lookup answer is the job; full parcel-fabric rendering is a Phase 2+ effort and a known MapLibre browser-verification dependency.
- **No bulk-enrichment polish.** The bulk path exists; it's a power-user feature with zero first-customer pull.

## Biggest risk if my area is ignored

**We ship a complete-looking product full of fabricated numbers and lose the first customer's trust permanently on a single bad flood zone or `Math.sin`-derived slope.** Land investors make irreversible five-figure decisions on this data. The `maps.tsx` fallbacks (`floodZone ?? "X"`, `soilQuality ?? 65`, slope via `Math.sin`) are not a cosmetic bug — they are a credibility time-bomb. One investor who buys a wetland because we showed "Wetlands: No" (when we simply hadn't looked) doesn't churn quietly; they tell every land-investing forum they're in. Honest free data is a moat. Confident fake data is an existential liability. Item 1 is non-negotiable and ships first.
