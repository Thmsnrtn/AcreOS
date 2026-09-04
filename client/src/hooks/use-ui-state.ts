import { useCallback, useEffect, useRef, useState } from "react";
import { clientLogger } from "@/lib/clientLogger";
import { hasAnyClerkSession } from "@/lib/clerk-session-detect";
import { apiRequest } from "@/lib/queryClient";

/**
 * useUiState — server-backed UI preference, keyed by (org, user, key) on the
 * server (Tahoe E6). The successor to useLocalStorageState for anything that
 * should follow a user across devices: collapsed panels, view toggles,
 * dismissed banners, chart-range selections, etc. Tom uses iOS AND desktop
 * heavily, so parity matters — localStorage-only state strands a preference
 * on whichever device set it.
 *
 * Behavior, in order of priority:
 *   1. Instant first paint — hydrate synchronously from localStorage (same
 *      key) so there is no flash while the server round-trips.
 *   2. Server hydration — on mount (when authenticated) GET the value and
 *      adopt it if present. The server is canonical across devices; a value
 *      written on the phone shows up on the desktop on next load.
 *   3. Optimistic writes — `setValue` updates local state immediately, mirrors
 *      to localStorage, and debounces a PUT to the server so rapid toggles
 *      collapse into one request. PUT failures log silently and keep local
 *      state (offline / unauth still works exactly like the old hook).
 *
 * Key conventions: "scope:field" (e.g. "sidebar:collapsed", "pax-rail:open"),
 * matching useLocalStorageState so a migrated consumer keeps its cached value.
 *
 *   const [collapsed, setCollapsed] = useUiState("sidebar:collapsed", false);
 */

const PUT_DEBOUNCE_MS = 400;

function lsRead<T>(key: string, initial: T): T {
  if (typeof window === "undefined") return initial;
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? initial : (JSON.parse(raw) as T);
  } catch {
    return initial;
  }
}

function lsWrite<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full / private mode — silently drop; server sync still runs.
  }
}

async function fetchServerValue<T>(key: string): Promise<{ value: T } | null> {
  try {
    const res = await fetch(`/api/ui-state/${encodeURIComponent(key)}`, {
      credentials: "include",
    });
    // 404 kept for rolling-deploy compat with servers predating `set:false`.
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data = (await res.json()) as { key: string; value: T; set?: boolean };
    if (data.set === false) return null; // unset on the server — keep local
    return { value: data.value };
  } catch {
    return null;
  }
}

async function putServerValue<T>(key: string, value: T): Promise<void> {
  try {
    // apiRequest rather than fetch: the catch below only ever fired on a
    // NETWORK error, so a 4xx/5xx was logged as success and the "failed;
    // local state retained" line could never appear for the case that
    // actually loses the write. apiRequest throws on a non-OK status, which
    // makes the handler that was already written reachable.
    await apiRequest("PUT", `/api/ui-state/${encodeURIComponent(key)}`, { value });
  } catch (err) {
    clientLogger.warn(`[ui-state] PUT /api/ui-state/${key} failed; local state retained`, err);
  }
}

export function useUiState<T>(
  key: string,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValueState] = useState<T>(() => lsRead(key, initial));

  const putTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the latest value so the debounced flush sends what the user
  // actually ended on, not a stale closure capture.
  const latestRef = useRef<T>(value);
  latestRef.current = value;

  // Server hydration on mount — adopt the server value if it exists. Skipped
  // when unauthenticated so landing/auth surfaces don't 401 in the console.
  useEffect(() => {
    if (!hasAnyClerkSession()) return;
    let cancelled = false;
    fetchServerValue<T>(key).then((server) => {
      if (cancelled || !server) return;
      setValueState(server.value);
      lsWrite(key, server.value);
    });
    return () => {
      cancelled = true;
    };
    // Intentionally keyed only on `key` — we hydrate once per key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValueState((prev) => {
        const resolved =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        // Optimistic: mirror to localStorage immediately for instant paint
        // and offline durability.
        lsWrite(key, resolved);
        latestRef.current = resolved;
        return resolved;
      });

      // Debounced server sync — only when authenticated. Collapses rapid
      // toggles into a single PUT carrying the final value.
      if (!hasAnyClerkSession()) return;
      if (putTimerRef.current) clearTimeout(putTimerRef.current);
      putTimerRef.current = setTimeout(() => {
        putTimerRef.current = null;
        void putServerValue(key, latestRef.current);
      }, PUT_DEBOUNCE_MS);
    },
    [key],
  );

  // Flush any pending write on unmount so a value set right before navigation
  // isn't lost.
  useEffect(() => {
    return () => {
      if (putTimerRef.current) {
        clearTimeout(putTimerRef.current);
        putTimerRef.current = null;
        if (hasAnyClerkSession()) void putServerValue(key, latestRef.current);
      }
    };
  }, [key]);

  return [value, setValue];
}
