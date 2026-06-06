# Beatrice — CRO lens: compliance / legal / security / AI safety for the open-data strategy

**Author:** Beatrice Whitfield, Chief Risk Officer
**Date:** 2026-06-06
**Scope of this lens:** Licensing + ToS of every free data source (can we redistribute county/USDA/FEMA data? attribution requirements?), scraping legality, data-provenance + disclaimers (no unlicensed practice / no investment advice), security of ingested data.

> Standard I hold this to: *what would an enforcement officer, a plaintiff's attorney, or a data provider's licensing-compliance team find concerning here?* A sign-off that doesn't cite the specific term or section is not a sign-off.

---

## The one-paragraph verdict

The open-data strategy is **legally sound and arguably safer than the paid path** — most of what we want (FEMA NFHL, USGS, USDA SSURGO, Census TIGER, USFWS NWI, BLM) is U.S.-government work product and **public domain under 17 U.S.C. §105**, freely redistributable. The real risk is **not** the federal sources. It is (1) **county/state GIS data**, where redistribution rights vary county-by-county and a meaningful number of county portals carry restrictive terms of use; (2) **OpenStreetMap**, which is ODbL — share-alike with hard attribution requirements that bite if we display it; (3) **scraping mechanics** of county portals (the discovery service must respect robots.txt, rate limits, and terms); and (4) the **provenance/disclaimer line** that keeps AcreOS a tool and not an unlicensed advisor/appraiser/CRA. We already have good *display* primitives (`required-disclaimer.tsx`, `data-provenance-tag.tsx`, `source-attribution-panel.tsx`) but **no license metadata anywhere in the data path** — the provider registry and `county_gis_endpoints` table don't record what license a source carries or what attribution it requires. That's the gap to close before first customer.

---

## What I found in the repo (grounding)

- **Providers exist and are tiered correctly.** `server/services/providers/open-data-provider.ts` (FEMA/Census/USGS/USDA/EPA/BLM, free, cost 0), `county-gis-provider.ts` (free, priority 5, tried before Regrid), plus paid `regrid-`, `attom-`, `batchdata-`. Good architecture.
- **No license/attribution field anywhere.** `server/services/providers/types.ts` `DataProvider` has `name`, `categories`, `tierRequired`, `costPerLookupCents` — but **no `license`, no `attributionText`, no `redistributable` flag**. Same in the DB: `county_gis_endpoints` (shared/schema.ts:5947) has `sourceUrl`, `notes`, `contributedBy` but **no license column**. We literally cannot answer "can we redistribute this row?" from data.
- **No attribution string is encoded in any provider.** `grep` for attribution/copyright/license/"powered by" across all five provider files returns nothing. OSM and Regrid both contractually require attribution; we render neither.
- **Discovery service does no robots.txt / rate-limit / terms handling.** `server/services/countyEndpointDiscovery.ts` (113 lines) — no `robots`, `crawl`, `rate`, `user-agent` references. If this ever auto-discovers/scrapes county portals, that's an unmanaged legal + security surface.
- **Display primitives are solid.** `client/src/components/data-provenance-tag.tsx` (source + as-of + confidence dot), `source-attribution-panel.tsx` (per-field source + staleness), `required-disclaimer.tsx` (financial/legal/ai/valuation variants). The hard part — *making free data feel premium with honest provenance* — is half-built.
- **The 2026-05-31 legal audit (`docs/legal/audit-2026-05-31.md`) does NOT cover data licensing.** It covers ToS/privacy/DPA, sub-processors, Pax advice posture, FCRA scoping. There is no source-by-source redistribution analysis. That's this lens's contribution.
- **Pax advice line is held** (audit line 158-160): "giving data is not advice." Good — the open-data strategy must not erode that.

---

## Top work items (prioritized)

### 1. Data-source license register (the spine) — **L, Phase 0**
**Goal:** foundation. **Why first customers:** every other item depends on it; it's what lets us say "yes, we can show this" with a citation.

Create a single authoritative register — `server/services/providers/data-licenses.ts` (code constant) **plus** a `license`/`attribution`/`redistributable` set of columns on `county_gis_endpoints` for the per-county portals that can't be enumerated at build time. Each entry records: source name, governing license (public-domain-§105 / CC0 / CC-BY / ODbL / county-ToS / proprietary), redistributable (yes/no/attribution-required), required attribution string, source URL, terms URL, last-reviewed date.

Seed it with the federal sources (all public-domain-§105 except where a sub-component is licensed): FEMA NFHL, USGS 3DEP/NHD, USDA SSURGO, USFWS NWI, Census TIGER/ACS, BLM, EPA. Then OSM = **ODbL, attribution required, share-alike**. Then a county-ToS default of **"review-required"** until a human checks the specific portal.

