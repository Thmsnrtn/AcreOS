#!/usr/bin/env node
// ============================================================================
// scripts/lint-disclaimer-coverage.mjs — the DISCLAIMER-COVERAGE ratchet.
// ----------------------------------------------------------------------------
// WHY THIS EXISTS
//
// Part 3 §2.9 of the handoff: ADVICE-SHAPED output — a valuation, an estimate,
// a suggested offer, a negotiation move, anything adjacent to legal or tax
// consequence — must carry `RequiredDisclaimer`. AcreOS is not a broker,
// lender, appraiser, adviser or fiduciary, and a figure that looks like advice
// without saying it isn't is the same defect class this repo keeps shipping:
// a SURFACE ASSERTING WHAT THE CODE HAS NOT ESTABLISHED.
//
// `RequiredDisclaimer` already existed and was already used on ~17 surfaces.
// Nothing checked whether it was used on the RIGHT ones, or noticed when a new
// advice surface shipped without it. Every such page passed `tsc`, eslint and
// its own tests.
//
// ----------------------------------------------------------------------------
// HOW THE ADVICE-SHAPED SET IS DERIVED  (not a hand-list)
//
// A hand-list of "pages that need a disclaimer" drifts the moment somebody
// adds page number eighteen, and the drift is silent. So the set is DERIVED
// from the source, by two conditions that must BOTH hold:
//
//   1. ADVICE MARKER — the file contains a phrase or identifier from one of
//      five families (valuation, offer, negotiation, projection, tax/legal).
//      Import lines, comment lines and route-path string literals are stripped
//      first, because `import AvmPage from "@/pages/avm"` and a nav entry for
//      "/dodd-frank-checker" are not advice.
//   2. FIGURE EVIDENCE — the file also formats a number for display
//      (`usd(`, `formatCurrency(`, `toFixed(`, `Intl.NumberFormat`, …). A
//      glossary entry that DEFINES "after-repair value" is not giving advice;
//      a card that PRINTS one is.
//
// Both conditions are recomputed from the tree on every run, so a new advice
// surface is picked up the day it lands — there is no registry to forget.
//
// COVERAGE is likewise derived: a file is covered when it references
// `RequiredDisclaimer`, or when a client-local module it imports (transitively,
// to depth 2) does — so a page that delegates its figures to a panel component
// which carries the disclaimer is correctly counted as covered.
//
// ----------------------------------------------------------------------------
// WHAT THIS LINT CANNOT SEE  (read before believing a verdict)
//
// It is TOKEN-BASED. It does not typecheck, does not render, and does not
// evaluate conditions. Concretely:
//
//   • PRESENCE, NOT REACHABILITY. A file that imports RequiredDisclaimer and
//     renders it behind a condition that is never true counts as COVERED. This
//     gate proves a disclaimer exists in the module graph, not that a user saw
//     it. That is a false NEGATIVE and it is the deliberate bias: this gate
//     must never be the reason someone deletes a real advice surface.
//   • RUNTIME-COMPOSED COPY IS INVISIBLE. Advice text assembled from server
//     payloads, i18n keys, or template strings built at runtime trips no
//     marker. The marker families cover the phrasings that exist in the tree
//     TODAY; they are not a theory of all possible advice.
//   • DEPTH-2 IMPORT CLOSURE. A disclaimer rendered by a shared LAYOUT three
//     levels up, or injected by a router wrapper, is not seen — such a file is
//     reported as missing (a false POSITIVE), and the allowlist is where that
//     gets recorded, with a reason.
//   • STRING LITERALS STILL COUNT (except route paths). A marker inside a
//     `data-testid` or a switch case counts as a hit. Again: over-reports.
//   • SERVER-SIDE LEGENDS ARE A DIFFERENT LANE. `server/services/
//     legalDisclaimers.ts` stamps generated PDFs/documents; this gate only
//     looks at `client/src/**/*.tsx`. A surface covered only server-side will
//     still be reported here, correctly — the on-screen figure needs its own.
//
// ----------------------------------------------------------------------------
// WHY A RATCHET, NOT A HARD GATE
//
// At the time of writing, the derived scan finds real advice surfaces that
// predate the rule. Failing all of them on day one would get the gate
// `--no-verify`'d within a week. So the count of UNCOVERED advice surfaces is
// baselined in scripts/ratchets/disclaimer-coverage.json and may only go DOWN
// — and, exactly like `as-any` and reachability, a count BELOW the baseline
// also fails, so the commit that fixes a surface has to lock the win in.
//
// Allowlist entries live in the same config, each with a mandatory `reason`
// that is PRINTED on every run. The linter refuses to start if one is missing.
//
// ----------------------------------------------------------------------------
// USAGE
//   node scripts/lint-disclaimer-coverage.mjs            # gate (npm run check)
//   node scripts/lint-disclaimer-coverage.mjs --measure  # print counts, never fail
//   node scripts/lint-disclaimer-coverage.mjs --report   # every finding, not a sample
//   node scripts/lint-disclaimer-coverage.mjs --root DIR # scan an alternate tree
//   node scripts/lint-disclaimer-coverage.mjs --baseline N
//                                     # override the config baseline. ONLY for
//                                     # the self-test (tests/unit/
//                                     # provenanceGrammar.test.ts), which needs
//                                     # to prove the gate fires in BOTH
//                                     # directions against a fixture tree. It
//                                     # is not a way to pass CI: `npm run
//                                     # check` invokes the script with no
//                                     # arguments, so the committed baseline is
//                                     # the only one that gates a real build.
// ============================================================================

