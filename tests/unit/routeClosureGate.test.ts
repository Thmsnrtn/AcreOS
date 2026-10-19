/**
 * Map code loads only on routes that render a map — the route-closure gate.
 *
 * scripts/check-route-closure.mjs reads the chunk graph the client build
 * actually produced (dist/client-chunk-graph.json) and fails when map code
 * (MapLibre and its plugins, Mapbox GL Draw, pmtiles, the app's map engine)
 * sits in the entry's static closure, in a map-free door landing's static
 * closure, or behind an import() issued by any module that loads on every page
 * other than the router. The last rule exists because the defect it was written
 * for was a dynamic edge: the mobile nav's idle "warm the doors" helper
 * imported the /maps page, so every mobile page view executed all of MapLibre
 * after first paint (measured on the 2026-10-12 build — see the PR).
 *
 * These cases run the gate's evaluator over fixture graphs shaped like a real
 * build and hide the defect in each shape the gate relies on, so a gate that
 * silently stops reading one shape goes red here. The last cases pin the
 * gate's population to the real repository: its route sources exist and are
 * the modules App.tsx lazily routes to, the map packages it names are the ones
 * package.json ships, and CI runs it after the build.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { stripComments } from "../helpers/stripComments";
import * as gate from "../../scripts/check-route-closure.mjs";

const ROOT = process.cwd();

type Chunk = {
  name: string;
  isEntry: boolean;
  isDynamicEntry: boolean;
  facadeModule: string | null;
  imports: string[];
  dynamicImports: string[];
  modules: Record<string, number>;
  bytes: number;
};
type Graph = { version: number; chunks: Record<string, Chunk>; dynamicImports: Record<string, string[]> };

function chunk(facade: string | null, modules: string[], imports: string[] = [], extra: Partial<Chunk> = {}): Chunk {
  return {
    name: facade ? path.basename(facade).replace(/\.\w+$/, "") : "shared",
    isEntry: false,
    isDynamicEntry: !!facade,
    facadeModule: facade,
    imports,
    dynamicImports: [],
    modules: Object.fromEntries(modules.map((m) => [m, 100])),
    bytes: 1000,
    ...extra,
  };
}

/** A clean graph: entry, the door landings, /maps with vendor-map, and filler up to the floor. */
function cleanGraph(): Graph {
  const chunks: Record<string, Chunk> = {
    "assets/index.js": chunk(
      "client/index.html",
      ["client/index.html", "client/src/main.tsx", "client/src/App.tsx", "client/src/lib/door-prefetch.ts"],
      ["assets/vendor-react.js"],
      { isEntry: true, isDynamicEntry: false },
    ),
    "assets/vendor-react.js": chunk(null, ["node_modules/react/index.js"]),
    "assets/QuickAddSheet.js": chunk("client/src/components/mobile/QuickAddSheet.tsx", [
      "client/src/components/mobile/QuickAddSheet.tsx",
      "node_modules/zod/index.js",
    ]),
    "assets/shared-ui.js": chunk(null, ["client/src/components/ui/button.tsx"], ["assets/vendor-react.js"]),
    "assets/vendor-map.js": chunk(null, ["node_modules/maplibre-gl/dist/maplibre-gl.js", "node_modules/pmtiles/dist/index.js"]),
    "assets/map-engine.js": chunk(null, ["client/src/lib/map-engine.ts"], ["assets/vendor-map.js"]),
    "assets/maps.js": chunk("client/src/pages/maps.tsx", ["client/src/pages/maps.tsx"], ["assets/map-engine.js", "assets/shared-ui.js"]),
  };
  for (const r of gate.MAP_FREE_ROUTES as Array<{ source: string }>) {
    const f = `assets/${path.basename(r.source).replace(/\.\w+$/, "")}.js`;
    chunks[f] = chunk(r.source, [r.source], ["assets/shared-ui.js"]);
  }
  for (let i = 0; Object.keys(chunks).length < gate.MIN_CHUNKS; i++) {
    chunks[`assets/filler-${i}.js`] = chunk(`client/src/pages/filler-${i}.tsx`, [`client/src/pages/filler-${i}.tsx`]);
  }
  return {
    version: 2,
    chunks,
    dynamicImports: {
      "client/src/App.tsx": [
        "client/src/pages/maps.tsx",
        ...(gate.MAP_FREE_ROUTES as Array<{ source: string }>).map((r) => r.source),
      ],
      "client/src/lib/door-prefetch.ts": ["client/src/pages/today.tsx", "client/src/pages/deals.tsx"],
    },
  };
}

const failuresOf = (g: Graph): string[] => gate.evaluate(g).failures;

