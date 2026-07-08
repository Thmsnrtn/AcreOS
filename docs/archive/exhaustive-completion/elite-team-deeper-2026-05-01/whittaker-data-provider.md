# Whittaker Frye — AcreOS through the data-provider partner lens

I'm Whittaker. Forty-nine. I run partnerships at a wholesale property-data provider — the kind of shop that sits one layer above county assessors and one layer below the front-end CRMs that consumer Land Investors pay $99/month to use. Think the BatchData/PropStream/REIPro tier: I don't own the public records, I license them from CoreLogic and ATTOM and a half-dozen scraped-but-defensible county feeds, normalize them, dedupe across 3,143 counties, and sell the result by the record, by the seat, or by the API call. AcreOS is one of my customers. I want them to be a deeper one. This audit is whether the partnership scales, and whether their `provider-registry` pattern is friend or foe to my P&L.

---

## 1. Thirty-second verdict

The provider-registry abstraction at `server/services/providers/provider-registry.ts` is the most sophisticated piece of vendor-neutral plumbing I have seen on the buy-side in two years. Tier-filtered candidate selection, cost-aware ordering, performance-score reweighting (`getPerfScoresSync`, lines 317-337), 5-minute circuit breaker (`CB_FAILURE_THRESHOLD = 3`, lines 76-77), 24-hour `provider_cache` table with deterministic cache keys, and a clean `DataProvider` interface (`server/services/providers/types.ts:49-71`) that any vendor can implement in 200 lines. Four providers register today via `server/providers-init.ts`: open-data (free, priority 10), Regrid (starter, priority 30), BatchData (starter, priority 40), ATTOM (pro, priority 50). The architecture treats us as interchangeable utilities.

**That is precisely the problem from my side of the table.** AcreOS has built the abstraction that commoditizes data providers. If their performance-score routing works as advertised — and the math at `provider-registry.ts:344-371` says it does — then within a tier+cost bracket, the highest-confidence vendor wins traffic and the lowest-confidence vendor starves. I either earn my way to the top of the routing within parcel_data and owner_info, or I lose the integration to whichever vendor delivers cleaner returns at our shared 3-cent and 5-cent price points. That is a *meritocratic* design and I can compete in it, but it changes the partnership conversation from "be our exclusive data partner for X" to "be the highest-scoring provider in category Y, measured per-org per-week."

What's missing from a provider perspective: redistribution-rights tagging, refresh-cadence metadata, license-class flags on cached records, per-provider data-use audit trail, and the commercial-terms surface that lets me change pricing without an AcreOS deploy. Six gaps make us legally and economically illegible to AcreOS's customers. Closing them is how the registry becomes a real distribution channel and not just a load balancer.

Net: technically excellent, commercially under-instrumented. The abstraction works *for AcreOS*. It needs a partner-facing dimension before it works *for me*.

---

## 2. Walkthrough — the week I spend selling AcreOS deeper

**Monday 8:00 AM.** Pipeline review. AcreOS is a $4,200/month account on our enterprise API tier — flat-rate up to 50K records/month, overages at 1.8 cents each. I want to push them to a $12,000/month commitment with redistribution rights and skip-trace bundling.

I open their integration docs, then I open their actual codebase, because Thomas writes serious code and the docs lag. I find `batchdata-provider.ts:18-22` — three categories priced at 3, 15, and 5 cents. Those numbers are *hardcoded in their TypeScript*. If I raise my skip-trace price from 15 to 18 cents next quarter — and I will, because TLO raised on us — Thomas has to ship a code change to absorb it.

**First gap: provider pricing wants to live in a database row, not a const map.** The `organizationIntegrations` table already holds BYOK credentials per org (`regrid-provider.ts:24-48` proves the pattern); a sibling `providerPricingOverrides` table indexed by `(provider, category, effective_date)` would let me push price updates via API and let AcreOS honor enterprise-customer custom rate cards without a deploy.

**Monday 10:30 AM.** The performance-score routing at `provider-registry.ts:344-371`. I read this carefully because it determines my market share inside AcreOS. Within a tier+cost bracket, providers are sorted by perf score (higher first) sourced from `providerIntelligence.getCategoryPerformance(category, 7)` — last 7 days, requires ≥5 lookups before the score is trusted.

