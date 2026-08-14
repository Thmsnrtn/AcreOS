/**
 * The one population the gate could not see was the only one free to grow.
 *
 * `lint-reachability.mjs` is the CI form of the audit CLAUDE.md calls this
 * repo's single most common defect — built but unwired. It gates four counts and
 * then, at the bottom of its output, printed a fifth number as prose:
 *
 *     986 export(s) live in dynamically-imported modules — NOT asserted dead
 *     (static analysis cannot see through `await import(`).
 *
 * That line is honest and was ungated. Nine hundred and eighty-six exports sat
 * outside every baseline in the repo, and nothing stopped that number rising.
 *
 * WHY IT IS SO LARGE, which is the actual finding. Opacity is applied per-MODULE
 * while consumption is per-SYMBOL. `server/services/aiRouter.ts` is pulled in by
 * `const { routeAITask, TaskComplexity } = await import("../services/aiRouter")`
 * from five call sites. Those names are genuinely reached. The module's other TEN
 * exports — `MODEL_PRESETS`, `isClaudeModel`, `routeVisionTask`,
 * `routeExtendedThinkingTask`, `getDbModelConfigs`, `applyEvalQualityGate` and the
 * rest — occur nowhere else in production source, and are invisible to the gate
 * purely because a SIBLING export is dynamically imported. **One dynamic import
 * launders every export in the module.**
 *
 * The population was measured twice before that claim was made: once matching
 * bare identifiers only, then again permissively including `mod.symbol` property
 * access in case namespace-style consumption explained it. Comments were stripped
 * both times — a comment naming a symbol makes it look reached, the mechanism this
 * ratchet's own `InvestorVerificationService` allowlist entry records. **Both
 * passes returned the same 9 referenced / 977 not.** The first result was not
 * believed until the second agreed, because 99% would ordinarily mean a broken
 * scan (unit 68's lesson), and a hand-check of six symbols confirmed it.
 *
 * THE ROOT-CAUSE FIX IS DELIBERATELY NOT TAKEN, and the reason is an authority
 * boundary rather than a technical one. A DESTRUCTURING dynamic import needs no
 * opacity at all: `const { routeAITask } = await import(…)` binds a bare
 * identifier the usage tokeniser already sees. Only a namespace binding
 * (`const m = await import(…)`) genuinely hides which exports are touched. Of
 * 1,244 distinct dynamic-import specifiers, **838 are reached ONLY by
 * destructuring and 27 ever take a namespace binding** — so narrowing the rule
 * reclaims most of this family into `unreached-exports`, which would push that
 * count far above 653. This ratchet's own note reserves raising any of its four
 * numbers to Iris-CTO sign-off. So the definition is untouched, nothing above is
 * weakened, and the blind spot is merely made countable and strictly down-only.
 *
 * What this file pins is that the fifth count is WIRED and DOWN-ONLY, that the
 * gate's summary line counts its families instead of restating a number (it said
 * "four" and would have said it forever), and the mechanism itself — because the
 * mechanism is the part a future reader will doubt.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const GATE = path.join(ROOT, "scripts/lint-reachability.mjs");
const CONFIG = path.join(ROOT, "scripts/ratchets/reachability.json");

const gate = fs.readFileSync(GATE, "utf8");
const config = JSON.parse(fs.readFileSync(CONFIG, "utf8")) as {
  baselines: Record<string, number>;
  direction: string;
  allowlist: Array<{ kind: string; id: string; reason: string }>;
};

describe("the blind spot is counted, not narrated", () => {
  it("opaque-exports is a real family with a baseline", () => {
    expect(gate, "the opaqueExports family is gone from the gate").toContain(`key: "opaqueExports"`);
    expect(gate).toContain(`label: "opaque-exports"`);
    expect(
      config.baselines.opaqueExports,
      "opaque-exports has no baseline, so the gate refuses to run — or worse, " +
        "someone removed it and the blind spot went back to being ungated prose.",
    ).toBeGreaterThan(0);
  });

  it("it counts the SAME array the gate reports as unassertable", () => {
    // The family must be fed `opaqueExports` — the array the classifier fills
    // when `isDynamicallyImported()` is true. Pointed at anything else, the
    // number would be measuring something other than the blind spot.
    const at = gate.indexOf(`key: "opaqueExports"`);
    expect(at, "the family is gone").toBeGreaterThan(-1);
    const block = gate.slice(at, at + 600);
    expect(block).toContain("findings: opaqueExports");
  });

  it("and may only shrink", () => {
    // Shared by all five counts: reachability.json declares one direction.
    expect(config.direction).toBe("down");
  });

  it("the remedy does not offer raising the baseline", () => {
    // The gate's cheapest-fix-is-deletion posture. A remedy that suggested
    // re-baselining would make this family a place to park growth.
    const at = gate.indexOf(`key: "opaqueExports"`);
    const block = gate.slice(at, gate.indexOf("},", at));
    expect(block).toMatch(/Do NOT raise the baseline/);
    expect(block).toMatch(/DELETE the export/);
  });
});

describe("the summary line counts its families instead of restating a number", () => {
  it("derives the count from FAMILIES", () => {
    // It read `all four reachability counts` while there were four, and would
    // have kept saying four after the fifth landed. This session has now found
    // the same shape in `getUserId`'s doc comment and in `shared/finance/cents.ts`;
    // a literal here is the same defect in the gate that hunts defects.
    expect(
      gate,
      "the reachability summary hardcodes its family count again",
    ).not.toMatch(/all (four|five|three|\d+) reachability counts/);
    expect(gate).toMatch(/all \$\{FAMILIES\.length\} reachability counts/);
  });

  it("the header does not contradict it either", () => {
    expect(gate, "the header still claims three families").not.toMatch(
      /WHAT IT CHECKS — three families/,
    );
  });
});

describe("the mechanism, pinned because a future reader will doubt it", () => {
  it("opacity is decided per MODULE, which is why one import launders many exports", () => {
    // If this ever becomes per-symbol, the family above should collapse and its
    // baseline should drop hard — that is the intended future, and this
    // assertion is what tells the next reader the collapse was expected rather
    // than a broken scan.
    const at = gate.indexOf("function isDynamicallyImported(");
    expect(at, "isDynamicallyImported is gone — has opacity been reworked?").toBeGreaterThan(-1);
    const body = gate.slice(at, gate.indexOf("\n}", at));
    // It decides from MODULE-PATH sets and consults no symbol. The registries it
    // reads are the tell: `dynamicResolved` holds specifiers, not export names.
    // A symbol-aware rewrite has to introduce a symbol-keyed structure, which is
    // what would trip this.
    expect(
      body,
      "the opacity decision no longer reads the module-path registries — if it " +
        "is now symbol-aware, reclaim the opaque-exports population into " +
        "unreached-exports and lower this baseline in the same commit.",
    ).toContain("dynamicResolved.has");
    expect(body).toContain("dynamicUnresolvedTails.has");
    expect(body, "the opacity decision now inspects a symbol").not.toMatch(/\bsymbol\b/);
    // The classifier exempts the whole module in one branch, with no symbol test.
    const branch = gate.indexOf("if (isDynamicallyImported(c.file))");
    expect(branch, "the per-module exemption branch is gone").toBeGreaterThan(-1);
    expect(gate.slice(branch, branch + 160)).toContain("opaqueExports.push");
  });

  it("aiRouter is really consumed by destructuring, which is the worked example", () => {
    // The example in three comment blocks and a ratchet note. If it stops being
    // true, those explanations are fiction and should be rewritten rather than
    // left to mislead.
    const files = [
      "server/ai/executive.ts",
      "server/jobs/morningBrief.ts",
      "server/jobs/founderChatBackgroundTaskRunner.ts",
    ];
    let destructured = 0;
    for (const rel of files) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      if (/const\s*\{[^}]*\}\s*=\s*await\s+import\(\s*["'][^"']*aiRouter["']\s*\)/.test(src)) {
        destructured += 1;
      }
    }
    expect(
      destructured,
      "no call site destructures a dynamic import of aiRouter any more — the " +
        "worked example in lint-reachability.mjs and reachability.json is stale",
    ).toBeGreaterThan(0);
  });

  it("the laundered exports really are absent from production source", () => {
    // Spot-check of the claim, on the example everything else rests on. These
    // three are exported by aiRouter and, at the time of measurement, occurred
    // nowhere else in production. Comments are stripped so a note naming one
    // cannot resurrect it — the failure mode this gate's own allowlist records.
    const strip = (s: string) =>
      s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const laundered = ["routeExtendedThinkingTask", "applyEvalQualityGate"];
    const walk = (dir: string, out: string[]) => {
      for (const e of fs.readdirSync(dir)) {
        if (e === "node_modules" || e === "dist" || e.startsWith(".")) continue;
        const full = path.join(dir, e);
        if (fs.statSync(full).isDirectory()) { walk(full, out); continue; }
        if (!/\.tsx?$/.test(e) || /\.(test|spec)\.tsx?$/.test(e)) continue;
        out.push(full);
      }
    };
    const files: string[] = [];
    for (const tree of ["server", "client/src", "shared"]) walk(path.join(ROOT, tree), files);
    const self = path.join(ROOT, "server/services/aiRouter.ts");

    for (const sym of laundered) {
      const rx = new RegExp(`\\b${sym}\\b`);
      const consumers = files.filter((f) => f !== self && rx.test(strip(fs.readFileSync(f, "utf8"))));
      expect(
        consumers,
        `${sym} now HAS a production consumer (${consumers[0]}). That is good news: ` +
          `delete it from this fixture, and if the export was wired rather than ` +
          `merely referenced, lower the opaque-exports baseline in the same commit.`,
      ).toEqual([]);
    }
  });
});

describe("module orphans are counted as files, not only as exports", () => {
  it("the family exists and is fed the orphan FILES", () => {
    // Unit 106. These 62 were already inside unreached-exports (228 of its 653
    // carry the [MODULE ORPHAN] label) — what the family adds is the unit the
    // decision is made in. A file is rulable; an export is not.
    expect(gate, "the moduleOrphans family is gone").toContain(`key: "moduleOrphans"`);
    const at = gate.indexOf(`key: "moduleOrphans"`);
    const block = gate.slice(at, at + 500);
    expect(block, "the family no longer derives from the moduleOrphan flag").toContain(
      "f.moduleOrphan",
    );
    // DISTINCT files — without the Set this counts exports and would read ~228,
    // which is the number it exists to stop being.
    expect(block).toContain("new Set(");
  });

  it("it has a baseline and may only shrink", () => {
    expect(config.baselines.moduleOrphans).toBeGreaterThan(0);
    expect(config.direction).toBe("down");
  });

  it("the remedy does NOT say 'delete them'", () => {
    // The load-bearing part. One of the three classes is regulated obligations
    // built and never wired — breachNotificationTrigger computes GLBA/GDPR/state
    // breach deadlines and its own header lists the events that should call it.
    // A remedy that read "delete unreached files" would invite removing a legal
    // obligation the product may be required to have.
    const at = gate.indexOf(`key: "moduleOrphans"`);
    const block = gate.slice(at, gate.indexOf("},\n  {", at));
    expect(block, "the orphan remedy lost its wire-don't-delete class").toMatch(
      /must be WIRED, not deleted/,
    );
    expect(block).toMatch(/B19/);
  });

  it("and B19 records the triage", () => {
    const blockers = fs.readFileSync(
      path.join(ROOT, "docs/implementation/BLOCKERS.md"),
      "utf8",
    );
    expect(blockers).toMatch(/## B19 —/);
    expect(blockers).toContain("breachNotificationTrigger");
    expect(blockers, "the superseded-vs-missing distinction is gone").toContain("loginLimiter");
  });
});