describe("route-closure gate — fixture graphs", () => {
  it("a clean graph passes, and reports the /maps closure as map-bearing", () => {
    const { failures, rows } = gate.evaluate(cleanGraph());
    expect(failures).toEqual([]);
    expect(rows.find((r) => r.route === "/maps")!.mapModules).toBeGreaterThan(0);
    expect(rows.find((r) => r.route === "/today")!.mapModules).toBe(0);
  });

  it("map code reached by Today through a NESTED shared chunk fails (not just a direct import)", () => {
    const g = cleanGraph();
    g.chunks["assets/shared-ui.js"].imports.push("assets/map-engine.js");
    const f = failuresOf(g);
    expect(f.some((x) => x.startsWith("/today static closure") && x.includes("maplibre-gl"))).toBe(true);
  });

  it("map code merged INTO a chunk the entry already loads fails (a manualChunks merge)", () => {
    const g = cleanGraph();
    g.chunks["assets/vendor-react.js"].modules["node_modules/@mapbox/mapbox-gl-draw/index.js"] = 1;
    expect(failuresOf(g).some((x) => x.startsWith("entry closure") && x.includes("mapbox-gl-draw"))).toBe(true);
  });

  it("the app's own map engine counts as map code, not only node_modules", () => {
    const g = cleanGraph();
    g.chunks["assets/deals.js"].modules["client/src/lib/map-engine.ts"] = 1;
    expect(failuresOf(g).some((x) => x.startsWith("/deals static closure"))).toBe(true);
  });

  it("a shell module that import()s the map page fails — the idle door-warm defect", () => {
    const g = cleanGraph();
    g.dynamicImports["client/src/lib/door-prefetch.ts"].push("client/src/pages/maps.tsx");
    const f = failuresOf(g);
    expect(f.some((x) => x.includes("client/src/lib/door-prefetch.ts") && x.includes("maps.tsx"))).toBe(true);
  });

  it("…and so does a shell module that import()s a chunk that only STATICALLY reaches map code", () => {
    const g = cleanGraph();
    g.chunks["assets/helper.js"] = chunk("client/src/lib/helper.ts", ["client/src/lib/helper.ts"], ["assets/map-engine.js"]);
    g.dynamicImports["client/src/main.tsx"] = ["client/src/lib/helper.ts"];
    expect(failuresOf(g).some((x) => x.includes("client/src/main.tsx") && x.includes("helper.ts"))).toBe(true);
  });

  it("a door landing that import()s map code at mount fails (not only shell modules)", () => {
    const g = cleanGraph();
    g.dynamicImports["client/src/pages/today.tsx"] = ["client/src/lib/map-engine.ts"];
    const f = failuresOf(g);
    expect(f.some((x) => x.startsWith("/today: client/src/pages/today.tsx") && x.includes("map-engine.ts"))).toBe(true);
  });

  it("…including from a shared chunk in that landing's static closure", () => {
    const g = cleanGraph();
    g.chunks["assets/money.js"].imports.push("assets/money-panel.js");
    g.chunks["assets/money-panel.js"] = chunk(null, ["client/src/components/money-panel.tsx"]);
    g.dynamicImports["client/src/components/money-panel.tsx"] = ["client/src/pages/maps.tsx"];
    expect(failuresOf(g).some((x) => x.startsWith("/money: client/src/components/money-panel.tsx"))).toBe(true);
  });

  it("the router's own lazy import of /maps is the one allowed dynamic edge", () => {
    expect(failuresOf(cleanGraph())).toEqual([]);
  });

  it("an entry-excluded module (the quick-add sheet) merged into the entry closure fails", () => {
    const g = cleanGraph();
    g.chunks["assets/vendor-react.js"].modules["client/src/components/mobile/QuickAddSheet.tsx"] = 1;
    delete g.chunks["assets/QuickAddSheet.js"].modules["client/src/components/mobile/QuickAddSheet.tsx"];
    expect(failuresOf(g).some((x) => x.startsWith("entry closure contains client/src/components/mobile/QuickAddSheet.tsx"))).toBe(true);
  });

  it("vacuity: an entry-excluded module absent from the whole build fails", () => {
    const g = cleanGraph();
    g.chunks["assets/QuickAddSheet.js"].modules = { "client/src/components/mobile/QuickAdd2.tsx": 1 };
    expect(failuresOf(g).some((x) => x.includes("is in no chunk of this build"))).toBe(true);
  });

  it("every entry-excluded module exists in the source tree", () => {
    const list = gate.ENTRY_EXCLUDED_MODULES;
    expect(list.length).toBeGreaterThanOrEqual(1);
    for (const { module } of list) expect(existsSync(path.join(ROOT, module)), module).toBe(true);
  });

  it("a renamed or eager door page fails rather than being skipped", () => {
    const g = cleanGraph();
    g.chunks["assets/today.js"].facadeModule = "client/src/pages/today-v2.tsx";
    expect(failuresOf(g).some((x) => x.startsWith("/today: expected exactly one chunk"))).toBe(true);
  });

  it("vacuity: /maps with no map module fails (the predicate stopped matching real ids)", () => {
    const g = cleanGraph();
    g.chunks["assets/map-engine.js"].imports = [];
    g.chunks["assets/map-engine.js"].modules = { "client/src/lib/renamed-engine.ts": 1 };
    const f = failuresOf(g);
    expect(f.some((x) => x.includes("/maps renders a map"))).toBe(true);
    expect(f.some((x) => x.includes("rule 2 (shell warmers) would be vacuous"))).toBe(true);
  });

  it("vacuity: a graph without the module-level dynamic-import record fails", () => {
    const g = cleanGraph() as Partial<Graph>;
    delete g.dynamicImports;
    expect(failuresOf(g as Graph).some((x) => x.includes("dynamicImports"))).toBe(true);
  });

  it("vacuity: a graph below the chunk floor, or with no HTML entry, fails", () => {
    const g = cleanGraph();
    const small: Graph = { ...g, chunks: Object.fromEntries(Object.entries(g.chunks).slice(0, 5)) };
    expect(failuresOf(small).some((x) => x.includes("below the floor"))).toBe(true);
    const noEntry = cleanGraph();
    noEntry.chunks["assets/index.js"].isEntry = false;
    expect(failuresOf(noEntry).some((x) => x.includes("index.html entry chunk"))).toBe(true);
  });

  it("the CLI exits 1 on a violating graph and 0 on a clean one", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "route-closure-"));
    const bad = cleanGraph();
    bad.dynamicImports["client/src/lib/door-prefetch.ts"].push("client/src/pages/maps.tsx");
    writeFileSync(path.join(dir, "bad.json"), JSON.stringify(bad));
    writeFileSync(path.join(dir, "ok.json"), JSON.stringify(cleanGraph()));
    const script = path.join(ROOT, "scripts/check-route-closure.mjs");
    const runOn = (f: string) => spawnSync(process.execPath, [script, "--graph", path.join(dir, f)], { encoding: "utf8" });
    expect(runOn("bad.json").status).toBe(1);
    expect(runOn("ok.json").status).toBe(0);
    expect(runOn("missing.json").status).toBe(1);
  });
});

