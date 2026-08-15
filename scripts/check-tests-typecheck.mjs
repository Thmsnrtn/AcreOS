#!/usr/bin/env node
// ============================================================================
// scripts/check-tests-typecheck.mjs — type-check the TEST suite, as a ratchet.
// ----------------------------------------------------------------------------
// WHY THIS EXISTS
//
// `tsconfig.json` lists `client/src`, `shared` and `server` in `include` and
// puts `**/*.test.ts` in `exclude`, so 700+ test files and ~9,200 tests were
// never type-checked at all. `npm run check` reported a clean tsc pass over a
// project that did not contain the suite.
//
// A test is the WORST place to lose type checking, because a type error there
// is invisible at runtime too:
//
//     expect(result.nonExistentField).toBeUndefined();   // passes, forever
//
// …and an import of a symbol that no longer exists only fails if the line
// executes. Unit 101 hit exactly that: removing a re-export nothing consumed
// left a test importing through the dead path, and tsc said nothing.
//
// WHAT THE FIRST MEASUREMENT GOT WRONG, recorded because it nearly shipped. A
// pass run from a scratchpad config outside the repo reported TWELVE errors and
// I almost wrote down "the suite type-checks clean". That config could not
// resolve `node` / `vite/client` / `vitest/globals`, so tsc gave up early. Run
// IN PLACE the real number was 170 across 64 of 704 files. Measure where the
// thing actually lives.
//
// The twelve were not nothing: all were SYNTAX errors in one file,
// `tests/simulation/sim-scaling-operator.spec.ts`, which used regex literals as
// object KEYS. It never parsed, so `npm run test:scale` had never run once.
//
// WHY A RATCHET AND NOT A HARD GATE
//
// 162 errors remain, mostly mocks that cannot represent what they are asserted
// against — `TS2493` on empty-tuple fixtures, `TS2352`/`TS2322` on hand-built
// rows standing in for Drizzle types. Those are real friction to fix and none of
// them is a live bug. A hard gate would fail on day one and be `--no-verify`'d
// into irrelevance within a week; the same reasoning `lint-reachability.mjs`
// states for its own baselines.
//
// Bidirectional, like every other ratchet here:
//   count >  baseline → FAIL (a new untyped test — fix it, don't bump)
//   count <  baseline → FAIL (an improvement landed; lock it in, same commit)
//   count == baseline → PASS
//
// Exit codes: 0 pass, 1 over/under baseline or tsc could not run.
// ============================================================================

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const BASELINE_FILE = join(__dirname, "ratchets", "tests-typecheck.json");
const TAG = "[check-tests-typecheck]";

const args = process.argv.slice(2);
const MEASURE_ONLY = args.includes("--measure");

const cfg = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
const baseline = cfg.baselineCount;

let output = "";
try {
  execFileSync("npx", ["tsc", "--noEmit", "-p", "tsconfig.tests.json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  // tsc exits non-zero when it reports errors — that is the expected path here.
  output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  if (!output.trim()) {
    console.error(`${TAG} FAIL — tsc produced no output at all. It could not run.`);
    console.error(String(err.message ?? err));
    process.exit(1);
  }
  // A KILLED tsc is not a clean tsc. Unit 116 caught this evaluator reporting
  // "current count is 0, baseline says 162" during a run where vitest fork
  // workers were also dying — tsc was starved/killed mid-run, emitted some
  // non-error text, and the parse below dutifully counted zero `error TS` lines.
  // Zero-errors-because-it-crashed and zero-errors-because-the-code-is-clean are
  // different facts, and a register must never report the first as the second:
  // the stale-high failure it produces tells the operator to LOWER the baseline
  // to a number that was never true.
  if (err.signal) {
    console.error(`${TAG} FAIL — tsc was killed by ${err.signal}; refusing to report a count.`);
    process.exit(1);
  }
  const parsed = output.split("\n").filter((l) => /error TS\d+/.test(l)).length;
  if (parsed === 0) {
    console.error(
      `${TAG} FAIL — tsc exited ${err.status} yet no "error TS" lines parsed. ` +
        `A non-zero exit with zero diagnostics means the run is not trustworthy ` +
        `(crash, OOM, or an output format change) — refusing to report a count.`,
    );
    process.exit(1);
  }
}

const lines = output.split("\n").filter((l) => /error TS\d+/.test(l));
const count = lines.length;

// A zero count is only believable if tsc actually loaded the project. When the
// config resolves nothing, tsc reports a couple of TS2688s and stops — which is
// exactly how the first measurement of this population came back as "12".
if (/Cannot find type definition file for/.test(output)) {
  console.error(
    `${TAG} FAIL — tsc could not resolve the type libraries, so this count is ` +
      `meaningless. Check "types" in tsconfig.tests.json.`,
  );
  process.exit(1);
}

if (MEASURE_ONLY) {
  console.log(`${TAG}:measure current=${count} baseline=${baseline}`);
  const byCode = {};
  for (const l of lines) {
    const m = /error (TS\d+)/.exec(l);
    if (m) byCode[m[1]] = (byCode[m[1]] ?? 0) + 1;
  }
  for (const [code, n] of Object.entries(byCode).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${code}`);
  }
  process.exit(0);
}

if (count === baseline) {
  console.log(`${TAG} PASS — ${count} test type errors (baseline ${baseline})`);
  process.exit(0);
}

if (count > baseline) {
  console.error(
    `${TAG} FAIL — ${count} > baseline ${baseline} (+${count - baseline} new). ` +
      `A test that does not type-check can assert on a field that does not exist ` +
      `and pass forever. New offenders:`,
  );
  for (const l of lines.slice(0, 25)) console.error(`  ${l}`);
  if (lines.length > 25) console.error(`  … and ${lines.length - 25} more`);
  console.error(`  Do NOT raise the baseline to make this pass — fix the occurrence.`);
  process.exit(1);
}

console.error(
  `${TAG} FAIL — stale-high baseline. Current count is ${count}, baseline says ` +
    `${baseline}.\n  Good news: ${baseline - count} error(s) were fixed. Lock it in —\n` +
    `  set "baselineCount": ${count} in scripts/ratchets/tests-typecheck.json.`,
);
process.exit(1);
