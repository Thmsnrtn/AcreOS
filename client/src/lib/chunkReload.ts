/**
 * F-D10 self-heal decision: should a lazy-chunk load failure hard-reload the
 * page? (Wired in main.tsx.)
 *
 * Reload when the message is a chunk-load failure, at most once per 10s per
 * window — EXCEPT while the page is being left. A navigation away aborts any
 * dynamic import still in flight, and WebKit reports that abort as
 * "Importing a module script failed." Reloading then reloads the page the
 * user is LEAVING, and the reload hijacks their navigation: caught by the
 * mobile Customer Surface Monitor, where `goto /deals` was "interrupted by
 * another navigation to /maps" on iPad/iPhone (2026-11-05, trace console:
 * "TypeError: Importing a module script failed."). An abort during unload is
 * not a stale bundle, so it never reloads.
 */
const CHUNK_FAILURE = /Failed to fetch dynamically imported module|Loading (?:CSS )?chunk|Importing a module script failed|MIME type of "text\/html"/i;
const RELOAD_COOLDOWN_MS = 10_000;

export function shouldReloadForChunkFailure(input: {
  message: string;
  /** True once the page has started unloading (pagehide / beforeunload). */
  unloading: boolean;
  /** When this window last self-healed (ms), or 0. */
  lastReloadAt: number;
  now: number;
}): boolean {
  if (input.unloading) return false;
  if (!CHUNK_FAILURE.test(input.message)) return false;
  return input.now - input.lastReloadAt >= RELOAD_COOLDOWN_MS;
}
