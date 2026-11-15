// ============================================================================
// scripts/learn-content-index.mjs
// ----------------------------------------------------------------------------
// The single enumeration of the /learn article corpus for the CLIENT build.
//
// The article bodies under content/learn/ used to be bundled as JavaScript
// (import.meta.glob with eager:true in client/src/pages/learn/registry.ts):
// ~132 KB of prose JSON riding inside the summed client bundle, where the
// bundle gate (scripts/check-bundle-size.js) counts every emitted .js byte.
// The bodies are data, not code, so they now ship as static JSON files the
// article pages fetch on demand; only this metadata index (slugs, names,
// headline, body URL — a few hundred bytes per article) stays in the bundle,
// which keeps the /learn hub, the cross-links and the not-found decision
// synchronous and identical to the bundled era.
//
// Used by:
//   - vite.config.ts (learnContentPlugin) — builds the virtual index module,
//     copies each body verbatim beside the bundle at build end, and serves
//     the same URLs from disk under the dev server.
//   - scripts/learn-content-index.test.mjs — pins this enumeration against
//     the corpus on disk.
//
// The server has its own disk enumeration for the sitemap
// (shared/seo/content-routes.ts) and is deliberately NOT unified with this
// one: that one runs in the server process, this one at client build time.
//
// Field discipline: `pathKey` is derived from the file PATH (directory +
// filename) exactly as the old registries keyed their maps, while the
// display fields (vertical, stateSlug, stateName, headline, countySlug,
// countyName) are read from the file CONTENT exactly as the old
// listLearnRoutes()/listCountyRoutes() emitted them. If a file's content
// ever disagreed with its path, the two would diverge in the same way they
// did when the bodies were bundled — no silent change of meaning.
// ============================================================================

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** URL prefix the article bodies are served under (dist/public/learn-content). */
export const LEARN_CONTENT_URL_PREFIX = "/learn-content";

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function subDirNames(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function jsonFileNames(dir) {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Enumerate the corpus under `contentDir` (the content/learn directory).
 * Returns { articles, counties } in deterministic (sorted path) order.
 * Each entry: { pathKey, ...content metadata fields, url, sourcePath }
 * where sourcePath is repo-root-relative (e.g. "content/learn/texas…")
 * so callers can resolve it against the repository root.
 */
export function buildLearnContentIndex(contentDir) {
  const articles = [];
  for (const vertical of subDirNames(contentDir)) {
    if (vertical === "county") continue;
    const dir = path.join(contentDir, vertical);
    for (const file of jsonFileNames(dir)) {
      const state = file.replace(/\.json$/, "");
      const content = readJson(path.join(dir, file));
      articles.push({
        pathKey: `${vertical}::${state}`,
        vertical: content.vertical,
        stateSlug: content.stateSlug,
        stateName: content.stateName,
        headline: content.headline,
        url: `${LEARN_CONTENT_URL_PREFIX}/${vertical}/${file}`,
        sourcePath: `content/learn/${vertical}/${file}`,
      });
    }
  }

  const counties = [];
  const countyRoot = path.join(contentDir, "county");
  for (const state of subDirNames(countyRoot)) {
    const dir = path.join(countyRoot, state);
    for (const file of jsonFileNames(dir)) {
      const county = file.replace(/\.json$/, "");
      const content = readJson(path.join(dir, file));
      counties.push({
        pathKey: `${state}::${county}`,
        stateSlug: content.stateSlug,
        stateName: content.stateName,
        countySlug: content.countySlug,
        countyName: content.countyName,
        url: `${LEARN_CONTENT_URL_PREFIX}/county/${state}/${file}`,
        sourcePath: `content/learn/county/${state}/${file}`,
      });
    }
  }

  return { articles, counties };
}
