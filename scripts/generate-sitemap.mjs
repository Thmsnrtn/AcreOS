#!/usr/bin/env node
// ============================================================================
// scripts/generate-sitemap.mjs
// ----------------------------------------------------------------------------
// Deterministic generator for client/public/sitemap.xml.
//
// WHY THIS EXISTS
//   sitemap.xml used to be hand-edited, which let it drift: it still listed
//   /glossary after the route was archived on 2026-06-01 (the route was later
//   RESTORED on 2026-06-10, T0-8, precisely because the sitemap promised it).
//   A sitemap that points crawlers at dead URLs is an SEO liability. This
//   generator derives the URL list from the actual route source-of-truth so
//   the committed file can never silently rot, and the --check flag (wired
//   into CI) fails the build if it does.
//
// ROUTE SOURCE-OF-TRUTH
//   1. STATIC marketing/public pages: STATIC_ROUTES below. Each entry is a
//      transcription of a REAL public <Route> in client/src/App.tsx's
//      unauthenticated <Switch> (the `App.tsx route:` comment names it). We do
//      NOT invent URLs — auth-gated, redirect, and signed-token routes
//      (/sign/:docId, /portal/:accessToken, /deal-rooms/share/:slug, /letters →
//      /field-notes 301s) are deliberately excluded because they're not
//      crawlable destinations.
//   2. DYNAMIC programmatic-SEO pages: globbed from the same content files the
//      app's registries consume at build time —
//        - content/learn/<vertical>/<state>.json  (client/src/pages/learn/registry.ts)
//        - content/learn/county/<state>/<county>.json (client/src/pages/learn/county-registry.ts)
//      Adding a state×vertical or county primer is a content-only change; this
//      generator picks it up automatically, exactly like the runtime glob.
//
// LASTMOD (deterministic, no wall-clock for dynamic pages)
//   - Static routes: the explicit `lastmod` on each STATIC_ROUTES entry.
//   - County pages: the page's own `generatedAt` (set by
//     generate-county-pages.mjs), falling back to the newest embedded `asOf`.
//   - Learn pages: the newest `asOf` date embedded in the file's dataSnapshot;
//     if a file carries no dated figure (older note-investing pages predate the
//     dataSnapshot convention) we fall back to LEARN_FALLBACK_LASTMOD so the
//     output is still byte-stable across machines and runs.
//   None of the per-page lastmods read the system clock, so two runs on two
//   machines produce identical bytes — which is what makes --check meaningful.
//
// USAGE
//   node scripts/generate-sitemap.mjs           # write client/public/sitemap.xml
//   node scripts/generate-sitemap.mjs --check    # verify committed file is fresh
//
// Exit codes: 0 on success / fresh. 1 if --check finds the committed sitemap
// stale (prints a unified diff-ish summary and the exact fix command).
// ============================================================================

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const CONTENT_LEARN = join(REPO_ROOT, "content", "learn");
const SITEMAP_PATH = join(REPO_ROOT, "client", "public", "sitemap.xml");

const ORIGIN = "https://acreos.io";

// Older /learn/note-investing/* pages predate the dated-dataSnapshot
// convention and carry no `asOf`. Pin their lastmod to a stable constant so the
// output never depends on the clock or on git mtimes. Matches the date the
// hand-maintained sitemap had used for those pages.
const LEARN_FALLBACK_LASTMOD = "2026-06-02";

