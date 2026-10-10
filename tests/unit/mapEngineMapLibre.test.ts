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
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

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

  it("the CSP lets the browser reach the new tile hosts", () => {
    const csp = stripComments(readFileSync(path.join(root, "server/middleware/security.ts"), "utf8"));
    for (const host of ["tiles.openfreemap.org", "basemap.nationalmap.gov", "imagery.nationalmap.gov", "s3.amazonaws.com"]) {
      expect(csp, host).toContain(`https://${host}`);
    }
  });
});
