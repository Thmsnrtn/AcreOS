/**
 * Cross-build navigation (P1-9 / X-2 — the customer and founder bundles are two
 * separate Vite outputs, and wouter cannot navigate between them).
 *
 * Inside one build, navigation stays client-side. When the target path belongs
 * to the OTHER build, the only correct move is a full page load: the server
 * (server/static.ts) answers each build's paths with that build's shell.
 *
 * The path ownership list lives in shared/founder-surface-paths.ts so the
 * server and both bundles agree on it.
 */
import { isFounderBuildPath } from "@shared/founder-surface-paths";

export type AppBuild = "customer" | "founder";

/** Which bundle this code is running in (set per output in vite.config.ts). */
export const CURRENT_BUILD: AppBuild =
  import.meta.env.VITE_ACREOS_BUILD === "founder" ? "founder" : "customer";

/** The build that serves `path`. */
export function buildOwning(path: string): AppBuild {
  return isFounderBuildPath(path) ? "founder" : "customer";
}

/** True when navigating to `path` from the current build needs a page load. */
export function crossesBuilds(path: string, current: AppBuild = CURRENT_BUILD): boolean {
  // Only same-origin app paths are routed; anything else is not ours to judge.
  if (!path.startsWith("/")) return false;
  return buildOwning(path) !== current;
}

const HANDOFF_KEY = "acreos:cross-build-handoff";
const HANDOFF_WINDOW_MS = 10_000;

/**
 * Hand the browser to the other build with a full page load.
 *
 * Returns false (and does nothing) when the same target was already handed off
 * a moment ago. That is the loop guard: if the server ever answered a path with
 * the wrong build's shell (a deploy missing one output), repeating the hand-off
 * would reload forever, so the second attempt falls back to a plain NotFound.
 */
export function handOffToOtherBuild(target: string): boolean {
  const now = Date.now();
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (raw) {
      const prev = JSON.parse(raw) as { target?: string; at?: number };
      if (prev.target === target && typeof prev.at === "number" && now - prev.at < HANDOFF_WINDOW_MS) {
        return false;
      }
    }
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ target, at: now }));
  } catch {
    /* sessionStorage unavailable — still hand off once; the browser's own
       navigation is not something this guard can bound without storage. */
  }
  // replace(), not assign(): the wouter navigation that got us here already
  // pushed an entry, and Back must return to the page the user came from.
  window.location.replace(target);
  return true;
}
