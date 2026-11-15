/**
 * TN county boundary shapes are served as static JSON, not bundled as JS.
 *
 * shared/landData/tnCountyBoundaries.json (~52 KB of simplified TIGER
 * GeoJSON, 95 counties) used to be imported by LandCoveragePanel, which
 * put every byte inside the bundle gate's summed JS total
 * (scripts/check-bundle-size.js counts every emitted .js file). The file
 * now ships as a static asset (vite.config.ts tnBoundariesPlugin copies
 * it verbatim into dist/public/land-data/) and the panel fetches it on
 * demand via client/src/lib/tn-boundaries.ts. That stays safe only while:
 *
 *   1. the panel never imports the JSON (or any .json) again — a shape
 *      file that sneaks back into the bundle silently re-spends the
 *      headroom this slice freed;
 *   2. the loader and the plugin agree on the served URL, and the plugin
 *      keeps copying the source file verbatim and serving it in dev;
 *   3. a failed fetch rejects instead of resolving an empty result (the
 *      empty-on-failure ratchet's rule, pinned here like the /learn
 *      registries pin theirs);
 *   4. the source file keeps the shape the loader's types describe —
 *      the server imports the same file directly (tnCountyAt, release
 *      lineage), so its shape is a shared contract, not a client detail.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.join(__dirname, "../..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

const panel = stripComments(read("client/src/components/maps/LandCoveragePanel.tsx"));
const loader = stripComments(read("client/src/lib/tn-boundaries.ts"));
const config = stripComments(read("vite.config.ts"));

describe("the boundary shapes are not bundled", () => {
  it("the panel imports no JSON and never names the bundled file", () => {
    expect(panel, "panel must not import a .json body").not.toMatch(/from\s*["'][^"']*\.json["']/);
    expect(panel, "panel must not reference tnCountyBoundaries").not.toMatch(/tnCountyBoundaries/);
  });

  it("the panel draws its fills from the fetched boundaries", () => {
    expect(panel).toMatch(/import\s*\{\s*fetchTnBoundaries\s*\}\s*from\s*["']@\/lib\/tn-boundaries["']/);
    expect(panel).toMatch(/fetchTnBoundaries\(\)/);
    expect(panel).toMatch(/map\.addSource\("tn-coverage"/);
  });
});

describe("the loader fetches the served asset and fails loudly", () => {
  it("exposes the fetch and the URL the plugin serves", () => {
    expect(loader).toMatch(/export function fetchTnBoundaries\(/);
    expect(loader).toMatch(/export const TN_BOUNDARIES_URL = "\/land-data\/tn-county-boundaries\.json";/);
    expect(loader).toMatch(/fetch\(TN_BOUNDARIES_URL\)/);
  });

  it("a failed fetch rejects instead of resolving an empty result", () => {
    // The empty-on-failure ratchet bans `if (!res.ok) return null` in
    // client code; the loader must throw so a broken asset can never
    // render as a map with no counties. Pin the throw.
    expect(loader).toMatch(/if \(!res\.ok\) \{\s*throw new Error/);
  });
});

describe("the Vite plugin wires the verbatim copy and dev serving", () => {
  it("registers the plugin and serves the loader's URL", () => {
    expect(config).toMatch(/function tnBoundariesPlugin\(\): Plugin/);
    expect(config).toMatch(/plugins:\s*\[[^\]]*tnBoundariesPlugin\(\)/s);
    expect(config).toMatch(/const TN_BOUNDARIES_URL = "\/land-data\/tn-county-boundaries\.json";/);
  });

  it("copies the source file verbatim into the build output and serves it in dev", () => {
    expect(config).toMatch(/path\.join\(rootDir, "shared", "landData", "tnCountyBoundaries\.json"\)/);
    expect(config).toMatch(/fs\.copyFileSync\(sourcePath, dest\)/);
    expect(config).toMatch(/configureServer\(server\)/);
  });
});

describe("the loader's fetch behaviour", () => {
  it("resolves the parsed boundaries and shares one request across callers", async () => {
    vi.resetModules();
    const body = { type: "FeatureCollection", features: [] };
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { fetchTnBoundaries, TN_BOUNDARIES_URL } = await import("../../client/src/lib/tn-boundaries");
      await expect(fetchTnBoundaries()).resolves.toBe(body);
      await expect(fetchTnBoundaries()).resolves.toBe(body);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(TN_BOUNDARIES_URL);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects on a non-ok response, and a later caller can retry", async () => {
    vi.resetModules();
    const failing = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    vi.stubGlobal("fetch", failing);
    try {
      const { fetchTnBoundaries } = await import("../../client/src/lib/tn-boundaries");
      await expect(fetchTnBoundaries()).rejects.toThrow(/503/);
      const body = { type: "FeatureCollection", features: [] };
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => body })));
      await expect(fetchTnBoundaries()).resolves.toBe(body);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("the source file keeps the shape the loader describes", () => {
  const parsed: unknown = JSON.parse(read("shared/landData/tnCountyBoundaries.json"));

  it("is a FeatureCollection of the 95 TN counties (vacuity + shape)", () => {
    expect(parsed).toBeTypeOf("object");
    const fc = parsed as { type?: unknown; features?: unknown };
    expect(fc.type).toBe("FeatureCollection");
    expect(Array.isArray(fc.features)).toBe(true);
    const features = fc.features as Array<{
      type?: unknown;
      properties?: { fips?: unknown; name?: unknown };
      geometry?: { type?: unknown; coordinates?: unknown };
    }>;
    expect(features.length).toBe(95);
    for (const f of features) {
      expect(f.type).toBe("Feature");
      expect(typeof f.properties?.fips).toBe("string");
      expect(typeof f.properties?.name).toBe("string");
      expect(["Polygon", "MultiPolygon"]).toContain(f.geometry?.type);
      expect(Array.isArray(f.geometry?.coordinates)).toBe(true);
    }
  });
});
