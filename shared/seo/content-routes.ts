/**
 * Content-registry → sitemap route enumeration.
 *
 * The /learn and /learn/county pages are programmatic SEO content: each one is
 * a JSON file under `content/learn/`. They are NOT listed in PUBLIC_ROUTES —
 * they are content, not hand-maintained marketing routes — so the sitemap
 * generator must enumerate them from the content tree directly, or the next
 * build silently drops our deepest, most rankable pages from the sitemap.
 *
 * Why filesystem and not the client registries
 * ────────────────────────────────────────────
 * `client/src/pages/learn/registry.ts` + `county-registry.ts` build their maps
 * with Vite's `import.meta.glob`, which only resolves inside a Vite bundle.
 * `script/generate-sitemap.ts` runs under plain Node (`tsx`), where that glob
 * is unavailable — so we read the same `content/learn/*` files off disk here.
 * This is the same source of truth the Vite globs consume, just reached the
 * Node way, so the two can never disagree about which pages exist.
 *
 * `lastmod` is derived per-URL from the content's freshness signal (the data
 * snapshot's `asOf` / the county generator's `generatedAt` / git mtime) rather
 * than a blanket today-stamp — Google discounts sitemaps where everything
 * changed on the same day.
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Project root — shared/seo/ is two levels below the repo root. */
const REPO_ROOT = path.resolve(HERE, "..", "..");
const CONTENT_LEARN_DIR = path.join(REPO_ROOT, "content", "learn");

export interface ContentRoute {
  /** Path including leading slash. */
  path: string;
  changefreq: "monthly";
  priority: number;
  label: string;
  /** ISO date (YYYY-MM-DD) — per-URL last-modified for the sitemap. */
  lastmod: string;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD if the string is a parseable date, else null. */
function normalizeDay(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return isoDay(parsed);
}

/** Latest commit date for a file, or null if git is unavailable / untracked. */
function gitLastModified(absFile: string): string | null {
  try {
    const out = execFileSync(
      "git",
      ["log", "-1", "--format=%cs", "--", absFile],
      { cwd: REPO_ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Best available freshness signal for a content file, most-trusted first:
 *   1. top-level `asOf`
 *   2. newest `dataSnapshot.figures[].asOf`
 *   3. `generatedAt` (county pages)
 *   4. git last-commit date
 *   5. filesystem mtime (always available — never a blanket today-stamp)
 */
function deriveLastmod(absFile: string, json: any): string {
  const top = normalizeDay(json?.asOf);
  if (top) return top;

  const figures: unknown[] = json?.dataSnapshot?.figures ?? [];
  let newestFigure: string | null = null;
  for (const f of figures) {
    const day = normalizeDay((f as { asOf?: unknown })?.asOf);
    if (day && (!newestFigure || day > newestFigure)) newestFigure = day;
  }
  if (newestFigure) return newestFigure;

  const generated = normalizeDay(json?.generatedAt);
  if (generated) return generated;

  const git = gitLastModified(absFile);
  if (git) return git;

  return isoDay(statSync(absFile).mtime);
}

function readJson(absFile: string): any {
  return JSON.parse(readFileSync(absFile, "utf-8"));
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Enumerate `/learn/<vertical>/<state>` routes from the per-vertical content
 * directories, skipping the `county/` subtree (handled separately). Mirrors
 * `listLearnRoutes()` in the client registry.
 */
export function listLearnContentRoutes(): ContentRoute[] {
  const routes: ContentRoute[] = [];
  for (const vertical of safeReaddir(CONTENT_LEARN_DIR)) {
    if (vertical === "county") continue;
    const verticalDir = path.join(CONTENT_LEARN_DIR, vertical);
    if (!statSync(verticalDir).isDirectory()) continue;
    for (const file of safeReaddir(verticalDir)) {
      if (!file.endsWith(".json")) continue;
      const absFile = path.join(verticalDir, file);
      const json = readJson(absFile);
      const state = file.replace(/\.json$/, "");
      routes.push({
        path: `/learn/${vertical}/${state}`,
        changefreq: "monthly",
        priority: 0.75,
        label: json?.headline ?? `${vertical} · ${state}`,
        lastmod: deriveLastmod(absFile, json),
      });
    }
  }
  routes.sort((a, b) => a.path.localeCompare(b.path));
  return routes;
}

/**
 * Enumerate `/learn/county/<state>/<county>` routes from the per-state county
 * content directories. Mirrors `listCountyRoutes()`.
 */
export function listCountyContentRoutes(): ContentRoute[] {
  const countyRoot = path.join(CONTENT_LEARN_DIR, "county");
  const routes: ContentRoute[] = [];
  for (const state of safeReaddir(countyRoot)) {
    const stateDir = path.join(countyRoot, state);
    let isDir = false;
    try {
      isDir = statSync(stateDir).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) continue;
    for (const file of safeReaddir(stateDir)) {
      if (!file.endsWith(".json")) continue;
      const absFile = path.join(stateDir, file);
      const json = readJson(absFile);
      const county = file.replace(/\.json$/, "");
      routes.push({
        path: `/learn/county/${state}/${county}`,
        changefreq: "monthly",
        // County pages are data-first proof of the moat — rank them alongside
        // the state primers.
        priority: 0.7,
        label: json?.headline ?? `${county}, ${state}`,
        lastmod: deriveLastmod(absFile, json),
      });
    }
  }
  routes.sort((a, b) => a.path.localeCompare(b.path));
  return routes;
}

/** All content-registry routes (learn + county), used by the sitemap. */
export function listAllContentRoutes(): ContentRoute[] {
  return [...listLearnContentRoutes(), ...listCountyContentRoutes()];
}
