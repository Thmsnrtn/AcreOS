import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { visualizer } from "rollup-plugin-visualizer";
import viteCompression from "vite-plugin-compression";
import type { Plugin, UserConfig } from "vite";
import { buildLearnContentIndex } from "./scripts/learn-content-index.mjs";

// Writes the client chunk graph Rollup actually produced — for every chunk:
// its file, the source module it fronts (facade), the chunks it imports
// statically and dynamically, and EVERY module bundled into it (with the
// bytes it contributes) — to dist/client-chunk-graph.json, BESIDE the served
// directory (dist/public) so it is never served. scripts/check-route-closure.mjs
// reads it to prove which code each route loads (map code must load only on
// routes that render a map). Vite's own manifest lists chunks but not the
// modules inside them, so it cannot answer "is maplibre-gl in this closure".
// Written in writeBundle, not generateBundle: later plugins still rename some
// chunks after generateBundle (measured: a chunk with a CSS import), and a
// graph naming files that do not exist would be a graph of another build.
//
// One graph PER OUTPUT (P1-9 / X-2): the customer build writes
// dist/client-chunk-graph.json, the founder build dist/founder-chunk-graph.json.
// They share a directory, so a single file name would let the second build
// silently replace the first — and the route-closure gate would then read the
// founder graph and call the customer bundle clean.
const CUSTOMER_CHUNK_GRAPH_FILE = "client-chunk-graph.json";
const FOUNDER_CHUNK_GRAPH_FILE = "founder-chunk-graph.json";
function chunkGraphPlugin(graphFile: string): Plugin {
  const rootDir = path.resolve(import.meta.dirname);
  const rel = (id: string) =>
    path.relative(rootDir, id.replace(/^\0/, "").split("?")[0]).split(path.sep).join("/");
  return {
    name: "acreos-chunk-graph",
    apply: "build",
    writeBundle(options, bundle) {
      const chunks: Record<string, unknown> = {};
      for (const out of Object.values(bundle)) {
        if (out.type !== "chunk") continue;
        chunks[out.fileName] = {
          name: out.name,
          isEntry: out.isEntry,
          isDynamicEntry: out.isDynamicEntry,
          facadeModule: out.facadeModuleId ? rel(out.facadeModuleId) : null,
          imports: out.imports,
          dynamicImports: out.dynamicImports,
          // module id -> bytes it contributes to this chunk after tree-shaking
          modules: Object.fromEntries(
            Object.entries(out.modules).map(([id, m]) => [rel(id), m.renderedLength]),
          ),
          bytes: Buffer.byteLength(out.code, "utf8"),
        };
      }
      // Module-level dynamic imports: which module issues each import(). A
      // chunk-level edge cannot tell the router's React.lazy() (loads when
      // the route renders) from an idle "warm" call in shell code (loads on
      // every page), so the gate needs the issuing module.
      const dynamicImporters: Record<string, string[]> = {};
      for (const id of this.getModuleIds()) {
        const info = this.getModuleInfo(id);
        if (!info || info.dynamicallyImportedIds.length === 0) continue;
        dynamicImporters[rel(id)] = info.dynamicallyImportedIds.map(rel);
      }
      const outDir = options.dir ?? path.resolve(rootDir, "dist/public");
      fs.writeFileSync(
        path.resolve(outDir, "..", graphFile),
        JSON.stringify({ version: 2, chunks, dynamicImports: dynamicImporters }, null, 1),
      );
    },
  };
}

