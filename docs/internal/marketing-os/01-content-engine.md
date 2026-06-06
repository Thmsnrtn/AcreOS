# Content Engine Spec

**Companion to:** `00-blueprint.md`
**Owner:** Soren
**Status:** Specification. No code in this round.

---

## 1. Cadence

| Frequency | Type | Voice | Owner | Notes |
|---|---|---|---|---|
| Daily | 1 programmatic SEO page | Mechanics-first | Soren (templated) | Auto-generated from data + template; Soren reviews 1 sample/week for drift |
| Weekly | 1 editorial post | Mechanics-first, evergreen | Soren | 600–1,200 words; deep, useful, citation-grounded |
| Monthly | 1 long-form piece | Mechanics-first, definitive | Soren | 2,500+ words; positions AcreOS as a category author |
| Quarterly | 1 category-shaping piece | Mechanics-first, opinionated | Soren | The annual "State of Land Investing" report-type artifact; press-ready |

The cadence is the metronome. Missing a week shows up as a tracked metric. The quarterly piece is the anchor that makes the weekly pieces compound.

---

## 2. Programmatic SEO architecture

### 2.1 URL pattern

```
/learn/<vertical-slug>/<state-slug>/                    # Tier 1 (today's pattern)
/learn/<vertical-slug>/<state-slug>/<county-slug>/      # Tier 2 (Phase 2+)
/learn/<vertical-slug>/<state-slug>/<jtbd-slug>/        # Tier 3 (Phase 2+)
```

Source for Tier 1 today: `client/src/pages/learn/registry.ts` — Vite glob `content/learn/*/*.json`, 10 pages live as of 2026-06-05.

### 2.2 Single-page schema

```ts
interface LearnPage {
  vertical: BusinessTypeId;          // from shared/business-types.ts
  stateSlug: string;                  // e.g. "texas"
  stateName: string;                  // e.g. "Texas"
  county?: string;                    // Tier 2+
  jtbdSlug?: string;                  // Tier 3+
  headline: string;                   // <h1>
  subheadline: string;                // <h2>
  sections: PageSection[];            // 6–10 sections, mechanics-first
  facts: FactCitation[];              // every numeric claim, sourced
  faq: { q: string; a: string }[];    // FAQ schema.org markup
  relatedPages: string[];             // internal cross-link slugs
  schemaOrg: SchemaOrgPayload;        // Article, FAQPage, BreadcrumbList
  freshnessRule: FreshnessRule;       // see §2.4
  generatedAt: string;
  reviewedBy: "human" | "soren-ai" | "auto";
}

interface FactCitation {
  claim: string;
  source: "regrid" | "attom" | "county_gis" | "usda_nass" | "manual";
  retrievedAt: string;
}

interface FreshnessRule {
  refreshEvery: "30d" | "90d" | "180d" | "365d";
  reason: string;
}
```

### 2.3 On-page elements (required, in order)

1. Breadcrumb (linked).
2. H1 — headline.
3. H2 — subheadline.
4. Intro paragraph (mechanics-first, no founder voice).
5. The five-verb lifecycle adapted to the vertical/state.
6. Data section (real numbers from grounding source; each with `FactCitation`).
7. FAQ block (4–7 questions; FAQPage schema.org markup).
8. Related pages (4–8 internal links to sibling state/vertical pages).
9. CTA band (single CTA: "Run AcreOS on your county — free for 14 days").
10. Footer trust block (last reviewed date, data sources).

### 2.4 Freshness rule

Programmatic pages cannot rot. Each page declares a refresh cadence based on data source volatility:

- **30d:** counties with active foreclosure docket data.
- **90d:** parcel-count + acreage-band summaries.
- **180d:** state-level statutes and procedural facts.
- **365d:** historical/contextual content.

A job runs nightly and flags pages past their refresh window. The page renders a "Last reviewed: <date>" footer.

### 2.5 Data sources

| Source | What it grounds | Cost |
|---|---|---|
| Regrid | Parcel counts, ownership types, acreage bands | Already integrated (`shared/business-types.ts` integrations list) |
| ATTOM | Comparable sales | Already integrated |
| County GIS | County-level parcel facts | Already integrated |
| USDA NASS | Rural-land context | Already integrated |
| Census ACS | Demographics for state pages | New — Phase 1 add |
| State statutes (manual library) | Procedural facts | Manual; reviewed quarterly |

---

## 3. The 3-axis content schema

Every content artifact (programmatic page, editorial post, long-form, video) is placed on three axes:

### 3.1 Axis 1 — Vertical

The three core verticals + five beta. Roadmap verticals get no dedicated content until promoted to beta.

### 3.2 Axis 2 — Jobs-to-be-done (JTBD)

The land-investor lifecycle decomposed into the operator's actual jobs:

1. **Define the buy-box** (counties, acreage, price, owner type)
2. **Source the list** (parcel pull, filter, segment)
3. **Run the comps** (real comparable sales, not estimates)
4. **Send the mail** (direct mail / SMS)
5. **Triage the replies** (Pax-drafted; operator-approved)
6. **Underwrite the offer** (margin math, exit math)
7. **Close the deed** (title, escrow, recording)
8. **Service the note** (payments, dunning, payoff)
9. **Resell the parcel** (Pax for buyer outreach; price-discovery)
10. **Operate the portfolio** (KPIs, tax, year-end)

