# Soren's Lens — CGO/CMO

**Owner:** Soren Mikkelsen, Chief Growth Officer
**Date:** 2026-06-06
**Frame:** How best-in-class open data becomes an acquisition + conversion moat — programmatic SEO, the "premium data on a free tier" story, landing-surface trust.

---

## The one thing the founder should take away

We already built two engines and forgot to connect them.

1. **The content engine** — `/learn/<vertical>/<state>` (content-only PRs, JSON-LD for Article + FAQ + Breadcrumb, `client/src/pages/learn/`), `/compare/*`, `/tools/calculator`, the marketing-touch attribution substrate (`client/src/lib/marketing-touch.ts`), a real sitemap, and a clean robots.txt. This is genuinely good infrastructure.
2. **The data engine** — the open-data provider (`server/services/providers/open-data-provider.ts`) and the data-source broker (`server/services/data-source-broker.ts`) already pull FEMA NFHL flood zones, USFWS NWI wetlands, USDA SSURGO soils, USGS 3DEP elevation, USDA CLU, and Census/ACS demographics. Live. For free. Today.

**These two never touch each other.** The `/learn/arizona` page cites A.R.S. statutes by hand but renders zero live parcel data. The flood/soil/elevation data that *proves* the "premium data on a free tier" promise is locked behind auth, invisible to every stranger who arrives from search. That is the single biggest growth miss in the repo right now, and it is mostly a wiring job, not a build.

The whole "best-in-class data on a free tier" theme is a marketing claim **until a stranger can see it work without logging in.** My job is to make it visible. Everything below ladders up to that.

---

## Top work items (priority order)

### 1. Public parcel-lookup widget — "Run free due diligence on any parcel" (the moat)
- **Goal:** happier-customers / data · **Phase:** 0 · **Effort:** M
- **Why it matters to first customers:** This is the single highest-leverage acquisition surface we can ship. A public, no-auth page where someone pastes an address or APN and instantly sees FEMA flood zone + SSURGO soil capability class + USGS elevation/slope + USFWS wetlands + Census context — pulled from the data engine we already run for free. It does three jobs at once: (a) ranks for enormous long-tail intent ("is [address] in a flood zone", "[county] soil type lookup"), (b) *demonstrates* the free-data promise instead of asserting it, (c) becomes the most natural CTA in the world — "Want this on every parcel in your buy-box automatically? Sign up." It is the calculator strategy (`client/src/pages/tools/calculator.tsx`) but pointed at our actual differentiator.
- **Dependencies:** open-data provider already exists; needs a public, rate-limited, cached read endpoint (lean on `provider_cache`; circuit breaking is already in the registry). Coordinate with Iris (endpoint + abuse limits — key by parcel/session, NOT raw IP per `feedback_rate_limit_ip_keying`) and Beatrice (data-accuracy disclaimer language). Maren on the upgrade narrative.
- **First step:** new route `/tools/parcel-check` under `client/src/pages/tools/`, mirroring `calculator.tsx` chrome + JSON-LD (`SoftwareApplication`, `price: "0"`). Server: thin public wrapper over `dataSourceBroker.lookup(...)` with `maxTier: "free"`, aggressive `provider_cache`, and a hard per-session cap. Emit `emitMarketingTouch({ surface: "tools:parcel-check", ... })` on every lookup so we attribute downstream signups.

### 2. Inject live open data into the `/learn` template
- **Goal:** data / flawless-ux · **Phase:** 0 · **Effort:** S
- **Why it matters:** Every `/learn/<vertical>/<state>` page is currently 100% static prose. Add a "What the free data shows in [State]" band — county-level flood-zone prevalence, dominant SSURGO soil classes, typical elevation bands — rendered from the open-data engine (cached at build or via a static county-rollup JSON). This makes the SEO pages *uniquely* data-rich versus every competitor blog that's pure text, which is exactly what Google's helpful-content system rewards, and it dogfoods the moat on a surface we already index.
- **Dependencies:** item #1's broker wiring helps but isn't required (can pre-bake county rollups into `content/learn/*`). LearnContent type lives in `client/src/pages/learn/types.ts` — add an optional `dataPanel` block (the type comment explicitly says new fields are a deliberate forcing function; this is a good one).
- **First step:** extend `LearnContent` with an optional `dataSnapshot` field, render a new section in `state-vertical.tsx` between "mechanics" and "statutes." Backfill the 10 existing JSON files with verified county rollups + named sources (truth engine applies).

