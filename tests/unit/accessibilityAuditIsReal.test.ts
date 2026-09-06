/**
 * The accessibility audit may not quietly become a no-op again.
 *
 * It was one for its entire life. tests/e2e/accessibility.spec.ts was 262 lines
 * titled "Accessibility Audit", run by a CI job of the same name, and it never
 * checked accessibility once. Six independent reasons, any one of them
 * sufficient on its own — which is the interesting part, because it means five
 * separate people could each have fixed one and the job would still have been
 * a no-op:
 *
 *   1. `@axe-core/playwright` was never installed, and the loader was
 *      `import(...).catch(() => ({ checkA11y: null }))` — a missing dependency
 *      returned null and every axe assertion was skipped without a word. The
 *      file's own header carried the install command nobody ran.
 *   2. No storageState in the CI invocation, so every one of the nine "critical
 *      page" tests hit the /auth redirect and early-returned BY DESIGN.
 *   3. The step ended in `|| true`.
 *   4. The job was not in security-gate's `needs:`, so a real failure could not
 *      have failed the pipeline even without (3).
 *   5. `npm ci` + `playwright install`, no build and no database — `npm run
 *      start` could not boot, so the webServer timed out before any test ran.
 *   6. Two surviving assertions were `expect(true).toBe(true)`; the one named
 *      "color contrast passes on auth page" asserted the body has text; and
 *      checkFocusIndicators' evaluator ended `return true; // Default pass`.
 *
 * Each rule below kills one of those. They are cheap; the thing they prevent
 * cost this repo a named, staffed, green CI job that checked nothing for months.
 *
 * Mutation probes (each must go RED): drop @axe-core/playwright from
 * package.json; append `|| true` to the e2e-mobile a11y step; empty
 * AUDIT_PROJECTS or misspell a project name; replace the critical assertion
 * with expect(true).toBe(true); delete the vacuity floor.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";
import { stripYamlComments } from "../helpers/stripYamlComments";

const ROOT = path.resolve(__dirname, "../..");
const SPEC_REL = "tests/e2e-mobile/accessibility-audit.spec.ts";
const SPEC = stripComments(fs.readFileSync(path.join(ROOT, SPEC_REL), "utf8"));
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const MOBILE_CFG = stripComments(
  fs.readFileSync(path.join(ROOT, "playwright.mobile.config.ts"), "utf8"),
);
const WORKFLOW = stripYamlComments(
  fs.readFileSync(path.join(ROOT, ".github/workflows/e2e-mobile.yml"), "utf8"),
);

describe("the accessibility audit is capable of failing", () => {
  it("axe is a declared dependency, not an optional import", () => {
    const deps = { ...PKG.dependencies, ...PKG.devDependencies };
    expect(
      deps["@axe-core/playwright"],
      "the audit's entire value is the axe run; without the dependency the old " +
        "spec degraded to a couple of Tab presses and reported success",
    ).toBeTruthy();

    // A static import, so a missing dependency is a module-resolution failure
    // rather than a caught null. This is rule 1: the swallow, not the absence,
    // is what made it silent.
    expect(SPEC).toContain('import AxeBuilder from "@axe-core/playwright"');
    expect(
      /catch\s*\(\s*\)?\s*=>\s*\(\s*\{[^}]*(?:checkA11y|injectAxe|AxeBuilder)/.test(SPEC),
      "the axe import is wrapped in a catch that substitutes a null — a missing " +
        "or broken dependency would then read as a clean audit",
    ).toBe(false);
  });

  it("runs inside a harness that boots the app with a database", () => {
    // Rule 5. The audit lives in the e2e-mobile workflow precisely because that
    // job has these; asserting them here means moving the spec somewhere
    // thinner fails loudly.
    expect(WORKFLOW).toMatch(/image:\s*pgvector\/pgvector:pg16/);
    expect(WORKFLOW).toMatch(/run:\s*npm run build/);
    expect(WORKFLOW).toContain("E2E_TEST_AUTH");
  });

  it("no step that runs the mobile e2e suite swallows its exit status", () => {
    // Rule 3. The population is every step that RUNS the suite, and that is not
    // the same as every step that spells "playwright test": the step which
    // actually picks up this spec is `npm run test:e2e:mobile`, an alias whose
    // body lives in package.json. Written the obvious way, this check read the
    // two steps that invoke playwright directly and was blind to the one that
    // matters — appending `|| true` to the alias left it green.
    //
    // So npm-script aliases are resolved through package.json before the rule
    // is applied.
    const scripts: Record<string, string> = PKG.scripts ?? {};
    const expand = (cmd: string, depth = 0): string => {
      if (depth > 3) return cmd;
      return cmd.replace(/npm run ([\w:-]+)/g, (whole, name) =>
        scripts[name] ? `${whole} => ${expand(scripts[name], depth + 1)}` : whole,
      );
    };

    const runSteps = [...WORKFLOW.matchAll(/run:\s*(.+)/g)].map((m) => m[1].trim());
    expect(runSteps.length, "no run: steps found in the workflow").toBeGreaterThan(5);

    const suiteSteps = runSteps.filter((cmd) => /playwright test/.test(expand(cmd)));
    expect(
      suiteSteps.length,
      "no step in e2e-mobile.yml resolves to a playwright run — either the " +
        "workflow stopped running the suite that carries this audit, or the " +
        "alias expansion has stopped working and this rule now reads nothing",
    ).toBeGreaterThan(0);

    const swallowing = suiteSteps.filter((cmd) => /\|\|\s*true/.test(cmd));
    expect(
      swallowing,
      "a step running the mobile e2e suite discards its exit status. `|| true` " +
        "is how the previous accessibility job stayed green for its whole life.",
    ).toEqual([]);
  });

  it("the alias expansion this gate depends on actually resolves", () => {
    // Canary for the extraction above. If package.json stops carrying the
    // script, or the name changes, the population silently empties — and an
    // empty population passes every rule applied to it.
    const scripts: Record<string, string> = PKG.scripts ?? {};
    expect(
      scripts["test:e2e:mobile"],
      "test:e2e:mobile is gone; the workflow step that runs this audit can no " +
        "longer be resolved to a playwright invocation",
    ).toMatch(/playwright test/);
    expect(WORKFLOW).toContain("npm run test:e2e:mobile");
  });

  it("the audit asserts on critical violations and cannot pass vacuously", () => {
    // Rule 6 — the assertion has to be about axe's output.
    expect(SPEC).toMatch(/critical\s*=\s*results\.violations\.filter/);
    expect(SPEC).toMatch(/expect\(\s*critical/);
    expect(
      /expect\(true\)\.toBe\(true\)/.test(SPEC),
      "an assertion that cannot fail; the retired spec had two",
    ).toBe(false);

    // The vacuity floor: axe finding nothing and axe never running produce the
    // same empty violations array.
    expect(SPEC).toContain("MIN_RULES_EVALUATED");
    expect(SPEC).toMatch(/toBeGreaterThanOrEqual\(MIN_RULES_EVALUATED\)/);

    // Rule 2 — a door that bounces to /auth is the finding, not a skip.
    expect(SPEC).toMatch(/expect\(\s*page\.url\(\)[\s\S]{0,200}\)\.not\.toContain\("\/auth"\)/);
    expect(
      /if\s*\(\s*page\.url\(\)\.includes\("\/auth"\)\s*\)\s*return/.test(SPEC),
      "the /auth early-return is back; that single line skipped every page test " +
        "the retired spec claimed to cover",
    ).toBe(false);
  });

  it("every project the audit runs on exists in the config", () => {
    // A typo in AUDIT_PROJECTS skips every test and reports a clean run — the
    // skip is invisible in a pass. Derive the declared names and check.
    const declared = new Set(
      [...MOBILE_CFG.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]),
    );
    expect(declared.size, "no projects found in playwright.mobile.config.ts").toBeGreaterThan(3);

    const listed = SPEC.match(/AUDIT_PROJECTS\s*=\s*new Set\(\[([^\]]*)\]\)/);
    expect(listed, "AUDIT_PROJECTS is no longer a literal set this gate can read").toBeTruthy();
    const names = [...listed![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

    expect(names.length, "AUDIT_PROJECTS is empty — every audit test would skip").toBeGreaterThan(0);
    for (const n of names) {
      expect(declared, `AUDIT_PROJECTS names "${n}", which is not a project in the config`).toContain(n);
    }
  });

  it("the spec that never audited anything stays deleted", () => {
    expect(
      fs.existsSync(path.join(ROOT, "tests/e2e/accessibility.spec.ts")),
      "the retired no-op spec is back; two specs named 'accessibility' means the " +
        "next reader checks whichever one they find first",
    ).toBe(false);
  });
});