// ── 1. Static public routes ─────────────────────────────────────────────────
// Each path here MUST correspond to a real public <Route> in client/src/App.tsx.
// Ordered by descending priority for a stable, readable sitemap.
const STATIC_ROUTES = [
  // "/" + "/pricing" lastmod bumped 2026-06-10 (Tier 2C): footer Free
  // tools/Learn columns + tier-context pricing CTAs changed both pages.
  { path: "/",                        lastmod: "2026-06-10", changefreq: "weekly",  priority: "1.0", appRoute: 'App.tsx: <Route path="/" component={HomeRoute} />' },
  { path: "/pricing",                 lastmod: "2026-06-10", changefreq: "monthly", priority: "0.9", appRoute: 'App.tsx: <Route path="/pricing" component={PricingPage} />' },
  { path: "/why",                     lastmod: "2026-06-08", changefreq: "monthly", priority: "0.8", appRoute: 'App.tsx: <Route path="/why" component={WhyPage} />' },
  { path: "/tools/parcel-check",      lastmod: "2026-06-08", changefreq: "monthly", priority: "0.8", appRoute: 'App.tsx: <Route path="/tools/parcel-check" component={ParcelCheckPage} />' },
  { path: "/tools/calculator",        lastmod: "2026-06-08", changefreq: "monthly", priority: "0.8", appRoute: 'App.tsx: <Route path="/tools/calculator" component={CalculatorPage} />' },
  { path: "/security",                lastmod: "2026-06-08", changefreq: "monthly", priority: "0.7", appRoute: 'App.tsx: <Route path="/security" component={SecurityPage} />' },
  // Tier 2C (2026-06-10): the two /compare/* pages are intentionally
  // noindex'd (their positioning slots are data-todo until the founder
  // fills them) — listing a noindex page in the sitemap is contradictory
  // and Search Console flags it as "Submitted URL marked noindex". They
  // were REMOVED here rather than de-noindexed; re-add them when the
  // noindex comes off the pages.
  { path: "/land-credit-score",       lastmod: "2026-06-08", changefreq: "monthly", priority: "0.7", appRoute: 'App.tsx: <Route path="/land-credit-score" component={LandCreditScorePage} />' },
  { path: "/glossary",                lastmod: "2026-06-10", changefreq: "monthly", priority: "0.6", appRoute: 'App.tsx: <Route path="/glossary" component={GlossaryPage} /> (restored 2026-06-10, T0-8)' },
  // The learn HUB page — the dynamic /learn/<vertical>/<state> +
  // /learn/county/* content pages were globbed below all along, but the hub
  // that indexes them was missing from the static list (spotted 2026-07-17
  // when the retired build-time generator, which did list it, was removed).
  { path: "/learn",                   lastmod: "2026-07-17", changefreq: "weekly",  priority: "0.6", appRoute: 'App.tsx: <Route path="/learn" component={LearnHubPage} />' },
  { path: "/changelog",               lastmod: "2026-06-08", changefreq: "weekly",  priority: "0.6", appRoute: 'App.tsx: <Route path="/changelog" component={ChangelogPage} />' },
  { path: "/auth",                    lastmod: "2026-06-08", changefreq: "monthly", priority: "0.5", appRoute: 'App.tsx: <Route path="/auth" component={AuthPage} />' },
  { path: "/status",                  lastmod: "2026-06-08", changefreq: "daily",   priority: "0.5", appRoute: 'App.tsx: <Route path="/status" component={StatusPage} />' },
  { path: "/legal/sub-processors",    lastmod: "2026-06-08", changefreq: "monthly", priority: "0.4", appRoute: 'App.tsx: <Route path="/legal/sub-processors" component={PublicSubProcessorsPage} />' },
  { path: "/terms",                   lastmod: "2026-06-08", changefreq: "yearly",  priority: "0.3", appRoute: 'App.tsx: <Route path="/terms" component={TermsOfService} />' },
  { path: "/privacy",                 lastmod: "2026-06-08", changefreq: "yearly",  priority: "0.3", appRoute: 'App.tsx: <Route path="/privacy" component={PrivacyPolicy} />' },
];

// ── 2. Date utilities ───────────────────────────────────────────────────────

/** Recursively collect every YYYY-MM-DD prefix found on any string value. */
function collectDates(node, acc) {
  if (node && typeof node === "object") {
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        acc.push(value.slice(0, 10));
      } else {
        collectDates(value, acc);
      }
    }
  }
  return acc;
}

/** Newest embedded date in a content object, or null if it carries none. */
function newestDate(obj) {
  const dates = collectDates(obj, []).filter((d) => !Number.isNaN(Date.parse(d)));
  if (dates.length === 0) return null;
  dates.sort();
  return dates[dates.length - 1];
}

// ── 3. Dynamic route discovery (file-glob, mirrors the runtime registries) ───

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function listJsonFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.filter((f) => f.endsWith(".json")).sort();
}