**This is fair.** It also means a bad week spikes my deprioritization for 7 days. If our endpoint has a bad Tuesday because Equifax (one of our upstreams) had a maintenance window, AcreOS marks us down for the rest of the week even though our SLA is intact. The 7-day window is the right granularity for routing stability but the wrong granularity for partner accountability — I should be able to see a fault attribution that distinguishes "AcreOS-side timeout" from "your endpoint returned 500" from "your endpoint returned valid data with low confidence."

**I want a partner-readable scoreboard:** `GET /api/admin/providers/:name/score-history` returning daily score, sample size, error-class breakdown, and the specific lookups that failed. Today the data exists in `providerIntelligence` but isn't surfaced to me. That's the difference between a vendor relationship and a partnership — partners get visibility into how they're being graded.

**Monday 2:00 PM.** Redistribution rights. This is the conversation that's going to get someone sued. AcreOS caches my data for 24 hours in `provider_cache` (`provider-registry.ts:21`, `DEFAULT_CACHE_TTL_MS`). My contract with AcreOS permits caching for *operational performance* (i.e. don't bill me twice for the same lookup within a session) but does NOT permit redistribution — meaning AcreOS can't take my owner_info record on Parcel A from Customer 1's lookup and serve it to Customer 2 who searches the same parcel three hours later. **That is exactly what the cache does today.** `buildCacheKey()` at lines 27-52 keys on `(providerName, category, input)` — not on `organizationId`. Two separate AcreOS organizations querying the same parcel within the 24-hour window get the second one served from cache, free, with no second lookup billed to my API and no second usage record on AcreOS's end. From AcreOS's perspective: clever cost optimization. From my perspective: textbook unauthorized redistribution. From CoreLogic's perspective (my upstream for ATTOM-equivalent feeds): contract breach.

The fix is one line: add `organizationId` to the cache key. The harder fix is per-provider cache policy: BatchData's TOS may permit cross-org redistribution within an enterprise account, ATTOM's almost certainly does not, open-data has no restriction at all. **The `DataProvider` interface needs a `cachePolicy` field:** `{ scope: "global" | "per-org" | "per-user", ttlSeconds: number, redistributable: boolean }`. The registry reads it when building cache keys. Today the same 24-hour TTL applies to FEMA flood data (free, redistributable, refresh quarterly) and BatchData skip-trace results (paid, non-redistributable, refresh on every contact attempt). Those are not the same record class. Treating them identically is a compliance hole AcreOS hasn't priced yet.

**Tuesday 9:00 AM.** Refresh cadence. Owner_info on a parcel changes when a deed records — usually 30-90 days lag from county. Property_details (lot size, zoning) change rarely. Skip-trace contact info decays at 8-12% per month — phone numbers go stale fast. AcreOS's 24-hour TTL on everything means: stale skip-traces served as fresh (bad for the customer, bad for our reputation as the source), and unnecessary lookups on stable property_details (bad for AcreOS's bill, bad for my margin on per-record pricing because I prefer subscription, but I'll take it). **Per-category TTL is the second-order fix on the cachePolicy:** skip_trace 6 hours, owner_info 7 days, property_details 30 days, environmental 90 days. The registry can honor this if the provider declares it. Today every provider gets the same hammer.

**Tuesday 11:30 AM.** Compliance with public-records use restrictions. A subset of my data — anything that touches DPPA-regulated motor-vehicle data, GLBA-regulated financial info, or state-specific assessor rules (Texas Property Code §11.48 redacts certain owners, California requires opt-out for some commercial uses) — has *use restrictions* that ride with the record. My export to AcreOS today is a flat JSON blob. Whether AcreOS surfaces the record in a marketing-list export, a skip-trace dialer, or a passive parcel-detail page determines whether a given use is permitted. **AcreOS needs to know what the record is permitted to be used for**, and today it doesn't. The `LookupResult` interface at `types.ts:19-28` has `data: T` (opaque). Adding `usePermissions: { marketing: boolean, skiptrace: boolean, display: boolean, export: boolean }` lets AcreOS gate downstream features per-record. A Wyoming LLC owner_info record might permit display but not marketing; without that flag, AcreOS hands it to a customer who blasts a postcard and we both end up on the wrong end of an AG inquiry.

