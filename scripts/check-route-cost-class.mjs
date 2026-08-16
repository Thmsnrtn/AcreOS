#!/usr/bin/env node
/**
 * L5b — Route cost-class lint.
 *
 * Enforces that any *new* route handler added to server/routes*.ts
 * declares a costClass. The check is delta-only — flagging the ~hundreds
 * of pre-existing routes en masse would be a multi-week retrofit and not
 * actionable in CI. Instead, every new commit must pull its weight.
 *
 * What counts as a route:
 *   - `app.METHOD(...)` calls in server/routes*.ts where METHOD is one of
 *     get/post/put/patch/delete/all/options/head.
 *   - `router.METHOD(...)` calls inside server/routes*.ts.
 *
 * What counts as costClass declared:
 *   - The route's argument list contains a call to `costClass(...)` or
 *     `withCostClass(...)`.
 *
 * Modes:
 *   - default: diff vs origin/main (CI mode)
 *   - --all:   audit every server/routes*.ts route (full retrofit progress)
 *
 * Exit code: 0 on pass, 1 on violation OR on any scan that could not be
 * trusted (see below).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE IS SHAPED LIKE THIS — the defect it was rewritten to remove
 * ---------------------------------------------------------------------------
 * `gitDiff()` used to swallow EVERY error and return `""`. An empty string is
 * also exactly what a genuinely route-free diff produces, so
 * `newRoutesFromDiff()` returned [] and main() printed
 * "no new routes in diff vs origin/main" and exited 0 — identically for:
 *
 *   · a shallow CI clone with no merge base,
 *   · a base ref that was never fetched (`origin/main` absent),
 *   · git not on PATH, or the process not inside a work tree,
 *   · execSync exceeding its buffer,
 *   · and a real, clean, route-free diff.
 *
 * Four failures wearing a pass's clothes. That is now impossible:
 *
 *   · gitDiff() returns `null` on failure and a string on success. `null` and
 *     `""` are different answers, and `null` EXITS NON-ZERO with the git
 *     stderr, the exact command, and the base ref printed.
 *   · A preflight resolves the base ref and the merge base BEFORE diffing, so
 *     "you never fetched origin/main" is diagnosed as itself rather than as
 *     "no new routes".
 *   · maxBuffer is raised to 256 MB. THIS WAS NOT HYPOTHETICAL: measured
 *     2026-08-16 on this branch, `git diff --unified=0 origin/main...HEAD --
 *     server` produced 1,037,062 bytes against Node's 1,048,576-byte default —
 *     11,514 bytes of headroom. The next few route edits would have tipped
 *     execSync into ENOBUFS, and the old catch would have reported that as
 *     "no new routes in diff".
 *   · An empty diff is reported as "git SUCCEEDED and the diff is empty",
 *     never as a bare absence.
 *   · Predicate SELF-TESTS and in-repo CANARIES run before any count is
 *     allowed to read as clean, and POPULATION FLOORS (see MIN_ROUTE_FILES /
 *     MIN_ROUTE_CALLS) fail a scan that has stopped seeing the tree. A
 *     missing floor fails as loudly as a breached one.
 *   · Every path is resolved from THIS FILE, not from cwd. The git pathspec
 *     `-- server` and `readdirSync("server")` were both cwd-relative, so
 *     running the gate from anywhere but the repo root aimed it at nothing.
 *
 * NOTE ON SCOPE — a known blind spot, left alone deliberately:
 * ROUTE_METHOD_RE only recognises routers named `app` or `router`. Routes
 * registered on a differently-named binding are invisible to this gate;
 * server/routes-support-tickets.ts registers three costClass'd routes on a
 * router named `api` and none of them is seen, in either direction. Widening
 * the regex changes the violation set across 270 files and is a separate,
 * measured change — it is recorded here rather than smuggled in.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROUTE_METHODS = ["get", "post", "put", "patch", "delete", "all", "options", "head"];
const ROUTE_METHOD_RE = new RegExp(`^\\s*(?:app|router)\\.(?:${ROUTE_METHODS.join("|")})\\s*\\(`, "i");
const COST_CLASS_RE = /\b(?:costClass|withCostClass)\s*\(/;

const args = process.argv.slice(2);
const mode = args.includes("--all") ? "all" : "new-only";
const baseRef = process.env.LINT_BASE_REF || "origin/main";

// ── Paths resolved from THIS FILE, never from cwd ─────────────────────────
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
if (!SCRIPT_DIR || !existsSync(SCRIPT_DIR)) {
  console.error(
    `[check-route-cost-class] FAIL: could not resolve this script's own directory ` +
      `(got ${JSON.stringify(SCRIPT_DIR)}). Every path below derives from it.`
  );
  process.exit(1);
}
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const ROUTES_DIR = "server"; // repo-relative; used verbatim as the git pathspec
const ROUTES_DIR_ABS = join(REPO_ROOT, ROUTES_DIR);

// ----------------------------------------------------------------------------
// ANCHOR FILES — the two files this gate is actually about. Their presence is
// how it knows it is looking at the real tree. The rule is all-or-nothing:
// this script has no fixture mode, so a missing anchor is never benign. Either
// the file was renamed without updating this gate, or the scan is pointed
// somewhere it should not be. Both make every "0" below meaningless.
// ----------------------------------------------------------------------------
const ANCHOR_FILES = [
  join("server", "routes.ts"), // the root router
  join("server", "utils", "costClass.ts"), // the thing being enforced
];

// ----------------------------------------------------------------------------
// POPULATION FLOORS — vacuity guards, NOT budgets. Every number this gate
// reports counts BAD THINGS FOUND, so a scan that stops seeing files finds
// zero and prints a reassuring line. These floor the scan populations and the
// gate exits non-zero if one drops below, or if one is missing entirely.
//
// MEASURED 2026-08-16 against this working tree, with this file's own
// predicates: 270 route files (server/routes*.ts, excluding *.test.ts) and
// 1,868 route call sites in them. Floors seeded at ~75% of live so a broken
// walk / extension filter / regex trips them while ordinary consolidation —
// which this repo is actively doing to the /founder route set — does not.
//
// If a real deletion wave takes a population under its floor, LOWER THE FLOOR
// IN THE SAME COMMIT and name the wave. Never raise one to silence something,
// and never delete a key: an unfloored population is not allowed to exist.
// ----------------------------------------------------------------------------
const MIN_ROUTE_FILES = 200; // measured 2026-08-16: 270
const MIN_ROUTE_CALLS = 1400; // measured 2026-08-16: 1868

// ----------------------------------------------------------------------------
// IN-REPO CANARIES — real routes that must keep being CLASSIFIED by the two
// predicates working together. Without these, "0 violations" is
// indistinguishable from "COST_CLASS_RE stopped matching anything real".
// Each canary exercises a different shape, verified by hand 2026-08-16.
// ----------------------------------------------------------------------------
const CANARIES = [
  {
    file: join("server", "routes-founder-letters.ts"),
    label: "single-line `app.get(path, costClass(...), handler)` is seen and counted as classified",
    why: 'app.get("/api/field-notes", costClass("low"), listPublicFieldNotes) — the simplest classified shape there is. If this stops reading as classified, every clean run is noise.',
  },
  {
    file: join("server", "routes-transparency.ts"),
    label: "multi-line `app.get(\\n path,\\n costClass(...),` block is spanned by readRouteBlock",
    why: "The route opener and the costClass() argument are on different lines. This is the case readRouteBlock exists for; if the block walker regresses, multi-line classified routes start reading as violations (or, with a different regression, everything reads as classified).",
  },
  {
    file: join("server", "routes-admin-finance.ts"),
    label: "`router.` routes (not just `app.`) are seen and counted as classified",
    why: 'router.get("/reserve-floor", costClass("low"), …) — proves the router half of ROUTE_METHOD_RE still matches real code, not just the app half.',
  },
];

// ----------------------------------------------------------------------------
// Predicates (semantics unchanged from the original gate)
// ----------------------------------------------------------------------------
function listRouteFiles() {
  const entries = readdirSync(ROUTES_DIR_ABS);
  return entries
    .filter((name) => /^routes.*\.ts$/.test(name) && !name.endsWith(".test.ts"))
    .map((name) => join(ROUTES_DIR, name));
}

function isRouteCall(line) {
  return ROUTE_METHOD_RE.test(line);
}

function readFileAt(repoRelPath) {
  return readFileSync(join(REPO_ROOT, repoRelPath), "utf8");
}

/**
 * Walk forward from the route-start line until we see a balancing
 * close-paren at column ≤ the open. Return the joined route block.
 */
