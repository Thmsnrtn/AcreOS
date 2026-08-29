#!/usr/bin/env node
/**
 * ROUTE SHADOWING — a route that can never receive a request.
 * ============================================================================
 *
 * WHAT THIS CATCHES, and why check-route-order.mjs cannot.
 *
 * Express matches in REGISTRATION ORDER. If an earlier registration matches the
 * same request an later one was written for, and that earlier handler does not
 * call next(), the later route is DEAD — registered, mounted, unit-tested, and
 * structurally unable to serve a request.
 *
 * Found live on 2026-08-27, in server/routes-decisions.ts:
 *     GET /:subjectType/:subjectId   <- registered first, 2 segments, matches /x/y
 *     GET /:id/outcomes              <- registered later, also 2 segments
 * A request to /api/decisions/123/outcomes hit the first, took subjectType="123",
 * failed its DECISION_SUBJECT_TYPES whitelist and returned 400 with zero next()
 * calls. The outcomes endpoint had never once run.
 *
 * check-route-order.mjs PASSED on that, correctly, because it guards a DIFFERENT
 * property: its predicate is a `:param`-TAILED earlier route swallowing a LITERAL
 * final segment, and it is per-file by construction. `/:subjectType/:subjectId`
 * is not param-tailed relative to `/:id/outcomes`, and most shadowing in this
 * repo is CROSS-FILE. The two gates sit beside each other; deleting either to
 * "consolidate" silently drops the population the other holds at zero.
 *
 * ----------------------------------------------------------------------------
 * WHAT IT READS — stated because a gate proves its property only over the
 * population it ACTUALLY reads.
 *
 * Not a per-file scan. Per-file order is not the real order: most route files
 * attach via `registerXRoutes(app)` or `app.use(prefix, router)`, and the true
 * sequence is the source order of server/routes.ts. So this builds a GLOBAL
 * ORDERED TABLE by walking routes.ts top-to-bottom and expanding:
 *   - `app.use("<prefix>", …, <ident>)`  -> that module's Router-scoped routes,
 *                                            prefixed
 *   - `registerFoo(app)`                 -> the app-scoped routes inside
 *                                            registerFoo's balanced body
 *   - direct `app.<method>(...)`         -> as-is
 *
 * Comments are stripped FIRST with the shared offset-preserving stripper. Without
 * that, JSDoc usage examples register as phantom routes.
 *
 * ----------------------------------------------------------------------------
 * MATCHING IS DELEGATED TO THE REAL MATCHER.
 *
 * No hand-rolled segment comparison. The earlier path is compiled with the same
 * path-to-regexp Express 5 itself uses, and tested against concrete probe paths
 * synthesised from the later route. That is what makes this falsifiable against
 * the SEMANTIC defect: it asks "can this request reach that handler", not "does
 * this string look like that string".
 *
 * ----------------------------------------------------------------------------
 * FALL-THROUGH IS THREE-VALUED, AND THE UNKNOWNS ARE COUNTED.
 *
 * TERMINATES    - final handler is an inline function with zero next(
 * FALLS-THROUGH - contains next( : the later route is still reachable
 * UNKNOWN       - handler is an unresolvable identifier, or a bare .use
 *
 * UNKNOWN is NOT silently treated as falls-through: that is the direction that
 * hides dead routes. It gets its own down-only baseline so the count of routes
 * this gate cannot reason about can only shrink.
 *
 * ----------------------------------------------------------------------------
 * WHAT THIS MEASURES, PRECISELY — learned by falsifying it.
 *
 * It measures ROUTING reachability, not whether the shadower handles the request
 * correctly. Widening `/api/import/:entityType/columns`'s whitelist to admit
 * "notes" makes the SHADOWER answer /api/import/notes/columns properly — and the
 * count does not move, correctly, because the later registration at line 367 is
 * still unreachable and still dead code. Both facts matter and they are
 * different: one is "callers get the wrong answer", the other is "this code can
 * never run". Fixing the first does not clear the second, so do not expect the
 * baseline to drop until a registration is actually reordered or removed.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { stripCommentsPreservingLines } from "./lib/strip-comments.mjs";

const require_ = createRequire(import.meta.url);
const { pathToRegexp } = require_("path-to-regexp");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(ROOT, "server");
const ENTRY = join(SERVER, "routes.ts");
const TAG = "[check-route-shadowing]";
const RATCHET_PATH = join(ROOT, "scripts/ratchets/route-shadowing.json");

// VACUITY FLOORS. Every key is REQUIRED: a missing / zero / non-integer floor
// fails exactly as loudly as a breached one, so the guard cannot be disabled by
// deleting a line — which is how a gate quietly stops gating. A floor of 0 is
// not a floor. Measured live 2026-08-27; floors set at ~70%.
const FLOORS = {
  serverFiles: 1000, //      live 1,383
  registrations: 2200, //    live 3,061
  globalRoutes: 2000, //     live ~2,849
  paramRoutes: 850, //       live ~1,232 — the predicate's LEFT-hand side
  terminatingEarlier: 400, // the predicate's RIGHT-hand side
};
const REQUIRED_FLOORS = Object.keys(FLOORS);

function fail(msg) {
  console.error(`${TAG} FAIL — ${msg}`);
  process.exit(1);
}

// ── population 1: every server file ──────────────────────────────────────────
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!/node_modules|dist|build/.test(p)) yield* walk(p);
    } else if (/\.ts$/.test(name) && !/\.(test|spec)\.ts$/.test(name)) yield p;
  }
}

const files = [...walk(SERVER)];
const srcOf = new Map();
for (const f of files) srcOf.set(f, stripCommentsPreservingLines(readFileSync(f, "utf8")));

// ── receiver scoping ─────────────────────────────────────────────────────────
// An identifier only counts as an Express receiver if it is declared as a
// Router, aliases `app`, or is literally app/api/router. Without this, `req.get`,
// `headers.get`, `searchParams.get`, `redis.get` and `someMap.get` all register
// as routes.
const METHODS = "get|post|put|patch|delete|all|use";
const CALL = new RegExp(
  String.raw`\b([A-Za-z_$][\w$]*)\.(${METHODS})\(\s*(["'])((?:\/|\*|\{)[^"'\`]*)\3`,
  "g",
);

function receiversIn(src) {
  const ok = new Set(["app", "api", "router"]);
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:express\.)?Router\(/g)) ok.add(m[1]);
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*app\b/g)) ok.add(m[1]);
  return ok;
}

/** Balanced-paren slice starting at the '(' that follows `from`. */
function balancedArgs(src, from) {
  const open = src.indexOf("(", from);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return "";
}

