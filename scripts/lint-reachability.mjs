#!/usr/bin/env node
// ============================================================================
// scripts/lint-reachability.mjs — the REACHABILITY ratchet.
// ----------------------------------------------------------------------------
// WHY THIS EXISTS
//
// CLAUDE.md names "built but unwired" as this repo's single most common defect:
// new route files never mounted, jobs never registered, services with zero call
// sites, tables nothing reads. Every instance below passed `tsc`, every test,
// and every lint gate, and was found HOURS LATER by a human/agent audit:
//
//   • server/services/lateFees                — a correct §1026.36(c)(2)
//     non-pyramiding implementation with ZERO production callers.
//   • server/services/respa/earlyIntervention — a federal §1024.39 obligation,
//     zero callers.
//   • calculateFlipAnalysis                   — zero routes, zero client refs,
//     while the Pax persona discussed its output as available.
//   • taxSaleAuctions / taxSaleListings       — tables with zero insert paths,
//     feeding a flagship worksheet.
//   • achMandateSetup / achAutopayRun         — zero call sites.
//   • rental_units.kind = 'pad'               — a column supporting a whole
//     vertical's gap, zero writers.
//   • routes-contract-chain.ts                — a router never registered.
//   • the rent-roll importer's `unitKind` arg — zero callers.
//
// That is the finding: the existing gates check TYPES and BEHAVIOUR, and
// nothing checked REACHABILITY. This converts the recurring manual audit into
// a CI check.
//
// ----------------------------------------------------------------------------
// WHAT IT CHECKS — independently baselined counts, deliberately NOT tallied here
// (the summary line at the bottom derives the number from FAMILIES.length rather
// than restating it, because it said "four" for as long as there were four and
// would have said it forever — and this header then said "five" through the
// arrival of the sixth, proving the point twice)
//
//   1. unreached-exports   Every `export function|const|class` in
//                          server/services/** and server/jobs/**, cross-
//                          referenced against production (non-test) code. An
//                          export whose ONLY consumer is its own test file is
//                          UNREACHED — that is exactly the lateFees case.
//   2. tables-no-writer    Every `pgTable("x", …)` in shared/schema* with no
//     tables-no-reader     `.insert(`/`.update(`/`.delete(` (writer) or
//                          `.from(`/`join(`/`db.query.x` (reader). Reported in
//                          BOTH directions: a table nothing writes is dead
//                          weight; a table nothing reads is a black hole that
//                          silently accumulates rows forever.
//   3. unregistered-routes Every server/routes-*.ts exporting a
//                          `register*Routes` function or a default Router,
//                          cross-referenced against server/routes.ts,
//                          server/index.ts, ROUTE_MANIFEST, and any other
//                          production server file.
//   4. opaque-exports      THE SIZE OF THIS GATE'S OWN BLIND SPOT. Exports that
//                          families 1–3 cannot assert on, because their module
//                          is dynamically imported in a way that hides WHICH
//                          exports are touched (see the dynamic-import bullet
//                          below). Nothing here is proven dead — that is the
//                          point — but the number may only SHRINK, so the one
//                          population this linter admits it cannot see is no
//                          longer the one population free to grow without limit.
//                          See FAMILY 5 near the FAMILIES array for the
//                          measurement, and for the 2026-08-14 narrowing that
//                          cut this family by 859 by exempting only the imports
//                          that genuinely hide something.
//
// ----------------------------------------------------------------------------
// WHY IT IS A RATCHET, NOT A HARD GATE
//
// There are ~1400 server files and 755 tables. A hard gate would fail on day
// one and be `--no-verify`'d into irrelevance within a week. Per-family
// baselines live in scripts/ratchets/reachability.json and may only go DOWN —
// same discipline as the `as-any` ratchet, including the stale-high failure
// that forces a reduction to be locked in by the commit that earned it.
//
// THE CHEAPEST WAY TO SATISFY THIS GATE IS DELETION. If a thing is unreached,
// the right fix is almost always `rm`, not an allowlist entry. The north star
// is a SMALLER codebase; this gate should pull in that direction.
//
// ----------------------------------------------------------------------------
// WHAT STATIC ANALYSIS CANNOT SEE  (read this before believing a verdict)
//
// This linter is TOKEN-BASED, not a type-aware call-graph. It deliberately
// biases toward FALSE NEGATIVES (miss a dead thing) over FALSE POSITIVES (call
// a live thing dead), because a false positive that deletes a working feature
// is far worse than a miss. Concretely:
//
//   • Dynamic imports, but only the ones that HIDE something. `const m = await
//     import("./x")`, `(await import("./x")).default` and a bare side-effect
//     `import("./x")` make the module OPAQUE: every export of it is reported as
//     "opaque (dynamic import)" and is NOT counted as unreached, because the
//     call site does not say which exports it touches. A DESTRUCTURING dynamic
//     import — `const { runLazily } = await import("./x")` or
//     `import("./x").then(({ runLazily }) => …)` — confers NO opacity: it binds
//     a bare identifier the usage tokeniser below already sees, so exempting the
//     module's OTHER exports on the strength of it was pure loss. (It is still
//     recorded as an import, so the module-orphan family stays honest.)
//   • String-keyed dispatch & reflection. String literals are NOT stripped
//     before tokenizing, so `registry["calculateFlipAnalysis"]` and
//     `handlers.foo` both count as uses. A registry keyed by a name built at
//     runtime (`"calc" + kind`) is invisible to any static tool — this linter
//     says so rather than asserting the symbol is dead.
//   • Name collisions. A short/common export name that happens to appear as an
//     unrelated identifier anywhere counts as reached. Safe direction: a miss.
//   • Prose and registries resurrect corpses. Because string literals count,
//     a doc-comment or an inventory file (shared/governance/statuteRegister.ts,
//     server/routeManifest.ts's KNOWN_NON_MOUNTED) that NAMES a dead symbol
//     makes it look alive. Two known consequences are handled explicitly: this
//     script exempts ITSELF (its header names the corpses it hunts) and the
//     route family reads only ROUTE_MANIFEST, never KNOWN_NON_MOUNTED's prose.
//     Elsewhere the effect stands, and it is again a miss, not an accusation.
//   • Barrel re-exports do NOT count as a use — `export { x } from "./y"` and
//     `export * from "./y"` are stripped before tokenizing, so a symbol that is
//     only forwarded through an index.ts is still UNREACHED. (A barrel that
//     forwards a dead symbol is the same dead symbol with extra steps.)
//   • Table reads via a bare column reference (`eq(foo.id, …)` inside somebody
//     else's delete) are NOT counted as a read. Counting them would make
//     essentially every table "read" and destroy the signal.
//
// Therefore: a symbol reported here is a STRONG HINT, not a proof. Verify
// before deleting. The linter never claims certainty it does not have.
//
// ----------------------------------------------------------------------------
// ALLOWLIST — every entry carries a REASON, and the reason is PRINTED
//
// Some exports are legitimately unreached: a public API surface, a
// deliberately-staged seam, something behind a feature flag. Entries live in
// scripts/ratchets/reachability.json under "allowlist" and MUST carry a
// non-trivial `reason`; the linter refuses to run if one is missing, and prints
// every reason on every run so the justifications stay under review. An
// allowlist you can append to without justifying yourself is how a gate rots.
//
// ----------------------------------------------------------------------------
// USAGE
//   node scripts/lint-reachability.mjs            # gate (CI; part of npm run check)
//   node scripts/lint-reachability.mjs --measure  # print counts, never fail
//   node scripts/lint-reachability.mjs --report   # print EVERY finding, not a sample
//   node scripts/lint-reachability.mjs --root DIR # scan an alternate tree (self-test)
// ============================================================================