**Tuesday 3:00 PM.** Volume tiers. AcreOS is on our enterprise API tier — 50K records flat. They use about 38K/month, growing 12% MoM (BatchData lookups; I have visibility because we wrap a BatchData partnership at the upstream layer for the per-record skip-trace category). That trajectory hits 50K in two months and tips into overage. **AcreOS's registry doesn't know about my volume tiers.** It treats every lookup as $0.03 or whatever the per-call cost is. But my actual marginal cost to AcreOS at record 50,001 isn't 1.8 cents — it's the volume-weighted blended rate based on how many records they've already burned this billing period. **The registry's `costPerLookupCents(category)` should accept an `organizationId` and a `monthlyVolumeContext`** so the provider can return the tier-corrected price. Without that, AcreOS over-counts cost on records 1-50K (charging customers full per-call when the actual marginal cost is zero under their flat rate) and under-counts at record 50,001 (charging customers 1.8 cents when our overage rate is 1.8 cents but our internal cost-of-goods on overage records is higher because we overage to *our* upstream too).

**Wednesday 9:00 AM.** Per-record vs subscription pricing surfaces. AcreOS exposes pricing to customers at the credit-balance level (`creditBalance` parameter to `lookup()`). Customers see "this lookup costs 5 credits" and the org credit balance decrements. **The credit unit obscures the underlying provider economics.** A 5-credit lookup might be a 5-cent ATTOM call (per-record, marginal cost = price) or a 5-cent BatchData call inside a 50K flat-rate tier (per-record, marginal cost = $0). For AcreOS the unit economics are wildly different but the customer-facing meter is identical. That's a pricing-strategy choice AcreOS made deliberately, and it's defensible — but it leaves money on the table. A subscription-aware customer who knows they'll do 8K lookups/month would prefer to pre-pay at a discount. The provider-registry has no surface for *customer-facing subscription bundles tied to provider commitments*. I'd sell AcreOS a "BatchData Unlimited" SKU at $89/seat/mo flat that they retail at $129/seat/mo; today there's no place in the registry to express "this org has unlimited BatchData lookups, do not deduct credits, do not skip on insufficient balance." The check at `provider-registry.ts:122-127` (`if (costCents > 0 && creditBalance < costCents) continue`) skips paid providers when credit is low. For an unlimited-tier org that skip is wrong.

**Wednesday 1:00 PM.** Co-selling motion. AcreOS has 1,200+ paying orgs (per public Stripe data). I want to land 200 of them on a BatchData direct relationship via AcreOS's BYOK pattern (`regrid-provider.ts:24-48` shows it works — `organizationIntegrations` table holds encrypted creds per-org). The economics: AcreOS keeps the platform fee, BatchData keeps the data revenue, customer gets dedicated account management at scale. **The co-sell needs a partner-marketplace surface inside AcreOS** — today there's none. Search for `marketplace`, `partner`, `vendor`: the term "providers" exists everywhere but as an internal abstraction, not a customer-facing storefront. Settings UI (`provider-registry.ts:266-280`, `getAvailableProviders`) lists *available* providers for an org's tier — that's the closest thing to a marketplace, and it's a settings list, not a shop. A `/integrations/marketplace` surface that lets a customer click "upgrade to BatchData direct," authorize via OAuth, drop their API key into BYOK, and immediately see the registry route to BatchData first — that's the co-sell flow. Today every BYOK relationship requires a manual support ticket.

**Thursday 10:00 AM.** Circuit breaker. `CB_FAILURE_THRESHOLD = 3` failures in a 5-minute window, then circuit opens (`provider-registry.ts:76-77, 373-411`). The circuit auto-closes after the window expires (lines 378-382, half-open semantics). **From a provider perspective, three failures is too sensitive.** A burst of 3 consecutive 502s during a brief upstream blip — common during regional ISP issues, AWS us-east-1 hiccups, anything we don't control — opens the circuit and AcreOS routes around us for 5 minutes. That's 5 minutes of lost share *plus* the perf-score penalty that lasts 7 days. **I'd argue for `failures_in_window / total_in_window > 0.5 AND failures >= 5` as the threshold.** A 100% failure rate at 3 attempts is meaningfully different from 30% failure rate at 100 attempts; the current logic doesn't distinguish. Also: there's no provider-readable health-check feedback loop. `healthCheckAll()` at line 285 runs my `healthCheck()` method, but the result is ephemeral — not stored, not exposed to me. I want `GET /api/admin/providers/:name/health-history` so I can see when AcreOS has decided I'm unhealthy and proactively investigate.