let registrations = 0;

/** Every registration in `src`, restricted to receivers in `only`. */
function registrationsIn(file, src, only) {
  const out = [];
  CALL.lastIndex = 0;
  for (const m of src.matchAll(CALL)) {
    const [, recv, method, , path] = m;
    registrations += 1;
    if (!only.has(recv)) continue;
    out.push({
      file,
      line: src.slice(0, m.index).split("\n").length,
      method: method.toLowerCase(),
      path,
      args: balancedArgs(src, m.index),
      idx: m.index,
    });
  }
  return out.sort((a, b) => a.idx - b.idx);
}

// ── build the global ordered table by walking routes.ts ──────────────────────
const entrySrc = srcOf.get(ENTRY);
if (!entrySrc) fail(`could not read the entry point ${relative(ROOT, ENTRY)}`);

/** module specifier -> absolute file, for static and dynamic imports. */
const importMap = new Map();
for (const m of entrySrc.matchAll(/import\s+(?:(\w+)|{([^}]*)})\s+from\s+["'](\.[^"']+)["']/g)) {
  const names = m[1] ? [m[1]] : m[2].split(",").map((s) => s.trim().split(/\s+as\s+/).pop().trim());
  for (const n of names) if (n) importMap.set(n, m[3]);
}
for (const m of entrySrc.matchAll(/(?:const|let)\s+(?:{\s*([^}]*)\s*}|(\w+))\s*=\s*await\s+import\(\s*["'](\.[^"']+)["']/g)) {
  const names = m[1] ? m[1].split(",").map((s) => s.trim().split(/:/).pop().trim()) : [m[2]];
  for (const n of names) if (n) importMap.set(n, m[3]);
}

function resolveSpec(spec) {
  const base = resolve(SERVER, spec);
  for (const cand of [`${base}.ts`, join(base, "index.ts")]) if (existsSync(cand)) return cand;
  return null;
}

const globalRoutes = [];
/**
 * Mount paths whose Router RESOLVED and was EXPANDED into globalRoutes
 * (vs. unresolved mounts, which stay honestly UNKNOWN). Used by the pair
 * loop: an expanded mount's `.use` line falls through by Express semantics
 * (a Router calls next() when nothing inside matches), and its terminating
 * inner routes are already enumerated individually — counting the mount
 * line itself as an unknown earlier handler was double-counting.
 * Conservative on ambiguity: a path that appears in BOTH sets (two mounts,
 * one resolved) is NOT treated as expanded.
 */
const resolvedMountPaths = new Set();
const unresolvedMountPaths = new Set();
let routerMounts = 0;
let registrarCalls = 0;
let unresolved = 0;

