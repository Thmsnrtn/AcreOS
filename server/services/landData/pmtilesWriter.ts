/**
 * PMTiles v3 writer for the owned parcel layer.
 *
 * Cuts a GeoJSON FeatureCollection into Mapbox Vector Tiles with MapLibre's
 * own geojson-vt + vt-pbf (the same code the map renderer uses), gzips each
 * tile, and lays them out as a single clustered PMTiles v3 archive: a 127-byte
 * header, a gzipped root directory (plus leaf directories when the root would
 * not fit in the first 16 KiB), JSON metadata, then tile data in tile-id order.
 * Spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
 *
 * The reader half of the proof is the `pmtiles` package itself (the same one
 * the client uses to display the archive), exercised by the showcase build
 * and its test.
 */

import { gzipSync } from "node:zlib";
import { zxyToTileId } from "pmtiles";

export interface PmtilesBuildOptions {
  layerName: string;
  minZoom: number;
  maxZoom: number;
  attribution: string;
  name: string;
  description: string;
}

interface Entry { tileId: number; offset: number; length: number; runLength: number }

function writeVarint(out: number[], n: number): void {
  let v = n;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

function serializeDirectory(entries: Entry[]): Buffer {
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

function lon2x(lon: number, z: number) { return Math.floor(((lon + 180) / 360) * 2 ** z); }
function lat2y(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

export interface PmtilesResult { bytes: Buffer; tileCount: number; bbox: [number, number, number, number] }

export async function buildPmtiles(
  fc: { type: "FeatureCollection"; features: Array<{ type: "Feature"; geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }> },
  opts: PmtilesBuildOptions,
): Promise<PmtilesResult> {
  const { GeoJSONVT } = await import("@maplibre/geojson-vt");
  const { fromGeojsonVt } = await import("@maplibre/vt-pbf");

  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  const walk = (c: unknown) => {
    const arr = c as unknown[];
    if (typeof arr[0] === "number") {
      const [x, y] = arr as number[];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    } else arr.forEach(walk);
  };
  for (const f of fc.features) walk(f.geometry.coordinates);
  if (fc.features.length === 0) throw new Error("refusing to build an empty PMTiles archive");

  const index = new GeoJSONVT(fc as unknown as GeoJSON.FeatureCollection, { maxZoom: opts.maxZoom, indexMaxZoom: opts.maxZoom, tolerance: 3, extent: 4096, buffer: 64 });
  const tiles: Array<{ tileId: number; data: Buffer }> = [];
  for (let z = opts.minZoom; z <= opts.maxZoom; z++) {
    for (let x = lon2x(minX, z); x <= lon2x(maxX, z); x++) {
      for (let y = lat2y(maxY, z); y <= lat2y(minY, z); y++) {
        const t = index.getTile(z, x, y);
        if (!t || t.features.length === 0) continue;
        const pbf = fromGeojsonVt({ [opts.layerName]: t } as unknown as Parameters<typeof fromGeojsonVt>[0], { version: 2, extent: 4096 });
        tiles.push({ tileId: zxyToTileId(z, x, y), data: gzipSync(Buffer.from(pbf)) });
      }
    }
  }
  tiles.sort((a, b) => a.tileId - b.tileId);

  const entries: Entry[] = [];
  let offset = 0;
  for (const t of tiles) {
    entries.push({ tileId: t.tileId, offset, length: t.data.length, runLength: 1 });
    offset += t.data.length;
  }
  const tileData = Buffer.concat(tiles.map((t) => t.data));

  // Root directory, or root → leaves when the root would overflow 16 KiB.
  const HEADER = 127;
  let root = serializeDirectory(entries);
  let leaves = Buffer.alloc(0);
  if (HEADER + root.length > 16_384) {
    const LEAF = 4096;
    const leafBufs: Buffer[] = [];
    const rootEntries: Entry[] = [];
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
        name: opts.name,
        description: opts.description,
        attribution: opts.attribution,
        vector_layers: [{ id: opts.layerName, minzoom: opts.minZoom, maxzoom: opts.maxZoom, fields: {} }],
      }),
    ),
  );

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
  u64(56, dataOff); u64(64, tileData.length);
  u64(72, tiles.length); u64(80, entries.length); u64(88, tiles.length);
  h.writeUInt8(1, 96); // clustered
  h.writeUInt8(2, 97); // internal compression: gzip
  h.writeUInt8(2, 98); // tile compression: gzip
  h.writeUInt8(1, 99); // tile type: MVT
  h.writeUInt8(opts.minZoom, 100);
  h.writeUInt8(opts.maxZoom, 101);
  const e7 = (v: number) => Math.round(v * 1e7);
  h.writeInt32LE(e7(minX), 102); h.writeInt32LE(e7(minY), 106);
  h.writeInt32LE(e7(maxX), 110); h.writeInt32LE(e7(maxY), 114);
  h.writeUInt8(Math.min(opts.maxZoom, Math.max(opts.minZoom, 12)), 118);
  h.writeInt32LE(e7((minX + maxX) / 2), 119); h.writeInt32LE(e7((minY + maxY) / 2), 123);

  return { bytes: Buffer.concat([h, root, metadata, leaves, tileData]), tileCount: tiles.length, bbox: [minX, minY, maxX, maxY] };
}