function readRouteBlock(lines, startIdx) {
  let depth = 0;
  let started = false;
  const collected = [];
  for (let i = startIdx; i < lines.length && i < startIdx + 200; i++) {
    const line = lines[i];
    collected.push(line);
    for (const ch of line) {
      if (ch === "(") {
        depth++;
        started = true;
      } else if (ch === ")") {
        depth--;
        if (started && depth === 0) {
          return collected.join("\n");
        }
      }
    }
  }
  return collected.join("\n");
}

/** @returns {{ violations: {file,line,head}[], routeCalls: number, classified: number }} */
function scanFile(file, content) {
  const lines = content.split("\n");
  const violations = [];
  let routeCalls = 0;
  let classified = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!isRouteCall(lines[i])) continue;
    routeCalls++;
    const block = readRouteBlock(lines, i);
    if (COST_CLASS_RE.test(block)) {
      classified++;
    } else {
      violations.push({ file, line: i + 1, head: lines[i].trim().slice(0, 120) });
    }
  }
  return { violations, routeCalls, classified };
}

function findRouteViolations(file) {
  return scanFile(file, readFileAt(file)).violations;
}

// ----------------------------------------------------------------------------
// git — the whole point of the rewrite. A FAILURE AND AN EMPTY DIFF ARE
// DIFFERENT ANSWERS AND MUST NEVER SHARE A RETURN VALUE.
// ----------------------------------------------------------------------------
const GIT_OPTS = {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  cwd: REPO_ROOT, // so the `-- server` pathspec means the same thing from anywhere
  maxBuffer: 256 * 1024 * 1024, // see header: the live diff was 11,514 bytes under the default
};

