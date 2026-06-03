/**
 * SOREN — programmatic SEO targets for the /learn pages.
 *
 * One entry per /learn/<vertical>/<state> page that currently exists in
 * content/learn/. The target_keywords list is the seed Soren tracks rank
 * for in Google's SERP — each keyword maps to a row in soren_seo_rankings
 * once the daily cron runs.
 *
 * Keywords are conservative — 3-5 per page, chosen to be specific enough
 * that ranking in top-100 is plausible without being so generic that the
 * page would never rank. Soren expands or prunes via dispatch as the
 * 30-day trend reveals which keywords are tractable.
 *
 * The shape mirrors the content registry (client/src/pages/learn/registry.ts)
 * — adding a new (vertical × state) JSON file means adding the matching
 * LEARN_SEO_TARGETS entry in the same PR.
 */

export interface LearnSeoTarget {
  pagePath: string;          // e.g. /learn/land-flipping/texas
  vertical: "land-flipping" | "note-investing";
  state: string;             // human-readable, used in keyword interpolation
  targetKeywords: string[];
}

export const LEARN_SEO_TARGETS: ReadonlyArray<LearnSeoTarget> = [
  // ── land-flipping ──────────────────────────────────────────────────────
  {
    pagePath: "/learn/land-flipping/texas",
    vertical: "land-flipping",
    state: "Texas",
    targetKeywords: [
      "land flipping texas software",
      "tax delinquent land texas",
      "texas executory contract software",
      "texas 5.077 annual statement",
      "rural land flipping texas",
    ],
  },
  {
    pagePath: "/learn/land-flipping/florida",
    vertical: "land-flipping",
    state: "Florida",
    targetKeywords: [
      "land flipping florida software",
      "florida tax deed land",
      "florida vacant land investing",
      "florida tax certificate land flipping",
    ],
  },
  {
    pagePath: "/learn/land-flipping/arizona",
    vertical: "land-flipping",
    state: "Arizona",
    targetKeywords: [
      "land flipping arizona software",
      "arizona vacant land investing",
      "arizona tax lien land",
      "arizona patent land flipping",
    ],
  },
  {
    pagePath: "/learn/land-flipping/new-mexico",
    vertical: "land-flipping",
    state: "New Mexico",
    targetKeywords: [
      "land flipping new mexico software",
      "new mexico tax deed land",
      "new mexico vacant land investing",
      "new mexico rural land flipping",
    ],
  },
  {
    pagePath: "/learn/land-flipping/arkansas",
    vertical: "land-flipping",
    state: "Arkansas",
    targetKeywords: [
      "land flipping arkansas software",
      "arkansas tax delinquent land",
      "arkansas commissioner of state lands",
      "arkansas vacant land investing",
    ],
  },

  // ── note-investing ─────────────────────────────────────────────────────
  {
    pagePath: "/learn/note-investing/texas",
    vertical: "note-investing",
    state: "Texas",
    targetKeywords: [
      "note investing texas software",
      "texas land contract notes",
      "texas mortgage note investing",
      "texas seller-financed notes",
    ],
  },
  {
    pagePath: "/learn/note-investing/florida",
    vertical: "note-investing",
    state: "Florida",
    targetKeywords: [
      "note investing florida software",
      "florida mortgage note investing",
      "florida seller-financed notes",
      "florida real estate notes",
    ],
  },
  {
    pagePath: "/learn/note-investing/california",
    vertical: "note-investing",
    state: "California",
    targetKeywords: [
      "note investing california software",
      "california deed of trust investing",
      "california mortgage note investing",
      "california seller-financed notes",
    ],
  },
  {
    pagePath: "/learn/note-investing/georgia",
    vertical: "note-investing",
    state: "Georgia",
    targetKeywords: [
      "note investing georgia software",
      "georgia mortgage note investing",
      "georgia security deed notes",
      "georgia seller-financed notes",
    ],
  },
  {
    pagePath: "/learn/note-investing/ohio",
    vertical: "note-investing",
    state: "Ohio",
    targetKeywords: [
      "note investing ohio software",
      "ohio mortgage note investing",
      "ohio land contract notes",
      "ohio seller-financed notes",
    ],
  },
];

/** Total keyword × page count — used by the cron summary log. */
export const LEARN_SEO_TOTAL_KEYWORDS = LEARN_SEO_TARGETS.reduce(
  (sum, t) => sum + t.targetKeywords.length,
  0,
);
