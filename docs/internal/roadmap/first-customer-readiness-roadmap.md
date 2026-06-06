# AcreOS — First-Customer Readiness Roadmap

_Synthesized by Solene, 2026-06-06, from all 11 team-member lenses + a dedicated open-data architecture deep-dive. Per-lens detail lives in `docs/internal/roadmap/_lenses/`. Founder ask: make our first customers happier, the system more rock-solid, the UX flawless — with a cross-cutting theme of best-in-class land/parcel data sourced open-source first, near-zero overhead, and a phased path to paid (Regrid/Zamplo/PropGrid) only when MRR justifies it._

---

## The one reframe everything hangs on

**We are not missing a data engine. We already built one — and it's good.** Verified in the repo: the provider registry (tier-ordered, cost-aware, circuit-breaking, `provider_cache`-backed), `open-data-provider` + `county-gis-provider` at cost $0, a 1,900-line `data-source-broker` hitting ~30 live free government endpoints (FEMA NFHL flood, USDA SSURGO soils, USFWS NWI wetlands, USGS 3DEP elevation, Census TIGER/ACS, BLM PLSS, NLCD land cover, NRI hazards, EPA, NOAA), `parcelIntelligenceFusion` that already fuses 8 sources into a Land Intelligence Score, and an `arcgis-discovery` crawler that can auto-find county parcel services. The paid providers (`regrid`, `attom`, `batchdata`) are already coded and registered as gated fallbacks.

So the work is **not "buy data."** It is four things the whole team independently converged on:

