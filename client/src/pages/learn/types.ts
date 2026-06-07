/**
 * Type definitions for /learn/<vertical>/<state> programmatic SEO pages.
 *
 * Content lives at content/learn/<vertical>/<state>.json. Each JSON file
 * conforms to LearnContent so the page component renders the same shape
 * regardless of which state×vertical combination is loaded.
 *
 * Soren owns the shape. New required fields here mean every JSON file
 * needs an update — a deliberate forcing function so we don't accrete
 * optional template-fluff sections that water down quality.
 */

export type LearnVertical = "land-flipping" | "note-investing";

/** US state slug used in the URL. Lowercase, hyphenated. */
export type StateSlug =
  | "texas"
  | "florida"
  | "arizona"
  | "new-mexico"
  | "arkansas"
  | "california"
  | "georgia"
  | "ohio";

export interface LearnFaqItem {
  q: string;
  a: string;
}

export interface LearnSource {
  /** Display name in the "Sources" footer. */
  name: string;
  /** Public URL or canonical citation (e.g., "Tex. Prop. Code §5.077"). */
  citation: string;
  /** Optional URL — link out when available. */
  url?: string;
}

export interface LearnExample {
  /** Short factual headline (no fabricated dollar figures or testimonials). */
  headline: string;
  /** 2-3 sentences explaining the trend or rule application. */
  body: string;
}

/**
 * One quantitative figure rendered in the "What the free data shows" band.
 *
 * Every figure is a public data claim, so the truth/voice gate applies: the
 * figure MUST carry a named `source` and an `asOf` date rendered inline next
 * to it. No bare numbers. `value` is the display string (already formatted,
 * e.g. "12% of parcels" or "Class III–IV"), `label` names what it measures.
 */
export interface LearnDataFigure {
  /** What the figure measures, e.g. "FEMA flood-zone prevalence". */
  label: string;
  /** Display-formatted value, e.g. "≈ 8% of parcels in SFHA". */
  value: string;
  /** One-line plain-English read of what the figure means for an operator. */
  note?: string;
  /** Named data source, e.g. "FEMA National Flood Hazard Layer". */
  source: string;
  /** ISO date (YYYY-MM-DD) the underlying data was pulled / published. */
  asOf: string;
  /** Optional deep link to the source dataset. */
  sourceUrl?: string;
}

/**
 * Optional "What the free data shows in [State]" band. Rendered between the
 * mechanics section and the statutes section in state-vertical.tsx. Backfilled
 * from verified open-data rollups (FEMA NFHL flood, USDA SSURGO soils, USGS
 * 3DEP elevation). Optional so a state page without a verified rollup simply
 * omits the band rather than rendering an empty/placeholder section — the
 * no-silent-thin-content discipline applies to the band too.
 */
export interface LearnDataSnapshot {
  /** Scope of the rollup, e.g. "Aggregated across 15 Arizona counties". */
  scope: string;
  /** The figures rendered as the band's cards. 2-5 entries. */
  figures: LearnDataFigure[];
  /** Coverage/freshness disclaimer rendered under the band. */
  disclaimer: string;
}

export interface LearnContent {
  vertical: LearnVertical;
  stateSlug: StateSlug;
  stateName: string;
  /** Short, capability-led H1. No clickbait, no superlatives. */
  headline: string;
  /** 140-160 char meta description for SERP. */
  metaDescription: string;
  /** Lead paragraph — mechanics, not pitch. */
  intro: string;
  /** Mechanics-first walkthrough of how the vertical operates in this state. */
  mechanics: string;
  /**
   * Statute + rule citations — what state law actually requires. Each
   * entry is one paragraph naming the statute by code section and
   * explaining what the operator is on the hook for.
   */
  statutes: LearnExample[];
  /** State-specific gotchas (redemption clocks, recording fees, licensing). */
  gotchas: LearnExample[];
  /** AcreOS capability paragraph specific to this state×vertical. */
  valueProp: string;
  /** 5-7 FAQ items. State-specific, not generic. */
  faq: LearnFaqItem[];
  /** Named sources for every factual claim above. */
  sources: LearnSource[];
  /**
   * Optional "What the free data shows in [State]" band — verified open-data
   * rollups (flood prevalence, dominant soil classes, elevation bands). When
   * absent, the band is not rendered (no placeholder). See LearnDataSnapshot.
   */
  dataSnapshot?: LearnDataSnapshot;
}

// ---------------------------------------------------------------------------
// County-level programmatic pages — /learn/county/<state>/<county>
// ---------------------------------------------------------------------------

/**
 * A single county page. Content lives at
 * content/learn/county/<state>/<county>.json and is produced by the
 * county-rollup generator (scripts/generate-county-pages.mjs), which only
 * emits a file when the data rollup clears the completeness quality bar.
 *
 * Unlike the state×vertical pages (hand-authored legal primers), county pages
 * are DATA-FIRST: their reason to exist is the verified free-data rollup. The
 * generator refuses to emit a thin page, so every published county page
 * carries a real LearnDataSnapshot with multiple sourced figures.
 */
export interface CountyLearnContent {
  /** State slug, e.g. "arizona". */
  stateSlug: StateSlug;
  /** Full state name, e.g. "Arizona". */
  stateName: string;
  /** County slug used in the URL, e.g. "cochise". Lowercase, hyphenated. */
  countySlug: string;
  /** Full county name without "County", e.g. "Cochise". */
  countyName: string;
  /** Capability-led H1. */
  headline: string;
  /** 140-160 char meta description for SERP. */
  metaDescription: string;
  /** Lead paragraph — what the free data shows for this county, mechanics-first. */
  intro: string;
  /** County centroid the rollup was sampled at — recorded for provenance. */
  centroid: { latitude: number; longitude: number };
  /** The verified open-data rollup. Required — a county page is the rollup. */
  dataSnapshot: LearnDataSnapshot;
  /** 3-5 county-specific FAQ items grounded in the rollup + state law. */
  faq: LearnFaqItem[];
  /** Named sources for every figure + claim. */
  sources: LearnSource[];
  /** ISO timestamp the generator produced this rollup. */
  generatedAt: string;
}
