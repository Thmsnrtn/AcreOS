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
 * guards. So the population is DERIVED here rather than enumerated, and every
 * member must declare.
 *
 * CORRECTED 2026-09-06, after this gate was green over the defect it names.
 * The population predicate was "imports the shared stripper AND walks a
 * directory". Both halves were wrong in the same direction:
 *
 *   · The stripper clause keyed on the SYNTAX of the import. Sweeps that reach
 *     for it with `await import("../helpers/stripComments")` inside the test
 *     body — which is how tests/unit/transactionsAreRealTransactions.test.ts
 *     does it — were invisible. That test walked the whole repository on the
 *     30s default and turned `main` red the first time the coverage run was
 *     slow enough to notice.
 *   · The stripper clause should not have existed at all. What costs time is
 *     WALKING THE TREE; stripping is one of several things a sweep might then
 *     do with the bytes. Keying on the helper meant the rule described the
 *     implementation of 52 sweeps rather than the cost shared by 117.
 *
 * Measured at the correction: 52 members before, 98 after (97 derived + 1
 * registered), 49 of which had never declared a budget. Every one was a gate
 * the coverage run was free to kill silently. A first attempt at the widening
 * reported 119 — that number was itself inflated by mocks and by SQL-tree
 * walkers, and the note on isRepoSweep below records how.
 */

import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


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

/**
 * Enumerates the filesystem => it sweeps. Keyed on the COST, not on which
 * helper the sweep happens to use — that was the error being corrected.
 *
 * Two narrower and two wider predicates were tried and rejected, and the
 * reasons are the useful part:
 *
 *   · "imports the stripper AND walks" (the original) missed every sweep that
 *     reaches the stripper dynamically, and every sweep that strips nothing.
 *   · `\breaddirSync\b` — the bare identifier — counts `readdirSync: vi.fn()`,
 *     which is a test MOCKING the filesystem, i.e. the opposite of sweeping it.
 *     Four SCP tests entered the population that way. The mention-trap, inside
 *     the gate written to teach the population lesson.
 *   · `\bwalk\w*\(` counts `walk(` — and sixteen tenancy tests define a local
 *     `walk()` over a DRIZZLE SQL CHUNK TREE, which never touches disk. Inflating
 *     the population with those would have made this gate's own headline number
 *     a fiction, which is the failure it exists to prevent.
 *
 * Requiring the CALL (`readdirSync(`) excludes the mock and the AST walker
 * both, because neither one calls it.
 *
 * KNOWN BLIND SPOT, recorded rather than papered over: a test that delegates
 * its walking to an imported helper — doctrineIngest.test.ts exercises the
 * server's own recursive *.md walker — enumerates the filesystem without
 * naming `readdirSync` itself. No static predicate reaches that, so such tests
 * are registered by name below instead of pretending to be derived.
 */
function isRepoSweep(src: string): boolean {
  return /\breaddirSync\s*\(/.test(src) || /\bglobSync\s*\(/.test(src);
}

/**
 * Sweeps whose filesystem walking happens inside an imported helper, so the
 * derived predicate above cannot see them. A short, named list — not a
 * suppression register: every entry must still DECLARE its budget, it is only
 * the DETECTION that is manual.
 */
const DELEGATED_SWEEPS = ["tests/unit/doctrineIngest.test.ts"];

const DECLARATION = "vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS })";

const testFiles = walkTests(path.join(ROOT, "tests"));
const sweeps = [
  ...testFiles.filter((abs) => isRepoSweep(readFileSync(abs, "utf8"))),
  ...DELEGATED_SWEEPS.map((rel) => path.join(ROOT, rel)),
].filter((abs, i, all) => all.indexOf(abs) === i);

describe("every repo-wide sweep declares its budget", () => {
  it("the population is real and was derived, not typed out", () => {
    expect(testFiles.length, "the test walk found almost nothing").toBeGreaterThan(500);
    expect(
      sweeps.length,
      "no file was detected as a repo sweep — the detector has stopped matching " +
        "and every assertion below is vacuous",
    ).toBeGreaterThan(90);
    // Named members, so a rename or a helper-import refactor that drops one out
    // of the derived set fails HERE rather than shrinking the set in silence.
    const rel = sweeps.map((f) => path.relative(ROOT, f));
    for (const known of [
      "tests/unit/stripCommentsIsALexer.test.ts",
      "tests/unit/orgScopedDbAdoption.test.ts",
      "tests/unit/formatCentsIsCanonical.test.ts",
      "tests/unit/errorIsNotEmptiness.test.ts",
      // The member whose absence turned main red: it walks the repo and reaches
      // the stripper through a DYNAMIC import, so the old syntax-keyed predicate
      // never saw it. Named so the widening cannot silently narrow again.
      "tests/unit/transactionsAreRealTransactions.test.ts",
      // Two more that walk a source root without touching the stripper at all —
      // the half of the population the old predicate could not express.
      "tests/unit/routeManifest.test.ts",
      "tests/unit/schemaDrift.test.ts",
    ]) {
      expect(rel, `${known} sweeps the repo but fell out of the derived set`).toContain(known);
    }
  });

  it("every registered delegated sweep still exists", () => {
    // A register naming a deleted file silently shrinks the population by one
    // and reads exactly like a clean run.
    for (const rel of DELEGATED_SWEEPS) {
      expect(
        testFiles.map((f) => path.relative(ROOT, f)),
        `${rel} is registered as a delegated sweep but no longer exists`,
      ).toContain(rel);
    }
  });

  it("the derived predicate excludes mocks and non-filesystem walkers", () => {
    // Vacuity canaries for the two inflations the widening had to survive. If
    // either shape starts matching again, the population number this gate
    // reports stops being true — and a number nobody can trust is worse than
    // no number.
    expect(isRepoSweep("vi.mock('node:fs', () => ({ readdirSync: vi.fn() }))")).toBe(false);
    expect(isRepoSweep("const walk = (n: any) => n.queryChunks.forEach(walk);")).toBe(false);
    expect(isRepoSweep('const files = readdirSync(dir);')).toBe(true);
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
    const helper = readFileSync(path.join(ROOT, "tests/helpers/sweepBudget.ts"), "utf8");
    const m = /REPO_SWEEP_TIMEOUT_MS\s*=\s*([0-9_]+)/.exec(helper);
    expect(m, "REPO_SWEEP_TIMEOUT_MS is no longer a literal in tests/helpers/sweepBudget.ts").toBeTruthy();
    // One definition, so this assertion cannot be reading a stale copy while
    // the sweeps import a different number from somewhere else.
    const stripper = readFileSync(path.join(ROOT, "tests/helpers/stripComments.ts"), "utf8");
    expect(
      /REPO_SWEEP_TIMEOUT_MS\s*=\s*[0-9_]+/.test(stripper),
      "the budget is defined in two places; sweeps importing from stripComments " +
        "would then be governed by a number this test never reads",
    ).toBe(false);
    const budget = Number(m![1].replace(/_/g, ""));
    const config = readFileSync(path.join(ROOT, "vitest.config.ts"), "utf8");
    const dm = /testTimeout:\s*([0-9_]+)/.exec(config);
    const suiteDefault = Number((dm?.[1] ?? "30000").replace(/_/g, ""));
    expect(budget, `the sweep budget (${budget}ms) must exceed the suite default (${suiteDefault}ms)`)
      .toBeGreaterThan(suiteDefault);
  });
});
