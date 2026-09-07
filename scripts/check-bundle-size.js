#!/usr/bin/env node
/**
 * Bundle-size budget gate. Runs after `npm run build` and measures the client
 * chunks Vite emits under dist/public/assets/.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE IS SHAPED LIKE THIS — the defect it was rewritten to remove
 * ---------------------------------------------------------------------------
 * The previous version had TWO paths on which a broken measurement was
 * indistinguishable from a clean bundle, and both were demonstrated live
 * (2026-08-16, isolated fixture trees, old script unmodified):
 *
 *   (a) The whole readdir sat inside `try { … } catch { console.log("SKIP …");
 *       process.exit(0) }`. A build that emitted its client output ANYWHERE
 *       ELSE — assetsDir renamed, outDir moved — hit ENOENT on the hardcoded
 *       path and exited 0. Measured: a fixture with a real 120 KB chunk in
 *       dist/public/static/ printed "SKIP: dist/public/assets/ not found" and
 *       exited 0. The bundle was never looked at and nothing said so.
 *
 *   (b) If the directory existed but yielded zero `.js` files — empty dir,
 *       or chunks nested in hashed subdirectories — the loop contributed
 *       nothing, totalJS stayed 0, violations stayed empty, and the script
 *       printed "PASS: Bundle size OK (total JS: 0 KB)" and exited 0.
 *       Measured on two fixtures: an empty assets/ and an assets/ch/9f/
 *       holding a real 244 KB chunk. Both printed PASS.
 *
 * A bundle-size gate that measured no bundle has not checked the bundle. So:
 *
 *   · ZERO `.js` FILES MEASURED IS A HARD FAILURE (floor MIN_JS_FILES), never
 *     a pass, in every environment. This is the definitional floor — see the
 *     note on MIN_JS_FILES for why it is 1 and not a bigger measured number.
 *   · The walk RECURSES, so a nested output layout is measured rather than
 *     silently missed.
 *   · The missing-directory case is a DELIBERATE, DOCUMENTED DECISION with
 *     three distinct outcomes (see decideNoAssetsDir), not a bare catch.
 *   · SKIP is visually distinct from PASS and says outright that nothing was
 *     measured, because the only caller that exists today
 *     (scripts/verify-launch-ready.sh:61, `run_check_optional`) tallies an
 *     exit-0 SKIP into its PASS column.
 *   · Any error that is NOT "the directory is absent" (EACCES, ENOTDIR, a
 *     mid-walk failure) is a hard failure. A broken scan is never a skip.
 *
 * ---------------------------------------------------------------------------
 * THE SKIP DECISION, stated explicitly rather than implied by a catch
 * ---------------------------------------------------------------------------
 * Skipping is genuinely right in exactly one situation: THERE IS NO BUILD AT
 * ALL (no dist/ and no dist/public/) AND we are not in CI. That is the ordinary
 * developer-machine case — this script is reachable from a local readiness
 * script that does not always build first, and failing there would only teach
 * people to ignore it.
 *
 * Everywhere else the absence of dist/public/assets/ is a FAILURE:
 *   · in CI (`CI` set) — CI builds before it measures, so a missing bundle
 *     means the build did not run or did not land where we look;
 *   · with --require-build / BUNDLE_SIZE_REQUIRE_BUILD=1 — the explicit
 *     "I built, measure it" contract;
 *   · whenever dist/public/ EXISTS but assets/ does not — the client build
 *     demonstrably ran and put its output somewhere this gate is not looking.
 *     This is failure mode (a) above, and it fails even outside CI, because
 *     the evidence of a build is right there on disk.
 *
 * Usage:
 *   node scripts/check-bundle-size.js                  # skip-if-no-build (local)
 *   node scripts/check-bundle-size.js --require-build  # a missing build FAILS
 *   CI=true node scripts/check-bundle-size.js          # same, implied by CI
 *
 * Exit codes: 0 = PASS or documented SKIP · 1 = FAIL (including vacuous scan).
 */

