/**
 * Registry — the metadata index of /learn/<vertical>/<state> content
 * pages, plus the loader for individual article bodies.
 *
 * The index (path key, slugs, state name, headline, body URL per
 * article) is generated into the bundle at build time from
 * content/learn/* by learnContentPlugin in vite.config.ts — see
 * scripts/learn-content-index.mjs. The article BODIES are not bundled:
 * each ships as a static JSON file (copied verbatim into
 * dist/public/learn-content/ at build end) and is fetched on demand by
 * fetchLearnContent, so the ~120 KB of prose no longer rides inside the
 * bundle gate's summed JS total. The parsed body is the same object the
 * old eager import.meta.glob produced — same articles, same rendering,
 * same routes; only the delivery mechanism changed. Adding a new
 * state×vertical is still a content-only PR: the index is rebuilt from
 * the files on disk at build time.
 *
 * The index is synchronous on purpose: the /learn hub, cross-links and
 * the not-found decision (getLearnRouteMeta) behave exactly as they did
 * when the bodies were bundled — an unknown state×vertical is a 404
 * immediately, never after a fetch.
 */

import {
  LEARN_ARTICLES,
  type LearnArticleIndexEntry,
} from "virtual:acreos-learn-content";
import type { LearnContent, LearnVertical, StateSlug } from "./types";

const BY_PATH_KEY = new Map<string, LearnArticleIndexEntry>(
  LEARN_ARTICLES.map((entry) => [entry.pathKey, entry]),
);

function pathKey(vertical: string, state: string): string {
  return `${vertical}::${state}`;
}

/** The index fields the route component needs before the body arrives. */
export interface LearnRouteMeta {
  vertical: LearnVertical;
  state: StateSlug;
  stateName: string;
  headline: string;
}

/**
 * Synchronous existence + metadata lookup, keyed by the same path-derived
 * key the bundled registry used. Null means no such primer exists — the
 * route renders its not-found page immediately, as before.
 */
export function getLearnRouteMeta(
  vertical: string,
  state: string,
): LearnRouteMeta | null {
  const entry = BY_PATH_KEY.get(pathKey(vertical, state));
  if (!entry) return null;
  return {
    vertical: entry.vertical,
    state: entry.stateSlug,
    stateName: entry.stateName,
    headline: entry.headline,
  };
}

async function loadLearnBody(url: string): Promise<LearnContent> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`learn content fetch failed: ${url} responded ${res.status}`);
  }
  return (await res.json()) as LearnContent;
}

const bodyCache = new Map<string, Promise<LearnContent>>();

/**
 * Fetch one article body from its static JSON URL. Resolves null only
 * when no such article exists (the component decides that synchronously
 * via getLearnRouteMeta first, so in practice this always resolves the
 * content). A failed fetch REJECTS — the old bundled body could not fail
 * to load, so a network failure is a distinct load-error state in the
 * component, never a misleading not-found. Successes are cached by path
 * key; failures are evicted so a retry refetches.
 */
export function fetchLearnContent(
  vertical: string,
  state: string,
): Promise<LearnContent | null> {
  const entry = BY_PATH_KEY.get(pathKey(vertical, state));
  if (!entry) return Promise.resolve(null);
  let pending = bodyCache.get(entry.pathKey);
  if (!pending) {
    pending = loadLearnBody(entry.url).catch((err: unknown) => {
      bodyCache.delete(entry.pathKey);
      throw err;
    });
    bodyCache.set(entry.pathKey, pending);
  }
  return pending;
}

/** Used by sitemap + cross-link rendering. */
export function listLearnRoutes(): Array<{
  vertical: LearnVertical;
  state: StateSlug;
  stateName: string;
  headline: string;
}> {
  const out: Array<{
    vertical: LearnVertical;
    state: StateSlug;
    stateName: string;
    headline: string;
  }> = [];
  for (const entry of LEARN_ARTICLES) {
    out.push({
      vertical: entry.vertical,
      state: entry.stateSlug,
      stateName: entry.stateName,
      headline: entry.headline,
    });
  }
  // Stable order: vertical → state alphabetical.
  out.sort((a, b) => {
    if (a.vertical !== b.vertical) return a.vertical.localeCompare(b.vertical);
    return a.stateName.localeCompare(b.stateName);
  });
  return out;
}