/** Last git failure, for the error report. */
let lastGitError = null;

function recordGitError(label, cmd, err) {
  lastGitError = {
    label,
    cmd,
    status: err?.status ?? null,
    code: err?.code ?? null,
    stderr: (err?.stderr ?? "").toString().trim(),
    message: (err?.message ?? String(err)).split("\n")[0],
  };
  return null;
}

/** @returns {string|null} trimmed stdout, or null if the command failed. */
function git(label, cmd) {
  try {
    return execSync(cmd, GIT_OPTS).trim();
  } catch (err) {
    return recordGitError(label, cmd, err);
  }
}

const DIFF_CMD = `git diff --unified=0 ${baseRef}...HEAD -- ${ROUTES_DIR}`;

/**
 * @returns {string|null} the raw diff (possibly ""), or null if git failed.
 * `""` means git ran and there is nothing to report. `null` means we do not
 * know, and the caller MUST exit non-zero.
 */
function gitDiff() {
  try {
    return execSync(DIFF_CMD, GIT_OPTS);
  } catch (err) {
    return recordGitError("diff", DIFF_CMD, err);
  }
}

/** @returns {Array|null} null propagates a git failure; [] means genuinely none. */
function newRoutesFromDiff(diff) {
  if (diff === null || diff === undefined) return null;
  const adds = [];
  let currentFile = null;
  let currentLine = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
    } else if (line.startsWith("@@")) {
      const m = /\+(\d+)/.exec(line);
      if (m) currentLine = parseInt(m[1], 10);
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      const body = line.slice(1);
      if (currentFile && /^server\/routes.*\.ts$/.test(currentFile) && isRouteCall(body)) {
        adds.push({ file: currentFile, line: currentLine, body });
      }
      currentLine++;
    } else if (!line.startsWith("-")) {
      currentLine++;
    }
  }
  return adds;
}

// ----------------------------------------------------------------------------
// Vacuity guards — everything below runs BEFORE any count may read as clean
// ----------------------------------------------------------------------------