import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { resolve, join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

// ── Budgets: a GOAL that is reported, and a RATCHET that is enforced ───────
//
// This gate had never run. It was hardened in August against two ways of
// measuring nothing and calling it a pass — and then its only caller was
// scripts/verify-launch-ready.sh, which is itself invoked by no workflow and no
// npm script. A gate reachable only from an unreachable caller is the same
// green-over-a-live-defect shape it was written to remove, one level up.
//
// Wiring it revealed why it was easy to leave unwired: the goals below are
// aspirational and the bundle is nowhere near them. Measured 2026-09-07 on a
// real production build — 468 chunks, 10,762 KB of JS, a 2,598 KB vendor-map
// and a 700 KB entry. Enforcing the goal would mean a permanently red gate,
// which is how gates get deleted rather than met.
//
// So the goals stay as goals and are REPORTED with the distance still to go,
// and what is ENFORCED is a ratchet on the measured numbers: they may shrink,
// never grow. That stops the next regression today, and it does not pretend a
// budget is met when it is not.
//
// ON "TOTAL JS", read it honestly: it sums EVERY chunk, and 468 of them are
// route-split and lazily loaded. It is not what a visitor downloads. It bounds
// how much code exists, which is worth ratcheting, but the number that governs
// first paint is the ENTRY chunk — 1,433 KB before the ORM was lifted out of
// the client, 700 KB now — and the number that governs the Map door is
// vendor-map. All three are ratcheted separately so a win in one cannot mask a
// regression in another.
const GOAL_SINGLE_CHUNK_KB = 600; // No single chunk > 600 KB
const GOAL_TOTAL_JS_KB = 3000; // Total JS < 3 MB

// Enforced ceilings — measured 2026-09-07, lower them in the commit that earns it.
const RATCHET_SINGLE_CHUNK_KB = 2598; // vendor-map (maplibre + mapbox-gl, runtime-switchable)
const RATCHET_TOTAL_JS_KB = 10762;
const RATCHET_ENTRY_CHUNK_KB = 700; // index-*.js — the one that governs first paint

/**
 * Stale-high tolerance. Chunk bytes move a little between builds (hash length,
 * minifier version, a one-line change). A strict "must equal" would be flaky
 * and would train people to bump the number; no tolerance at all lets a real
 * win go unlocked. 2% is wider than observed jitter and narrower than any
 * change worth making.
 */
const RATCHET_TOLERANCE = 0.02;

const MAX_SINGLE_CHUNK_KB = RATCHET_SINGLE_CHUNK_KB;
const MAX_TOTAL_JS_KB = RATCHET_TOTAL_JS_KB;

/**
 * VACUITY FLOOR, not a budget. Every number below counts BAD THINGS FOUND, so
 * a scan that stops seeing files finds zero violations and reports a
 * reassuring PASS — which is precisely what this script did before
 * 2026-08-16 (see the header).
 *
 * It is deliberately 1, and deliberately NOT a larger "a real build emits ~N
 * chunks" number: a floor must be MEASURED, and this checkout has no dist/ to
 * measure (verified 2026-08-16: `dist/` does not exist in the working tree,
 * and no build artifact exists anywhere in the repo). 1 is the definitional
 * floor — it cannot be wrong, because a bundle gate that measured zero
 * bundles has not checked the bundle.
 *
 * TO TIGHTEN IT HONESTLY: run a real `npm run build`, read the
 * "js chunks measured" line this script now prints on EVERY run, and set this
 * to roughly 75-80% of that observed count with the date and the number in
 * this comment — the same discipline as scripts/ratchets/reachability.json
 * `minima`. Do not guess it from vite.config.ts manualChunks or the React.lazy
 * count; those predict emitted chunks, they do not measure them.
 */
const MIN_JS_FILES = 1; // floor; no measured build available 2026-08-16

// A floor of 0 is not a floor, and neither is a deleted one. scripts/ratchet.mjs
// rejects the same shape for the same reason: an unfloored population must not
// be able to exist. This runs before any measurement so it cannot be skipped.
if (!Number.isInteger(MIN_JS_FILES) || MIN_JS_FILES < 1) {
  console.error(
    `FAIL: MIN_JS_FILES is not a floor (got ${JSON.stringify(MIN_JS_FILES)}). ` +
      `Zero, NaN or a missing floor would let a vacuous scan read as a pass — which is the ` +
      `exact defect this gate was rewritten to remove.`
  );
  process.exit(1);
}

// ── Paths, resolved from THIS FILE, never from cwd ────────────────────────
// The original used `import.meta.dirname || "."`, which on any runtime without
// import.meta.dirname silently rebased the whole scan onto the caller's cwd —
// a third way to look at the wrong directory and call it clean. fileURLToPath
// works on every ESM runtime and is asserted below.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
if (!SCRIPT_DIR || !existsSync(SCRIPT_DIR)) {
  console.error(
    `FAIL: could not resolve this script's own directory (got ${JSON.stringify(SCRIPT_DIR)}). ` +
      `Every path below is derived from it, so the scan would be aimed at an unknown tree.`
  );
  process.exit(1);
}
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DIST_ROOT = join(REPO_ROOT, "dist"); // script/build.ts output root
const CLIENT_OUT = join(REPO_ROOT, "dist", "public"); // vite.config.ts build.outDir
const ASSETS_DIR = join(CLIENT_OUT, "assets"); // vite assetsDir (default)

const args = process.argv.slice(2);
const envFlag = (name) => {
  const v = process.env[name];
  return typeof v === "string" && v !== "" && v !== "0" && v.toLowerCase() !== "false";
};
const REQUIRE_BUILD =
  args.includes("--require-build") || envFlag("BUNDLE_SIZE_REQUIRE_BUILD") || envFlag("CI");
const REQUIRE_BUILD_REASON = args.includes("--require-build")
  ? "--require-build was passed"
  : envFlag("BUNDLE_SIZE_REQUIRE_BUILD")
    ? "BUNDLE_SIZE_REQUIRE_BUILD is set"
    : envFlag("CI")
      ? "CI is set"
      : null;

const rel = (p) => relative(REPO_ROOT, p) || ".";

// ── Outcomes. SKIP must never be mistakable for PASS. ─────────────────────
function fail(headline, detailLines = []) {
  console.error(`FAIL: ${headline}`);
  for (const l of detailLines) console.error(`  ${l}`);
  process.exit(1);
}

function skip(headline, detailLines = []) {
  console.log("┌──────────────────────────────────────────────────────────────┐");
  console.log("│  SKIP — BUNDLE NOT MEASURED. THIS IS NOT A PASS.             │");
  console.log("└──────────────────────────────────────────────────────────────┘");
  console.log(`SKIP: ${headline}`);
  for (const l of detailLines) console.log(`  ${l}`);
  console.log("  No bundle-size budget was enforced by this run.");
  console.log(
    "  To make this case FAIL instead: pass --require-build, or set " +
      "BUNDLE_SIZE_REQUIRE_BUILD=1 (CI already implies it)."
  );
  process.exit(0);
}

// ── The walk: recursive, and loud about anything it cannot read ───────────
/**
 * @returns {{ jsFiles: {rel: string, bytes: number}[], entriesSeen: number,
 *             dirsWalked: number, otherFiles: number }}
 */
function collectJs(root) {
  const jsFiles = [];
  let entriesSeen = 0;
  let dirsWalked = 0;
  let otherFiles = 0;
  const stack = [root];

  while (stack.length) {
    const dir = stack.pop();
    dirsWalked++;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      // Only the TOP-level absence is a "no build" question, and it is decided
      // before this function is called. Anything failing here is a broken scan.
      fail(`cannot read ${rel(dir)} while walking the bundle output`, [
        `${err.code ?? "error"}: ${err.message}`,
        "A directory the walk expected to read is unreadable, so the counts below would be partial.",
      ]);
    }
    for (const entry of entries) {
      entriesSeen++;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".js")) {
        otherFiles++;
        continue;
      }
      let size;
      try {
        size = statSync(full).size;
      } catch (err) {
        fail(`cannot stat ${rel(full)}`, [
          `${err.code ?? "error"}: ${err.message}`,
          "A chunk vanished or became unreadable mid-scan; the total below would be an undercount.",
        ]);
      }
      jsFiles.push({ rel: relative(root, full), bytes: size });
    }
  }
  return { jsFiles, entriesSeen, dirsWalked, otherFiles };
}