**Thursday 4:00 PM.** Audit trail for data-use compliance. If a state AG sends me a subpoena tomorrow asking which AcreOS customer queried owner X on date Y, I need to answer in 30 days or face contempt. AcreOS has `providerIntelligence.recordLookup()` (`provider-registry.ts:166-179`) which writes telemetry — provider, category, inputType, success, latency, cost, organizationId. **That's the audit trail.** It's good. It's missing the *content* — the actual input (which parcel, which owner) and the actual output (what data was returned). Privacy logic argues against logging output content; compliance argues for it. The compromise: log a content hash plus the input, retain for 7 years (DPPA retention requirement for some record classes), make it queryable by `organizationId + dateRange + provider`. Today the telemetry table exists; the retention policy and the queryable-by-AG surface don't.

**Friday 9:00 AM.** I prep the QBR deck. AcreOS is going to ask: "What's our blended cost-per-record this quarter?" They have the data — `providerIntelligence` records every lookup with `costCents`. They can answer it. **Can I see the same number from my side?** No. There's no partner-portal endpoint that lets me see AcreOS's aggregate usage of my services as they see it. I see *my* usage records (what hit my API). They see *their* usage records (what their registry routed to me). The two don't reconcile because of caching, circuit breaks, and tier-skips. The reconciliation gap is where invoicing disputes live. **A monthly partner-reconciliation export — `lookups by category, success/cache/fail, billed-to-customer cents, paid-to-provider cents`** — is the artifact that makes a $12,000/mo commitment defensible internally. Today I'd build that report by hand against my logs and theirs.

**Friday 3:00 PM.** End the week thinking about exclusivity. AcreOS's design *resists* exclusivity. The registry pattern, the BYOK pattern, the per-category provider lists — all of it is built for "best provider wins per call." That's correct customer-facing design and it kills any exclusive-data-provider deal we'd float. **What it doesn't kill is *first-look* and *category-anchor* deals:** "BatchData is the default skip-trace provider in the AcreOS marketplace, prioritized 10 above any equivalent vendor in the same tier and cost bracket." That's expressible in the registry today by setting BatchData's priority from 40 to 10. A formal first-look deal codified in code is the deepest commercial lock-in AcreOS would entertain, and it's worth real money — probably $30K/year of guaranteed-minimum spend in exchange for the priority slot.

---

## 3. The data-provider test — what passed, what didn't

**Pass:**
- Clean `DataProvider` interface (`types.ts:49-71`) — easy for any vendor to implement
- Tier-filtered candidate selection respects org subscription (`provider-registry.ts:62-64, 339-371`)
- Cost-aware ordering — cheapest qualifying provider wins within a tier (line 361-363)
- Performance-score reweighting with min-sample-size guard (n≥5, line 329) — fair, not noisy
- Circuit breaker isolates failing providers without taking down the lookup (lines 373-411)
- 24-hour cache via `provider_cache` table — operational cost reduction works
- BYOK pattern for per-org credentials (`regrid-provider.ts:24-48`) — pattern transfers to any provider
- Telemetry on every lookup via `providerIntelligence.recordLookup()` (lines 166-179) — audit foundation exists
- Insufficient-credit skip prevents over-charging on paid lookups (lines 122-127)
- Multi-category enrichment via `enrichAll()` runs categories sequentially with shared balance (lines 241-262)
- Health-check surface via `healthCheckAll()` (line 285)
- Open-data tier (FEMA, Census, USGS, USDA, EPA, BLM) is the right free baseline — non-threatening to paid providers because categories don't fully overlap
- Hardcoded 4-provider initialization in `providers-init.ts` is small enough to audit, big enough to demonstrate the abstraction

