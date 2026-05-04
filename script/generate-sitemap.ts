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

const SITEMAP_PATH = path.resolve("client/public/sitemap.xml");
const ROBOTS_PATH = path.resolve("client/public/robots.txt");

function buildSitemap(): string {
  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = PUBLIC_ROUTES.map((r) =>
    [
      "  <url>",
      `    <loc>${SITE_BASE_URL}${r.path}</loc>`,
      `    <lastmod>${lastmod}</lastmod>`,
      `    <changefreq>${r.changefreq}</changefreq>`,
      `    <priority>${r.priority.toFixed(1)}</priority>`,
      "  </url>",
    ].join("\n"),
  ).join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ].join("\n");
}

function buildRobots(): string {
  const allows = PUBLIC_ROUTES.map((r) => `Allow: ${r.path}`).join("\n");
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
  const sitemap = buildSitemap();
  const robots = buildRobots();
  await writeFile(SITEMAP_PATH, sitemap, "utf-8");
  await writeFile(ROBOTS_PATH, robots, "utf-8");
  // Sanity: re-read so we don't silently write empty files
  const back = await readFile(SITEMAP_PATH, "utf-8");
  if (!back.includes("<urlset")) {
    throw new Error("[sitemap] generated file missing <urlset> — aborting");
  }
  console.log(
    `[sitemap] wrote ${PUBLIC_ROUTES.length} URLs to ${SITEMAP_PATH}`,
  );
  console.log(`[robots]  refreshed ${ROBOTS_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
