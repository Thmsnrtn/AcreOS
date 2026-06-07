# Soren — CGO/CMO Elevation Brief

**Date:** 2026-06-07
**Lens:** Brand polish + conversion craft. Landing/marketing refinement, the public parcel-check widget as a growth engine, programmatic-SEO depth, the funnel + attribution, voice/visual distinctiveness. Make the front door world-class.

**Premise.** The front door is already honest and well-built — the /learn corpus is statute-grade (`content/learn/land-flipping/texas.json` cites §5.077, §5.063, §34.21 with real exposure math), the parcel-check widget proves the data moat instead of asserting it, the marketing-touch substrate (`client/src/lib/marketing-touch.ts`) is owned and durable, and the SEO rank tracker auto-enqueues content iterations on drops. This is a B+ growth surface. The gap between B+ and best-in-class is not more features — it's **discoverability hygiene, visual distinctiveness, and closing the attribution loop to revenue.** Below, opinionated and ordered by value.

---

## TOP IDEAS

### 1. Make the sitemap self-healing — it is currently set to silently delete our best SEO pages
**refine · both · S**

This is the one that would actually cost us rankings. `client/public/sitemap.xml` contains the 10 `/learn/<vertical>/<state>` pages (lines for texas, florida, arizona…). But the generator that rebuilds it, `script/generate-sitemap.ts`, builds *only* from `shared/seo/public-routes.ts` — which contains **14 static routes and zero /learn pages**. The next `tsx script/generate-sitemap.ts` run in the build pipeline will overwrite the committed file and **drop all 10 /learn URLs**, plus it never had the 3 county pages (`cochise`, `navajo`, `brewster`), `/tools/parcel-check`, `/tools/calculator`, or `/learn/county/*`. Our deepest, most rankable content is one build away from disappearing from the sitemap.

**What "great" looks like:** the sitemap is generated from a single source of truth that enumerates the content registries — `client/src/pages/learn/registry.ts` (6 verticals), `client/src/pages/learn/county-registry.ts`, and the tools routes — so adding a `/learn` JSON file automatically adds its sitemap entry, with per-page `lastmod` derived from the content file's `asOf`/git mtime, not a blanket today-stamp (Google discounts everything-changed-today sitemaps).

**First step:** in `script/generate-sitemap.ts`, import `listLearnRoutes()` + the county registry + the tools paths and concat them onto `PUBLIC_ROUTES` before `buildSitemap()`. Add a unit test asserting `learn` URL count == registry length so this can never silently regress again.

---

### 2. Per-page dynamic OG/Twitter cards — the unfurl is the first impression and it's one stock photo
**elevate · customer · M**

Every shareable surface unfurls with the *same* static image: `OpenGraph.tsx` defaults `image` to `https://acreos.io/images/aerial_view_wide_hor_0f1000c4.jpg` for the landing, the parcel-check, every /learn page, every county page, the calculator. When a land investor pastes a `/learn/land-flipping/texas` link into a BiggerPockets DM or an X reply, the card should say "Land flipping in Texas — §5.077, executory contracts, the close" over a branded card with the AcreOS mark — not a generic aerial photo that looks like every other land site. The unfurl IS the ad in organic distribution, and ours is undifferentiated.

**What "great" looks like:** a deterministic OG-image route (`/og/learn/:vertical/:state.png`, `/og/county/:state/:county.png`, `/og/parcel-check.png`) that renders the page's headline + a brand-system card (Fraunces title, terracotta accent, the parcel-grid motif from `Hero.tsx`) via Satori/`@vercel/og`-style SVG→PNG at the edge, cached. The county cards can even render the real elevation band / flood read so the unfurl itself demonstrates the data moat. Distinctive, on-brand, and it makes every shared link a recruiting poster.

**First step:** add a server route that takes a title + subtitle + variant and returns a PNG using `satori` + `resvg` (no headless browser, runs in the worker). Wire `OpenGraph` callers on /learn and /tools to pass the computed `/og/...` URL. Start with the /learn template since those are our highest-intent shares.

---

### 3. Close the attribution loop from first touch all the way to paid MRR
**develop · founder · M**

We own the front of the funnel beautifully — `marketing_touch` captures page_view / cta_click / funnel_step with UTM + anonymous_id, and `routes-acquisition-utm.ts` joins the anon chain to the new account at signup. But the chain appears to stop at signup. There's no first-class report that says "the `/learn/land-flipping/texas` page sourced 6 trials and 1 paid conversion at $X MRR." Without the touch→trial→paid→revenue join, every content-investment decision (which /learn pages to deepen, which counties to add) is a guess. This is the difference between a marketer and a growth *engine*.

