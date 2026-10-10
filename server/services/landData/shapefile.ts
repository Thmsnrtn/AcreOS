/**
 * Minimal ESRI shapefile reader for the Comptroller per-county download
 * (polygon .shp + .dbf + .prj). The download is shapefile-only and arrives
 * by hand (no automated extracts), so the loader must read the format itself
 * rather than depend on GDAL being on the worker.
 *
 * Supports polygon shapes (types 5, 15, 25), dBASE III/IV tables, and the two
 * coordinate systems a Tennessee file can carry: geographic (GCS) and Lambert
 * Conformal Conic 2SP (the Tennessee State Plane zone), read from the .prj.
 */

import type { AreaGeometry, Position } from "./geometry";

// ── .dbf ───────────────────────────────────────────────────────────────────

export function readDbf(buf: Buffer): Array<Record<string, string | number | null>> {
  const nRecords = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recordLen = buf.readUInt16LE(10);
  const fields: Array<{ name: string; type: string; len: number; offset: number }> = [];
  let off = 1;
  for (let p = 32; p < headerLen - 1 && buf[p] !== 0x0d; p += 32) {
    const name = buf.toString("latin1", p, p + 11).replace(/\0.*$/, "");
    const type = String.fromCharCode(buf[p + 11]);
    const len = buf[p + 16];
    fields.push({ name, type, len, offset: off });
    off += len;
  }
  const rows: Array<Record<string, string | number | null>> = [];
  for (let i = 0; i < nRecords; i++) {
    const base = headerLen + i * recordLen;
    if (buf[base] === 0x2a) continue; // deleted
    const row: Record<string, string | number | null> = {};
    for (const f of fields) {
      const raw = buf.toString("latin1", base + f.offset, base + f.offset + f.len).trim();
      if (f.type === "N" || f.type === "F") row[f.name] = raw === "" ? null : Number(raw);
      else row[f.name] = raw === "" ? null : raw;
    }
    rows.push(row);
  }
  return rows;
}

// ── .prj → inverse projection ──────────────────────────────────────────────

export type Unproject = (x: number, y: number) => Position;

function param(wkt: string, name: string): number | null {
  const m = new RegExp(`PARAMETER\\["${name}",\\s*([-0-9.eE+]+)\\]`, "i").exec(wkt);
  return m ? Number(m[1]) : null;
}

/**
 * Inverse Lambert Conformal Conic (2SP) on an ellipsoid — EPSG Guidance Note
 * 7-2 §1.3.1.1. Inputs in the projection's linear unit; output lon/lat.
 */
export function lccInverse(p: {
  a: number; invF: number; lat1: number; lat2: number; lat0: number; lon0: number;
  falseE: number; falseN: number; unitToMetre: number;
}): Unproject {
  const rad = Math.PI / 180;
  const f = 1 / p.invF;
  const e2 = 2 * f - f * f;
  const e = Math.sqrt(e2);
  const m = (phi: number) => Math.cos(phi) / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const t = (phi: number) =>
    Math.tan(Math.PI / 4 - phi / 2) / ((1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi))) ** (e / 2);
  const [p1, p2, p0] = [p.lat1 * rad, p.lat2 * rad, p.lat0 * rad];
  const n = (Math.log(m(p1)) - Math.log(m(p2))) / (Math.log(t(p1)) - Math.log(t(p2)));
  const F = m(p1) / (n * t(p1) ** n);
  const r0 = p.a * F * t(p0) ** n;
  return (x, y) => {
    const E = x * p.unitToMetre - p.falseE * p.unitToMetre;
    const N = y * p.unitToMetre - p.falseN * p.unitToMetre;
    const dN = r0 - N;
    const r = Math.sign(n) * Math.sqrt(E * E + dN * dN);
    const tt = (r / (p.a * F)) ** (1 / n);
    const theta = Math.atan2(E, dN);
    let phi = Math.PI / 2 - 2 * Math.atan(tt);
    for (let i = 0; i < 10; i++) {
      const s = e * Math.sin(phi);
      phi = Math.PI / 2 - 2 * Math.atan(tt * ((1 - s) / (1 + s)) ** (e / 2));
    }
    return [theta / n / rad + p.lon0, phi / rad];
  };
}