// jsPDF lazy-loads html2canvas (for doc.html()) and canvg, which carries its
// own core-js (for doc.addSvgAsImage()). AcreOS draws its one PDF (the
// borrower statement) with text and lines only, so those two chunks — about
// 360 KB of the total-JS budget — could never load. When jsPDF imports them,
// they resolve to a stub that throws, so a future doc.html() fails loudly
// instead of quietly shipping the weight. dompurify, jsPDF's third optional
// dependency, is NOT stubbed: isomorphic-dompurify uses it to sanitize mail
// and assignment HTML. tests/unit/jspdfOptionalDepsStubbed.test.ts pins the stub list.
// fast-png is the PNG decoder jsPDF uses only inside doc.addImage() with
// PNG data. The borrower statement uses text and lines only and never
// calls addImage, so fast-png (with its pako and iobuffer dependencies)
// could never load either and is stubbed the same way.
// fflate is stubbed too: jsPDF uses its zlibSync only to compress PDF
// content streams when compression is enabled, and the borrower
// statement uses the default (uncompressed) options and never enables
// it, so zlibSync could never be called either. A future PDF that
// enables compression must un-stub fflate and re-measure first.
const JSPDF_UNUSED_OPTIONAL_DEPS = new Set(["html2canvas", "canvg", "fast-png", "fflate"]);
function jspdfUnusedOptionalDepsPlugin(): Plugin {
  const STUB = "\0jspdf-unused-optional-dep";
  return {
    name: "acreos-jspdf-unused-optional-deps",
    enforce: "pre",
    resolveId(source, importer) {
      if (JSPDF_UNUSED_OPTIONAL_DEPS.has(source) && importer && /node_modules[\\/]jspdf[\\/]/.test(importer)) return STUB;
      return null;
    },
    load(id) {
      if (id !== STUB) return null;
      return [
        `const unavailable = () => { throw new Error("jsPDF html()/addSvgAsImage()/PNG addImage()/PDF compression are not bundled in AcreOS (vite.config.ts jspdfUnusedOptionalDepsPlugin)"); };`,
        `export default unavailable;`,
        `export const Canvg = { from: unavailable, fromString: unavailable };`,
`export const decode = unavailable;`,
`export const zlibSync = unavailable;`,
      ].join("\n");
    },
  };
}

// zod v4's classic schemas carry a `.toJSONSchema()` method (and the
// `~standard` jsonSchema factories), which drag core/to-json-schema.js —
// the whole JSON Schema generator — into the client bundle. Nothing in
// client/src, shared/ or packages/ calls toJSONSchema() in any form
// (tests/unit/zodJsonSchemaStubbed.test.ts pins that), so the generator
// resolves to a stub whose entry points throw if ever invoked: a future
// caller fails loudly instead of quietly shipping the weight.
//
// json-schema-processors.js is NOT stubbed by THIS plugin: classic/
// schemas.js reads processors.aggregateChecks(inst) inside the DERIVED
// PUBLIC ACCESSORS on live schema instances — ZodString.format /
// .minLength / .maxLength, ZodNumber.minValue / .maxValue / .format — so
// replacing that module wholesale would break real schema API, not just
// JSON Schema generation. The surgical half lives in
// zodJsonSchemaProcessorsPlugin (BD-5, below): it keeps aggregateChecks
// verbatim and stubs only the generation-only processors. The standalone
// z.toJSONSchema() (which lives in the processors module) reaches
// processSchema in the stubbed module here and throws there, which is
// the same loud failure.
//
// The stub is matched two ways, because zod reaches the generator through
// two specifier shapes: classic/schemas.js imports
// "../core/to-json-schema.js" (the Set below), while core's own modules
// (json-schema-processors.js, json-schema-generator.js, core/index.js)
// import/re-export the sibling "./to-json-schema.js". The relative branch
// resolves the specifier against the importer's directory and stubs only
// when the resolved path is zod's v4 core generator itself. That is safe
// for the processors module for the same reason: aggregateChecks — the
// one processors export live code paths reach — only folds check metadata
// from the schema def/bag and never calls the generator functions it
// imports (initializeContext / processSchema / extractDefs / finalize /
// handleUnrepresentable); those run solely inside the per-type processors
// during an actual generation, which nothing performs.
const ZOD_UNUSED_JSON_SCHEMA_MODULES = new Set(["core/to-json-schema.js"]);
function zodJsonSchemaUnusedPlugin(): Plugin {
  const STUB = "\0zod-unused-json-schema";
  return {
    name: "acreos-zod-json-schema-unused",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer || !/node_modules[\\/]zod[\\/]/.test(importer)) return null;
      const normalized = source.replace(/\\/g, "/");
      for (const mod of ZOD_UNUSED_JSON_SCHEMA_MODULES) {
        if (normalized.endsWith(mod)) return STUB;
      }
      if (normalized.startsWith(".")) {
        const importerDir = importer.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
        const resolved = `${importerDir}/${normalized.replace(/^\.\//, "")}`;
        if (resolved.endsWith("zod/v4/core/to-json-schema.js")) return STUB;
      }
      return null;
    },
    load(id) {
      if (id !== STUB) return null;
      return [
        `const unavailable = () => { throw new Error("zod JSON Schema generation (toJSONSchema) is not bundled in AcreOS (vite.config.ts zodJsonSchemaUnusedPlugin)"); };`,
        // The two factories are invoked when .toJSONSchema() is called and
        // when a schema's "~standard" property is READ, so they must return
        // the throwing function rather than throw themselves — reading
        // "~standard" (e.g. a resolver checking ~standard.validate) keeps
        // working; only generating a JSON Schema throws.
        `export const createToJSONSchemaMethod = () => unavailable;`,
        `export const createStandardJSONSchemaMethod = () => unavailable;`,
        `export const initializeContext = unavailable;`,
        `export const handleUnrepresentable = unavailable;`,
        `export const processSchema = unavailable;`,
        `export const process = unavailable;`,
        `export const extractDefs = unavailable;`,
        `export const finalize = unavailable;`,
      ].join("\n");
    },
  };
}

