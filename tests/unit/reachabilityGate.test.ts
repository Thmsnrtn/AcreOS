/**
 * Reachability-gate tests (2026-08-01).
 *
 * scripts/lint-reachability.mjs is the CI answer to CLAUDE.md's "built but
 * unwired" — the repo's single most common defect (services/lateFees with zero
 * callers, taxSaleAuctions with zero insert paths, routes-contract-chain.ts
 * never registered). A linter that finds dead code is only useful if it is
 * TRUSTED, and it is only trusted if it is itself tested. Same pattern as
 * voiceLinter.test.ts / lintCssHover.test.ts / lintPageHex.test.ts: drive the
 * real script over synthetic fixture trees via `--root`, and assert on exit
 * code + output.
 *
 * The properties locked in here:
 *   1. An export whose only consumer is its own TEST file is flagged.
 *   2. An export used in production code is NOT flagged (no false positive).
 *   3. A dynamic `await import(...)` counts as a use — the linter refuses to
 *      assert deadness it cannot see, and says so.
 *   4. An allowlisted entry is skipped AND its reason is printed.
 *   5. The ratchet FAILS on an increase and FAILS stale-high on a decrease.
 *   6. Tables with no writer / no reader are reported separately; route files
 *      never mounted are reported.
 *   7. The failure text names file, symbol, and what to do — including DELETE.
 *   8. The real repo passes at its own committed baseline.
 *   9. The VACUITY GUARD bites — in BOTH of its directions (a population below
 *      its declared floor, and a floor that was never declared at all), and it
 *      bites over a FIXTURE tree exactly as it does over the real repo.
 *
 * ON (9), because it is the reason this file was rewritten. The guard exists
 * because the pre-guard linter, run over an EMPTY tree, printed "Good news: 1405
 * unreachable item(s) were wired or deleted. Lock it in — set
 * baselines.unreachedExports: 0": a totally blind scan instructing the operator
 * to re-baseline the gate to zero. Every count this linter prints is "how many
 * bad things did I find", so a scan that stops seeing FILES reports zero and
 * reads as a clean bill of health unless the POPULATIONS are floored too.
 *
 * The fixtures below therefore declare their own fixture-sized `minima` rather
 * than opting out of the guard. That is not a formality to get the tests green:
 * a fixture tree is the *most* vacuity-prone tree there is (two files, a
 * throwaway tmpdir, a `--root` the walk could silently miss), so an unfloored
 * fixture run is precisely the scan whose zeros mean nothing. If a future change
 * makes these tests fail, the fix is to correct the floors — never to delete
 * `minima` from the fixture config.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const LINTER = join(REPO_ROOT, "scripts", "lint-reachability.mjs");

/**
 * spawnSync, NOT execFileSync, and the difference is load-bearing.
 *
 * execFileSync returns stdout and THROWS on a non-zero exit — so stderr was
 * captured only on the failure path, and every exit-0 run in this file saw
 * stdout alone. That made each `expect(out).not.toContain(…)` on a passing run
 * vacuously true: the linter writes every warning with `console.error`, so
 * anything it complained about while still exiting 0 was invisible to the
 * assertion claiming it was absent.
 *
 * The vacuity guard is exactly that shape under `--measure` — it REPORTS a blind
 * scan on stderr and deliberately does not gate — so the test proving it still
 * speaks up could not see the thing it was asserting on. Merging both streams on
 * both paths is what makes the negative assertions here mean anything.
 */
