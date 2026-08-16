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
// ----------------------------------------------------------------------------
// THE FAILURE MODE THIS GATE KEEPS HAVING, and why the fix had to change shape
//
// This evaluator's dangerous output is not a false FAIL. It is the *stale-high*
// branch at the bottom, which reads as GOOD NEWS and instructs the operator to
// lower a ratchet baseline. If the count it lowers to was produced by a tsc that
// never finished, the register has told the operator to write down a number that
// was never true, and the ratchet is destroyed in the same commit that "fixed"
// it. Every guard in this file exists to make that branch unreachable from an
// untrustworthy run.
//
//   Occurrence 1 — unit 116. During a pass where vitest fork workers were also
//   dying, tsc was starved mid-run and this gate reported "current count is 0,
//   baseline says 162". Hardening added then: refuse when `err.signal` is set,
//   and refuse when a NON-ZERO exit parsed ZERO `error TS` lines.
//
//   Occurrence 2 — 2026-08-16, during a full `npm run check`. This gate printed
//   "Current count is 1, baseline says 162. Good news: 161 error(s) were fixed.
//   Lock it in — set baselineCount: 1". Run in isolation minutes later the true
//   count was EXACTLY 162. The 1 was a tsc starved of memory mid-run. NEITHER
//   unit-116 guard fired: nothing killed the process with a signal, and the
//   truncated run parsed ONE diagnostic, not zero.
//
// The lesson is specific and worth stating plainly: **keying a trust guard on an
// exact number — zero — is what let a count of one through.** "Zero errors" was
// never the property that mattered; "did tsc finish loading and checking the
// project" was, and a count of diagnostics cannot answer that question at any
// value. So the guard below no longer asks how many errors came back. It asks
// tsc how much of the program it actually loaded, via `--extendedDiagnostics`,
// and refuses anything that walked less of the repo than `minima.filesLoaded` in
// scripts/ratchets/tests-typecheck.json. A truncated run fails that floor by
// orders of magnitude whether it emitted 0, 1, or 161 diagnostics.
//
// COST OF `--extendedDiagnostics`, measured before adopting it (2026-08-16),
// because a completeness signal that doubles a 300s gate is not worth having.
// A/B over the same single-file program (`tsc --noEmit --ignoreConfig
// --skipLibCheck shared/schema.ts`, 558 files, tsc 6.0.3):
//     plain      27.238s / 27.733s   exit 2   10 `error TS` lines
//     extended   26.875s / 27.406s   exit 2   10 `error TS` lines
// Identical exit status, identical diagnostics, and the extended run was inside
// the noise band (marginally faster in both pairs) — the counters it prints are
// ones tsc already collects. On the real config the parent measurement likewise
// saw exit 2 and 162 errors both with and without the flag. It is free; take it.
//
// The other two guards added in the same pass, both fail-closed:
//   * exit status outside {0 = no diagnostics, 2 = diagnostics reported} is
//     refused rather than parsed (catches OOM aborts, ENOBUFS, bad argv);
//   * crash signatures in the output (FATAL ERROR / heap out of memory /
//     Debug Failure / RangeError / Killed) are refused.
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
// Exit codes: 0 pass, 1 over/under baseline or the run could not be trusted.
// ============================================================================

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const BASELINE_FILE = join(__dirname, "ratchets", "tests-typecheck.json");
const TAG = "[check-tests-typecheck]";

// `--extendedDiagnostics` is load-bearing, not decoration: the `Files:` line it
// prints is this gate's ONLY evidence that tsc walked the project. Do not drop
// it to shave output.
const TSC_ARGV = ["tsc", "--noEmit", "-p", "tsconfig.tests.json", "--extendedDiagnostics"];

// The only exit statuses this gate is willing to interpret. tsc's ExitStatus:
// 0 = Success (no diagnostics), 2 = DiagnosticsPresent_OutputsGenerated — the
// two we have ever observed from this config. 1 (outputs skipped / uncaught
// exception in older builds), 3 (invalid project), 134/137 (abort/kill) and
// `undefined` (ENOBUFS, spawn failure) all mean "something other than a normal
// check happened", and a count harvested from one of those is not a measurement.
// If a tsc upgrade legitimately starts returning another status here, MEASURE it
// and widen this set deliberately — do not delete the check.
const TSC_KNOWN_GOOD_EXIT = new Set([0, 2]);

// Scanned against NON-diagnostic lines only: a real `error TSxxxx` line can
// legitimately quote `RangeError` in a type name, but crash text never carries a
// TS error code.
const CRASH_SIGNATURES = [
  [/FATAL ERROR/, "node aborted with FATAL ERROR"],
  [/heap out of memory/i, "V8 ran out of heap"],
  [/Debug Failure/, "a TypeScript internal invariant blew up"],
  [/\bRangeError\b/, "a RangeError escaped (typically stack or heap exhaustion)"],
  [/\bKilled\b/, "the process was killed"],
];

const args = process.argv.slice(2);
const MEASURE_ONLY = args.includes("--measure");

/**
 * Refuse to report a count. Every path that cannot prove the run finished ends
 * here, and NONE of them may fall through to the stale-high "lock it in" branch.
 */
function refuse(reason, ...detail) {
  console.error(`${TAG} FAIL — ${reason}`);
  for (const d of detail) if (d) console.error(`  ${d}`);
  console.error(
    `  Refusing to report a count. A truncated tsc still prints a few diagnostics, ` +
      `and a low count reads as a huge IMPROVEMENT — this gate has twice been one ` +
      `step from telling an operator to lower the baseline to a number that was ` +
      `never true. Re-run it alone, on an unloaded machine.`,
  );
  process.exit(1);
}