import { readFileSync, readdirSync, lstatSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const MEASURE_ONLY = argv.includes("--measure");
const REPORT_ALL = argv.includes("--report");
function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

const ROOT = resolve(argValue("--root") ?? join(__dirname, ".."));
const RATCHET_FILE =
  argValue("--ratchet") ?? join(ROOT, "scripts", "ratchets", "reachability.json");

const TAG = "[lint-reachability]";

// ----------------------------------------------------------------------------
// Filesystem walk (shared conventions with scripts/ratchet.mjs)
// ----------------------------------------------------------------------------
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "attached_assets",
  "playwright-report",
  "test-results",
]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) continue; // never follow: the repo has self-links
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|cts|js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (abs) => relative(ROOT, abs).split("\\").join("/");

/** Test/spec/fixture code — never counts as a production consumer. */
function isTestFile(relPath) {
  return (
    /\.(test|spec)\.(ts|tsx|mts|cts|js|mjs)$/.test(relPath) ||
    /(^|\/)(tests|__tests__|__mocks__|e2e|evals)\//.test(relPath) ||
    /\.d\.ts$/.test(relPath)
  );
}

/**
 * Directories that hold PRODUCTION consumers. scripts/ is included on purpose:
 * a service reachable only from an operational script is still reachable, and
 * this linter prefers a miss to a wrong accusation.
 */
const PRODUCTION_ROOTS = ["server", "client/src", "shared", "scripts", "script"];

/**
 * REGISTERS OF OFFENDING SYMBOLS — never counted as consumers.
 *
 * This file DOCUMENTS the dead symbols it exists to find (lateFees,
 * calculateFlipAnalysis, achAutopayRun …) in its own header. Token-wise that
 * reads as a use, so the linter would resurrect exactly the corpses it names.
 * Same shape as lint-prefetch-authority.mjs exempting the one file allowed to
 * call the API it bans.
 *
 * It is not the only such file any more, and the second one was found the hard
 * way. `check-org-scoped-fetch.mjs` froze 136 service-layer tenancy offenders
 * as `"server/services/<file>.ts::<method>"` keys; this scanner tokenises file
 * text, so `productEvolutionEngine` — a MODULE ORPHAN nothing imports, whose
 * singleton happens to share its filename — read as referenced and the count
 * silently fell 654 → 653. A register of things that are wrong must not make
 * them look right.
 *
 * Add a file here only if enumerating symbols IS its purpose. A script that
 * merely mentions one is a real consumer; this linter prefers a miss to a wrong
 * accusation, and the same caution applies in reverse.
 */
const SYMBOL_REGISTERS = new Set([
  "scripts/lint-reachability.mjs",
  "scripts/check-org-scoped-fetch.mjs",
]);

