/**
 * Sitemap coverage against the ONE canonical generator.
 *
 * History: two generators wrote client/public/sitemap.xml — the canonical
 * scripts/generate-sitemap.mjs (whose --check gates `npm run build`) and a
 * second script/generate-sitemap.ts with a DIFFERENT URL policy. Slice 3 of
 * the waves-G/O/F program regenerated with the wrong one, which broke the
 * build's freshness check; the .ts twin is now DELETED (2026-08-10) and this
 * suite was rewritten (not deleted) against the committed artifact + the
 * canonical generator, preserving its original invariant: the sitemap stays
 * in lockstep with the content registries so a regression that drops the
 * statute-grade /learn pages, county pages, tools, or the G1 marketing
 * surface fails CI instead of failing Google.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  listLearnContentRoutes,
  listCountyContentRoutes,
} from "../../shared/seo/content-routes.js";
import {
  PUBLIC_ROUTES,
  FOR_VERTICAL_SLUGS,
} from "../../shared/seo/public-routes.js";

const ROOT = path.resolve(__dirname, "../..");
const SITEMAP = fs.readFileSync(
  path.join(ROOT, "client/public/sitemap.xml"),
  "utf-8",
);
const paths = [...SITEMAP.matchAll(/<loc>https:\/\/acreos\.io([^<]*)<\/loc>/g)].map(
  (m) => m[1] || "/",
);

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

describe("canonical sitemap freshness + single-generator discipline", () => {
  it("the committed sitemap is CURRENT per the canonical generator's own --check", () => {
    // Same gate the build runs; a stale committed sitemap fails here first.
    const out = execFileSync("node", ["scripts/generate-sitemap.mjs", "--check"], {
      cwd: ROOT,
      encoding: "utf-8",
    });
    expect(out).toContain("OK: sitemap.xml is current");
  });

  it("the second generator stays deleted — one artifact, one writer", () => {
    expect(fs.existsSync(path.join(ROOT, "script/generate-sitemap.ts"))).toBe(false);
  });
});

describe("sitemap content-route coverage (original invariant, canonical artifact)", () => {
  const learnPaths = paths.filter(
    (p) => p.startsWith("/learn/") && !p.startsWith("/learn/county/"),
  );
  const countyPaths = paths.filter((p) => p.startsWith("/learn/county/"));

  it("emits one sitemap URL per /learn content file (no silent drops)", () => {
    const registry = listLearnContentRoutes();
    expect(registry.length).toBeGreaterThan(0);
    expect(learnPaths.length).toBe(registry.length);
  });

  it("emits one sitemap URL per county content file", () => {
    const registry = listCountyContentRoutes();
    expect(registry.length).toBeGreaterThan(0);
    expect(countyPaths.length).toBe(registry.length);
  });

  it("includes the known statute-grade /learn pages", () => {
    for (const p of [
      "/learn/land-flipping/texas",
      "/learn/land-flipping/florida",
      "/learn/land-flipping/arizona",
      "/learn/note-investing/texas",
    ]) {
      expect(paths).toContain(p);
    }
  });

  it("includes the county pages (cochise / navajo / brewster)", () => {
    for (const p of [
      "/learn/county/arizona/cochise",
      "/learn/county/arizona/navajo",
      "/learn/county/texas/brewster",
    ]) {
      expect(paths).toContain(p);
    }
  });

  it("includes the free public tools", () => {
    expect(paths).toContain("/tools/parcel-check");
    expect(paths).toContain("/tools/calculator");
    const publicPaths = PUBLIC_ROUTES.map((r) => r.path);
    expect(publicPaths).toContain("/tools/parcel-check");
    expect(publicPaths).toContain("/tools/calculator");
  });

  it("includes every /for/<vertical> page, derived from the slug registry (G1.3)", () => {
    const slugs = Object.values(FOR_VERTICAL_SLUGS);
    expect(slugs.length).toBe(15);
    for (const slug of slugs) {
      expect(paths, `/for/${slug} must be sitemapped`).toContain(`/for/${slug}`);
    }
  });

  it("includes /demo, /transparency and /field-notes; excludes noindex'd /compare pages", () => {
    expect(paths).toContain("/demo");
    expect(paths).toContain("/transparency");
    expect(paths).toContain("/field-notes");
    // A sitemapped-noindex page is a Search Console error; the canonical
    // generator excludes /compare/* until their noindex comes off.
    expect(paths.some((p) => p.startsWith("/compare/"))).toBe(false);
  });

  it("derives per-URL lastmod (not a single blanket today-stamp)", () => {
    const lastmods = [...SITEMAP.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)].map(
      (m) => m[1],
    );
    expect(lastmods.length).toBe(paths.length);
    for (const d of lastmods) expect(d).toMatch(ISO_DAY);
    expect(new Set(lastmods).size).toBeGreaterThan(1);
  });

  it("contains no duplicate URLs", () => {
    expect(new Set(paths).size).toBe(paths.length);
  });
});
