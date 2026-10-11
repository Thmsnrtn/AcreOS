/**
 * Offline field maps (W5b): every map source the engine draws from is
 * classified for offline caching, only "allowed" sources are ever saved, and
 * the four pieces that must agree — the shared registry, the page-side store,
 * the service worker and the offline viewer — name the same caches and hosts.
 * (The airplane-mode behaviour itself is proven by the Playwright spec
 * tests/e2e-offline/offlineFieldMap.spec.ts.)
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  OFFLINE_AREA_MAX_TILES,
  OFFLINE_MAP_SOURCES,
  cacheableOfflineSources,
  offlineSourceForUrl,
  tilesForBbox,
} from "../../shared/map/offlineSources";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

describe("the licence registry covers the map engine", () => {
  it("every tile/style host in map-engine.ts is classified", () => {
    const engine = stripComments(read("client/src/lib/map-engine.ts"));
    const urls = [...engine.matchAll(/"(https:\/\/[^"]+)"/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThanOrEqual(4);
    for (const u of urls) expect(offlineSourceForUrl(u), u).not.toBeNull();
  });

  it("NAIP is allowed (public domain); OpenFreeMap is refused (its terms forbid automated collection); unchecked is not cached", () => {
    const byId = Object.fromEntries(OFFLINE_MAP_SOURCES.map((s) => [s.id, s]));
    expect(byId.naip.policy).toBe("allowed");
    expect(byId.openfreemap.policy).toBe("forbidden");
    expect(byId.openfreemap.terms).toMatch(/automated ways without permission/);
    expect(byId.terrarium.policy).toBe("unchecked");
    expect(cacheableOfflineSources().map((s) => s.id)).toEqual(["naip"]);
  });

  it("the engine's NAIP URL is the registry's", () => {
    const engine = read("client/src/lib/map-engine.ts");
    const naip = /NAIP_TILE_URL =\s*"([^"]+)"/.exec(engine)?.[1];
    expect(naip).toBe(OFFLINE_MAP_SOURCES.find((s) => s.id === "naip")!.tileUrl);
  });
});

describe("the store never saves a refused source, and caps an area", () => {
  it("planOfflineArea only plans tiles from allowed hosts", async () => {
    const { planOfflineArea } = await import("../../client/src/lib/offline-map-store");
    const plan = planOfflineArea({ west: -98.01, south: 30.0, east: -97.99, north: 30.02 }, 10, 16);
    expect(plan.tiles.length).toBeGreaterThan(0);
    for (const t of plan.tiles) expect(new URL(t).host).toBe("basemap.nationalmap.gov");
    expect(plan.refused.map((s) => s.id).sort()).toEqual(["openfreemap", "terrarium"]);
  });
  it("a 5-mile area at z10–16 fits the cap; a whole county at z16 does not", () => {
    const small = tilesForBbox({ west: -98.08, south: 29.93, east: -97.92, north: 30.07 }, 10, 16).length;
    expect(small).toBeLessThanOrEqual(OFFLINE_AREA_MAX_TILES);
    const county = tilesForBbox({ west: -98.6, south: 29.6, east: -97.4, north: 30.6 }, 10, 16).length;
    expect(county).toBeGreaterThan(OFFLINE_AREA_MAX_TILES);
  });
});

describe("store, service worker and viewer agree", () => {
  const store = read("client/src/lib/offline-map-store.ts");
  const sw = read("client/public/sw.js");
  const viewer = read("client/public/offline-map.js");
  const constOf = (src: string, name: string) => new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`).exec(src)?.[1];

  it("the tile cache name matches and survives the worker's activate sweep (no acreos- prefix)", () => {
    const name = constOf(store, "OFFLINE_TILE_CACHE");
    expect(name).toBeTruthy();
    expect(constOf(sw, "OFFLINE_TILE_CACHE")).toBe(name);
    expect(name!.startsWith("acreos-")).toBe(false);
    expect(constOf(store, "OFFLINE_SHELL_CACHE")!.startsWith("acreos-")).toBe(false);
  });
  it("the IndexedDB names match between the app and the offline viewer", () => {
    expect(constOf(viewer, "DB_NAME")).toBe(constOf(store, "OFFLINE_DB_NAME"));
    expect(constOf(viewer, "DB_STORE")).toBe(constOf(store, "OFFLINE_DB_STORE"));
  });
  it("the worker serves offline tiles for exactly the allowed hosts", () => {
    const hosts = /OFFLINE_TILE_HOSTS\s*=\s*\[([^\]]*)\]/.exec(sw)?.[1] ?? "";
    const listed = [...hosts.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(listed).toEqual(cacheableOfflineSources().map((s) => new URL(s.tileUrl.replace(/\{[a-z]+\}/g, "0")).host).sort());
  });
  it("the viewer draws only saved tiles and says how old they are", () => {
    expect(viewer).toMatch(/if \(!saved\[url\]\) continue;/);
    expect(viewer).toMatch(/"Offline since "/);
  });
  it("the store precaches the viewer itself", () => {
    expect(store).toMatch(/OFFLINE_SHELL_URLS = \["\/offline-map\.html", "\/offline-map\.js"\]/);
    expect(fs.existsSync(path.join(ROOT, "client/public/offline-map.html"))).toBe(true);
  });
});