const productionFiles = [];
for (const r of PRODUCTION_ROOTS) {
  for (const abs of walk(join(ROOT, r))) {
    const p = rel(abs);
    if (SYMBOL_REGISTERS.has(p)) continue;
    if (!isTestFile(p)) productionFiles.push(p);
  }
}
// Root-level build/runtime config (vite, drizzle, tailwind, capacitor …) can be
// the only importer of a module. playwright.*/vitest.* are TEST harness config
// and are deliberately excluded — a reference from them is not production use.
if (existsSync(ROOT)) {
  for (const entry of readdirSync(ROOT)) {
    if (!/\.(ts|mts|cts|js|mjs)$/.test(entry)) continue;
    if (/^(playwright|vitest)\b/.test(entry)) continue;
    if (isTestFile(entry)) continue;
    if (lstatSync(join(ROOT, entry)).isFile()) productionFiles.push(entry);
  }
}

const fileCache = new Map();
function read(relPath) {
  if (!fileCache.has(relPath)) {
    fileCache.set(relPath, readFileSync(join(ROOT, relPath), "utf8"));
  }
  return fileCache.get(relPath);
}

// Strip barrel re-exports: forwarding a symbol is not consuming it.
const REEXPORT_RE =
  /export\s*(?:\*(?:\s+as\s+[A-Za-z_$][\w$]*)?|\{[^}]*\})\s*from\s*["'][^"']+["']/g;

// ----------------------------------------------------------------------------
// Allowlist + baselines
// ----------------------------------------------------------------------------
function loadRatchet() {
  if (!existsSync(RATCHET_FILE)) {
    console.error(`${TAG} missing baseline file ${relative(ROOT, RATCHET_FILE)}`);
    console.error(
      `${TAG} seed it by running with --measure and writing the printed counts.`,
    );
    process.exit(1);
  }
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(RATCHET_FILE, "utf8"));
  } catch (err) {
    console.error(`${TAG} ${RATCHET_FILE} is not valid JSON: ${err.message}`);
    process.exit(1);
  }
  cfg.allowlist ??= [];
  const seen = new Set();
  for (const entry of cfg.allowlist) {
    if (!entry.kind || !entry.id) {
      console.error(
        `${TAG} allowlist entry missing "kind"/"id": ${JSON.stringify(entry)}`,
      );
      process.exit(1);
    }
    if (typeof entry.reason !== "string" || entry.reason.trim().length < 20) {
      console.error(
        `${TAG} allowlist entry ${entry.kind}:${entry.id} has no real "reason".\n` +
          `  Every allowlist entry must justify itself in prose (>=20 chars) —\n` +
          `  "public API surface", "staged seam for <thing>", "behind <flag>".\n` +
          `  If you cannot write the reason, the answer is DELETE, not allowlist.`,
      );
      process.exit(1);
    }
    const key = `${entry.kind}:${entry.id}`;
    if (seen.has(key)) {
      console.error(`${TAG} duplicate allowlist entry ${key}`);
      process.exit(1);
    }
    seen.add(key);
  }
  cfg.baselines ??= {};
  return cfg;
}

const ratchet = loadRatchet();
/** kind → Map<id, reason> */
const allowByKind = new Map();
for (const e of ratchet.allowlist) {
  if (!allowByKind.has(e.kind)) allowByKind.set(e.kind, new Map());
  allowByKind.get(e.kind).set(e.id, e.reason);
}
const skippedByAllowlist = []; // {kind, id, reason}
function allowlisted(kind, id) {
  const reason = allowByKind.get(kind)?.get(id);
  if (reason === undefined) return false;
  skippedByAllowlist.push({ kind, id, reason });
  return true;
}
/** Allowlist ids that no longer match anything — stale, must be removed. */
function staleAllowlistEntries(liveKeys) {
  return ratchet.allowlist
    .filter((e) => !liveKeys.has(`${e.kind}:${e.id}`))
    .map((e) => `${e.kind}:${e.id}`);
}
const consideredKeys = new Set();

// ============================================================================
// FAMILY 1 — exported server symbols with no production call site
// ============================================================================

const EXPORT_SOURCE_DIRS = ["server/services", "server/jobs"];

const EXPORT_DECL_RE =
  /^[ \t]*export\s+(?:declare\s+)?(?:async\s+)?(function\*?|const|let|var|class|abstract\s+class)\s+([A-Za-z_$][\w$]*)/gm;

/** All candidate exports: id `path::symbol` → {file, symbol, line, kind}. */
const candidates = new Map();
const exportFiles = [];
for (const d of EXPORT_SOURCE_DIRS) {
  for (const abs of walk(join(ROOT, d))) {
    const p = rel(abs);
    if (isTestFile(p)) continue;
    exportFiles.push(p);
    const text = read(p);
    const lineStarts = [];
    for (let i = 0, n = 0; i <= text.length; i++) {
      if (i === 0 || text[i - 1] === "\n") lineStarts.push(i);
    }
    EXPORT_DECL_RE.lastIndex = 0;
    let m;
    while ((m = EXPORT_DECL_RE.exec(text)) !== null) {
      const symbol = m[2];
      const kind = m[1].includes("class")
        ? "class"
        : m[1].startsWith("function")
          ? "function"
          : "const";
      let line = 1;
      for (let i = 0; i < lineStarts.length; i++) {
        if (lineStarts[i] > m.index) break;
        line = i + 1;
      }
      candidates.set(`${p}::${symbol}`, { file: p, symbol, line, kind });
    }
  }
}

const candidateNames = new Set([...candidates.values()].map((c) => c.symbol));

/**
 * Modules pulled in dynamically anywhere in production code. Their exports are
 * OPAQUE — reported, never counted as dead.
 */
