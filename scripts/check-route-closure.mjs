#!/usr/bin/env node
/**
 * Route-closure gate: map code loads only on routes that render a map.
 *
 * Reads the chunk graph Rollup actually produced (dist/client-chunk-graph.json,
 * written beside the served directory by chunkGraphPlugin in vite.config.ts) — NOT source text. For the app entry and each
 * customer door's landing route it computes the STATIC import closure: the
 * route's own chunk plus every chunk reachable through static `imports`. That
 * is exactly what the browser must download before the route can render —
 * Vite modulepreloads the entry's static imports from index.html and its
 * __vitePreload helper fetches a lazy route chunk's static imports alongside
 * it. Dynamic imports are excluded: they load only when the code that calls
 * them runs.
 *
 * The property: no module in the entry closure, or in the closure of a door
 * landing that does not render a map, is map code (MapLibre, its plugins,
 * Mapbox GL Draw, pmtiles, or the app's own map engine/components). Because
 * the predicate reads the modules bundled into each chunk, an equivalent
 * reintroduction — a re-export, a barrel file, a helper that imports the map
 * engine, a manualChunks rule that merges map code into a shared chunk — is
 * caught the same as a direct `import maplibregl from "maplibre-gl"`.
 *
 * Rule 1b: modules in ENTRY_EXCLUDED_MODULES (UI that renders nothing until a
 * user acts) are absent from the entry closure.
 *
 * Rule 2 (shellWarmers): no module that loads on every page — anything in the
 * entry closure except the router's React.lazy() table — may import() a module
 * whose closure carries map code. That edge is dynamic, so static closures
 * cannot see it; an idle "warm the doors" prefetch in the mobile nav did
 * exactly this and executed all of MapLibre on Today.
 *
 * Population floors, so the gate cannot pass over nothing:
 *   · the graph must hold at least MIN_CHUNKS chunks and exactly one HTML entry;
 *   · every route listed below must resolve to exactly one chunk whose facade
 *     is that source file (a renamed page FAILS, it is never skipped);
 *   · the map route (/maps) MUST contain map code in its closure — if the
 *     predicate stops matching real module ids (a renamed package, a path
 *     format change), that canary goes red rather than every route reading
 *     as clean.
 *
 * Usage:
 *   node scripts/check-route-closure.mjs                 # skip if no build (local)
 *   node scripts/check-route-closure.mjs --require-build # missing graph FAILS
 *   CI=true node scripts/check-route-closure.mjs         # same, implied by CI
 *   node scripts/check-route-closure.mjs --graph <file>  # explicit graph (tests)
 *   node scripts/check-route-closure.mjs --json          # machine-readable sizes
 *
 * Exit codes: 0 = PASS or documented SKIP · 1 = FAIL.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Module ids (repo-relative, as the chunk graph records them) that are map code. */
export const MAP_MODULE_PATTERNS = [
  /(^|\/)node_modules\/maplibre-gl\//,
  /(^|\/)node_modules\/@maplibre\//,
  /(^|\/)node_modules\/maplibre-contour\//,
  /(^|\/)node_modules\/pmtiles\//,
  /(^|\/)node_modules\/@mapbox\/mapbox-gl-draw\//,
  /^client\/src\/lib\/map-engine\.ts$/,
  /^client\/src\/lib\/map-draw-styles\.ts$/,
  /^client\/src\/components\/property-map\.tsx$/,
];

export function isMapModule(id) {
  return MAP_MODULE_PATTERNS.some((re) => re.test(id));
}

/**
 * Routes whose static closure must be map-free. `source` is the module the
 * route's React.lazy() imports in client/src/App.tsx; the gate finds the chunk
 * fronted by that module. The five customer doors' landings plus the two
 * top-bar destinations — except Map itself, which is MAP_ROUTE below.
 */
export const MAP_FREE_ROUTES = [
  { route: "/today", source: "client/src/pages/today.tsx" },
  { route: "/deals", source: "client/src/pages/deals.tsx" },
  { route: "/money", source: "client/src/pages/money.tsx" },
  { route: "/ai", source: "client/src/pages/pax.tsx" },
  { route: "/inbox", source: "client/src/pages/inbox.tsx" },
  { route: "/settings", source: "client/src/pages/settings.tsx" },
];

/** The route that renders a map — its closure MUST contain map code (vacuity canary). */
export const MAP_ROUTE = { route: "/maps", source: "client/src/pages/maps.tsx" };

/**
 * Modules that render nothing until a user acts, kept out of the entry closure
 * (every page downloads and parses the entry). Each must still exist in the
 * build — a renamed module would otherwise make its rule vacuous.
 */
