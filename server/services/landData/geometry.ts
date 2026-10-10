/**
 * Parcel-scale planar geometry for the W2 land-data pipeline.
 *
 * Everything is computed in a local equirectangular projection centred on the
 * parcel (metres east/north of the centre). At parcel and county scale the
 * distortion is well under 1% (it grows with the square of the distance from
 * the centre), which is far finer than the accuracy of the GIS parcel lines
 * and TIGER centerlines the facts are computed from. Pure: no I/O.
 */

export type Position = [number, number]; // [lng, lat]
export type Ring = Position[];
export type PolygonCoords = Ring[];
export type MultiPolygonCoords = PolygonCoords[];

export interface PolygonGeometry {
  type: "Polygon";
  coordinates: PolygonCoords;
}
export interface MultiPolygonGeometry {
  type: "MultiPolygon";
  coordinates: MultiPolygonCoords;
}
export interface LineStringGeometry {
  type: "LineString";
  coordinates: Position[];
}
export interface MultiLineStringGeometry {
  type: "MultiLineString";
  coordinates: Position[][];
}
export type AreaGeometry = PolygonGeometry | MultiPolygonGeometry;
export type LineGeometry = LineStringGeometry | MultiLineStringGeometry;

const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;
export const SQ_M_PER_ACRE = 4046.8564224;

export interface LocalProjection {
  lng0: number;
  lat0: number;
  /** [lng,lat] → [x,y] metres. */
  fwd(p: Position): [number, number];
}

export function localProjection(lng0: number, lat0: number): LocalProjection {
  const kx = EARTH_RADIUS_M * DEG * Math.cos(lat0 * DEG);
  const ky = EARTH_RADIUS_M * DEG;
  return {
    lng0,
    lat0,
    fwd: (p) => [(p[0] - lng0) * kx, (p[1] - lat0) * ky],
  };
}

function polygonsOf(g: AreaGeometry): PolygonCoords[] {
  return g.type === "Polygon" ? [g.coordinates] : g.coordinates;
}

export function linesOf(g: LineGeometry): Position[][] {
  return g.type === "LineString" ? [g.coordinates] : g.coordinates;
}

function bboxOfPositions(pts: Iterable<Position>): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

export function areaBbox(g: AreaGeometry): [number, number, number, number] {
  const pts: Position[] = [];
  for (const poly of polygonsOf(g)) for (const ring of poly) pts.push(...ring);
  return bboxOfPositions(pts);
}

/** Area-weighted centroid of the outer rings (holes ignored — parcel scale). */
export function areaCentroid(g: AreaGeometry): Position {
  const [minX, minY, maxX, maxY] = areaBbox(g);
  const proj = localProjection((minX + maxX) / 2, (minY + maxY) / 2);
  let a = 0, cx = 0, cy = 0;
  for (const poly of polygonsOf(g)) {
    const ring = poly[0].map(proj.fwd);
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      a += f;
      cx += (ring[j][0] + ring[i][0]) * f;
      cy += (ring[j][1] + ring[i][1]) * f;
    }
  }
  if (a === 0) return [(minX + maxX) / 2, (minY + maxY) / 2];
  cx /= 3 * a;
  cy /= 3 * a;
  const kx = EARTH_RADIUS_M * DEG * Math.cos(proj.lat0 * DEG);
  const ky = EARTH_RADIUS_M * DEG;
  return [proj.lng0 + cx / kx, proj.lat0 + cy / ky];
}

function ringAreaXY(ring: Array<[number, number]>): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(s) / 2;
}

/** Planar area in square metres (outer rings minus holes). */
export function areaSqM(g: AreaGeometry, proj?: LocalProjection): number {
  const p = proj ?? (() => {
    const c = areaCentroid(g);
    return localProjection(c[0], c[1]);
  })();
  let total = 0;
  for (const poly of polygonsOf(g)) {
    poly.forEach((ring, idx) => {
      const a = ringAreaXY(ring.map(p.fwd));
      total += idx === 0 ? a : -a;
    });
  }
  return Math.max(0, total);
}

export function areaAcres(g: AreaGeometry): number {
  return areaSqM(g) / SQ_M_PER_ACRE;
}

