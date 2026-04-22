import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useState-with-localStorage-persistence.
 *
 * Use for user preferences that should survive a refresh and stay local
 * to the browser — table sort order, collapsible section state, filter
 * chip selections, chart-range toggles, etc.
 *
 * Not for anything multi-device or security-sensitive — those belong in
 * a server-backed UserPreference table.
 *
 *   const [sort, setSort] = useLocalStorageState("leads:sort", {
 *     by: "createdAt", dir: "desc",
 *   });
 *
 * Key conventions: `scope:field` (e.g. "leads:sort", "founder-todo:collapsed").
 */
export function useLocalStorageState<T>(
  key: string,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw == null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  // Persist writes — but throttle aggressively to avoid hammering
  // localStorage on every keystroke when state changes frequently.
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (pendingRef.current) clearTimeout(pendingRef.current);
    pendingRef.current = setTimeout(() => {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // storage full / private mode — silently drop
      }
    }, 150);
    return () => {
      if (pendingRef.current) clearTimeout(pendingRef.current);
    };
  }, [key, value]);

  const update = useCallback((next: T | ((prev: T) => T)) => {
    setValue((prev) => (typeof next === "function" ? (next as (p: T) => T)(prev) : next));
  }, []);

  return [value, update];
}
