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
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const LINTER = join(REPO_ROOT, "scripts", "lint-reachability.mjs");

function run(...args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync("node", [LINTER, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
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

/**
 * Every family the REAL ratchet config declares, zeroed.
 *
 * Reading the shipped baselines' keys means a fixture automatically covers a
 * family added later; the values are irrelevant here, only the key set is.
 */
function zeroedFamilies(): Record<string, number> {
  const real = JSON.parse(
    readFileSync(join(REPO_ROOT, "scripts/ratchets/reachability.json"), "utf8"),
  ) as { baselines: Record<string, number> };
  const keys = Object.keys(real.baselines);
  if (keys.length === 0) throw new Error("no families in the real ratchet config — harness broken");
  return Object.fromEntries(keys.map((k) => [k, 0]));
}

/** Build a miniature repo under `dir` and return a runner bound to it. */
function fixture(dir: string) {
  const write = (relPath: string, body: string) => {
    const abs = join(dir, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  const ratchet = (baselines: Baselines, allowlist: Allow[] = []) =>
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
    f.ratchet({
      unreachedExports: 99,
      tablesNoWriter: 0,
      tablesNoReader: 0,
      unregisteredRoutes: 0,
    });

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

    // route family
    expect(out).toContain("unregistered-routes: FAIL — 1");
    expect(out).toContain("server/routes-orphan.ts");
    expect(out).toContain("registerOrphanRoutes");
    expect(out).not.toContain("server/routes-mounted.ts");
    expect(out).toContain("404s in production");
  });
});

describe("lint-reachability — the real repo", () => {
  it("passes at its own committed baseline", () => {
    const { code, out } = run();
    expect(out).toContain("[lint-reachability] PASS");
    expect(code).toBe(0);
  });

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
});
