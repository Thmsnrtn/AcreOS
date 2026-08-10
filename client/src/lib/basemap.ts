/**
 * Basemap SOURCE registry — Wave 2.1 (MapLibre M0 groundwork).
 *
 * ─── THE PREMISE, ESTABLISHED AT HEAD (b2e92be) ───────────────────────────
 *
 * What the customer Map door actually renders TODAY, verified by reading the
 * code rather than the roadmap:
 *
 *   client/src/pages/maps.tsx
 *     → <PropertyMap> from client/src/components/property-map-lazy.tsx
 *     → React.lazy(() => import("./property-map"))
 *     → client/src/components/property-map.tsx, which imports BOTH
 *       `mapbox-gl` AND `maplibre-gl` and picks one at module-eval time.
 *
 * So the "Phase 2 renderer swap" the old map-engine.ts header described as
 * "not in this commit" HAS in fact landed: property-map.tsx is already
 * engine-agnostic (a single `gl` namespace feeds every `new gl.Map/Marker/
 * Popup/NavigationControl`). Both engines ship in the vendor chunk.
 *
 * What had NOT landed, and is what this module is for:
 *
 *   1. The DEFAULT is still `mapbox` — so the shipped product renders
 *      Mapbox-hosted styles behind VITE_MAPBOX_ACCESS_TOKEN. Cost posture
 *      per docs/company/overhead-operating-costs.md:33 — "Mapbox | $0 |
 *      $0–50 | Generous free map-load tier": free at today's volume, a
 *      per-map-load bill that grows with customers. That is the dependency
 *      handoff §D Wave 2.1 wants removed, not a fire today.
 *
 *   2. The MapLibre alternative pointed at Stadia, whose free tier is
 *      EXPLICITLY NON-COMMERCIAL (docs/company/open-data-program.md:70 logs
 *      this as a live compliance bug). Worse, `isMapEngineConfigured()`
 *      returned `true` for the maplibre path unconditionally — the code
 *      declared an unkeyed, unlicensed-for-commercial-use configuration
 *      "configured". This module makes the Stadia source require its key,
 *      so the engine choice stops asserting a licence it does not hold.
 *
 *   3. Nothing carried ATTRIBUTION. Both engines auto-derive attribution
 *      from a style's `sources[].attribution`, which works for vendor-hosted
 *      styles and silently produces NOTHING for a self-hosted style whose
 *      author forgot the field. Attribution is a required field here, and
 *      the exit test fails BY NAME on any source that omits it.
 *
 * What a switch would entail (honest, not aspirational):
 *   - Engine swap: DONE. maplibre-gl 4.7.1 is already imported and wired.
 *   - Basemap source: needs tiles we control. docs/company/open-data-program.md
 *     §Phase-4 step 1 scopes it as self-hosted Protomaps PMTiles on Cloudflare
 *     R2, ~1 day + an R2 account, ~$5–15/mo. NOT provisionable from this
 *     environment — no bucket, no PMTiles asset, and committing tile assets is
 *     out of scope. The source below is therefore WIRED AND READY but reports
 *     itself UNCONFIGURED until an operator sets its style URL. It does not
 *     pretend to be self-hosting anything.
 *   - Imagery parity: this is the real product blocker, not a technical one.
 *     property-map.tsx defaults to the "satellite" style (currentStyle
 *     useState<MapStyle>("satellite")) and this is a LAND product. Protomaps
 *     and OpenFreeMap are vector OSM basemaps with NO satellite imagery, so
 *     flipping the default to either would quietly downgrade every parcel
 *     view from aerial to street lines. `hasSatelliteImagery` records that
 *     per source so the choice cannot be made blind. Closing it needs the
 *     NAIP self-host in open-data-program.md Phase-4 step 2 (~1–2 weeks).
 *
 * ─── WHY THIS FILE EXISTS ────────────────────────────────────────────────
 *
 * One module so a qualifier cannot be forgotten per call site (the slice-8
 * ColumnValueReadout idiom): every basemap gets a style URL AND the
 * attribution that legally must accompany it, from the same record.
 *
 * ─── WHAT "SWAPPABLE BY CONFIG" HONESTLY MEANS HERE ──────────────────────
 * Selecting a source (VITE_BASEMAP_SOURCE) and pointing at a style
 * (VITE_BASEMAP_PROTOMAPS_STYLE_URL) is config. But the browser will only
 * FETCH those tiles if the host is allowed by the server's Content-Security
 * -Policy, and `connect-src` in server/middleware/security.ts is a hardcoded
 * allowlist that admits api.mapbox.com / events.mapbox.com and no other map
 * host (fleet-11 verifier catch — the first draft of this header claimed a
 * pure config swap, which would have failed at runtime with a CSP violation
 * and no obvious cause). So:
 *   • SAME-ORIGIN self-hosted style (tiles served from this app's own
 *     origin) → genuinely a config change today, because 'self' is allowed.
 *   • ANY off-origin host (a Protomaps bucket, a CDN, Stadia) → needs its
 *     host added to connect-src in the same change. That is a one-line
 *     server edit, but it IS a code edit, and pretending otherwise would
 *     strand whoever tries the swap.
 */