### 3. The "premium data on a free tier" story across the landing surface
- **Goal:** flawless-ux / happier-customers · **Phase:** 0 · **Effort:** S
- **Why it matters:** The hero (`client/src/pages/landing/copy.ts`) leads with the five-verb lifecycle wedge — strong — but says almost nothing about *data*, which is the thing a land investor's gut decision actually hinges on. We have a defensible, differentiated story: "AcreOS runs flood, soil, elevation, and wetlands checks on every parcel — from free government data — before you ever pay for a data subscription." Right now that story is buried in a blog post (`content/blog/free-data-sources.md`) and invisible on the page that converts. Add a dedicated data-trust band to the landing: name the sources (FEMA, USDA, USGS, USFWS, Census), show the free-tier promise, and link to the public parcel-check widget (#1) as live proof.
- **Dependencies:** #1 ideally live first so the band can link to working proof. Truth-engine pass + Beatrice on any data-completeness claims (we cannot imply we cover 100% of parcels; coverage varies by county GIS).
- **First step:** add a `data` block to `LANDING_COPY` and a `DataProvenance.tsx` section between `Features.tsx` and `Pricing.tsx`; reuse `landing.css` tokens, never hardcode color (CLAUDE.md).

### 4. Phased free→paid data narrative, told honestly on the pricing page
- **Goal:** happier-customers / foundation · **Phase:** 0 · **Effort:** S
- **Why it matters:** Pricing copy already says Pro unlocks "bring-your-own-key for the parcel and skip-trace data costs you already pay." Good and honest — but it skips the headline: *the free tier already gives you premium government data at no cost, and you only reach for paid providers (Regrid/PropStream-class) when your deal volume justifies it.* That framing turns our budget constraint into a positioning advantage: we're the platform that doesn't make you pay for data until you're making money. This is the exact phased path the founder wants, told as a customer benefit instead of an internal roadmap.
- **Dependencies:** aligns with the provider-registry tier filtering already in place (free providers default; paid behind tier + credit). Lena on the BYO-key economics; Maren on tier framing.
- **First step:** revise the `pricing.sub` string in `copy.ts` + the comparison band in `Pricing.tsx` to lead with "Premium government data, free. Paid data when you scale."

