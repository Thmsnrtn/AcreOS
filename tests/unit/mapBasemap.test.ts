/**
 * Wave 2.1 exit test — MapLibre M0 groundwork (handoff §D Wave 2.1;
 * §H Part 1 §3.3 M0).
 *
 * WHAT THIS PINS, and why each half was RED at b2e92be:
 *
 *  1. A basemap SOURCE registry exists and resolves from config with an
 *     HONEST default (client/src/lib/basemap.ts did not exist).
 *  2. Every registered source carries a NON-EMPTY attribution, and the
 *     failure names the offending source. Nothing carried attribution before:
 *     both engines auto-derive it from the style JSON, which silently yields
 *     NOTHING for a self-hosted style whose author omits the field — exactly
 *     the case M0 is heading for.
 *  3. The engine actually imported by the map page matches what the config
 *     claims. This is derived from the REAL import lines in property-map.tsx,
 *     not a hardcoded list, so it cannot go stale (the
 *     workflowActionHonesty.ts lesson in CLAUDE.md).
 *  4. No hardcoded vendor style URL bypasses the registry. RED before:
 *     SinglePropertyMap hardcoded `mapbox://styles/mapbox/satellite-streets-v12`,
 *     which maplibre-gl cannot resolve — the engine indirection was defeated
 *     on that map instance.
 *  5. Every map instance gets attribution. RED before: 2 `new gl.Map(` sites,
 *     0 attribution attachments.
 *  6. Self-hosting is not FAKED. The Protomaps source is wired but reports
 *     itself unconfigured until an operator supplies its style URL, and
 *     nothing in the tree claims a self-hosted basemap is active.
 *  7. Slice-6 query-error honesty in maps.tsx still holds.
 *
 * NEGATIVE CLAIMS ARE CHECKED, NOT ASSERTED. Where this file claims something
 * is absent (no self-hosted style provisioned, no PMTiles asset committed) it
 * proves the absence by inspecting the named files/globs, so the absence is
 * falsifiable rather than a story.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  BASEMAP_SOURCES,
  getActiveBasemapSource,
  type BasemapSourceId,
  type MapStyleName,
} from "../../client/src/lib/basemap";
import {
  getMapEngine,
  getMapStyles,
  getMapAttribution,
  isMapEngineConfigured,
  getMapUnconfiguredReason,
  isStaticMapConfigured,
  buildStaticMapUrl,
  STATIC_MAP_ATTRIBUTION,
} from "../../client/src/lib/map-engine";

// Derived, not restated: the suite enumerates whatever the registry actually
// holds, so a source added tomorrow is subject to every rule below.
const BASEMAP_SOURCE_IDS = Object.keys(BASEMAP_SOURCES) as BasemapSourceId[];

/** Resolution is observed through the active source, its only public seam. */
const activeSourceId = () => getActiveBasemapSource().id;

const REPO_ROOT = path.resolve(__dirname, "../..");
const PROPERTY_MAP = path.join(REPO_ROOT, "client/src/components/property-map.tsx");
const MAPS_PAGE = path.join(REPO_ROOT, "client/src/pages/maps.tsx");
const BASEMAP_MODULE = path.join(REPO_ROOT, "client/src/lib/basemap.ts");

const propertyMapSrc = fs.readFileSync(PROPERTY_MAP, "utf8");
const mapsPageSrc = fs.readFileSync(MAPS_PAGE, "utf8");
const basemapSrc = fs.readFileSync(BASEMAP_MODULE, "utf8");

