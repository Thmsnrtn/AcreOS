/**
 * Rosy River B1 — Map engine configuration.
 *
 * This module is Phase 1 of the Mapbox → MapLibre migration. It does NOT
 * swap the renderer yet — that's Phase 2 (a focused PR against
 * client/src/components/property-map.tsx that needs browser verification
 * before merge).
 *
 * What this file gives us today:
 *   1. A single source of truth for which engine the app should use.
 *      Default = "mapbox" (existing behavior). Flip
 *      VITE_MAP_ENGINE=maplibre in .env.local or the Fly secret to
 *      preview the open-source path.
 *   2. Engine-agnostic style descriptors. Mapbox styles live behind
 *      mapbox:// URLs (require a token). MapLibre styles point at
 *      open-data tile servers (Stadia, OSM-based, or self-hosted).
 *   3. Static-map URL builders, so the offline-only fallback in
 *      property-map.tsx (lines 3241/3244 today) has a non-Mapbox path
 *      once Phase 2 lands.
 *
 * Phase 2 (not in this commit) is straightforward: import either mapbox-gl
 * or maplibre-gl based on getMapEngine(), and use STYLE_URLS[engine][style]
 * when constructing the Map. The two libraries share the same Map / Marker /
 * Popup / NavigationControl / GeoJSONSource constructors — maplibre-gl is a
 * permissive fork of mapbox-gl v1, so most call sites need no change.
 */

export type MapEngine = "mapbox" | "maplibre";
export type MapStyleName = "satellite" | "terrain" | "streets";

/**
 * Resolves the effective map engine. Reads from Vite env at build time, or
 * window.__ENV__ for runtime injection (matches the MAPBOX_TOKEN pattern in
 * property-map.tsx:22). Falls back to "mapbox" so today's behavior is
 * unchanged.
 */
export function getMapEngine(): MapEngine {
  const fromEnv =
    import.meta.env.VITE_MAP_ENGINE ||
    (typeof window !== "undefined" ? (window as unknown as { __ENV__?: { VITE_MAP_ENGINE?: string } }).__ENV__?.VITE_MAP_ENGINE : undefined);
  return fromEnv === "maplibre" ? "maplibre" : "mapbox";
}

/**
 * Style URL matrix. Mapbox URLs require a token; MapLibre URLs do not.
 *
 * MapLibre defaults use Stadia's free tier (1× million tiles/month, no
 * attribution requirements beyond the standard OSM line). Stadia keys are
 * optional — the URLs work without a key but Stadia may rate-limit at
 * scale. Set VITE_STADIA_API_KEY for production. To self-host instead,
 * point these at your own Protomaps PMTiles endpoint.
 */
export const STYLE_URLS: Record<MapEngine, Record<MapStyleName, string>> = {
  mapbox: {
    satellite: "mapbox://styles/mapbox/satellite-streets-v12",
    terrain: "mapbox://styles/mapbox/outdoors-v12",
    streets: "mapbox://styles/mapbox/streets-v12",
  },
  maplibre: {
    // Stadia "Alidade Satellite" — vector overlay on Sentinel-2 imagery
    satellite: stadiaUrl("alidade_satellite"),
    // Stadia "Stamen Terrain" — topographic with hillshade
    terrain: stadiaUrl("stamen_terrain"),
    // Stadia "OSM Bright" — clean OSM streets
    streets: stadiaUrl("osm_bright"),
  },
};

function stadiaUrl(style: string): string {
  const key =
    import.meta.env.VITE_STADIA_API_KEY ||
    (typeof window !== "undefined" ? (window as unknown as { __ENV__?: { VITE_STADIA_API_KEY?: string } }).__ENV__?.VITE_STADIA_API_KEY : undefined);
  const suffix = key ? `?api_key=${key}` : "";
  return `https://tiles.stadiamaps.com/styles/${style}.json${suffix}`;
}

/**
 * True when the chosen engine is fully configured. Use this to drive the
 * "Map not available" empty state in property-map.tsx so it stops referring
 * to Mapbox specifically once Phase 2 lands.
 */
export function isMapEngineConfigured(): boolean {
  const engine = getMapEngine();
  if (engine === "maplibre") {
    // MapLibre + Stadia free tier works without a key.
    return true;
  }
  const token =
    import.meta.env.VITE_MAPBOX_ACCESS_TOKEN ||
    (typeof window !== "undefined" ? (window as unknown as { __ENV__?: { VITE_MAPBOX_ACCESS_TOKEN?: string } }).__ENV__?.VITE_MAPBOX_ACCESS_TOKEN : undefined);
  return Boolean(token);
}

/**
 * Static-map URL builder. Returns a snapshot image URL suitable for
 * report PDFs, social-share previews, and the offline fallback in
 * property-map.tsx. Mapbox uses its Static Images API; MapLibre has no
 * equivalent first-party service so the open-source path uses a public
 * OSM static-map service.
 */
export function buildStaticMapUrl(opts: {
  longitude: number;
  latitude: number;
  zoom: number;
  width: number;
  height: number;
  style?: MapStyleName;
  retina?: boolean;
}): string {
  const engine = getMapEngine();
  const style = opts.style ?? "satellite";
  const retina = opts.retina ?? true;

  if (engine === "mapbox") {
    const token =
      import.meta.env.VITE_MAPBOX_ACCESS_TOKEN ||
      (typeof window !== "undefined" ? (window as unknown as { __ENV__?: { VITE_MAPBOX_ACCESS_TOKEN?: string } }).__ENV__?.VITE_MAPBOX_ACCESS_TOKEN : "");
    const styleId =
      style === "satellite"
        ? "satellite-streets-v12"
        : style === "terrain"
          ? "outdoors-v12"
          : "streets-v12";
    const r = retina ? "@2x" : "";
    return `https://api.mapbox.com/styles/v1/mapbox/${styleId}/static/${opts.longitude},${opts.latitude},${opts.zoom}/${opts.width}x${opts.height}${r}?access_token=${token}`;
  }

  // Open-source path: OSM staticmap (third-party, free, attribution required
  // in the rendered output).
  const r = retina ? 2 : 1;
  return `https://staticmap.openstreetmap.de/staticmap.php?center=${opts.latitude},${opts.longitude}&zoom=${opts.zoom}&size=${opts.width}x${opts.height}&scale=${r}&maptype=mapnik`;
}