/** Predicate self-tests: prove the regexes and the block walker still work. */
function runSelfTests() {
  const failures = [];
  const t = (label, cond) => {
    if (!cond) failures.push(`self-test FAILED — ${label}`);
  };

  // isRouteCall — positives
  t("isRouteCall matches app.get", isRouteCall('  app.get("/api/x", handler);'));
  t("isRouteCall matches router.post", isRouteCall('router.post("/x", h);'));
  t("isRouteCall matches app.delete", isRouteCall('  app.delete("/x", h);'));
  t("isRouteCall matches a bare multi-line opener", isRouteCall("  app.get("));
  // isRouteCall — negatives (a predicate that matches everything is as dead as
  // one that matches nothing)
  t("isRouteCall rejects a comment", !isRouteCall('  // app.get("/api/x")'));
  t("isRouteCall rejects fetch", !isRouteCall('  const r = await fetch("/api/x");'));
  t("isRouteCall rejects app.use", !isRouteCall('  app.use("/api", router);'));
  t("isRouteCall rejects a mid-line occurrence", !isRouteCall('  const x = 1; app.get("/y", h);'));

  // COST_CLASS_RE
  t("COST_CLASS_RE matches costClass(", COST_CLASS_RE.test('costClass("low")'));
  t("COST_CLASS_RE matches withCostClass(", COST_CLASS_RE.test("withCostClass(handler)"));
  t("COST_CLASS_RE rejects a bare mention", !COST_CLASS_RE.test("// costClass is required here"));

  // readRouteBlock + scanFile end-to-end, on synthetic sources
  const classified = ['app.get("/a", costClass("low"), h);'].join("\n");
  const unclassified = ['app.get("/a", h);'].join("\n");
  const multiline = ["app.get(", '  "/a",', '  costClass("low"),', "  h,", ");"].join("\n");
  const multilineBad = ["app.get(", '  "/a",', "  h,", ");"].join("\n");

  const sc = scanFile("synthetic", classified);
  t("synthetic classified single-line: 1 route call", sc.routeCalls === 1);
  t("synthetic classified single-line: 0 violations", sc.violations.length === 0);

  const su = scanFile("synthetic", unclassified);
  t("synthetic UNclassified single-line: 1 route call", su.routeCalls === 1);
  t("synthetic UNclassified single-line: 1 violation", su.violations.length === 1);

  const sm = scanFile("synthetic", multiline);
  t("synthetic classified multi-line: 1 route call", sm.routeCalls === 1);
  t("synthetic classified multi-line: 0 violations", sm.violations.length === 0);

  const smb = scanFile("synthetic", multilineBad);
  t("synthetic UNclassified multi-line: 1 violation", smb.violations.length === 1);

  // Diff parser — prove it extracts an added route from a real diff shape,
  // and that it does NOT invent one from an unrelated hunk.
  const fakeDiff = [
    "diff --git a/server/routes-x.ts b/server/routes-x.ts",
    "--- a/server/routes-x.ts",
    "+++ b/server/routes-x.ts",
    "@@ -10,0 +11,1 @@",
    '+  app.get("/api/new", h);',
  ].join("\n");
  const parsed = newRoutesFromDiff(fakeDiff);
  t("diff parser finds the added route", Array.isArray(parsed) && parsed.length === 1);
  t("diff parser records the file", parsed?.[0]?.file === "server/routes-x.ts");

  const noiseDiff = [
    "diff --git a/server/utils/costClass.ts b/server/utils/costClass.ts",
    "--- a/server/utils/costClass.ts",
    "+++ b/server/utils/costClass.ts",
    "@@ -1,0 +2,1 @@",
    '+  app.get("/api/new", h);',
  ].join("\n");
  t("diff parser ignores non-route files", newRoutesFromDiff(noiseDiff)?.length === 0);

  // The load-bearing distinction itself.
  t("newRoutesFromDiff propagates null", newRoutesFromDiff(null) === null);
  t("newRoutesFromDiff treats empty string as an empty result", Array.isArray(newRoutesFromDiff("")));

  // Floor integrity. A floor of 0 is not a floor, and neither is a floor that
  // was deleted — scripts/ratchet.mjs rejects the same shape for the same
  // reason. An unfloored population must not be able to exist.
  try {
    const isFloor = (n) => Number.isInteger(n) && n > 0;
    t(`MIN_ROUTE_FILES is a real floor (got ${MIN_ROUTE_FILES})`, isFloor(MIN_ROUTE_FILES));
    t(`MIN_ROUTE_CALLS is a real floor (got ${MIN_ROUTE_CALLS})`, isFloor(MIN_ROUTE_CALLS));
  } catch (err) {
    failures.push(
      `self-test FAILED — a population floor is not defined at all (${err.message}). ` +
        `A missing floor must fail as loudly as a breached one.`
    );
  }

  return failures;
}

