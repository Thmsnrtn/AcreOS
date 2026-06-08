/**
 * Regenerate `client/public/sitemap.xml` and `client/public/robots.txt`
 * from the canonical PUBLIC_ROUTES list.
 *
 * Run as part of the build pipeline before `vite build` so the generated
 * artefacts are copied into `dist/public/` automatically.
 *
 * Usage:
 *   tsx script/generate-sitemap.ts
 *
 * Both files are checked into source control as well, so editors can see
 * the current shape without having to run the build.
 */

import { writeFile, readFile } from "fs/promises";
import path from "path";
import {
  PUBLIC_ROUTES,
  SITE_BASE_URL,
} from "../shared/seo/public-routes.js";
import {
  listLearnContentRoutes,
  listCountyContentRoutes,
} from "../shared/seo/content-routes.js";

const SITEMAP_PATH = path.resolve("client/public/sitemap.xml");
const ROBOTS_PATH = path.resolve("client/public/robots.txt");

interface SitemapEntry {
  path: string;
  changefreq: string;
  priority: number;
  /** Per-URL last-modified date (YYYY-MM-DD). */
  lastmod: string;
}

/**
 * The full URL set the sitemap should contain: the hand-maintained marketing
 * routes PLUS every programmatic /learn + county content page enumerated from
 * the content registries. Without the content routes, the next build would
 * silently strip our highest-value SEO pages from the sitemap.
 *
 * Static marketing routes carry a single shared today-stamp (they don't have a
 * per-file freshness signal); content routes carry per-URL `lastmod` derived
 * from each file's `asOf` / git mtime so Google can trust what actually changed.
 */
export function collectSitemapEntries(): SitemapEntry[] {
  const today = new Date().toISOString().slice(0, 10);
  const staticRoutes: SitemapEntry[] = PUBLIC_ROUTES.map((r) => ({
    path: r.path,
    changefreq: r.changefreq,
    priority: r.priority,
    lastmod: today,
  }));
  const contentRoutes: SitemapEntry[] = [
    ...listLearnContentRoutes(),
    ...listCountyContentRoutes(),
  ];
  return [...staticRoutes, ...contentRoutes];
}

function buildSitemap(entries: SitemapEntry[]): string {
  const urls = entries
    .map((r) =>
      [
        "  <url>",
        `    <loc>${SITE_BASE_URL}${r.path}</loc>`,
        `    <lastmod>${r.lastmod}</lastmod>`,
        `    <changefreq>${r.changefreq}</changefreq>`,
        `    <priority>${r.priority.toFixed(1)}</priority>`,
        "  </url>",
      ].join("\n"),
    )
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ].join("\n");
}

function buildRobots(): string {
  const allows = [
    ...PUBLIC_ROUTES.map((r) => `Allow: ${r.path}`),
    // Programmatic SEO content trees — let crawlers reach every /learn page.
    "Allow: /learn/",
  ].join("\n");
  return [
    "User-agent: *",
    "# Block authenticated / private routes",
    "Disallow: /api/",
    "Disallow: /admin/",
    "Disallow: /settings/",
    "Disallow: /founder/",
    "Disallow: /founder-dashboard",
    "Disallow: /founder-home",
    "Disallow: /portal/",
    "Disallow: /today",
    "Disallow: /pax",
    "Disallow: /ai",
    "Disallow: /leads",
    "Disallow: /properties",
    "Disallow: /deals",
    "Disallow: /analytics",
    "",
    "# Allow public pages",
    allows,
    "",
    "# Sitemap",
    `Sitemap: ${SITE_BASE_URL}/sitemap.xml`,
    "",
  ].join("\n");
}

async function main() {
  const entries = collectSitemapEntries();
  const sitemap = buildSitemap(entries);
  const robots = buildRobots();
  await writeFile(SITEMAP_PATH, sitemap, "utf-8");
  await writeFile(ROBOTS_PATH, robots, "utf-8");
  // Sanity: re-read so we don't silently write empty files
  const back = await readFile(SITEMAP_PATH, "utf-8");
  if (!back.includes("<urlset")) {
    throw new Error("[sitemap] generated file missing <urlset> — aborting");
  }
  const learnCount = entries.filter((e) =>
    e.path.startsWith("/learn/") && !e.path.startsWith("/learn/county/"),
  ).length;
  const countyCount = entries.filter((e) =>
    e.path.startsWith("/learn/county/"),
  ).length;
  // Guard against the original footgun: if the content registries enumerated
  // nothing, fail loudly rather than shipping a sitemap missing our best pages.
  if (learnCount === 0) {
    throw new Error(
      "[sitemap] zero /learn URLs — content registry enumeration failed; aborting",
    );
  }
  console.log(
    `[sitemap] wrote ${entries.length} URLs (${learnCount} /learn, ` +
      `${countyCount} county) to ${SITEMAP_PATH}`,
  );
  console.log(`[robots]  refreshed ${ROBOTS_PATH}`);
}

// Only regenerate files when run as a script (tsx script/generate-sitemap.ts).
// When imported by the unit test, we expose `collectSitemapEntries()` without
// the side effect of overwriting the committed artefacts.
const invokedDirectly =
  typeof process.argv[1] === "string" &&
  /generate-sitemap\.(ts|js|mjs)$/.test(process.argv[1]);

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