1. **Stop lying.** The UI currently *fabricates* parcel facts when a lookup is missing (`maps.tsx`: `floodZone ?? "X"`, `soilQuality ?? 65`, slope via `Math.sin(lat)`; a "proprietary model" fed hardcoded inputs). This is the single highest-severity issue in the product and the #1 thing 6 of 11 lenses flagged independently. For a land investor making five-figure decisions, a confident fake number is an existential trust + liability event. **A real "Unknown — not yet pulled" beats a fake number every time.**
2. **Unify + honor.** Two parallel data spines (registry: ~2 callers; broker: ~12–26 callers) with two caches and two failure models. Consolidate behind the registry before the first customer cements the split. And meter paid lookups against the credit pool **before** any paid provider turns on (today they're gated on balance but never deducted — a silent margin bomb).
3. **Surface provenance.** Add `source` + `asOf` + `confidence` + `classification` to every datum and show it. This is the cheapest way to make free data *feel premium* — and it's something the paid black boxes literally can't match. The metadata mostly already exists on `LookupResult`; we throw it away at the UI boundary.
4. **Retain what flows through.** Every lookup today is a cold recompute we discard. Start an append-only parcel observation log now — longitudinal county data is the one asset you cannot buy retroactively, and it's one async insert per fact.

**Strategic stance (Lena + Beatrice + Quinn agree): open data isn't the budget compromise — for land it's the *better and safer* tier.** Paid aggregators optimize for *structures* (homes/comps); land investors care about *dirt* (flood, wetlands, soil class, slope/buildability, access, PLSS) — almost all free + federal + public-domain. We lean into the dirt data the paid guys are weak on, and rent parcel-fabric + skip-trace only when MRR justifies it.

---

## The phased path to paid data (the founder's specific ask, encoded)

| Phase | MRR gate | Data posture | Monthly data COGS |
|---|---|---|---|
| **0 — now** | $0 | Free federal/public-domain + reviewed-county live-passthrough, fully attributed. Paid providers stay flag-disabled. Fix honesty, unify spines, instrument cost. | **$0** |
| **1** | $200 sustained 30d | Background enrich-all ETL into cache; demand-driven county coverage growth ($0); enable **pay-per-call skip-trace** (BatchData, no monthly floor, metered through credits). | ~$10–50 |
| **2** | $1k sustained 30d | Enable **Regrid pay-per-call** for the one thing free can't give — complete normalized parcel fabric/owner — metered + per-org capped. Owner-change/tax-delta detector goes live. | ~$60–300 |
| **3** | $5k sustained 30d | **Surgical** paid upgrades proven by the eval harness (buy the ~20% of fields that flip decisions, e.g. boundaries), never a blanket subscription. Full SRE/on-call. | ~$300–1,200 |

**Iron rules** (Lena): never sign a flat monthly data commit while pay-per-call is cheaper at our volume; refuse any vendor whose minimum monthly commit exceeds 2% of trailing MRR; the switch is a founder-settings flag flipped by a scheduled job when the math clears, not a deploy. Instrument the "free-miss by county/category" rollup **now** so the eventual buy decision is data-driven ("Regrid would have filled 38% of misses in the 12 counties our customers actually worked") — not vibes.

---

## P0 — Before customer #1 (all ~$0, mostly days not weeks)

These are the items where the team's consensus is "do not ship to a paying customer without this."

| # | Item | Owners | Effort | Why it's P0 |
|---|---|---|---|---|
| 1 | **Kill all fabricated data fallbacks** — replace every `?? <constant>` in `maps.tsx` intel panel + the `Math.sin` slope + hardcoded fusion inputs with honest "Unknown — not yet pulled" + a Check-now CTA. Add a test asserting a no-data parcel renders **zero** numeric scores. | Maren, Quinn, Krieger, Andrei | S–M | Confident fake data on a land deal is a trust + liability bomb. Highest severity in the repo. |
| 2 | **Provenance + freshness contract** — add `source`, `sourceAsOf`, `confidence`, `classification` (authoritative/estimate/modeled/unknown) to `LookupResult`; plumb through cache read/write; render a "FEMA NFHL · as of 2024 · 80%" chip. | Iris, Quinn, Krieger, Andrei, Lena | M | The cheapest "free feels premium" lever; prerequisite for honesty, eval, and the paid swap. |
| 3 | **Wire the dormant Pax hallucination guard** — `executive.ts:1753` calls `guardPaxOutput` with no source context, so it never fires. Pass `sourceNumbers` + `claimedPropertyIds`; add a `DATA_GROUNDING` prompt block (never assert a flood zone/soil/acreage you didn't retrieve; cite source + vintage; say "I don't have that"). | Andrei, Quinn | S | A confident wrong Pax data claim on a first deal ends the relationship. The guard already exists — it's just unplugged. |
| 4 | **Data-source health in the periodic loop + external uptime ping** — `healthCheckAll()` exists but nothing calls it on schedule; `checkAll()` watches DB/Stripe/etc. but not the free data that *is the product*. Fold provider health into `/api/health`; point a free uptime pinger at `/api/health/cached` → founder's phone. | Tess, Iris | S | "Twitter found out first" failure mode. Substrate exists; batteries left out. |
| 5 | **Hardened `fetchGeo` helper** — one timeout + bounded-retry + per-host concurrency limiter + contactable `User-Agent` + SSRF guard (block private IPs / non-https on operator-contributed URLs). Replace the 3 bare `fetch()` in `parcel.ts`. | Iris, Tess, Beatrice | S | Cold-start safety, polite rate-limiting (don't get IP-banned), closes a real SSRF hole. |
| 6 | **Meter paid lookups against the credit pool** — add `parcel_lookup_paid`/`comps`/`owner`/`valuation` credit actions; debit `costCents` after a paid live hit (free stays $0). Add `minMonthlyCommitCents` to the provider interface for the 2%-rule. | Lena | M | The day paid data turns on without this, every power user is a −200% to −1000% margin lane. Fix before, not after. |
| 7 | **DR restore drill** — actually restore the latest Postgres backup into a throwaway DB, time it, write the runbook with a measured RTO; confirm backups upload to real object storage (not the dev console path). | Tess, Iris | S–M | One paying customer's deals/ledger make an unrehearsed restore an existential, constitution-level liability. |
| 8 | **Data-licensing register + county "review-required" default** — `data-licenses.ts` + `license`/`attribution`/`redistributable` columns on providers & `county_gis_endpoints` (default `review-required`); render "© OpenStreetMap contributors" (ODbL); registry refuses to bulk-cache un-reviewed/`no` sources. | Beatrice, Quinn | M | Federal data is public-domain-safe; county + OSM are not. Without this we can't even *know* which rows are safe to redistribute. |
| 9 | **Activation routes to the data "aha"** — for land/hybrid personas, make "Look up your first property" the first getting-started step (today it's "add a lead"). Add a "see a sample" affordance with 3–5 curated data-rich parcels so the first lookup never returns empty. | Rafe, Krieger | S–M | The free soil/flood/wetlands map *is* our differentiator; today it's buried behind the CRM funnel. |
| 10 | **Map overlay honesty** — real per-layer loading/error/retry (kill the fake `setTimeout` spinner + the silent error swallow), a theme-aware legend, fix the customer-facing `VITE_MAPBOX_ACCESS_TOKEN` leak. | Krieger | M | Free GIS flakes; silent failure makes the whole app feel broken. Honest lifecycle UX converts the weakness into polish. |
| 11 | **Parcel observation log (append-only)** — new `parcel_observations` table; `recordObservation()` fired fire-and-forget from the lookup/ETL/fusion write paths. Plant the acorn before volume arrives. | Iyari | M | Longitudinal county data is the one asset you cannot buy retroactively; it's one async insert per fact. |
| 12 | **First-customer white-glove playbook** (doc, no code) — 24h personal welcome, a "let's pull up YOUR parcel" first call, day-3/14 checkpoints, the 5 exit-interview questions. Wire ticket-created + Pax-escalation notifications so first-response SLA is even possible. | Rafe | S | At 1–5 customers, a 20-min personal welcome is the highest-ROI retention act and costs only time. |
| 13 | **Data-freshness disclaimer + landing data-provenance band** — add the "public-records data may be out of date; verify with the county" disclaimer variant; name FEMA/USDA/USGS/USFWS/Census on the landing + pricing as the honest "premium data, free; paid data when you scale" story. | Beatrice, Soren | S | Turns the budget constraint into positioning, and inoculates against a stale-data-read-as-fact claim. |

---

## P1 — First customers ($200 MRR era): make free feel premium, coverage deepen, retention stick

- **Unify the two data spines** (Iris/open-data architect, L) — wrap the broker as the registry's free provider; migrate the 12–26 callers one at a time; one cache, one breaker, one free→paid seam. *Design in P0, execute here.* The biggest architectural risk if deferred past ~30 features.
- **Demand-driven county coverage** (Iris/Maren, M) — on a county miss, enqueue `arcgis-discovery`, auto-populate + validate the endpoint, flip active on a real hit; add a "request your county" CTA. Coverage grows for $0 along the contour of where customers actually hunt.
- **The "Land Snapshot" / `LandProfile`** (Maren/open-data, M) — one bundled, decision-grade view (acreage, flood, wetlands %, soil class, slope, access flags) each with source + confidence + an honest "what we don't know" list. Composed entirely from free sources we already query. Pax reads this, never raw provider blobs.
- **Cache-first pre-warm ETL** (Maren/Andrei/Tess, M) — on parcel save, background-enrich coordinate data (flood/soil/elevation need only lat/lng) so the next view is instant. Per-category cache TTLs (soils/PLSS ~1yr; flood/wetlands ~90d; owner/tax ~30d) + stale-while-revalidate so an outage degrades to dated cache, not a blank card. **Cache is our SLA** (Tess).
- **Persist the Land Intelligence Report + field provenance** (Iyari, M) — store computed reports; re-open renders <100ms instead of an 8-API recompute; doubles as the eval corpus.
- **County coverage ledger** (Iyari, S) — left-join customers' counties against `county_gis_endpoints`; demand-rank the discovery crawler; surface a "your county is fully covered" chip.
- **Map: mobile bottom-sheet for selected pin + overlay legend + perf budget** (Krieger, M) — driving-for-dollars is the #1 mobile path and the Map door's pin experience is desktop-only today.
- **Data-grounded Pax eval set + gate** (Andrei, M) — ~20 cases: lookup hit → cite source; lookup miss → say "I don't have it," never invent; cross-org ID → refuse. Wire into the existing eval gate.
- **Public parcel-check widget** (Soren, M) — no-auth "run free due diligence on any parcel" page; ranks for huge long-tail intent, *demonstrates* the free-data promise, is the most natural signup CTA. Rate-limit by session not IP; emit `marketing_touch`.
- **Reliability: per-source synthetic probes (golden parcels), rate-limit token buckets, graceful degradation** (Tess) — catch "endpoint answers but the answer is now garbage" before a customer does.
- **Honest cancellation + NPS-as-conversation** (Rafe, S) — confirm cancel reasons persist as exit-interview data; a detractor score triggers a same-day personal touch.

---

## P2 — Scale ($1k MRR): proactive features + first paid data

- **Owner-change & tax-status delta detector** (Iyari, M) — scheduled diff over `parcel_observations` → "owner changed / tax-delinquent appeared in your pipeline." This is what investors pay PropStream/PropGrid for, derived from free county GIS we already crawl. *The killer app of owning history.*
- **Paid-data eval harness** (Iyari/Andrei, S design now) — run Regrid/Zamplo against our persisted free reports; measure which fields actually *flip a decision*; upgrade surgically. Define the "decision-flip" metric now so a trial yields an answer in 48h.
- **Enable Regrid pay-per-call** (Lena, metered + capped) — fills the one thing free can't: complete normalized parcel fabric/owner. Behind the tier wall + credit deduction that already exists.
- **Programmatic county SEO pages** (Soren, L) — real flood/soil/elevation rollups per covered county make ~35K pages defensible (not thin doorway spam). Gate page emission on a data-completeness bar.
- **Confidence-aware diligence checklist + model routing** (Maren/Andrei) — free data auto-pre-flags the flood/wetlands checklist items; route data-summary turns to cheaper models once the eval supports it.
- **Customer-facing "How AcreOS sources data" disclosure page** (Quinn, S) — transparent sourcing as a differentiator and a public-trust accountability surface.

---

## P3 — $5k MRR: surgical paid upgrades + reliability org

- Surgical paid-data purchases proven by the eval harness (e.g. boundary geometry only where free counties don't expose it — spike first whether discovery already returns geometry); satellite/imagery; advanced comps.
- Persistent provider health on the warm worker; W3C-trace-through-queues already shipped (H5.4); formal on-call beyond the founder.
- The `@acreos/solene` physical package relocation (seam already established).

---

## Cross-team quick wins (ship this week, near-zero cost)

These appeared on multiple lenses' "days not weeks" lists:

1. **Delete `floodZone ?? "X"`** and its siblings in `maps.tsx` — the single highest-severity honesty fix in the repo (one-line each → "unknown").
2. **Surface `confidence`/`provider`/`fetchedAt`** (already on `LookupResult`) as a provenance chip on Map/Deal panels.
3. **Wire `providerRegistry.healthCheckAll()` into `checkAll()`** — the highest-leverage hour in the whole plan.
4. **External uptime pinger** → founder's phone; **contactable `User-Agent`** on all free-data fetches.
5. **Pass source context into `guardPaxOutput`** — activates an already-written guard in half a day.
6. **Data-freshness disclaimer variant** + **"© OpenStreetMap contributors"** on the map (live ODbL fix).
7. **`license`/`redistributable` column on `county_gis_endpoints`** (default review-required) + **SSRF guard** on operator-contributed URLs.
8. **"Request your county" capture** on a no-endpoint miss — turns the biggest coverage gap into a customer-authored roadmap.
9. **Re-order activation** so land/hybrid see "Look up your first property" first.
10. **Define the paid-data eval + free-miss-by-county telemetry now** (zero code / zero paid calls) so the eventual buy is data-driven.

---

## The single biggest risk (team consensus)

**A first customer reaches a fabricated or silently-failed data value on their own parcel, makes (or passes on) a real-money decision because of it, and discovers it was invented — and we never even learn why, because the support loop and exit-interview aren't wired.** Every lens, from different seats, arrived at the same place: our entire moat is *trust in the data*, the data engine is genuinely good, and the only things standing between us and "premium for free" are **honesty, provenance, reliability monitoring, and routing customers to the wow** — all of which cost engineering time, not data fees. The corollary trap (Quinn/Lena): if the free tier ships fake numbers, the eventual paid upgrade becomes "pay us to stop guessing" — a dark pattern that retroactively confirms the free tier lied. **Fixing honesty now is what makes the paid ladder ethical later.** Do P0 before the first customer signs.

---

_Per-lens detail: `docs/internal/roadmap/_lenses/{iris,soren,beatrice,krieger,maren,lena,rafe,andrei,tess,iyari,quinn,open-data-architecture}.md`._
