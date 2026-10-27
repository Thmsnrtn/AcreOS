/**
 * Parcel lineage — what happened to each parcel between two releases of a
 * county's cadastral data (D2c). Spec: docs/land-data/d2c-apid-lineage-spec.md.
 *
 * Input is two snapshots keyed by the county's own source id (APN), each
 * record with its geometry (or null). Output is one event per connected group
 * of parcels, and every source id of both snapshots appears in exactly one
 * event:
 *
 *   same      one parcel → the same land under the same id
 *   renumber  one parcel → the same land under a different id
 *   split     one parcel → two or more parcels that together cover it
 *   merge     two or more parcels → one parcel that they together cover
 *   condo     one parcel → a stack of records sharing its footprint
 *   retired   a parcel with no counterpart in the next release
 *   new       a parcel with no counterpart in the previous release
 *   ambiguous anything else — a partial overlap, a boundary change, a split
 *             whose children do not cover the parent, a many-to-many group,
 *             condo units that geometry cannot pair. NEVER resolved by guess.
 *
 * Geometry. Both snapshots are projected with ONE local equirectangular
 * projection centred on the input's bounding box. That projection is affine,
 * so area RATIOS (the only thing a classification reads) are exactly the
 * ratios of the lng/lat areas — which is what makes the golden case
 * hand-computable. Intersections use @turf/turf's `intersect` (polyclip-ts, a
 * planar clipper; already a dependency) on the projected coordinates; areas
 * are planar shoelace sums, holes subtracted. A pair the clipper cannot
 * measure makes its group ambiguous, never silently disjoint.
 *
 * Pure and browser-safe.
 */
import { featureCollection, intersect, multiPolygon, polygon } from "@turf/turf";

export type LngLat = [number, number];

export type LineageGeometry =
  | { type: "Polygon"; coordinates: LngLat[][] }
  | { type: "MultiPolygon"; coordinates: LngLat[][][] };

export interface LineageParcel {
  /** The county's own parcel id (APN) in this release. */
  sourceId: string;
  /** null when the release carries no usable shape for the record. */
  geometry: LineageGeometry | null;
}

/** Two releases of ONE county. Source ids are county-scoped. */
export interface LineageInput {
  previous: LineageParcel[];
  next: LineageParcel[];
}

/**
 * Overlap thresholds, as fractions of a parcel's own area.
 *  - covers:        a fraction ≥ this means "all of it" (re-digitizing a line
 *                   moves a few percent of a small parcel's area);
 *  - negligible:    a pair whose BOTH fractions are below this is a sliver
 *                   (shared-edge drift), not a relationship;
 *  - sameFootprint: two records of ONE release whose mutual fractions are
 *                   both ≥ this are one footprint (a condo stack).
 * Everything between negligible and covers is the ambiguous band.
 */
export type LineageThresholds = { readonly covers: number; readonly negligible: number; readonly sameFootprint: number };

export const LINEAGE_THRESHOLDS: LineageThresholds = {
  covers: 0.95,
  negligible: 0.02,
  sameFootprint: 0.98,
};

export type LineageKind = "same" | "renumber" | "split" | "merge" | "condo" | "retired" | "new" | "ambiguous";

export type AmbiguityReason =
  | "boundary_change"
  | "partial_overlap"
  | "split_coverage_short"
  | "merge_coverage_short"
  | "overlapping_parts"
  | "many_to_many"
  | "condo_units_unpairable"
  | "geometry_unmeasurable";

export type LineageFlag =
  /** The id exists in both releases but on land that does not overlap. */
  | "apn_reused_for_different_land"
  /** The previous or next side of the event is a stack of records on one footprint. */
  | "condo_stack"
  /** A condo stack collapsed back to one record. */
  | "condo_dissolution";

export interface PairOverlap {
  previousId: string;
  nextId: string;
  intersectionSqM: number;
  /** intersection / area of the previous parcel. */
  fractionOfPrevious: number;
  /** intersection / area of the next parcel. */
  fractionOfNext: number;
}