/**
 * Strip comments so source-shape counts measure CODE.
 *
 * Learned the hard way while writing this file: the first draft counted
 * `new gl.Map(` across the raw text and found 3 sites where the code has 2 —
 * the third was this suite's own explanatory comment inside property-map.tsx.
 * A shape assertion that counts prose is a shape assertion that lies.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

const propertyMapCode = codeOnly(propertyMapSrc);
const mapsPageCode = codeOnly(mapsPageSrc);

const STYLE_NAMES: MapStyleName[] = ["satellite", "terrain", "streets"];

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── 1. Registry integrity ───────────────────────────────────────────────

describe("basemap source registry", () => {
  it("registers at least one source and exposes every id", () => {
    expect(BASEMAP_SOURCE_IDS.length).toBeGreaterThan(0);
    for (const id of BASEMAP_SOURCE_IDS) {
      expect(BASEMAP_SOURCES[id], `${id} is listed but not registered`).toBeDefined();
      expect(BASEMAP_SOURCES[id].id).toBe(id);
    }
  });

  // The load-bearing one. A source with no attribution fails BY NAME.
  it.each(BASEMAP_SOURCE_IDS)(
    "source %s carries a non-empty attribution",
    (id) => {
      const source = BASEMAP_SOURCES[id];
      expect(
        source.attribution?.trim() ?? "",
        `basemap source "${id}" (${source.label}) has NO attribution — rendering its tiles would be a licence breach and a lie on screen`,
      ).not.toBe("");
    },
  );

  it("every source declares an engine the map component actually imports", () => {
    // Derived from the REAL import lines, so adding a source on an engine
    // nobody imports fails here rather than at runtime.
    const importedEngines = new Set<string>();
    for (const m of propertyMapSrc.matchAll(/^import\s+\w+\s+from\s+"(mapbox-gl|maplibre-gl)";$/gm)) {
      importedEngines.add(m[1] === "mapbox-gl" ? "mapbox" : "maplibre");
    }
    expect(
      importedEngines.size,
      "property-map.tsx imports no GL engine — the config's engine claims cannot be satisfied",
    ).toBeGreaterThan(0);

    for (const id of BASEMAP_SOURCE_IDS) {
      const engine = BASEMAP_SOURCES[id].engine;
      expect(
        importedEngines.has(engine),
        `source "${id}" claims engine "${engine}" but property-map.tsx imports only: ${[...importedEngines].join(", ")}`,
      ).toBe(true);
    }
  });

  it("the ACTIVE engine reported by config is one the map component imports", () => {
    const engine = getMapEngine();
    const pkg = engine === "mapbox" ? "mapbox-gl" : "maplibre-gl";
    expect(propertyMapSrc).toContain(`from "${pkg}"`);
  });

  it("a self-hosted source must be operator-supplied — never a baked third-party host", () => {
    for (const id of BASEMAP_SOURCE_IDS) {
      const source = BASEMAP_SOURCES[id];
      if (!source.selfHosted) continue;
      expect(
        source.operatorSupplied,
        `source "${id}" claims selfHosted but is not operatorSupplied — that would be somebody else's host wearing a self-hosted label`,
      ).toBe(true);
    }
  });
});

// ─── 2. Resolution from config, with an honest default ───────────────────

describe("basemap resolution", () => {
  it("defaults to the source the product actually renders today (mapbox)", () => {
    expect(activeSourceId()).toBe("mapbox");
    expect(getMapEngine()).toBe("mapbox");
  });

  it("VITE_BASEMAP_SOURCE selects any registered source", () => {
    for (const id of BASEMAP_SOURCE_IDS) {
      vi.stubEnv("VITE_BASEMAP_SOURCE", id);
      expect(activeSourceId()).toBe(id);
      expect(getMapEngine()).toBe(BASEMAP_SOURCES[id].engine);
    }
  });

  it("an unknown source id falls back to the default rather than throwing or rendering unattributed", () => {
    vi.stubEnv("VITE_BASEMAP_SOURCE", "not-a-real-source");
    expect(activeSourceId()).toBe("mapbox");
    expect(getMapAttribution().trim()).not.toBe("");
  });

  it("the legacy VITE_MAP_ENGINE=maplibre flag still resolves to a maplibre source", () => {
    vi.stubEnv("VITE_MAP_ENGINE", "maplibre");
    expect(getActiveBasemapSource().engine).toBe("maplibre");
  });

  it("attribution is non-empty for the active source under EVERY configuration", () => {
    for (const id of BASEMAP_SOURCE_IDS) {
      vi.stubEnv("VITE_BASEMAP_SOURCE", id);
      expect(getMapAttribution().trim(), `active source ${id} rendered with no attribution`).not.toBe("");
      expect(getMapAttribution()).toBe(BASEMAP_SOURCES[id].attribution);
    }
  });
});

// ─── 3. "Configured" must mean licensed AND technically able ─────────────

describe("configuration honesty", () => {
  it("mapbox is unconfigured without its token", () => {
    vi.stubEnv("VITE_BASEMAP_SOURCE", "mapbox");
    vi.stubEnv("VITE_MAPBOX_ACCESS_TOKEN", "");
    expect(isMapEngineConfigured()).toBe(false);
    vi.stubEnv("VITE_MAPBOX_ACCESS_TOKEN", "pk.test");
    expect(isMapEngineConfigured()).toBe(true);
  });

  // Stadia's unkeyed free tier is licensed non-commercial only
  // (docs/company/open-data-program.md:70). The previous
  // isMapEngineConfigured() returned true here UNCONDITIONALLY — the code
  // declared a configuration it had no licence for.
  it("stadia is NOT configured without a paid key (unkeyed free tier is non-commercial)", () => {
    vi.stubEnv("VITE_BASEMAP_SOURCE", "stadia");
    vi.stubEnv("VITE_STADIA_API_KEY", "");
    expect(isMapEngineConfigured()).toBe(false);
    expect(BASEMAP_SOURCES.stadia.unconfiguredReason()).toMatch(/non-commercial/i);
    expect(BASEMAP_SOURCES.stadia.styleUrl("satellite")).toBeNull();
  });

  it("an unconfigured source yields no style URL — it never falls back to another vendor's tiles", () => {
    for (const id of BASEMAP_SOURCE_IDS) {
      vi.stubEnv("VITE_BASEMAP_SOURCE", id);
      vi.stubEnv("VITE_MAPBOX_ACCESS_TOKEN", "");
      vi.stubEnv("VITE_STADIA_API_KEY", "");
      vi.stubEnv("VITE_BASEMAP_PROTOMAPS_STYLE_URL", "");
      const source = BASEMAP_SOURCES[id];
      if (source.isConfigured()) continue;
      for (const style of STYLE_NAMES) {
        expect(source.styleUrl(style), `${id}.styleUrl(${style}) invented a URL while unconfigured`).toBeNull();
      }
      expect(getMapStyles()[ "satellite" ]).toBe("");
      expect(source.unconfiguredReason()).toBeTruthy();
    }
  });

  it("a configured source yields a real URL for every style name", () => {
    vi.stubEnv("VITE_BASEMAP_SOURCE", "protomaps-selfhost");
    vi.stubEnv("VITE_BASEMAP_PROTOMAPS_STYLE_URL", "https://tiles.example.internal/style.json");
    expect(isMapEngineConfigured()).toBe(true);
    for (const style of STYLE_NAMES) {
      expect(getMapStyles()[style]).toBe("https://tiles.example.internal/style.json");
    }
  });
});

// ─── 4. Self-hosting is WIRED, not FAKED ─────────────────────────────────

describe("self-hosted basemap: ready, not pretended", () => {
  it("a self-hosted source is registered and reachable by config", () => {
    const selfHosted = BASEMAP_SOURCE_IDS.filter((id) => BASEMAP_SOURCES[id].selfHosted);
    expect(selfHosted, "no self-hosted source is wired at all").not.toHaveLength(0);
  });

  it("no self-hosted basemap is ACTIVE in this environment — and the code says so", () => {
    // Negative claim, verified rather than asserted: with no operator URL
    // set, the self-hosted source reports itself unconfigured, and the
    // operator-facing reason NAMES the missing setting.
    vi.stubEnv("VITE_BASEMAP_PROTOMAPS_STYLE_URL", "");
    vi.stubEnv("VITE_BASEMAP_SOURCE", "protomaps-selfhost");
    const source = getActiveBasemapSource();
    expect(source.selfHosted && source.isConfigured()).toBe(false);
    expect(getMapUnconfiguredReason()).toMatch(/VITE_BASEMAP_PROTOMAPS_STYLE_URL/);
  });

  it("becomes active only when an operator actually supplies the style URL", () => {
    vi.stubEnv("VITE_BASEMAP_SOURCE", "protomaps-selfhost");
    vi.stubEnv("VITE_BASEMAP_PROTOMAPS_STYLE_URL", "https://tiles.example.internal/style.json");
    const source = getActiveBasemapSource();
    expect(source.selfHosted && source.isConfigured()).toBe(true);
    expect(getMapUnconfiguredReason()).toBeNull();
  });

  it("no tile assets are committed to the repo (the self-hosted path is unprovisioned)", () => {
    // Proves the named absence: if someone commits PMTiles/MBTiles, this
    // fails and the "wired but not provisioned" story must be re-told.
    const roots = ["client/public", "public", "assets"].map((r) => path.join(REPO_ROOT, r));
    const found: string[] = [];
    const walk = (dir: string, depth = 0) => {
      if (depth > 4 || !fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, depth + 1);
        else if (/\.(pmtiles|mbtiles)$/i.test(entry.name)) found.push(full);
      }
    };
    roots.forEach((r) => walk(r));
    expect(found, `tile assets committed: ${found.join(", ")}`).toEqual([]);
  });

  it("the module does not claim self-hosting as a present-tense fact", () => {
    // The Protomaps source must be described as unprovisioned/operator-set,
    // not as something already serving tiles.
    expect(basemapSrc).toMatch(/WIRED, NOT PROVISIONED/);
  });
});

// ─── 5. Component wiring — source-shape, no DOM ──────────────────────────

describe("property-map.tsx honors the registry", () => {
  it("hardcodes no vendor STYLE url — every style comes through the registry", () => {
    const hits = [...propertyMapCode.matchAll(/mapbox:\/\/styles\/[^"'`]+/g)].map((m) => m[0]);
    expect(
      hits,
      `hardcoded style URLs bypass the basemap registry (maplibre-gl cannot resolve mapbox:// URLs): ${hits.join(", ")}`,
    ).toEqual([]);
  });

  /**
   * The honest counterweight to the assertion above.
   *
   * Styles now route through the registry, but property-map.tsx still binds
   * `mapbox://mapbox.mapbox-terrain-*` TILESETS directly for 3D terrain, DEM
   * hillshade and contour lines. Those are Mapbox-account-scoped tilesets
   * that maplibre-gl cannot fetch, so the MapLibre path is NOT free of Mapbox
   * yet — and this suite must not let "styles are abstracted" be mistaken for
   * "the engine switch is done".
   *
   * Down-only, like every ratchet here: substituting an open DEM source
   * (e.g. AWS terrain tiles) lowers it. Nothing may raise it.
   */
  const MAPBOX_TILESET_COUPLING_BASELINE = 4;
  it(`still has exactly ${MAPBOX_TILESET_COUPLING_BASELINE} mapbox-only tileset bindings — the switch is not done`, () => {
    const tilesets = [...propertyMapCode.matchAll(/mapbox:\/\/(?!styles\/)[^"'`]+/g)].map((m) => m[0]);
    expect(
      tilesets.length,
      `mapbox-only tilesets found: ${[...new Set(tilesets)].join(", ")} — this count may only SHRINK; lower the baseline in the same change that removes one`,
    ).toBeLessThanOrEqual(MAPBOX_TILESET_COUPLING_BASELINE);
  });

  it("every map instance is given the active source's attribution", () => {
    const mapSites = (propertyMapCode.match(/new gl\.Map\(/g) ?? []).length;
    // -1: the helper's own declaration also matches the call pattern.
    const attaches = (propertyMapCode.match(/attachBasemapAttribution\(/g) ?? []).length - 1;
    expect(mapSites, "no map is constructed in property-map.tsx — the shape assumption is stale").toBeGreaterThan(0);
    expect(
      attaches,
      `${mapSites} map instance(s) constructed but ${attaches} attribution attachment(s) — an unattributed basemap is a licence breach`,
    ).toBe(mapSites);
  });

  it("suppresses the default attribution control wherever it supplies its own", () => {
    const suppressed = (propertyMapCode.match(/attributionControl:\s*false/g) ?? []).length;
    const mapSites = (propertyMapCode.match(/new gl\.Map\(/g) ?? []).length;
    expect(suppressed, "double attribution controls would render the notice twice").toBe(mapSites);
  });

  /**
   * The platform-wide truth, pinned so it cannot be overstated.
   *
   * property-map.tsx routes through the registry. TWO other client surfaces
   * bind a GL engine directly and hardcode `mapbox://` styles, so they are
   * unaffected by VITE_BASEMAP_SOURCE and would still hit Mapbox after a
   * switch:
   *
   *   • client/src/pages/outreach/mail/eddm.tsx (Deals door → direct mail)
   *   • client/src/components/parcels/subdivision-plan-editor.tsx
   *     (@mapbox/mapbox-gl-draw — no maplibre-gl-draw equivalent wired)
   *
   * Enumerated by scanning for real engine imports rather than a hardcoded
   * list, so a NEW bypassing surface fails this immediately. Down-only.
   */
  const REGISTRY_BYPASS_BASELINE = 2;
  it(`exactly ${REGISTRY_BYPASS_BASELINE} client surfaces still bypass the basemap registry`, () => {
    const clientRoot = path.join(REPO_ROOT, "client/src");
    const bypassers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const src = fs.readFileSync(full, "utf8");
          if (!/^import\s+\w+\s+from\s+"(mapbox-gl|maplibre-gl)";$/m.test(src)) continue;
          if (/from "@\/lib\/(map-engine|basemap)"/.test(src)) continue;
          bypassers.push(path.relative(REPO_ROOT, full));
        }
      }
    };
    walk(clientRoot);
    expect(
      bypassers.length,
      `surfaces binding a GL engine outside the registry: ${bypassers.join(", ")} — a basemap switch does NOT reach these. This count may only SHRINK.`,
    ).toBeLessThanOrEqual(REGISTRY_BYPASS_BASELINE);
  });

  it("static map images carry their own rendered attribution", () => {
    // A static <img> has no GL control, so the notice must be in the DOM.
    expect(propertyMapSrc).toMatch(/function StaticMapAttribution\(/);
    const uses = (propertyMapSrc.match(/<StaticMapAttribution\s*\/>/g) ?? []).length;
    const imgs = (propertyMapSrc.match(/data-testid="static-property-map/g) ?? []).length;
    expect(uses, `${imgs} static map render path(s) but ${uses} attribution element(s)`).toBe(imgs);
    expect(STATIC_MAP_ATTRIBUTION.trim()).not.toBe("");
  });

  it("the static-image path gates on its OWN provider, not the interactive engine", () => {
    // Once a MapLibre source is active, isMapEngineConfigured() can be true
    // while no Mapbox token exists — which would render <img src="">.
    expect(propertyMapSrc).toMatch(/isStaticMapConfigured\(\)/);
    vi.stubEnv("VITE_BASEMAP_SOURCE", "protomaps-selfhost");
    vi.stubEnv("VITE_BASEMAP_PROTOMAPS_STYLE_URL", "https://tiles.example.internal/style.json");
    vi.stubEnv("VITE_MAPBOX_ACCESS_TOKEN", "");
    expect(isMapEngineConfigured()).toBe(true);
    expect(isStaticMapConfigured()).toBe(false);
    expect(buildStaticMapUrl({ longitude: -105, latitude: 39, zoom: 14, width: 400, height: 300 })).toBeNull();
  });
});

// ─── 6. Slice-6 behaviour pins — the map door still fails honestly ───────

describe("maps.tsx keeps slice-6 query-error honesty", () => {
  it("both MAP-CANVAS queries THROW on a failed response (never an empty-success)", () => {
    // Scoped to the two queries slice 6 actually fixed — the ones that paint
    // the canvas. Each is located by its queryKey and its own queryFn body is
    // checked, so this cannot be satisfied by a throw somewhere else.
    for (const key of ["/api/properties", "/api/deals"]) {
      const block = mapsPageSrc.slice(mapsPageSrc.indexOf(`queryKey: ["${key}"]`));
      const body = block.slice(0, block.indexOf("retry: false"));
      expect(body, `${key} queryFn not found in maps.tsx`).toContain("await fetch");
      expect(
        body,
        `${key} swallows a failed response — an outage would paint as an empty portfolio`,
      ).toMatch(/if\s*\(!res\.ok\)\s*throw new Error/);
      expect(body).not.toMatch(/if\s*\(!res\.ok\)\s*(?:return|\{\s*return)/);
    }
  });

  /**
   * Honest residue, pinned rather than hidden.
   *
   * maps.tsx still contains ONE queryFn that swallows a failure into a
   * successful `null` — the `/api/avm` side-panel estimate (around line 464).
   * It is outside the map canvas that slice 6 hardened and outside Wave 2.1's
   * file brief, so it is recorded here instead of quietly fixed or quietly
   * ignored. Down-only: fixing it lowers the baseline.
   */
  const SWALLOWING_QUERYFN_BASELINE = 1;
  it(`has at most ${SWALLOWING_QUERYFN_BASELINE} remaining swallowing queryFn (the /api/avm side panel)`, () => {
    // codeOnly: slice 6's own explanatory comment quotes the old
    // `if (!res.ok) return []` line, and counting prose would inflate this.
    const swallows = mapsPageCode.match(/if\s*\(!res(?:ponse)?\.ok\)\s*(?:return|\{\s*return)/g) ?? [];
    expect(
      swallows.length,
      `swallowing queryFns in maps.tsx: ${swallows.length} — this count may only SHRINK`,
    ).toBeLessThanOrEqual(SWALLOWING_QUERYFN_BASELINE);
  });

  it("a hard error renders QueryErrorState, not the empty state", () => {
    expect(mapsPageSrc).toMatch(/mapHardError/);
    expect(mapsPageSrc).toMatch(/<QueryErrorState/);
    expect(mapsPageSrc).toMatch(/testId="maps-query-error"/);
  });

  it("an error over cached pins keeps the map up behind the stale chip", () => {
    expect(mapsPageSrc).toMatch(/mapStaleError/);
    expect(mapsPageSrc).toMatch(/<StaleDataChip/);
    expect(mapsPageSrc).toMatch(/testId="maps-stale-chip"/);
  });

  it("deals mode still gates the canvas on the deals query", () => {
    expect(mapsPageSrc).toMatch(/mapMode === "deals" && dealsHardError/);
  });
});
