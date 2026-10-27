/**
 * Bounded-memory bulk artifacts — D2a (the D1 live-proof finding, 2026-10-23).
 *
 * The D1 FL build held a whole county in memory twice over: every normalized
 * record in an array, then every GeoParquet row and a GeoJSON
 * FeatureCollection for the tiler. Nassau County FL was OOM-killed on the 1 GB
 * staging APP machine (node RSS ~505 MB) for exactly that reason.
 *
 * This writer never holds a county. A record is written as it arrives:
 *   - GeoParquet: appended to an open parquetjs-lite writer, which buffers
 *     one row group (ROW_GROUP rows) and flushes it; the geo bbox and
 *     geometry types are folded in incrementally and set at close.
 *   - PMTiles: the record's tile feature is SPILLED to an NDJSON file per
 *     partition (the tile at PARTITION_ZOOM the feature's bbox touches). At
 *     finish, partitions are tiled one at a time — every tile at zoom >=
 *     PARTITION_ZOOM is a descendant of exactly one partition tile, so a
 *     partition's tiles depend on that partition's features only — and each
 *     tile's bytes go to a temp file, never kept. The archive is assembled
 *     from the temp file in tile-id order (clustered).
 *
 * Peak memory is therefore one row group + one partition's features + the
 * tile directory, independent of county size. A partition denser than
 * MAX_PARTITION_FEATURES is REFUSED (an explicit error naming the tile) rather
 * than left to grow the heap — the refusal is the bound.
 *
 * Every artifact's receipt (bytes + SHA-256) is computed by streaming the
 * file, never by reading it whole.
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { zxyToTileId } from "pmtiles";
import type { AreaGeometry, Position } from "./geometry";
import { encodeWkb, type ParquetColumnDef } from "./geoParquet";

/**
 * Tiles below this zoom are not built for bulk layers: a parcel is a few
 * pixels there. It is also the partition grain: a z14 tile is ~2.4 km at the
 * equator, so even dense suburban fabric stays well under the cap.
 */
const PARTITION_ZOOM = 14;
export const MAX_ZOOM = 15;
/** A partition denser than this is refused, not tiled — the refusal is the memory bound. */
const MAX_PARTITION_FEATURES = 30_000;
const ROW_GROUP = 2_000;

export interface StreamingArtifactOptions {
  outDir: string;
  /** File stem, e.g. "nc-wake". */
  stem: string;
  schemaDef: Record<string, ParquetColumnDef>;
  layerName: string;
  tileName: string;
  tileDescription: string;
  attribution: string;
  /** Override for tests; defaults to MAX_PARTITION_FEATURES. */
  maxPartitionFeatures?: number;
}

export interface BuiltArtifact {
  localPath: string;
  bytes: number;
  sha256: string;
  contentType: string;
}

export interface StreamingArtifactResult {
  parquet: BuiltArtifact;
  pmtiles: BuiltArtifact;
  rowsWritten: number;
  rowsReadBack: number;
  tileCount: number;
  partitions: number;
  maxPartitionFeatures: number;
  bbox: [number, number, number, number];
}

interface ParquetWriterLike {
  setMetadata(k: string, v: string): void;
  appendRow(r: unknown): Promise<void>;
  close(): Promise<void>;
  setRowGroupSize?(n: number): void;
}

interface ParquetLib {
  ParquetSchema: new (def: unknown) => unknown;
  ParquetWriter: { openFile(schema: unknown, p: string, opts?: unknown): Promise<ParquetWriterLike> };
  ParquetReader: {
    openFile(p: string): Promise<{ getMetadata(): Record<string, string>; getCursor(): { next(): Promise<unknown> }; close(): Promise<void> }>;
  };
}

async function parquetLib(): Promise<ParquetLib> {
  const mod = (await import("parquetjs-lite")) as { default?: ParquetLib } & ParquetLib;
  return mod.default ?? mod;
}

function lon2x(lon: number, z: number) {
  return Math.min(2 ** z - 1, Math.max(0, Math.floor(((lon + 180) / 360) * 2 ** z)));
}
function lat2y(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return Math.min(2 ** z - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)));
}