const DYNAMIC_IMPORT_RE = /(?:\bimport|\brequire)\s*\(\s*["'`]([^"'`]+)["'`]/g;
/** Relative specifiers resolved against the importer — exact module paths. */
const dynamicResolved = new Set();
/** Bare/aliased specifiers we cannot resolve — matched by basename tail. */
const dynamicUnresolvedTails = new Set();

/** symbol → Set<consumer file> (excluding the declaring file). */
const usage = new Map();
const IDENT_RE = /[A-Za-z_$][\w$]*/g;

/** Every module specifier imported anywhere in production, however imported. */
const STATIC_IMPORT_RE = /(?:\bfrom\s*|\bimport\s*)["'`]([^"'`\n]+)["'`]/g;
const importedModules = new Set();
const importedTails = new Set();
/** `@shared/x` → `shared/x`, `@/x` → `client/src/x` (see tsconfig paths). */
const ALIASES = [
  ["@shared/", "shared/"],
  ["@assets/", "attached_assets/"],
  ["@/", "client/src/"],
];
function recordImport(importerRel, spec) {
  let base = null;
  if (spec.startsWith(".")) {
    base = resolve("/", dirname(importerRel), spec).slice(1).split("\\").join("/");
  } else {
    for (const [prefix, replacement] of ALIASES) {
      if (spec.startsWith(prefix)) {
        base = replacement + spec.slice(prefix.length);
        break;
      }
    }
  }
  if (base === null) {
    // A package name, or an alias this linter doesn't know — fall back to the
    // basename so an unrecognised path shape can never manufacture an orphan.
    const tail = spec.replace(/\.(ts|tsx|mts|cts|js|mjs)$/, "").split("/").pop();
    if (tail) importedTails.add(tail);
    return;
  }
  const stem = base.replace(/\.(ts|tsx|mts|cts|js|mjs)$/, "");
  for (const form of [
    stem,
    `${stem}.ts`,
    `${stem}.tsx`,
    `${stem}.mts`,
    `${stem}.cts`,
    `${stem}.js`,
    `${stem}.mjs`,
    `${stem}/index.ts`,
    `${stem}/index.tsx`,
  ]) {
    importedModules.add(form);
  }
}

for (const p of productionFiles) {
  const raw = read(p);

  DYNAMIC_IMPORT_RE.lastIndex = 0;
  let dm;
  while ((dm = DYNAMIC_IMPORT_RE.exec(raw)) !== null) {
    const spec = dm[1];
    // A DESTRUCTURING dynamic import needs no opacity, and skipping it is the
    // whole of this narrowing. `const { routeAITask } = await import("./x")`
    // binds `routeAITask` as a bare identifier, which the usage tokeniser below
    // already sees — so exempting the module's OTHER exports on the strength of
    // it is pure loss. That over-exemption is what made `aiRouter.ts` shield ten
    // exports occurring nowhere else in production because three siblings were
    // destructured out of it.
    //
    // Everything else stays opaque, and the asymmetry is deliberate: a namespace
    // binding (`const m = await import(…)`) or a bare side-effect import genuinely
    // hides which exports are touched. This linter's stated bias is that a false
    // OPAQUE is a miss while a false UNREACHED is an ACCUSATION, so anything not
    // clearly destructured keeps its exemption.
    const destructured = isDestructuredDynamicImport(raw, dm.index, dm.index + dm[0].length);
    // A destructured dynamic import still IMPORTS the module — it just does not
    // hide which exports are used. Recording it in `importedModules`/`importedTails`
    // keeps `isModuleOrphan` honest; skipping the opaque sets is the narrowing.
    // Conflating the two made 172 destructure-imported modules read as "nothing
    // imports this file at all", which is a false accusation at scale.
    if (destructured) {
      recordImport(p, spec);
      continue;
    }
    if (spec.startsWith(".")) {
      // Resolve against the importing file's directory, then enumerate the
      // extension/index forms Node+TS would try.
      const base = resolve("/", dirname(p), spec).slice(1).split("\\").join("/");
      const stem = base.replace(/\.(ts|tsx|mts|cts|js|mjs)$/, "");
      for (const form of [
        stem,
        `${stem}.ts`,
        `${stem}.tsx`,
        `${stem}.mts`,
        `${stem}.cts`,
        `${stem}.js`,
        `${stem}.mjs`,
        `${stem}/index.ts`,
        `${stem}/index.tsx`,
      ]) {
        dynamicResolved.add(form);
      }
    } else {
      // "@/services/x", "@shared/x", a package name — no reliable resolution
      // here, so fall back to a basename tail match (deliberately generous:
      // a false OPAQUE is a miss, a false UNREACHED is an accusation).
      const tail = spec.replace(/\.(ts|tsx|mts|cts|js|mjs)$/, "").split("/").pop();
      if (tail) dynamicUnresolvedTails.add(tail);
    }
  }

  STATIC_IMPORT_RE.lastIndex = 0;
  let sm;
  while ((sm = STATIC_IMPORT_RE.exec(raw)) !== null) recordImport(p, sm[1]);

  if (candidateNames.size === 0) continue;
  const text = raw.replace(REEXPORT_RE, "");
  IDENT_RE.lastIndex = 0;
  let m;
  while ((m = IDENT_RE.exec(text)) !== null) {
    const tok = m[0];
    if (!candidateNames.has(tok)) continue;
    let set = usage.get(tok);
    if (!set) usage.set(tok, (set = new Set()));
    set.add(p);
  }
}

/**
 * Is this dynamic import destructured at the binding site?
 *
 * Two shapes count, and both make every name the caller uses a bare identifier
 * the tokeniser can see:
 *
 *     const { a, b } = await import("./x");
 *     import("./x").then(({ a }) => …)
 *
 * Anything else — `const m = await import(…)`, `(await import(…)).default`, a
 * bare side-effect import — does not, and keeps the module opaque.
 */
function isDestructuredDynamicImport(raw, startIdx, endIdx) {
  // Backwards: `} = await import(` / `} = import(`, tolerating whitespace and
  // newlines inside a multi-line destructuring list.
  const before = raw.slice(Math.max(0, startIdx - 400), startIdx);
  if (/\}\s*=\s*(?:await\s+)?$/.test(before)) return true;
  // Forwards: `.then(({ a }) => …)` immediately after the specifier's `)`.
  const after = raw.slice(endIdx, endIdx + 80);
  if (/^\s*\)\s*\.\s*then\s*\(\s*(?:async\s*)?\(?\s*\{/.test(after)) return true;
  return false;
}

/** Does any dynamic-import specifier resolve to this module? */
function isDynamicallyImported(relPath) {
  if (dynamicResolved.has(relPath)) return true;
  const noExt = relPath.replace(/\.(ts|tsx|mts|cts|js|mjs)$/, "");
  if (dynamicResolved.has(noExt)) return true;
  const base = noExt.endsWith("/index")
    ? noExt.slice(0, -"/index".length).split("/").pop()
    : noExt.split("/").pop();
  return dynamicUnresolvedTails.has(base);
}

const opaqueExports = [];
const unreachedExports = [];
for (const [id, c] of candidates) {
  const consumers = usage.get(c.symbol);
  const external = consumers ? [...consumers].filter((f) => f !== c.file) : [];
  if (external.length > 0) continue; // reached in production
  consideredKeys.add(`export:${id}`);
  if (isDynamicallyImported(c.file)) {
    opaqueExports.push({ ...c, id });
    continue;
  }
  if (allowlisted("export", id)) continue;
  unreachedExports.push({ ...c, id, moduleOrphan: isModuleOrphan(c.file) });
}

/**
 * True when NOTHING in production imports this module at all — the strongest
 * class of finding (a whole file nobody loads), versus a single over-exported
 * internal helper inside a module that IS loaded.
 */
function isModuleOrphan(relPath) {
  if (importedModules.has(relPath)) return false;
  const noExt = relPath.replace(/\.(ts|tsx|mts|cts|js|mjs)$/, "");
  if (importedModules.has(noExt)) return false;
  if (isDynamicallyImported(relPath)) return false;
  const base = noExt.endsWith("/index")
    ? noExt.slice(0, -"/index".length).split("/").pop()
    : noExt.split("/").pop();
  return !importedTails.has(base);
}

// ============================================================================
// FAMILY 2 — schema tables with no writer / no reader
// ============================================================================

const schemaFiles = productionFiles.filter(
  (p) => /^shared\/schema(\.ts$|\/)/.test(p) || /^shared\/schema[-.].*\.ts$/.test(p),
);

const PGTABLE_RE =
  /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*pgTable\s*\(\s*["'`]([^"'`]+)["'`]/g;

/** varName → {varName, tableName, file} */
const tables = new Map();
for (const p of schemaFiles) {
  const text = read(p);
  PGTABLE_RE.lastIndex = 0;
  let m;
  while ((m = PGTABLE_RE.exec(text)) !== null) {
    tables.set(m[1], { varName: m[1], tableName: m[2], file: p });
  }
}

// Drizzle query shapes. Optional `schema.` qualifier is tolerated.
const WRITE_RES = [
  /\.(?:insert|update|delete)\s*\(\s*(?:[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*)/g,
  /\binsert\s+into\s+["'`]?([A-Za-z_][\w]*)/gi, // raw SQL
  /\bupdate\s+["'`]?([A-Za-z_][\w]*)["'`]?\s+set\b/gi,
  /\bdelete\s+from\s+["'`]?([A-Za-z_][\w]*)/gi,
];
const READ_RES = [
  /\.from\s*\(\s*(?:[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*)/g,
  /(?:[Jj]oin|\$count|selectDistinctOn)\s*\(\s*(?:[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*)/g,
  /\bdb\.query\.([A-Za-z_$][\w$]*)/g,
  /\bfrom\s+["'`]?([A-Za-z_][\w]*)/gi, // raw SQL (module specifiers can't match)
  /\bjoin\s+["'`]?([A-Za-z_][\w]*)/gi,
];

const QUERY_ROOTS = ["server", "shared", "scripts"];
const writeNames = new Set();
const readNames = new Set();
for (const p of productionFiles) {
  if (!QUERY_ROOTS.some((r) => p.startsWith(`${r}/`))) continue;
  if (schemaFiles.includes(p)) continue; // the definition is neither read nor write
  const text = read(p);
  for (const re of WRITE_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) writeNames.add(m[1]);
  }
  for (const re of READ_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) readNames.add(m[1]);
  }
}

const tablesNoWriter = [];
const tablesNoReader = [];
for (const t of tables.values()) {
  const written = writeNames.has(t.varName) || writeNames.has(t.tableName);
  const read_ = readNames.has(t.varName) || readNames.has(t.tableName);
  if (!written) {
    consideredKeys.add(`table-writer:${t.tableName}`);
    if (!allowlisted("table-writer", t.tableName)) tablesNoWriter.push(t);
  }
  if (!read_) {
    consideredKeys.add(`table-reader:${t.tableName}`);
    if (!allowlisted("table-reader", t.tableName)) tablesNoReader.push(t);
  }
}

// ============================================================================
// FAMILY 3 — route files never registered
// ============================================================================

const routeFiles = productionFiles.filter((p) => /^server\/routes-[\w.-]+\.ts$/.test(p));

const REGISTER_EXPORT_RE = /export\s+(?:async\s+)?function\s+(register[\w$]*Routes?)\s*\(/g;
const DEFAULT_EXPORT_RE = /export\s+default\s+([A-Za-z_$][\w$]*)/;

/** ROUTE_MANIFEST body only — KNOWN_NON_MOUNTED deliberately does NOT count. */
let manifestBody = "";
const manifestPath = "server/routeManifest.ts";
if (existsSync(join(ROOT, manifestPath))) {
  const t = read(manifestPath);
  const start = t.indexOf("ROUTE_MANIFEST");
  const open = t.indexOf("[", start);
  const close = t.indexOf("\n];", open);
  if (start >= 0 && open >= 0 && close > open) manifestBody = t.slice(open, close);
}

const unregisteredRoutes = [];
for (const p of routeFiles) {
  const text = read(p);
  const base = p.split("/").pop();
  const moduleSpec = `./${base.replace(/\.ts$/, "")}`;

  const symbols = [];
  REGISTER_EXPORT_RE.lastIndex = 0;
  let m;
  while ((m = REGISTER_EXPORT_RE.exec(text)) !== null) symbols.push(m[1]);
  const hasDefault = DEFAULT_EXPORT_RE.test(text);
  if (symbols.length === 0 && !hasDefault) continue; // nothing mountable to check

  if (manifestBody.includes(`"${base}"`)) continue; // listed as mounted

  // Referenced by any OTHER production server file (routes.ts, index.ts, or a
  // sub-router that mounts it) — by register symbol or by module specifier.
  let referenced = false;
  for (const q of productionFiles) {
    if (q === p || !q.startsWith("server/")) continue;
    // routeManifest.ts is handled above via ROUTE_MANIFEST only — its
    // KNOWN_NON_MOUNTED prose NAMES the orphan symbols, which would otherwise
    // read as a reference and hide exactly the files it is documenting.
    if (q === manifestPath) continue;
    const t = read(q);
    if (symbols.some((s) => t.includes(s)) || t.includes(moduleSpec)) {
      referenced = true;
      break;
    }
  }
  if (referenced) continue;

  const id = base;
  consideredKeys.add(`route:${id}`);
  if (allowlisted("route", id)) continue;
  unregisteredRoutes.push({
    file: p,
    id,
    symbols: symbols.length ? symbols : ["default export (Router)"],
  });
}

// ============================================================================
// Reporting
// ============================================================================

const FAMILIES = [
  {
    key: "unreachedExports",
    label: "unreached-exports",
    findings: unreachedExports,
    describe: (f) =>
      `${f.file}:${f.line}  ${f.kind} ${f.symbol} — no production consumer` +
      (f.moduleOrphan
        ? " [MODULE ORPHAN — nothing imports this file at all]"
        : usage.get(f.symbol)?.size
          ? " (only its own module/tests reference it)"
          : ""),
    remedy:
      "DELETE it (cheapest, and the north star is a smaller codebase), or WIRE it\n" +
      "  to a route/job/service that actually calls it, or ALLOWLIST it in\n" +
      "  scripts/ratchets/reachability.json with a real reason.",
  },
  {
    key: "tablesNoWriter",
    label: "tables-no-writer",
    findings: tablesNoWriter,
    describe: (f) =>
      `${f.file}  ${f.varName} ("${f.tableName}") — no .insert/.update/.delete anywhere`,
    remedy:
      "A table nothing writes is dead weight. DROP it (and lower the table-count\n" +
      "  ratchet in the same commit), or WIRE the insert path the feature needs,\n" +
      "  or ALLOWLIST it with a reason.",
  },
  {
    key: "tablesNoReader",
    label: "tables-no-reader",
    findings: tablesNoReader,
    describe: (f) =>
      `${f.file}  ${f.varName} ("${f.tableName}") — written (or not) but never queried`,
    remedy:
      "A table nothing reads is a BLACK HOLE: it accumulates rows forever and no\n" +
      "  surface can ever show them. DROP it, or WIRE the read the feature\n" +
      "  promised, or ALLOWLIST it with a reason.",
  },
  {
    key: "unregisteredRoutes",
    label: "unregistered-routes",
    findings: unregisteredRoutes,
    describe: (f) => `${f.file}  exports ${f.symbols.join(", ")} — never mounted`,
    remedy:
      "An unmounted router is a feature that 404s in production. MOUNT it in\n" +
      "  server/routes.ts (and add it to ROUTE_MANIFEST), or DELETE the file, or\n" +
      "  ALLOWLIST it with a reason.",
  },
  {
    // FAMILY 6 — whole FILES nothing imports, counted as files.
    //
    // `unreachedExports` already contains these — 228 of its 653 carry the
    // `[MODULE ORPHAN]` label — so this adds no new detection. What it adds is
    // the unit a decision is actually made in. 653 unreached exports is a number
    // you work down one symbol at a time; **62 files, 19,685 lines, that nothing
    // imports** is a number someone can rule on in one sitting, and deleting one
    // orphan removes several exports from 653 at once.
    //
    // It is NOT one decision, and the list makes that obvious. Three classes:
    //
    //   • REGULATED OBLIGATIONS BUILT AND NEVER WIRED. `breachNotificationTrigger.ts`
    //     computes GLBA §314.4(j) / GDPR Art. 33 / state breach deadlines and its
    //     own header names the five events that should call it — nothing does.
    //     `paymentApplication/`, `landlordCompliance.ts`, `usuryCeiling.ts`,
    //     `rental/leaseSigningPacket.ts` are the same shape. Deleting these
    //     removes capability the product may be legally required to have; WIRING
    //     is the fix, and where to hook it is a judgement call.
    //   • SUPERSEDED DUPLICATES. `authLockout.ts` is dead because
    //     `middleware/authPathLimits.ts#loginLimiter` is live — the control
    //     exists, this copy of it does not run. Deletion is the answer.
    //   • EXPERIMENTS. The `*V9.ts` set, `scp*`, `aiAdvisorTeamV15`,
    //     `*Enhancements.ts` — the family the 2026-08-01 founder deletion wave
    //     already ruled on once.
    //
    // Recorded as BLOCKERS B19 with the full list. This count exists so the
    // population cannot quietly grow while that decision waits, and so that
    // deleting a batch is locked in by the commit that earns it.
    key: "moduleOrphans",
    label: "module-orphans",
    // ALLOWLISTABLE since unit 113, and the gap that forced it is worth recording:
    // this family was the ONLY one with no escape valve. Every other family can
    // exempt a legitimately-unreached thing with a written reason; this one could
    // not, so a deliberately-staged module left exactly one option — RAISE THE
    // BASELINE, which is the move the gate's own remedy text tells you not to
    // make. A gate whose only available answer is the one it forbids trains
    // people to make it.
    //
    // The case that surfaced it: the founder ruled (picker, 2026-08-15) to REMOVE
    // the three mounted /developer/* endpoints and KEEP developerApiService.ts for
    // when the expansion ladder's trigger fires. That is precisely "a
    // deliberately-staged seam" — the reason the allowlist exists — and it had
    // nowhere to go.
    //
    // NOTE the `consideredKeys.add` before the filter, and do not "simplify" it
    // away. The staleness check asks whether an allowlist entry was ever a
    // CANDIDATE, not whether it ended up in findings — so filtering without
    // registering makes a live exemption read as stale, and the gate demands you
    // delete the very entry that is doing its job. The first version of this
    // block did exactly that. Same shape as unit 110's module-orphan trap:
    // answering two questions ("is it a candidate?" / "is it reported?") with one
    // expression.
    findings: [...new Set(unreachedExports.filter((f) => f.moduleOrphan).map((f) => f.file))]
      .filter((file) => {
        consideredKeys.add(`module-orphan:${file}`);
        return !allowlisted("module-orphan", file);
      })
      .map((file) => ({ file })),
    describe: (f) => `${f.file} — nothing in production imports this file`,
    remedy:
      "Three different answers, and the file tells you which (see BLOCKERS B19):\n" +
      "  a REGULATED obligation built and never wired must be WIRED, not deleted;\n" +
      "  a SUPERSEDED duplicate should be deleted; an EXPERIMENT should be deleted.\n" +
      "  Deleting one also removes its exports from unreached-exports — lower BOTH\n" +
      "  baselines in the same commit.",
  },
  {
    // FAMILY 5 — the gate's own blind spot, counted instead of narrated.
    //
    // These are exports the families above CANNOT assert on, because
    // `isDynamicallyImported()` marks their whole MODULE opaque. They were once
    // printed as an informational line with no gate, which meant the one
    // population this linter admits it cannot see was also the one population
    // free to grow without limit.
    //
    // WHY IT WAS SO LARGE — and the fix, which HAS now been taken. Opacity is
    // applied per-MODULE while consumption is per-SYMBOL, and the rule used to
    // exempt a module on the strength of ANY dynamic import of it. So
    // `server/services/aiRouter.ts`, pulled in by
    // `const { routeAITask, TaskComplexity } = await import("../services/aiRouter")`
    // from destructured call sites across a dozen server files (17 at unit
    // 117's recount; earlier editions said "five", which was never accurate — a
    // number in prose decays), also shielded MODEL_PRESETS, isClaudeModel,
    // routeVisionTask, routeExtendedThinkingTask, getDbModelConfigs,
    // applyEvalQualityGate and the rest — exports appearing NOWHERE else in
    // production, invisible purely because a SIBLING was destructured out of the
    // module. One dynamic import laundered every export in it.
    //
    // A destructuring dynamic import needs no opacity at all: the destructured
    // name is a bare identifier the usage tokeniser already sees. Only a
    // namespace binding (`const m = await import(…)`), a `(await import(…)).x`
    // and a bare side-effect import genuinely hide which exports are touched. Of
    // 1,244 distinct dynamic-import specifiers, 838 were reached ONLY by
    // destructuring and just 27 ever took a namespace binding — which is why
    // `isDestructuredDynamicImport()` moved 859 exports in one step:
    // opaque-exports 984 -> 125, unreached-exports 580 -> 1439.
    //
    // CORRECTED (unit 117, wave audit). Earlier editions of this comment claimed
    // the reclaimed 859 included achMandateSetup/achAutopay symbols "that opacity
    // had been hiding". FALSE: those modules are STATICALLY imported (jobs/
    // achAutopayRun.ts, routes-borrower.ts), so opacity never applied to them —
    // their unreached symbols were visible under the OLD rule too, and zero of
    // the 859 are ach symbols. The narrowing's case never needed the flourish;
    // the audit that caught the invented attribution is the wave rule working on
    // this program's own output.
    //
    // That raise is the one this ratchet reserves to sign-off, and it has it:
    // founder approval, 2026-08-14. What remains here is the residue the rule
    // still cannot see through, and it is still strictly down-only. Comments are
    // stripped when measuring, because a comment naming a symbol makes it look
    // reached — the mechanism this ratchet's InvestorVerificationService
    // allowlist entry records.
    key: "opaqueExports",
    label: "opaque-exports",
    findings: opaqueExports,
    describe: (f) =>
      `${f.file}:${f.line}  ${f.kind} ${f.symbol} — unassertable: this module is ` +
      `dynamically imported somewhere, so every export in it is exempt`,
    remedy:
      "This count is the SIZE OF THE BLIND SPOT, so lowering it is progress even\n" +
      "  though nothing here is proven dead. Three ways down, cheapest first:\n" +
      "  DELETE the export if nothing calls it (most of this family has no\n" +
      "  occurrence in production outside its own file); or convert the dynamic\n" +
      "  `await import()` to a STATIC import where it exists only to break a cycle\n" +
      "  that no longer exists, which makes the whole module assertable; or\n" +
      "  ALLOWLIST it with a reason. Do NOT raise the baseline.",
  },
];

console.log(
  `${TAG} scanned ${productionFiles.length} production files · ` +
    `${candidates.size} exported symbols in ${exportFiles.length} service/job files · ` +
    `${tables.size} pgTable definitions · ${routeFiles.length} route files`,
);

if (skippedByAllowlist.length > 0) {
  console.log(`${TAG} allowlist — ${skippedByAllowlist.length} skipped, with reasons:`);
  for (const s of skippedByAllowlist) {
    console.log(`  ○ ${s.kind}:${s.id}\n      reason: ${s.reason}`);
  }
}
if (opaqueExports.length > 0) {
  console.log(
    `${TAG} ${opaqueExports.length} export(s) live in dynamically-imported modules — ` +
      `NOT asserted dead (static analysis cannot see through \`await import(\`).`,
  );
  // Sample only when NOT reporting all — with --report the `opaque-exports`
  // family below prints every one of these, and printing them twice buries the
  // other families' findings between two copies of the same list.
  if (!REPORT_ALL) {
    for (const o of opaqueExports.slice(0, 5)) {
      console.log(`  ? ${o.file}:${o.line}  ${o.symbol}`);
    }
  }
}

const stale = staleAllowlistEntries(consideredKeys);
let failed = false;

for (const fam of FAMILIES) {
  const count = fam.findings.length;
  const baseline = ratchet.baselines[fam.key];

  if (MEASURE_ONLY) {
    console.log(
      `${TAG}:measure ${fam.label}: current=${count} baseline=${baseline ?? "unset"}`,
    );
    for (const f of fam.findings) console.log(`    • ${fam.describe(f)}`);
    continue;
  }

  if (baseline === undefined) {
    failed = true;
    console.error(
      `${TAG} ${fam.label}: FAIL — no baseline. Add "${fam.key}": ${count} to ` +
        `${relative(ROOT, RATCHET_FILE)}.`,
    );
    continue;
  }

  if (count === baseline) {
    console.log(`${TAG} ${fam.label}: PASS — ${count} (baseline ${baseline})`);
    if (REPORT_ALL) for (const f of fam.findings) console.log(`    • ${fam.describe(f)}`);
    continue;
  }

  failed = true;
  if (count > baseline) {
    console.error(
      `${TAG} ${fam.label}: FAIL — ${count} > baseline ${baseline} ` +
        `(+${count - baseline} newly-unreachable). Built but unwired:`,
    );
    const show = REPORT_ALL ? fam.findings : fam.findings.slice(0, 25);
    for (const f of show) console.error(`  ✗ ${fam.describe(f)}`);
    if (show.length < count) {
      console.error(`  … ${count - show.length} more (run with --report to see all)`);
    }
    console.error(`  → ${fam.remedy}`);
    console.error(
      `  Do NOT raise the baseline to make this pass — fix the occurrence.`,
    );
  } else {
    console.error(
      `${TAG} ${fam.label}: FAIL — stale-high baseline. Current count is ${count}, ` +
        `baseline says ${baseline}.`,
    );
    console.error(
      `  Good news: ${baseline - count} unreachable item(s) were wired or deleted. ` +
        `Lock it in —\n  set "baselines.${fam.key}": ${count} in ` +
        `${relative(ROOT, RATCHET_FILE)}.`,
    );
  }
}

if (stale.length > 0 && !MEASURE_ONLY) {
  failed = true;
  console.error(
    `${TAG} FAIL — ${stale.length} stale allowlist entr(ies): the thing is now ` +
      `reached (or gone), so the exemption is obsolete. Remove:`,
  );
  for (const s of stale) console.error(`  ✗ ${s}`);
}

if (MEASURE_ONLY) {
  console.log(`${TAG} measure-only — no gate applied`);
  process.exit(0);
}
if (failed) {
  console.error(
    `${TAG} FAIL — reachability ratchet violated. Remember: DELETION is the ` +
      `cheapest way to satisfy this gate.`,
  );
  process.exit(1);
}
console.log(
  `${TAG} PASS — all ${FAMILIES.length} reachability counts at baseline`,
);
process.exit(0);
