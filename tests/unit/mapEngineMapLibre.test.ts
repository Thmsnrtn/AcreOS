/**
 * W2 map cost — every map renders on MapLibre with free basemaps, no Mapbox
 * token and no mapbox:// source.
 *
 * Population: every client file that imports a map renderer (found by walking
 * client/src, not a hand list), plus the engine module. Each must import
 * maplibre-gl (never mapbox-gl), and none may reference a mapbox:// URL or the
 * Mapbox Static Images API. A vacuity floor pins that the walk still finds the
 * three map surfaces (property map, EDDM map, subdivision editor).
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

// Strips every client/src file — declared budget, not the 30s default.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const root = path.resolve(__dirname, "../..");
const clientSrc = path.join(root, "client/src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(clientSrc).map((f) => ({ f: path.relative(root, f), src: stripComments(readFileSync(f, "utf8")) }));
const RENDERER_IMPORT = /from\s+["'](maplibre-gl|mapbox-gl)["']/;

describe("map engine — MapLibre + free basemaps", () => {
  const mapFiles = files.filter((x) => RENDERER_IMPORT.test(x.src));

  it("the walk finds the map surfaces (vacuity floor)", () => {
    const names = mapFiles.map((x) => x.f);
    for (const must of [
      "client/src/lib/map-engine.ts",
      "client/src/components/property-map.tsx",
      "client/src/pages/outreach/mail/eddm.tsx",
      "client/src/components/parcels/subdivision-plan-editor.tsx",
    ]) expect(names, must).toContain(must);
  });

  it("no client file imports mapbox-gl or its stylesheet", () => {
    for (const { f, src } of files) {
      expect(src, f).not.toMatch(/from\s+["']mapbox-gl["']/);
      expect(src, f).not.toMatch(/["']mapbox-gl\/dist/);
    }
  });

  it("no client file uses a mapbox:// source or the Mapbox Static Images API", () => {
    for (const { f, src } of files) {
      expect(src, f).not.toMatch(/mapbox:\/\//);
      expect(src, f).not.toMatch(/api\.mapbox\.com\/styles/);
      expect(src, f).not.toMatch(/accessToken\s*=/);
    }
  });

  it("map surfaces take their style from the engine (no per-file basemap URLs)", () => {
    for (const { f, src } of mapFiles) {
      if (f.endsWith("map-engine.ts")) continue;
      expect(src, f).toMatch(/STYLE_URLS/);
    }
  });

  it("the engine's styles are open: OpenFreeMap vector, NAIP imagery, terrarium DEM", async () => {
    const engine = readFileSync(path.join(clientSrc, "lib/map-engine.ts"), "utf8");
    expect(engine).toContain("https://tiles.openfreemap.org/styles/liberty");
    expect(engine).toContain("basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly");
    expect(engine).toContain("elevation-tiles-prod/terrarium");
    expect(stripComments(engine)).not.toMatch(/mapbox/i);
  });

  it("package.json drops mapbox-gl and pins maplibre-gl exactly", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps["mapbox-gl"]).toBeUndefined();
    expect(deps["@types/mapbox-gl"]).toBeUndefined();
    expect(deps["maplibre-gl"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("the MapLibre worker is bundled and its URL set before any map is built", () => {
    // maplibre-gl 6 is ESM and finds its worker at new URL("./maplibre-gl-worker.mjs",
    // import.meta.url). Vite does not emit that file, so in a production build
    // the URL 404s, "Worker failed to load", and every map stays blank (no
    // vector tile or GeoJSON is ever parsed). The engine must hand MapLibre a
    // worker Vite bundled itself, and every file that builds a map must load
    // the engine first.
    const engine = stripComments(readFileSync(path.join(clientSrc, "lib/map-engine.ts"), "utf8"));
    const m = /import\s+(\w+)\s+from\s+["']maplibre-gl\/dist\/maplibre-gl-worker\.mjs\?worker&url["']/.exec(engine);
    expect(m, "map-engine.ts must import the worker with ?worker&url").toBeTruthy();
    expect(engine).toMatch(new RegExp(`maplibregl\\.setWorkerUrl\\(${m![1]}\\)`));
    for (const { f, src } of mapFiles) {
      if (f.endsWith("map-engine.ts")) continue;
      expect(src, `${f} builds maps but does not load the engine (which sets the worker URL)`).toMatch(/from\s+["']@\/lib\/map-engine["']/);
    }
  });

  it("every symbol layer names a font the glyph server has", () => {
    // A symbol layer with no text-font falls back to MapLibre's default stack
    // ("Open Sans Regular,Arial Unicode MS Regular"), which OpenFreeMap does
    // not serve: the glyph request 404s and the labels never draw (measured in
    // a browser on the property map's APN labels, W2 audit 2026-10-10).
    let symbolLayers = 0;
    for (const { f, src } of mapFiles) {
      const re = /type:\s*["']symbol["']/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        symbolLayers++;
        // The layer object literal around this `type`: back to its opening
        // `{` at depth 0, forward to its matching `}`.
        let i = m.index, depth = 0;
        for (; i > 0; i--) { const c = src[i]; if (c === "}") depth++; else if (c === "{") { if (depth === 0) break; depth--; } }
        let j = m.index; depth = 0;
        for (; j < src.length; j++) { const c = src[j]; if (c === "{") depth++; else if (c === "}") { if (depth === 0) break; depth--; } }
        const layer = src.slice(i, j + 1);
        if (!/["']text-field["']/.test(layer)) continue;
        expect(layer, `${f}: a symbol layer with text but no text-font`).toMatch(/["']text-font["']\s*:\s*LABEL_FONT(_ITALIC)?\b/);
      }
    }
    expect(symbolLayers, "the walk found no symbol layers — the scan stopped reading").toBeGreaterThanOrEqual(2);
  });

  it("the CSP lets the browser reach the new tile hosts", () => {
    const csp = stripComments(readFileSync(path.join(root, "server/middleware/security.ts"), "utf8"));
    for (const host of ["tiles.openfreemap.org", "basemap.nationalmap.gov", "imagery.nationalmap.gov", "s3.amazonaws.com"]) {
      expect(csp, host).toContain(`https://${host}`);
    }
  });
});