function geometryBbox(g: AreaGeometry): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const polys: Position[][][] = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for (const p of polys) for (const ring of p) for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/** Bytes + SHA-256 of a file, streamed. */
export async function fileDigest(p: string): Promise<{ bytes: number; sha256: string }> {
  const h = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(p)
      .on("data", (c) => h.update(c))
      .on("end", () => resolve())
      .on("error", reject);
  });
  return { bytes: statSync(p).size, sha256: h.digest("hex") };
}

/**
 * Write rows as they arrive; finish() returns the two artifacts. Use exactly
 * once: open() → write()* → finish(). discard() removes everything on failure.
 */
export class StreamingArtifactWriter<R extends { geometry: AreaGeometry }> {
  private writer: ParquetWriterLike | null = null;
  private readonly spillDir: string;
  private readonly partitions = new Map<string, { fd: number; count: number }>();
  private readonly types = new Set<string>();
  private bbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  private rows = 0;
  private readonly cap: number;

  constructor(private readonly opts: StreamingArtifactOptions, private readonly tileProps: (row: R) => Record<string, unknown>) {
    this.spillDir = path.join(opts.outDir, `.${opts.stem}-spill`);
    this.cap = opts.maxPartitionFeatures ?? MAX_PARTITION_FEATURES;
  }

  get parquetPath() {
    return path.join(this.opts.outDir, `${this.opts.stem}.parquet`);
  }
  get pmtilesPath() {
    return path.join(this.opts.outDir, `${this.opts.stem}.pmtiles`);
  }

  async open(): Promise<void> {
    mkdirSync(this.opts.outDir, { recursive: true });
    mkdirSync(this.spillDir, { recursive: true });
    const parquet = await parquetLib();
    this.writer = await parquet.ParquetWriter.openFile(new parquet.ParquetSchema(this.opts.schemaDef), this.parquetPath, { rowGroupSize: ROW_GROUP });
  }

