/**
 * Door chunk prefetch — perceived-speed doctrine (Tier 3C, elevation
 * blueprint).
 *
 * The five doors (Today · Map · Deals · Finance · Pax) are React.lazy
 * chunks; on a cold tap the user pays chunk-download + parse before the
 * door even starts fetching data. This module warms those chunks during
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

const DOOR_CHUNKS: ReadonlyArray<() => Promise<unknown>> = [
  () => import("@/pages/today"),
  () => import("@/pages/maps"),
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

/** Warm the five door chunks once, sequentially, during idle time. */
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
