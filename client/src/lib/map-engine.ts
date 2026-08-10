/**
 * Map engine selection — now a thin projection of the basemap SOURCE
 * registry in `client/src/lib/basemap.ts`.
 *
 * HISTORY / CORRECTION (Wave 2.1). This file's previous header said it was
 * "Phase 1 of the Mapbox → MapLibre migration" and that it "does NOT swap the
 * renderer yet — that's Phase 2". That was stale: property-map.tsx already
 * imports both `mapbox-gl` and `maplibre-gl` and selects between them at
 * module-eval time, so the renderer swap had in fact landed. The remaining
 * gap was never the engine — it was the basemap SOURCE (whose tiles, whose
 * bill, whose attribution). That now lives in basemap.ts, which carries the
 * full establishing comment.
 *
 * Two behavioural corrections came with the move:
 *
 *   1. `isMapEngineConfigured()` used to return `true` for the maplibre path
 *      unconditionally. The maplibre path pointed at Stadia, whose unkeyed
 *      free tier is licensed non-commercial only
 *      (docs/company/open-data-program.md:70). The code was declaring a
 *      configuration it had no licence for. It now defers to the source's own
 *      `isConfigured()`, so Stadia requires VITE_STADIA_API_KEY.
 *
 *   2. Style URLs and the attribution that must legally accompany them now
 *      come from the same record, so a new source cannot be added with tiles
 *      and no attribution.
 *
 * Everything here is kept for its existing call sites in property-map.tsx.
 * New code should prefer the basemap.ts API directly.
 */

import {
  BASEMAP_SOURCES,
  getActiveBasemapSource,
  type BasemapEngine,
  type MapStyleName,
} from "./basemap";

export type MapEngine = BasemapEngine;
export type { MapStyleName };

/**
 * The GL engine the active basemap source requires. Callers use this to pick
 * the runtime constructor namespace (mapboxgl vs maplibregl).
 */
export function getMapEngine(): MapEngine {
  return getActiveBasemapSource().engine;
}

/**
 * Style URLs for the ACTIVE source, keyed by style name.
 *
 * Entries are `""` when the active source is not configured (no key / no
 * operator URL). Callers already gate on `isMapEngineConfigured()` before
 * constructing a map, so an unconfigured source renders the unavailable
 * state rather than handing a bogus URL to the engine. It deliberately does
 * NOT fall back to another vendor's tiles.
 */
export function getMapStyles(): Record<MapStyleName, string> {
  const source = getActiveBasemapSource();
  const names: MapStyleName[] = ["satellite", "terrain", "streets"];
  return names.reduce(
    (acc, name) => {
      acc[name] = source.styleUrl(name) ?? "";
      return acc;
    },
    {} as Record<MapStyleName, string>,
  );
}

/**
 * Attribution for the active source. Always non-empty — every registered
 * source carries one and `mapBasemap.test.ts` fails by name if any doesn't.
 */
export function getMapAttribution(): string {
  return getActiveBasemapSource().attribution;
}

/**
 * True when the active source can lawfully and technically serve tiles.
 * Drives the "Map temporarily unavailable" state in property-map.tsx.
 */
export function isMapEngineConfigured(): boolean {
  return getActiveBasemapSource().isConfigured();
}

/**
 * Operator-facing reason the map is unavailable, or null. DEV surfaces only —
 * a customer seeing an env-var name concludes the product is half-built
 * (krieger lens, docs/internal/roadmap/_lenses/krieger.md:68).
 */
export function getMapUnconfiguredReason(): string | null {
  return getActiveBasemapSource().unconfiguredReason();
}

/**
 * Static-map snapshot URL for report PDFs, share previews and the
 * StaticPropertyMap fallback.
 *
 * HONESTY NOTE: this is a Mapbox Static Images API call and nothing else.
 * There is no self-hosted or MapLibre equivalent wired — MapLibre has no
 * first-party static service, and the previous implementation's fallback to
 * `staticmap.openstreetmap.de` was a third-party host that was never
 * provisioned, never attributed on screen, and is not licensed for
 * commercial product use. Rather than keep a path that would render
 * unattributed tiles, this returns `null` when no Mapbox token is present,
 * and callers render the unavailable state. Attribution for the rendered
 * image is `STATIC_MAP_ATTRIBUTION` — Mapbox's, regardless of which
 * INTERACTIVE source is active, because the image comes from Mapbox.
 */
export const STATIC_MAP_ATTRIBUTION = BASEMAP_SOURCES.mapbox.attribution;

export function isStaticMapConfigured(): boolean {
  return BASEMAP_SOURCES.mapbox.isConfigured();
}

export function buildStaticMapUrl(opts: {
  longitude: number;
  latitude: number;
  zoom: number;
  width: number;
  height: number;
  style?: MapStyleName;
  retina?: boolean;
}): string | null {
  const token =
    (import.meta.env as Record<string, string | undefined>).VITE_MAPBOX_ACCESS_TOKEN ||
    (typeof window !== "undefined"
      ? (window as unknown as { __ENV__?: { VITE_MAPBOX_ACCESS_TOKEN?: string } }).__ENV__
          ?.VITE_MAPBOX_ACCESS_TOKEN
      : undefined);
  if (!token) return null;

  const style = opts.style ?? "satellite";
  const styleId =
    style === "satellite"
      ? "satellite-streets-v12"
      : style === "terrain"
        ? "outdoors-v12"
        : "streets-v12";
  const r = opts.retina ?? true ? "@2x" : "";
  return `https://api.mapbox.com/styles/v1/mapbox/${styleId}/static/${opts.longitude},${opts.latitude},${opts.zoom}/${opts.width}x${opts.height}${r}?access_token=${token}`;
}