const entryOnly = receiversIn(entrySrc);
const entryEvents = [];
for (const m of entrySrc.matchAll(
  new RegExp(String.raw`\bapp\.use\(\s*(["'])(\/[^"'\`]*)\1([^;]*?)\)|\b(register[A-Za-z0-9_]*)\(\s*app\b`, "g"),
)) {
  entryEvents.push({ idx: m.index, mountPath: m[2], rest: m[3], registrar: m[4] });
}
const entryDirect = registrationsIn(ENTRY, entrySrc, entryOnly);

// Interleave routes.ts's own registrations with its mount/registrar events, in
// source order — that IS the registration order.
const timeline = [
  ...entryDirect.map((r) => ({ idx: r.idx, kind: "direct", r })),
  ...entryEvents.map((e) => ({ idx: e.idx, kind: e.registrar ? "registrar" : "mount", e })),
].sort((a, b) => a.idx - b.idx);

for (const t of timeline) {
  if (t.kind === "direct") {
    globalRoutes.push({ ...t.r, abs: t.r.path, via: "direct" });
    continue;
  }
  if (t.kind === "mount") {
    const ident = /([A-Za-z_$][\w$]*)\s*$/.exec((t.e.rest || "").trim())?.[1];
    const spec = ident && importMap.get(ident);
    const target = spec && resolveSpec(spec);
    if (!target || !srcOf.has(target)) { unresolved += 1; unresolvedMountPaths.add(t.e.mountPath); continue; }
    routerMounts += 1;
    resolvedMountPaths.add(t.e.mountPath);
    const src = srcOf.get(target);
    const only = receiversIn(src);
    only.delete("app"); only.delete("api"); // mounted module: Router-scoped only
    for (const r of registrationsIn(target, src, only)) {
      const abs = (t.e.mountPath + (r.path === "/" ? "" : r.path)).replace(/\/{2,}/g, "/");
      globalRoutes.push({ ...r, abs, via: `mount ${t.e.mountPath}` });
    }
    continue;
  }
  // registrar: expand only what is inside its balanced function body
  const name = t.e.registrar;
  const spec = importMap.get(name);
  const target = spec && resolveSpec(spec);
  if (!target || !srcOf.has(target)) { unresolved += 1; continue; }
  const src = srcOf.get(target);
  const decl = new RegExp(String.raw`function\s+${name}\s*\(`).exec(src);
  if (!decl) { unresolved += 1; continue; }
  const bodyStart = src.indexOf("{", decl.index + decl[0].length);
  let depth = 0, bodyEnd = src.length;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { bodyEnd = i; break; } }
  }
  registrarCalls += 1;
  const body = src.slice(bodyStart, bodyEnd);
  const only = receiversIn(src);
  for (const r of registrationsIn(target, body, only)) {
    globalRoutes.push({
      ...r,
      line: src.slice(0, bodyStart + r.idx).split("\n").length,
      abs: r.path,
      via: `registrar ${name}`,
    });
  }
}