function checkAnchors() {
  const present = ANCHOR_FILES.filter((f) => existsSync(join(REPO_ROOT, f)));
  if (present.length === ANCHOR_FILES.length) return [];
  const missing = ANCHOR_FILES.filter((f) => !present.includes(f));
  return [
    `ANCHOR SET BROKEN — found ${present.length}/${ANCHOR_FILES.length} anchor files under ${REPO_ROOT}. ` +
      `Missing: ${missing.join(", ")}. Either an anchor was renamed/deleted without updating this gate, ` +
      `or this scan is not looking at the AcreOS tree at all. Both make every count below meaningless. ` +
      `There is deliberately no opt-out flag: an escape hatch is a bypass with a nicer name.`,
  ];
}

/**
 * @returns {{ failures: string[], files: number, routeCalls: number,
 *             classified: number, violations: object[] }}
 */
function probePopulations() {
  const failures = [];
  let files = [];
  try {
    files = listRouteFiles();
  } catch (err) {
    failures.push(
      `CANNOT LIST ROUTE FILES — ${ROUTES_DIR_ABS}: ${err.code ?? "error"} ${err.message}. ` +
        `The scan has no population at all.`
    );
    return { failures, files: 0, routeCalls: 0, classified: 0, violations: [] };
  }

  let routeCalls = 0;
  let classified = 0;
  const violations = [];
  for (const f of files) {
    let content;
    try {
      content = readFileAt(f);
    } catch (err) {
      failures.push(`CANNOT READ ${f}: ${err.code ?? "error"} ${err.message} — the scan would be partial.`);
      continue;
    }
    const r = scanFile(f, content);
    routeCalls += r.routeCalls;
    classified += r.classified;
    violations.push(...r.violations);
  }

  if (files.length < MIN_ROUTE_FILES) {
    failures.push(
      `VACUOUS SCAN — only ${files.length} route file(s) under ${ROUTES_DIR_ABS} (floor ${MIN_ROUTE_FILES}, ` +
        `measured 270 on 2026-08-16). An empty scan is not a clean bill of health. ` +
        `If a consolidation wave legitimately took this below the floor, lower the floor in the same commit.`
    );
  }
  if (routeCalls < MIN_ROUTE_CALLS) {
    failures.push(
      `VACUOUS SCAN — only ${routeCalls} route call site(s) matched across ${files.length} file(s) ` +
        `(floor ${MIN_ROUTE_CALLS}, measured 1868 on 2026-08-16). ROUTE_METHOD_RE has probably stopped ` +
        `matching; every "no new routes" below would be meaningless.`
    );
  }

  return { failures, files: files.length, routeCalls, classified, violations };
}

function runCanaries() {
  const failures = [];
  for (const c of CANARIES) {
    let content;
    try {
      content = readFileAt(c.file);
    } catch {
      failures.push(`canary MISSING — ${c.file} could not be read (${c.label})\n      ${c.why}`);
      continue;
    }
    const r = scanFile(c.file, content);
    if (r.routeCalls === 0) {
      failures.push(`canary DEAD — ${c.file}: no route call matched at all (${c.label})\n      ${c.why}`);
      continue;
    }
    if (r.classified === 0) {
      failures.push(
        `canary DEAD — ${c.file}: ${r.routeCalls} route call(s) matched but NONE read as classified ` +
          `(${c.label})\n      ${c.why}`
      );
    }
  }
  return failures;
}

function reportHardFailures(failures) {
  console.error("[check-route-cost-class] FAIL: the scan could not be trusted, so no count below is a result.\n");
  for (const f of failures) console.error(`  ${f}`);
  console.error(
    "\n  These are vacuity guards, not style rules. Fix the scan (or the tree); do NOT lower a floor,\n" +
      "  widen an anchor set or delete a self-test to make this green — that converts a broken gate\n" +
      "  into a silent one, which is the exact defect this file was rewritten to remove."
  );
  process.exit(1);
}

