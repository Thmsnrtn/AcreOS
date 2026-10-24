/**
 * GeoParquet primitives for the owned parcel artifacts.
 *
 * GeoParquet 1.1: a Parquet file whose geometry column is WKB and whose file
 * key-value metadata carries a "geo" JSON document naming the primary column,
 * its encoding and geometry types (CRS omitted = OGC:CRS84, lon/lat WGS84).
 * Files are WRITTEN by StreamingArtifactWriter (streamingArtifacts.ts, bounded
 * memory, parquetjs-lite); this module holds the WKB codec, the column type and
 * the read-back the tests and the TN build use to prove an artifact. (The
 * whole-county in-memory writer/loader was retired in D2a.)
 */

import type { AreaGeometry, Position } from "./geometry";

// ── WKB (little-endian) ────────────────────────────────────────────────────

function ringsByteLength(rings: Position[][]): number {
  return 4 + rings.reduce((n, r) => n + 4 + r.length * 16, 0);
}

export function encodeWkb(g: AreaGeometry): Buffer {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  const size = g.type === "Polygon" ? 5 + ringsByteLength(polys[0]) : 9 + polys.reduce((n, p) => n + 5 + ringsByteLength(p), 0);
  const buf = Buffer.alloc(size);
  let o = 0;
  const writePoly = (rings: Position[][]) => {
    buf.writeUInt8(1, o); o += 1;
    buf.writeUInt32LE(3, o); o += 4;
    buf.writeUInt32LE(rings.length, o); o += 4;
    for (const ring of rings) {
      buf.writeUInt32LE(ring.length, o); o += 4;
      for (const [x, y] of ring) {
        buf.writeDoubleLE(x, o); o += 8;
        buf.writeDoubleLE(y, o); o += 8;
      }
    }
  };
  if (g.type === "Polygon") writePoly(polys[0]);
  else {
    buf.writeUInt8(1, o); o += 1;
    buf.writeUInt32LE(6, o); o += 4;
    buf.writeUInt32LE(polys.length, o); o += 4;
    for (const p of polys) writePoly(p);
  }
  return buf;
}

export function decodeWkb(buf: Buffer): AreaGeometry {
  let o = 0;
  const readPoly = (): Position[][] => {
    const le = buf.readUInt8(o) === 1; o += 1;
    if (!le) throw new Error("big-endian WKB not supported");
    const t = buf.readUInt32LE(o); o += 4;
    if (t !== 3) throw new Error(`expected WKB Polygon, got type ${t}`);
    const nr = buf.readUInt32LE(o); o += 4;
    const rings: Position[][] = [];
    for (let r = 0; r < nr; r++) {
      const np = buf.readUInt32LE(o); o += 4;
      const ring: Position[] = [];
      for (let i = 0; i < np; i++) {
        ring.push([buf.readDoubleLE(o), buf.readDoubleLE(o + 8)]);
        o += 16;
      }
      rings.push(ring);
    }
    return rings;
  };
  const t = buf.readUInt32LE(1);
  if (t === 3) return { type: "Polygon", coordinates: readPoly() };
  if (t === 6) {
    o = 5;
    const n = buf.readUInt32LE(o); o += 4;
    const polys: Position[][][] = [];
    for (let i = 0; i < n; i++) polys.push(readPoly());
    return { type: "MultiPolygon", coordinates: polys };
  }
  throw new Error(`unsupported WKB geometry type ${t}`);
}

/** The slice of parquetjs-lite this module uses (the package ships no types). */
interface ParquetLib {
  ParquetReader: {
    openFile(path: string): Promise<{
      getMetadata(): Record<string, string>;
      getCursor(): { next(): Promise<Record<string, unknown> | null> };
      close(): Promise<void>;
    }>;
  };
}

async function parquetLib(): Promise<ParquetLib> {
  const mod = (await import("parquetjs-lite")) as { default?: ParquetLib } & ParquetLib;
  return mod.default ?? mod;
}

/** A parquetjs-lite column definition (the subset the writers use). */
export type ParquetColumnDef = { type: "UTF8" | "DOUBLE" | "BYTE_ARRAY"; optional?: boolean };

/** The GeoParquet 1.1 "geo" metadata document. */
export interface GeoParquetMeta {
  version: string;
  primary_column: string;
  columns: Record<string, { encoding: string; geometry_types: string[] }>;
}

/** Read a GeoParquet file (as StreamingArtifactWriter writes it); absent cells come back undefined. */
export async function readGeoParquetRows<R extends { geometry: AreaGeometry }>(
  filePath: string,
): Promise<{ geo: GeoParquetMeta; rows: R[] }> {
  const parquet = await parquetLib();
  const reader = await parquet.ParquetReader.openFile(filePath);
  const meta = reader.getMetadata();
  if (!meta.geo) throw new Error("not a GeoParquet file: no 'geo' metadata");
  const geo = JSON.parse(meta.geo);
  const cursor = reader.getCursor();
  const rows: R[] = [];
  for (let rec = await cursor.next(); rec; rec = await cursor.next()) {
    const r = rec as unknown as Omit<R, "geometry"> & { geometry: Uint8Array };
    rows.push({ ...r, geometry: decodeWkb(Buffer.from(r.geometry)) } as unknown as R);
  }
  await reader.close();
  return { geo, rows };
}
