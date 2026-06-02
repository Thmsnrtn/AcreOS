/**
 * Registry — loads every /learn/<vertical>/<state>.json content file and
 * exposes a typed lookup the route component uses to render one page.
 *
 * Vite's `import.meta.glob` with `eager: true` resolves the JSON files
 * at build time, so there's no runtime fetch and no extra network
 * round-trip. The shipped bundle includes only the content pages we've
 * actually authored — adding a new state×vertical is a content-only PR.
 */

import type { LearnContent, LearnVertical, StateSlug } from "./types";

// Build-time glob — every JSON file under content/learn/* is bundled.
// The glob path is relative to this file. Vite's import.meta.glob does
// not honour aliases — it must be a relative or absolute path. From
// client/src/pages/learn/registry.ts, the project-root content/ folder
// is four levels up.
const RAW = import.meta.glob<{ default: LearnContent }>(
  "../../../../content/learn/*/*.json",
  { eager: true },
);

interface RegistryKey {
  vertical: LearnVertical;
  state: StateSlug;
}

const REGISTRY = new Map<string, LearnContent>();

for (const [filePath, mod] of Object.entries(RAW)) {
  // filePath looks like "/Users/.../content/learn/land-flipping/texas.json"
  // We only need the last two path segments.
  const segments = filePath.split("/");
  const file = segments[segments.length - 1];
  const dir = segments[segments.length - 2];
  if (!file || !dir) continue;
  const state = file.replace(/\.json$/, "");
  const key = makeKey({ vertical: dir as LearnVertical, state: state as StateSlug });
  REGISTRY.set(key, mod.default);
}

function makeKey({ vertical, state }: RegistryKey): string {
  return `${vertical}::${state}`;
}

export function getLearnContent(
  vertical: string,
  state: string,
): LearnContent | null {
  const key = `${vertical}::${state}`;
  return REGISTRY.get(key) ?? null;
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
  for (const c of REGISTRY.values()) {
    out.push({
      vertical: c.vertical,
      state: c.stateSlug,
      stateName: c.stateName,
      headline: c.headline,
    });
  }
  // Stable order: vertical → state alphabetical.
  out.sort((a, b) => {
    if (a.vertical !== b.vertical) return a.vertical.localeCompare(b.vertical);
    return a.stateName.localeCompare(b.stateName);
  });
  return out;
}