// ── fall-through classification ──────────────────────────────────────────────
function classify(reg) {
  const args = reg.args || "";
  const inline = /=>|\bfunction\b/.test(args);
  if (/\bnext\s*\(/.test(args)) return "FALLS_THROUGH";
  if (inline) return "TERMINATES";
  return "UNKNOWN";
}

// ── shadow detection, using the real matcher ─────────────────────────────────
const PROBES = ["1", "route-probe-slug", "%E2%9C%93"];
function probePaths(p) {
  return PROBES.map((v) => p.replace(/:[A-Za-z_][\w]*/g, v));
}

let paramRoutes = 0, terminatingEarlier = 0, pairsCompared = 0, unknownEarlier = 0;
const offenders = [];
const compiled = new Map();
function reOf(p) {
  if (!compiled.has(p)) {
    try { compiled.set(p, pathToRegexp(p).regexp); }
    catch (e) { fail(`route path ${JSON.stringify(p)} does not compile: ${e.message}. That is a BOOT CRASH, not a shadowing issue — fix it first.`); }
  }
  return compiled.get(p);
}

let classifiedTerminates = 0;
for (const r of globalRoutes) {
  if (/:[A-Za-z_]/.test(r.abs)) paramRoutes += 1;
  if (classify(r) === "TERMINATES") classifiedTerminates += 1;
}

for (let j = 0; j < globalRoutes.length; j++) {
  const later = globalRoutes[j];
  if (later.method === "use") continue;
  const probes = probePaths(later.abs);
  for (let i = 0; i < j; i++) {
    const earlier = globalRoutes[i];
    if (earlier.method !== later.method && earlier.method !== "all" && earlier.method !== "use") continue;
    pairsCompared += 1;
    const re = reOf(earlier.abs);
    if (!probes.every((s) => re.test(s))) continue;
    const expandedMount =
      earlier.method === "use" &&
      resolvedMountPaths.has(earlier.abs) &&
      !unresolvedMountPaths.has(earlier.abs);
    // An expanded mount falls through (Router next()s on no-match) and its
    // inner routes are compared individually — see resolvedMountPaths above.
    const verdict = expandedMount ? "FALLS_THROUGH" : classify(earlier);
    if (verdict === "TERMINATES") {
      terminatingEarlier += 1;
      offenders.push({
        later: `${later.method.toUpperCase()} ${later.abs}`,
        laterAt: `${relative(ROOT, later.file)}:${later.line}`,
        earlier: `${earlier.method.toUpperCase()} ${earlier.abs}`,
        earlierAt: `${relative(ROOT, earlier.file)}:${earlier.line}`,
      });
      break; // one shadower is enough to make it dead
    }
    if (verdict === "UNKNOWN") unknownEarlier += 1;
  }
}

// ── vacuity floors, BEFORE any verdict ───────────────────────────────────────
const live = {
  serverFiles: files.length,
  registrations,
  globalRoutes: globalRoutes.length,
  paramRoutes,
  terminatingEarlier: classifiedTerminates,
};
for (const key of REQUIRED_FLOORS) {
  const floor = FLOORS[key];
  if (!Number.isInteger(floor) || floor < 1) fail(`floor "${key}" is missing or not a positive integer. A floor of 0 is not a floor.`);
  if (live[key] === undefined) fail(`population "${key}" was never measured — the scan changed shape but the floor did not.`);
  if (live[key] < floor) {
    fail(
      `VACUOUS SCAN — ${key}: ${live[key]} (floor ${floor}).\n` +
        `  This gate counts BAD THINGS FOUND, so a blind scan prints PASS. Find out why the\n` +
        `  population collapsed before touching the floor; lower it only for a real deletion,\n` +
        `  in the same commit, with the reason recorded in this file's header.`,
    );
  }
}

// ── down-only ratchet ────────────────────────────────────────────────────────
if (!existsSync(RATCHET_PATH)) fail(`missing ratchet file ${relative(ROOT, RATCHET_PATH)}`);
const cfg = JSON.parse(readFileSync(RATCHET_PATH, "utf8"));
const baseline = cfg.baseline;
const unknownBaseline = cfg.unknownHandlerBaseline;
if (!Number.isInteger(baseline) || !Number.isInteger(unknownBaseline)) {
  fail(`ratchet file must carry integer "baseline" and "unknownHandlerBaseline"`);
}

console.log(
  `${TAG} scanned ${live.serverFiles} files, ${live.registrations} registrations, ` +
    `${live.globalRoutes} globally-ordered routes (${routerMounts} router mounts, ` +
    `${registrarCalls} registrars, ${unresolved} unresolved), ${pairsCompared} pairs compared.`,
);

if (offenders.length > baseline) {
  console.error(`${TAG} FAIL — ${offenders.length} shadowed routes > baseline ${baseline}.`);
  console.error(`  A shadowed route is DEAD: registered, mounted, and unable to serve a request.`);
  for (const o of offenders.slice(0, 40)) {
    console.error(`    ${o.later}  (${o.laterAt})`);
    console.error(`      shadowed by earlier  ${o.earlier}  (${o.earlierAt})`);
  }
  console.error(`  Fix by ORDERING (register the specific route first) or by making the earlier`);
  console.error(`  handler call next("route") when it does not own the request. Do NOT raise the baseline.`);
  process.exit(1);
}
if (offenders.length < baseline) {
  fail(
    `STALE-HIGH baseline: ${offenders.length} shadowed routes < baseline ${baseline}.\n` +
      `  A reduction that is not locked in is a reduction that rots. Lower "baseline" to ` +
      `${offenders.length} in ${relative(ROOT, RATCHET_PATH)}, in the commit that earned it.`,
  );
}
if (unknownEarlier > unknownBaseline) {
  fail(
    `UNRESOLVED handlers ${unknownEarlier} > baseline ${unknownBaseline}. These are earlier\n` +
      `  registrations this gate cannot classify, so it cannot tell whether they hide a dead route.\n` +
      `  Make the handler an inline function, or resolve it — do not raise the baseline.`,
  );
}

console.log(
  `${TAG} PASS — ${offenders.length} shadowed route(s) at baseline ${baseline}; ` +
    `${unknownEarlier} unresolved earlier handler(s) at baseline ${unknownBaseline}.`,
);