export const ENTRY_EXCLUDED_MODULES = [
  {
    module: "client/src/components/mobile/QuickAddSheet.tsx",
    why: "the mobile quick-add sheet (zod, shared contracts, cmdk) loads on first FAB tap",
  },
];

/** Floor on the number of chunks in a real build (measured 2026-10-12: >400). */
export const MIN_CHUNKS = 50;

/** Module ids bundled into a chunk (the graph records { id: renderedBytes }). */
export function moduleIds(chunk) {
  const m = chunk?.modules;
  if (Array.isArray(m)) return m;
  return m && typeof m === "object" ? Object.keys(m) : [];
}

export function staticClosure(chunks, startFile) {
  const seen = new Set();
  const stack = [startFile];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    const c = chunks[f];
    if (!c) throw new Error(`chunk graph references missing chunk ${f}`);
    seen.add(f);
    for (const imp of c.imports ?? []) stack.push(imp);
  }
  return seen;
}

function chunkBytes(chunks, file, assetsRoot) {
  if (assetsRoot) {
    const p = join(assetsRoot, file);
    if (existsSync(p)) return statSync(p).size;
  }
  return chunks[file].bytes ?? 0;
}

/**
 * Pure evaluation of a chunk graph. Returns { failures, rows } where rows
 * carry per-route sizes for reporting.
 */
export function evaluate(graph, { assetsRoot } = {}) {
  const failures = [];
  const chunks = graph?.chunks;
  if (!chunks || typeof chunks !== "object") {
    return { failures: ["chunk graph has no `chunks` object"], rows: [] };
  }
  const files = Object.keys(chunks);
  if (files.length < MIN_CHUNKS) {
    failures.push(`chunk graph holds ${files.length} chunks, below the floor of ${MIN_CHUNKS} — not a real build`);
  }

  if (assetsRoot) {
    const missing = files.filter((f) => !existsSync(join(assetsRoot, f)));
    if (missing.length) {
      failures.push(
        `chunk graph names ${missing.length} chunk file(s) absent from ${assetsRoot} (e.g. ${missing.slice(0, 3).join(", ")}) — the graph is from a different build`,
      );
    }
  }

  const entries = files.filter((f) => chunks[f].isEntry && /(^|\/)index\.html$/.test(chunks[f].facadeModule ?? ""));
  if (entries.length !== 1) {
    failures.push(`expected exactly one index.html entry chunk, found ${entries.length}`);
    return { failures, rows: [] };
  }
  const entryFile = entries[0];
  const entryClosure = staticClosure(chunks, entryFile);

  const mapIn = (closure) => {
    const hits = [];
    for (const f of closure) {
      for (const m of moduleIds(chunks[f])) if (isMapModule(m)) hits.push(`${m} (in ${f})`);
    }
    return hits;
  };
  const bytesOf = (closure) => [...closure].reduce((n, f) => n + chunkBytes(chunks, f, assetsRoot), 0);

  const rows = [];
  const entryHits = mapIn(entryClosure);
  if (entryHits.length) {
    failures.push(`entry closure (${entryFile}) contains map code:\n    ${entryHits.slice(0, 8).join("\n    ")}`);
  }
  const entryModules = new Set();
  for (const f of entryClosure) for (const m of moduleIds(chunks[f])) entryModules.add(m);
  const allModules = new Set();
  for (const f of files) for (const m of moduleIds(chunks[f])) allModules.add(m);
  for (const { module, why } of ENTRY_EXCLUDED_MODULES) {
    if (!allModules.has(module)) {
      failures.push(`${module} is in no chunk of this build — renamed or removed? Update ENTRY_EXCLUDED_MODULES (its rule is vacuous)`);
    } else if (entryModules.has(module)) {
      failures.push(`entry closure contains ${module}; ${why}`);
    }
  }
  rows.push({ route: "(entry)", chunk: entryFile, chunks: entryClosure.size, bytes: bytesOf(entryClosure), mapModules: entryHits.length });

  const findRouteChunk = ({ route, source }) => {
    const matches = files.filter((f) => chunks[f].facadeModule === source);
    if (matches.length !== 1) {
      failures.push(`${route}: expected exactly one chunk fronted by ${source}, found ${matches.length} — was the page renamed or made eager?`);
      return null;
    }
    return matches[0];
  };

  for (const r of [...MAP_FREE_ROUTES, MAP_ROUTE]) {
    const file = findRouteChunk(r);
    if (!file) continue;
    const closure = staticClosure(chunks, file);
    const pageView = new Set([...entryClosure, ...closure]);
    const hits = mapIn(closure);
    const isMapRoute = r === MAP_ROUTE;
    if (!isMapRoute && hits.length) {
      failures.push(`${r.route} static closure (${file}) contains map code:\n    ${hits.slice(0, 8).join("\n    ")}`);
    }
    if (isMapRoute && hits.length === 0) {
      failures.push(
        `${r.route} renders a map but its closure matched no map module — the map-module predicate no longer matches this build's module ids, so every other verdict here is vacuous`,
      );
    }
    rows.push({ route: r.route, chunk: file, chunks: pageView.size, bytes: bytesOf(pageView), mapModules: hits.length });
  }
  failures.push(...shellWarmers(graph, chunks, entryClosure, mapIn));
  return { failures, rows };
}

