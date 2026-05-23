/**
 * Tiny pure helpers backing the Atlas Dock's open/closed persistence.
 *
 * Split out from Dock.tsx so unit tests can exercise them without
 * pulling in framer-motion / react-query / the full Dock dependency
 * tree. The Dock re-exports `readStoredOpen` + `writeStoredOpen` from
 * here for ergonomic imports.
 */

/** localStorage keys — namespaced under `acr.` for grep-ability. */
export const STORAGE_OPEN = "acr.dock-open";
export const STORAGE_LAST_SEEN = "acr.dock-last-seen";

/** Mobile drag threshold (px) before we treat a downward swipe as a dismiss. */
export const MOBILE_DRAG_DISMISS_PX = 120;

/**
 * Read open state from localStorage. Defaults closed.
 * Safe to call in SSR contexts (returns false).
 */
export function readStoredOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_OPEN) === "1";
  } catch {
    return false;
  }
}

export function writeStoredOpen(open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_OPEN, open ? "1" : "0");
  } catch {
    /* private mode etc. — silently skip */
  }
}

export function readLastSeen(threadId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_LAST_SEEN}:${threadId}`);
    return raw ? Number(raw) : 0;
  } catch {
    return 0;
  }
}

export function writeLastSeen(threadId: string, ts: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${STORAGE_LAST_SEEN}:${threadId}`, String(ts));
  } catch {
    /* noop */
  }
}