function reportGitFailure(what) {
  console.error(`[check-route-cost-class] FAIL: ${what}\n`);
  if (lastGitError) {
    console.error(`  command: ${lastGitError.cmd}`);
    console.error(`  exit status: ${lastGitError.status ?? "(none)"}${lastGitError.code ? ` (${lastGitError.code})` : ""}`);
    console.error(`  message: ${lastGitError.message}`);
    if (lastGitError.stderr) {
      for (const l of lastGitError.stderr.split("\n")) console.error(`  git: ${l}`);
    }
  }
  let shallow = "unknown";
  try {
    shallow = execSync("git rev-parse --is-shallow-repository", GIT_OPTS).trim();
  } catch {
    /* diagnostic only — must not change the verdict */
  }
  console.error("");
  console.error(`  base ref:  ${baseRef}  (override with LINT_BASE_REF)`);
  console.error(`  repo root: ${REPO_ROOT}`);
  console.error(`  shallow clone: ${shallow}`);
  console.error("");
  console.error("  A git failure is NOT an empty diff. The previous version of this gate returned \"\" here");
  console.error("  and printed \"no new routes in diff\", so an unfetched base ref, a shallow clone with no");
  console.error("  merge base, and a clean branch all exited 0 identically. Likely fixes:");
  console.error(`    git fetch --no-tags origin +refs/heads/main:refs/remotes/${baseRef.replace(/^origin\//, "origin/")}`);
  console.error("    (in CI) checkout with fetch-depth: 0, or fetch the base ref before this step");
  console.error("    or set LINT_BASE_REF to a ref that exists in this clone");
  process.exit(1);
}

/** Resolve the base ref and the merge base before diffing, so each failure names itself. */
function gitPreflight() {
  const inWorkTree = git("rev-parse", "git rev-parse --is-inside-work-tree");
  if (inWorkTree === null) reportGitFailure("git is unusable here (not a work tree, or git is not on PATH)");
  if (inWorkTree !== "true") {
    console.error(`[check-route-cost-class] FAIL: ${REPO_ROOT} is not inside a git work tree (got "${inWorkTree}").`);
    process.exit(1);
  }

  const baseSha = git("verify-base", `git rev-parse --verify --quiet ${baseRef}^{commit}`);
  if (baseSha === null || baseSha === "") {
    lastGitError ??= { cmd: `git rev-parse --verify ${baseRef}^{commit}`, status: 1, code: null, stderr: "", message: "base ref did not resolve" };
    reportGitFailure(`base ref "${baseRef}" does not resolve in this clone`);
  }

  const mergeBase = git("merge-base", `git merge-base ${baseRef} HEAD`);
  if (mergeBase === null || mergeBase === "") {
    lastGitError ??= { cmd: `git merge-base ${baseRef} HEAD`, status: 1, code: null, stderr: "", message: "no merge base" };
    reportGitFailure(
      `no merge base between "${baseRef}" and HEAD — the three-dot diff this gate uses cannot be computed`
    );
  }

  return { baseSha, mergeBase };
}