/**
 * The router: its import() calls are the React.lazy() route table, which loads
 * a page only when that route renders. Every OTHER module in the entry closure
 * runs on every page, so an import() it issues loads code on routes that never
 * render it — exactly how an idle "warm the doors" helper pulled the map page,
 * and with it all of MapLibre, onto Today (2026-10-12).
 */
export const ROUTER_MODULE = "client/src/App.tsx";

/**
 * Rule 2 — no shell module may dynamically import anything whose closure holds
 * map code. Static closures cannot see this: import() is a dynamic edge, so
 * the module-level `dynamicImports` record (which module issues each import())
 * is read instead.
 */
export function shellWarmers(graph, chunks, entryClosure, mapIn) {
  const failures = [];
  const dyn = graph.dynamicImports;
  if (!dyn || typeof dyn !== "object") {
    return ["chunk graph has no module-level `dynamicImports` record — rebuild with the current vite.config.ts"];
  }
  const chunkOf = new Map();
  for (const [f, c] of Object.entries(chunks)) for (const m of moduleIds(c)) chunkOf.set(m, f);
  const carriesMap = (target) => {
    const f = chunkOf.get(target);
    return f ? mapIn(staticClosure(chunks, f)).length > 0 : false;
  };

  const shellModules = new Set();
  for (const f of entryClosure) for (const m of moduleIds(chunks[f])) shellModules.add(m);
  if (!shellModules.has(ROUTER_MODULE)) {
    failures.push(`${ROUTER_MODULE} is not in the entry closure — the router exemption no longer names the router`);
    return failures;
  }
  // Vacuity canary: the router lazily loads /maps, so at least one of its
  // dynamic imports must read as map-bearing. If none does, the dynamic-edge
  // record or the map predicate stopped matching and rule 2 reads nothing.
  if (!(dyn[ROUTER_MODULE] ?? []).some(carriesMap)) {
    failures.push(`no dynamic import of ${ROUTER_MODULE} reads as map-bearing — rule 2 (shell warmers) would be vacuous`);
  }
  for (const m of shellModules) {
    if (m === ROUTER_MODULE) continue;
    for (const t of dyn[m] ?? []) {
      if (carriesMap(t)) {
        failures.push(
          `${m} is loaded on every page and dynamically imports ${t}, whose closure carries map code — map code would load on routes that render no map`,
        );
      }
    }
  }
  return failures;
}

function main() {
  const args = process.argv.slice(2);
  const gi = args.indexOf("--graph");
  const graphPath = gi >= 0 ? resolve(args[gi + 1]) : join(ROOT, "dist/client-chunk-graph.json");
  const requireBuild = args.includes("--require-build") || !!process.env.CI || gi >= 0;
  const asJson = args.includes("--json");

  if (!existsSync(graphPath)) {
    if (requireBuild) {
      console.error(`FAIL: no chunk graph at ${graphPath} — run \`npm run build\` first (the build writes it).`);
      process.exit(1);
    }
    console.log(`SKIP (NOTHING MEASURED): no chunk graph at ${graphPath}; run \`npm run build\` first.`);
    process.exit(0);
  }

  let graph;
  try {
    graph = JSON.parse(readFileSync(graphPath, "utf8"));
  } catch (err) {
    console.error(`FAIL: chunk graph at ${graphPath} is not valid JSON: ${err.message}`);
    process.exit(1);
  }
  const assetsRoot = gi >= 0 ? null : join(ROOT, "dist/public");
  const { failures, rows } = evaluate(graph, { assetsRoot });

  if (asJson) {
    console.log(JSON.stringify({ rows, failures }, null, 1));
  } else {
    console.log("Route static closures (entry + route chunk + static imports):");
    for (const r of rows) {
      console.log(
        `  ${r.route.padEnd(10)} ${(r.bytes / 1024).toFixed(0).padStart(6)} KB  ${String(r.chunks).padStart(3)} chunks  map modules: ${r.mapModules}`,
      );
    }
  }
  if (failures.length) {
    console.error(`\nFAIL: ${failures.length} route-closure violation(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("PASS: map code is absent from the entry and every map-free door landing; present on /maps.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