export function unprojectFromPrj(wkt: string): Unproject {
  const w = wkt.replace(/\s+/g, "");
  if (/^GEOGCS/i.test(w)) return (x, y) => [x, y];
  if (!/Lambert_Conformal_Conic/i.test(w)) throw new Error("unsupported .prj: only geographic and Lambert Conformal Conic are read");
  const sph = /SPHEROID\["[^"]*",([-0-9.eE+]+),([-0-9.eE+]+)\]/i.exec(w);
  const unit = /UNIT\["[^"]*",([-0-9.eE+]+)\]\]?$/i.exec(w) ?? /PROJECTION.*UNIT\["[^"]*",([-0-9.eE+]+)\]/i.exec(w);
  const need = (n: string) => {
    const v = param(w, n);
    if (v === null) throw new Error(`.prj is missing ${n}`);
    return v;
  };
  if (!sph || !unit) throw new Error(".prj is missing SPHEROID or UNIT");
  return lccInverse({
    a: Number(sph[1]),
    invF: Number(sph[2]),
    lat1: need("Standard_Parallel_1"),
    lat2: need("Standard_Parallel_2"),
    lat0: need("Latitude_Of_Origin"),
    lon0: need("Central_Meridian"),
    falseE: need("False_Easting"),
    falseN: need("False_Northing"),
    unitToMetre: Number(unit[1]),
  });
}

// ── .shp ───────────────────────────────────────────────────────────────────

function signedArea(r: Position[]): number {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return s / 2; // < 0 = clockwise in a y-up plane (shapefile outer ring)
}

function inRing(p: Position, r: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (r[i][1] > p[1] !== r[j][1] > p[1] && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside;
  }
  return inside;
}

/** Polygon records in file order; null for a null shape. */
export function readShpPolygons(buf: Buffer, unproject: Unproject): Array<AreaGeometry | null> {
  const fileType = buf.readInt32LE(32);
  if (![5, 15, 25].includes(fileType)) throw new Error(`shapefile type ${fileType} is not a polygon layer`);
  const out: Array<AreaGeometry | null> = [];
  let o = 100;
  while (o + 8 <= buf.length) {
    const contentBytes = buf.readInt32BE(o + 4) * 2;
    const rec = o + 8;
    const type = buf.readInt32LE(rec);
    if (type === 0) {
      out.push(null);
    } else {
      const numParts = buf.readInt32LE(rec + 36);
      const numPoints = buf.readInt32LE(rec + 40);
      const parts: number[] = [];
      for (let i = 0; i < numParts; i++) parts.push(buf.readInt32LE(rec + 44 + i * 4));
      const ptsBase = rec + 44 + numParts * 4;
      const rings: Position[][] = [];
      for (let i = 0; i < numParts; i++) {
        const end = i + 1 < numParts ? parts[i + 1] : numPoints;
        const ring: Position[] = [];
        for (let k = parts[i]; k < end; k++) ring.push([buf.readDoubleLE(ptsBase + k * 16), buf.readDoubleLE(ptsBase + k * 16 + 8)]);
        rings.push(ring);
      }
      // Shapefile: outer rings clockwise, holes counter-clockwise (in source
      // coordinates). Each hole joins the outer ring that contains it.
      const outers: Position[][][] = [];
      const holes: Position[][] = [];
      for (const r of rings) (signedArea(r) < 0 ? outers.push([r]) : holes.push(r));
      for (const h of holes) {
        const host = outers.find((poly) => inRing(h[0], poly[0]));
        if (host) host.push(h);
        else outers.push([h.slice().reverse()]);
      }
      const proj = outers.map((poly) => poly.map((ring) => ring.map(([x, y]) => unproject(x, y))));
      out.push(proj.length === 1 ? { type: "Polygon", coordinates: proj[0] } : { type: "MultiPolygon", coordinates: proj });
    }
    o = rec + contentBytes;
  }
  return out;
}