const cfg = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
const baseline = cfg.baselineCount;

// VACUITY FLOOR, read from the ratchet file so the next session re-measures
// instead of re-arguing. A missing or non-numeric floor FAILS by design: an
// unfloored population cannot exist (same rule as reachability.json's `minima`).
const FILES_FLOOR = cfg.minima?.filesLoaded;
if (!Number.isInteger(FILES_FLOOR) || FILES_FLOOR <= 0) {
  refuse(
    `scripts/ratchets/tests-typecheck.json has no usable "minima.filesLoaded" floor ` +
      `(got ${JSON.stringify(FILES_FLOOR)}).`,
    `That floor is the only thing standing between a starved tsc and a wrecked baseline.`,
  );
}

let output = "";
let status = 0;
try {
  // Capture stdout on the CLEAN path too — the `Files:` stats block rides on
  // stdout, and a zero-error run has to clear the completeness floor as well.
  output = execFileSync("npx", TSC_ARGV, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  }) ?? "";
} catch (err) {
  // tsc exits non-zero when it reports errors — that is the expected path here.
  output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  status = err.status;
  // A KILLED tsc is not a clean tsc (unit 116).
  if (err.signal) {
    refuse(`tsc was killed by ${err.signal}.`);
  }
  if (!output.trim()) {
    refuse(`tsc produced no output at all. It could not run.`, String(err.message ?? err));
  }
  if (!TSC_KNOWN_GOOD_EXIT.has(status)) {
    refuse(
      `tsc exited with status ${String(status)}, outside the known-good set ` +
        `{${[...TSC_KNOWN_GOOD_EXIT].join(", ")}} (0 = no diagnostics, 2 = diagnostics reported).`,
      `Statuses outside that set mean the run ended some way other than "checked the project".`,
    );
  }
}

const allLines = output.split("\n");
const isDiagnostic = (l) => /error TS\d+/.test(l);
const lines = allLines.filter(isDiagnostic);
const count = lines.length;

for (const [re, why] of CRASH_SIGNATURES) {
  const hit = allLines.filter((l) => !isDiagnostic(l)).find((l) => re.test(l));
  if (hit) {
    refuse(`tsc output carries a crash signature — ${why}.`, `> ${hit.trim().slice(0, 200)}`);
  }
}

// A count is only believable if tsc actually loaded the project. When the config
// resolves nothing, tsc reports a couple of TS2688s and stops — which is exactly
// how the first measurement of this population came back as "12".
//
// The trailing `process.exit(1)` is unreachable (refuse() exits) and stays anyway,
// ADJACENT to the literal: tests/unit/testsAreTypeChecked.test.ts pins that an exit
// appears within 400 characters of this string, so the guard can never decay into a
// warning. It is also the insurance that pin was written for, if refuse() is ever
// made non-fatal.
if (/Cannot find type definition file for/.test(output)) {
  refuse(
    `tsc could not resolve the type libraries, so this count is meaningless.`,
    `Check "types" in tsconfig.tests.json.`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// THE COMPLETENESS SIGNAL. Not "how many errors" — "how much of the program did
// you load". A tsc starved mid-run loads a fraction of the files and emits a
// fraction of the diagnostics; the diagnostic count is indistinguishable from a
// genuine improvement, the file count is not.
// ---------------------------------------------------------------------------
const filesMatch = /^[ \t]*Files:[ \t]+(\d+)/m.exec(output);
if (!filesMatch) {
  refuse(
    `tsc printed no "Files:" line, so there is no evidence it finished loading the project.`,
    `--extendedDiagnostics is passed in TSC_ARGV above; if a tsc upgrade renamed or ` +
      `moved that stat, fix THIS parser — do not drop the check.`,
  );
}
const filesLoaded = Number(filesMatch[1]);
if (filesLoaded < FILES_FLOOR) {
  refuse(
    `tsc loaded only ${filesLoaded} files, under the floor of ${FILES_FLOOR} ` +
      `(minima.filesLoaded). The program is nowhere near complete, so the ` +
      `${count} diagnostic(s) it printed are a fragment, not a count.`,
    `If a real deletion wave genuinely took the suite under this floor, lower the ` +
      `floor in the same commit and name the wave — do NOT raise it to silence anything.`,
  );
}

// Unit 116's guard, kept: a non-zero exit that parsed zero diagnostics is still
// nonsense even if the file count somehow cleared. It is now the WEAKEST of the
// checks above rather than the only one.
if (status !== 0 && count === 0) {
  refuse(
    `tsc exited ${status} yet no "error TS" lines parsed. A non-zero exit with zero ` +
      `diagnostics means the run is not trustworthy (crash, OOM, or an output format change).`,
  );
}

if (MEASURE_ONLY) {
  console.log(
    `${TAG}:measure current=${count} baseline=${baseline} ` +
      `filesLoaded=${filesLoaded} (floor ${FILES_FLOOR})`,
  );
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
  console.log(
    `${TAG} PASS — ${count} test type errors (baseline ${baseline}), ` +
      `${filesLoaded} files loaded (floor ${FILES_FLOOR})`,
  );
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
    `  set "baselineCount": ${count} in scripts/ratchets/tests-typecheck.json.\n` +
    `  (This run cleared the completeness floor: ${filesLoaded} files loaded, floor ` +
    `${FILES_FLOOR}. If that number looks small for this repo, re-measure the floor\n` +
    `  before you touch the baseline.)`,
);
process.exit(1);
