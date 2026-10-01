/**
 * Map engine configuration — Mapbox GL is the one renderer.
 *
 * A MapLibre preview engine lived here behind VITE_MAP_ENGINE=maplibre until
 * W10.1b (2026-10-01). It was removed rather than carried: no deployment set
 * the flag; its Stadia styles were licensed non-commercial only; the single-
 * property map and the terrain DEM were hardwired to mapbox:// sources, so the
 * path never fully rendered; and maplibre-gl 4.x held the repo's one critical
 * advisory, whose v6 fix ships a worker our build did not emit. A MapLibre
 * renderer returns with the open-data program's self-hosted tiles
 * (docs/company/open-data-program.md), built for production, not as a toggle.
 */

export type MapStyleName = "satellite" | "terrain" | "streets";

export const STYLE_URLS: Record<MapStyleName, string> = {
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
  terrain: "mapbox://styles/mapbox/outdoors-v12",
  streets: "mapbox://styles/mapbox/streets-v12",
};

/**
 * The Mapbox access token, from the Vite build env or window.__ENV__ (runtime
 * injection). Empty when unconfigured.
 */
export function mapboxToken(): string {
  return (
    import.meta.env.VITE_MAPBOX_ACCESS_TOKEN ||
    (typeof window !== "undefined" ? (window as unknown as { __ENV__?: { VITE_MAPBOX_ACCESS_TOKEN?: string } }).__ENV__?.VITE_MAPBOX_ACCESS_TOKEN : undefined) ||
    ""
  );
}

/** True when the map can render: Mapbox needs its access token. */
export function isMapEngineConfigured(): boolean {
  return Boolean(mapboxToken());
}