export type BasemapEngine = "mapbox" | "maplibre";
export type MapStyleName = "satellite" | "terrain" | "streets";

export type BasemapSourceId = "mapbox" | "stadia" | "protomaps-selfhost";

/**
 * How the tiles are paid for. Recorded so the cost conversation is sourced
 * from the code rather than from memory.
 */
export type BasemapBilling =
  /** Vendor-hosted, billed per map load once the free tier is exceeded. */
  | "vendor-per-map-load"
  /** Vendor-hosted, billed per tile; free tier carries a licence restriction. */
  | "vendor-per-tile"
  /** Served from infrastructure the operator controls; cost is the hosting bill. */
  | "self-hosted";

export interface BasemapSource {
  readonly id: BasemapSourceId;
  /** Operator-facing name. Never rendered on a customer surface. */
  readonly label: string;
  /** Which GL engine this source's styles require. */
  readonly engine: BasemapEngine;
  /**
   * Attribution that MUST appear on any map rendered from this source.
   * Non-empty for every registered source — enforced by mapBasemap.test.ts,
   * which fails by source id. A map that renders someone's tiles without
   * their attribution is a licence breach and a lie on screen.
   */
  readonly attribution: string;
  /**
   * True only when this source serves real aerial/satellite imagery for its
   * "satellite" style. Vector OSM basemaps are `false` — switching to one
   * changes what the customer SEES, not just who bills for it.
   */
  readonly hasSatelliteImagery: boolean;
  /** True only when tiles come from infrastructure the operator controls. */
  readonly selfHosted: boolean;
  readonly billing: BasemapBilling;
  /**
   * True when this source's URLs are supplied by the operator at runtime
   * rather than baked into this file. Self-hosted sources must be
   * operator-supplied — otherwise "self-hosted" would point at somebody
   * else's host, which is the exact claim this slice must not fake.
   */
  readonly operatorSupplied: boolean;
  /** Style URL for a given style name, or null when unconfigured. */
  styleUrl(style: MapStyleName): string | null;
  /**
   * Whether this source can lawfully and technically serve tiles right now.
   * Must be false when a required credential or operator URL is missing —
   * "renders anyway" is not the same as "configured".
   */
  isConfigured(): boolean;
  /**
   * Operator-facing reason this source is unusable, or null when it is
   * usable. Never rendered on a customer surface.
   */
  unconfiguredReason(): string | null;
}

// ─── env plumbing ────────────────────────────────────────────────────────
//
// Mirrors the existing VITE_MAPBOX_ACCESS_TOKEN pattern: Vite compile-time
// env, with a window.__ENV__ runtime-injection fallback (server/static.ts
// injects that at serve time). Read at CALL time, never memoised at module
// scope, so tests can stub without module-registry games.

function readEnv(name: string): string | undefined {
  const viteEnv = (import.meta.env as Record<string, string | undefined>)[name];
  if (viteEnv) return viteEnv;
  if (typeof window !== "undefined") {
    const injected = (window as unknown as { __ENV__?: Record<string, string | undefined> }).__ENV__;
    if (injected?.[name]) return injected[name];
  }
  return undefined;
}