function run(...args: string[]): { code: number; out: string } {
  const r = spawnSync("node", [LINTER, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024, // --report over the real repo prints thousands of findings
  });
  if (r.error) throw r.error;
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/**
 * A fixture names only the families it is ABOUT; the rest are zeroed from the
 * real config. Kept as an open record rather than a closed union for the same
 * reason the defaults are derived — a closed list has to be edited every time
 * the gate grows a family, which is what broke four fixtures when
 * `module-orphans` landed.
 */
type Baselines = Record<string, number>;
type Allow = { kind: string; id: string; reason: string };

type RealRatchet = {
  baselines: Record<string, number>;
  minima?: Record<string, number>;
  allowlist: Allow[];
};

let realRatchetCache: RealRatchet | null = null;
function realRatchet(): RealRatchet {
  if (realRatchetCache === null) {
    realRatchetCache = JSON.parse(
      readFileSync(join(REPO_ROOT, "scripts/ratchets/reachability.json"), "utf8"),
    ) as RealRatchet;
  }
  return realRatchetCache;
}

/**
 * Every family the REAL ratchet config declares, zeroed.
 *
 * Reading the shipped baselines' keys means a fixture automatically covers a
 * family added later; the values are irrelevant here, only the key set is.
 */
function zeroedFamilies(): Record<string, number> {
  const keys = Object.keys(realRatchet().baselines);
  if (keys.length === 0) throw new Error("no families in the real ratchet config — harness broken");
  return Object.fromEntries(keys.map((k) => [k, 0]));
}

/**
 * FIXTURE-SIZED FLOORS for the linter's vacuity guard.
 *
 * The guard floors the four SCAN POPULATIONS (not the finding counts) and fails
 * the run if a floor is BREACHED **or MISSING** — see the guard block in
 * lint-reachability.mjs, and the ratchet file's own note: "A `--root` fixture
 * run must pass its own `--ratchet` with fixture-sized minima."
 *
 * These floors are deliberately small, because the trees below are two or five
 * files. They are NOT an exemption: a fixture is floored on exactly the same
 * terms as the repo, and `describe("… vacuity guard")` at the bottom of this
 * file proves the guard still bites at fixture scale in both directions. Where a
 * fixture can carry a sharper floor it passes one (see the tables/routes
 * fixture, which floors pgTables and routeCandidateFiles at 2 against an actual
 * 3 apiece) — a floor of 0 is unbreachable, so it buys nothing but the
 * key's presence, and presence is the half of the guard that catches an
 * unfloored population.
 *
 * Unknown populations default to 0, derived from the real config's key set for
 * the same reason `zeroedFamilies()` derives the baselines: a population added
 * to the guard later must not break every unrelated fixture at once. Only the
 * populations named here get a floor above the derived zero.
 */
const FIXTURE_FLOORS: Record<string, number> = {
  productionFiles: 1,
  exportFiles: 1,
  pgTables: 0,
  routeCandidateFiles: 0,
};

function fixtureMinima(overrides: Record<string, number> = {}): Record<string, number> {
  const keys = Object.keys(realRatchet().minima ?? {});
  if (keys.length === 0) {
    throw new Error(
      'no "minima" in the real ratchet config — the vacuity guard is unfloored on the real repo',
    );
  }
  return {
    ...Object.fromEntries(keys.map((k) => [k, 0])),
    ...FIXTURE_FLOORS,
    ...overrides,
  };
}

/** Build a miniature repo under `dir` and return a runner bound to it. */
function fixture(dir: string) {
  const write = (relPath: string, body: string) => {
    const abs = join(dir, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  const ratchet = (
    baselines: Baselines,
    allowlist: Allow[] = [],
    minimaOverrides: Record<string, number> = {},
  ) =>
    write(
      "scripts/ratchets/reachability.json",
      JSON.stringify({
        name: "reachability",
        mode: "external",
        evaluator: "scripts/lint-reachability.mjs",
        direction: "down",
        // Every family defaults to 0 and a fixture overrides only what it is
        // about. The gate FAILS a family with no baseline, so a new family
        // otherwise breaks every unrelated fixture at once — a fixture should
        // fail because the behaviour it pins changed, not because the gate grew
        // a family it never mentioned.
        //
        // DERIVED from the real config's keys, not a hardcoded list. It WAS a
        // hardcoded list of five, added for exactly this reason when
        // `opaque-exports` landed — and it then failed to survive the sixth
        // family, `module-orphans`, four fixtures at a time. A defaults list that
        // has to be edited whenever a family is added is the same defect it was
        // introduced to fix.
        baselines: { ...zeroedFamilies(), ...baselines },
        // The vacuity guard floors the SCAN POPULATIONS and fails on a missing
        // floor, so a fixture must declare its own. Same derive-don't-hardcode
        // discipline as `baselines` above, and the same reason: when the guard
        // grew from the header prose into an enforced block, EVERY fixture in
        // this file started exiting 1 before reaching its assertion.
        minima: fixtureMinima(minimaOverrides),
        allowlist,
      }),
    );
  return { write, ratchet, run: (...a: string[]) => run("--root", dir, ...a) };
}

describe("lint-reachability — export family", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "reach-exports-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("flags an export whose only consumer is its own test, and not one used in production", () => {
    const f = fixture(dir);
    // deadService: exercised ONLY by a test file — the lateFees case.
    f.write(
      "server/services/deadService.ts",
      "export function assessLateFee(x: number) { return x * 0.05; }\n",
    );
    f.write(
      "tests/unit/deadService.test.ts",
      'import { assessLateFee } from "../../server/services/deadService";\n' +
        "assessLateFee(1);\n",
    );
    // liveService: imported and called by a real route.
    f.write(
      "server/services/liveService.ts",
      "export function computePayoff(x: number) { return x; }\n",
    );
    f.write(
      "server/routes-live.ts",
      'import { computePayoff } from "./services/liveService";\n' +
        "export const handler = () => computePayoff(2);\n",
    );
    f.ratchet({
      unreachedExports: 0,
      tablesNoWriter: 0,
      tablesNoReader: 0,
      unregisteredRoutes: 0,
    });

    const { code, out } = f.run();
    expect(code).toBe(1);
    // The dead one is named, with file, symbol and line.
    expect(out).toContain("server/services/deadService.ts");
    expect(out).toContain("assessLateFee");
    // The live one is NOT accused — that would be the dangerous failure mode.
    expect(out).not.toContain("computePayoff");
    // And the remedy leads with deletion.
    expect(out).toMatch(/DELETE it/);
    expect(out).toContain("ALLOWLIST");
    expect(out).toContain("smaller codebase");
  });

  it("counts a dynamic `await import(...)` as a use and says it cannot see through it", () => {
    const d2 = mkdtempSync(join(tmpdir(), "reach-dynamic-"));
    try {
      const f = fixture(d2);
      f.write(
        "server/services/lazyService.ts",
        "export function runLazily() { return 1; }\n",
      );
      // The ONLY reference is a NAMESPACE-BINDING dynamic import, with the symbol
      // pulled off the namespace object at runtime. This is the shape that still
      // confers opacity after the 2026-08-14 narrowing, and the reason it does is
      // visible right here: the call site genuinely does not say which export it
      // touches — the name is a runtime string.
      f.write(
        "server/routes-lazy.ts",
        "export async function handler(name: string) {\n" +
          '  const mod = await import("./services/lazyService");\n' +
          "  return (mod as Record<string, () => number>)[name]();\n" +
          "}\n",
      );
      // opaqueExports is 1 here, and that IS the assertion: this fixture is the
      // canonical worked example of the blind spot, so the number the gate now
      // carries for it should be exactly one.
      f.ratchet({ opaqueExports: 1 });

      const { code, out } = f.run();
      expect(code).toBe(0);
      expect(out).toContain("unreached-exports: PASS — 0");
      // It is reported as opaque, explicitly NOT asserted dead.
      expect(out).toContain("NOT asserted dead");
      expect(out).toContain("runLazily");
      // …and, since this change, COUNTED rather than only narrated. The prose
      // above was true and ungated for as long as the family existed.
      expect(out).toContain("opaque-exports: PASS — 1");
    } finally {
      rmSync(d2, { recursive: true, force: true });
    }
  });

  it("a DESTRUCTURED dynamic import confers no opacity, but still counts as an import", () => {
    // The 2026-08-14 narrowing (founder picker, "Approve the narrowing"), pinned
    // behaviourally rather than structurally: the real script over a fixture
    // tree, asserting all three outcomes at once.
    //
    // `const { runLazily } = await import(…)` binds a bare identifier the usage
    // tokeniser already sees, so there is nothing hidden and nothing to exempt.
    // Before the narrowing this fixture produced opaque:2 / unreached:0 — the
    // sibling was laundered by the destructured one, which is how aiRouter.ts
    // shielded ten exports occurring nowhere else in production.
    const d = mkdtempSync(join(tmpdir(), "reach-destructured-"));
    try {
      const f = fixture(d);
      f.write(
        "server/services/lazyService.ts",
        "export function runLazily() { return 1; }\n" +
          "export function neverCalledSibling() { return 2; }\n",
      );
      f.write(
        "server/routes-lazy.ts",
        "export async function handler() {\n" +
          '  const { runLazily } = await import("./services/lazyService");\n' +
          "  return runLazily();\n" +
          "}\n",
      );
      f.ratchet({ unreachedExports: 1 });

      const { code, out } = f.run("--report");
      expect(code).toBe(0);
      // 1. The sibling is now VISIBLE as unreached instead of hidden.
      expect(out).toContain("unreached-exports: PASS — 1");
      expect(out).toContain("neverCalledSibling");
      // 2. The destructured symbol is NOT accused — the dangerous direction.
      expect(out).not.toContain("runLazily —");
      // 3. Nothing is opaque: the call site says which export it touches.
      expect(out).toContain("opaque-exports: PASS — 0");
      // 4. THE TRAP. The module IS imported, so it is not an orphan. The first
      //    implementation skipped destructured imports out of the import
      //    registries too, and 172 real modules were one commit away from being
      //    reported as "nothing imports this file at all".
      expect(
        out,
        "a destructure-imported module is being reported as a module orphan — " +
          "the narrowing must skip only the OPACITY registries, never the " +
          "import ones",
      ).toContain("module-orphans: PASS — 0");
      expect(out).not.toContain("MODULE ORPHAN");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("the module-orphan half of that is not vacuous — drop the import and it IS an orphan", () => {
    // Guard for the assertion above: `module-orphans: PASS — 0` proves nothing
    // unless the same module WOULD be reported when genuinely unimported.
    const d = mkdtempSync(join(tmpdir(), "reach-destructured-neg-"));
    try {
      const f = fixture(d);
      f.write(
        "server/services/lazyService.ts",
        "export function runLazily() { return 1; }\n" +
          "export function neverCalledSibling() { return 2; }\n",
      );
      f.write("server/routes-lazy.ts", "export async function handler() { return 1; }\n");
      f.ratchet({ unreachedExports: 2, moduleOrphans: 1 });

      const { code, out } = f.run("--report");
      expect(code).toBe(0);
      expect(out).toContain("module-orphans: PASS — 1");
      expect(out).toContain("MODULE ORPHAN");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("`.then(({ x }) => …)` destructuring is recognised too", () => {
    // The other shape the codebase actually uses. A narrowing that only handled
    // `const { x } = await import(…)` would leave these modules opaque for no
    // reason — the binding is just as visible to the tokeniser.
    const d = mkdtempSync(join(tmpdir(), "reach-then-destructured-"));
    try {
      const f = fixture(d);
      f.write(
        "server/services/lazyService.ts",
        "export function runLazily() { return 1; }\n" +
          "export function neverCalledSibling() { return 2; }\n",
      );
      f.write(
        "server/routes-lazy.ts",
        "export function handler() {\n" +
          '  return import("./services/lazyService").then(({ runLazily }) => runLazily());\n' +
          "}\n",
      );
      f.ratchet({ unreachedExports: 1 });

      const { code, out } = f.run();
      expect(code).toBe(0);
      expect(out).toContain("unreached-exports: PASS — 1");
      expect(out).toContain("opaque-exports: PASS — 0");
      expect(out).toContain("module-orphans: PASS — 0");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("does not count a barrel re-export as a use", () => {
    const d3 = mkdtempSync(join(tmpdir(), "reach-barrel-"));
    try {
      const f = fixture(d3);
      f.write(
        "server/services/orphan/impl.ts",
        "export function neverCalled() { return 1; }\n",
      );
      // Forwarding a dead symbol is the same dead symbol with extra steps.
      f.write("server/services/orphan/index.ts", 'export { neverCalled } from "./impl";\n');
      f.ratchet({
        unreachedExports: 0,
        tablesNoWriter: 0,
        tablesNoReader: 0,
        unregisteredRoutes: 0,
      });

      const { code, out } = f.run();
      expect(code).toBe(1);
      expect(out).toContain("neverCalled");
    } finally {
      rmSync(d3, { recursive: true, force: true });
    }
  });
});

describe("lint-reachability — a comment is not code", () => {
  // ── THE DEFECT, EXACTLY AS IT SHIPPED ─────────────────────────────────────
  // Three services (atlasContextInjector, communicationDeduplication,
  // userAiCostControls) each opened with a docblock showing callers how to use
  // them. Nothing anywhere loaded any of the three, and this gate reported all
  // three as imported — because the scanner read the USAGE EXAMPLE inside the
  // module's own header as the module importing itself. The gate whose whole
  // job is finding built-and-unwired code was certifying it wired on the
  // strength of the sentence explaining how one day it might be.
  //
  // These fixtures mutate the thing the gate GOVERNS — where a specifier sits,
  // code or prose — not a symbol it mentions. Both directions are pinned: a
  // comment must confer nothing, and real code beside a comment must still
  // confer everything, because a stripper that over-reaches would silently
  // widen every finding in the repo.

  it("a usage example in a module's own docblock does not import it", () => {
    const d = mkdtempSync(join(tmpdir(), "reach-comment-selfimport-"));
    try {
      const f = fixture(d);
      // Verbatim shape of the three real headers.
      f.write(
        "server/services/deadService.ts",
        "/**\n" +
          " * Usage:\n" +
          ' *   import { commDedup } from "./deadService";\n' +
          " */\n" +
          "export const commDedup = { isDuplicate: () => false };\n",
      );
      f.write("server/routes-live.ts", "export function handler() { return 1; }\n");
      f.ratchet({ unreachedExports: 1, moduleOrphans: 1 });

      const { code, out } = f.run("--report");
      expect(code).toBe(0);
      expect(
        out,
        "a module whose only importer is its own docblock is still a module " +
          "orphan — this is the exact shape that hid three dead services",
      ).toContain("module-orphans: PASS — 1");
      expect(out).toContain("MODULE ORPHAN");
      expect(out).toContain("commDedup");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("a dynamic-import specifier in a comment confers no opacity", () => {
    // The bigger blast radius of the two: one sentence exempts EVERY export of
    // the named module from the unreached count. Found when a comment written
    // to explain that a dynamic import had been deleted kept the deletion from
    // taking effect.
    const d = mkdtempSync(join(tmpdir(), "reach-comment-dynimport-"));
    try {
      const f = fixture(d);
      f.write(
        "server/services/lazyService.ts",
        "export function runLazily() { return 1; }\n" +
          "export function neverCalledSibling() { return 2; }\n",
      );
      f.write(
        "server/routes-lazy.ts",
        "export function handler() {\n" +
          '  // An earlier draft did `await import("./services/lazyService")`\n' +
          "  // and discarded the result. It is gone.\n" +
          "  return 1;\n" +
          "}\n",
      );
      f.ratchet({ unreachedExports: 2, moduleOrphans: 1 });

      const { code, out } = f.run("--report");
      expect(code).toBe(0);
      expect(
        out,
        "a dynamic import mentioned in prose is exempting a whole module",
      ).toContain("opaque-exports: PASS — 0");
      expect(out).toContain("unreached-exports: PASS — 2");
      expect(out).toContain("runLazily");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("still sees a REAL import sitting beside a comment about it", () => {
    // The negative direction. Over-stripping would report imported modules as
    // orphans and reached exports as dead, at repo scale, which is the failure
    // mode that gets a gate deleted rather than fixed.
    const d = mkdtempSync(join(tmpdir(), "reach-comment-negative-"));
    try {
      const f = fixture(d);
      f.write(
        "server/services/liveService.ts",
        "export function runLive() { return 1; }\n",
      );
      f.write(
        "server/routes-live.ts",
        "// We import runLive from ./services/liveService below.\n" +
          '/* import { runLive } from "./services/liveService"; -- old form */\n' +
          'import { runLive } from "./services/liveService";\n' +
          "export function handler() { return runLive(); }\n",
      );
      f.ratchet({});

      const { code, out } = f.run("--report");
      expect(code).toBe(0);
      expect(out).toContain("unreached-exports: PASS — 0");
      expect(out).toContain("module-orphans: PASS — 0");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("does not mistake `//` inside a string for a comment", () => {
    // The way a naive strip breaks the scan it feeds. Every specifier this gate
    // reads lives in a string literal, and URLs live there too; eating from the
    // first `//` would blind the scanner to the import on the same line.
    const d = mkdtempSync(join(tmpdir(), "reach-comment-url-"));
    try {
      const f = fixture(d);
      f.write("server/services/liveService.ts", "export function runLive() { return 1; }\n");
      f.write(
        "server/routes-live.ts",
        'const DOCS = "https://example.com/a"; import { runLive } from "./services/liveService";\n' +
          "export function handler() { return [DOCS, runLive()]; }\n",
      );
      f.ratchet({});

      const { code, out } = f.run("--report");
      expect(code).toBe(0);
      expect(
        out,
        "the stripper ate a URL's `//` and took the import on that line with it",
      ).toContain("module-orphans: PASS — 0");
      expect(out).toContain("unreached-exports: PASS — 0");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("prints a FULL comment-stripper self-test on every run", () => {
    // A stripper that returned "" would empty both import scans and turn the
    // whole gate green, so its correctness is reported, not merely assumed.
    const { out } = run();
    const m = /comment-stripper self-test: (\d+)\/(\d+) correct/.exec(out);
    expect(m, `the self-test line is gone:\n${out}`).not.toBeNull();
    expect(Number(m![1]), "the comment stripper is failing its own cases").toBe(
      Number(m![2]),
    );
    expect(
      Number(m![2]),
      "the stripper self-test lost its cases — an empty case list passes trivially",
    ).toBeGreaterThanOrEqual(8);
  }, 120_000);
});

describe("lint-reachability — allowlist", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "reach-allow-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const REASON =
    "Public API surface, deliberately exported ahead of its first consumer per the staged rollout.";

  it("skips an allowlisted entry AND prints its reason", () => {
    const f = fixture(dir);
    f.write(
      "server/services/staged.ts",
      "export function futureSeam() { return 1; }\n",
    );
    f.ratchet(
      {
        unreachedExports: 0,
        tablesNoWriter: 0,
        tablesNoReader: 0,
        unregisteredRoutes: 0,
      },
      [{ kind: "export", id: "server/services/staged.ts::futureSeam", reason: REASON }],
    );

    const { code, out } = f.run();
    expect(code).toBe(0);
    expect(out).toContain("unreached-exports: PASS — 0");
    // The reason is SURFACED, not silently honoured.
    expect(out).toContain("allowlist — 1 skipped, with reasons");
    expect(out).toContain("export:server/services/staged.ts::futureSeam");
    expect(out).toContain(REASON);
  });

  it("refuses to run when an allowlist entry has no real reason", () => {
    const d2 = mkdtempSync(join(tmpdir(), "reach-noreason-"));
    try {
      const f = fixture(d2);
      f.write("server/services/staged.ts", "export function futureSeam() { return 1; }\n");
      f.ratchet(
        {
          unreachedExports: 0,
          tablesNoWriter: 0,
          tablesNoReader: 0,
          unregisteredRoutes: 0,
        },
        [{ kind: "export", id: "server/services/staged.ts::futureSeam", reason: "meh" }],
      );

      const { code, out } = f.run();
      expect(code).toBe(1);
      expect(out).toContain('has no real "reason"');
      expect(out).toContain("DELETE, not allowlist");
    } finally {
      rmSync(d2, { recursive: true, force: true });
    }
  });

  it("fails on a STALE allowlist entry once the thing is reached again", () => {
    const d3 = mkdtempSync(join(tmpdir(), "reach-stale-allow-"));
    try {
      const f = fixture(d3);
      f.write("server/services/staged.ts", "export function futureSeam() { return 1; }\n");
      f.write(
        "server/routes-seam.ts",
        'import { futureSeam } from "./services/staged";\nexport const h = () => futureSeam();\n',
      );
      f.ratchet(
        {
          unreachedExports: 0,
          tablesNoWriter: 0,
          tablesNoReader: 0,
          unregisteredRoutes: 0,
        },
        [{ kind: "export", id: "server/services/staged.ts::futureSeam", reason: REASON }],
      );

      const { code, out } = f.run();
      expect(code).toBe(1);
      expect(out).toContain("stale allowlist");
      expect(out).toContain("export:server/services/staged.ts::futureSeam");
    } finally {
      rmSync(d3, { recursive: true, force: true });
    }
  });
});

describe("lint-reachability — ratchet semantics", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "reach-ratchet-"));
    const f = fixture(dir);
    f.write("server/services/a.ts", "export function one() { return 1; }\n");
    f.write("server/services/b.ts", "export function two() { return 2; }\n");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // `a.ts` and `b.ts` are imported by nothing, so they are genuinely MODULE
  // ORPHANS as well as unreached exports — the module-orphans family added in
  // unit 106 counts them, and the fixture says 2 rather than pretending 0.
  const base = { tablesNoWriter: 0, tablesNoReader: 0, unregisteredRoutes: 0, moduleOrphans: 2 };

  it("PASSes at baseline", () => {
    const f = fixture(dir);
    f.ratchet({ ...base, unreachedExports: 2 });
    const { code, out } = f.run();
    expect(code).toBe(0);
    expect(out).toContain("unreached-exports: PASS — 2 (baseline 2)");
    // The summary used to hardcode "four" and would have gone on saying it after
    // the fifth family landed — which is how this very assertion broke. It now
    // derives from FAMILIES.length, so the check does too: whatever the number
    // is, the line must report as many counts as the run actually printed.
    const reported = [...out.matchAll(/^\[lint-reachability\] \S+: PASS — /gm)].length;
    expect(reported, "no family lines were printed").toBeGreaterThan(0);
    expect(out).toContain(`PASS — all ${reported} reachability counts at baseline`);
  });

  it("FAILs on an increase and refuses to suggest bumping the baseline", () => {
    const f = fixture(dir);
    f.ratchet({ ...base, unreachedExports: 1 });
    const { code, out } = f.run();
    expect(code).toBe(1);
    expect(out).toContain("2 > baseline 1");
    expect(out).toContain("+1 newly-unreachable");
    expect(out).toContain("Do NOT raise the baseline");
  });

  it("FAILs stale-high on a decrease and prints the number to lock in", () => {
    const f = fixture(dir);
    f.ratchet({ ...base, unreachedExports: 5 });
    const { code, out } = f.run();
    expect(code).toBe(1);
    expect(out).toContain("stale-high baseline");
    expect(out).toContain("Current count is 2, baseline says 5");
    expect(out).toContain('"baselines.unreachedExports": 2');
  });

  it("--measure never gates", () => {
    const f = fixture(dir);
    f.ratchet({ ...base, unreachedExports: 1 });
    const { code, out } = f.run("--measure");
    expect(code).toBe(0);
    expect(out).toContain("unreached-exports: current=2 baseline=1");
    expect(out).toContain("measure-only — no gate applied");
  });
});

describe("lint-reachability — table and route families", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "reach-tables-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reports no-writer and no-reader separately, and catches an unmounted router", () => {
    const f = fixture(dir);
    f.write(
      "shared/schema.ts",
      [
        'export const blackHole = pgTable("black_hole", {});', // written, never read
        'export const deadWeight = pgTable("dead_weight", {});', // neither
        'export const healthy = pgTable("healthy", {});', // both
      ].join("\n") + "\n",
    );
    f.write(
      "server/services/writer.ts",
      'import { blackHole, healthy } from "@shared/schema";\n' +
        "export async function w() {\n" +
        "  await db.insert(blackHole).values({});\n" +
        "  await db.insert(healthy).values({});\n" +
        "  return db.select().from(healthy);\n" +
        "}\n",
    );
    // routes-mounted is registered from routes.ts; routes-orphan is not.
    f.write(
      "server/routes-mounted.ts",
      "export function registerMountedRoutes(app: unknown) { return app; }\n",
    );
    f.write(
      "server/routes-orphan.ts",
      "export function registerOrphanRoutes(app: unknown) { return app; }\n",
    );
    f.write(
      "server/routes.ts",
      'import { registerMountedRoutes } from "./routes-mounted";\n' +
        "export function registerRoutes(app: unknown) { registerMountedRoutes(app); }\n",
    );
    // THE ANCHOR, and it is required since the 2026-08-16 widening — this fixture
    // was stale for the same reason the minima were missing: the wave that
    // changed the linter did not change the test.
    //
    // Mountedness is now a FIXED POINT rather than a one-hop reference check, and
    // `routes.ts` is itself a candidate (it exports `registerRoutes`). With
    // nothing anchoring it, routes.ts was unmounted, so its import of
    // routes-mounted conferred nothing and the fixture reported THREE unmounted
    // routers — including the one it exists to prove is NOT accused. That is the
    // real `api-v1/index.ts` defect the widening was written for, reproduced by
    // accident in the fixture.
    //
    // ROUTE_MANIFEST is how the real repo anchors the chain, so the fixture
    // anchors it the same way. The invariant under test is unchanged and now
    // actually tested: a router reachable from a MOUNTED parent is not accused; a
    // router reachable from nothing is. Do not "fix" a future failure here by
    // deleting routes.ts — that would delete the transitive half of the property.
    f.write(
      "server/routeManifest.ts",
      "export const ROUTE_MANIFEST = [\n" +
        '  { file: "routes.ts", note: "root registrar" },\n' +
        "];\n",
    );
    f.ratchet(
      {
        unreachedExports: 99,
        tablesNoWriter: 0,
        tablesNoReader: 0,
        unregisteredRoutes: 0,
      },
      [],
      // The one fixture rich enough to carry NON-TRIVIAL floors, so it does: 3
      // pgTables and 3 route candidates are scanned here, floored at 2 apiece.
      // If the schema regex or the route-candidate predicate ever stops seeing
      // this tree, THIS is the fixture that says so instead of reporting a
      // reassuring zero.
      { productionFiles: 3, pgTables: 2, routeCandidateFiles: 2 },
    );

    const { code, out } = f.run("--report");
    expect(code).toBe(1);

    // no-writer: dead_weight only. black_hole IS written.
    expect(out).toContain("tables-no-writer: FAIL — 1");
    expect(out).toContain('deadWeight ("dead_weight")');
    // no-reader: black_hole AND dead_weight; healthy is read.
    expect(out).toContain("tables-no-reader: FAIL — 2");
    expect(out).toContain('blackHole ("black_hole")');
    expect(out).toContain("BLACK HOLE");
    expect(out).not.toContain('healthy ("healthy")');

    // route family — exactly ONE accusation, and it is the orphan.
    expect(out).toContain("unregistered-routes: FAIL — 1");
    expect(out).toContain("server/routes-orphan.ts");
    expect(out).toContain("registerOrphanRoutes");
    // Neither the manifest-anchored root nor the router it mounts is accused.
    // The second of those is the TRANSITIVE half: it is discharged only because
    // its referrer was itself discharged first, by the fixed point.
    expect(out).not.toContain("server/routes-mounted.ts");
    expect(out).not.toContain("registerMountedRoutes");
    expect(out).not.toContain("registerRoutes —");
    expect(out).toContain("404s in production");
  });
});

describe("lint-reachability — vacuity guard", () => {
  /**
   * THE REASON THE GUARD EXISTS, pinned as tests.
   *
   * Run over an empty tree, the pre-guard linter printed:
   *
   *   Good news: 1405 unreachable item(s) were wired or deleted.
   *   Lock it in — set "baselines.unreachedExports": 0
   *
   * A scan that saw NOTHING congratulated the operator and told them to
   * re-baseline the gate to zero. Every other test in this file asserts on a
   * count; these two assert that a count arrived at BLINDLY is refused.
   *
   * One production file, one export. That is a legitimate fixture — and it is
   * also indistinguishable, count-wise, from a walk that broke and found one
   * file by accident. The floors are what tell the two apart.
   */
  const SOLO = "export function soleExport() { return 1; }\n";
  /** Genuinely true of the SOLO tree: one unreached export, in one orphan file. */
  const SOLO_BASELINES = { unreachedExports: 1, moduleOrphans: 1 };

  it("FAILs when a population falls BELOW its floor — and the same tree PASSes with an honest one", () => {
    const d = mkdtempSync(join(tmpdir(), "reach-vacuity-breach-"));
    try {
      const f = fixture(d);
      f.write("server/services/solo.ts", SOLO);

      // CONTROL FIRST. Without this the failure below proves nothing: a fixture
      // that fails for an unrelated reason would produce the same exit code, and
      // "the guard bit" would be an assumption. Honest floors → fully green.
      f.ratchet(SOLO_BASELINES);
      const ok = f.run();
      expect(
        ok.code,
        `the control run must be green or the breach below proves nothing:\n${ok.out}`,
      ).toBe(0);
      expect(ok.out).not.toContain("VACUITY GUARD");
      expect(ok.out).toContain("[lint-reachability] PASS");

      // MUTATION: the tree is unchanged; only the floor moves, to a number this
      // tree cannot reach. Nothing else about the run differs.
      f.ratchet(SOLO_BASELINES, [], { productionFiles: 500 });
      const bad = f.run();
      expect(bad.code).toBe(1);
      expect(bad.out).toContain("VACUITY GUARD: productionFiles = 1, below the floor of 500");
      // It accuses the SCAN, not the codebase — the whole point of the guard.
      expect(bad.out).toContain("This scan is NOT a clean bill of health");
      expect(bad.out).toContain("it stopped seeing files");
      expect(bad.out).toContain("Suspect the walk, the extension filter, or a regex");
      expect(bad.out).toContain("vacuity guard tripped; counts below are not trustworthy");
      // And it refuses BEFORE printing per-family verdicts, so a broken scan can
      // never emit six reassuring PASS lines.
      expect(bad.out).not.toContain("unreached-exports: PASS");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("FAILs when a minima key is MISSING — an unfloored population is the failure mode itself", () => {
    const d = mkdtempSync(join(tmpdir(), "reach-vacuity-missing-"));
    try {
      const f = fixture(d);
      f.write("server/services/solo.ts", SOLO);
      // Written BY HAND, not through `f.ratchet`: the property under test is the
      // LINTER's missing-key semantics, and routing it through the harness that
      // supplies the floors would test the harness instead. Complete in every
      // other respect — only `pgTables` is absent.
      f.write(
        "scripts/ratchets/reachability.json",
        JSON.stringify({
          name: "reachability",
          baselines: { ...zeroedFamilies(), ...SOLO_BASELINES },
          minima: { productionFiles: 1, exportFiles: 1, routeCandidateFiles: 0 },
          allowlist: [],
        }),
      );

      const { code, out } = f.run();
      expect(code).toBe(1);
      expect(out).toContain('VACUITY GUARD: no "minima.pgTables"');
      expect(out).toContain("an unfloored population lets a broken scan pass as clean");
      expect(out).toContain("vacuity guard tripped");
      // Only the ABSENT floor is named. The three that are declared and met stay
      // silent, so the message points at the one thing to fix.
      expect(out).not.toContain('no "minima.productionFiles"');
      expect(out).not.toContain('no "minima.exportFiles"');
      expect(out).not.toContain('no "minima.routeCandidateFiles"');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("--measure REPORTS a vacuity breach but does not gate on it", () => {
    // --measure exists to print counts for seeding a baseline, so it never
    // exits 1. It must still SAY the scan was blind: a measurement taken through
    // a broken walk is exactly the number nobody should be seeding from.
    const d = mkdtempSync(join(tmpdir(), "reach-vacuity-measure-"));
    try {
      const f = fixture(d);
      f.write("server/services/solo.ts", SOLO);
      f.ratchet(SOLO_BASELINES, [], { productionFiles: 500 });

      const { code, out } = f.run("--measure");
      expect(code).toBe(0);
      expect(out).toContain("VACUITY GUARD: productionFiles = 1, below the floor of 500");
      expect(out).toContain("measure-only — no gate applied");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("every fixture config this file writes is itself FLOORED, on the repo's own key set", () => {
    // The standing temptation, when the guard makes a fixture fail, is to drop
    // `minima` from the fixture config and call it a test-harness concern. That
    // would leave every fixture in this file running blind — the exact condition
    // the guard was added to make impossible. This asserts the escape hatch is
    // not there, and that the fixture floors track the REAL config's populations
    // rather than a hardcoded list that goes stale when a population is added.
    const d = mkdtempSync(join(tmpdir(), "reach-vacuity-floored-"));
    try {
      const f = fixture(d);
      f.ratchet({});
      const written = JSON.parse(
        readFileSync(join(d, "scripts/ratchets/reachability.json"), "utf8"),
      ) as { minima?: Record<string, number> };
      const realKeys = Object.keys(realRatchet().minima ?? {});
      expect(realKeys.length, "the REAL ratchet declares no minima").toBeGreaterThan(0);
      expect(Object.keys(written.minima ?? {}).sort()).toEqual([...realKeys].sort());
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("lint-reachability — the real repo", () => {
  /**
   * 120s, not the 30s default.
   *
   * This case shells out to the REAL linter over the REAL tree — thousands of
   * files, six families — which takes ~8s alone and exceeded 30s under the full
   * suite's parallelism on 2026-08-19. It failed as a TIMEOUT, not an
   * assertion, which is the worst kind of red: it looks like the gate found
   * something and it did not.
   *
   * Retrying a slow gate teaches the next reader to re-run reds until they go
   * away, so the budget is raised to something the machine can actually meet
   * under load rather than left to chance. The scan itself is unchanged.
   */
  it("passes at its own committed baseline", () => {
    const { code, out } = run();
    expect(out).toContain("[lint-reachability] PASS");
    expect(code).toBe(0);
  }, 120_000);

  it("declares every family baseline in scripts/ratchets/reachability.json", async () => {
    const cfg = (
      await import("../../scripts/ratchets/reachability.json", {
        with: { type: "json" },
      })
    ).default as { baselines: Record<string, number>; allowlist: Allow[] };
    expect(Object.keys(cfg.baselines).sort()).toEqual([
      // moduleOrphans counts whole FILES nothing imports — 228 of the unreached
      // exports resolve to 62 files, and a file is the unit a delete-or-wire
      // decision is made in (BLOCKERS B19). It is NOT a delete list: one class
      // is regulated obligations built and never wired.
      "moduleOrphans",
      // opaqueExports is the SIZE OF THE BLIND SPOT — exports the other families
      // cannot assert on because their module is dynamically imported somewhere.
      // Nothing in it is proven dead; the point is that it may only shrink,
      // where before it was printed as prose and could grow unwatched.
      "opaqueExports",
      "tablesNoReader",
      "tablesNoWriter",
      "unreachedExports",
      "unregisteredRoutes",
    ]);
    // Every real allowlist entry justifies itself.
    for (const entry of cfg.allowlist) {
      expect(entry.reason.trim().length).toBeGreaterThanOrEqual(20);
    }
  });

  it("floors all four scan populations, and the floors sit UNDER the live numbers", () => {
    // The guard fails on a MISSING floor, so the real repo could not be passing
    // without these — but a floor set at or above the live count would fail the
    // gate on the next legitimate deletion, and the temptation would then be to
    // delete the floor rather than lower it. Pin both halves.
    const minima = realRatchet().minima ?? {};
    expect(Object.keys(minima).sort()).toEqual([
      "exportFiles",
      "pgTables",
      "productionFiles",
      "routeCandidateFiles",
    ]);

    const { out } = run("--measure");
    const scanned = out.match(
      /scanned (\d+) production files · \d+ exported symbols in (\d+) service\/job files · (\d+) pgTable definitions · (\d+) route candidates/,
    );
    expect(scanned, `the scan summary line did not parse — harness broken:\n${out}`).not.toBeNull();
    const live: Record<string, number> = {
      productionFiles: Number(scanned![1]),
      exportFiles: Number(scanned![2]),
      pgTables: Number(scanned![3]),
      routeCandidateFiles: Number(scanned![4]),
    };
    for (const [name, floor] of Object.entries(minima)) {
      expect(live[name], `no live population parsed for ${name}`).toBeGreaterThan(0);
      expect(live[name], `minima.${name} (${floor}) is not below the live ${live[name]}`).
        toBeGreaterThan(floor);
    }
  });
});
