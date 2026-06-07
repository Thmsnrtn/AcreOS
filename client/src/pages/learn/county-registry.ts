/**
 * County registry — loads every emitted county page JSON and exposes a typed
 * lookup the /learn/county/<state>/<county> route uses.
 *
 * Content lives at content/learn/county/<state>/<county>.json and is produced
 * ONLY by scripts/generate-county-pages.mjs, which refuses to emit a file
 * whose data rollup fails the completeness quality bar. So every file the glob
 * picks up is, by construction, a data-complete page — no thin doorway pages
 * reach the bundle.
 *
 * Same build-time glob pattern as the state registry: import.meta.glob with
 * eager:true bundles the authored pages at build, no runtime fetch.
 */

import type { CountyLearnContent } from "./types";

// Glob path is relative to this file. From client/src/pages/learn/, the
// project-root content/ folder is four levels up.
const RAW = import.meta.glob<{ default: CountyLearnContent }>(
  "../../../../content/learn/county/*/*.json",
  { eager: true },
);

const REGISTRY = new Map<string, CountyLearnContent>();

for (const [filePath, mod] of Object.entries(RAW)) {
  // filePath ends with ".../content/learn/county/<state>/<county>.json"
  const segments = filePath.split("/");
  const file = segments[segments.length - 1];
  const stateDir = segments[segments.length - 2];
  if (!file || !stateDir) continue;
  const county = file.replace(/\.json$/, "");
  REGISTRY.set(`${stateDir}::${county}`, mod.default);
}

export function getCountyContent(
  state: string,
  county: string,
): CountyLearnContent | null {
  return REGISTRY.get(`${state}::${county}`) ?? null;
}

/** Used by the sitemap + cross-link rendering. */
export function listCountyRoutes(): Array<{
  stateSlug: string;
  stateName: string;
  countySlug: string;
  countyName: string;
}> {
  const out: Array<{
    stateSlug: string;
    stateName: string;
    countySlug: string;
    countyName: string;
  }> = [];
  for (const c of REGISTRY.values()) {
    out.push({
      stateSlug: c.stateSlug,
      stateName: c.stateName,
      countySlug: c.countySlug,
      countyName: c.countyName,
    });
  }
  out.sort((a, b) => {
    if (a.stateName !== b.stateName) return a.stateName.localeCompare(b.stateName);
    return a.countyName.localeCompare(b.countyName);
  });
  return out;
}