/**
 * The assets directory is absent. This is the ONLY branch where exiting 0 is
 * ever correct, and which of the three outcomes applies is decided from
 * evidence on disk plus the explicit require-build contract — not from a
 * swallowed exception.
 */
function decideNoAssetsDir() {
  const clientOutExists = existsSync(CLIENT_OUT);
  const distExists = existsSync(DIST_ROOT);

  if (clientOutExists) {
    let listing = [];
    try {
      listing = readdirSync(CLIENT_OUT).slice(0, 20);
    } catch {
      /* listing is a diagnostic nicety; its absence must not change the verdict */
    }
    fail(`${rel(CLIENT_OUT)} exists but ${rel(ASSETS_DIR)} does not — the client build ran and emitted elsewhere`, [
      `This is not "no build": vite's outDir is present, so a build produced client output`,
      `somewhere this gate does not look (assetsDir renamed, or a rollup output.dir change).`,
      `${rel(CLIENT_OUT)} contains: ${listing.length ? listing.join(", ") : "(unreadable)"}`,
      `Fix the path in this script to match vite.config.ts, or fix the build. Do NOT skip:`,
      `a real bundle exists on disk and would ship unmeasured.`,
    ]);
  }

  if (distExists) {
    let listing = [];
    try {
      listing = readdirSync(DIST_ROOT).slice(0, 20);
    } catch {
      /* diagnostic only */
    }
    fail(`${rel(DIST_ROOT)} exists but ${rel(CLIENT_OUT)} does not — a build ran and produced no client output`, [
      `${rel(DIST_ROOT)} contains: ${listing.length ? listing.join(", ") : "(unreadable)"}`,
      `The server bundle without the client bundle is a broken or partial build, not a clean one.`,
    ]);
  }

  // No dist/ at all: nothing was ever built here.
  if (REQUIRE_BUILD) {
    fail(`no build output at all — ${rel(DIST_ROOT)} does not exist, and ${REQUIRE_BUILD_REASON}`, [
      `Run 'npm run build' before this gate. In CI the build step must precede it.`,
      `An unmeasured bundle is not a passing bundle.`,
    ]);
  }

  skip(`no build output at all — ${rel(DIST_ROOT)} does not exist`, [
    `Deliberate decision: outside CI, with no --require-build and no dist/ anywhere,`,
    `there is genuinely nothing to measure, so this run enforces nothing and says so.`,
  ]);
}