// BD-5 (bundle diet, 2026-11-18) — the surgical half of the processors
// module. json-schema-processors.js (~35 KB source) ships in the client
// bundle because classic/schemas.js reads ONE export from it on live
// schema instances: aggregateChecks, folded into the derived public
// accessors (ZodString.format / .minLength / .maxLength, ZodNumber
// .minValue / .maxValue / .format, …). Everything else the module
// carries — the ~40 per-type processors, allProcessors, and the
// standalone toJSONSchema — runs only during JSON Schema generation,
// which the plugin above already stubs at the generator. So this plugin
// resolves the processors module (for zod-internal importers only, the
// same two specifier shapes as above) to a stub that keeps
// aggregateChecks REAL — copied verbatim below (the range tables are
// value-verbatim: their @__PURE__ IIFE wrappers are unwrapped), with its
// module-local helpers, from zod 4.x's
// core/json-schema-processors.js + core/util.js — and makes every
// generation-only export throw if ever invoked, the same loud failure
// as the generator stub. tests/unit/zodProcessorsStub.test.ts pins the
// verbatim copy against the installed zod (a zod bump that changes
// aggregateChecks fails there until this copy is refreshed) and runs a
// behaviour battery over the live accessors. Desync hazard, stated
// plainly: if zod changes aggregateChecks' helpers or tables and this
// copy is not refreshed, the accessors above would fold checks with
// stale rules — the pin test is the guard, and it reads the INSTALLED
// module, never a remembered copy.
const ZOD_PROCESSORS_VERBATIM = [
  `const NUMBER_FORMAT_RANGES = {`,
  `    safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],`,
  `    int32: [-2147483648, 2147483647],`,
  `    uint32: [0, 4294967295],`,
  `    float32: [-3.4028234663852886e38, 3.4028234663852886e38],`,
  `    float64: [-Number.MAX_VALUE, Number.MAX_VALUE],`,
  `};`,
  `const BIGINT_FORMAT_RANGES = {`,
  `    int64: [BigInt("-9223372036854775808"), BigInt("9223372036854775807")],`,
  `    uint64: [BigInt(0), BigInt("18446744073709551615")],`,
  `};`,
  `const narrowMin = (agg, key, value) => {`,
  `    if (agg[key] === undefined || value > agg[key])`,
  `        agg[key] = value;`,
  `};`,
  `const narrowMax = (agg, key, value) => {`,
  `    if (agg[key] === undefined || value < agg[key])`,
  `        agg[key] = value;`,
  `};`,
  `const narrowBoth = (agg, value) => {`,
  `    narrowMin(agg, "minimum", value);`,
  `    narrowMax(agg, "maximum", value);`,
  `};`,
  `const addDivisor = (agg, value) => {`,
  `    agg.multipleOf ?? (agg.multipleOf = []);`,
  `    if (!agg.multipleOf.includes(value))`,
  `        agg.multipleOf.push(value);`,
  `};`,
  `const addPattern = (agg, pattern) => {`,
  `    agg.patterns ?? (agg.patterns = new Set());`,
  `    agg.patterns.add(pattern);`,
  `};`,
  `const intersectMime = (agg, mime) => {`,
  `    agg.mime = agg.mime ? agg.mime.filter((m) => mime.includes(m)) : [...mime];`,
  `};`,
  `// last-wins, matching the bag's historical write order; the flag keeps an integer format from being lost to a later float one`,
  `const setFormat = (agg, format) => {`,
  `    agg.format = format;`,
  `    if (format.includes("int"))`,
  `        agg.isInt = true;`,
  `};`,
  `const minContributor = (agg, def) => narrowMin(agg, "minimum", def.minimum);`,
  `const maxContributor = (agg, def) => narrowMax(agg, "maximum", def.maximum);`,
  `const formatContributor = (ranges) => (agg, def) => {`,
  `    setFormat(agg, def.format);`,
  `    const [minimum, maximum] = ranges[def.format];`,
  `    narrowMin(agg, "minimum", minimum);`,
  `    narrowMax(agg, "maximum", maximum);`,
  `};`,
  `const contributors = {`,
  `    greater_than: (agg, def) => narrowMin(agg, def.inclusive ? "minimum" : "exclusiveMinimum", def.value),`,
  `    less_than: (agg, def) => narrowMax(agg, def.inclusive ? "maximum" : "exclusiveMaximum", def.value),`,
  `    multiple_of: (agg, def) => addDivisor(agg, def.value),`,
  `    number_format: formatContributor(NUMBER_FORMAT_RANGES),`,
  `    bigint_format: formatContributor(BIGINT_FORMAT_RANGES),`,
  `    min_length: minContributor,`,
  `    max_length: maxContributor,`,
  `    length_equals: (agg, def) => narrowBoth(agg, def.length),`,
  `    min_size: minContributor,`,
  `    max_size: maxContributor,`,
  `    size_equals: (agg, def) => narrowBoth(agg, def.size),`,
  `    string_format: (agg, def) => {`,
  `        setFormat(agg, def.format);`,
  `        if (def.pattern)`,
  `            addPattern(agg, def.pattern);`,
  `        if (def.format === "base64" || def.format === "base64url")`,
  `            agg.contentEncoding = def.format;`,
  `        if (def.local || def.precision === -1)`,
  `            agg.laxFormat = true;`,
  `    },`,
  `    mime_type: (agg, def) => intersectMime(agg, def.mime),`,
  `};`,
];
const ZOD_AGGREGATE_CHECKS_VERBATIM = [
  `export function aggregateChecks(schema) {`,
  `    const agg = {};`,
  `    const def = schema._zod.def;`,
  `    // a format schema is its own first check, same rule as $ZodType init`,
  `    const list = schema._zod.traits.has("$ZodCheck")`,
  `        ? [schema, ...(def.checks ?? [])]`,
  `        : (def.checks ?? []);`,
  `    for (const ch of list)`,
  `        contributors[ch._zod.def.check]?.(agg, ch._zod.def);`,
  `    // reconcile with the bag so third-party onattach contributions still land; first-party residue is never tighter than the fold, so merging it back is idempotent for one and additive for the other`,
  `    const bag = schema._zod.bag;`,
  `    if (bag.minimum !== undefined)`,
  `        narrowMin(agg, "minimum", bag.minimum);`,
  `    if (bag.exclusiveMinimum !== undefined)`,
  `        narrowMin(agg, "exclusiveMinimum", bag.exclusiveMinimum);`,
  `    if (bag.maximum !== undefined)`,
  `        narrowMax(agg, "maximum", bag.maximum);`,
  `    if (bag.exclusiveMaximum !== undefined)`,
  `        narrowMax(agg, "exclusiveMaximum", bag.exclusiveMaximum);`,
  `    if (bag.multipleOf !== undefined)`,
  `        addDivisor(agg, bag.multipleOf);`,
  `    if (bag.format !== undefined) {`,
  `        agg.format ?? (agg.format = bag.format);`,
  `        if (bag.format.includes("int"))`,
  `            agg.isInt = true;`,
  `    }`,
  `    if (bag.mime)`,
  `        intersectMime(agg, bag.mime);`,
  `    for (const pattern of bag.patterns ?? [])`,
  `        addPattern(agg, pattern);`,
  `    return agg;`,
  `}`,
];
const ZOD_GENERATION_PROCESSORS = [
  "stringProcessor", "numberProcessor", "booleanProcessor", "bigintProcessor", "symbolProcessor",
  "nullProcessor", "undefinedProcessor", "voidProcessor", "neverProcessor", "anyProcessor",
  "unknownProcessor", "dateProcessor", "enumProcessor", "literalProcessor", "nanProcessor",
  "templateLiteralProcessor", "fileProcessor", "successProcessor", "customProcessor", "functionProcessor",
  "transformProcessor", "mapProcessor", "setProcessor", "arrayProcessor", "objectProcessor",
  "unionProcessor", "intersectionProcessor", "tupleProcessor", "recordProcessor", "nullableProcessor",
  "nonoptionalProcessor", "defaultProcessor", "prefaultProcessor", "catchProcessor", "pipeProcessor",
  "readonlyProcessor", "promiseProcessor", "optionalProcessor", "lazyProcessor",
];
const ZOD_ALL_PROCESSOR_KEYS = [
  "string", "number", "boolean", "bigint", "symbol", "null", "undefined", "void", "never", "any",
  "unknown", "date", "enum", "literal", "nan", "template_literal", "file", "success", "custom",
  "function", "transform", "map", "set", "array", "object", "union", "intersection", "tuple",
  "record", "nullable", "nonoptional", "default", "prefault", "catch", "pipe", "readonly",
  "promise", "optional", "lazy",
];
function zodJsonSchemaProcessorsPlugin(): Plugin {
  const STUB = "\0zod-json-schema-processors";
  return {
    name: "acreos-zod-json-schema-processors",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer || !/node_modules[\\/]zod[\\/]/.test(importer)) return null;
      const normalized = source.replace(/\\/g, "/");
      if (normalized.endsWith("core/json-schema-processors.js")) return STUB;
      if (normalized.startsWith(".")) {
        const importerDir = importer.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
        const resolved = `${importerDir}/${normalized.replace(/^\.\//, "")}`;
        if (resolved.endsWith("zod/v4/core/json-schema-processors.js")) return STUB;
      }
      return null;
    },
    load(id) {
      if (id !== STUB) return null;
      return [
        `const unavailable = () => { throw new Error("zod JSON Schema generation (the per-type processors / toJSONSchema) is not bundled in AcreOS (vite.config.ts zodJsonSchemaProcessorsPlugin)"); };`,
        ...ZOD_PROCESSORS_VERBATIM,
        ...ZOD_AGGREGATE_CHECKS_VERBATIM,
        ...ZOD_GENERATION_PROCESSORS.map((n) => `export const ${n} = unavailable;`),
        `export const allProcessors = { ${ZOD_ALL_PROCESSOR_KEYS.map((k) => `${k}: unavailable`).join(", ")} };`,
        `export const toJSONSchema = unavailable;`,
      ].join("\n");
    },
  };
}

