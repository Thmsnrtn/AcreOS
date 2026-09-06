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
//                          UNREACHED — that is exactly the lateFees case, and
//                          a green unit test is the disguise that case wears:
//                          it is the strongest possible evidence the code WORKS
//                          and no evidence at all that anything RUNS it.
//   1b. internal-only-      Exported, then used ONLY inside its own module.
//       exports            Split out of family 1 on 2026-08-20 because it is a
//                          different rule with a different remedy — drop the
//                          `export` keyword, not the code — and because merged
//                          it drowned family 1 four-to-one (1,188 against 390).
//                          A gate whose findings are mostly noise trains its
//                          readers to skim it.
//   2. tables-no-writer    Every `pgTable("x", …)` in shared/schema* with no
//     tables-no-reader     `.insert(`/`.update(`/`.delete(` (writer) or
//                          `.from(`/`join(`/`db.query.x` (reader). Reported in
//                          BOTH directions: a table nothing writes is dead
//                          weight; a table nothing reads is a black hole that
//                          silently accumulates rows forever.
//   3. unregistered-routes Every non-test file ANYWHERE under server/ that
//                          exports a route registrar (`register…(app: Express)`)
//                          or an Express Router, cross-referenced against
//                          ROUTE_MANIFEST and every other production server
//                          file that IMPORTS it. Mountedness is computed as a
//                          FIXED POINT: a referrer that is itself an unmounted
//                          router confers nothing, so a sub-router reachable
//                          only from an unmounted registrar is unmounted too.
//                          (Widened 2026-08-16 — see the blind-spot note below.)
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
//                          that genuinely hide something. Narrowed again on
//                          2026-08-20, 120 → 23: an export the module itself
//                          uses was never in the blind spot at all, and family
//                          1b can describe it exactly.
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
//   • Route mountedness is decided by MODULE PATH, not by symbol name. 97 of the
//     277 route candidates export a Router named literally `router`, so a
//     `t.includes("router")`/`\brouter\b` sweep marks essentially every server
//     file a referrer and launders the whole family. Registrar FUNCTION names
//     (`registerFooRoutes`) are distinctive enough to keep; Router variable
//     names are not, and are matched by resolved import specifier only.
//
// ----------------------------------------------------------------------------
// VACUITY GUARD — an empty scan must FAIL, not read as a clean bill of health
//
// Every count here is "how many bad things did I find", so a scan that stops
// seeing FILES reports zero and passes. This repo has been bitten by exactly
// that (a block-comment stripper that mispaired and blanked the lines a scan was
// counting). `minima` in the ratchet file therefore floors the SCAN populations
// — production files and route candidates — and the run fails if either drops
// below. The floors sit well under the live numbers: they exist to catch a
// broken walk/regex, not to forbid deletion. A `--root` fixture run must pass
// its own `--ratchet` with fixture-sized minima.
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
import { stripCommentsPreservingLines, verifyStripper } from "./lib/strip-comments.mjs";

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
/** Files listed by the walk that were gone by the time they were read. */
let vanishedDuringScan = 0;
function read(relPath) {
  if (!fileCache.has(relPath)) {
    let text = "";
    try {
      text = readFileSync(join(ROOT, relPath), "utf8");
    } catch (err) {
      // A gate self-test can write a probe into server/services, run the real
      // gate, and delete it again while vitest runs another file in parallel —
      // so a path can vanish between the walk and the read. Crashing here made
      // a load-bearing gate fail intermittently with an fs stack trace instead
      // of a verdict, which reads as a finding and is not one. Treated as an
      // empty file (it contributes no exports, no imports, no identifiers) and
      // COUNTED, because a tree rewriting itself under the scan is not a tree
      // this gate can certify. The count is checked against a ceiling below.
      if (!err || err.code !== "ENOENT") throw err;
      vanishedDuringScan += 1;
    }
    fileCache.set(relPath, text);
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

// WIDENED 2026-08-21 to include `shared`, and the reason is the whole point of
// this gate: `shared` was already in PRODUCTION_ROOTS (so shared files COUNT as
// call sites) while being absent here (so shared files could never be REPORTED
// unreached). A shared module nothing loads was therefore invisible to the
// built-but-unwired rule — and `shared/` is where the canonical registries live.
//
// The newly-visible population is frozen in its OWN baselines rather than added
// to the server ones (see PER_ROOT below). That is the precedent set by
// check-org-scoped-fetch's 2026-08-16 widening from method-shape to
// function-shape: the existing registers did not move at all, so the signal they
// carry is not diluted by a one-off +54.
/**
 * THE POPULATION THIS GATE READS — widened 2026-09-06, and the widening is the
 * point.
 *
 * This linter exists to catch built-but-unwired code, which CLAUDE.md names as
 * this repository's single most common defect. For its whole life it read three
 * directories: server/services, server/jobs and shared. It had never opened
 *
 *     server/middleware   server/utils   server/ai   server/storage
 *
 * so every export in them was invisible to the instrument whose entire job is
 * seeing them. `server/ai` is the same directory CLAUDE.md's third law names as
 * a load-bearing population — the one whose 91-case dispatch switch no gate had
 * ever read.
 *
 * Measured on widening: unreached-exports 370 -> 434, internal-only 1168 ->
 * 1242, module-orphans 28 -> 36, opaque-exports 16 -> 19. 149 items became
 * visible in one step.
 *
 * THOSE BASELINES WENT UP, WHICH A DOWN-ONLY RATCHET NORMALLY FORBIDS. The code
 * did not get worse; the gate started looking. That is the one legitimate reason
 * a ratchet may rise, and it is why this note exists rather than a one-line bump
 * — a silent increase here is indistinguishable from the regression the ratchet
 * is meant to stop. From this point the counts are down-only again, so the value
 * bought is that NEW dead code in these four directories now fails CI, which it
 * never could before.
 *
 * The 149 are debt, not absolution. They are not triaged here: the precedent
 * (the 30-entry UNREACHABLE cluster in the deletion ledger) is that a cluster
 * this size gets one agent per file plus an adversarial second read, and becomes
 * a ledger row rather than a deletion commit. Adding a directory to this list is
 * cheap; deleting what it reveals is the work.
 */
const EXPORT_SOURCE_DIRS = [
  "server/services",
  "server/jobs",
  "server/middleware",
  "server/utils",
  "server/ai",
  "server/storage",
  "shared",
];

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
/**
 * `path::symbol` → occurrences of that symbol inside its OWN declaring file.
 *
 * One occurrence is the declaration itself. Two or more means the module uses
 * the thing it exports, which is a different finding from "nothing anywhere
 * touches this" and gets its own family below.
 *
 * Tokens, not scopes — so a dead `export const handler` in a file that also has
 * a local `handler` reads as internally used. That misclassification moves a
 * finding from the ACCUSING family to the quieter one, which is the direction
 * this linter always errs in: a miss beats naming innocent code.
 */
const ownRefs = new Map();
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

  // Comments are not code: see stripCommentsPreservingLines above. Every scan
  // in this loop — the two EXEMPTION-granting import scans and the ACCUSING
  // identifier pass — reads the stripped text. The identifier pass came last
  // and cost the most; see the note at its call site.
  const code = stripCommentsPreservingLines(raw);

  DYNAMIC_IMPORT_RE.lastIndex = 0;
  let dm;
  while ((dm = DYNAMIC_IMPORT_RE.exec(code)) !== null) {
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
    const destructured = isDestructuredDynamicImport(code, dm.index, dm.index + dm[0].length);
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
  while ((sm = STATIC_IMPORT_RE.exec(code)) !== null) recordImport(p, sm[1]);

  if (candidateNames.size === 0) continue;
  // A COMMENT IS NOT A CALL SITE, and this pass is where that mattered most.
  // It used to tokenise `raw`, so a symbol merely NAMED in prose — a stale
  // TODO, a docblock, a header listing the very corpses a gate exists to find —
  // certified it as REACHED. `InvestorVerificationService` sat in this file's
  // own allowlist for precisely that reason: its only consumer was a TODO.
  //
  // Ledger 35 stripped the two import scans and deliberately stopped short of
  // this one, because those two grant EXEMPTIONS (a wrong answer hides a
  // finding) while this one produces ACCUSATIONS (a wrong answer names innocent
  // code). Landing it needed the population read, not just counted: all 86
  // newly-revealed symbols were searched by hand on 2026-08-20, and ZERO had an
  // external reference this pass would now miss. That is what made it safe.
  const text = code.replace(REEXPORT_RE, "");
  IDENT_RE.lastIndex = 0;
  let m;
  while ((m = IDENT_RE.exec(text)) !== null) {
    const tok = m[0];
    if (!candidateNames.has(tok)) continue;
    let set = usage.get(tok);
    if (!set) usage.set(tok, (set = new Set()));
    set.add(p);
    // Occurrences in the declaring file separate the two remedies: delete it,
    // versus stop exporting it.
    const ownKey = `${p}::${tok}`;
    if (candidates.has(ownKey)) ownRefs.set(ownKey, (ownRefs.get(ownKey) ?? 0) + 1);
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
/** Nothing in production references the symbol at all — not even its module. */
const unreachedExports = [];
/**
 * Referenced INSIDE its declaring module and nowhere else.
 *
 * A separate family, and separating it is not cosmetic. These two findings have
 * different remedies (delete the code / delete the `export` keyword), different
 * risk (dead weight / none at runtime), and wildly different populations — the
 * comment-strip that landed with this split revealed 20 of the first kind and
 * 66 of the second. Dumping 66 harmless over-exports into the accusation family
 * would have buried the 20 that matter under noise, and a gate whose findings
 * are mostly noise teaches its readers to skim it. Each rule keeps a ratchet
 * that means something.
 */
const internalOnlyExports = [];
for (const [id, c] of candidates) {
  const consumers = usage.get(c.symbol);
  const external = consumers ? [...consumers].filter((f) => f !== c.file) : [];
  if (external.length > 0) continue; // reached in production
  consideredKeys.add(`export:${id}`);
  // >1 because the declaration itself is one occurrence.
  const usedInOwnModule = (ownRefs.get(id) ?? 0) > 1;
  // OPACITY IS AN EXEMPTION FROM THE DEATH ACCUSATION, AND ONLY THAT.
  //
  // This file's stated bias — a false OPAQUE is a miss, a false UNREACHED is an
  // accusation — is why a dynamically-imported module's exports are never called
  // dead. That bias is about DELETION. `internal-only` proposes something else
  // entirely: keep the code, drop the `export` keyword. Its cost when wrong is
  // bounded and immediate (tsc and the suite fail on the next build), where a
  // wrong deletion is unbounded and silent.
  //
  // And the blind spot barely exists for this question. A dynamic importer that
  // uses a NAMED export leaves the name in its own text either way —
  // `const { judgeSafety } = await import(…)` binds a bare identifier, and
  // `m.judgeSafety` still tokenises as `judgeSafety`. Only a COMPUTED access
  // (`m[someVariable]`) hides it, which is as true of a static namespace import
  // as a dynamic one, so opacity was never what protected against it.
  //
  // So the family that accuses keeps the exemption absolutely, and the family
  // that merely narrows a scope sees through it. Without this the new family
  // would have been born with a hole in it: every over-export inside a
  // dynamically-imported module — six of them revealed by the comment strip
  // alone — would sit in the blind-spot count forever, uncounted by the rule
  // that actually describes them.
  if (!usedInOwnModule && isDynamicallyImported(c.file)) {
    opaqueExports.push({ ...c, id });
    continue;
  }
  // ONE allowlist kind for both families, on purpose. An exemption is written
  // about a SYMBOL ("staged for the expansion ladder"), and whether that symbol
  // currently happens to be used inside its own module is not something the
  // author of the reason was ruling on. Keying the exemption on the family
  // would silently expire it the day someone added an internal call.
  if (allowlisted("export", id)) continue;
  const finding = {
    ...c,
    id,
    moduleOrphan: isModuleOrphan(c.file),
    opaqueModule: isDynamicallyImported(c.file),
  };
  if (usedInOwnModule) internalOnlyExports.push(finding);
  else unreachedExports.push(finding);
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

/**
 * TABLE ALIASES — `export const marketIndicators = marketIndicatorsDuplicate;`
 *
 * A pgTable can be exported under a SECOND name, and callers then query the
 * alias. The reader/writer scan below matches identifiers textually, so it
 * looks for the pgTable's own varName and never sees the alias — and the table
 * is reported as having no reader AND no writer while being fully live.
 *
 * NOT HYPOTHETICAL, and the cost was nearly a dropped production table. The
 * 2026-08-16 dead-table triage (founder ruling) had `market_indicators_temp` in
 * its candidate set on the strength of this gate. shared/schema.ts:12435 exports
 * `marketIndicators` as an alias of `marketIndicatorsDuplicate`, and
 * server/services/marketPrediction.ts BOTH reads it (`.from(marketIndicators)`)
 * and writes it (`.insert(marketIndicators)`). It survived only because the
 * agent executing the ruling read the schema instead of trusting this gate.
 *
 * This linter's standing bias is that a MISS beats an ACCUSATION — an unreached
 * export is a claim about someone's code. A false "no reader AND no writer" on a
 * live table is the most expensive accusation it can make, because the action it
 * invites is DROP TABLE.
 *
 * Resolution is transitive (`a = b; b = c;`) and bounded, and only RHS names
 * that resolve to a known pgTable are accepted — so an unrelated re-export of a
 * non-table const contributes nothing.
 */
const TABLE_ALIAS_RE = /export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*([A-Za-z_$][\w$]*)\s*;/g;
/** tables varName → Set of every additional identifier that names it */
const tableAliases = new Map();
{
  const rawAliases = new Map(); // alias → target identifier
  for (const p of schemaFiles) {
    const text = read(p);
    TABLE_ALIAS_RE.lastIndex = 0;
    let m;
    while ((m = TABLE_ALIAS_RE.exec(text)) !== null) {
      if (m[1] !== m[2]) rawAliases.set(m[1], m[2]);
    }
  }
  for (const [alias, target0] of rawAliases) {
    let target = target0;
    // Bounded chase: `a = b; b = c;` resolves to c. The cap is the alias count,
    // so a cycle terminates instead of hanging the gate.
    for (let i = 0; i < rawAliases.size && !tables.has(target); i++) {
      const next = rawAliases.get(target);
      if (next === undefined) break;
      target = next;
    }
    if (!tables.has(target)) continue; // not a table alias — ignore entirely
    if (!tableAliases.has(target)) tableAliases.set(target, new Set());
    tableAliases.get(target).add(alias);
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
  //
  // THE RELATIONAL READ, WHATEVER THE HANDLE IS SPELLED.
  //
  // This was `/\bdb\.query\.(\w+)/` — pinned to the literal receiver `db`.
  // That is a POPULATION claim disguised as a pattern: it says "a relational
  // read is one written on a variable named db", and every read written on
  // anything else was outside the set this gate measured.
  //
  // It cost a false accusation the day the tenancy burn-down started routing
  // deliberate cross-org reads through `unscopedForPlatformOps(reason).query.x`
  // — the sanctioned, logged hatch. The receiver became a call expression, the
  // regex stopped matching, and `scp_golden_cases` was reported as a table
  // NOTHING READS while two founder routes read it. Under this linter's own
  // stated bias — a MISS beats an ACCUSATION, because the action a false
  // "no reader" invites is DROP TABLE — that is the expensive direction to be
  // wrong in, and it would have recurred on every future hatch conversion.
  //
  // So: accept the two bare handles this repo uses (`db`, and `tx` inside a
  // transaction) plus ANY call expression, which is what the hatch and any
  // future wrapper look like. Deliberately NOT a bare `\.query\.` — that
  // matches `req.query.<param>` in every route file, which would silently mark
  // a table as read because a query STRING parameter shares its name.
  /(?:\bdb|\btx|\))\s*\.query\.([A-Za-z_$][\w$]*)/g,
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
  // Every identifier this table answers to: its own var, its SQL name, and any
  // `export const alias = thisTable;` re-export. See TABLE_ALIAS_RE above.
  const names = [t.varName, t.tableName, ...(tableAliases.get(t.varName) ?? [])];
  const written = names.some((n) => writeNames.has(n));
  const read_ = names.some((n) => readNames.has(n));
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
// FAMILY 3 — routers never mounted
// ----------------------------------------------------------------------------
// WIDENED 2026-08-16. This family used to filter candidates with
// `/^server\/routes-[\w.-]+\.ts$/` — a FILENAME shape. Everything about the
// finding is about MOUNTING, and nothing about it is about the filename, so a
// router that declined to be called `routes-*.ts` was invisible: put it at
// `server/publicapi/routes.ts`, `server/anything/index.ts`, or a subdirectory
// of your choosing and the gate had nothing to say. That is the exact defect
// this family exists for ("built but unwired"), and it is also the shape the
// expansion-ladder bypass took — a new public-API surface in a subdirectory.
//
// The predicate is now the PROPERTY, not the name: any non-test file under
// server/ that exports a route registrar or an Express Router. Three shapes,
// because all three are how this repo actually mounts things:
//
//   • `export function registerFooRoutes(app)` — the legacy name shape, kept so
//     an unannotated registrar is still seen.
//   • `export function registerAnything(app: Express)` — the SAME thing under a
//     name the old regex refused. `server/api-v1/index.ts` exports
//     `registerPublicApiV1(app: Express)`, mounts three sub-routers at
//     `/api/v1/*`, and has zero callers; `Routes?` is why nothing saw it.
//   • `export const fooRouter = Router()` / a default-exported Router.
//
// MOUNTEDNESS IS A FIXED POINT, not a one-hop reference check. The old rule
// asked "does any other server file mention this?", which an unmounted parent
// satisfies: `api-v1/index.ts` imports leads/properties/webhooks, so all three
// looked mounted while `/api/v1/*` served 404. A referrer that is itself an
// unmounted candidate therefore confers nothing, and the loop runs to a fixed
// point. Non-candidate server files still confer mountedness on sight — this
// linter's standing bias is that a miss beats an accusation.
//
// REFERENCES ARE RESOLVED, NOT SUBSTRING-MATCHED. The old check used
// `t.includes("./" + basename)`, which is wrong in both directions once
// subdirectories are in scope: `./routes` matches the import of a completely
// different `server/routes.ts`, while a real `./routes/lob-webhooks` import
// does NOT contain `./lob-webhooks`. Specifiers are now resolved against the
// importing file's directory, exactly as family 1 does.
// ============================================================================

const ROUTE_SCAN_ROOT = "server/";

/** `export function registerFooRoutes(` — the historical shape. */
const REGISTER_EXPORT_RE = /export\s+(?:async\s+)?function\s+(register[\w$]*Routes?)\s*\(/g;
/** `export function registerAnything(app: Express)` — a registrar by SIGNATURE. */
const REGISTER_APP_EXPORT_RE =
  /export\s+(?:async\s+)?function\s+(register[A-Z][\w$]*)\s*\(\s*[A-Za-z_$][\w$]*\s*:\s*(?:express\.)?(?:Express|Application|Router)\b/g;
/** `export const fooRouter = Router()` / `export const r: Router = express.Router()`. */
const EXPORT_ROUTER_RE =
  /export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*(?:express\.)?Router\s*(?:<[^>]*>)?\s*\(/g;
const DEFAULT_EXPORT_RE = /export\s+default\s+([A-Za-z_$][\w$]*)/;
const ROUTER_CTOR_RE = /\b(?:express\.)?Router\s*(?:<[^>]*>)?\s*\(/;

/** relPath → {file, base, registrars[], routers[]} */
const routeCandidates = new Map();
for (const p of productionFiles) {
  if (!p.startsWith(ROUTE_SCAN_ROOT) || !p.endsWith(".ts")) continue;
  const text = read(p);
  const registrars = new Set();
  let m;
  for (const re of [REGISTER_EXPORT_RE, REGISTER_APP_EXPORT_RE]) {
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) registrars.add(m[1]);
  }
  const routers = new Set();
  EXPORT_ROUTER_RE.lastIndex = 0;
  while ((m = EXPORT_ROUTER_RE.exec(text)) !== null) routers.add(m[1]);
  // A default export only counts when the file actually builds a Router —
  // otherwise every `export default someService` under server/ becomes a
  // "route", which is noise the narrow filename filter used to hide for free.
  const dm = DEFAULT_EXPORT_RE.exec(text);
  if (dm && ROUTER_CTOR_RE.test(text)) routers.add(dm[1]);

  if (registrars.size === 0 && routers.size === 0) continue;
  routeCandidates.set(p, {
    file: p,
    base: p.split("/").pop(),
    registrars: [...registrars],
    routers: [...routers],
  });
}

/**
 * Which production server files IMPORT a given module — importer identity is
 * what the fixed point needs, so this is its own pass (family 1's
 * `importedModules` is a flat set that has forgotten who imported what).
 * Covers static, side-effect and dynamic (`await import(…)`) specifiers.
 */
const ROUTE_SPEC_RE =
  /(?:\bfrom\s*|\bimport\s*|\brequire\s*)\(?\s*["'`]([^"'`\n]+)["'`]/g;
/** module stem (no extension) → Set<importer relPath> */
const serverImportersOf = new Map();
for (const q of productionFiles) {
  if (!q.startsWith(ROUTE_SCAN_ROOT)) continue;
  const t = read(q);
  ROUTE_SPEC_RE.lastIndex = 0;
  let m;
  while ((m = ROUTE_SPEC_RE.exec(t)) !== null) {
    const spec = m[1];
    if (!spec.startsWith(".")) continue; // package/alias — never a server module
    const stem = resolve("/", dirname(q), spec)
      .slice(1)
      .split("\\")
      .join("/")
      .replace(/\.(ts|tsx|mts|cts|js|mjs)$/, "");
    for (const form of [stem, `${stem}/index`]) {
      if (!serverImportersOf.has(form)) serverImportersOf.set(form, new Set());
      serverImportersOf.get(form).add(q);
    }
  }
}

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

/** candidate relPath → Set<referrer relPath | "__MANIFEST__"> */
const routeReferrers = new Map();
for (const [p, c] of routeCandidates) {
  const refs = new Set();
  // ROUTE_MANIFEST keys on BASENAME, so honour it only for top-level
  // server/<file>.ts — otherwise `server/auth/routes.ts` could be excused by an
  // entry describing a different file that merely shares a basename.
  if (/^server\/[^/]+$/.test(p) && manifestBody.includes(`"${c.base}"`)) {
    refs.add("__MANIFEST__");
  }
  for (const q of serverImportersOf.get(p.replace(/\.ts$/, "")) ?? []) {
    // routeManifest.ts is handled above via ROUTE_MANIFEST only — its
    // KNOWN_NON_MOUNTED prose NAMES the orphan symbols, which would otherwise
    // read as a reference and hide exactly the files it is documenting.
    if (q === p || q === manifestPath) continue;
    refs.add(q);
  }
  // Registrar FUNCTION names are distinctive enough to match as bare text (a
  // file may call `registerFooRoutes(app)` re-exported through a barrel this
  // resolver does not follow). Router VARIABLE names are NOT: 97 candidates
  // export one named literally `router`, and matching that marks every server
  // file a referrer. So registrars only — see the blind-spot note in the header.
  if (c.registrars.length > 0) {
    for (const q of productionFiles) {
      if (q === p || q === manifestPath || !q.startsWith(ROUTE_SCAN_ROOT)) continue;
      const t = read(q);
      if (c.registrars.some((s) => t.includes(s))) refs.add(q);
    }
  }
  routeReferrers.set(p, refs);
}

// Fixed point: start with every candidate presumed unmounted, then repeatedly
// discharge any candidate referenced by the manifest or by a file that is not
// itself still-unmounted. Converges in a handful of passes (the graph is
// shallow); the bound only exists so a cycle cannot spin.
const unmountedRouters = new Set(routeCandidates.keys());
for (let pass = 0; pass < routeCandidates.size + 1; pass++) {
  let changed = false;
  for (const p of [...unmountedRouters]) {
    for (const r of routeReferrers.get(p)) {
      if (r === "__MANIFEST__" || !unmountedRouters.has(r)) {
        unmountedRouters.delete(p);
        changed = true;
        break;
      }
    }
  }
  if (!changed) break;
}

const unregisteredRoutes = [];
for (const p of [...unmountedRouters].sort()) {
  const c = routeCandidates.get(p);
  // id is the full path, not the basename: once subdirectories are in scope,
  // `routes.ts` and `index.ts` are not unique names.
  consideredKeys.add(`route:${p}`);
  if (allowlisted("route", p)) continue;
  unregisteredRoutes.push({
    file: p,
    id: p,
    symbols: [
      ...c.registrars,
      ...c.routers.map((r) => `Router ${r}`),
    ],
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
      `${f.file}:${f.line}  ${f.kind} ${f.symbol} — declared and never referenced` +
      (f.moduleOrphan ? " [MODULE ORPHAN — nothing imports this file at all]" : ""),
    remedy:
      "DELETE it (cheapest, and the north star is a smaller codebase), or WIRE it\n" +
      "  to a route/job/service that actually calls it, or ALLOWLIST it in\n" +
      "  scripts/ratchets/reachability.json with a real reason.\n" +
      "  A GREEN UNIT TEST IS NOT A CALL SITE. Nine of the twenty symbols this\n" +
      "  family first revealed had real behavioural tests exercising them and no\n" +
      "  production caller at all — which is the strongest possible evidence the\n" +
      "  code WORKS and no evidence whatever that anything RUNS it.",
  },
  {
    // FAMILY 7 — exported wider than it is used.
    //
    // Split out of `unreached-exports` on 2026-08-20, in the commit that stopped
    // the identifier pass reading comments. That change revealed 86 symbols;
    // reading all 86 rather than counting them showed 66 were this — an ordinary
    // helper that carries an `export` keyword it does not need — and only 20 were
    // the thing the gate exists to shout about. Same count, two rules, and the
    // loud one only stays loud if the quiet one is somewhere else.
    //
    // Runtime risk: none. Cost: a wider public surface than the module means,
    // which is how a helper acquires callers its author never designed for, and
    // dead weight in every import-graph and tree-shaking decision downstream.
    key: "internalOnlyExports",
    label: "internal-only-exports",
    findings: internalOnlyExports,
    describe: (f) =>
      `${f.file}:${f.line}  ${f.kind} ${f.symbol} — used only inside its own module` +
      ` (${ownRefs.get(f.id) ?? 0} references there)` +
      (f.moduleOrphan ? " [MODULE ORPHAN — nothing imports this file at all]" : "") +
      (f.opaqueModule ? " [module is dynamically imported — check for computed access]" : ""),
    remedy:
      "DROP THE `export` KEYWORD — the module keeps the helper, the codebase\n" +
      "  loses a public promise nobody asked for. If the export is deliberate\n" +
      "  (a seam a test or a future caller needs), ALLOWLIST it with that reason.\n" +
      "  Note a MODULE ORPHAN here is a different animal: an unimported file whose\n" +
      "  internals talk to each other is still a file nothing runs.",
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
    describe: (f) =>
      `${f.file}  exports ${f.symbols.join(", ")} — never mounted` +
      (routeReferrers.get(f.file)?.size
        ? ` (its only referrer(s) — ${[...routeReferrers.get(f.file)].join(", ")} — are` +
          ` themselves unmounted)`
        : ""),
    remedy:
      "An unmounted router is a feature that 404s in production. MOUNT it in\n" +
      "  server/routes.ts (and add it to ROUTE_MANIFEST), or DELETE the file, or\n" +
      "  ALLOWLIST it with a reason. Note the id is now the full path, not the\n" +
      "  basename — this family scans ALL of server/, not just routes-*.ts.",
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
    // BOTH export families feed this. A file nothing imports is an orphan
    // whether or not its exports happen to call each other — and after the
    // 2026-08-20 split, a module whose every export is internally used would
    // otherwise have vanished from this family entirely while remaining exactly
    // as unimported as before.
    findings: [
      ...new Set(
        [...unreachedExports, ...internalOnlyExports]
          .filter((f) => f.moduleOrphan)
          .map((f) => f.file),
      ),
    ]
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
    `${tables.size} pgTable definitions · ${routeCandidates.size} route candidates ` +
    `(registrar or Router) under ${ROUTE_SCAN_ROOT}`,
);

// The comment stripper feeds both import scans, so a broken one would silently
// widen or empty them. Printed, not merely asserted, so a run's own output says
// whether the input to those scans was trustworthy.
if (vanishedDuringScan > 5) {
  console.error(
    `${TAG} ${vanishedDuringScan} files disappeared between the walk and the ` +
      `read. One or two is a concurrent gate self-test writing its probe; this ` +
      `many means the tree moved underneath the scan, and a verdict over a ` +
      `moving tree is not a verdict.`,
  );
  process.exit(1);
}
{
  const [passed, total] = verifyStripper();
  console.log(
    `${TAG} comment-stripper self-test: ${passed}/${total} correct` +
      (vanishedDuringScan ? ` · ${vanishedDuringScan} file(s) vanished mid-scan` : ""),
  );
  if (passed !== total) {
    console.error(
      `${TAG} the comment stripper is WRONG, so every import scan above read ` +
        `corrupted source. Refusing to report a verdict.`,
    );
    process.exit(1);
  }
}

// ----------------------------------------------------------------------------
// VACUITY GUARD — see the header. A scan that stops seeing files reports zero
// findings, which is indistinguishable from a clean bill of health unless the
// POPULATIONS are floored too. Checked before the families so a broken walk
// fails loudly instead of printing six reassuring PASS lines.
// ----------------------------------------------------------------------------
const minima = ratchet.minima ?? {};
const POPULATIONS = [
  ["productionFiles", productionFiles.length],
  ["exportFiles", exportFiles.length],
  ["pgTables", tables.size],
  ["routeCandidateFiles", routeCandidates.size],
];
let vacuous = false;
for (const [name, actual] of POPULATIONS) {
  const floor = minima[name];
  if (floor === undefined) {
    vacuous = true;
    console.error(
      `${TAG} VACUITY GUARD: no "minima.${name}" in ${relative(ROOT, RATCHET_FILE)}. ` +
        `Add "${name}": <a floor comfortably below ${actual}> — an unfloored ` +
        `population lets a broken scan pass as clean.`,
    );
    continue;
  }
  if (actual < floor) {
    vacuous = true;
    console.error(
      `${TAG} VACUITY GUARD: ${name} = ${actual}, below the floor of ${floor}. ` +
        `This scan is NOT a clean bill of health — it stopped seeing files.\n` +
        `  Suspect the walk, the extension filter, or a regex before you suspect ` +
        `progress. If a deletion wave genuinely shrank this population, lower ` +
        `"minima.${name}" in the same commit and say which wave.`,
    );
  }
}
if (vacuous && !MEASURE_ONLY) {
  console.error(`${TAG} FAIL — vacuity guard tripped; counts below are not trustworthy.`);
  process.exit(1);
}

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

/**
 * PER-ROOT COUNTS.
 *
 * The four export families are split into a `server` half and a `shared` half,
 * each with its own down-only baseline. Merging them would let 54 newly-visible
 * shared findings sit in the same number as 390 server ones, so a server
 * regression could hide inside a shared improvement and vice versa — the same
 * reason `unreachedExports` and `internalOnlyExports` were split apart on
 * 2026-08-20 rather than left as one number.
 *
 * The families that are not per-file (tables, routes) are passed through
 * untouched.
 */
const EXPORT_FAMILY_KEYS = new Set([
  "unreachedExports",
  "internalOnlyExports",
  "moduleOrphans",
  "opaqueExports",
]);
const isSharedRooted = (f) => typeof f.file === "string" && f.file.startsWith("shared/");
const ROOTED_FAMILIES = FAMILIES.flatMap((fam) => {
  if (!EXPORT_FAMILY_KEYS.has(fam.key)) return [fam];
  const all = fam.findings;
  return [
    { ...fam, findings: all.filter((f) => !isSharedRooted(f)) },
    {
      ...fam,
      key: `${fam.key}Shared`,
      label: `${fam.label} (shared)`,
      findings: all.filter(isSharedRooted),
    },
  ];
});

for (const fam of ROOTED_FAMILIES) {
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
  `${TAG} PASS — all ${ROOTED_FAMILIES.length} reachability counts at baseline`,
);
process.exit(0);