**What "great" looks like:** a founder-side attribution view (`/founder/*`, never founder-dashboard.tsx per CLAUDE.md) that walks `marketing_touch` → account → subscription tier → financial_ledger, showing per-surface first-touch AND last-touch sourced trials, trial→paid rate, and realized MRR by content piece. The SEO rank tracker already auto-iterates on rank drops; this lets it auto-prioritize *which pages are worth iterating* by revenue, not just rank.

**First step:** a read-only query service joining `marketing_touch.anonymousId` → the acquisition-utm account link → `organizations`/subscription → `financial_ledger`, surfaced via a new `/founder` route + a `getRecentRankings`-style server function. Keep it on `ReadOnlyDb`.

---

### 4. Kill the last hardcoded numbers on the hero — they violate our own honest-data contract
**refine · customer · S**

`copy.ts` proudly documents that "14 comps per parcel" was *removed* from the hero sub for truth-engine reasons. But `Hero.tsx` `HeroVisual` still hardcodes a fake Pax card: "Comparable sales found **14**", "Median $/acre **$2,840**", "Confidence **High · 87%**", and a drafted reply quoting "$14,200 cash… 12% above the median for parcels your size in Coconino." It's `aria-hidden` decoration, but a sharp first customer who reads the source — or just notices the demo never changes — sees the exact fabricated-value pattern we publicly killed everywhere else. The brand's whole wedge is "nothing happens behind your back / every action shown with the data it used." A frozen fake demo undercuts that.

**What "great" looks like:** the hero cards are visibly framed as an illustration ("Example · representative output") OR — better — they cycle through 2–3 real anonymized scenarios drawn from the same fixture set the eval suite uses, so the demo *is* the product's actual voice. The reply card especially should match Pax's real DATA_GROUNDING tone.

**First step:** add an "Example output" eyebrow chip to each `lp-hero-card` in `Hero.tsx`, and replace the inline literals with a small `HERO_DEMO_FIXTURES` constant flagged as illustrative. S effort, removes a credibility landmine.

---

### 5. Programmatic-SEO depth: expand /learn coverage AND add the county→state→tool internal-link mesh
**develop · customer · L**

