/**
 * Types for scripts/learn-content-index.mjs, the /learn corpus
 * enumeration used by vite.config.ts (learnContentPlugin). The .mjs
 * module is plain Node ESM so scripts and the Vite config can both load
 * it without a transpile step; this declaration is its typed surface.
 * Keep the two in lockstep — check:app typechecks the config against
 * this file.
 */

export declare const LEARN_CONTENT_URL_PREFIX: string;

export interface LearnContentIndexArticle {
  /** Path-derived lookup key: "<vertical>::<state file slug>". */
  pathKey: string;
  vertical: string;
  stateSlug: string;
  stateName: string;
  headline: string;
  /** Static-JSON URL the body is served from. */
  url: string;
  /** Repo-root-relative path of the source file. */
  sourcePath: string;
}

export interface LearnContentIndexCounty {
  /** Path-derived lookup key: "<state dir>::<county file slug>". */
  pathKey: string;
  stateSlug: string;
  stateName: string;
  countySlug: string;
  countyName: string;
  /** Static-JSON URL the body is served from. */
  url: string;
  /** Repo-root-relative path of the source file. */
  sourcePath: string;
}

export interface LearnContentIndex {
  articles: LearnContentIndexArticle[];
  counties: LearnContentIndexCounty[];
}

export declare function buildLearnContentIndex(contentDir: string): LearnContentIndex;
