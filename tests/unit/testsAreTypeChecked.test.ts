/**
 * Nine thousand tests, type-checked by nothing.
 *
 * `npm run check` opens with `tsc --noEmit`, and that pass reported clean over a
 * project that did not contain the test suite. `tsconfig.json` lists `client/src`,
 * `shared` and `server` in `include` — the tests tree is not there — and then
 * puts a `*.test.ts` glob in `exclude`, which also removes the co-located tests
 * inside `server/`. So 700+ files and ~9,200 tests were checked by no compiler at all.
 *
 * A TEST IS THE WORST PLACE TO LOSE IT, because a type error there is invisible
 * at runtime too:
 *
 *     expect(result.nonExistentField).toBeUndefined();   // passes. forever.
 *
 * and an import of a symbol that no longer exists only fails if the line
 * executes. Unit 101 hit exactly that — removing a re-export nothing consumed
 * left a test importing through the dead path, and `tsc` said nothing because the
 * file was outside the project.
 *
 * WHAT TURNING IT ON FOUND, before any gate existed:
 *
 *   • **A test file that had never parsed.** `sim-scaling-operator.spec.ts` wrote
 *     `{ /borrower.*name/i: "Alice Johnson", … }` — regex literals as object
 *     KEYS, which is not valid JavaScript. `npm run test:scale` failed before
 *     Playwright started, so that scaling scenario has never run once. The loop
 *     underneath confirms the intent: it called `pattern.toString().slice(1, -1)`
 *     to strip `/…/` delimiters back off, which is only meaningful if the key had
 *     been a regex — and object keys are coerced to strings, so it never was.
 *   • **Five test files importing `../../../server/…`** — one level too many,
 *     resolving outside the repository. Vite clamps paths above root, so they
 *     resolved at RUNTIME and the suite was green; `tsc` was right and nothing
 *     had been asking it.
 *
 * AND A CORRECTION THAT NEARLY SHIPPED. The first measurement came back as
 * TWELVE errors and I almost recorded "the suite type-checks clean". That pass
 * ran from a scratchpad config outside the repo which could not resolve `node` /
 * `vite/client` / `vitest/globals`, so tsc gave up early. Run in place, the real
 * number was 170. **A gate that answers zero when it cannot look is worse than no
 * gate**, so the evaluator now refuses to report a count at all if it sees
 * `Cannot find type definition file for` — asserted below, because that guard is
 * the difference between this ratchet and the false clean bill of health.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/**
 * JSONC → JSON: drop whole-line `//` comments, and nothing else.
 *
 * Deliberately NOT stripping `/* … *\/` blocks: this file's globs contain
 * `client/src/**\/*`, whose `/*` opens a block the regex then closes at the next
 * `*\/` — chewing three include entries into `"shared*"`. tsconfig.tests.json
 * uses line comments only, so the simpler stripper is also the correct one.
 */
function stripJsonc(src: string): string {
  return src
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

/** Comments stripped so a note describing a defect never trips its own check. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const evaluator = fs.readFileSync(path.join(ROOT, "scripts/check-tests-typecheck.mjs"), "utf8");
const tsconfigTests = fs.readFileSync(path.join(ROOT, "tsconfig.tests.json"), "utf8");
const baseline = JSON.parse(
  fs.readFileSync(path.join(ROOT, "scripts/ratchets/tests-typecheck.json"), "utf8"),
) as { baselineCount: number; direction: string; evaluator: string };

describe("the test suite is type-checked, and the gate runs", () => {
  it("check:tests exists and is invoked by npm run check", () => {
    // Wiring is the whole point: a gate that only runs when someone remembers to
    // invoke it is the "built but unwired" defect in gate form.
    expect(pkg.scripts["check:tests"], "the check:tests script is gone").toBeTruthy();
    expect(
      pkg.scripts.check,
      "npm run check no longer invokes check:tests, so the suite is unchecked again",
    ).toContain("npm run check:tests");
  });

  it("the ratchet points at the evaluator that exists", () => {
    expect(baseline.evaluator).toBe("scripts/check-tests-typecheck.mjs");
    expect(fs.existsSync(path.join(ROOT, baseline.evaluator))).toBe(true);
    expect(baseline.direction).toBe("down");
    expect(baseline.baselineCount).toBeGreaterThan(0);
  });

  it("the config actually includes the tests", () => {
    // Stripped of comments — tsconfig.tests.json is JSONC and its header is long.
    const cfg = JSON.parse(stripJsonc(tsconfigTests)) as {
      include: string[];
      exclude: string[];
      compilerOptions: { types: string[] };
    };
    expect(cfg.include, "tests/** dropped out of the type-check project").toContain(
      "tests/**/*",
    );
    // The main config's `exclude: ["**/*.test.ts"]` must NOT be inherited in a
    // form that re-removes them; this config replaces exclude entirely.
    expect(
      cfg.exclude.some((e) => e.includes("*.test.")),
      "the tests config excludes test files, which makes it a no-op",
    ).toBe(false);
    // vitest.config.ts sets `globals: true`, so the suite never imports
    // describe/it/expect. Without this the run is a wall of TS2304 and the
    // baseline would be meaningless.
    expect(cfg.compilerOptions.types).toContain("vitest/globals");
  });

  it("the evaluator refuses to report a count it could not measure", () => {
    // THE GUARD THAT MATTERS. A misconfigured project makes tsc bail after a
    // couple of TS2688s, which reads as a near-clean suite. That is how the first
    // measurement of this population came back as 12 instead of 170.
    expect(
      evaluator,
      "the evaluator will happily report a low count from a tsc run that never " +
        "loaded the project — which is exactly how this population was first " +
        "mis-measured",
    ).toContain("Cannot find type definition file for");
    const at = evaluator.indexOf("Cannot find type definition file for");
    // …and it must EXIT, not merely warn.
    expect(evaluator.slice(at, at + 400)).toContain("process.exit(1)");
  });

  it("and it refuses a tsc run that produced nothing at all", () => {
    expect(evaluator).toMatch(/tsc produced no output at all/);
  });

  it("the ratchet is bidirectional, like every other one here", () => {
    expect(evaluator, "an improvement would not be locked in").toMatch(/stale-high baseline/);
    expect(evaluator, "the gate invites a baseline bump").toMatch(/Do NOT raise the baseline/);
  });
});