We have 10 state×vertical /learn pages and 3 county pages. The content quality is genuinely best-in-class (the Texas page would out-rank most law-firm blog posts). The two gaps to greatness: **breadth** (the high-volume land states — Colorado, Nevada, Oklahoma, Tennessee, Missouri, Michigan UP — and the note states are missing) and **interlinking** (each /learn page is an island; there's no breadcrumb mesh tying county → state → vertical → tool). Google rewards topical clusters with internal links; a flat set of orphan pages leaves rank on the table.

**What "great" looks like:** a hub-and-spoke topic cluster — a `/learn` hub (it doesn't exist; `parcel-check.tsx` even works around its absence by linking to "the first authored route"), state pages linking down to their county pages and across to the relevant tool, county pages linking up to state + to `/tools/parcel-check` pre-filled with that county. Plus the next 10–15 state pages authored to the existing statute-grade bar (this is where the auto-iteration cron earns its keep).

**First step:** build the `/learn` hub page (registry-driven grid grouped by vertical), then add breadcrumb + related-links blocks to `state-vertical.tsx` and `county.tsx`. Author Colorado + Tennessee land-flipping next; they're high-intent, underserved.

---

### 6. Parcel-check widget → a sharable, embeddable, repeat-visit growth loop
**elevate · customer · M**

The widget is the single best top-of-funnel asset we have — it *demonstrates* the moat. Right now it's a one-shot: run a check, see a CTA, leave. Three moves turn it into a loop. (a) **Shareable result URLs** — a checked parcel should produce `/tools/parcel-check?address=…` that re-runs and unfurls with a dynamic OG card (idea #2), so an investor can text a partner "look at this lot." (b) **Embeddable** — a `/tools/parcel-check-embed` like the calculator already has (`calculator-embed.tsx`), so land-investing bloggers/forums embed it and we earn backlinks + branded impressions. (c) **A reason to return** — "save this parcel / watch it for tax + owner changes" gated behind a free signup, which is exactly the owner-change/tax-delta detector we already shipped on the Today door. That's a clean free-tool → account hook with no dark pattern.

**What "great" looks like:** the free tool is a verb people share, embed, and come back to — the way "run it through [tool]" enters the vocabulary of a niche. Each is an owned-channel acquisition flywheel at $0 spend (Phase 0 compliant).

**First step:** add address→querystring hydration + a "Copy share link" button to `parcel-check.tsx` (smallest, highest-leverage), then the embed variant mirroring `calculator-embed.tsx`.

---

### 7. A real brand/voice system file the linter and humans both read
**improve · both · S**

The voice is strong and consistent (mechanics-first, third-person, no SaaS jargon) and there's a voice linter substrate. But the *canonical* brand articulation lives scattered across `copy.ts` comments, my charter, and `feedback_landing_voice`. Before authors (or future agents) enter the content pipeline at scale, the brand needs one durable, opinionated source: the voice rules, the banned-words list (the linter's truth), the type system (Fraunces 144 opsz hero is *sacred* per charter — that rule should be written down where a designer would find it), the color tokens, the OG-card spec, and the 10-second test. Distinctiveness is a system, not a vibe.

**What "great" looks like:** `docs/internal/marketing-os/brand-system.md` (or a `/brand` internal page) that's the single answer to "is this on-brand?" — and the voice linter cites it.

**First step:** consolidate the existing scattered rules into one file; have the voice linter load its banned-word list from it so doc and enforcement can't drift.

---

## BOLDEST ELEVATION BET

**The dynamic OG-card system (idea #2), scaled into a "every public page is its own ad" engine — with the county cards rendering real data.**

Here's the bet: our distribution is organic (Phase 0, $0 paid). In organic distribution, the link unfurl *is* the creative — it's what shows in the X reply, the iMessage, the Slack, the forum embed. Right now every one of our links unfurls identically, with a stock aerial photo, looking exactly like every competitor and every land blog. If instead a `/learn/county/arizona/cochise` link unfurls as a branded card reading **"Cochise County, AZ — elevation 4,200 ft, low flood risk, Aridisol soils"** rendered from the *actual free government data we pulled*, then every share is simultaneously: on-brand, distinctive, and a live proof of the data moat. The card sells the product *in the unfurl, before the click.* No competitor does this because most competitors don't have the honest per-parcel data layer to render — we do. It turns our single biggest technical asset (the honest data moat) into our single biggest *visual brand asset*, at the exact moment of social sharing. That compounds across thousands of programmatic pages. It's the move that makes AcreOS look unmistakably like AcreOS anywhere a link travels.

---

## SMALL HIGH-ROI POLISH

- **`/learn` hub route is missing** — `parcel-check.tsx` literally works around it ("there is no /learn hub route"). A registry-driven hub is an hour of work and a real SEO + UX win.
- **Sitemap `lastmod` is a blanket today-stamp** (`new Date().toISOString().slice(0,10)`) — derive per-URL from content `asOf` so Google trusts it.
- **County pages absent from sitemap** entirely (cochise/navajo/brewster) — fold into idea #1.
- **`/tools/calculator` and `/tools/parcel-check` missing from sitemap + PUBLIC_ROUTES** — high-intent "free [x]" pages, should be indexed.
- **OG image alt text is generic** ("Aerial view of open land…") on every page; make it per-page in OpenGraph callers.
- **Hero secondary CTA ("Watch a 90-second demo first") anchors to `#how`, not a demo** — either there's a 90-sec demo and it should link there, or the copy overpromises. Align copy to reality.
- **No JSON-LD `BreadcrumbList`** on /learn or county pages — cheap rich-result win on programmatic pages.
- **No `FAQPage` JSON-LD** despite the Texas page having 7 genuinely good Q&As — that's free SERP real estate left unclaimed.
- **`emitMarketingTouch` has no `scroll_depth`/engaged-time event** — we measure clicks but not whether the statute-grade /learn content is actually *read*; one engaged-time beacon makes content-quality measurable.

---

## THE ONE THING THAT WOULD MOST EMBARRASS US

**The sitemap is configured to silently delete our 10 best SEO pages on the next build.** The committed `client/public/sitemap.xml` lists all the /learn pages, but `script/generate-sitemap.ts` regenerates from `shared/seo/public-routes.ts`, which contains zero /learn entries — so the next pipeline run overwrites the file and strips our deepest, most rankable, statute-grade content (the Texas §5.077 page, etc.) out of the sitemap entirely, along with the county pages and the free tools. A sharp first customer wouldn't see it directly, but a sharp *competitor's SEO person* — or anyone who checks `acreos.io/sitemap.xml` — would notice our best content isn't even submitted for indexing. We spent the effort to write law-firm-grade content and then risk hiding it from Google through a build-time footgun. That's the unpolished thing in my domain I'd fix first, today (idea #1).
