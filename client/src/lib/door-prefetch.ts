/**
 * Door chunk prefetch — perceived-speed doctrine (Tier 3C, elevation
 * blueprint).
 *
 * The five doors (Today · Map · Deals · Finance · Pax) are React.lazy
 * chunks; on a cold tap the user pays chunk-download + parse before the
 * door even starts fetching data. This module warms four of them (not Map —
 * see DOOR_CHUNKS) during
 * browser idle time after the app shell settles, so tapping a door goes
 * straight to the door-shaped skeleton → cached data instead of the
 * route-level fallback.
 *
 * Notes:
 *   - The import() specifiers here MUST match the React.lazy specifiers in
 *     App.tsx — Vite resolves both to the same chunk, so warming one warms
 *     the other.
 *   - requestIdleCallback is not available on iOS Safari; setTimeout is the
 *     fallback. Chunks load sequentially to avoid competing with real
 *     traffic on cellular connections.
 *   - Idempotent per session (module-level flag) — the dynamic import cache
 *     makes repeats harmless anyway, but there's no reason to re-enter.
 */

// The Map door is deliberately NOT warmed. Its page statically imports the
// map engine, so import() of it downloads AND EXECUTES all of MapLibre
// (vendor-map, ~290 KB gzipped, ~1 MB parsed) on whatever page the user is
// actually on — measured 2026-10-12, it doubled the JS of every mobile page
// view (Today: 534 -> 1,074 KB gzipped). Map code loads only when the map
// route renders; scripts/check-route-closure.mjs fails the build job if any
// module loaded on every page import()s map code again.
const DOOR_CHUNKS: ReadonlyArray<() => Promise<unknown>> = [
  () => import("@/pages/today"),
  () => import("@/pages/deals"),
  () => import("@/pages/money"),
  () => import("@/pages/pax"),
];

let started = false;

function whenIdle(callback: () => void) {
  if (typeof window === "undefined") return;
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(callback, { timeout: 5000 });
  } else {
    // iOS Safari path — wait out the initial paint + data burst.
    setTimeout(callback, 2500);
  }
}

/** Warm the non-map door chunks once, sequentially, during idle time. */
export function prefetchDoorChunksOnIdle(): void {
  if (started) return;
  started = true;
  whenIdle(() => {
    void DOOR_CHUNKS.reduce<Promise<unknown>>(
      (chain, load) => chain.then(load).catch(() => undefined),
      Promise.resolve(),
    );
  });
}