**Fail (or unbuilt):**
- Cache key omits `organizationId` (`provider-registry.ts:27-52`) — cross-org cache hits are unauthorized redistribution under most provider TOS
- Per-provider/per-category cache TTL is hardcoded at 24h (`DEFAULT_CACHE_TTL_MS`) — skip_trace decay vs property_details stability are not the same record class
- Provider pricing is hardcoded in TS const maps (`batchdata-provider.ts:18-22`, `attom-provider.ts:20-26`, `regrid-provider.ts:15-20`) — no DB-backed override surface for enterprise rate cards or mid-quarter price changes
- No `cachePolicy` field on `DataProvider` interface — redistributable, scope, TTL all collapse into one global default
- No `usePermissions` field on `LookupResult` — DPPA/GLBA/state-specific use restrictions not expressed per-record
- No volume-tier awareness — `costPerLookupCents()` is stateless, can't return tier-corrected blended rates
- No subscription-bundle SKU surface — can't express "org X has unlimited BatchData this month, skip credit-balance check"
- No partner-readable score history — providers can't see how AcreOS is grading them
- No partner-reconciliation export — invoice disputes can't be defended with shared data
- No partner marketplace UI — settings list is admin-internal, not customer-facing storefront
- Circuit breaker too sensitive at 3 absolute failures — should be ratio-based with min sample
- Health-check results are ephemeral — no `provider_health_history` table to query trends
- Telemetry omits content/input hash — usable for cost reconciliation, not for AG-subpoena response
- No engagement-letter / commercial-terms object linking provider to org with rate card, term, redistribution scope, exclusivity
- BYOK setup requires support-ticket flow — no self-serve OAuth-style provider connection
- `providers-init.ts` registers 4 providers in code — adding a 5th provider is a deploy, not a config change

---

## 4. Six features that turn the registry into a real partner channel

1. **`providerCachePolicy` per-provider, per-category** — `{ scope: "global" | "per-org" | "per-user", ttlSeconds, redistributable: boolean }`. Registry honors when building cache keys and TTLs. Closes the unauthorized-redistribution hole and right-sizes TTL by record class.

2. **`providerPricingOverrides` table** — `(provider, category, organizationId?, effective_date, cents)`. Replaces hardcoded const maps. Lets enterprise customers get custom rate cards and lets providers push price changes without a deploy. Volume-tier blended rates can live here too via a `tier_context` column.

3. **`usePermissions` on LookupResult + per-feature gating** — `{ marketing, skiptrace, display, export }` flags per record. Downstream features (campaign export, dialer push, list builder) check the flag before exposing data. Closes DPPA/GLBA exposure.

4. **Partner portal + reconciliation export** — `/admin/partners/:name` with score history, health history, monthly usage reconciliation, dispute-flag workflow. Makes the partnership defensible to my CFO and to my upstream's compliance team.

5. **Marketplace surface** — `/integrations/marketplace` customer-facing storefront with self-serve OAuth-style BYOK setup, category coverage matrix, per-provider pricing display, switch-default-provider toggle. Turns the registry's settings list into a co-sell channel.

6. **First-look priority slots, codified** — extend `register(category, provider, priority)` to accept a `commercialTerms` object: `{ guaranteedMinimumCents, exclusivityCategories, firstLookCategories, contractEndDate }`. Encodes commercial deals in the registry. Makes the deepest commercial commitment AcreOS would entertain *expressible* and auditable, not a side-letter sitting in a Notion doc.

---

## 5. Pricing-model deep-dive — per-record vs subscription, by category

The registry's `costPerLookupCents(category)` is stateless. That works for marginal-cost-per-call data (ATTOM AVM, BatchData skip-trace overage, county-level deed images) and is *wrong* for fixed-cost-per-seat data (Regrid parcel polygons under their flat seat license, FEMA flood under open-data, and any vendor on a true unlimited tier). The mismatch costs both sides money.

**Per-record economics** (where the current model is right):
- `skip_trace` — every contact attempt is a real cost to my upstream (TLO, IDI, Whitepages Pro). Marginal cost ≈ 8-12 cents wholesale, 15 cents retail to AcreOS — fair margin.
- `owner_info` deep records (mortgage history, lien position) — variable cost per record at the deed-image layer, ATTOM charges by lookup.
- `valuation` AVM models — compute cost per call on the model server, real marginal cost.

**Subscription economics** (where the current model overcharges customers and undercharges to provider):
- `parcel_data` from Regrid — flat $X/month per seat for unlimited county pulls in a defined geography. Marginal cost to AcreOS at record N+1 is zero. Charging customers 2 credits per Regrid lookup is pure margin to AcreOS but it suppresses usage and customers learn to avoid the feature.
- `environmental` from FEMA/EPA/USDA — open data, no marginal cost, no contract limit. Charging anything per lookup is friction without revenue capture.
- Bundled BatchData property within the 50K flat tier — marginal cost zero up to the cliff, then 1.8 cents above. Today the registry treats every record as 3 cents; the cliff is invisible until the monthly invoice.