// ----------------------------------------------------------------------------
function main() {
  // ── Vacuity guards, before anything is allowed to read as "clean" ───────
  const hardFailures = [
    ...runSelfTests(),
    ...checkAnchors(),
  ];
  // Anchors failing means the tree is wrong; probing populations after that
  // would only produce a second, derivative complaint.
  if (hardFailures.length > 0) reportHardFailures(hardFailures);

  const pop = probePopulations();
  hardFailures.push(...pop.failures, ...runCanaries());
  if (hardFailures.length > 0) reportHardFailures(hardFailures);

  const populationLine =
    `scanned ${pop.files} route file(s) (floor ${MIN_ROUTE_FILES}), ` +
    `${pop.routeCalls} route call site(s) (floor ${MIN_ROUTE_CALLS}), ` +
    `${pop.classified} classified, ${pop.violations.length} unclassified`;

  if (mode === "all") {
    for (const v of pop.violations) {
      console.log(`${v.file}:${v.line}: route without costClass — ${v.head}`);
    }
    console.log(
      `\n[check-route-cost-class] AUDIT: ${pop.violations.length} unclassified route(s) across ${pop.files} file(s)`
    );
    console.log(`[check-route-cost-class] population: ${populationLine}`);
    process.exit(0); // audit mode is informational — but a vacuous audit is not
  }

  // ── new-only — diff vs base ────────────────────────────────────────────
  gitPreflight(); // exits non-zero with a specific diagnosis if git cannot answer

  const diff = gitDiff();
  if (diff === null) {
    // THE REQUIRED DISTINCTION: git failed. This is not an empty diff.
    reportGitFailure(`could not compute the diff against "${baseRef}"`);
  }

  const adds = newRoutesFromDiff(diff);
  if (adds === null) {
    reportGitFailure("the diff parser was handed a failed git result");
  }

  if (diff === "") {
    console.log(
      `[check-route-cost-class] OK: git succeeded and the diff vs ${baseRef} is EMPTY — ` +
        `no changes under ${ROUTES_DIR}/ at all.`
    );
    console.log(`[check-route-cost-class] population: ${populationLine}`);
    process.exit(0);
  }

  if (adds.length === 0) {
    console.log(
      `[check-route-cost-class] OK: git succeeded, the diff vs ${baseRef} is ` +
        `${Buffer.byteLength(diff)} bytes, and it adds no new route handlers.`
    );
    console.log(`[check-route-cost-class] population: ${populationLine}`);
    process.exit(0);
  }

  // For each added route line, re-read the file and verify costClass present
  // in the route block. We need the block context because the route
  // declaration may span multiple lines and the added line might be just
  // the `app.get(` opener.
  const fileLineToViolation = new Map();
  let unreadable = 0;
  for (const add of adds) {
    let content;
    try {
      content = readFileAt(add.file);
    } catch {
      // The file was added and then deleted, or renamed, inside the diff range.
      unreadable++;
      continue;
    }
    const lines = content.split("\n");
    let startIdx = add.line - 1;
    for (let probe = Math.max(0, startIdx - 5); probe <= startIdx; probe++) {
      if (isRouteCall(lines[probe] ?? "")) {
        startIdx = probe;
        break;
      }
    }
    if (!isRouteCall(lines[startIdx] ?? "")) continue;
    const block = readRouteBlock(lines, startIdx);
    if (!COST_CLASS_RE.test(block)) {
      const key = `${add.file}:${startIdx + 1}`;
      fileLineToViolation.set(key, {
        file: add.file,
        line: startIdx + 1,
        head: (lines[startIdx] ?? "").trim().slice(0, 120),
      });
    }
  }

  const violations = [...fileLineToViolation.values()];
  const addedLine =
    `${adds.length} added route line(s) in a ${Buffer.byteLength(diff)}-byte diff vs ${baseRef}` +
    (unreadable ? `, ${unreadable} of which name files no longer readable at HEAD` : "");

  if (violations.length === 0) {
    console.log(`[check-route-cost-class] OK: all new routes declare costClass() — ${addedLine}`);
    console.log(`[check-route-cost-class] population: ${populationLine}`);
    process.exit(0);
  }

  console.error("[check-route-cost-class] FAIL: new routes missing costClass declaration:\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}: ${v.head}`);
  }
  console.error(`
Every new route must declare its expected cost-shape. Pick one:

  costClass("free")   — no DB / no provider call (e.g. health checks)
  costClass("low")    — single DB query
  costClass("medium") — multiple DB queries OR cheap provider hit
  costClass("high")   — AI inference or expensive provider call
  costClass("bypass") — explicit opt-out (use for webhooks where the
                       cost shape is genuinely unknown at registration)

Import from "@/server/utils/costClass" and place it in the middleware chain
before the handler:

  import { costClass } from "./utils/costClass";

  app.get("/api/leads", isAuthenticated, costClass("low"), async (req, res) => { ... });

See server/utils/costClass.ts for details.
`);
  console.error(`[check-route-cost-class] ${addedLine}`);
  console.error(`[check-route-cost-class] population: ${populationLine}`);
  process.exit(1);
}

main();
