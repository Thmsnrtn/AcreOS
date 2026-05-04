/**
 * ⌘K v2 client-side recency tracker — Phase 4 Week 19-20 (Anya §2).
 *
 * Persists the user's last N command-palette selections in
 * localStorage so the matcher can lift recently-clicked items above
 * cold-equivalents at scoring time.
 *
 * Storage shape:
 *   localStorage["acreos:cmdk:recents"] = JSON.stringify(RecencyEntry[])
 *
 * Bounded to 50 entries; older ones evicted FIFO.
 * Window check (7 days) is enforced by `recencyScore()` at read time —
 * we don't prune on write to stay cheap.
 */

import type { RecencyEntry } from "@shared/cmdkMatcher";

const STORAGE_KEY = "acreos:cmdk:recents";
const MAX_ENTRIES = 50;

function safeParse(): RecencyEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RecencyEntry =>
        e && typeof e.id === "string" && typeof e.at === "number",
    );
  } catch {
    return [];
  }
}

export function readRecents(): RecencyEntry[] {
  return safeParse();
}

export function recordRecency(id: string, at: number = Date.now()): void {
  if (typeof window === "undefined" || !id) return;
  try {
    const existing = safeParse().filter((e) => e.id !== id);
    existing.unshift({ id, at });
    const trimmed = existing.slice(0, MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage full / SecurityError — drop silently. The palette
    // still works, just without recency boost.
  }
}

export function clearRecents(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}
