/**
 * Types for `virtual:acreos-learn-content` — the /learn metadata index
 * generated at build time by learnContentPlugin in vite.config.ts from
 * scripts/learn-content-index.mjs. Only metadata lives in the bundle;
 * each entry's `url` points at the article body served as static JSON
 * (see client/src/pages/learn/registry.ts). If the plugin's emitted
 * shape changes, this declaration and the plugin must change together —
 * tests/unit/learnContentServedAsData.test.ts pins both.
 */
declare module "virtual:acreos-learn-content" {
  import type { LearnVertical, StateSlug } from "../pages/learn/types";

  export interface LearnArticleIndexEntry {
    /** Path-derived lookup key: "<vertical>::<state file slug>". */
    pathKey: string;
    vertical: LearnVertical;
    stateSlug: StateSlug;
    stateName: string;
    headline: string;
    /** Static-JSON URL of the full LearnContent body. */
    url: string;
  }

  export interface LearnCountyIndexEntry {
    /** Path-derived lookup key: "<state dir>::<county file slug>". */
    pathKey: string;
    stateSlug: StateSlug;
    stateName: string;
    countySlug: string;
    countyName: string;
    /** Static-JSON URL of the full CountyLearnContent body. */
    url: string;
  }

  export const LEARN_ARTICLES: LearnArticleIndexEntry[];
  export const LEARN_COUNTIES: LearnCountyIndexEntry[];
}