**First step:** add fields to `DataProvider` in `types.ts`:
```ts
readonly license: "public-domain-usgov" | "cc0" | "cc-by" | "odbl" | "county-tos" | "proprietary";
readonly attributionText?: string;     // rendered when this source contributes a displayed value
readonly redistributable: "yes" | "attribution" | "no" | "review-required";
```
Then make the registry refuse to *cache-and-redistribute* (vs. live-passthrough) anything marked `no`/`review-required`.

**Dep:** none. **Blocks:** items 2, 3, 4.

---

### 2. Per-county redistribution review + the "review-required" default — **M, Phase 0→1**
**Goal:** rock-solid. **Why:** county GIS is the single biggest legal exposure in the whole strategy. ArcGIS REST endpoints are technically open, but a nontrivial share of county portals attach terms ("for personal/non-commercial use," "not for redistribution," "for tax purposes only"). A SaaS that re-serves that data to paying customers is a different posture than an individual looking up one parcel.

Policy I'm setting: **every `county_gis_endpoints` row ships `redistributable = "review-required"` until a human (me, or Tom with my checklist) reads that county's terms-of-use page and flips it.** Live passthrough (we fetch on demand, show once, don't persist) is lower risk than bulk-cache-and-resell. Until reviewed, a county is **live-passthrough only, no bulk ETL, no cache redistribution**.

**First step:** add `license`, `termsUrl`, `redistributable`, `reviewedAt`, `reviewedBy` columns to `county_gis_endpoints` (migration), default `review-required`; wire `provider-registry.ts` to honor it (skip caching/ETL when not `yes`/`attribution`). Build a tiny founder-tools review queue listing un-reviewed counties.

**Dep:** item 1. **Blocks:** any bulk county ETL, the FEMA-style bulk ETL pattern extended to counties.

---

### 3. Attribution rendering pipeline (ODbL + provider terms) — **M, Phase 0**
**Goal:** rock-solid + flawless-ux. **Why:** OSM's ODbL **requires** visible attribution ("© OpenStreetMap contributors") wherever its data/tiles appear, and the share-alike clause can attach to derived databases. Regrid and ATTOM also require attribution per their terms. We currently render none — that's a live license breach the moment we ship a map.

Thread `attributionText` from the provider/register through `LookupResult` → into `source-attribution-panel.tsx` and the map. Add a persistent, unobtrusive attribution line on `property-map.tsx` (the MapLibre surface) and an "Sources & licenses" expander on any screen that shows aggregated data. This is also a *premium* signal — honest, cited data reads as trustworthy, not as a free-tier compromise.

**First step:** add an optional `attribution?: string` to `LookupResult` in `types.ts`, populate it in each provider's `lookup()`, surface it in the attribution panel and on the map footer.

**Dep:** item 1.

---

### 4. Provenance + disclaimer coverage audit on every data surface — **M, Phase 0**
**Goal:** rock-solid (legal defensibility). **Why:** the constitutional line is "AcreOS is a tool, never an advisor." Free data with imperfect freshness *raises* the stakes on disclaimers — a customer must never read a stale county assessed value or a SSURGO soil rating as a guarantee. Three exposures specifically: (a) **valuation** — algorithmic estimates off free comps are not appraisals (USPAP / state appraiser-licensing line); (b) **flood/environmental** — FEMA NFHL has gaps and effective-date nuances; a "no flood risk" read that's wrong is a real-harm claim; (c) **owner/skip-trace** — if free owner data ever feeds tenant/credit-style decisions, FCRA §1681 attaches.

**First step:** grep every surface that renders parcel/flood/soil/valuation/owner data and confirm a matching `RequiredDisclaimer` + `DataProvenanceTag` is present with an honest "as-of" date. Add a **data-freshness disclaimer variant** ("Public-records data may be out of date; verify with the county before relying on it"). Map each surface→regulation in a short addendum to `docs/legal/audit-2026-05-31.md`.

**Dep:** can start now; pairs with item 3.

---

### 5. Scraping/discovery legality + security hardening — **M, Phase 1**
**Goal:** rock-solid. **Why:** `countyEndpointDiscovery.ts` is the riskiest module if it grows. Auto-discovering/scraping county portals without robots.txt + rate-limit + a declared User-Agent risks CFAA-adjacent claims and IP bans that break customer lookups. *hiQ v. LinkedIn* eased public-data scraping but did not bless ToS-violating bulk extraction; county portals frequently have ToS.

Plus a **security** dimension that's easy to miss: ingested third-party GIS data is untrusted input. ArcGIS/WFS responses can carry HTML in fields (legal descriptions, owner names) → stored XSS into our UI; oversized geometries → DoS; SSRF if endpoint URLs are operator-contributed (`contributedBy` exists). We fetch operator-supplied `baseUrl`s — that's an SSRF surface today.

**First step:** add to discovery/fetch path: robots.txt check, per-host rate limiting (reuse circuit-breaker infra), a declared `User-Agent: AcreOS-DataBot (contact)`, an **allowlist/validation of `baseUrl`** (block private IP ranges / non-https / localhost — SSRF guard), and HTML-sanitize all string fields from GIS responses before persistence.

**Dep:** item 2 for the policy layer.

---

### 6. Sub-processor + ToS/Privacy update for the open-data path — **S, Phase 0**
**Goal:** rock-solid. **Why:** the 2026-05-31 audit already flagged the sub-processor list is incomplete (GDPR Art. 28(3)(d), CCPA). The open-data strategy adds outbound calls to FEMA, Census, county servers, etc. These are *data sources*, not processors of our customer data, so most aren't sub-processors — but the **ToS/Privacy must disclose** that property data is sourced from public records and may be inaccurate/out-of-date, and the **DPA** must reflect that we don't send customer PII to these sources. Keep `client/src/pages/sub-processors.tsx` honest.

**First step:** add a "Public data sources" section to the public sources/privacy page listing the federal sources + "county/state public records," with the standard accuracy disclaimer; confirm no customer PII leaves to any free source (we send coordinates/APN, not customer identity).

**Dep:** none.

---

### 7. Phased upgrade-to-paid guardrails (Regrid/Zamplo/PropGrid) — **S, Phase 2** (design now)
**Goal:** foundation. **Why:** when MRR justifies paid data, the *contracts* are the risk, not the integration. Paid providers impose: attribution, **no-caching/no-redistribution windows**, per-record TTLs, prohibited-use clauses (no resale, no bulk export). The license register (item 1) must encode each paid provider's cache-TTL and redistribution limits so the registry's `provider_cache` doesn't silently violate a contract (e.g., caching Regrid beyond its permitted TTL).

**First step:** when the first paid contract is signed, populate its register entry with `redistributable`, `cacheTtlMaxDays`, and `attributionText`; add a registry assertion that cache TTL ≤ contract max. Document in this file.

**Dep:** item 1.

---

## The open-data theme, from my lens

**Open data is the *low-risk* choice, not a compromise — if we get four things right.**

1. **Federal = free and redistributable.** 17 U.S.C. §105 puts U.S.-government works in the public domain. FEMA NFHL, USGS, USDA SSURGO, USFWS NWI, Census TIGER/ACS, BLM, EPA — redistributable, no attribution legally required (we should still credit them; it reads as premium and it's honest). This is the bedrock and it's *cleaner* than any paid feed.
2. **OSM is the trap.** ODbL is share-alike + mandatory attribution. Use it for basemap/context, attribute it visibly, and be careful that we don't create a "derived database" we're then obligated to share-alike. Treat OSM-derived fields as display-only context, not as data we resell.
3. **County data is the judgment call.** Public records are public, but the *portal's terms* and the *commercial-redistribution* posture vary. Default to **review-required + live-passthrough**, upgrade per-county after reading the terms. This is the single discipline that keeps the strategy defensible.
4. **Honesty is the premium feature.** A free-data product that shows source + as-of-date + confidence + an honest disclaimer **outclasses** a paid black box that says "trust us." We already have the components. Provenance *is* the polish. Make every number cite where it came from and how old it is, and the free tier feels like a higher-integrity product, not a cheaper one.

The phased path: **Phase 0-1 = federal public-domain + reviewed-county live-passthrough, fully attributed.** **Phase 2+ = add paid feeds only with their contract terms encoded in the license register and TTL-enforced in the cache.** Never let a paid contract's redistribution/cache limits live only in a PDF — they live in code (item 7).

---

## Quick wins (days, not weeks)

- **Add the data-freshness disclaimer variant** to `required-disclaimer.tsx` ("Public-records data may be out of date; verify with the county before relying on it"). One enum value + one string. Closes the biggest "stale free data read as fact" exposure immediately.
- **Render "© OpenStreetMap contributors" on the map** wherever OSM tiles/data appear. One line. Fixes a live ODbL breach.
- **Add a `license` + `redistributable` column to `county_gis_endpoints`** defaulting to `review-required`, and stop any bulk caching of un-reviewed counties. Schema + one registry guard.
- **SSRF guard on operator-contributed `baseUrl`** — reject private IPs / non-https in `county_gis_endpoints` writes. ~20 lines, closes a real security hole today.
- **Append a data-licensing addendum to `docs/legal/audit-2026-05-31.md`** — source-by-source redistribution table. Pure documentation, makes the posture auditable.

---

## Biggest risk if my area is ignored

**We bulk-cache and re-serve county or OSM data we don't have the right to redistribute, and ship it to paying customers — turning a free-data win into a cease-and-desist or an ODbL share-alike obligation, right as we onboard our first customers.** The federal sources are safe; the danger is treating *all* "free" data as equally redistributable. Without the license register (item 1) and the review-required county default (item 2), we have **no way to even know** which rows are safe to cache — every county endpoint is currently a yes/no question with no recorded answer. Secondary risk: an un-attributed/un-disclaimed stale value (flood, valuation, owner) that a customer relies on and is harmed by, eroding the "tool not advisor" constitutional line that is our core legal armor. Both are cheap to prevent now and expensive to unwind after a customer is on the platform.