import { readFileSync, readdirSync, lstatSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const argv = process.argv.slice(2);
function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}
const MEASURE_ONLY = argv.includes("--measure");
const REPORT_ALL = argv.includes("--report");
const REPO_ROOT = resolve(__dirname, "..");
const CONFIG_PATH = join(REPO_ROOT, "scripts", "ratchets", "disclaimer-coverage.json");

/** The component every advice-shaped surface must render. */
export const DISCLAIMER_SYMBOL = "RequiredDisclaimer";

/**
 * Coverage means the component is RENDERED, not merely mentioned. `<Required
 * Disclaimer` (element or self-closing) is the only form that puts it on
 * screen; an import, a comment or a data-testid string is not coverage.
 */
const JSX_DISCLAIMER_RE = /<RequiredDisclaimer\b/;

/**
 * Advice-shaped marker families. Each is a phrasing or identifier that only
 * appears when a surface is telling the user what something is worth, what to
 * offer, how to negotiate, what it will return, or how a tax/legal rule lands.
 */
const ADVICE_MARKERS = {
  valuation:
    /\b(estimatedValue|avmValue|avmEstimate|estimatedMarketValue|afterRepairValue|arvEstimate|valuationEstimate|marketValueEstimate)\b|Estimated (?:market )?value|After[- ]repair value|Fair market value|\bARV\b|\bAVM\b|\bAfter[- ]Repair\b|\bEst\.? value\b/i,
  offer:
    /\b(suggestedOffer|recommendedOffer|maxOffer|maxAllowableOffer|offerRecommendation|targetOfferPrice)\b|Suggested offer|Recommended offer|Max(?:imum)? allowable offer|Offer recommendation/i,
  negotiation:
    /\b(negotiationAdvice|counterOfferSuggestion|recommendedCounter)\b|Recommended counter|Suggested counter|Negotiation strategy/i,
  projection:
    /\b(projectedRoi|estimatedRoi|projectedProfit|estimatedProfit|estimatedYield|projectedReturn)\b|Projected (?:ROI|profit|return)|Estimated (?:ROI|profit|yield|return)/i,
  taxLegal:
    /\bTax savings\b|\btax-deferred\b|\b1031 exchange\b|\bDodd[- ]Frank\b|\busury\b|\bdeductible\b/i,
};

