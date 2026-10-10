/**
 * Slope from USGS 3DEP — range reads of the public 1/3 arc-second COGs.
 *
 * 3DEP publishes seamless 1/3 arc-second (~10 m) elevation as 1°×1° Cloud
 * Optimized GeoTIFFs on the TNM staged-products bucket (public, no requester
 * pays, public domain). A parcel needs a few kilobytes of one tile, so we read
 * only the window covering it with HTTP range requests (geotiff.js), never the
 * whole ~300 MB tile.
 *
 * Slope uses Horn's 3×3 method on the window, with the cell size converted to
 * metres at the window's latitude.
 */

import type { FactSource } from "@shared/landData/parcelFacts";
import type { SlopeSampler } from "./computeParcelFacts";

export const THREEDEP_13_BASE =
  "https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current";

/** The 1°×1° tile name holding a point: named for its NORTH-WEST corner. */
export function threeDepTileFor(lng: number, lat: number): string {
  const n = Math.floor(lat) + 1;
  const w = Math.floor(-lng) + 1;
  const ns = n >= 0 ? `n${String(n).padStart(2, "0")}` : `s${String(-n).padStart(2, "0")}`;
  const ew = lng < 0 ? `w${String(w).padStart(3, "0")}` : `e${String(Math.floor(lng)).padStart(3, "0")}`;
  return `${ns}${ew}`;
}

export function threeDepTileUrl(tile: string): string {
  return `${THREEDEP_13_BASE}/${tile}/USGS_13_${tile}.tif`;
}

/** A north-up elevation window in geographic coordinates. */
export interface ElevationGrid {
  width: number;
  height: number;
  /** Longitude of the west edge of column 0. */
  west: number;
  /** Latitude of the north edge of row 0. */
  north: number;
  /** Degrees per pixel (positive). */
  resLng: number;
  resLat: number;
  /** Row-major elevations in metres. */
  data: ArrayLike<number>;
  noData: number | null;
}

const R = 6_371_008.8;
const DEG = Math.PI / 180;

/** Horn slope (percent) at a grid cell; null at the edge or on no-data. */
export function hornSlopePct(g: ElevationGrid, col: number, row: number): number | null {
  if (col < 1 || row < 1 || col >= g.width - 1 || row >= g.height - 1) return null;
  const z = (c: number, r: number) => g.data[r * g.width + c];
  const vals: number[] = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) vals.push(z(col + dc, row + dr));
  if (vals.some((v) => !Number.isFinite(v) || (g.noData !== null && v === g.noData) || v < -1000)) return null;
  const [a, b, c, d, , f, gg, h, i] = vals;
  const lat = g.north - (row + 0.5) * g.resLat;
  const cellX = g.resLng * DEG * R * Math.cos(lat * DEG);
  const cellY = g.resLat * DEG * R;
  const dzdx = (c + 2 * f + i - (a + 2 * d + gg)) / (8 * cellX);
  const dzdy = (gg + 2 * h + i - (a + 2 * b + c)) / (8 * cellY);
  return 100 * Math.sqrt(dzdx * dzdx + dzdy * dzdy);
}

export function elevationAt(g: ElevationGrid, lng: number, lat: number): number | null {
  const col = Math.floor((lng - g.west) / g.resLng);
  const row = Math.floor((g.north - lat) / g.resLat);
  if (col < 0 || row < 0 || col >= g.width || row >= g.height) return null;
  const v = g.data[row * g.width + col];
  if (!Number.isFinite(v) || (g.noData !== null && v === g.noData) || v < -1000) return null;
  return v;
}

export function slopeSamplerFromGrids(grids: ElevationGrid[], source: FactSource): SlopeSampler {
  return {
    source,
    slopePctAt(lng, lat) {
      // A point on a window's outer row/column has no 3×3 neighbourhood
      // there; the neighbouring tile's window may still cover it.
      for (const g of grids) {
        const col = Math.floor((lng - g.west) / g.resLng);
        const row = Math.floor((g.north - lat) / g.resLat);
        if (col < 0 || row < 0 || col >= g.width || row >= g.height) continue;
        const s = hornSlopePct(g, col, row);
        if (s !== null) return s;
      }
      return null;
    },
  };
}

/**
 * Read the elevation window covering a WGS84 bbox (plus a 2-cell margin so
 * Horn slope is defined at the edge) from every 3DEP tile it touches.
 * Network I/O via geotiff.js range requests; throws on a read failure so the
 * caller can mark the dependent facts unavailable.
 */
export async function readThreeDepWindows(
  bbox: [number, number, number, number],
  opts: { urlFor?: (tile: string) => string } = {},
): Promise<ElevationGrid[]> {
  const { fromUrl } = await import("geotiff");
  const urlFor = opts.urlFor ?? threeDepTileUrl;
  const tiles = new Set<string>();
  for (const lng of [bbox[0], bbox[2]]) for (const lat of [bbox[1], bbox[3]]) tiles.add(threeDepTileFor(lng, lat));
  const out: ElevationGrid[] = [];
  for (const tile of Array.from(tiles)) {
    const tiff = await fromUrl(urlFor(tile));
    const image = await tiff.getImage();
    const [west0, south0, east0, north0] = image.getBoundingBox();
    const W = image.getWidth();
    const H = image.getHeight();
    const resLng = (east0 - west0) / W;
    const resLat = (north0 - south0) / H;
    const c0 = Math.max(0, Math.floor((bbox[0] - west0) / resLng) - 2);
    const c1 = Math.min(W, Math.ceil((bbox[2] - west0) / resLng) + 2);
    const r0 = Math.max(0, Math.floor((north0 - bbox[3]) / resLat) - 2);
    const r1 = Math.min(H, Math.ceil((north0 - bbox[1]) / resLat) + 2);
    if (c1 <= c0 || r1 <= r0) continue;
    const rasters = await image.readRasters({ window: [c0, r0, c1, r1], samples: [0] });
    const band = (rasters as unknown as ArrayLike<number>[])[0];
    const nd = image.getGDALNoData();
    out.push({
      width: c1 - c0,
      height: r1 - r0,
      west: west0 + c0 * resLng,
      north: north0 - r0 * resLat,
      resLng,
      resLat,
      data: Float32Array.from(band as ArrayLike<number>),
      noData: nd === null || nd === undefined ? null : Number(nd),
    });
  }
  return out;
}
