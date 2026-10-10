/**
 * Parcel-id crosswalk — a stable AcreOS parcel key that survives renumbering.
 *
 * Counties renumber parcels (re-mapping, splits, new map/group/parcel
 * schemes), so a county parcel id is not an identity. AcreOS assigns its own
 * key the first time it sees a parcel and, on every refresh, carries that key
 * forward to the incoming record that is the SAME LAND:
 *
 *   1. same source id AND the geometry still matches   → same key;
 *   2. different source id but the geometry matches     → same key, and the
 *      old→new id pair is recorded as an alias (a renumbering);
 *   3. no geometric match                               → a new key (a split,
 *      a merge, or a new parcel). The previous key is retired, never reused.
 *
 * "Geometry matches" = centroids within CENTROID_TOLERANCE_M and areas within
 * AREA_TOLERANCE_RATIO — a renumbered parcel keeps its shape; a split does not.
 * Pure and browser-safe.
 */

const CENTROID_TOLERANCE_M = 5;
const AREA_TOLERANCE_RATIO = 0.02;

export interface CrosswalkRecord {
  /** County source id (e.g. TN GISLINK). */
  sourceId: string;
  /** Centroid [lng, lat]. */
  centroid: [number, number];
  /** Planar area in square metres. */
  areaSqM: number;
}

export interface KeyedRecord extends CrosswalkRecord {
  parcelKey: string;
}

export interface CrosswalkResult {
  assigned: Array<{ sourceId: string; parcelKey: string; how: "same_id" | "renumbered" | "new" }>;
  aliases: Array<{ parcelKey: string; previousSourceId: string; newSourceId: string }>;
  retired: string[];
}

/** Deterministic new key: state + county FIPS + first-seen source id. */
export function newParcelKey(state: string, countyFips: string, sourceId: string): string {
  const norm = sourceId.trim().toUpperCase().replace(/\s+/g, " ");
  return `${state.toUpperCase()}-${countyFips}-${norm}`;
}

function metresBetween(a: [number, number], b: [number, number]): number {
  const R = 6_371_008.8;
  const toRad = Math.PI / 180;
  const x = (b[0] - a[0]) * toRad * Math.cos(((a[1] + b[1]) / 2) * toRad);
  const y = (b[1] - a[1]) * toRad;
  return Math.hypot(x, y) * R;
}

function sameLand(a: CrosswalkRecord, b: CrosswalkRecord): boolean {
  if (metresBetween(a.centroid, b.centroid) > CENTROID_TOLERANCE_M) return false;
  const big = Math.max(a.areaSqM, b.areaSqM);
  if (big === 0) return false;
  return Math.abs(a.areaSqM - b.areaSqM) / big <= AREA_TOLERANCE_RATIO;
}

/**
 * Carry keys from the previous snapshot to the incoming one. O(n·k) with a
 * coarse grid so a county-sized refresh stays linear in practice.
 */
export function reconcileCrosswalk(
  previous: KeyedRecord[],
  incoming: CrosswalkRecord[],
  mint: (sourceId: string) => string,
): CrosswalkResult {
  const byId = new Map(previous.map((p) => [p.sourceId, p]));
  const cell = (c: [number, number]) => `${Math.floor(c[0] * 2000)}:${Math.floor(c[1] * 2000)}`; // ~50 m cells
  const grid = new Map<string, KeyedRecord[]>();
  for (const p of previous) {
    const k = cell(p.centroid);
    const list = grid.get(k) ?? [];
    list.push(p);
    grid.set(k, list);
  }
  const used = new Set<string>();
  const result: CrosswalkResult = { assigned: [], aliases: [], retired: [] };
  const pending: CrosswalkRecord[] = [];

  // Pass 1: same id + same land.
  for (const rec of incoming) {
    const prev = byId.get(rec.sourceId);
    if (prev && !used.has(prev.parcelKey) && sameLand(prev, rec)) {
      used.add(prev.parcelKey);
      result.assigned.push({ sourceId: rec.sourceId, parcelKey: prev.parcelKey, how: "same_id" });
    } else pending.push(rec);
  }
  // Pass 2: renumbered (geometry match under a different id).
  for (const rec of pending) {
    const [cx, cy] = [Math.floor(rec.centroid[0] * 2000), Math.floor(rec.centroid[1] * 2000)];
    let match: KeyedRecord | null = null;
    for (let dx = -1; dx <= 1 && !match; dx++) {
      for (let dy = -1; dy <= 1 && !match; dy++) {
        for (const p of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (!used.has(p.parcelKey) && sameLand(p, rec)) { match = p; break; }
        }
      }
    }
    if (match) {
      used.add(match.parcelKey);
      result.assigned.push({ sourceId: rec.sourceId, parcelKey: match.parcelKey, how: "renumbered" });
      if (match.sourceId !== rec.sourceId) {
        result.aliases.push({ parcelKey: match.parcelKey, previousSourceId: match.sourceId, newSourceId: rec.sourceId });
      }
    } else {
      result.assigned.push({ sourceId: rec.sourceId, parcelKey: mint(rec.sourceId), how: "new" });
    }
  }
  for (const p of previous) if (!used.has(p.parcelKey)) result.retired.push(p.parcelKey);
  return result;
}