// The /learn article bodies (content/learn/**/*.json, ~132 KB of prose)
// are data, not code. Bundling them as JS modules (the old eager
// import.meta.glob in client/src/pages/learn/registry.ts) put every byte
// inside the bundle gate's summed total (scripts/check-bundle-size.js
// counts every emitted .js file), so the corpus now ships as static JSON
// the two article pages fetch on demand, and only a metadata index —
// path keys, slugs, names, headline, and each body's URL — is generated
// into the bundle as the virtual module below. The hub, the cross-links
// and the not-found decision read the index synchronously, exactly as
// they read the bundled registry before; the article body arrives by
// fetch and renders the identical page. The enumeration lives in
// scripts/learn-content-index.mjs (pinned by its .test.mjs); this plugin
// is only the Vite wiring: it resolves the virtual module, copies each
// body VERBATIM into dist/public/learn-content/ at build end (the
// production static server serves it from there; fetch().json() yields
// the same object the bundle used to carry), and serves the same URLs
// from disk under the dev server so dev behaviour is unchanged.
const LEARN_CONTENT_VIRTUAL_ID = "virtual:acreos-learn-content";
function learnContentPlugin(): Plugin {
  const RESOLVED = "\0" + LEARN_CONTENT_VIRTUAL_ID;
  const rootDir = path.resolve(import.meta.dirname);
  const contentDir = path.join(rootDir, "content", "learn");
  let outDir = path.resolve(rootDir, "dist/public");
  const readIndex = () => buildLearnContentIndex(contentDir);
  return {
    name: "acreos-learn-content",
    resolveId(id) {
      return id === LEARN_CONTENT_VIRTUAL_ID ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      const { articles, counties } = readIndex();
      for (const entry of [...articles, ...counties]) {
        this.addWatchFile(path.join(rootDir, entry.sourcePath));
      }
      const publicArticles = articles.map((a) => ({
        pathKey: a.pathKey,
        vertical: a.vertical,
        stateSlug: a.stateSlug,
        stateName: a.stateName,
        headline: a.headline,
        url: a.url,
      }));
      const publicCounties = counties.map((c) => ({
        pathKey: c.pathKey,
        stateSlug: c.stateSlug,
        stateName: c.stateName,
        countySlug: c.countySlug,
        countyName: c.countyName,
        url: c.url,
      }));
      return [
        `export const LEARN_ARTICLES = ${JSON.stringify(publicArticles)};`,
        `export const LEARN_COUNTIES = ${JSON.stringify(publicCounties)};`,
      ].join("\n");
    },
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      const { articles, counties } = readIndex();
      const files = new Map(
        [...articles, ...counties].map((entry) => [
          entry.url,
          path.join(rootDir, entry.sourcePath),
        ]),
      );
      server.middlewares.use((req, res, next) => {
        const file = files.get((req.url ?? "").split("?")[0]);
        if (!file) return next();
        res.setHeader("Content-Type", "application/json");
        const stream = fs.createReadStream(file);
        stream.on("error", () => {
          res.statusCode = 404;
          res.end();
        });
        stream.pipe(res);
      });
    },
    closeBundle() {
      const { articles, counties } = readIndex();
      for (const entry of [...articles, ...counties]) {
        const dest = path.join(outDir, entry.url.replace(/^\//, ""));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(rootDir, entry.sourcePath), dest);
      }
    },
  };
}

// The Tennessee county boundary shapes (shared/landData/tnCountyBoundaries.json,
// ~52 KB of simplified TIGER GeoJSON) are data, not code. The coverage panel
// (client/src/components/maps/LandCoveragePanel.tsx) used to import the file,
// which put every byte inside the bundle gate's summed JS total
// (scripts/check-bundle-size.js counts every emitted .js file). The shapes now
// ship as a static asset the panel fetches on demand
// (client/src/lib/tn-boundaries.ts), and the parsed object is the same one
// the bundle used to carry — the panel draws identical fills from it. The
// server keeps importing the JSON directly (tnCountyAt, release lineage) and
// is untouched. This plugin is only the Vite wiring: it copies the file
// VERBATIM into dist/public/land-data/ at build end (the production static
// server serves it from there) and serves the same URL from disk under the
// dev server so dev behaviour is unchanged.
const TN_BOUNDARIES_URL = "/land-data/tn-county-boundaries.json";
function tnBoundariesPlugin(): Plugin {
  const rootDir = path.resolve(import.meta.dirname);
  const sourcePath = path.join(rootDir, "shared", "landData", "tnCountyBoundaries.json");
  let outDir = path.resolve(rootDir, "dist/public");
  return {
    name: "acreos-tn-boundaries",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? "").split("?")[0] !== TN_BOUNDARIES_URL) return next();
        res.setHeader("Content-Type", "application/json");
        const stream = fs.createReadStream(sourcePath);
        stream.on("error", () => {
          res.statusCode = 404;
          res.end();
        });
        stream.pipe(res);
      });
    },
    closeBundle() {
      const dest = path.join(outDir, TN_BOUNDARIES_URL.replace(/^\//, ""));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(sourcePath, dest);
    },
  };
}

