/**
 * County registry — the metadata index of /learn/county/<state>/<county>
 * content pages, plus the loader for individual county bodies.
 *
 * Content lives at content/learn/county/<state>/<county>.json and is produced
 * ONLY by scripts/generate-county-pages.mjs, which refuses to emit a file
 * whose data rollup fails the completeness quality bar. So every file the
 * index picks up is, by construction, a data-complete page — no thin doorway
 * pages reach the reader.
 *
 * Same split as the state registry (./registry.ts): the index is generated
 * into the bundle at build time by learnContentPlugin in vite.config.ts
 * (see scripts/learn-content-index.mjs), while each body ships as a static
 * JSON file served from /learn-content/county/… and is fetched on demand
 * by fetchCountyContent. The old eager import.meta.glob bundled the bodies
 * as JS; the parsed body a fetch returns is the same object, so the pages
 * render identically — only the delivery mechanism changed.
 */

import {
  LEARN_COUNTIES,
  type LearnCountyIndexEntry,
} from "virtual:acreos-learn-content";
import type { CountyLearnContent, StateSlug } from "./types";

const BY_PATH_KEY = new Map<string, LearnCountyIndexEntry>(
  LEARN_COUNTIES.map((entry) => [entry.pathKey, entry]),
);

function pathKey(state: string, county: string): string {
  return `${state}::${county}`;
}

/** The index fields the route component needs before the body arrives. */
export interface CountyRouteMeta {
  stateSlug: StateSlug;
  stateName: string;
  countySlug: string;
  countyName: string;
}

/**
 * Synchronous existence + metadata lookup, keyed by the same path-derived
 * key the bundled registry used. Null means no such county primer exists —
 * the route renders its not-found page immediately, as before.
 */
export function getCountyRouteMeta(
  state: string,
  county: string,
): CountyRouteMeta | null {
  const entry = BY_PATH_KEY.get(pathKey(state, county));
  if (!entry) return null;
  return {
    stateSlug: entry.stateSlug,
    stateName: entry.stateName,
    countySlug: entry.countySlug,
    countyName: entry.countyName,
  };
}

async function loadCountyBody(url: string): Promise<CountyLearnContent> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`county learn content fetch failed: ${url} responded ${res.status}`);
  }
  return (await res.json()) as CountyLearnContent;
}

const bodyCache = new Map<string, Promise<CountyLearnContent>>();

/**
 * Fetch one county body from its static JSON URL. Resolves null only when
 * no such county page exists (the component decides that synchronously via
 * getCountyRouteMeta first). A failed fetch REJECTS, so the component can
 * show a load-error state instead of a misleading not-found. Successes are
 * cached by path key; failures are evicted so a retry refetches.
 */
export function fetchCountyContent(
  state: string,
  county: string,
): Promise<CountyLearnContent | null> {
  const entry = BY_PATH_KEY.get(pathKey(state, county));
  if (!entry) return Promise.resolve(null);
  let pending = bodyCache.get(entry.pathKey);
  if (!pending) {
    pending = loadCountyBody(entry.url).catch((err: unknown) => {
      bodyCache.delete(entry.pathKey);
      throw err;
    });
    bodyCache.set(entry.pathKey, pending);
  }
  return pending;
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
  for (const entry of LEARN_COUNTIES) {
    out.push({
      stateSlug: entry.stateSlug,
      stateName: entry.stateName,
      countySlug: entry.countySlug,
      countyName: entry.countyName,
    });
  }
  out.sort((a, b) => {
    if (a.stateName !== b.stateName) return a.stateName.localeCompare(b.stateName);
    return a.countyName.localeCompare(b.countyName);
  });
  return out;
}