### 3.3 Axis 3 — Funnel stage

TOFU / MOFU / BOFU.

### 3.4 The matrix

```
                  TOFU            MOFU              BOFU
Land flipper × JTBD-1 → programmatic page    → comparison page   → in-product
Land flipper × JTBD-2 → editorial post       → demo screencast   → onboarding
Note investor × JTBD-8 → long-form           → product feature   → first-payment-due
... (each cell shippable)
```

### 3.5 Highest-leverage cells (priority order)

1. **Land flipper × JTBD-3 (run the comps) × MOFU** — the "real comps not Zillow estimates" claim is in `client/src/pages/landing/copy.ts` hero.sub. This is the defensible differentiator; a dedicated MOFU page deepens it.
2. **Land flipper × JTBD-4 (send the mail) × TOFU** — programmatic state pages already address this; deepen with editorial.
3. **Note investor × JTBD-8 (service the note) × MOFU** — no horizontal product owns note servicing; AcreOS does. This is a category-creating piece.
4. **Land flipper × JTBD-1 (define the buy-box) × TOFU** — entry-point JTBD; high search volume.
5. **Hybrid × JTBD-10 (operate the portfolio) × BOFU** — drives upgrade-tier conversion.

---

## 4. /learn stack decision — decouple from Vite

### 4.1 Today

`client/src/pages/learn/registry.ts` uses `import.meta.glob` with `eager: true`. This bundles every `content/learn/<vertical>/<state>.json` into the SPA at build time.

At 10 pages this is fine. At 1,500 pages the bundle gains ~5–15 MB. At 35,000 pages it is not viable. Vite does not statically pre-render HTML; SEO depends on client-rendered content which crawlers handle worse than pre-rendered HTML, and Core Web Vitals degrades.

### 4.2 Options evaluated

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Keep Vite, server-render on demand | Single repo, no migration | Doesn't solve bundle bloat for client; SEO compromise persists | No |
| Move /learn to Astro | Static-generation native; islands for interactivity; near-zero JS by default; excellent SEO | Second framework in repo; deploy pipeline addition | **Recommended** |
| Move /learn to Next.js (App Router, static export) | More mainstream; same React | Heavier framework; overkill for content; not aligned with current Vite SPA | No |
| Move /learn to 11ty | Excellent static-gen; mature | Templating language switch; no React reuse | No |

### 4.3 Recommendation

**Astro for /learn, served from a separate route group** (e.g. `learn.acreos.com` or `/learn/*` proxied at the edge). Authoring stays in `content/learn/*/*.json`. The Vite SPA continues to own the app surface. The two share a design-token export (Tailwind config) so visual consistency holds.

Phase 1: build the Astro pipeline alongside the existing 10 pages. Phase 2: migrate. Phase 3+: 35K-page horizon runs on it.

Owner of the migration: Iris (Engineering).

---

## 5. Editorial content brief template

```yaml
# Editorial Brief — <slug>
date_drafted: 2026-06-05
target_publish: 2026-06-12
target_persona: land_flipper | note_investor | hybrid | fix_and_flip | residential_wholesaler | tax_lien_deed | subdivider | creative_finance
axis_jtbd: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
axis_funnel: tofu | mofu | bofu

primary_keyword: <one phrase>
secondary_keywords: [<2-5 phrases>]
search_intent: informational | commercial | transactional
working_headline: <H1 candidate>
working_subhead: <H2 candidate>

thesis: <one sentence; the claim the post defends>
proof_required:
  - <fact 1 + source>
  - <fact 2 + source>
  - <fact 3 + source>

outline:
  - section: <h2>
    points: [<bullet>, <bullet>]
  - section: <h2>
    points: [<bullet>, <bullet>]
  ...

internal_links:
  - <slug or URL>: <anchor text>
external_links:
  - <url>: <reason>

cta: "Run AcreOS on your county — free for 14 days"
cta_band_placement: end_of_article

voice_checklist:
  system_is_subject: required
  five_verbs_used: at_least_3_of_5
  no_founder_voice: required
  no_competitor_names: required
  no_dark_patterns: required
  numbers_have_sources: required
  land_investors_term_used: required

reviewer: soren
voice_linter_pass: pending
publish_to:
  - /learn (cross-link)
  - newsletter (if applicable)
  - linkedin (org page)
  - x (org account)
```

Every editorial piece is briefed before it is written. Briefs are stored in `content/briefs/<yyyy-mm-dd>-<slug>.yml` (Phase 1 addition; not built this round).

---

## 6. What this spec does NOT do

- Does not pick a CMS. Authoring stays in versioned files (JSON for programmatic, YAML+MD for editorial). If a non-engineer ever needs to author, revisit at Phase 3.
- Does not generate pages. The template and schema are the spec; the generation pipeline ships under a future Iris work item.
- Does not commit Astro. The decoupling decision is recorded; the migration is a separate work item.
