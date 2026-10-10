/**
 * GeoParquet writer and loader for the owned parcel-fact dataset.
 *
 * GeoParquet 1.1: a Parquet file whose geometry column is WKB and whose file
 * key-value metadata carries a "geo" JSON document naming the primary column,
 * its encoding and geometry types (CRS omitted = OGC:CRS84, lon/lat WGS84).
 * Written with parquetjs-lite (already a dependency for the cold archive).
 * The loader reads it back and decodes the WKB, which is how the pipeline
 * proves an artifact before anything is uploaded or marked ingested.
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

// ── Rows ───────────────────────────────────────────────────────────────────

export interface OwnedParcelRow {
  parcel_key: string;
  state: string;
  county_fips: string;
  county: string;
  source_parcel_id: string;
  source_name: string;
  retrieved_on: string;
  gis_acres: number;
  deeded_acres: number | null;
  /** The full fact set (values, sources, confidence, method) as JSON. */
  facts_json: string;
  /** Data-truth warnings as JSON. */
  truths_json: string;
  geometry: AreaGeometry;
}

const SCHEMA_DEF = {
  parcel_key: { type: "UTF8" },
  state: { type: "UTF8" },
  county_fips: { type: "UTF8" },
  county: { type: "UTF8" },
  source_parcel_id: { type: "UTF8" },
  source_name: { type: "UTF8" },
  retrieved_on: { type: "UTF8" },
  gis_acres: { type: "DOUBLE" },
  deeded_acres: { type: "DOUBLE", optional: true },
  facts_json: { type: "UTF8" },
  truths_json: { type: "UTF8" },
  geometry: { type: "BYTE_ARRAY" },
} as const;

export function geoMetadata(rows: OwnedParcelRow[]): string {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const types = new Set<string>();
  for (const r of rows) {
    types.add(r.geometry.type);
    const polys = r.geometry.type === "Polygon" ? [r.geometry.coordinates] : r.geometry.coordinates;
    for (const p of polys) for (const ring of p) for (const [x, y] of ring) {
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  return JSON.stringify({
    version: "1.1.0",
    primary_column: "geometry",
    columns: {
      geometry: {
        encoding: "WKB",
        geometry_types: Array.from(types).sort(),
        bbox: rows.length ? [minX, minY, maxX, maxY] : undefined,
      },
    },
  });
}

/** The slice of parquetjs-lite this module uses (the package ships no types). */
interface ParquetLib {
  ParquetSchema: new (def: unknown) => unknown;
  ParquetWriter: {
    openFile(schema: unknown, path: string): Promise<{ setMetadata(k: string, v: string): void; appendRow(r: unknown): Promise<void>; close(): Promise<void> }>;
  };
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

export async function writeGeoParquet(filePath: string, rows: OwnedParcelRow[]): Promise<void> {
  const parquet = await parquetLib();
  const schema = new parquet.ParquetSchema(SCHEMA_DEF);
  const writer = await parquet.ParquetWriter.openFile(schema, filePath);
  writer.setMetadata("geo", geoMetadata(rows));
  for (const r of rows) {
    await writer.appendRow({ ...r, deeded_acres: r.deeded_acres ?? undefined, geometry: encodeWkb(r.geometry) });
  }
  await writer.close();
}

export interface LoadedGeoParquet {
  geo: { version: string; primary_column: string; columns: Record<string, { encoding: string; geometry_types: string[] }> };
  rows: OwnedParcelRow[];
}

/** The loader: reads every row back and decodes the geometry. */
export async function readGeoParquet(filePath: string): Promise<LoadedGeoParquet> {
  const parquet = await parquetLib();
  const reader = await parquet.ParquetReader.openFile(filePath);
  const meta = reader.getMetadata();
  if (!meta.geo) throw new Error("not a GeoParquet file: no 'geo' metadata");
  const geo = JSON.parse(meta.geo);
  const cursor = reader.getCursor();
  const rows: OwnedParcelRow[] = [];
  for (let rec = await cursor.next(); rec; rec = await cursor.next()) {
    const r = rec as unknown as Omit<OwnedParcelRow, "geometry"> & { geometry: Uint8Array };
    rows.push({ ...r, deeded_acres: r.deeded_acres ?? null, geometry: decodeWkb(Buffer.from(r.geometry)) });
  }
  await reader.close();
  return { geo, rows };
}
