/**
 * A gate that sweeps the repository must say so, or the suite kills it.
 *
 * Stripping comments correctly means parsing — ~2.7ms a file, ~5s for one pass
 * over server+shared+scripts, several times that on a two-core runner under the
 * coverage run's V8 instrumentation. 48 gates in this repo do exactly that.
 *
 * On 2026-09-06 eight of them crossed vitest's 30s default at once on `main`.
 * The fix given then had a population error of its own: the budget went to the
 * six tests that HAPPENED TO FAIL, not to the 48 that sweep. Four different ones
 * failed on the next push — a different four, for the same reason, because the
 * coverage run is slower than the plain run and picks different victims each time.
 *
 * A timeout is not a bug report. It is the suite deciding a gate has stopped
 * being worth waiting for, and a killed gate reports nothing about the thing it
 * guards. So the population is DERIVED here — imports the shared stripper AND
 * walks a directory — rather than enumerated, and every member must declare.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function walkTests(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (["node_modules", "fixtures", "__snapshots__"].includes(e)) continue;
    const abs = path.join(dir, e);
    if (statSync(abs).isDirectory()) walkTests(abs, out);
    else if (/\.test\.tsx?$/.test(e)) out.push(abs);
  }
  return out;
}

/** Imports the shared stripper AND walks a directory => it sweeps. */
function isRepoSweep(src: string): boolean {
  return (
    /from "\.\.\/helpers\/stripComments"/.test(src) &&
    /\breaddirSync\b|\bglobSync\b|\bwalk\w*\(/.test(src)
  );
}

const DECLARATION = "vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS })";

const testFiles = walkTests(path.join(ROOT, "tests"));
const sweeps = testFiles.filter((abs) => isRepoSweep(readFileSync(abs, "utf8")));

describe("every repo-wide sweep declares its budget", () => {
  it("the population is real and was derived, not typed out", () => {
    expect(testFiles.length, "the test walk found almost nothing").toBeGreaterThan(500);
    expect(
      sweeps.length,
      "no file was detected as a repo sweep — the detector has stopped matching " +
        "and every assertion below is vacuous",
    ).toBeGreaterThan(30);
    // Named members, so a rename or a helper-import refactor that drops one out
    // of the derived set fails HERE rather than shrinking the set in silence.
    const rel = sweeps.map((f) => path.relative(ROOT, f));
    for (const known of [
      "tests/unit/stripCommentsIsALexer.test.ts",
      "tests/unit/orgScopedDbAdoption.test.ts",
      "tests/unit/formatCentsIsCanonical.test.ts",
      "tests/unit/errorIsNotEmptiness.test.ts",
    ]) {
      expect(rel, `${known} sweeps the repo but fell out of the derived set`).toContain(known);
    }
  });

  it("each one declares REPO_SWEEP_TIMEOUT_MS", () => {
    const undeclared = sweeps
      .filter((abs) => !readFileSync(abs, "utf8").includes(DECLARATION))
      .map((f) => path.relative(ROOT, f));
    expect(
      undeclared,
      "these gates strip every file in the repository on the suite's 30s default. " +
        "Under the coverage run that is not enough, and the failure mode is a gate " +
        `that silently stops reporting. Add \`${DECLARATION};\` after the imports.`,
    ).toEqual([]);
  });

  it("the budget is actually larger than the suite default", () => {
    // A declaration that resolves to 30s or less would satisfy the rule above
    // and change nothing — the assertion has to be about the VALUE, not the
    // presence of the identifier.
    const helper = readFileSync(path.join(ROOT, "tests/helpers/stripComments.ts"), "utf8");
    const m = /REPO_SWEEP_TIMEOUT_MS\s*=\s*([0-9_]+)/.exec(helper);
    expect(m, "REPO_SWEEP_TIMEOUT_MS is no longer a literal in the helper").toBeTruthy();
    const budget = Number(m![1].replace(/_/g, ""));
    const config = readFileSync(path.join(ROOT, "vitest.config.ts"), "utf8");
    const dm = /testTimeout:\s*([0-9_]+)/.exec(config);
    const suiteDefault = Number((dm?.[1] ?? "30000").replace(/_/g, ""));
    expect(budget, `the sweep budget (${budget}ms) must exceed the suite default (${suiteDefault}ms)`)
      .toBeGreaterThan(suiteDefault);
  });
});
