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
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(__dirname, "../..");
const EVALUATOR_PATH = path.join(ROOT, "scripts/check-tests-typecheck.mjs");
const RATCHET_PATH = path.join(ROOT, "scripts/ratchets/tests-typecheck.json");
const HEAP_LIB_REL = "scripts/lib/heap-ceiling.mjs";
const HEAP_LIB_PATH = path.join(ROOT, HEAP_LIB_REL);

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

/**
 * The guards, DRIVEN rather than read.
 *
 * Every assertion above this point matches a STRING in the evaluator's source,
 * and an adversarial verifier showed what that is worth: all of them pass
 * against the pre-hardening file too. Source-string assertions pin that a
 * sentence exists, not that a guard fires — the same name-keyed weakness this
 * whole program has been closing everywhere else, sitting in the test file for
 * the gate that motivated it.
 *
 * So these run the REAL evaluator against a fake `tsc` that emits controlled
 * output, and assert on its exit status and what it says. They cannot pass
 * against an evaluator that lacks the guards.
 */
describe("the evaluator's guards actually fire (driven, not read)", () => {
  const FAKE_MODES = {
    // A healthy run: many diagnostics, a full program. The control.
    healthy: [
      'echo "tests/unit/a.test.ts(1,1): error TS2322: Type A is not assignable to type B."',
      'echo "Files:                         7836"',
      "exit 2",
    ],
    // The 2026-08-16 incident: tsc starved mid-run. One diagnostic, tiny program.
    // This is the shape that printed "Good news: 161 error(s) were fixed."
    truncated: [
      'echo "tests/unit/a.test.ts(1,1): error TS2493: Tuple type of length 0 has no element at index 0."',
      'echo "Files:                          214"',
      "exit 2",
    ],
    // A NORMAL run whose diagnostic ELABORATION quotes a type named RangeError.
    // Must PASS: elaborations are user text, not compiler chrome.
    elaboration: [
      'echo "tests/unit/a.test.ts(1,1): error TS2322: Type A is not assignable to type B."',
      "echo \"  Type 'A' is missing the following properties from type 'RangeError': message, name\"",
      'echo "Files:                         7836"',
      "exit 2",
    ],
    // Genuine crash chrome, flush-left. Must REFUSE.
    crash: [
      'echo "tests/unit/a.test.ts(1,1): error TS2322: Type A is not assignable to type B."',
      'echo "RangeError: Maximum call stack size exceeded"',
      'echo "Files:                         7836"',
      "exit 2",
    ],
    // A status outside {0,2} — an abort, a bad argv, an ENOBUFS. Must REFUSE.
    badexit: [
      'echo "tests/unit/a.test.ts(1,1): error TS2322: Type A is not assignable to type B."',
      'echo "Files:                         7836"',
      "exit 3",
    ],
  } as const;

  /** Run the real evaluator with a fake tsc, at a baseline of 1. */
  function runWith(mode: keyof typeof FAKE_MODES): { code: number; out: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctt-"));
    try {
      fs.mkdirSync(path.join(dir, "bin"));
      fs.mkdirSync(path.join(dir, "scripts/ratchets"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "bin/npx"),
        `#!/bin/bash\n${FAKE_MODES[mode].join("\n")}\n`,
        { mode: 0o755 },
      );
      fs.copyFileSync(EVALUATOR_PATH, path.join(dir, "scripts/check-tests-typecheck.mjs"));
      // The evaluator imports ./lib/heap-ceiling.mjs. Copy it too, or the whole
      // harness dies on module resolution and every refusal below reads as a
      // pass-by-crash rather than a guard firing.
      fs.mkdirSync(path.join(dir, "scripts/lib"), { recursive: true });
      fs.copyFileSync(HEAP_LIB_PATH, path.join(dir, "scripts/lib/heap-ceiling.mjs"));
      // Baseline 1 so the ONLY thing that can differ between modes is a guard.
      const cfg = JSON.parse(fs.readFileSync(RATCHET_PATH, "utf8")) as Record<string, unknown>;
      cfg.baselineCount = 1;
      fs.writeFileSync(
        path.join(dir, "scripts/ratchets/tests-typecheck.json"),
        JSON.stringify(cfg, null, 2),
      );
      const res = spawnSync(process.execPath, [path.join(dir, "scripts/check-tests-typecheck.mjs")], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${path.join(dir, "bin")}:${process.env.PATH ?? ""}` },
      });
      return { code: res.status ?? -1, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it("the control passes — else every refusal below is unattributable", () => {
    // Vacuity guard, first. If a healthy fake run does not pass, the harness is
    // broken and the four assertions after it prove nothing about the guards.
    const r = runWith("healthy");
    expect(r.code, `healthy control should exit 0. Output:\n${r.out}`).toBe(0);
    expect(r.out).toContain("7836 files loaded");
  });

  it("REFUSES a truncated run instead of calling it good news", () => {
    // The incident, reproduced: same diagnostic count as the control's baseline,
    // but a program a fraction of the size.
    const r = runWith("truncated");
    expect(r.code, `expected refusal. Output:\n${r.out}`).toBe(1);
    expect(
      r.out,
      "the gate told the operator to lower a ratchet baseline on the strength of " +
        "a tsc that never finished — the single most dangerous thing it can print",
    ).not.toMatch(/Lock it in|Good news/);
  });

  it("does NOT refuse a normal run whose elaboration quotes RangeError", () => {
    // The false positive this guard shipped with: tsc splits one diagnostic over
    // several lines and only the first carries the error code, so indented
    // elaborations quoting user types were being scanned for crash text.
    const r = runWith("elaboration");
    expect(
      r.code,
      `a type named RangeError in an elaboration must not block CI. Output:\n${r.out}`,
    ).toBe(0);
  });

  it("still REFUSES genuine crash chrome", () => {
    // The other direction: narrowing the filter must not have disarmed it.
    const r = runWith("crash");
    expect(r.code, `expected refusal. Output:\n${r.out}`).toBe(1);
    expect(r.out).toMatch(/crash signature/);
  });

  it("REFUSES an exit status it has never measured", () => {
    const r = runWith("badexit");
    expect(r.code, `expected refusal. Output:\n${r.out}`).toBe(1);
    expect(r.out).not.toMatch(/Lock it in|Good news/);
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

/**
 * THE CEILING MUST REACH THE CHILD — the defect that blocked every production
 * deploy from 2026-08-17 to 2026-08-25, in gate form.
 *
 * `npm run check` was `NODE_OPTIONS=--max-old-space-size=6144 tsc … && npm run
 * check:tests && …`. In POSIX sh that prefix binds to ONE simple command, so it
 * protected the SMALLER tsc program (tsconfig.json, which excludes test files)
 * and never reached the LARGER one (tsconfig.tests.json, a strict superset of
 * it). The larger program needs ~5.1 GB and ran at Node's default 2-4 GB,
 * aborting with 134 on every deploy run; vitest and the build were SKIPPED
 * behind it.
 *
 * Nothing caught it because it is invisible locally: dev containers export
 * NODE_OPTIONS=--max-old-space-size=8192 and every command after the `&&`
 * inherited it, so `npm run check` exited 0 here at the very commit CI died on.
 * The reproduction is `env -u NODE_OPTIONS npm run check:tests`.
 *
 * So the driven test below STRIPS NODE_OPTIONS from the evaluator's environment
 * and asserts the evaluator MANUFACTURES the ceiling for the tsc it spawns.
 * Delete `env: withHeapCeiling(process.env)` from check-tests-typecheck.mjs and
 * it goes red. That is the point: a gate that would stay green with the defect
 * restored is decoration.
 */
describe("the heap ceiling reaches the process that needs it", () => {
  const heapLib = fs.readFileSync(HEAP_LIB_PATH, "utf8");
  const CEILING = Number(/HEAP_CEILING_MB\s*=\s*(\d+)/.exec(heapLib)?.[1]);

  it("the ceiling is a single declared number, at or above measured need", () => {
    expect(
      Number.isInteger(CEILING) && CEILING > 0,
      `no HEAP_CEILING_MB found in ${HEAP_LIB_REL}`,
    ).toBe(true);
    // MEASURED 2026-08-25: tsconfig.tests.json reports "Memory used" 5,104 MB.
    // 4096 aborts at 187s; 6144 completes at 222s. A ceiling below the measured
    // need is a guaranteed 134, so this floor does not move down without a
    // fresh measurement recorded in the same commit.
    expect(CEILING, "ceiling is below the measured ~5.1 GB need").toBeGreaterThanOrEqual(6144);
  });

  it("no package.json script relies on a VAR=x prefix crossing an &&", () => {
    // POPULATION = every script in package.json, enumerated — not a named few.
    // This is the exact textual shape of the original defect, so adding a new
    // script with it is what fails here.
    const offenders = Object.entries(pkg.scripts)
      .filter(([, body]) => /^\s*[A-Za-z_][A-Za-z0-9_]*=/.test(body) && body.includes("&&"))
      .map(([name]) => name);
    expect(
      offenders,
      "a script sets an env var by prefix and then chains with && — in POSIX sh " +
        "the prefix binds to the FIRST command only. Give the later commands " +
        "their own env, or split them into their own script.",
    ).toEqual([]);
    // Vacuity, per member: an empty or unparsed scripts object satisfies the
    // assertion above at zero, which would read exactly like being clean.
    expect(Object.keys(pkg.scripts).length).toBeGreaterThan(30);
    expect(pkg.scripts["check:app"], "check:app is gone — where did the app tsc go?").toBeTruthy();
    expect(pkg.scripts["check"]).toContain("npm run check:app");
  });

  it("every script that pins a ceiling agrees with the declared one (no drift)", () => {
    // POPULATION = every script pinning --max-old-space-size, not check:app alone.
    // The value lives in three places now; a third one disagreeing is the drift
    // this catches.
    const pinned = Object.entries(pkg.scripts)
      .map(([name, body]) => [name, /--max-old-space-size=(\d+)/.exec(body)?.[1]] as const)
      .filter(([, mb]) => mb !== undefined)
      .map(([name, mb]) => [name, Number(mb)] as const);
    const disagreeing = pinned.filter(([, mb]) => mb !== CEILING);
    expect(
      disagreeing.map(([n, mb]) => `${n} pins ${mb}`),
      `these disagree with ${HEAP_LIB_REL}'s HEAP_CEILING_MB=${CEILING}`,
    ).toEqual([]);
    // Vacuity: a regex that stopped matching would report zero disagreements.
    expect(pinned.length, "no script pins a ceiling at all — did the regex rot?").toBeGreaterThanOrEqual(2);
  });

  /**
   * THE SECOND OOM, and the reason this test is a population and not a name.
   *
   * Fixing check:tests only moved the failure one step down the chain: with the
   * tsc finally completing, `npm run check` reached lint:ghost-fields (step 7 of
   * 27) and aborted 134 there instead. check-ghost-fields.mjs builds a full
   * `ts.createProgram` + `getTypeChecker` IN PROCESS, so no spawn-site `env:`
   * can reach it — the ceiling has to be on its own node command. It had never
   * run in CI at all, because check:tests aborted before the chain got to it.
   *
   * MEASURED 2026-08-25 (tsconfig.json, the smaller program):
   *   2048 -> abort 134, peak RSS 2,188 MB
   *   4096 -> exit 0,    peak RSS 2,871 MB
   *   6144 -> exit 0,    peak RSS 3,189 MB
   *
   * So: a gate that builds a TypeScript Program needs the ceiling, whoever
   * writes it and whenever. Adding an eighth such gate without one is what fails
   * here — which is the only version of this test that would have caught the
   * ghost-fields case, since that file did not exist when the first one was written.
   */
  it("every gate that builds a TypeScript Program carries the ceiling", () => {
    const dir = path.join(ROOT, "scripts");
    const builders = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".mjs") || f.endsWith(".ts"))
      .filter((f) =>
        /\bts\.createProgram\s*\(|\bcreateIncrementalProgram\s*\(/.test(
          fs.readFileSync(path.join(dir, f), "utf8"),
        ),
      );

    // Vacuity FIRST: a scan that matches nothing reads exactly like being clean.
    expect(
      builders,
      "no script matched ts.createProgram — the scan has rotted, not the repo cleaned up",
    ).toContain("check-ghost-fields.mjs");

    const unprotected = builders.filter((file) => {
      const entries = Object.entries(pkg.scripts).filter(([, b]) => b.includes(file));
      // A builder nothing invokes cannot OOM the chain; only wired ones matter.
      return entries.length > 0 && !entries.every(([, b]) => b.includes("--max-old-space-size"));
    });
    expect(
      unprotected,
      "these build a TypeScript Program but run at Node's default heap. They are " +
        "in-process, so withHeapCeiling() at a spawn site cannot reach them — put " +
        "`NODE_OPTIONS=--max-old-space-size=<ceiling>` on their npm command.",
    ).toEqual([]);
  });

  it("DRIVEN: the evaluator hands the ceiling to the tsc it spawns", () => {
    // Not "the source mentions withHeapCeiling" — that stays green against a
    // file that imports it and never calls it. This runs the REAL evaluator
    // with NODE_OPTIONS STRIPPED, and reads what the spawned child actually got.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctt-heap-"));
    try {
      fs.mkdirSync(path.join(dir, "bin"));
      fs.mkdirSync(path.join(dir, "scripts/ratchets"), { recursive: true });
      fs.mkdirSync(path.join(dir, "scripts/lib"), { recursive: true });
      const seenFile = path.join(dir, "node-options-seen.txt");
      // The fake tsc records its OWN environment to a file, so nothing here
      // depends on the evaluator's output parsing.
      fs.writeFileSync(
        path.join(dir, "bin/npx"),
        `#!/bin/bash\n` +
          `printf '%s' "\${NODE_OPTIONS}" > ${JSON.stringify(seenFile)}\n` +
          `echo "tests/unit/a.test.ts(1,1): error TS2322: Type A is not assignable to type B."\n` +
          `echo "Files:                         7836"\n` +
          `exit 2\n`,
        { mode: 0o755 },
      );
      fs.copyFileSync(EVALUATOR_PATH, path.join(dir, "scripts/check-tests-typecheck.mjs"));
      fs.copyFileSync(HEAP_LIB_PATH, path.join(dir, "scripts/lib/heap-ceiling.mjs"));
      const cfg = JSON.parse(fs.readFileSync(RATCHET_PATH, "utf8")) as Record<string, unknown>;
      cfg.baselineCount = 1;
      fs.writeFileSync(
        path.join(dir, "scripts/ratchets/tests-typecheck.json"),
        JSON.stringify(cfg, null, 2),
      );

      // CI conditions: no ambient NODE_OPTIONS whatsoever.
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: `${path.join(dir, "bin")}:${process.env.PATH ?? ""}`,
      };
      delete env.NODE_OPTIONS;

      const res = spawnSync(
        process.execPath,
        [path.join(dir, "scripts/check-tests-typecheck.mjs")],
        { encoding: "utf8", env },
      );

      // Vacuity first: if the evaluator never reached the spawn, the assertion
      // below would be reasoning about a file that was never written.
      expect(
        fs.existsSync(seenFile),
        `the fake tsc never ran, so nothing was measured. Evaluator output:\n` +
          `${res.stdout ?? ""}${res.stderr ?? ""}`,
      ).toBe(true);

      const seen = fs.readFileSync(seenFile, "utf8");
      expect(
        seen,
        "the tsc spawned by check-tests-typecheck.mjs received NO heap ceiling. " +
          "It runs the LARGEST program in the repo (~5.1 GB) and will abort with " +
          "134 on any machine whose Node default is below that — which is every " +
          "CI runner. Restore `env: withHeapCeiling(process.env)` at its execFileSync.",
      ).toContain(`--max-old-space-size=${CEILING}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
