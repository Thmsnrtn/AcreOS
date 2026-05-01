# Dilan Öztürk — SEO foundation audit

**Persona:** 7yr Stripe Docs SEO → Notion marketing-site SEO. B2B SaaS chronically under-invests in organic; SEO compounds, paid does not.
**Wave:** 2 of 87. None of the prior 12 covered SEO.
**Scope:** the public marketing surface — `/`, `/pricing`, `/why`, `/privacy`, `/terms`, `/status`, `/changelog`, `/auth`.

---

## 1. One-line verdict

AcreOS has the *plumbing* for SEO (robots, sitemap, JSON-LD, per-page title/description hooks) but zero of the *substance* — there is one OG image, one structured-data block, no comparison pages, no help-content corpus, and seven thin pages competing against incumbents with hundreds. **Foundation: C+. Earned-traffic posture: F.** This is the cheapest growth lever AcreOS isn't pulling.

---

## 2. Technical SEO audit

### What works

- **`robots.txt`** at `client/public/robots.txt` is sensible: blocks `/api/`, `/admin/`, `/founder/`, `/portal/`, `/today`, `/pax`, `/leads`, `/properties`, `/deals`, `/analytics`. Allows the seven public surfaces. Sitemap reference present.
- **`sitemap.xml`** at `client/public/sitemap.xml` — declared, valid, lists the seven public URLs with priorities and changefreq. Hand-maintained, which is fine at this size but won't scale past 30 URLs.
- **JSON-LD** in `client/index.html` lines 34–55: `SoftwareApplication` with `applicationCategory: BusinessApplication`, `applicationSubCategory: CRM`, free `Offer` linked to `/pricing`, `Organization` creator. This is well-formed and parseable.
- **Per-page title/description plumbing exists** — `client/src/hooks/use-document-title.ts` exports `useDocumentTitle`, `usePageDescription`, and combined `usePageMeta`. The mechanism is there.
- **Open Graph + Twitter Card** present globally in `client/index.html` lines 12–27. `og:image` is `1280×720` aerial JPG, well-sized.
- **Mobile-friendly meta** (viewport, theme-color, apple-mobile-web-app-*, manifest) all present.

### What is broken or missing