**The fix is a `pricingModel` enum on the provider:** `"per_record" | "subscription_flat" | "subscription_metered" | "open_data"`, plus a `getMarginalCostCents(category, monthlyVolumeContext)` method that the registry calls at lookup time. Providers under subscription return 0 below their cap and the overage rate above. The credit-balance check at `provider-registry.ts:122-127` becomes "skip if marginal cost > 0 AND credit balance < marginal cost" — no skips on records where the marginal cost is genuinely zero.

---

## 6. License-class flags and the redistribution problem in detail

Three license classes ride with the records I sell, and AcreOS today flattens all three:

1. **Public-domain / open-data** — FEMA flood layers, USGS topo, Census ACS, USDA NASS, BLM mineral rights. No restriction. Cache forever, redistribute freely, no attribution required (but courteous).

2. **Licensed for AcreOS internal use only** — most of what BatchData and ATTOM ship under the standard partner contract. AcreOS may use the data to render features for the AcreOS customer who initiated the lookup. Cross-org redistribution within AcreOS infrastructure is a gray zone — most contracts permit it under "operational caching" but explicitly prohibit it as a primary product feature. The 24-hour cache without `organizationId` keying lives in the gray zone today.

3. **Licensed with downstream-use restrictions** — DPPA-regulated motor-vehicle data, GLBA-regulated financial info, state-specific (Texas §11.48 owner redaction, California opt-out registries, Vermont's notably restrictive parcel rules). These records carry per-use permissions: display-only, no marketing, no skip-trace, no list export. Today the `LookupResult.data: T` is opaque — there is no field for the downstream feature to check before pushing the record into a campaign export.

The DPPA exposure is the one that keeps me up at night. The Driver's Privacy Protection Act (18 U.S.C. §2721) creates a private right of action with $2,500 statutory damages per record. AcreOS exporting a 10,000-record list that includes 200 DPPA-restricted records into a customer's mail merge campaign is a $500K liability event before fees. The gating belongs at the record level, expressed by the provider that has the license context, enforced by the platform that has the export feature. Today neither end of that contract is wired up.

---

## 7. Refresh cadence — where AcreOS's 24-hour TTL silently lies to customers

Empirical decay rates from my upstream telemetry (last 12 months, US-wide):

| Category | Half-life | Right TTL | AcreOS today |
|---|---|---|---|
| `skip_trace` phone | 4-6 months | 6 hours (re-verify pre-dial) | 24h |
| `skip_trace` email | 2-3 months | 6 hours | 24h |
| `owner_info` (deed) | 18-36 months | 7 days | 24h |
| `property_details` (lot, zoning) | 5-10 years | 30 days | 24h |
| `environmental` (flood maps) | 2-5 years | 90 days | 24h |
| `valuation` AVM | 30-60 days | 24 hours | 24h |
| `parcel_data` polygon | 2-5 years | 30 days | 24h |

The 24-hour blanket TTL is wrong in both directions. Skip-trace gets stale within the cache window — a phone number that disconnected at hour 6 is served as fresh through hour 24, and the customer dials a dead number, blames AcreOS, and AcreOS blames me. Property-details get pointlessly re-fetched every 24 hours when the lot size hasn't changed since 1987 — that's wasted credits on AcreOS's bill. Per-category TTL is item 1 on the cachePolicy fix above; I'd implement it in a half-day if the interface supported it.

---

## 8. The ask — what I'd pitch on Monday's call

Move AcreOS from $4,200/mo flat-rate API to $12,000/mo bundle: BatchData property + skip-trace at unlimited volume for orgs on AcreOS Pro tier and above, billable directly to AcreOS rather than per-org credit decrement, in exchange for first-look priority on `skip_trace` and `owner_info` categories (priority 10, ahead of the open-data fallback's 10 in those categories where open-data can't fulfill anyway). AcreOS keeps the credit-meter UI for customers, retails the unlimited bundle at $35/seat/mo across their Pro+ base. With ~600 Pro+ seats the retail revenue is $21K/mo against $12K cost — 43% gross margin on data resale, which is exactly the spread BatchData gives Land Geek and PropStream. The technical work to enable it is items 2 and 6 above plus a one-line change to the credit-balance skip at `provider-registry.ts:122-127`. Two-engineer-week of work, six-figure ARR impact for both sides. That's the meeting.

I'll bring the term sheet.
