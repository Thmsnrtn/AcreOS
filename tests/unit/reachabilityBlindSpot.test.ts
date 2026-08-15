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
 * THE ROOT-CAUSE FIX HAS NOW BEEN TAKEN (founder picker, 2026-08-14, "Approve
 * the narrowing"). A DESTRUCTURING dynamic import needs no opacity at all:
 * `const { routeAITask } = await import(…)` binds a bare identifier the usage
 * tokeniser already sees, so exempting the module's OTHER exports on the
 * strength of it was pure loss. Only a namespace binding (`const m = await
 * import(…)`), a `(await import(…)).x`, and a bare side-effect import genuinely
 * hide which exports are touched, and those keep their exemption — the linter's
 * standing bias is that a false OPAQUE is a miss while a false UNREACHED is an
 * accusation. Of 1,244 distinct dynamic-import specifiers, **838 were reached
 * ONLY by destructuring and 27 ever took a namespace binding**, which is why the
 * narrowing moved 859 exports in one step: opaque-exports 984 → 125,
 * unreached-exports 580 → 1439. (An earlier edition of this comment claimed the
 * reclaimed included `achMandateSetup`/`achAutopay` symbols "opacity had been
 * hiding" — FALSE, corrected by unit 117's wave audit: those modules are
 * statically imported, so opacity never applied to them and zero of the 859 are
 * ach symbols. A verification claim that was itself unverified.)
 *
 * THE TRAP, recorded because the next person to touch this will step in it. The
 * first implementation simply skipped destructured imports — and `moduleOrphans`
 * jumped 45 → 217, i.e. 172 modules that ARE imported were about to be reported
 * as "nothing imports this file at all". A false accusation at scale, caused by
 * conflating two different questions. They are now separate: **every** dynamic
 * import records the module as imported (the module-orphan question), and only a
 * non-destructured one confers opacity (the symbol-exemption question).
 *
 * What this file pins is that the blind-spot count is WIRED and DOWN-ONLY, that
 * the gate's summary line counts its families instead of restating a number (it
 * said "four" and would have said it forever), and the mechanism itself — now
 * including the split above — because the mechanism is the part a future reader
 * will doubt. The behavioural proof that the narrowing classifies correctly
 * lives in `reachabilityGate.test.ts`, which runs the real script over a fixture
 * tree; this file pins the reasoning that fixture is evidence for.
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
    // It DID contradict it: the header read "five counts" from the day the fifth
    // family landed, through the arrival of the sixth, and was still saying five
    // when the narrowing was measured. The fix is not a better number — it is no
    // number, so this asserts the shape rather than a value.
    expect(
      gate,
      "the header tallies its families in prose again. That number goes stale the " +
        "next time a family is added — it has already done so twice. Say what the " +
        "families ARE and let the summary line count them.",
    ).not.toMatch(/WHAT IT CHECKS — (?:three|four|five|six|seven|\d+)\b/);
  });
});

describe("the mechanism, pinned because a future reader will doubt it", () => {
  it("opacity is still decided per MODULE — the narrowing changed WHICH imports confer it", () => {
    // This assertion used to end "if this ever becomes per-symbol, the family
    // above should collapse and its baseline should drop hard — that is the
    // intended future". The collapse happened (984 -> 125), so per CLAUDE.md's
    // wave rule the assertion is rewritten to the new truth rather than deleted.
    //
    // AND THE NEW TRUTH IS NOT WHAT THAT SENTENCE PREDICTED. The fix did not
    // make the opacity DECISION symbol-aware; it narrowed the POPULATION that
    // feeds it. Once a module is opaque it is still opaque wholesale — which is
    // why the residue is 125 rather than 0, and why this check still stands.
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

  it("a destructured dynamic import still counts as an IMPORT, only not as opacity", () => {
    // THE TRAP, pinned. These are two different questions and the first version
    // of the narrowing answered both with one `continue`:
    //
    //   "does anything import this file?"        -> module-orphans
    //   "which of its exports are touched?"      -> opaque-exports
    //
    // Dropping destructured imports from BOTH sets took module-orphans from 45
    // to 217: 172 modules that are demonstrably imported were one commit away
    // from being reported as "nothing imports this file at all". The unreached
    // families are ACCUSATIONS, and this gate's whole posture is that a false
    // accusation is worse than a miss.
    const at = gate.indexOf("if (destructured) {");
    expect(
      at,
      "the destructuring narrowing is gone from the gate — if opacity is back to " +
        "exempting every dynamically-imported module, opaque-exports should be " +
        "back near 984 and unreached-exports near 580, and both baselines must " +
        "move in the same commit.",
    ).toBeGreaterThan(-1);
    // Bounded to the branch itself. An earlier version of this assertion sliced
    // to the next `continue;` in the whole file, which ran far past the block
    // and picked up an unrelated `recordImport(` — it passed against a mutant
    // with the branch deleted. Measure the thing you mean to measure.
    const close = gate.indexOf("\n    }", at);
    expect(close, "the destructured branch has no closing brace where expected").toBeGreaterThan(at);
    const branch = gate.slice(at, close);
    expect(
      branch,
      "the destructured branch no longer records the module as imported. That is " +
        "the 45 -> 217 module-orphans trap: skipping the opacity registries is " +
        "the narrowing, skipping the import registries is a false accusation.",
    ).toContain("recordImport(");
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

  it("the formerly-laundered exports really are absent from production source", () => {
    // Spot-check of the claim, on the example everything else rests on. These
    // are exported by aiRouter and occur nowhere else in production. Comments
    // are stripped so a note naming one cannot resurrect it — the failure mode
    // this gate's own allowlist records.
    //
    // SINCE THE NARROWING these are no longer hidden: aiRouter is consumed by
    // destructuring, so the gate now names them in `unreached-exports` — which
    // is the point of the change, and what makes this fixture checkable against
    // the gate's own output rather than only against a grep.
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
          `merely referenced, lower the unreached-exports baseline in the same ` +
          `commit — since the narrowing these live in that family, not in ` +
          `opaque-exports.`,
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
    // Bounded to the FAMILY OBJECT, not to a character count. This read
    // `gate.slice(at, at + 500)` and broke the moment unit 113 added a comment
    // explaining the new module-orphan allowlist — the code it checks for had
    // simply moved past character 500, with nothing about the behaviour changed.
    // An arbitrary window measures "is this near the top" and reports it as "is
    // this derived from the flag". Third time this program has hit the shape:
    // unit 95's mismatched measure/mutate regexes, unit 110's slice-to-the-next-
    // `continue;`, and now this. Measure the thing you mean to measure.
    const block = gate.slice(at, gate.indexOf("\n  },", at));
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