/** /learn/<vertical>/<state> pages. */
function learnRoutes() {
  const routes = [];
  const verticals = readdirSync(CONTENT_LEARN, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "county")
    .map((d) => d.name)
    .sort();

  for (const vertical of verticals) {
    const dir = join(CONTENT_LEARN, vertical);
    for (const file of listJsonFiles(dir)) {
      const state = file.replace(/\.json$/, "");
      const lastmod = newestDate(readJson(join(dir, file))) ?? LEARN_FALLBACK_LASTMOD;
      routes.push({
        path: `/learn/${vertical}/${state}`,
        lastmod,
        changefreq: "monthly",
        priority: "0.8",
      });
    }
  }
  // Stable order: vertical, then state.
  routes.sort((a, b) => a.path.localeCompare(b.path));
  return routes;
}

/** /learn/county/<state>/<county> pages. */
function countyRoutes() {
  const countyRoot = join(CONTENT_LEARN, "county");
  const routes = [];
  let states;
  try {
    states = readdirSync(countyRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }

  for (const state of states) {
    const dir = join(countyRoot, state);
    for (const file of listJsonFiles(dir)) {
      const county = file.replace(/\.json$/, "");
      const data = readJson(join(dir, file));
      // Prefer the page's own generatedAt; fall back to newest embedded date.
      const lastmod =
        (typeof data.generatedAt === "string" && data.generatedAt.slice(0, 10)) ||
        newestDate(data) ||
        LEARN_FALLBACK_LASTMOD;
      routes.push({
        path: `/learn/county/${state}/${county}`,
        lastmod,
        changefreq: "monthly",
        priority: "0.7",
      });
    }
  }
  routes.sort((a, b) => a.path.localeCompare(b.path));
  return routes;
}

// ── 4. XML rendering ─────────────────────────────────────────────────────────

function loc(path) {
  // Root keeps its trailing slash; every other path has none (matches the
  // canonical form the app serves and the prior hand-maintained sitemap).
  return path === "/" ? `${ORIGIN}/` : `${ORIGIN}${path}`;
}

function renderUrl({ path, lastmod, changefreq, priority }) {
  return [
    "  <url>",
    `    <loc>${loc(path)}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    "  </url>",
  ].join("\n");
}

function renderSitemap(routes) {
  const body = routes.map(renderUrl).join("\n");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    body +
    "\n</urlset>\n"
  );
}

function buildRoutes() {
  // Order: static (priority-sorted) → learn → county. This is the same order
  // the committed file used, and it is fully deterministic.
  return [...STATIC_ROUTES, ...learnRoutes(), ...countyRoutes()];
}

// ── 5. Main ───────────────────────────────────────────────────────────────────

function main() {
  const checkMode = process.argv.includes("--check");
  const routes = buildRoutes();
  const generated = renderSitemap(routes);

  if (checkMode) {
    let committed = "";
    try {
      committed = readFileSync(SITEMAP_PATH, "utf8");
    } catch {
      console.error("[generate-sitemap] FAIL: client/public/sitemap.xml is missing.");
      console.error("[generate-sitemap] Fix: node scripts/generate-sitemap.mjs");
      process.exit(1);
    }

    if (committed !== generated) {
      console.error("[generate-sitemap] FAIL: committed sitemap.xml is STALE.");
      const committedLocs = (committed.match(/<loc>[^<]+<\/loc>/g) || []).sort();
      const generatedLocs = (generated.match(/<loc>[^<]+<\/loc>/g) || []).sort();
      const committedSet = new Set(committedLocs);
      const generatedSet = new Set(generatedLocs);
      const missing = generatedLocs.filter((l) => !committedSet.has(l));
      const extra = committedLocs.filter((l) => !generatedSet.has(l));
      if (missing.length) {
        console.error("  Missing from committed file (routes exist, not in sitemap):");
        for (const l of missing) console.error(`    + ${l}`);
      }
      if (extra.length) {
        console.error("  Stale in committed file (in sitemap, route gone):");
        for (const l of extra) console.error(`    - ${l}`);
      }
      if (!missing.length && !extra.length) {
        console.error("  URL set matches but lastmod/changefreq/priority/formatting differ.");
      }
      console.error("  Fix: node scripts/generate-sitemap.mjs");
      process.exit(1);
    }

    console.log(`[generate-sitemap] OK: sitemap.xml is current (${routes.length} URLs).`);
    process.exit(0);
  }

  writeFileSync(SITEMAP_PATH, generated, "utf8");
  console.log(`[generate-sitemap] Wrote ${routes.length} URLs to client/public/sitemap.xml`);
}

main();
