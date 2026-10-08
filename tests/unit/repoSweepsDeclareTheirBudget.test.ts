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
import { stripComments } from "../helpers/stripComments";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { glob } from "tinyglobby";
import vitestConfig from "../../vitest.config";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const ROOT = process.cwd();

/**
 * THE POPULATION is every file vitest runs, not every file under tests/.
 *
 * vitest.config.ts includes every `.test.ts`, `.test.tsx` and `.test.mjs` file
 * in the repository; this walk used to read tests/ alone and only `.test.ts(x)`, so a
 * sweep living beside its subject — scripts/check-interactive-claims.test.mjs
 * spawns its gate over a scratch repo — was a member nobody could see. The
 * directories skipped here are the config's own `exclude` list plus `.git`.
 * Fixture and snapshot directories are NOT skipped: vitest runs a test file
 * wherever it sits, so a sweep under fixtures/ is still a sweep. The walk is
 * checked against vitest's own resolution of the config in the first test.
 */
const VITEST_EXCLUDED_DIRS = ["node_modules", "dist", "client", ".claude", ".git"];
function walkTests(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (VITEST_EXCLUDED_DIRS.includes(e.name)) continue;
    // Symlinks are not followed: the repo root holds a self-referencing link,
    // and a linked file is the same file vitest already reaches by its path.
    if (e.isSymbolicLink()) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walkTests(abs, out);
    else if (/\.test\.(?:tsx?|mjs)$/.test(e.name)) out.push(abs);
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
  return (
    /\breaddirSync\s*\(/.test(src) ||
    /\bglobSync\s*\(/.test(src) ||
    // A third way to enumerate the tree: shell out to `git ls-files`. Missed
    // until 2026-10-02, when soldLandIsWithdrawn.test.ts — 1,000+ server files
    // read in one test — hit the default 30 s under CI load on PR #318 and the
    // gate it is had no budget to spend. Five such sweeps were unseen.
    /\b(?:execSync|execFileSync|spawnSync)\s*\(\s*[`'"]git\s+ls-files\b/.test(src)
  );
}

/**
 * Sweeps whose filesystem walking happens inside an imported helper, so the
 * derived predicate above cannot see them. A short, named list — not a
 * suppression register: every entry must still DECLARE its budget, it is only
 * the DETECTION that is manual.
 */
const DELEGATED_SWEEPS = ["tests/unit/doctrineIngest.test.ts"];

/**
 * The fourth way to sweep: run a gate SCRIPT that sweeps, in a child process.
 *
 * Missed until 2026-10-07. tests/unit/reachabilityGate.test.ts runs
 * scripts/lint-reachability.mjs over the real repository three times; one of
 * those calls carried its own 120s budget and the other two inherited the 30s
 * default and timed out under load. The test itself never calls readdirSync —
 * the child does — so the predicate above, which reads only the test's own
 * source, could not see any of the ten tests of this shape.
 *
 * Derived, not listed: a test that imports node:child_process and names a file
 * under scripts/ whose source (or a relative module it imports) walks the tree.
 * Read comment-stripped, so a script NAMED in a header comment — every one of
 * these tests describes its gate in prose — is not a spawn of it.
 */
const SCRIPT_REF = [
  /["'`](?:\.\.\/)*(scripts\/[\w./-]+\.(?:mjs|cjs|js|ts))["'`]/g,
  /["'`]scripts["'`]\s*,\s*["'`]([\w.-]+\.(?:mjs|cjs|js|ts))["'`]/g,
];
const scriptSweeps = new Map<string, boolean>();
function scriptIsSweep(abs: string, depth = 0): boolean {
  const key = `${abs}#${depth}`;
  const cached = scriptSweeps.get(key);
  if (cached !== undefined) return cached;
  let verdict = false;
  if (existsSync(abs) && statSync(abs).isFile()) {
    const src = stripComments(readFileSync(abs, "utf8"));
    verdict = isRepoSweep(src);
    if (!verdict && depth === 0) {
      for (const m of src.matchAll(/\bfrom\s+["'](\.{1,2}\/[^"']+)["']|\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
        const rel = m[1] ?? m[2];
        const base = path.resolve(path.dirname(abs), rel);
        const candidates = [base, ...[".mjs", ".js", ".ts", ".cjs"].map((x) => base + x)];
        if (candidates.some((c) => scriptIsSweep(c, depth + 1))) { verdict = true; break; }
      }
    }
  }
  scriptSweeps.set(key, verdict);
  return verdict;
}
function spawnsRepoSweep(rawSrc: string, testAbs: string): boolean {
  const src = stripComments(rawSrc);
  if (!/["'](?:node:)?child_process["']/.test(src)) return false;
  const named = new Set<string>();
  for (const re of SCRIPT_REF) for (const m of src.matchAll(re)) {
    const ref = m[1];
    named.add(path.join(ROOT, ref.startsWith("scripts/") ? ref : path.join("scripts", ref)));
  }
  // A test living in scripts/ reaches its gate by a sibling path.
  if (path.dirname(testAbs) === path.join(ROOT, "scripts")) {
    for (const m of src.matchAll(/["'`](?:\.\/)?([\w.-]+\.(?:mjs|cjs|js))["'`]/g)) named.add(path.join(ROOT, "scripts", m[1]));
  }
  return [...named].some((abs) => scriptIsSweep(abs));
}

const DECLARATION = "vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS })";

const testFiles = walkTests(ROOT);
const spawnedSweeps = testFiles.filter((abs) => spawnsRepoSweep(readFileSync(abs, "utf8"), abs));
const sweeps = [
  ...testFiles.filter((abs) => isRepoSweep(readFileSync(abs, "utf8"))),
  ...spawnedSweeps,
  ...DELEGATED_SWEEPS.map((rel) => path.join(ROOT, rel)),
].filter((abs, i, all) => all.indexOf(abs) === i);

describe("every repo-wide sweep declares its budget", () => {
  it("the walk reads exactly the files vitest runs", async () => {
    // The same call vitest makes to find test files (tinyglobby, the config's
    // own include/exclude, dot files on, no directory expansion). If the walk
    // above skips a directory vitest does not — or misses an extension vitest
    // includes — the two sets differ and this fails, naming the files.
    const t = (vitestConfig as { test?: { include?: string[]; exclude?: string[] } }).test ?? {};
    expect(t.include?.length, "vitest.config.ts declares no include").toBeGreaterThan(0);
    const vitestFiles = await glob(t.include!, { dot: true, cwd: ROOT, ignore: t.exclude ?? [], expandDirectories: false });
    const walked = new Set(testFiles.map((f) => path.relative(ROOT, f)));
    const resolved = new Set(vitestFiles);
    expect([...resolved].filter((f) => !walked.has(f)).sort(), "vitest runs these; the walk never reads them").toEqual([]);
    expect([...walked].filter((f) => !resolved.has(f)).sort(), "the walk reads these; vitest does not run them").toEqual([]);
  });

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
      // Enumerates with `git ls-files`, the shape the predicate learned last.
      "tests/unit/soldLandIsWithdrawn.test.ts",
      // Two more that walk a source root without touching the stripper at all —
      // the half of the population the old predicate could not express.
      "tests/unit/routeManifest.test.ts",
      "tests/unit/schemaDrift.test.ts",
      // Sweeps by spawning a gate script over the real repository — the shape
      // that timed out with no budget before the child-process predicate.
      "tests/unit/reachabilityGate.test.ts",
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

  it("a test that spawns a sweeping script is a sweep; one that only names it is not", () => {
    const at = path.join(ROOT, "tests/unit/fixture.test.ts");
    const spawn = 'import { spawnSync } from "node:child_process";\n';
    // scripts/lint-reachability.mjs walks the tree itself.
    expect(spawnsRepoSweep(spawn + 'const L = join(ROOT, "scripts", "lint-reachability.mjs"); spawnSync("node", [L]);', at)).toBe(true);
    expect(spawnsRepoSweep(spawn + 'spawnSync("node", ["scripts/lint-reachability.mjs"]);', at)).toBe(true);
    // Named only in a comment: prose about a gate is not a run of it.
    expect(spawnsRepoSweep(spawn + '// runs scripts/lint-reachability.mjs\nspawnSync("echo", []);', at)).toBe(false);
    // Names the script but never reaches child_process.
    expect(spawnsRepoSweep('const L = "scripts/lint-reachability.mjs";', at)).toBe(false);
    // A script that does not walk the tree is not a sweep to spawn.
    expect(spawnsRepoSweep(spawn + 'spawnSync("node", ["scripts/does-not-exist.mjs"]);', at)).toBe(false);
    // Population floor for this shape, so a predicate that stops matching
    // fails here instead of shrinking the set to the readdirSync members.
    expect(spawnedSweeps.length, "the child-process predicate matched almost nothing").toBeGreaterThanOrEqual(8);
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