// ── Main ──────────────────────────────────────────────────────────────────
let assetsStat = null;
try {
  assetsStat = statSync(ASSETS_DIR);
} catch (err) {
  if (err.code === "ENOENT") {
    decideNoAssetsDir(); // always exits
  }
  // NOT absence — EACCES, ENOTDIR, EIO, … A broken scan is never a skip.
  fail(`cannot stat ${rel(ASSETS_DIR)}`, [
    `${err.code ?? "error"}: ${err.message}`,
    `The bundle output exists as far as this gate knows but could not be examined.`,
  ]);
}

if (!assetsStat.isDirectory()) {
  fail(`${rel(ASSETS_DIR)} is not a directory`, [
    `Expected vite's assets output directory; found a ${assetsStat.isFile() ? "file" : "non-directory entry"}.`,
  ]);
}

const { jsFiles, entriesSeen, dirsWalked, otherFiles } = collectJs(ASSETS_DIR);

// ── VACUITY FLOOR — before any count is allowed to read as clean ──────────
if (jsFiles.length < MIN_JS_FILES) {
  fail(
    `VACUOUS SCAN — ${jsFiles.length} .js file(s) measured under ${rel(ASSETS_DIR)} (floor ${MIN_JS_FILES})`,
    [
      `Walked ${dirsWalked} director${dirsWalked === 1 ? "y" : "ies"}, saw ${entriesSeen} entr${entriesSeen === 1 ? "y" : "ies"}, ${otherFiles} non-.js file(s).`,
      `A bundle-size gate that measured no bundle has not checked the bundle, so this`,
      `is a failure and not a 0 KB pass. Likely causes: the build emitted nothing, the`,
      `output directory moved, or the chunk extension changed.`,
      `Do NOT lower this floor to make it green — fix the build or the path.`,
    ]
  );
}

const totalBytes = jsFiles.reduce((n, f) => n + f.bytes, 0);
if (totalBytes === 0) {
  fail(`VACUOUS SCAN — ${jsFiles.length} .js file(s) found under ${rel(ASSETS_DIR)} but they total 0 bytes`, [
    `Every emitted chunk is empty. That is a broken build, not a small one.`,
  ]);
}

// Compare on BYTES, not on per-file rounded KB: the original rounded each
// chunk to KB before summing, so a long tail of sub-512-byte chunks each
// rounded to 0 and vanished from the total. Rounding is now presentational.
const totalJSKB = Math.round(totalBytes / 1024);
const violations = [];
for (const f of jsFiles) {
  if (f.bytes > MAX_SINGLE_CHUNK_KB * 1024) {
    violations.push(`${f.rel}: ${Math.round(f.bytes / 1024)} KB (limit: ${MAX_SINGLE_CHUNK_KB} KB)`);
  }
}
if (totalBytes > MAX_TOTAL_JS_KB * 1024) {
  violations.push(`Total JS: ${totalJSKB} KB exceeds limit of ${MAX_TOTAL_JS_KB} KB`);
}

// The measured population prints on EVERY outcome. "0 violations" means
// nothing unless the reader can see how much was actually looked at.
const largest = jsFiles.reduce((a, b) => (b.bytes > a.bytes ? b : a), jsFiles[0]);