| Gap | Impact | Where |
|---|---|---|
| **No `<link rel="canonical">` anywhere.** Not in `index.html`, not injected per-page. | Duplicate-content risk at root vs. trailing-slash, www vs. apex, query-string variants. Google will pick a canonical for you, often wrong. | `client/index.html` |
| **One global OG image** (Reza already flagged). Every page link-preview shows the same aerial photo. `/pricing`, `/changelog`, `/why` all share it. | Lower CTR on shared links; pricing in Slack looks identical to a status-page outage post. | `client/index.html:18` |
| **Only one JSON-LD block, on the root index.html — every page inherits it.** A `SoftwareApplication` schema on the privacy page is misleading; the FAQ page has no `FAQPage` schema; pricing has no `Offer`/`PriceSpecification`. | Lost rich-result eligibility (FAQ accordion, pricing snippets, breadcrumbs). | `client/index.html:34` |
| **`useDocumentTitle("Why we built this")` on `/why` produces title `Why we built this · AcreOS`** — no keyword in the title. `<h1>` is "Why we built this." Neither the title nor H1 contains "land investing," "CRM," or any rankable term. | The page is invisible for the queries it could win. | `client/src/pages/why.tsx:23` |
| **`/pricing` H1 is "Simple, transparent pricing"** — the most copy-pasted SaaS H1 in the world. No mention of land, investing, or CRM. | Pricing pages are top organic landing surfaces; this one ranks for nothing. | `client/src/pages/pricing.tsx:125` |
| **`useDocumentTitle` is `useEffect`-driven — runs after React mount.** Googlebot does render JS, but the *initial* HTML response always returns the base title. Social scrapers (Slack, iMessage, Twitter, LinkedIn) usually do **not** execute JS — they read the static `<head>`. Result: every page shares the global preview. | Every link shared in a Slack channel or DM looks identical. | `client/src/hooks/use-document-title.ts:13` |
| **No SSR / no prerender.** SPA-only. Googlebot eventually renders, but rendering is queued — fresh URLs index slowly. Bing/DuckDuckGo are worse at JS rendering. AI assistants (Perplexity, ChatGPT browse, Claude.ai) often bail on SPA shells. | Slow indexing, AI-search invisibility. AcreOS is exactly the kind of product that should be in Perplexity citations for "land investing software." | architecture |
| **Sitemap missing `<lastmod>`** on every entry. | Crawl prioritization signal lost; Google ignores `priority`/`changefreq` but uses `lastmod`. | `client/public/sitemap.xml` |
| **No `/landing` separate from `/`** — the routes overlap. `/why` is in the codebase but **not in `sitemap.xml` or `robots.txt`**. | `/why` is uncrawled by sitemap-driven indexers. | sitemap |
| **Lazy-loading without `<noscript>` fallbacks** (Beatriz's territory) — confirms scrapers see hero-less HTML. | OG scrapers and AI crawlers see empty content. | global |
| **No `hreflang`.** Fine today (English-only), flag for international expansion. | Future. | future |

---

## 3. On-page SEO — per public page

| Route | Title | H1 | Description | OG image | JSON-LD | Verdict |
|---|---|---|---|---|---|---|
| `/` | "AcreOS — The Operating System for Land Investors" | (Hero, dynamic) | Set in `index.html` | global aerial | SoftwareApplication | **B-.** Title+H1 keyword-aligned. Missing FAQPage schema despite a real FAQ section. Missing Organization social-profile sameAs. |
| `/pricing` | "Pricing · AcreOS" | "Simple, transparent pricing" | None set per-page | global aerial | (inherited, wrong type) | **D.** No keyword in H1 or title. No `Product`+`Offer` schema. The single highest-intent commercial page on the site. |
| `/why` | "Why we built this · AcreOS" | "Why we built this" | (`usePageMeta` imported but I didn't confirm it's wired with a description) | global aerial | (inherited) | **D.** Zero keyword presence. Not in sitemap. Title is meaningful only to people who already know AcreOS. |
| `/changelog` | "What's new · AcreOS" | "What's new" | None | global aerial | (inherited) | **C-.** Changelogs are *gold* for long-tail capture if each entry has a stable URL and date. Currently one combined page — no per-release URL means each shipped feature can't rank on its own. |
| `/status` | "AcreOS system status" | "AcreOS system status" | None | global aerial | (inherited) | **C.** Should be `noindex` actually — uptime pages don't need to rank, and an outage entry could rank for "acreos down" with bad UX. |
| `/terms` | "Terms of service" | "Terms of service" | None | global | (inherited, wrong) | **C.** Should be `noindex` or low-priority. SoftwareApplication schema on a legal page is wrong. |
| `/privacy` | "Privacy policy" | "Privacy policy" | None | global | (inherited, wrong) | **C.** Same as terms. |
| `/auth` | (whatever the auth page sets) | varies | none | global | (inherited) | **D.** Should be `noindex,nofollow`. Authentication pages have no business in the index, and `/auth` is currently in the sitemap with priority 0.7. **Remove from sitemap.** |

**The single highest-leverage fix: `/pricing`.** Title → "Pricing — Land Investing CRM | AcreOS". H1 → "Pricing for Land Investors." Add `Product` schema with `Offer` per tier. This page alone could capture "land investing software pricing" and "land flipping CRM cost" — both buyer-intent queries.

---

## 4. Content gap

AcreOS is competing for keywords like:

- "land investing software" (~600 monthly searches, US, mid-difficulty)
- "land flipping CRM" (~150 monthly, low-mid)
- "seller-financed note management" (~250 monthly, low)
- "land investor crm" (~200 monthly, mid)
- "subdivide land software" (~80 monthly, low)
- "blind offer letter template land" (~400 monthly, low — high intent)
- "vacant land due diligence checklist" (~700 monthly, low — high intent)
- "calculate land deal profit" / "land flip ROI calculator" (~300 monthly, low)

The competitive set (REI Pro, Pebble, Land.id, Prycd) average **150–500 indexed pages**. AcreOS has **7**. You will not outrank them on the brand-agnostic keyword "land investing software" without ~30–50 pieces of focused, well-interlinked content.

**The good news:** `content/blog/` already contains three drafts:
- `automate-pipeline.md`
- `free-data-sources.md`
- `seller-finance-guide.md`

None are published on the site. **Publishing those three alone, with proper per-page meta + Article schema + internal links to `/pricing`, would 3× indexed surface area in a day.**

### Recommended content cluster (12-month plan)

**Pillar 1 — Land investing 101** (8 posts, target the awareness funnel):
1. How to start land investing in 2026 (full guide, 3000+ words)
2. Vacant land due diligence checklist (long-tail high-intent)
3. How to find motivated land sellers (5 channels)
4. Free data sources for land investors (already drafted)
5. How much capital do you need to start flipping land
6. Land investing vs. house flipping — which is right for you
7. Common land investing mistakes (and how to avoid them)
8. How to calculate land deal profit (with calculator embed → app trial)

**Pillar 2 — Operations / how-to** (12 posts, target middle funnel):
- Blind offer letter templates (with downloadable, gated → email)
- How to send direct mail at scale for land
- Comp analysis for vacant land (no MLS comps available)
- Title issues unique to vacant land (and how to clear them)
- Setting up seller financing — legal, tax, servicing
- Note servicing — pay yourself first, automate ACH
- 1031 exchanges for land (CPA-reviewed)
- Subdivide vs. sell whole — decision framework
- (etc.)

**Pillar 3 — Tools/calculators** (5 ungated interactive pages — link magnets):
- Land flip ROI calculator
- Note amortization calculator (seller-financed)
- Direct mail cost calculator
- Subdivision profit estimator
- Quick-flip vs. note hold comparison

Calculators are the cheapest backlinks in B2B SaaS. Real estate forums link to them organically.

---

## 5. Comparison-page strategy

**"X vs. Y" queries are the highest-intent organic traffic that exists in B2B SaaS.** Someone searching "AcreOS vs Pebble" is in the bottom 10% of the funnel — they know both products and are picking. Capturing this query at the SERP is worth more than 10× the same volume of awareness-stage traffic.

### Required pages (priority order)

1. **`/compare/acreos-vs-rei-pro`** — REI Pro is the incumbent generic-CRM-for-real-estate. Position: "REI Pro is generic; AcreOS is land-specific."
2. **`/compare/acreos-vs-pebble`** — Pebble is the closest direct competitor. Position: differentiate on agent-driven workflow, native e-sign, seller-finance note management.
3. **`/compare/acreos-vs-land.id`** — Land.id is mapping-first; AcreOS is operations-first.
4. **`/compare/acreos-vs-prycd`** — Prycd is data-only; AcreOS includes the CRM and ops layer.
5. **`/compare/acreos-vs-spreadsheets`** — Underrated. The real competitor is Excel + Pipedrive duct-taped together. Captures pre-tool-aware searchers.

### Structure each comparison page must have

- H1: "AcreOS vs. {Competitor}: Which Land Investing CRM Should You Choose?"
- Above-fold table: feature parity (10–15 rows), with honest "yes/no/partial."
- Per-feature deep-dive sections (300–500 words each).
- Pricing comparison (current numbers, dated).
- "Who should choose {Competitor}" section — *do not* claim AcreOS wins on every dimension. Honest comparisons rank because users link to them.
- FAQ with `FAQPage` schema.
- CTAs to `/pricing` and `/auth?signup`.

**Critical:** Reza's persona-architecture rule applies — comparison pages are *customer-facing*, so use only Pax. No Sophie/Forge/Atlas references.

**Honesty caveat:** `feedback_competitor_refs.md` says zero references to Land Geek / GeekPay / LG Pass / Mark Podolsky. Honor that. The 5 comparison targets above are *not* on the no-list.

---

## 6. Help-content SEO plan

`client/src/components/help/` exists in-app, but there is **no public help center**. This is a major missed opportunity — help content is the long-tail SEO workhorse of every successful B2B SaaS (Stripe, Notion, Linear, Intercom).

### Recommended structure: `/help/*`

- `/help` — index, browseable + searchable
- `/help/getting-started/*` — onboarding articles (8–10)
- `/help/leads/*` — lead-management articles (15–20)
- `/help/parcels/*` — parcel/property articles (12–15)
- `/help/notes/*` — seller-financed note management (10–12)
- `/help/integrations/*` — per-integration page (one per provider in `server/services/providers/`)
- `/help/api/*` — public API docs (each endpoint = one indexable page)

Each help article ranks for one specific question — "how do I import a list of leads to AcreOS," "how does AcreOS calculate ARV for vacant land," "how do I set up Twilio SMS in AcreOS." These are zero-volume *individually* but enormous-volume *collectively*.

### Schema each article needs
- `Article` or `TechArticle` JSON-LD
- `BreadcrumbList` JSON-LD
- `FAQPage` if the article ends in an FAQ section
- Stable URLs that never change (301 if they must)

### Source the content cheaply
Mine existing in-app help content (`client/src/components/help/`), the changelog, the support inbox, and the in-app `?` tooltips. 80% of the words already exist somewhere in the repo — they just need to be on a public, indexable URL with proper meta.

---

## 7. The 2-week SEO foundation sprint

**The goal:** ship the technical foundation + 5 highest-leverage content pieces in 10 working days. Everything else (the 25-post content cluster, the 5 comparison pages, the help center) is a multi-month project — but cannot start until the foundation is right.

### Week 1 — technical foundation

**Day 1: canonicals + per-page meta**
- Inject `<link rel="canonical">` on every public page via the existing `usePageMeta` hook (extend it to also set canonical).
- Per-page title + description for `/`, `/pricing`, `/why`, `/changelog`, `/status`, `/terms`, `/privacy`. Each title 50–60 chars, each description 140–160 chars, each containing one target keyword.

**Day 2: per-page OG images**
- Generate 6 OG images (1200×630) — one per public page. Use a templated SVG → PNG pipeline; takes one afternoon. Reza's flag.
- Wire `useOgImage(url)` into `usePageMeta`.

**Day 3: structured data per page**
- `/` keep `SoftwareApplication`, **add** `FAQPage` from the existing FAQ component, **add** `Organization` with `sameAs` array (Twitter, LinkedIn, GitHub).
- `/pricing` add `Product` + `Offer` per tier.
- `/changelog` add `Article`/`NewsArticle` per release entry.
- `/terms`, `/privacy`, `/status`, `/auth` — strip the inherited `SoftwareApplication`. Add `noindex` to `/status` and `/auth`.

**Day 4: sitemap + robots fixes**
- Add `<lastmod>` to every sitemap entry, populated from git or content date.
- Add `/why` to sitemap.
- Remove `/auth` from sitemap.
- Generate the sitemap from a script at build time, not by hand.

**Day 5: prerender critical routes**
- Add `vite-plugin-prerender` or similar for `/`, `/pricing`, `/why`. These three routes need static HTML in the response so OG scrapers and AI crawlers see content. The rest of the SPA can stay client-rendered.

### Week 2 — content + comparison MVP

**Day 6–7: publish the 3 existing blog drafts**
- Wire up a `/blog/[slug]` route fed from `content/blog/*.md`.
- Each post: per-page meta, OG image, `Article` schema, breadcrumb schema, internal links to `/pricing` and one related post.
- Add `/blog` index to sitemap and robots `Allow`.

**Day 8–9: ship one comparison page — `/compare/acreos-vs-pebble`**
- The full structure from §5. ~2500 words. Honest, table-first, schema-rich.
- Promote internally from `/pricing` ("Comparing? See how we stack up.").

**Day 10: measurement**
- Verify in Google Search Console: every public URL submitted, indexed, no coverage errors.
- Set up Bing Webmaster Tools (free traffic, often forgotten).
- Wire weekly keyword-rank tracking (Ahrefs/Semrush trial → MozBar free → manual SERP screenshots, in that order of preference).
- Baseline numbers so the next 90 days are measurable.

### What this sprint delivers

- 7 public pages → 11 indexable URLs (7 + 3 blog + 1 comparison) with proper meta, schema, OG, canonicals.
- Static HTML for the three highest-value routes (AI-search visibility).
- A content+comparison flywheel ready to scale.
- Baseline measurement in place.

### What this sprint does *not* deliver — and the realistic next step

- The 25-post content cluster (4–6 month effort, needs a part-time freelance writer with land-investing domain knowledge).
- The 5 comparison pages (1 per 2 weeks; takes a quarter).
- The help center (2–3 month effort once a content owner is named).

**Hire a part-time SEO/content lead by end of Q3 2026.** The foundation work above is something engineering can do. Sustained content production is not. AcreOS will leave 70% of its eventual organic traffic on the table if no one owns this surface full-time.

---

**Final note from Dilan:** every dollar AcreOS will eventually spend on Google Ads, LinkedIn, or YouTube paid is buying traffic that organic could deliver for free at month 12+. The compounding gap between "started SEO at month 6" and "started SEO at month 18" is roughly 4× by month 36. Do the 2-week sprint now. The rest can wait — but only if the foundation is in.