/** Vendor-hosted Mapbox styles. Today's shipped default. */
const MAPBOX_SOURCE: BasemapSource = {
  id: "mapbox",
  label: "Mapbox (vendor-hosted)",
  engine: "mapbox",
  // Mapbox ToS §"Attribution" requires the Mapbox and OSM notices on-map.
  attribution: "© Mapbox © OpenStreetMap",
  hasSatelliteImagery: true,
  selfHosted: false,
  billing: "vendor-per-map-load",
  operatorSupplied: false,
  styleUrl(style) {
    // A mapbox:// style is unresolvable without the token, so an
    // unconfigured source yields null rather than a URL that only LOOKS
    // usable. Every source obeys this rule — see the "unconfigured source
    // yields no style URL" case in mapBasemap.test.ts.
    if (!this.isConfigured()) return null;
    const styles: Record<MapStyleName, string> = {
      satellite: "mapbox://styles/mapbox/satellite-streets-v12",
      terrain: "mapbox://styles/mapbox/outdoors-v12",
      streets: "mapbox://styles/mapbox/streets-v12",
    };
    return styles[style];
  },
  isConfigured() {
    return Boolean(readEnv("VITE_MAPBOX_ACCESS_TOKEN"));
  },
  unconfiguredReason() {
    return this.isConfigured() ? null : "VITE_MAPBOX_ACCESS_TOKEN is not set";
  },
};

/**
 * Vendor-hosted Stadia styles on the MapLibre engine.
 *
 * ⚠️ Stadia's UNKEYED free tier is licensed for "development, evaluation, and
 * non-commercial use" only (docs.stadiamaps.com/limits; logged as a live
 * compliance bug in docs/company/open-data-program.md:70). Serving it to
 * paying customers without a paid key is a licence breach, so this source
 * reports itself UNCONFIGURED without VITE_STADIA_API_KEY. The previous
 * `isMapEngineConfigured()` returned true here unconditionally.
 */
const STADIA_SOURCE: BasemapSource = {
  id: "stadia",
  label: "Stadia Maps (vendor-hosted, paid key required)",
  engine: "maplibre",
  attribution:
    "© Stadia Maps © Stamen Design © OpenMapTiles © OpenStreetMap contributors",
  hasSatelliteImagery: true,
  selfHosted: false,
  billing: "vendor-per-tile",
  operatorSupplied: false,
  styleUrl(style) {
    const key = readEnv("VITE_STADIA_API_KEY");
    if (!key) return null;
    const name =
      style === "satellite"
        ? "alidade_satellite"
        : style === "terrain"
          ? "stamen_terrain"
          : "osm_bright";
    return `https://tiles.stadiamaps.com/styles/${name}.json?api_key=${key}`;
  },
  isConfigured() {
    return Boolean(readEnv("VITE_STADIA_API_KEY"));
  },
  unconfiguredReason() {
    return this.isConfigured()
      ? null
      : "VITE_STADIA_API_KEY is not set — Stadia's unkeyed free tier is non-commercial and may not serve customers";
  },
};

/**
 * Self-hosted Protomaps basemap — handoff §H Part 1 §3.3 M0's destination.
 *
 * WIRED, NOT PROVISIONED. There is no PMTiles asset in this repo and no
 * bucket to serve one from; committing tile assets is explicitly out of
 * scope. This source therefore reads its style URL from the operator and is
 * UNCONFIGURED until they set it. It never falls back to a third-party host —
 * a "self-hosted" source silently pointing at somebody else's tiles is
 * precisely the fabrication this slice must not commit.
 *
 * Provisioning (docs/company/open-data-program.md Phase-4 step 1): build
 * PMTiles, put them on Cloudflare R2, serve a style JSON, set
 * VITE_BASEMAP_PROTOMAPS_STYLE_URL, then VITE_BASEMAP_SOURCE=protomaps-selfhost.
 * ~1 day + an R2 account, ~$5–15/mo. Founder-queued, not built here.
 *
 * NOTE the imagery gap: Protomaps is a vector OSM basemap. It has no aerial
 * imagery, so `hasSatelliteImagery` is false and the "satellite" style
 * resolves to the same vector style as the others. Making this the default
 * before the NAIP self-host lands would downgrade what customers see.
 */