/** Evidence the file PRINTS a number, not merely mentions the concept. */
const FIGURE_EVIDENCE =
  /\busd\(|formatCurrency\(|formatPercent\(|toFixed\(|Intl\.NumberFormat|toLocaleString\(/;

/**
 * Remove the parts of a source file that are not rendered copy: import lines,
 * comment lines, and route-path string literals ("/dodd-frank-checker").
 */
function stripNonRendered(src) {
  return src
    .split("\n")
    .filter((l) => !/^\s*import\s/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n")
    .replace(/(["'`])\/[A-Za-z0-9/_:.-]*\1/g, '""');
}

/** Families tripped by a source file, [] when it is not advice-shaped. */
export function detectAdviceFamilies(src) {
  const stripped = stripNonRendered(src);
  if (!FIGURE_EVIDENCE.test(stripped)) return [];
  return Object.entries(ADVICE_MARKERS)
    .filter(([, re]) => re.test(stripped))
    .map(([family]) => family);
}

// ─── Tree walking + import resolution ───────────────────────────────────────

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const IMPORT_RE = /from\s+["']([^"']+)["']/g;

/** Resolve a client-local import specifier to a file path, or null. */
function resolveLocalImport(spec, fromFile, clientSrcDir) {
  let base;
  if (spec.startsWith("@/")) base = join(clientSrcDir, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(dirname(fromFile), spec);
  else return null; // package, @shared, @sovereign — not client-local UI
  for (const cand of [
    `${base}.tsx`,
    `${base}.ts`,
    join(base, "index.tsx"),
    join(base, "index.ts"),
  ]) {
    if (existsSync(cand) && lstatSync(cand).isFile()) return cand;
  }
  return null;
}

/**
 * Does `file` render the disclaimer, directly or through a client-local import
 * at most `maxDepth` hops away? Returns the covering file path, or null.
 */
function findDisclaimer(file, clientSrcDir, readCache, maxDepth = 2, seen = new Set()) {
  if (seen.has(file) || maxDepth < 0) return null;
  seen.add(file);
  let src = readCache.get(file);
  if (src === undefined) {
    src = existsSync(file) ? readFileSync(file, "utf8") : "";
    readCache.set(file, src);
  }
  // Match the RENDERED source only. Testing raw text counted a comment, a
  // dead import or a test-id string containing the symbol as coverage — a
  // false-negative mechanism the LIMITS banner did not name (fleet-11
  // verifier catch). The JSX form is what actually puts it on screen.
  if (JSX_DISCLAIMER_RE.test(stripNonRendered(src))) return file;
  if (maxDepth === 0) return null;
  for (const m of src.matchAll(IMPORT_RE)) {
    const target = resolveLocalImport(m[1], file, clientSrcDir);
    if (!target) continue;
    const hit = findDisclaimer(target, clientSrcDir, readCache, maxDepth - 1, seen);
    if (hit) return hit;
  }
  return null;
}

// ─── The pure core ──────────────────────────────────────────────────────────

/**
 * Scan a tree for advice-shaped surfaces and their disclaimer coverage.
 * `allowlist` is a list of repo-relative paths (reasons live in the config).
 */
export function scanDisclaimerCoverage({ root, allowlist = [] } = {}) {
  const treeRoot = resolve(root ?? REPO_ROOT);
  const clientSrcDir = join(treeRoot, "client", "src");
  const allowed = new Set(allowlist);
  const readCache = new Map();

  const files = walk(clientSrcDir)
    .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
    .sort();

  const candidates = [];
  for (const file of files) {
    let src = readCache.get(file);
    if (src === undefined) {
      src = readFileSync(file, "utf8");
      readCache.set(file, src);
    }
    const families = detectAdviceFamilies(src);
    if (families.length === 0) continue;
    const coveringFile = findDisclaimer(file, clientSrcDir, readCache);
    const rel = relative(treeRoot, file).split("\\").join("/");
    candidates.push({
      file: rel,
      families,
      covered: coveringFile !== null,
      coveredVia: coveringFile
        ? relative(treeRoot, coveringFile).split("\\").join("/")
        : null,
      allowlisted: allowed.has(rel),
    });
  }

  return {
    scannedFiles: files.length,
    candidates,
    covered: candidates.filter((c) => c.covered),
    allowlisted: candidates.filter((c) => !c.covered && c.allowlisted),
    missing: candidates.filter((c) => !c.covered && !c.allowlisted),
  };
}

/** Load + validate the ratchet config. Every allowlist entry needs a reason. */
export function loadConfig(path = CONFIG_PATH) {
  if (!existsSync(path)) {
    throw new Error(`missing config ${relative(REPO_ROOT, path)}`);
  }
  const cfg = JSON.parse(readFileSync(path, "utf8"));
  if (typeof cfg?.baselines?.adviceSurfacesMissingDisclaimer !== "number") {
    throw new Error("config missing baselines.adviceSurfacesMissingDisclaimer");
  }
  for (const entry of cfg.allowlist ?? []) {
    if (!entry.file || !entry.reason || entry.reason.trim().length < 40) {
      throw new Error(
        `allowlist entry ${entry.file ?? "(unnamed)"} needs a substantive "reason" ` +
          `(>=40 chars) — an allowlist you can append to without justifying ` +
          `yourself is how a gate rots`,
      );
    }
  }
  return cfg;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function main() {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    console.error(`[disclaimer-coverage] ${err.message}`);
    process.exit(1);
  }

  const allowlist = (cfg.allowlist ?? []).map((a) => a.file);
  const rootArg = argValue("--root");
  const result = scanDisclaimerCoverage({ root: rootArg ?? REPO_ROOT, allowlist });
  const baselineOverride = argValue("--baseline");
  const baseline =
    baselineOverride === null
      ? cfg.baselines.adviceSurfacesMissingDisclaimer
      : Number(baselineOverride);
  if (!Number.isFinite(baseline)) {
    console.error(`[disclaimer-coverage] --baseline must be a number`);
    process.exit(1);
  }
  const count = result.missing.length;

  console.log(
    `[disclaimer-coverage] scanned ${result.scannedFiles} client .tsx files; ` +
      `${result.candidates.length} advice-shaped; ${result.covered.length} render ` +
      `${DISCLAIMER_SYMBOL}; ${result.allowlisted.length} allowlisted; ` +
      `${count} uncovered`,
  );
  console.log(
    "[disclaimer-coverage] LIMITS: token-based. Presence, not reachability — a " +
      "disclaimer behind a false condition counts as covered. Runtime-composed " +
      "advice copy (i18n keys, server payloads) trips no marker. Import closure " +
      "stops at depth 2. Server-side legends (legalDisclaimers.ts) are a " +
      "different lane and are not counted here.",
  );

  for (const a of cfg.allowlist ?? []) {
    console.log(`[disclaimer-coverage] allowlisted ${a.file}\n    reason: ${a.reason}`);
  }

  const shown = REPORT_ALL ? result.missing : result.missing.slice(0, 12);
  for (const m of shown) {
    console.log(`  UNCOVERED ${m.file}  [${m.families.join(", ")}]`);
  }
  if (!REPORT_ALL && result.missing.length > shown.length) {
    console.log(`  … and ${result.missing.length - shown.length} more (--report for all)`);
  }

  if (MEASURE_ONLY) {
    console.log(`[disclaimer-coverage:measure] current=${count} baseline=${baseline}`);
    process.exit(0);
  }

  if (count === baseline) {
    console.log(`[disclaimer-coverage] PASS — ${count} (baseline ${baseline})`);
    process.exit(0);
  }
  if (count > baseline) {
    console.error(
      `[disclaimer-coverage] FAIL — ${count} > baseline ${baseline} ` +
        `(+${count - baseline} advice-shaped surface(s) with no ${DISCLAIMER_SYMBOL}).`,
    );
    console.error(
      `  Render <${DISCLAIMER_SYMBOL} type="valuation|financial|legal|ai|score|` +
        `document|worksheet" /> on the new surface. If the marker is a false ` +
        `positive, add it to scripts/ratchets/disclaimer-coverage.json's ` +
        `allowlist WITH a reason — not by raising the baseline.`,
    );
    process.exit(1);
  }
  console.error(
    `[disclaimer-coverage] FAIL — stale-high baseline. Current count is ${count}, ` +
      `baseline says ${baseline}.`,
  );
  console.error(
    `  Good news: ${baseline - count} surface(s) gained a disclaimer. Lock it in — ` +
      `set "adviceSurfacesMissingDisclaimer": ${count} in ` +
      `scripts/ratchets/disclaimer-coverage.json.`,
  );
  process.exit(1);
}

// Only run the CLI when invoked directly (the test imports the pure core).
if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  main();
}
