/**
 * Which map sources may be saved for OFFLINE use, and why (W5b).
 *
 * Saving an area for a field visit means fetching every tile of it ahead of
 * time and keeping them on the phone. That is bulk, automated collection, and
 * each source's terms decide whether it is allowed. A source is cached only
 * when its terms ALLOW it; a source whose terms forbid it, or that we have not
 * checked, is refused and the map says so. Read 2026-10-11:
 *
 *   naip     USDA NAIP imagery via USGS The National Map. Federal work, US
 *            public domain ("USGS-authored or produced data and information
 *            are considered to be in the U.S. Public Domain", usgs.gov
 *            copyrights-and-credits). ALLOWED, with attribution.
 *   openfreemap  OpenFreeMap's public tile service (the streets/terrain basemap
 *            and labels). Its terms of service forbid "attempt[ing] to collect
 *            data from the service in automated ways without permission"
 *            (openfreemap.org/tos). REFUSED — prefetching an area is exactly
 *            that. (OpenFreeMap offers full-planet downloads for self-hosting;
 *            a self-hosted copy would be ours to cache. Founder decision.)
 *   terrarium AWS Open Data terrain tiles (Mapzen). Not checked for offline
 *            bulk caching — NOT cached; the offline map has no hillshade.
 *
 * The org's own parcel facts (its properties) are its own records and are
 * saved with the area.
 *
 * Pure; browser-safe. client/src/lib/offline-map-store.ts and client/public/
 * offline-map.js read THIS list; tests/unit/offlineMapSources.test.ts pins
 * that every source the map engine draws from is classified here.
 */

export type OfflinePolicy = "allowed" | "forbidden" | "unchecked";

export interface OfflineMapSource {
  id: string;
  label: string;
  /** Tile URL template ({z}/{x}/{y}); the host is what the service worker matches. */
  tileUrl: string;
  policy: OfflinePolicy;
  attribution: string;
  /** The terms, quoted or cited — shown when a source is refused. */
  terms: string;
  minZoom: number;
  maxZoom: number;
}

export const OFFLINE_MAP_SOURCES: readonly OfflineMapSource[] = [
  {
    id: "naip",
    label: "Satellite imagery (USDA NAIP)",
    tileUrl: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
    policy: "allowed",
    attribution: "Imagery: USDA NAIP via USGS The National Map",
    terms: "US public domain (usgs.gov/information-policies-and-instructions/copyrights-and-credits)",
    minZoom: 0,
    maxZoom: 16,
  },
  {
    id: "openfreemap",
    label: "Street map and labels (OpenFreeMap)",
    tileUrl: "https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf",
    policy: "forbidden",
    attribution: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap",
    terms: "openfreemap.org/tos: users may not \"attempt to collect data from the service in automated ways without permission\"",
    minZoom: 0,
    maxZoom: 14,
  },
  {
    id: "terrarium",
    label: "Terrain (AWS Open Data / Mapzen)",
    tileUrl: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
    policy: "unchecked",
    attribution: "Terrain: Mapzen terrain tiles (USGS 3DEP, SRTM) via AWS Open Data",
    terms: "offline bulk caching not yet checked against the source's terms",
    minZoom: 0,
    maxZoom: 15,
  },
];

/** The hosts the map engine draws from — each must be classified above. */
export function offlineSourceForUrl(url: string): OfflineMapSource | null {
  let host: string;
  try {
    host = new URL(url.replace(/\{[a-z]+\}/g, "0")).host;
  } catch {
    return null;
  }
  return OFFLINE_MAP_SOURCES.find((s) => new URL(s.tileUrl.replace(/\{[a-z]+\}/g, "0")).host === host) ?? null;
}

export function cacheableOfflineSources(): OfflineMapSource[] {
  return OFFLINE_MAP_SOURCES.filter((s) => s.policy === "allowed");
}

/** Hard cap on one saved area, so a phone's storage is never filled by accident. */
export const OFFLINE_AREA_MAX_BYTES = 75 * 1024 * 1024;
export const OFFLINE_AREA_MAX_TILES = 2_500;
/** Parcel facts saved with one area. */
export const OFFLINE_AREA_MAX_PARCELS = 500;

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

function lon2tile(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

function lat2tile(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

/** Every z/x/y covering the box between two zooms, in zoom order. */
export function tilesForBbox(b: Bbox, minZoom: number, maxZoom: number): Array<{ z: number; x: number; y: number }> {
  const out: Array<{ z: number; x: number; y: number }> = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const x0 = lon2tile(b.west, z);
    const x1 = lon2tile(b.east, z);
    const y0 = lat2tile(b.north, z);
    const y1 = lat2tile(b.south, z);
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) out.push({ z, x, y });
    }
  }
  return out;
}

export function tileUrl(template: string, t: { z: number; x: number; y: number }): string {
  return template.replace("{z}", String(t.z)).replace("{x}", String(t.x)).replace("{y}", String(t.y));
}