export interface LineageEvent {
  kind: LineageKind;
  previousIds: string[];
  nextIds: string[];
  /** "id_only": decided from ids because a side has no usable geometry. */
  basis: "geometry" | "id_only";
  /** Every measured pair in the group (sorted), the evidence for the call. */
  overlaps: PairOverlap[];
  /**
   * split: Σ fractionOfPrevious over the children (how much of the parent
   * they cover); merge: Σ fractionOfNext over the parents; same / renumber /
   * condo: min of the pair's two fractions; otherwise null.
   */
  coverage: number | null;
  /** Set only on ambiguous events. */
  reason: AmbiguityReason | null;
  flags: LineageFlag[];
  /** condo: the stack record that keeps the parent's id, if any. */
  continuingId: string | null;
}

export type LineageResult =
  | { ok: true; events: LineageEvent[] }
  | { ok: false; reason: "duplicate_source_id"; side: "previous" | "next"; ids: string[] };

/** Same normalization as the parcel crosswalk's key: trim, upper-case, single spaces. */
export function normalizeSourceId(id: string): string {
  return id.trim().toUpperCase().replace(/\s+/g, " ");
}

// ── planar geometry ────────────────────────────────────────────────────────

type XY = [number, number];
type PolyXY = XY[][];

const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

function polysOf(g: LineageGeometry): LngLat[][][] {
  return g.type === "Polygon" ? [g.coordinates] : g.coordinates;
}

function closeRing(r: XY[]): XY[] | null {
  if (r.length < 3) return null;
  const [fx, fy] = r[0];
  const [lx, ly] = r[r.length - 1];
  const ring = fx === lx && fy === ly ? r : [...r, [fx, fy] as XY];
  return ring.length >= 4 ? ring : null;
}

function ringArea(r: XY[]): number {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(s) / 2;
}

function polysArea(polys: PolyXY[]): number {
  let total = 0;
  for (const p of polys) p.forEach((ring, i) => { total += i === 0 ? ringArea(ring) : -ringArea(ring); });
  return Math.max(0, total);
}