/** Even-odd point-in-polygon on [x,y] rings. */
function pointInRingsXY(x: number, y: number, rings: Array<Array<[number, number]>>): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** A polygon pre-projected for fast repeated point tests. */
export interface ProjectedArea {
  polys: Array<Array<Array<[number, number]>>>;
  bbox: [number, number, number, number];
}

export function projectArea(g: AreaGeometry, proj: LocalProjection): ProjectedArea {
  const polys = polygonsOf(g).map((poly) => poly.map((ring) => ring.map(proj.fwd)));
  const pts: Position[] = [];
  for (const poly of polys) for (const ring of poly) pts.push(...(ring as Position[]));
  return { polys, bbox: bboxOfPositions(pts) };
}

export function pointInProjectedArea(x: number, y: number, a: ProjectedArea): boolean {
  if (x < a.bbox[0] || x > a.bbox[2] || y < a.bbox[1] || y > a.bbox[3]) return false;
  for (const poly of a.polys) if (pointInRingsXY(x, y, poly)) return true;
  return false;
}

function pointSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Minimum distance (m) from an [x,y] point to a set of projected polylines. */
export function distToPolylinesXY(x: number, y: number, lines: Array<Array<[number, number]>>): number {
  let best = Infinity;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const d = pointSegDist(x, y, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Rings of a projected area as closed polylines (for boundary distance). */
function areaBoundaryLines(a: ProjectedArea): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  for (const poly of a.polys) for (const ring of poly) out.push(ring);
  return out;
}

/** Segment–segment intersection test on [x,y]. */
function segmentsIntersect(
  a: [number, number], b: [number, number], c: [number, number], d: [number, number],
): boolean {
  const o = (p: [number, number], q: [number, number], r: [number, number]) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4;
}

/**
 * Minimum distance (m) between two projected areas' boundaries, 0 when they
 * overlap or touch. Used for public-land adjacency.
 */
export function areaToAreaDistance(a: ProjectedArea, b: ProjectedArea): number {
  // Overlap = a vertex of one inside the other, or an edge crossing.
  const aLines = areaBoundaryLines(a);
  const bLines = areaBoundaryLines(b);
  for (const l of aLines) for (const [x, y] of l) if (pointInProjectedArea(x, y, b)) return 0;
  for (const l of bLines) for (const [x, y] of l) if (pointInProjectedArea(x, y, a)) return 0;
  let best = Infinity;
  for (const la of aLines) {
    for (let i = 1; i < la.length; i++) {
      for (const lb of bLines) {
        for (let j = 1; j < lb.length; j++) {
          if (segmentsIntersect(la[i - 1], la[i], lb[j - 1], lb[j])) return 0;
        }
      }
    }
  }
  for (const l of aLines) for (const [x, y] of l) best = Math.min(best, distToPolylinesXY(x, y, bLines));
  for (const l of bLines) for (const [x, y] of l) best = Math.min(best, distToPolylinesXY(x, y, aLines));
  return best;
}

/**
 * Densify a projected ring into pieces no longer than `stepM`, returning the
 * midpoint and length of each piece — the unit frontage is measured in.
 */
export function boundaryPieces(
  a: ProjectedArea,
  stepM: number,
): Array<{ x: number; y: number; len: number }> {
  const out: Array<{ x: number; y: number; len: number }> = [];
  for (const ring of areaBoundaryLines(a)) {
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = ring[i - 1];
      const [bx, by] = ring[i];
      const len = Math.hypot(bx - ax, by - ay);
      if (len === 0) continue;
      const n = Math.max(1, Math.ceil(len / stepM));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        out.push({ x: ax + t * (bx - ax), y: ay + t * (by - ay), len: len / n });
      }
    }
  }
  return out;
}

/** Does any projected polyline cross into the projected area? */
export function polylineEntersArea(line: Array<[number, number]>, a: ProjectedArea): boolean {
  for (const [x, y] of line) if (pointInProjectedArea(x, y, a)) return true;
  const boundary = areaBoundaryLines(a);
  for (let i = 1; i < line.length; i++) {
    for (const ring of boundary) {
      for (let j = 1; j < ring.length; j++) {
        if (segmentsIntersect(line[i - 1], line[i], ring[j - 1], ring[j])) return true;
      }
    }
  }
  return false;
}

export function bboxesOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number],
  padM = 0,
): boolean {
  return !(a[2] + padM < b[0] || b[2] + padM < a[0] || a[3] + padM < b[1] || b[3] + padM < a[1]);
}
