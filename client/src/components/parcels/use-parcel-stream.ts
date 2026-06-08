/**
 * useParcelStream — the client side of the streaming parcel-check experience.
 *
 * Opens an EventSource against `/api/public/parcel-check/stream`, feeds each
 * named SSE event into the pure `parcelStreamReducer`, and fires a per-arrival
 * `lightImpact()` haptic so the customer FEELS each federal source land. If the
 * browser has no EventSource, or the stream errors before any tile arrives, it
 * falls back to the batch `/api/public/parcel-check` endpoint and replays the
 * same events through the reducer — so the UI is identical either way, just
 * without the per-source choreography.
 *
 * The reducer is pure and tested separately; this hook is the impure shell
 * (network + haptics + lifecycle). Haptics already self-suppress under
 * prefers-reduced-motion, so there is no extra guard here.
 */

import { useCallback, useEffect, useReducer, useRef } from "react";
import { lightImpact } from "@/lib/haptics";
import {
  parcelStreamReducer,
  initialParcelStreamState,
  type ParcelStreamCategory,
  type StreamedSource,
} from "./parcel-stream-reducer";

export interface ParcelStreamQuery {
  address?: string;
  lat?: number;
  lng?: number;
  apn?: string;
  /** Stable session id for rate-limit keying (NOT a credential). */
  sid: string;
}

/** Shape of the batch (non-streaming) endpoint, for the fallback replay. */
interface BatchResolved {
  resolved: true;
  coordinates: { lat: number; lng: number };
  matchedAddress: string | null;
  results: StreamedSource[];
  meta: { lookupTimeMs: number; successCount: number; failureCount: number };
}
interface BatchUnresolved {
  resolved: false;
  reason: string;
  message: string;
  results: [];
}
type BatchResponse = BatchResolved | BatchUnresolved;

function buildParams(query: ParcelStreamQuery): string {
  const p = new URLSearchParams();
  if (query.address) p.set("address", query.address);
  if (query.lat !== undefined) p.set("lat", String(query.lat));
  if (query.lng !== undefined) p.set("lng", String(query.lng));
  if (query.apn) p.set("apn", query.apn);
  p.set("sid", query.sid);
  return p.toString();
}

const RATE_LIMIT_MESSAGE =
  "You've run a lot of checks in a short window. Give it a minute and try again.";
const GENERIC_ERROR =
  "Something went wrong running that check. Try again in a moment.";

export function useParcelStream() {
  const [state, dispatch] = useReducer(
    parcelStreamReducer,
    initialParcelStreamState,
  );
  const sourceRef = useRef<EventSource | null>(null);
  // Did at least one tile arrive over the stream? Gates the silent fallback —
  // we only fall back if SSE produced nothing, never mid-stream.
  const sawAnyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const cleanup = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  // Replay the batch endpoint through the reducer so the rendered result is
  // identical to the streamed one (minus the staged choreography).
  const runBatchFallback = useCallback(async (query: ParcelStreamQuery) => {
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(
        `/api/public/parcel-check?${buildParams(query)}`,
        { headers: { Accept: "application/json" }, signal: controller.signal },
      );
      if (res.status === 429) {
        dispatch({ type: "unresolved", message: RATE_LIMIT_MESSAGE });
        return;
      }
      if (!res.ok) {
        dispatch({ type: "error", message: GENERIC_ERROR });
        return;
      }
      const data = (await res.json()) as BatchResponse;
      if (!data.resolved) {
        dispatch({ type: "unresolved", message: data.message });
        return;
      }
      dispatch({
        type: "meta",
        coordinates: data.coordinates,
        matchedAddress: data.matchedAddress,
        categories: data.results.map((r) => r.category),
      });
      for (const r of data.results) {
        dispatch({ type: "source", source: r });
        if (r.available) lightImpact();
      }
      dispatch({ type: "done", lookupTimeMs: data.meta.lookupTimeMs });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      dispatch({ type: "error", message: GENERIC_ERROR });
    }
  }, []);

  const start = useCallback(
    (query: ParcelStreamQuery) => {
      cleanup();
      sawAnyRef.current = false;
      dispatch({ type: "reset" });

      // No EventSource (older browser / SSR) → straight to the batch path.
      if (typeof window === "undefined" || typeof EventSource === "undefined") {
        dispatch({ type: "open" });
        void runBatchFallback(query);
        return;
      }

      dispatch({ type: "open" });
      const es = new EventSource(
        `/api/public/parcel-check/stream?${buildParams(query)}`,
      );
      sourceRef.current = es;

      es.addEventListener("meta", (e) => {
        try {
          const d = JSON.parse((e as MessageEvent).data) as {
            coordinates: { lat: number; lng: number };
            matchedAddress: string | null;
            categories: ParcelStreamCategory[];
          };
          dispatch({ type: "meta", ...d });
        } catch {
          /* ignore malformed frame */
        }
      });

      es.addEventListener("source", (e) => {
        try {
          const source = JSON.parse(
            (e as MessageEvent).data,
          ) as StreamedSource;
          sawAnyRef.current = true;
          dispatch({ type: "source", source });
          // Per-arrival haptic — the customer feels each federal source land.
          // Only on a real value; an honest "missing" tile stays silent.
          if (source.available) lightImpact();
        } catch {
          /* ignore malformed frame */
        }
      });

      es.addEventListener("unresolved", (e) => {
        sawAnyRef.current = true; // a terminal answer counts as a real result
        try {
          const d = JSON.parse((e as MessageEvent).data) as { message: string };
          dispatch({ type: "unresolved", message: d.message });
        } catch {
          dispatch({ type: "unresolved", message: GENERIC_ERROR });
        }
        cleanup();
      });

      es.addEventListener("done", (e) => {
        try {
          const d = JSON.parse((e as MessageEvent).data) as {
            lookupTimeMs: number;
          };
          dispatch({ type: "done", lookupTimeMs: d.lookupTimeMs });
        } catch {
          dispatch({ type: "done", lookupTimeMs: 0 });
        }
        cleanup();
      });

      es.addEventListener("error", () => {
        // EventSource fires a generic `error` both on the server's terminal
        // `error` event AND on a transport drop. If we never saw a tile, fall
        // back to the batch path silently; otherwise surface a soft error.
        es.close();
        sourceRef.current = null;
        if (!sawAnyRef.current) {
          void runBatchFallback(query);
        } else if (state.phase !== "done") {
          dispatch({ type: "error", message: GENERIC_ERROR });
        }
      });
    },
    // state.phase is read in the error handler; keep it current via ref-free
    // closure refresh. The handler only reads it to decide error-vs-quiet, and
    // a stale "streaming" still yields the correct soft-error branch.
    [cleanup, runBatchFallback, state.phase],
  );

  // Tear the connection down on unmount.
  useEffect(() => cleanup, [cleanup]);

  return { state, start, reset: () => { cleanup(); dispatch({ type: "reset" }); } };
}
