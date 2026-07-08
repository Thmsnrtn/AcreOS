/**
 * Autonomous Self-Acquisition — A2b: the ignition kit (founder one-time seed).
 *
 * The machine can't post links to identity-gated platforms as itself (that IS
 * the spam pattern) — but it CAN prepare everything so the founder's one-time
 * act is review-and-click, ~minutes. This assembles the launch-post draft + the
 * tool-directory submission list for the FREE parcel-check tool (not the SaaS).
 *
 * Deterministic by design: the launch post is a real template filled with TRUE
 * product facts (no LLM, so no fabricated claim can slip into the founder's
 * public launch). The founder edits to taste and posts in his own voice.
 */

export interface IgnitionDraftInput {
  /** Public base URL, e.g. https://acreos.com (no trailing slash). */
  baseUrl: string;
  /** A representative buy-box county for the concrete example, if seeded. */
  exampleCounty?: { countyLabel: string; state: string } | null;
}

export interface DirectorySubmission {
  name: string;
  url: string;
  note: string;
}

export interface IgnitionDrafts {
  launchPost: { title: string; body: string; venues: string[] };
  directories: DirectorySubmission[];
  reminder: string;
}

/** Curated venues for a genuinely-useful free land tool. Static, founder-editable. */
const DIRECTORIES: DirectorySubmission[] = [
  { name: "Product Hunt", url: "https://www.producthunt.com/posts/new", note: "Launch the FREE parcel-check tool; lead with the free government-data utility, not the SaaS." },
  { name: "Hacker News (Show HN)", url: "https://news.ycombinator.com/submit", note: "Title: 'Show HN: Free parcel report from FEMA/USDA/USGS data for any US address'. Be present in comments." },
  { name: "AlternativeTo", url: "https://alternativeto.net/manage/new-app/", note: "List as a free land/parcel due-diligence tool." },
  { name: "There's An AI For That / tool aggregators", url: "https://theresanaiforthat.com/submit/", note: "If positioned as the AI parcel analysis angle." },
  { name: "Reddit r/landinvesting (text post, not a link drop)", url: "https://www.reddit.com/r/landinvesting/submit", note: "Share the free tool as a genuinely-useful resource; answer a real question with a live report. Read the subreddit rules first." },
  { name: "Indie Hackers", url: "https://www.indiehackers.com/new-post", note: "A 'built a free tool' post; the land-investor niche is underserved." },
  { name: "BetaList", url: "https://betalist.com/submit", note: "Early-stage launch directory." },
];

/** Build the ignition drafts. Pure — TRUE facts only, founder-editable. */
export function buildIgnitionDrafts(input: IgnitionDraftInput): IgnitionDrafts {
  const base = input.baseUrl.replace(/\/+$/, "");
  const toolUrl = `${base}/tools/parcel-check`;
  const ex = input.exampleCounty ? `${input.exampleCounty.countyLabel} County, ${input.exampleCounty.state}` : "any US county";

  const title = "Show HN: Free parcel report from government data for any US address";
  const body = [
    `I built a free tool that pulls real government data on any US parcel — FEMA flood zone, USDA soil, USGS elevation, wetlands, and census context — into one plain-English report. No signup to run it.`,
    ``,
    `Land investors (and anyone buying rural land) usually have to check 5+ separate government sites to answer "is this lot buildable / in a flood zone / wet?". This does it in one search. Try it on a parcel in ${ex}: ${toolUrl}`,
    ``,
    `It's free and stays free — it's the front door to a paid platform (AcreOS) that does the full workflow, but the parcel report itself needs no account. Every report is real government data with the source cited; it leaves a field blank rather than guess.`,
    ``,
    `Feedback welcome, especially from people who actually do land due diligence — what's missing?`,
  ].join("\n");

  return {
    launchPost: { title, body, venues: ["Hacker News (Show HN)", "Product Hunt", "Indie Hackers"] },
    directories: DIRECTORIES.map((d) => ({ ...d })),
    reminder:
      "Post in YOUR voice — edit freely. These platforms gate on real human identity; an automated post is the spam pattern and burns the domain. This is your one-time match; the engine compounds it from here.",
  };
}
