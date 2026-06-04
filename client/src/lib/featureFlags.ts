/**
 * Client-side feature flags for the AcreOS founder surface migration.
 *
 * NOTE: this is intentionally NOT the same as `client/src/hooks/use-feature-flags.ts`,
 * which is the server-driven, route-level feature-flag registry used by
 * `FlaggedRoute` + the customer sidebar. This file is a tiny, synchronous
 * localStorage-keyed shim for the Solene migration (phases 4-7) where Tom
 * needs to flip his own founder UI without a server round-trip.
 *
 * When Phase 4 (this commit) lands, `useNewFounderUI()` controls:
 *   - which founder sidebar renders (new 5-door vs existing 30+ entries)
 *   - whether `/founder` (root) redirects to `/founder/today`
 *
 * Flip from devtools:
 *   localStorage.setItem('useNewFounderUI', 'true');  location.reload();
 *
 * A Settings toggle will follow in a Phase-4 follow-up commit.
 */

const NEW_FOUNDER_UI_STORAGE_KEY = "useNewFounderUI";

/**
 * When true, the founder sidebar shows the new 5-door structure
 * (Today / Team / Customers / Money / Build) + Today is the default
 * landing page at /founder.
 *
 * When false, the existing 30+ founder pages remain the primary nav
 * (existing behavior unchanged).
 *
 * SSR-safe: returns false when `window` is undefined.
 */
export function useNewFounderUI(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(NEW_FOUNDER_UI_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Imperatively toggle the new founder UI. Used by the (future)
 * Settings switch. No-op in SSR contexts.
 */
export function setNewFounderUI(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) {
      window.localStorage.setItem(NEW_FOUNDER_UI_STORAGE_KEY, "true");
    } else {
      window.localStorage.removeItem(NEW_FOUNDER_UI_STORAGE_KEY);
    }
  } catch {
    /* localStorage may be unavailable in private modes — silently ignore. */
  }
}