### 5. Programmatic county-page expansion (open-data-powered, at scale)
- **Goal:** data / foundation · **Phase:** 1 · **Effort:** L
- **Why it matters:** The `/learn` model is state×vertical (10 pages). The real long-tail volume is **county-level** ("Cochise County AZ vacant land", "Navajo County flood zones"). With the open-data engine we can generate a genuinely useful, non-spammy county page per county we have GIS coverage for — each one carrying real flood/soil/elevation rollups (#2) so it survives Google's spam/helpful-content filters that kill thin programmatic pages. This is the ~35K-page horizon from my charter, but the open-data angle is what makes it *defensible* rather than doorway-page risk.
- **Dependencies:** #1 + #2 must ship first (the data rendering + the broker rollup pattern). Iris on a build-time county-rollup generator. Beatrice on programmatic-content quality review (FTC + helpful-content).
- **First step:** design `content/learn/county/<state>/<county>.json` shape + a generator script that calls the broker per county centroid, caches rollups, and only emits a page when data completeness clears a quality bar. Start with the counties our first customers actually operate in.

### 6. Voice-linter + truth-engine gate on every data claim
- **Goal:** rock-solid / foundation · **Phase:** 1 · **Effort:** M
- **Why it matters:** The moment we render *live data* on public pages, we inherit a new failure mode: a flood-zone or soil claim that's wrong, stale, or implies coverage we don't have is a trust-killer and a Beatrice/FTC problem. Every numeric/data claim on a public surface needs (a) a named source rendered inline (the `/learn` Sources pattern already does this — extend it), (b) a freshness/coverage disclaimer, and (c) a truth-engine check in CI so an author can't ship an unverifiable data claim. This protects the moat from becoming a liability.
- **Dependencies:** marketing-os voice-linter substrate (`docs/internal/marketing-os/02-voice-linter.md`). Beatrice owns the compliance language.
- **First step:** extend the existing learn-pages audit script to assert every rendered data figure carries a source + `asOf` date; wire it into CI alongside `npm run check`.

### 7. Attribution loop closed on the data surfaces
- **Goal:** rock-solid / data · **Phase:** 0 · **Effort:** S
- **Why it matters:** We have a durable first-party attribution substrate (`marketing_touch` table, `emitMarketingTouch`, anon-id cookie that survives the auth handshake). If the parcel-check widget and data-rich learn pages don't emit touches, we'll have built the moat blind — unable to prove to the founder that data surfaces convert. Every new data surface must wire `emitMarketingTouch` from day one so per-artifact ROI rollup (03-analytics.md §5) attributes signups back to the specific county/parcel page that won them.
- **Dependencies:** none — substrate exists.
- **First step:** add the `emitMarketingTouch` call to the parcel-check widget (#1) and any new data bands; verify the chain in the funnel with a single real lookup→signup walk-through.

---

## The open-data theme, through my lens

For most teams, "we can't afford Regrid yet" is a constraint. For growth, **it's the campaign.** The honest story — *"AcreOS runs flood, soil, elevation, and wetlands due diligence on every parcel using free government data, so you don't pay for a data subscription until your deal volume earns it"* — is more compelling than "we have a Regrid integration," because it speaks to the one thing every bootstrapping land investor feels: don't make me pay for data before I've made a deal.

The strategic move is to make the free data **visible and interactive on unauthenticated surfaces.** A claim on a landing page converts at X. A working parcel-check widget that shows a stranger their own parcel's flood zone in two seconds converts at many-X — and earns backlinks and long-tail rankings as a side effect. The data isn't just a product feature; rendered publicly, it's our cheapest, most defensible acquisition channel.

**Phased path (matches the product's provider-registry tiering):**
- **Phase 0 (now):** Free government data, rendered publicly. FEMA/USDA/USGS/USFWS/Census via the existing open-data provider. Zero monthly cost. This is the whole free tier and the whole top-of-funnel.
- **Phase 1 ($200 MRR):** Add county GIS/assessor open data (`county-gis-provider.ts` exists) for ownership/parcel geometry where counties publish it free. Still ~$0/mo, deeper coverage. Expand programmatic county pages (#5).
- **Phase 2 ($1k MRR):** Introduce one paid provider (Regrid-class) behind the tier wall + credit deduction the registry already enforces. Marketing pivots from "free data" to "free data, plus pro data when you scale" — the free tier still does the acquisition work.
- **Phase 3+:** Full paid stack (PropGrid/Zamplo-class), enrichment, skip-trace. By now MRR funds it and the free tier remains the funnel.

The discipline: **the free tier must feel premium, not crippled.** Government data is genuinely excellent for land due diligence (the founder's own blog post argues exactly this). We lean into that, not apologize for it.

---

## Quick wins (days, not weeks)

- **Add the data-provenance band to the landing** (#3 lite): name FEMA/USDA/USGS/USFWS/Census, state the free-tier promise. Pure copy + one section. Highest ROI per hour on the page that converts.
- **Surface the existing free-data blog post** (`content/blog/free-data-sources.md`) — it's strong and currently buried. Link it from the landing + add it to the sitemap. It already ranks-worthy.
- **Add `asOf`/source line to anything numeric** on public pages — cheap trust insurance ahead of the data-rendering work.
- **Lift the noindex guard on the compare pages** once Tom verifies the matrix (`ComparisonPage.tsx` notes the guard stays until positioning is confirmed) — these are ready-built "alternative" intent landers sitting dark.
- **Cross-link calculator ↔ learn ↔ parcel-check** so the existing tool pages funnel into each other (internal linking is free SEO juice we're leaving on the table).

---

## Biggest risk if my area is ignored

**We launch with the data moat invisible — and compete on features instead of the one thing we can actually win on.**

If a stranger can't *see* the free premium data work before signing up, then "best-in-class data on a free tier" is just another SaaS claim, indistinguishable from every competitor's landing page. We'd be asking land investors to trust an assertion at exactly the moment trust is lowest (pre-signup, pre-card, from an unknown brand). Worse, we'd have built and be paying to run a genuinely differentiated data engine — and getting zero acquisition leverage from it because it's locked behind auth.

The corollary risk: if we *do* render data publicly but skip the truth/source/freshness gate (#6), a single wrong flood-zone or soil claim becomes a credibility and FTC problem that's far more expensive than the page was ever worth. The moat and the guardrail ship together or not at all.

First customers are happiest when the product proves itself before they commit. Public, interactive, free open data is how we let it.