describe("route-closure gate — population pinned to the real repository", () => {
  const app = stripComments(readFileSync(path.join(ROOT, "client/src/App.tsx"), "utf8"));
  const lazySpecifiers = new Set(
    [...app.matchAll(/React\.lazy\(\s*\(\)\s*=>\s*import\(\s*["']@\/([^"']+)["']\s*\)/g)].map((m) => m[1]),
  );

  it("every route the gate checks is a real page App.tsx lazily routes to", () => {
    expect(lazySpecifiers.size).toBeGreaterThan(50);
    const routes = [...(gate.MAP_FREE_ROUTES as Array<{ route: string; source: string }>), gate.MAP_ROUTE];
    expect(routes.length).toBeGreaterThanOrEqual(7);
    for (const r of routes) {
      expect(existsSync(path.join(ROOT, r.source)), r.source).toBe(true);
      const spec = r.source.replace(/^client\/src\//, "").replace(/\.tsx?$/, "");
      expect(lazySpecifiers.has(spec), `${r.route}: App.tsx has no React.lazy(import("@/${spec}"))`).toBe(true);
      expect(app.includes(`path="${r.route}"`), `App.tsx has no <Route path="${r.route}">`).toBe(true);
    }
  });

  it("the gate covers every customer door landing except Map, which is the canary", () => {
    const covered = new Set((gate.MAP_FREE_ROUTES as Array<{ route: string }>).map((r) => r.route));
    for (const r of ["/today", "/deals", "/money", "/ai", "/inbox", "/settings"]) expect(covered.has(r), r).toBe(true);
    expect(gate.MAP_ROUTE.route).toBe("/maps");
  });

  it("every map package the app depends on is matched by the map predicate", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const deps = Object.keys(pkg.dependencies ?? {});
    const mapPkgs = deps.filter((d) => /maplibre|mapbox|pmtiles/.test(d));
    expect(mapPkgs.length).toBeGreaterThanOrEqual(4);
    for (const d of mapPkgs) expect(gate.isMapModule(`node_modules/${d}/dist/index.js`), d).toBe(true);
    expect(gate.isMapModule("node_modules/react/index.js")).toBe(false);
    expect(gate.isMapModule("client/src/pages/maps.tsx")).toBe(false);
  });

  it("the router exemption names the module that holds the route table", () => {
    expect(gate.ROUTER_MODULE).toBe("client/src/App.tsx");
    expect(lazySpecifiers.has("pages/maps")).toBe(true);
  });

  it("CI runs the gate after the build, against a required build", () => {
    const ci = yaml.load(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
      jobs: Record<string, { steps: Array<{ run?: string }> }>;
    };
    const runs = ci.jobs.build.steps.map((s) => s.run ?? "");
    const build = runs.findIndex((r) => /npm run build/.test(r));
    const g = runs.findIndex((r) => /node scripts\/check-route-closure\.mjs/.test(r));
    expect(build).toBeGreaterThan(-1);
    expect(g).toBeGreaterThan(build);
  });
});