const PROTOMAPS_SELFHOST_SOURCE: BasemapSource = {
  id: "protomaps-selfhost",
  label: "Protomaps (self-hosted, operator-provisioned)",
  engine: "maplibre",
  // Protomaps basemaps are built from OpenStreetMap under ODbL.
  attribution: "© Protomaps © OpenStreetMap contributors",
  hasSatelliteImagery: false,
  selfHosted: true,
  billing: "self-hosted",
  operatorSupplied: true,
  styleUrl() {
    // One operator style serves every style name — a vector basemap has no
    // satellite variant, and inventing per-style URLs the operator never
    // configured would be a fabricated path.
    return readEnv("VITE_BASEMAP_PROTOMAPS_STYLE_URL") ?? null;
  },
  isConfigured() {
    return Boolean(readEnv("VITE_BASEMAP_PROTOMAPS_STYLE_URL"));
  },
  unconfiguredReason() {
    return this.isConfigured()
      ? null
      : "VITE_BASEMAP_PROTOMAPS_STYLE_URL is not set — no self-hosted PMTiles style has been provisioned yet";
  },
};

export const BASEMAP_SOURCES: Readonly<Record<BasemapSourceId, BasemapSource>> = {
  mapbox: MAPBOX_SOURCE,
  stadia: STADIA_SOURCE,
  "protomaps-selfhost": PROTOMAPS_SELFHOST_SOURCE,
};

/**
 * The honest default: `mapbox`, because that is what the product renders
 * today. This is deliberately NOT flipped to a MapLibre source in this slice
 * — no MapLibre source is provisioned (Stadia needs a paid key, Protomaps
 * needs a bucket), and both lack the satellite imagery the land product
 * defaults to. Flipping it is a founder decision with a vendor cost attached,
 * not a code cleanup.
 *
 * Intentionally NOT exported: everything observable about resolution is
 * reachable through `getActiveBasemapSource()`, and an export with no
 * production consumer is the "built but unwired" defect this repo keeps
 * catching.
 */
const DEFAULT_BASEMAP_SOURCE_ID: BasemapSourceId = "mapbox";

function isBasemapSourceId(value: string | undefined): value is BasemapSourceId {
  return typeof value === "string" && value in BASEMAP_SOURCES;
}

/**
 * Resolve which basemap source is active.
 *
 * Precedence:
 *   1. VITE_BASEMAP_SOURCE — the explicit, forward-looking selector.
 *   2. VITE_MAP_ENGINE=maplibre — the legacy engine flag documented in
 *      .env.example. Kept working so existing previews don't break; it maps
 *      to the Stadia source because that is what it selected before.
 *   3. DEFAULT_BASEMAP_SOURCE_ID.
 *
 * An unrecognised value falls back to the default rather than throwing: a
 * typo'd env var must not blank the Map door, and it must never leave the map
 * running against an unregistered source with no attribution record.
 */
function resolveBasemapSourceId(): BasemapSourceId {
  const explicit = readEnv("VITE_BASEMAP_SOURCE");
  if (isBasemapSourceId(explicit)) return explicit;
  if (readEnv("VITE_MAP_ENGINE") === "maplibre") return "stadia";
  return DEFAULT_BASEMAP_SOURCE_ID;
}

/**
 * The active basemap source — the single entry point.
 *
 * Everything callers need hangs off the returned record: `.engine`,
 * `.attribution`, `.styleUrl(style)`, `.isConfigured()`,
 * `.unconfiguredReason()`, `.selfHosted`, `.hasSatelliteImagery`. Keeping it
 * to one export means a caller cannot reach for the style URL without the
 * attribution being right there.
 *
 * Whether a self-hosted basemap is genuinely serving tiles — the claim this
 * slice is forbidden from faking — is `src.selfHosted && src.isConfigured()`,
 * derived from real config rather than stored as a constant anyone could set.
 */
export function getActiveBasemapSource(): BasemapSource {
  return BASEMAP_SOURCES[resolveBasemapSourceId()];
}