// Phase 8 Mo 12 — Beatriz §3 bundle-analyzer.
// Enabled when ANALYZE=1 (CI / one-off `npm run build:analyze`).
// In normal builds the plugin is excluded so the prod bundle is unaffected.
const ANALYZE = process.env.ANALYZE === "1" || process.env.ANALYZE === "true";

// Resolve the git SHA at config time so the value is baked into the
// client bundle as `import.meta.env.VITE_GIT_SHA`. CI overrides this
// via the env var so deploys reflect the actual commit even when the
// build runs in a shallow clone where `git rev-parse` would fail.
function resolveGitSha(): string {
  if (process.env.VITE_GIT_SHA) return process.env.VITE_GIT_SHA;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

const GIT_SHA = resolveGitSha();
process.env.VITE_GIT_SHA = GIT_SHA;

// ── Two outputs (P1-9 / X-2) ────────────────────────────────────────────────
// The client builds to TWO Vite outputs so the founder's pages never ship in
// the customer bundle:
//   customer — client/index.html + src/main.tsx            → dist/public,  base "/",
//              assets under /assets            (this file's default export)
//   founder  — client/founder.html + src/founder-main.tsx  → dist/founder, base "/founder-app/",
//              assets under /founder-assets    (vite.founder.config.ts)
// The founder output lives in its own URL space (/founder-app/founder-assets/…)
// so the customer's `/assets/*.js` 404 guard and long-cache rules in
// server/static.ts cannot collide with it. Both run the SAME manualChunks: the
// shared vendor chunks (react, ui, motion, clerk, …) are DUPLICATED per output
// rather than shared across two builds (a federated vendor build is a large new
// failure surface; the duplicate is paid once, by the founder, on first visit).
export type BuildOutput = "customer" | "founder";

// Plugins that only serve customer pages: the /learn corpus and the TN boundary
// shapes are copied into dist/public, and nothing in the founder build imports
// them.
const CUSTOMER_ONLY_PLUGIN_NAMES = new Set(["acreos-learn-content", "acreos-tn-boundaries"]);

export function buildConfig(output: BuildOutput): UserConfig {
  const isFounder = output === "founder";
  // BD-4 (bundle diet): the web builds alias @capacitor/core to a shim that
  // answers its two web-constant questions (client/src/lib/
  // capacitor-web-shim.ts). A NATIVE build must link the real core, so the
  // alias is removed when ACREOS_NATIVE_BUILD=1 — the build:native script
  // sets it (the mobile:* scripts build through build:native). Read here,
  // at config-build time, so the pin test can flip it.
  const nativeBuild = process.env.ACREOS_NATIVE_BUILD === "1";
  const config: UserConfig = {
  define: {
    // Belt-and-suspenders: ensure `import.meta.env.VITE_GIT_SHA` is
    // available even when Vite's loadEnv hasn't picked up the var.
    "import.meta.env.VITE_GIT_SHA": JSON.stringify(GIT_SHA),
    // Which bundle this is — read by client/src/lib/cross-build.ts to decide
    // when a navigation must become a full page load.
    "import.meta.env.VITE_ACREOS_BUILD": JSON.stringify(output),
    // Sentry's documented tree-shaking flag (P2-6 S1 bundle offset). The
    // SDK gates its own debug logging on `__SENTRY_DEBUG__`; that logging
    // prints only when Sentry.init gets `debug: true`, which AcreOS never
    // passes (client/src/lib/sentry.ts). Defining it false strips that dead
    // logging from both outputs; events, sampling, replay and tracing are
    // untouched. To get SDK debug logs, remove this line first —
    // tests/unit/sentryDebugLoggingStripped.test.ts pins both halves.
    __SENTRY_DEBUG__: false,
    // Sentry's documented tree-shaking flag for tracing (L-P3 bundle
    // offset). The client installs NO tracing integration — sentry.ts's
    // only integration is Replay, its performance signal is web-vitals via
    // captureMessage, and no client file calls a span/transaction API — so
    // the SDK's span/transaction machinery cannot run and is compiled out.
    // `tracesSampleRate` in the init is inert without an integration and
    // stays as the tuning knob for the day one is added: adding a tracing
    // integration means removing this line first —
    // tests/unit/sentryTracingStripped.test.ts pins both halves.
    __SENTRY_TRACING__: false,
  },
  // The founder output is served under /founder-app/ (server/static.ts) and
  // reads no public/ files: its HTML and fonts use root-absolute URLs that the
  // customer static mount already serves, so a copied public/ would only
  // duplicate several MB into the image.
  ...(isFounder ? { base: "/founder-app/", publicDir: false as const } : {}),
  plugins: [
    react(),
    jspdfUnusedOptionalDepsPlugin(),
    zodJsonSchemaUnusedPlugin(),
    zodJsonSchemaProcessorsPlugin(),
    learnContentPlugin(),
    tnBoundariesPlugin(),
    chunkGraphPlugin(isFounder ? FOUNDER_CHUNK_GRAPH_FILE : CUSTOMER_CHUNK_GRAPH_FILE),
    // Pre-compress build output (gzip + brotli) so static-serve can deliver
    // already-compressed bytes. Sidesteps the HTTP/2 + `compression`
    // middleware bug where compression negotiation fails under H2 (verified
    // 2026-05-04: `content-encoding` missing on /assets/*.js under H2 but
    // works under H1.1). See PERFORMANCE-DIAGNOSTIC.md §3.
    //
    // Threshold: 1024 bytes — same as the runtime middleware. ext: includes
    // js/mjs/css/html/json/svg. The `disable: false` is the default; kept
    // explicit so anyone reading sees the toggle.
    viteCompression({
      algorithm: "gzip",
      ext: ".gz",
      threshold: 1024,
      deleteOriginFile: false,
      disable: false,
    }),
    viteCompression({
      algorithm: "brotliCompress",
      ext: ".br",
      threshold: 1024,
      deleteOriginFile: false,
      disable: false,
    }),
    // Bundle analyzer — only active in --analyze mode. Emits
    // `dist/bundle-stats.html` (treemap) so we can identify the
    // largest chunks. Run `ANALYZE=1 npm run build` then open the file.
    ...(ANALYZE
      ? [
          visualizer({
            filename: path.resolve(
              import.meta.dirname,
              isFounder ? "dist/bundle-stats-founder.html" : "dist/bundle-stats.html",
            ),
            gzipSize: true,
            brotliSize: true,
            template: "treemap",
            open: false,
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      ...(nativeBuild
        ? {}
        : { "@capacitor/core": path.resolve(import.meta.dirname, "client", "src", "lib", "capacitor-web-shim.ts") }),
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@acreos/solene": path.resolve(import.meta.dirname, "packages", "solene", "src", "index.ts"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@content": path.resolve(import.meta.dirname, "content"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, isFounder ? "dist/founder" : "dist/public"),
    // Each output empties only ITS OWN directory — dist/public and dist/founder
    // are siblings, so building one never wipes the other.
    emptyOutDir: true,
    assetsDir: isFounder ? "founder-assets" : "assets",
    // Task #196: Performance budget — warn if any chunk exceeds 500 KB
    chunkSizeWarningLimit: 500,
    // Task #196: Emit source maps in production for Sentry error symbolication
    sourcemap: process.env.NODE_ENV === "production" ? "hidden" : false,
    rollupOptions: {
      ...(isFounder
        ? { input: { founder: path.resolve(import.meta.dirname, "client", "founder.html") } }
        : {}),
      output: {
        // Why this is a function instead of an object map:
        // The previous object form leaked weight onto first paint. Vite's
        // internal __vitePreload helper + tiny utilities like clsx /
        // tailwind-merge land in *some* chunk; with the object form they
        // landed inside vendor-pdf and vendor-charts respectively. Since
        // every page uses the preload helper and clsx (via cn()), those
        // "vendor" chunks got modulepreload'd on every page — dragging
        // 100KB of jspdf and 100KB of recharts into the landing page.
        //
        // The function form gives us per-module control: shared mini-utils
        // get their own tiny chunk, heavy single-use libs (jspdf) stay
        // unchunked so they ride with their lazy consumer, and the major
        // shared deps (react, radix, motion, etc.) keep their manual
        // groupings. Verified via vite-plugin-visualizer post-change.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;

          // Tiny shared utils — give them their own chunk so they don't
          // ride along with heavy libs and force-preload them.
          if (/\/(clsx|tailwind-merge|class-variance-authority)\//.test(id)) {
            return 'vendor-utils';
          }

          // Core runtime — eagerly needed everywhere.
          if (/\/(react|react-dom|scheduler|wouter|@tanstack\/react-query)\//.test(id)) {
            return 'vendor-react';
          }

          if (/\/@radix-ui\//.test(id)) return 'vendor-ui';
          if (/\/@clerk\//.test(id)) return 'vendor-clerk';
          if (/\/framer-motion\//.test(id)) return 'vendor-motion';
          if (/\/date-fns\//.test(id)) return 'vendor-date';

          // Heavy libs used across many pages — keep grouped so 30+ pages
          // share one cached chunk instead of each carrying their own copy.
          if (/\/recharts\//.test(id)) return 'vendor-charts';
          if (/\/(maplibre-gl|@maplibre|maplibre-contour|pmtiles)\//.test(id)) return 'vendor-map';

          // Heavy libs with a single consumer — DO NOT name them. Returning
          // undefined lets Vite co-locate the lib with its sole importer's
          // lazy chunk, so the lib only downloads when that route renders.
          // Apply to: jspdf (borrower-portal only), @turf/turf (subdivision-
          // plan-editor only), isomorphic-dompurify.

          return undefined;
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
      // Allow Vite to read content/ which lives at the repo root, a
      // sibling of the Vite root (client/). Used by the programmatic
      // SEO loader at client/src/pages/learn/registry.ts.
      allow: [
        path.resolve(import.meta.dirname),
        path.resolve(import.meta.dirname, "content"),
      ],
    },
  },
  };
  if (isFounder) {
    config.plugins = (config.plugins ?? []).filter(
      (p) => !(p && !Array.isArray(p) && CUSTOMER_ONLY_PLUGIN_NAMES.has((p as Plugin).name)),
    );
  }
  return config;
}

export default defineConfig(buildConfig("customer"));