// ── The entry chunk, ratcheted on its own ─────────────────────────────────
// A win in total JS must not be able to hide a regression in the chunk every
// visitor downloads before anything renders.
// The entry is the module script index.html actually loads — NOT "a file called
// index-*.js". This build emits five of those (716 KB, 65 KB, 8.9 KB, 7.1 KB,
// 975 B); a name-matching find picked the 975-byte one and duly reported the
// entry had shrunk from 700 KB to 1 KB. Reading it from the HTML cannot pick
// the wrong file, because the browser reads the same line.
const indexHtml = join(ASSETS_DIR, "..", "index.html");
if (!existsSync(indexHtml)) {
  console.error(
    "FAIL: dist/public/index.html is missing, so the entry chunk cannot be " +
      "identified. The number that governs first paint would go unmeasured.",
  );
  process.exit(1);
}
const entrySrc = /<script[^>]*type="module"[^>]*src="([^"]+)"/.exec(
  readFileSync(indexHtml, "utf8"),
)?.[1];
if (!entrySrc) {
  console.error(
    "FAIL: no <script type=\"module\" src=…> in dist/public/index.html. The " +
      "entry chunk cannot be identified.",
  );
  process.exit(1);
}
const entryName = entrySrc.split("/").pop();
const entry = jsFiles.find((f) => f.rel.split("/").pop() === entryName);
if (!entry) {
  console.error(
    `FAIL: index.html loads ${entryName}, which is not among the ` +
      `${jsFiles.length} chunks measured. The scan is reading a different tree ` +
      "than the one that ships.",
  );
  process.exit(1);
}
const entryKB = Math.round(entry.bytes / 1024);
if (entryKB > RATCHET_ENTRY_CHUNK_KB) {
  violations.push(
    `Entry chunk ${entry.rel}: ${entryKB} KB exceeds the ratchet of ` +
      `${RATCHET_ENTRY_CHUNK_KB} KB. This is the code every visitor downloads ` +
      "before anything renders.",
  );
}

// ── Stale-high: a win that is not locked in is a win that gets given back ──
const staleHigh = [];
const checkStale = (label, measured, ratchet) => {
  if (measured < ratchet * (1 - RATCHET_TOLERANCE)) {
    staleHigh.push(`  ${label}: ${measured} KB, ratchet says ${ratchet} KB — lower it to ${measured}`);
  }
};
checkStale("total JS", Math.round(totalBytes / 1024), RATCHET_TOTAL_JS_KB);
checkStale("largest chunk", Math.round(largest.bytes / 1024), RATCHET_SINGLE_CHUNK_KB);
checkStale("entry chunk", entryKB, RATCHET_ENTRY_CHUNK_KB);
if (staleHigh.length > 0 && violations.length === 0) {
  console.error("");
  console.error(
    "[check-bundle-size] FAIL — stale-high ratchet. The bundle got smaller and " +
      "the ceiling did not follow, so the win is unprotected: the next change " +
      "can give it back without failing anything.",
  );
  console.error("");
  for (const l of staleHigh) console.error(l);
  console.error("");
  process.exit(1);
}
const population = [
  `scanned:      ${rel(ASSETS_DIR)}`,
  `js chunks measured: ${jsFiles.length}  (floor ${MIN_JS_FILES})`,
  `directories walked: ${dirsWalked}, entries seen: ${entriesSeen}, non-.js files: ${otherFiles}`,
  `total JS:      ${totalJSKB} KB  (ratchet ${RATCHET_TOTAL_JS_KB} KB · goal ${GOAL_TOTAL_JS_KB} KB — ${Math.max(0, totalJSKB - GOAL_TOTAL_JS_KB)} KB to go)`,
  `entry chunk:   ${entry.rel} — ${entryKB} KB  (ratchet ${RATCHET_ENTRY_CHUNK_KB} KB · goal ${GOAL_SINGLE_CHUNK_KB} KB — ${Math.max(0, entryKB - GOAL_SINGLE_CHUNK_KB)} KB to go)`,
  `largest chunk: ${largest.rel} — ${Math.round(largest.bytes / 1024)} KB  (ratchet ${RATCHET_SINGLE_CHUNK_KB} KB · goal ${GOAL_SINGLE_CHUNK_KB} KB)`,
];

if (violations.length > 0) {
  console.error("FAIL: Bundle size violations:\n");
  for (const v of violations) console.error(`  ${v}`);
  console.error("");
  for (const l of population) console.error(`  ${l}`);
  process.exit(1);
}

console.log(`PASS: Bundle size OK (total JS: ${totalJSKB} KB across ${jsFiles.length} chunks)`);
for (const l of population) console.log(`  ${l}`);
process.exit(0);
