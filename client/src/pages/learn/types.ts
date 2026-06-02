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
}