interface Shape {
  polys: PolyXY[];
  area: number;
  bbox: [number, number, number, number];
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function makeProjector(all: LineageGeometry[]): (p: LngLat) => XY {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const g of all) for (const poly of polysOf(g)) for (const ring of poly) for (const [x, y] of ring) {
    if (!finite(x) || !finite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const lng0 = Number.isFinite(minX) ? (minX + maxX) / 2 : 0;
  const lat0 = Number.isFinite(minY) ? (minY + maxY) / 2 : 0;
  const kx = EARTH_RADIUS_M * DEG * Math.cos(lat0 * DEG);
  const ky = EARTH_RADIUS_M * DEG;
  return (p) => [(p[0] - lng0) * kx, (p[1] - lat0) * ky];
}

/** A usable planar shape, or null (bad coordinates, open/short rings, zero area). */
function toShape(g: LineageGeometry, fwd: (p: LngLat) => XY): Shape | null {
  const polys: PolyXY[] = [];
  for (const poly of polysOf(g)) {
    const rings: XY[][] = [];
    for (const ring of poly) {
      if (!Array.isArray(ring) || ring.some((p) => !Array.isArray(p) || !finite(p[0]) || !finite(p[1]))) return null;
      const closed = closeRing(ring.map(fwd));
      if (!closed) return null;
      rings.push(closed);
    }
    if (rings.length > 0) polys.push(rings);
  }
  const area = polysArea(polys);
  if (polys.length === 0 || !(area > 0)) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polys) for (const [x, y] of p[0]) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { polys, area, bbox: [minX, minY, maxX, maxY] };
}

function bboxesOverlap(a: Shape["bbox"], b: Shape["bbox"]): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

/** Intersection area in m², or null when the clipper cannot measure the pair. */
function intersectionArea(a: Shape, b: Shape): number | null {
  if (!bboxesOverlap(a.bbox, b.bbox)) return 0;
  try {
    const feature = (s: Shape) => (s.polys.length === 1 ? polygon(s.polys[0]) : multiPolygon(s.polys));
    const fa = feature(a);
    const out = intersect(featureCollection<(typeof fa)["geometry"]>([fa, feature(b)]));
    if (!out) return 0;
    const g = out.geometry;
    const polys: PolyXY[] = g.type === "Polygon" ? [g.coordinates as PolyXY] : (g.coordinates as PolyXY[]);
    const area = polysArea(polys);
    return Number.isFinite(area) ? area : null;
  } catch {
    return null;
  }
}

/** Uniform grid over bboxes so a county-sized release is not O(n²). */
const GRID_CELL_M = 250;
function gridIndex(shapes: Array<{ shape: Shape }>): Map<string, number[]> {
  const grid = new Map<string, number[]>();
  shapes.forEach(({ shape }, i) => {
    const [x0, y0, x1, y1] = shape.bbox;
    for (let cx = Math.floor(x0 / GRID_CELL_M); cx <= Math.floor(x1 / GRID_CELL_M); cx++) {
      for (let cy = Math.floor(y0 / GRID_CELL_M); cy <= Math.floor(y1 / GRID_CELL_M); cy++) {
        const k = `${cx}:${cy}`;
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
      }
    }
  });
  return grid;
}
function candidates(grid: Map<string, number[]>, s: Shape): number[] {
  const out = new Set<number>();
  const [x0, y0, x1, y1] = s.bbox;
  for (let cx = Math.floor(x0 / GRID_CELL_M); cx <= Math.floor(x1 / GRID_CELL_M); cx++) {
    for (let cy = Math.floor(y0 / GRID_CELL_M); cy <= Math.floor(y1 / GRID_CELL_M); cy++) {
      for (const i of grid.get(`${cx}:${cy}`) ?? []) out.add(i);
    }
  }
  return [...out].sort((a, b) => a - b);
}

// ── union-find ────────────────────────────────────────────────────────────

class DisjointSet {
  private parent: number[];
  constructor(n: number) { this.parent = Array.from({ length: n }, (_, i) => i); }
  find(i: number): number {
    while (this.parent[i] !== i) { this.parent[i] = this.parent[this.parent[i]]; i = this.parent[i]; }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

// ── footprint units (condo stacks) ────────────────────────────────────────

interface Unit {
  side: "previous" | "next";
  /** Sorted member source ids — more than one = a condo stack. */
  ids: string[];
  shape: Shape;
}

function groupFootprints(side: Unit["side"], recs: Array<{ id: string; shape: Shape }>, t: LineageThresholds): Unit[] {
  const ds = new DisjointSet(recs.length);
  const grid = gridIndex(recs);
  recs.forEach((r, i) => {
    for (const j of candidates(grid, r.shape)) {
      if (j <= i) continue;
      const inter = intersectionArea(r.shape, recs[j].shape);
      if (inter === null) continue;
      if (inter / r.shape.area >= t.sameFootprint && inter / recs[j].shape.area >= t.sameFootprint) ds.union(i, j);
    }
  });
  const groups = new Map<number, number[]>();
  recs.forEach((_, i) => {
    const root = ds.find(i);
    const list = groups.get(root);
    if (list) list.push(i);
    else groups.set(root, [i]);
  });
  return [...groups.values()].map((members) => {
    const ids = members.map((m) => recs[m].id).sort();
    const rep = recs[members.find((m) => recs[m].id === ids[0]) ?? members[0]];
    return { side, ids, shape: rep.shape };
  });
}

// ── classification ────────────────────────────────────────────────────────

type EdgeKind = "equal" | "next_within_previous" | "previous_within_next" | "partial";

interface Edge {
  p: number;
  n: number;
  inter: number;
  fp: number;
  fn: number;
  kind: EdgeKind | "unmeasurable";
}

function edgeKind(fp: number, fn: number, t: LineageThresholds): EdgeKind | null {
  if (fp < t.negligible && fn < t.negligible) return null;
  if (fp >= t.covers && fn >= t.covers) return "equal";
  if (fn >= t.covers) return "next_within_previous";
  if (fp >= t.covers) return "previous_within_next";
  return "partial";
}

function blankEvent(kind: LineageKind, previousIds: string[], nextIds: string[], basis: LineageEvent["basis"]): LineageEvent {
  return { kind, previousIds: [...previousIds].sort(), nextIds: [...nextIds].sort(), basis, overlaps: [], coverage: null, reason: null, flags: [], continuingId: null };
}

function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function findDuplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup].sort();
}

function classifyComponent(P: Unit[], N: Unit[], E: Edge[], prevUnits: Unit[], nextUnits: Unit[], t: LineageThresholds): LineageEvent[] {
  const prevIds = P.flatMap((u) => u.ids);
  const nextIds = N.flatMap((u) => u.ids);
  const overlaps: PairOverlap[] = [];
  for (const e of E) {
    if (e.kind === "unmeasurable") continue;
    for (const pid of prevUnits[e.p].ids) for (const nid of nextUnits[e.n].ids) {
      overlaps.push({ previousId: pid, nextId: nid, intersectionSqM: e.inter, fractionOfPrevious: e.fp, fractionOfNext: e.fn });
    }
  }
  overlaps.sort((a, b) => byCodePoint(a.previousId, b.previousId) || byCodePoint(a.nextId, b.nextId));
  const ev = (kind: LineageKind, pIds = prevIds, nIds = nextIds): LineageEvent => ({ ...blankEvent(kind, pIds, nIds, "geometry"), overlaps });
  const ambiguous = (reason: AmbiguityReason): LineageEvent[] => {
    const e = ev("ambiguous");
    e.reason = reason;
    if (P.some((u) => u.ids.length > 1) || N.some((u) => u.ids.length > 1)) e.flags.push("condo_stack");
    return [e];
  };

  if (P.length === 1 && N.length === 0) {
    const e = blankEvent("retired", prevIds, [], "geometry");
    if (prevIds.length > 1) e.flags.push("condo_stack");
    return [e];
  }
  if (P.length === 0 && N.length === 1) {
    const e = blankEvent("new", [], nextIds, "geometry");
    if (nextIds.length > 1) e.flags.push("condo_stack");
    return [e];
  }
  if (E.some((e) => e.kind === "unmeasurable")) return ambiguous("geometry_unmeasurable");

  if (P.length === 1 && N.length === 1) {
    const [edge] = E;
    const p = P[0], n = N[0];
    if (edge.kind !== "equal") return ambiguous(edge.kind === "partial" ? "partial_overlap" : "boundary_change");
    const coverage = Math.min(edge.fp, edge.fn);
    if (p.ids.length === 1 && n.ids.length === 1) {
      const e = ev(p.ids[0] === n.ids[0] ? "same" : "renumber");
      e.coverage = coverage;
      return [e];
    }
    if (p.ids.length === 1) {
      // One parcel became a stack on its footprint: a condo conversion.
      const e = ev("condo");
      e.coverage = coverage;
      e.flags.push("condo_stack");
      e.continuingId = n.ids.includes(p.ids[0]) ? p.ids[0] : null;
      return [e];
    }
    if (n.ids.length === 1) {
      const e = ev("merge");
      e.coverage = coverage;
      e.flags.push("condo_stack", "condo_dissolution");
      return [e];
    }
    // Stack → stack on the same footprint: pair units by id only.
    const common = p.ids.filter((id) => n.ids.includes(id));
    const prevOnly = p.ids.filter((id) => !n.ids.includes(id));
    const nextOnly = n.ids.filter((id) => !p.ids.includes(id));
    if (common.length === 0 || (prevOnly.length > 0 && nextOnly.length > 0)) return ambiguous("condo_units_unpairable");
    const out: LineageEvent[] = common.map((id) => {
      const e = ev("same", [id], [id]);
      e.coverage = coverage;
      e.flags.push("condo_stack");
      return e;
    });
    for (const id of prevOnly) { const e = ev("retired", [id], []); e.flags.push("condo_stack"); out.push(e); }
    for (const id of nextOnly) { const e = ev("new", [], [id]); e.flags.push("condo_stack"); out.push(e); }
    return out;
  }

  const upper = 2 - t.covers; // Σ fractions above this means the parts overlap each other
  if (P.length === 1 && N.length >= 2) {
    if (N.some((u) => u.ids.length > 1) || P[0].ids.length > 1) return ambiguous("many_to_many");
    // Every child lies within the parent ("equal" included: a child that is
    // ≥ covers of its parent alongside a sliver-sized sibling is still a split).
    if (!E.every((e) => e.kind === "next_within_previous" || e.kind === "equal")) return ambiguous(E.some((e) => e.kind === "partial") ? "partial_overlap" : "many_to_many");
    const coverage = E.reduce((s, e) => s + e.fp, 0);
    if (coverage > upper) return ambiguous("overlapping_parts");
    if (coverage < t.covers) return ambiguous("split_coverage_short");
    const e = ev("split");
    e.coverage = coverage;
    return [e];
  }
  if (P.length >= 2 && N.length === 1) {
    if (P.some((u) => u.ids.length > 1) || N[0].ids.length > 1) return ambiguous("many_to_many");
    if (!E.every((e) => e.kind === "previous_within_next" || e.kind === "equal")) return ambiguous(E.some((e) => e.kind === "partial") ? "partial_overlap" : "many_to_many");
    const coverage = E.reduce((s, e) => s + e.fn, 0);
    if (coverage > upper) return ambiguous("overlapping_parts");
    if (coverage < t.covers) return ambiguous("merge_coverage_short");
    const e = ev("merge");
    e.coverage = coverage;
    return [e];
  }
  return ambiguous("many_to_many");
}

/**
 * Classify what happened between two releases. Refuses (never guesses) when a
 * release lists one source id twice. `thresholds` is a test seam; production
 * callers use the default.
 */
export function classifyLineage(input: LineageInput, thresholds: LineageThresholds = LINEAGE_THRESHOLDS): LineageResult {
  const prev = input.previous.map((r) => ({ id: normalizeSourceId(r.sourceId), geometry: r.geometry }));
  const next = input.next.map((r) => ({ id: normalizeSourceId(r.sourceId), geometry: r.geometry }));
  const dp = findDuplicates(prev.map((r) => r.id));
  if (dp.length) return { ok: false, reason: "duplicate_source_id", side: "previous", ids: dp };
  const dn = findDuplicates(next.map((r) => r.id));
  if (dn.length) return { ok: false, reason: "duplicate_source_id", side: "next", ids: dn };

  const fwd = makeProjector([...prev, ...next].flatMap((r) => (r.geometry ? [r.geometry] : [])));
  const shaped = (rs: typeof prev) => rs.map((r) => ({ id: r.id, shape: r.geometry ? toShape(r.geometry, fwd) : null }));
  const ps = shaped(prev);
  const ns = shaped(next);

  // An id whose record lacks usable geometry on EITHER side is decided by id
  // alone; both of its records leave the geometric analysis.
  const noGeom = new Set<string>([...ps, ...ns].filter((r) => r.shape === null).map((r) => r.id));
  const events: LineageEvent[] = [];
  const prevIdSet = new Set(ps.map((r) => r.id));
  const nextIdSet = new Set(ns.map((r) => r.id));
  for (const id of [...noGeom].sort()) {
    const inP = prevIdSet.has(id), inN = nextIdSet.has(id);
    events.push(blankEvent(inP && inN ? "same" : inP ? "retired" : "new", inP ? [id] : [], inN ? [id] : [], "id_only"));
  }
  const geomPrev = ps.filter((r): r is { id: string; shape: Shape } => r.shape !== null && !noGeom.has(r.id));
  const geomNext = ns.filter((r): r is { id: string; shape: Shape } => r.shape !== null && !noGeom.has(r.id));

  const prevUnits = groupFootprints("previous", geomPrev, thresholds);
  const nextUnits = groupFootprints("next", geomNext, thresholds);

  const edges: Edge[] = [];
  const grid = gridIndex(prevUnits);
  nextUnits.forEach((nu, n) => {
    for (const p of candidates(grid, nu.shape)) {
      const pu = prevUnits[p];
      const inter = intersectionArea(pu.shape, nu.shape);
      if (inter === null) {
        edges.push({ p, n, inter: 0, fp: 0, fn: 0, kind: "unmeasurable" });
        continue;
      }
      const fp = inter / pu.shape.area;
      const fn = inter / nu.shape.area;
      const kind = edgeKind(fp, fn, thresholds);
      if (kind) edges.push({ p, n, inter, fp, fn, kind });
    }
  });

  // Connected components over prev units [0, P) and next units [P, P+N).
  const offset = prevUnits.length;
  const ds = new DisjointSet(prevUnits.length + nextUnits.length);
  for (const e of edges) ds.union(e.p, offset + e.n);
  const comps = new Map<number, { P: number[]; N: number[]; E: Edge[] }>();
  const comp = (root: number) => {
    let c = comps.get(root);
    if (!c) { c = { P: [], N: [], E: [] }; comps.set(root, c); }
    return c;
  };
  prevUnits.forEach((_, i) => comp(ds.find(i)).P.push(i));
  nextUnits.forEach((_, i) => comp(ds.find(offset + i)).N.push(i));
  for (const e of edges) comp(ds.find(e.p)).E.push(e);

  for (const c of comps.values()) {
    events.push(...classifyComponent(c.P.map((i) => prevUnits[i]), c.N.map((i) => nextUnits[i]), c.E, prevUnits, nextUnits, thresholds));
  }

  // An id present in both releases that did NOT stay with its land.
  for (const e of events) {
    if (e.basis !== "geometry" || e.kind === "same") continue;
    const reused = (e.kind === "new" ? e.nextIds : e.kind === "retired" ? e.previousIds : []).some((id) => prevIdSet.has(id) && nextIdSet.has(id));
    if (reused) e.flags.push("apn_reused_for_different_land");
  }

  // Deterministic order: by first id, then a retired before a new of the same id.
  const prevFirst = (e: LineageEvent) => (e.previousIds.length === 0 ? 1 : 0);
  events.sort((a, b) =>
    byCodePoint(a.previousIds[0] ?? a.nextIds[0] ?? "", b.previousIds[0] ?? b.nextIds[0] ?? "") ||
    prevFirst(a) - prevFirst(b) ||
    byCodePoint(a.nextIds[0] ?? "", b.nextIds[0] ?? ""),
  );
  return { ok: true, events };
}

// ── inheritance ───────────────────────────────────────────────────────────

/**
 * What a next-release record inherits, by event kind. Field VALUES (owner,
 * tax, valuation, sale, legal description) are never copied from a parent:
 * each record's values come from its own release, and a parent's assessed
 * value shown as a child's would be an invented number. Derived facts (acres,
 * flood, slope, frontage) are always recomputed from the record's own shape.
 *
 *  - identity:  "carried" — the record keeps the previous record's APID;
 *               "minted"  — a new APID; "provisional" — a new APID flagged
 *               for review (ambiguous), the previous APIDs are held.
 *  - history:   "own"       — the parcel's history IS the previous record's;
 *               "ancestral" — the parents' history is linked and shown as the
 *                             PARENTS', never as the record's own;
 *               "none".
 */
export const INHERITANCE_RULES: Record<Exclude<LineageKind, "retired">, { identity: "carried" | "minted" | "provisional"; history: "own" | "ancestral" | "none" }> = {
  same: { identity: "carried", history: "own" },
  renumber: { identity: "carried", history: "own" },
  split: { identity: "minted", history: "ancestral" },
  merge: { identity: "minted", history: "ancestral" },
  condo: { identity: "minted", history: "ancestral" },
  new: { identity: "minted", history: "none" },
  ambiguous: { identity: "provisional", history: "none" },
};

export interface InheritancePlan {
  nextId: string;
  identity: "carried" | "minted" | "provisional";
  /** identity "carried": the previous source id whose APID this record keeps. */
  carriedFrom: string | null;
  history: "own" | "ancestral" | "none";
  /** Previous source ids that are lineage parents (split / merge / condo). */
  ancestors: string[];
  /** ambiguous only: previous ids a reviewer may link — never lineage until resolved. */
  candidateAncestors: string[];
}

/** One plan per next-release id of the event (empty for retired). */
export function inheritanceFor(event: LineageEvent): InheritancePlan[] {
  if (event.kind === "retired") return [];
  const rule = INHERITANCE_RULES[event.kind];
  return event.nextIds.map((nextId) => {
    // A condo stack record that keeps the parent's id continues the parent.
    if (event.kind === "condo" && event.continuingId === nextId) {
      return { nextId, identity: "carried", carriedFrom: nextId, history: "own", ancestors: [], candidateAncestors: [] };
    }
    const carried = rule.identity === "carried";
    return {
      nextId,
      identity: rule.identity,
      carriedFrom: carried ? event.previousIds[0] : null,
      history: rule.history,
      ancestors: rule.history === "ancestral" ? [...event.previousIds] : [],
      candidateAncestors: event.kind === "ambiguous" ? [...event.previousIds] : [],
    };
  });
}