describe("the two findings that turning it on produced", () => {
  it("the scaling spec parses — it used regex literals as object keys", () => {
    const spec = fs.readFileSync(
      path.join(ROOT, "tests/simulation/sim-scaling-operator.spec.ts"),
      "utf8",
    );
    // `{ /re/i: "x" }` is a syntax error, so the file never parsed and
    // `npm run test:scale` never started. Pinned as the ARRAY form, which is
    // what the loop underneath always assumed it was reading.
    expect(
      spec,
      "regex literals are being used as object keys again — the file will not parse",
    ).not.toMatch(/\{\s*\n\s*\/[^\n]*\/[gimsuy]*\s*:/);
    expect(spec).toContain("const fields: Array<[RegExp, string]>");
  });

  it("no test directly in tests/unit reaches above the repo root", () => {
    // `tests/unit/x.test.ts` → `../../` IS the root, so `../../../server` is the
    // parent of the repository. Vite clamps it and the suite stayed green; tsc
    // did not, and nothing was asking tsc.
    //
    // Scoped to files DIRECTLY in tests/unit on purpose: `tests/unit/agents/*`
    // is one level deeper, where `../../../` is correct. A sweep that missed
    // that would have "fixed" 63 correct paths — it reported 81 occurrences when
    // only 18 were wrong.
    const offenders: string[] = [];
    // SELF-EXCLUDED, and the reason is the eleventh instance of prose tripping a
    // check meant for code — with a twist: stripping comments is not enough
    // here, because this test's own ASSERTION MESSAGE quotes the import path it
    // forbids, and an assertion message is a string in CODE. The file that owns
    // a rule is the one place the rule has to be written out.
    const SELF = "testsAreTypeChecked.test.ts";
    for (const fn of fs.readdirSync(path.join(ROOT, "tests/unit"))) {
      if (fn === SELF) continue;
      if (!/\.test\.tsx?$/.test(fn)) continue;
      // Comments stripped: the ELEVENTH time in this program that prose has
      // tripped a check meant for code, and the first where the file caught
      // ITSELF — this test's own header quotes the import path it forbids.
      const src = stripComments(fs.readFileSync(path.join(ROOT, "tests/unit", fn), "utf8"));
      if (/\.\.\/\.\.\/\.\.\/(server|shared|client)/.test(src)) offenders.push(fn);
    }
    expect(
      offenders,
      "a test in tests/unit imports ../../../server — one level too many. It " +
        "resolves under Vite and nowhere else.",
    ).toEqual([]);
  });

  it("and the sweep is looking at the right directory (vacuity guard)", () => {
    // If the readdir or the pattern broke, "no offenders" passes at zero.
    const names = fs.readdirSync(path.join(ROOT, "tests/unit")).filter((f) => /\.test\.ts$/.test(f));
    expect(names.length, "tests/unit looks empty — the scan is broken").toBeGreaterThan(100);
    expect(names).toContain("churnEngine.test.ts");
  });
});
