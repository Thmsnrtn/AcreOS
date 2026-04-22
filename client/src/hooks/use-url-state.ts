import { useCallback, useMemo } from "react";
import { useLocation } from "wouter";

/**
 * URL query-string state, wouter-aware.
 *
 * Read/write a single query parameter as state. The browser's back/forward
 * buttons restore the view; deep-linked URLs pre-populate filters; view
 * can be shared by copy-paste.
 *
 *   const [status, setStatus] = useUrlParam("status", "all");
 *   const [page, setPage] = useUrlParam<number>("page", 1, {
 *     encode: String,
 *     decode: (v) => parseInt(v, 10) || 1,
 *   });
 *
 * Writes use replaceState by default (don't spam history). Pass
 * `{ push: true }` to opt into history entries (e.g. navigation, not
 * filter tweaks).
 */
export function useUrlParam<T = string>(
  key: string,
  defaultValue: T,
  opts: {
    encode?: (v: T) => string;
    decode?: (v: string) => T;
    push?: boolean;
  } = {},
): [T, (next: T) => void] {
  const [location, setLocation] = useLocation();
  const encode = opts.encode ?? ((v: T) => String(v));
  const decode = opts.decode ?? ((v: string) => v as unknown as T);

  const value = useMemo<T>(() => {
    if (typeof window === "undefined") return defaultValue;
    const sp = new URLSearchParams(window.location.search);
    const raw = sp.get(key);
    if (raw == null) return defaultValue;
    try {
      return decode(raw);
    } catch {
      return defaultValue;
    }
  }, [key, defaultValue, decode, location]);

  const set = useCallback(
    (next: T) => {
      if (typeof window === "undefined") return;
      const sp = new URLSearchParams(window.location.search);
      const encoded = encode(next);
      if (encoded === "" || encoded == null || encoded === String(defaultValue)) {
        sp.delete(key);
      } else {
        sp.set(key, encoded);
      }
      const qs = sp.toString();
      const nextUrl = window.location.pathname + (qs ? "?" + qs : "");
      if (opts.push) {
        setLocation(nextUrl);
      } else {
        window.history.replaceState(null, "", nextUrl);
        // Nudge wouter so components using useLocation re-render.
        setLocation(nextUrl, { replace: true });
      }
    },
    [key, encode, defaultValue, opts.push, setLocation],
  );

  return [value, set];
}