  async write(row: R): Promise<void> {
    if (!this.writer) throw new Error("StreamingArtifactWriter.write before open()");
    const cells: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) cells[k] = v === null ? undefined : v;
    await this.writer.appendRow({ ...cells, geometry: encodeWkb(row.geometry) });
    this.rows += 1;
    this.types.add(row.geometry.type);
    const [minX, minY, maxX, maxY] = geometryBbox(row.geometry);
    const b = this.bbox;
    this.bbox = [Math.min(b[0], minX), Math.min(b[1], minY), Math.max(b[2], maxX), Math.max(b[3], maxY)];
    const line = `${JSON.stringify({ type: "Feature", geometry: row.geometry, properties: this.tileProps(row) })}\n`;
    const z = PARTITION_ZOOM;
    for (let x = lon2x(minX, z); x <= lon2x(maxX, z); x++) {
      for (let y = lat2y(maxY, z); y <= lat2y(minY, z); y++) {
        const key = `${x}_${y}`;
        let part = this.partitions.get(key);
        if (!part) {
          part = { fd: openSync(path.join(this.spillDir, `${key}.ndjson`), "a"), count: 0 };
          this.partitions.set(key, part);
        }
        part.count += 1;
        if (part.count > this.cap) {
          throw new Error(
            `refused: z${z} tile ${x}/${y} holds more than ${this.cap} parcels — too dense to tile within the memory bound; raise PARTITION_ZOOM for this source rather than the cap`,
          );
        }
        writeSync(part.fd, line);
      }
    }
  }

  async finish(): Promise<StreamingArtifactResult> {
    if (!this.writer) throw new Error("StreamingArtifactWriter.finish before open()");
    if (this.rows === 0) throw new Error("no parcels with geometry — refusing to emit empty artifacts");
    this.writer.setMetadata(
      "geo",
      JSON.stringify({
        version: "1.1.0",
        primary_column: "geometry",
        columns: { geometry: { encoding: "WKB", geometry_types: Array.from(this.types).sort(), bbox: this.bbox } },
      }),
    );
    await this.writer.close();
    this.writer = null;
    for (const p of Array.from(this.partitions.values())) closeSync(p.fd);

    // Loader proof before any receipt: stream every row back, keeping a count only.
    const parquet = await parquetLib();
    const reader = await parquet.ParquetReader.openFile(this.parquetPath);
    if (!reader.getMetadata().geo) throw new Error("GeoParquet written without 'geo' metadata");
    let readBack = 0;
    const cursor = reader.getCursor();
    while (await cursor.next()) readBack += 1;
    await reader.close();
    if (readBack !== this.rows) throw new Error(`GeoParquet round-trip lost rows: ${readBack} != ${this.rows}`);

    const tiles = await this.buildTiles();
    rmSync(this.spillDir, { recursive: true, force: true });
    const pq = await fileDigest(this.parquetPath);
    const pm = await fileDigest(this.pmtilesPath);
    let maxPart = 0;
    for (const p of Array.from(this.partitions.values())) maxPart = Math.max(maxPart, p.count);
    return {
      parquet: { localPath: this.parquetPath, ...pq, contentType: "application/vnd.apache.parquet" },
      pmtiles: { localPath: this.pmtilesPath, ...pm, contentType: "application/vnd.pmtiles" },
      rowsWritten: this.rows,
      rowsReadBack: readBack,
      tileCount: tiles,
      partitions: this.partitions.size,
      maxPartitionFeatures: maxPart,
      bbox: this.bbox,
    };
  }

  discard(): void {
    for (const p of Array.from(this.partitions.values())) {
      try {
        closeSync(p.fd);
      } catch {
        /* already closed */
      }
    }
    rmSync(this.spillDir, { recursive: true, force: true });
    for (const f of [this.parquetPath, this.pmtilesPath]) if (existsSync(f)) rmSync(f, { force: true });
  }

  /** Tile one partition at a time; tile bytes go to a temp file; returns the tile count. */
  private async buildTiles(): Promise<number> {
    const { GeoJSONVT } = await import("@maplibre/geojson-vt");
    const { fromGeojsonVt } = await import("@maplibre/vt-pbf");
    const dataPath = path.join(this.spillDir, "tiles.bin");
    const dataFd = openSync(dataPath, "w");
    const entries: Array<{ tileId: number; offset: number; length: number }> = [];
    let offset = 0;
    try {
      for (const key of Array.from(this.partitions.keys()).sort()) {
        const [px, py] = key.split("_").map(Number);
        const text = readFileSync(path.join(this.spillDir, `${key}.ndjson`), "utf8");
        const features = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
        const index = new GeoJSONVT({ type: "FeatureCollection", features } as unknown as GeoJSON.FeatureCollection, {
          maxZoom: MAX_ZOOM,
          indexMaxZoom: MAX_ZOOM,
          tolerance: 3,
          extent: 4096,
          buffer: 64,
        });
        for (let z = PARTITION_ZOOM; z <= MAX_ZOOM; z++) {
          const span = 2 ** (z - PARTITION_ZOOM);
          for (let x = px * span; x < (px + 1) * span; x++) {
            for (let y = py * span; y < (py + 1) * span; y++) {
              const t = index.getTile(z, x, y);
              if (!t || t.features.length === 0) continue;
              const pbf = fromGeojsonVt({ [this.opts.layerName]: t } as unknown as Parameters<typeof fromGeojsonVt>[0], { version: 2, extent: 4096 });
              const gz = gzipSync(Buffer.from(pbf));
              writeSync(dataFd, gz);
              entries.push({ tileId: zxyToTileId(z, x, y), offset, length: gz.length });
              offset += gz.length;
            }
          }
        }
      }
    } finally {
      closeSync(dataFd);
    }
    if (entries.length === 0) throw new Error("refusing to build an empty PMTiles archive");
    entries.sort((a, b) => a.tileId - b.tileId);
    writePmtilesArchive(this.pmtilesPath, dataPath, entries, {
      layerName: this.opts.layerName,
      name: this.opts.tileName,
      description: this.opts.tileDescription,
      attribution: this.opts.attribution,
      bbox: this.bbox,
    });
    return entries.length;
  }
}

// ── PMTiles v3 archive assembly (spec: protomaps/PMTiles spec/v3) ─────────

