/**
 * parcel-stream-reducer — the pure state machine behind the "watch the
 * diligence pull happen source-by-named-source" experience (Krieger, the
 * boldest UX bet).
 *
 * The streaming endpoint (`/api/public/parcel-check/stream`) emits one SSE
 * event per free government source as it resolves. This reducer turns that
 * event sequence into the tile state the UI renders: each tile starts
 * `querying`, then flips to `resolved` (a real value + provenance) or `missing`
 * (an honest "not available" — never a fabricated value), while a running meter
 * tracks how many sources have landed and how long the pull has taken.
 *
 * It is deliberately pure and framework-free so it can be unit-tested in
 * isolation (tiles: querying → resolved/missing, meter math) and reused by both
 * the public `/tools/parcel-check` page and the authed Land Snapshot.
 *
 * Honesty contract mirrors the server: a source that misses lands as `missing`
 * with its source still named where known — the absence is attributable, never
 * filled with a default.
 */

export type ParcelStreamCategory =
  | "flood_zone"
  | "soil"
  | "elevation"
  | "wetlands"
  | "demographics";

export type TileStatus = "querying" | "resolved" | "missing";

/** A single source result as the server streams it (the `source` SSE event). */
export interface StreamedSource {
  category: ParcelStreamCategory;
  available: boolean;
  data: Record<string, unknown> | null;
  source: string | null;
  sourceAsOf: string | null;
  classification: "authoritative" | "estimate" | "modeled" | "unknown";
  confidence: number | null;
  fromCache: boolean;
}

/** One tile's view state. */
export interface TileState {
  category: ParcelStreamCategory;
  status: TileStatus;
  /** Populated once status leaves "querying". */
  result: StreamedSource | null;
}

export interface ParcelStreamState {
  /** Phase of the whole pull. */
  phase: "idle" | "connecting" | "streaming" | "done" | "unresolved" | "error";
  /** One entry per expected category, in stream order. */
  tiles: TileState[];
  /** Coordinates + matched address from the `meta` event. */
  coordinates: { lat: number; lng: number } | null;
  matchedAddress: string | null;
  /** Live counts for the meter. */
  resolvedCount: number;
  missingCount: number;
  /** Total expected sources (from `meta.categories`); null until meta lands. */
  totalCount: number | null;
  /** Final timing from the `done` event (ms), or null while streaming. */
  lookupTimeMs: number | null;
  /** Terminal honest message for unresolved / error phases. */
  message: string | null;
}

export type ParcelStreamEvent =
  | { type: "reset" }
  | { type: "open" }
  | {
      type: "meta";
      coordinates: { lat: number; lng: number };
      matchedAddress: string | null;
      categories: ParcelStreamCategory[];
    }
  | { type: "source"; source: StreamedSource }
  | { type: "done"; lookupTimeMs: number }
  | { type: "unresolved"; message: string }
  | { type: "error"; message: string };

export const initialParcelStreamState: ParcelStreamState = {
  phase: "idle",
  tiles: [],
  coordinates: null,
  matchedAddress: null,
  resolvedCount: 0,
  missingCount: 0,
  totalCount: null,
  lookupTimeMs: null,
  message: null,
};

/**
 * The pure reducer. Ordering is forgiving: a `source` arriving before `meta`
 * (e.g. a fast cache hit on a slow proxy) still creates/updates its tile, and a
 * late `meta` backfills any categories not yet seen as `querying`. Counts are
 * recomputed from the tiles each step so they can never drift from the rendered
 * state.
 */
export function parcelStreamReducer(
  state: ParcelStreamState,
  event: ParcelStreamEvent,
): ParcelStreamState {
  switch (event.type) {
    case "reset":
      return { ...initialParcelStreamState };

    case "open":
      // Only meaningful from idle; ignore a re-open mid-stream.
      if (state.phase !== "idle") return state;
      return { ...state, phase: "connecting" };

    case "meta": {
      // Seed a querying tile per category, preserving any already-arrived
      // results (a source event can precede meta).
      const byCategory = new Map(state.tiles.map((t) => [t.category, t]));
      const tiles: TileState[] = event.categories.map(
        (category) =>
          byCategory.get(category) ?? {
            category,
            status: "querying" as const,
            result: null,
          },
      );
      // Keep any orphan tiles (source arrived for a category not in meta).
      for (const t of state.tiles) {
        if (!event.categories.includes(t.category)) tiles.push(t);
      }
      return {
        ...state,
        phase: "streaming",
        coordinates: event.coordinates,
        matchedAddress: event.matchedAddress,
        totalCount: event.categories.length,
        ...recount(tiles),
      };
    }

    case "source": {
      const status: TileStatus = event.source.available ? "resolved" : "missing";
      const nextTile: TileState = {
        category: event.source.category,
        status,
        result: event.source,
      };
      const exists = state.tiles.some((t) => t.category === event.source.category);
      const tiles = exists
        ? state.tiles.map((t) =>
            t.category === event.source.category ? nextTile : t,
          )
        : [...state.tiles, nextTile];
      return {
        ...state,
        // A source before meta still implies we're streaming.
        phase: state.phase === "done" ? state.phase : "streaming",
        ...recount(tiles),
      };
    }

    case "done":
      return { ...state, phase: "done", lookupTimeMs: event.lookupTimeMs };

    case "unresolved":
      return {
        ...initialParcelStreamState,
        phase: "unresolved",
        message: event.message,
      };

    case "error":
      return { ...state, phase: "error", message: event.message };

    default:
      return state;
  }
}

/** Recompute tiles + the derived counts together so they never drift. */
function recount(tiles: TileState[]): {
  tiles: TileState[];
  resolvedCount: number;
  missingCount: number;
} {
  let resolvedCount = 0;
  let missingCount = 0;
  for (const t of tiles) {
    if (t.status === "resolved") resolvedCount += 1;
    else if (t.status === "missing") missingCount += 1;
  }
  return { tiles, resolvedCount, missingCount };
}

/**
 * Meter math: how many sources have landed (resolved + missing) out of the
 * expected total. `arrived` is what the "N federal sources" counter shows;
 * `complete` is true once every expected source has reported.
 */
export function streamMeter(state: ParcelStreamState): {
  arrived: number;
  total: number | null;
  complete: boolean;
} {
  const arrived = state.resolvedCount + state.missingCount;
  const total = state.totalCount;
  const complete =
    state.phase === "done" || (total != null && arrived >= total && total > 0);
  return { arrived, total, complete };
}
