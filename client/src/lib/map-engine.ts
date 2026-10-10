/**
 * Map engine — MapLibre GL with free, open basemaps (W2 task 6, 2026-10-10).
 *
 * Mapbox was removed as the renderer: every map now renders without a token
 * and without a per-load bill.
 *
 *   streets  — OpenFreeMap "liberty" (OpenMapTiles schema, OSM data, ODbL;
 *              attribution carried by the style).
 *   terrain  — OpenFreeMap "liberty" + hillshade from the terrain DEM.
 *   satellite — USDA NAIP imagery served by USGS The National Map
 *              (USGSImageryOnly cached tiles; public domain) with
 *              OpenFreeMap labels on top.
 *   DEM      — AWS Open Data terrain tiles (Mapzen terrarium encoding; built
 *              from USGS 3DEP, SRTM and others) for 3D terrain, hillshade,
 *              slope shading and client-side contours (maplibre-contour).
 *
 * History: a MapLibre preview engine lived here until W10.1b (2026-10-01) and
 * was removed because its Stadia styles were non-commercial, two maps were
 * hardwired to mapbox:// sources, and maplibre-gl 4.x carried the repo's one
 * critical advisory. This engine fixes all three: open-licence styles, no
 * mapbox:// URL anywhere (pinned by tests/unit/mapEngineMapLibre.test.ts),
 * and maplibre-gl 6.11.1 (no advisory at install, 2026-10-10).
 */

import * as maplibregl from "maplibre-gl";
import type { StyleSpecification, Map as MapLibreMap, RasterDEMSourceSpecification } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

// maplibre-gl 6 looks for its worker beside its own module
// (new URL("./maplibre-gl-worker.mjs", import.meta.url)). Vite never emits
// that file, so in a production build the request 404s, "Worker failed to
// load", and no vector tile or GeoJSON is ever parsed — every map is blank.
// Hand MapLibre a worker Vite bundled itself. Every file that builds a map
// imports this module, so this runs before the first Map exists.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

export { maplibregl };

export type MapStyleName = "satellite" | "terrain" | "streets";

const OPENFREEMAP_LIBERTY = "https://tiles.openfreemap.org/styles/liberty";
const OPENFREEMAP_GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
export const NAIP_TILE_URL =
  "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}";
export const NAIP_ATTRIBUTION = "Imagery: USDA NAIP via USGS The National Map";
export const TERRAIN_DEM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const TERRAIN_ATTRIBUTION = "Terrain: Mapzen terrain tiles (USGS 3DEP, SRTM) via AWS Open Data";

/** Font stack available on the OpenFreeMap glyph server (all styles use it). */
export const LABEL_FONT = ["Noto Sans Regular"];
export const LABEL_FONT_ITALIC = ["Noto Sans Italic"];

/** One shared DEM source id, used for 3D terrain, hillshade and slope. */
export const DEM_SOURCE_ID = "terrain-dem";

export function demSourceSpec(): RasterDEMSourceSpecification {
  return {
    type: "raster-dem",
    tiles: [TERRAIN_DEM_URL],
    encoding: "terrarium",
    tileSize: 256,
    maxzoom: 15,
    attribution: TERRAIN_ATTRIBUTION,
  };
}

export function satelliteStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: OPENFREEMAP_GLYPHS,
    sources: {
      naip: {
        type: "raster",
        tiles: [NAIP_TILE_URL],
        tileSize: 256,
        maxzoom: 16,
        attribution: NAIP_ATTRIBUTION,
      },
    },
    layers: [{ id: "naip-imagery", type: "raster", source: "naip" }],
  };
}

/** Style per name: a URL for the vector basemaps, an object for imagery. */
export const STYLE_URLS: Record<MapStyleName, string | StyleSpecification> = {
  satellite: satelliteStyle(),
  terrain: OPENFREEMAP_LIBERTY,
  streets: OPENFREEMAP_LIBERTY,
};

/** The engine needs no token any more — kept so callers' guards stay valid. */
export function isMapEngineConfigured(): boolean {
  return true;
}

/** Add the shared DEM source once. */
export function ensureDemSource(map: MapLibreMap): string {
  if (!map.getSource(DEM_SOURCE_ID)) map.addSource(DEM_SOURCE_ID, demSourceSpec());
  return DEM_SOURCE_ID;
}

/**
 * A layer id to insert before: the requested one if this style has it, else
 * the first symbol layer (labels stay on top), else undefined (append).
 * MapLibre throws on a missing beforeId, and layer ids differ per style.
 */
export function safeBeforeId(map: MapLibreMap, preferred?: string): string | undefined {
  if (preferred && map.getLayer(preferred)) return preferred;
  return map.getStyle()?.layers?.find((l) => l.type === "symbol")?.id;
}

/**
 * Solar sky. MapLibre has no Mapbox "sky" layer; it has a style-level sky.
 * The sun's altitude drives the sky colours (day / golden hour / night).
 */
export function applySolarSky(map: MapLibreMap, solar: { altitude: number; isDaytime?: boolean }): void {
  const night = solar.altitude < -2;
  const golden = !night && solar.altitude < 12;
  map.setSky({
    "sky-color": night ? "#0b1026" : golden ? "#f2b27a" : "#87b8e8",
    "horizon-color": night ? "#1d2440" : golden ? "#f7d9a8" : "#dbe9f6",
    "fog-color": night ? "#151a30" : "#e6eef6",
    "sky-horizon-blend": 0.5,
    "horizon-fog-blend": 0.6,
    "fog-ground-blend": 0.4,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 12, 0],
  });
}

/** 3D buildings from the OpenMapTiles "building" layer (vector styles only). */
export function buildingsSourceAvailable(map: MapLibreMap): boolean {
  return Boolean(map.getSource("openmaptiles"));
}

let contourDem: { contourProtocolUrl: (o: any) => string } | null = null;

/**
 * Client-side contour tiles from the shared DEM (maplibre-contour), replacing
 * the Mapbox terrain-v2 contour tileset. Returns the vector tile URL.
 */
export async function contourTileUrl(): Promise<string> {
  if (!contourDem) {
    const mlcontour = (await import("maplibre-contour")).default;
    const dem = new mlcontour.DemSource({ url: TERRAIN_DEM_URL, encoding: "terrarium", maxzoom: 13, worker: true });
    dem.setupMaplibre(maplibregl as any);
    contourDem = dem;
  }
  return contourDem.contourProtocolUrl({
    multiplier: 1,
    thresholds: { 11: [50, 250], 12: [20, 100], 13: [10, 50], 14: [5, 25], 15: [2, 10] },
    elevationKey: "ele",
    levelKey: "level",
    contourLayer: "contour",
  });
}

/**
 * A static aerial image for a bbox (EPSG:3857 metres), from the NAIP image
 * service — replaces the Mapbox Static Images API for snapshots/thumbnails.
 */
export function naipStaticImageUrl(bbox3857: [number, number, number, number], width: number, height: number): string {
  const params = new URLSearchParams({
    bbox: bbox3857.map((n) => n.toFixed(2)).join(","),
    bboxSR: "3857",
    imageSR: "3857",
    size: `${Math.round(width)},${Math.round(height)}`,
    format: "jpg",
    f: "image",
  });
  return `https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?${params.toString()}`;
}

export function lngLatToMercator(lng: number, lat: number): [number, number] {
  const R = 6378137;
  const x = (lng * Math.PI * R) / 180;
  const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return [x, y];
}