function writeVarint(out: number[], n: number): void {
  let v = n;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

interface DirEntry { tileId: number; offset: number; length: number; runLength: number }

function serializeDirectory(entries: DirEntry[]): Buffer {
  const out: number[] = [];
  writeVarint(out, entries.length);
  let last = 0;
  for (const e of entries) { writeVarint(out, e.tileId - last); last = e.tileId; }
  for (const e of entries) writeVarint(out, e.runLength);
  for (const e of entries) writeVarint(out, e.length);
  entries.forEach((e, i) => {
    if (i > 0 && e.offset === entries[i - 1].offset + entries[i - 1].length) writeVarint(out, 0);
    else writeVarint(out, e.offset + 1);
  });
  return gzipSync(Buffer.from(out));
}

/**
 * Lay the archive out clustered: tile data in tile-id order, read one tile at a
 * time from the unordered temp file (memory = one tile + the directory).
 */
function writePmtilesArchive(
  outPath: string,
  dataPath: string,
  sorted: Array<{ tileId: number; offset: number; length: number }>,
  meta: { layerName: string; name: string; description: string; attribution: string; bbox: [number, number, number, number] },
): void {
  const entries: DirEntry[] = [];
  let off = 0;
  for (const t of sorted) {
    entries.push({ tileId: t.tileId, offset: off, length: t.length, runLength: 1 });
    off += t.length;
  }
  const HEADER = 127;
  let root = serializeDirectory(entries);
  let leaves = Buffer.alloc(0);
  if (HEADER + root.length > 16_384) {
    const LEAF = 4096;
    const leafBufs: Buffer[] = [];
    const rootEntries: DirEntry[] = [];
    let leafOffset = 0;
    for (let i = 0; i < entries.length; i += LEAF) {
      const chunk = entries.slice(i, i + LEAF);
      const buf = serializeDirectory(chunk);
      rootEntries.push({ tileId: chunk[0].tileId, offset: leafOffset, length: buf.length, runLength: 0 });
      leafBufs.push(buf);
      leafOffset += buf.length;
    }
    root = serializeDirectory(rootEntries);
    leaves = Buffer.concat(leafBufs);
    if (HEADER + root.length > 16_384) throw new Error("PMTiles root directory too large even with leaves");
  }
  const metadata = gzipSync(
    Buffer.from(
      JSON.stringify({
        name: meta.name,
        description: meta.description,
        attribution: meta.attribution,
        vector_layers: [{ id: meta.layerName, minzoom: PARTITION_ZOOM, maxzoom: MAX_ZOOM, fields: {} }],
      }),
    ),
  );
  const [minX, minY, maxX, maxY] = meta.bbox;
  const rootOff = HEADER;
  const metaOff = rootOff + root.length;
  const leafOff = metaOff + metadata.length;
  const dataOff = leafOff + leaves.length;
  const h = Buffer.alloc(HEADER);
  h.write("PMTiles", 0, "ascii");
  h.writeUInt8(3, 7);
  const u64 = (pos: number, v: number) => h.writeBigUInt64LE(BigInt(v), pos);
  u64(8, rootOff); u64(16, root.length);
  u64(24, metaOff); u64(32, metadata.length);
  u64(40, leafOff); u64(48, leaves.length);
  u64(56, dataOff); u64(64, off);
  u64(72, entries.length); u64(80, entries.length); u64(88, entries.length);
  h.writeUInt8(1, 96); // clustered
  h.writeUInt8(2, 97); // internal compression: gzip
  h.writeUInt8(2, 98); // tile compression: gzip
  h.writeUInt8(1, 99); // tile type: MVT
  h.writeUInt8(PARTITION_ZOOM, 100);
  h.writeUInt8(MAX_ZOOM, 101);
  const e7 = (v: number) => Math.round(v * 1e7);
  h.writeInt32LE(e7(minX), 102); h.writeInt32LE(e7(minY), 106);
  h.writeInt32LE(e7(maxX), 110); h.writeInt32LE(e7(maxY), 114);
  h.writeUInt8(PARTITION_ZOOM, 118);
  h.writeInt32LE(e7((minX + maxX) / 2), 119); h.writeInt32LE(e7((minY + maxY) / 2), 123);

  const out = openSync(outPath, "w");
  const src = openSync(dataPath, "r");
  try {
    writeSync(out, h);
    writeSync(out, root);
    writeSync(out, metadata);
    writeSync(out, leaves);
    for (const t of sorted) {
      const buf = Buffer.alloc(t.length);
      readSync(src, buf, 0, t.length, t.offset);
      writeSync(out, buf);
    }
  } finally {
    closeSync(src);
    closeSync(out);
  }
}
