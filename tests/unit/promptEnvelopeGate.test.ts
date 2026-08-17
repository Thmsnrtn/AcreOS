/**
 * The rule was written down, agreed, and unenforced. Now it is a gate.
 *
 * `server/utils/sanitizePrompt.ts` has stated the rule in its own header since
 * P0-14:
 *
 *     Apply at every site where DB-sourced text is interpolated into a prompt.
 *
 * Unit 111 found what an unenforced rule costs. `server/ai/executive.ts` fed
 * user-uploaded document text into Pax's SYSTEM role message with no envelope,
 * sanitized by a weaker same-named function, while the system prompt instructed
 * the model only about the `<<USER_DATA>>` envelope it never received. That
 * shipped GREEN — `tsc`-clean, every test passing, every lint gate passing —
 * because the rule lived in a doc comment. This is the same shape CLAUDE.md
 * names as the repo's most common defect, one level up: not "built but unwired"
 * but "decided but unchecked".
 *
 * Unit 112 converts it into CI and wraps the ten sites the check found.
 *
 * WHY THE GATE IS NARROW, which is the part worth defending. The first cut
 * matched any `content:` template anywhere and reported 237 interpolations
 * across 43 files — overwhelmingly `${totalMrr}`, `${paidOrgs.length}`,
 * `${closingDays}` and module constants. **A gate whose number is mostly noise
 * is one people learn to re-baseline**, so the definition was tightened until
 * every hit was real: the template must REACH a `content:`/`prompt:` slot on an
 * object that also carries `role:` (that shape IS an LLM message), and the
 * interpolated expression must touch a free-text field from P0-14's own list.
 * That took 237 to 10, and all ten were genuine.
 *
 * "REACHES", NOT "SITS IN" — and this header said "sit in" for one unit longer
 * than the gate did, which is the stale half this file exists to prevent.
 * Until unit 112's second pass the first rule genuinely was SITS-IN: the
 * backtick had to be written literally in the slot. That made the gate blind to
 * the very defect that built it. `executive.ts` did not write the template in
 * the slot; it wrote
 *
 *     const systemPrompt = `… ${doc.extractedText} …`;
 *     messages: [{ role: "system", content: systemPrompt }]
 *
 * and a slot holding a bare identifier matched nothing, so the gate scored ZERO
 * on its own motivating defect. Hoisting a prompt one line up was a total
 * bypass — and hoisting is simply how this codebase writes a long prompt: the
 * script header records 57 of the 160 identifier-valued message slots in
 * `server/` resolving to one. `hoistedMessageTemplates()` now walks the
 * identifier back to its `const`/`let`/`var` template in the enclosing block and
 * applies rules 2 and 3 unchanged; the ratchet's `lastBumpNote` records the cost
 * as +7 findings, seven of seven confirmed real by hand.
 *
 * The resolver is guarded by a brace-balance scope check, and that guard is a
 * DECISION, not an implementation detail: when the declaring block closed before
 * the `content:` use, the `const` it found is not the one in scope, so the gate
 * REFUSES the site rather than guessing. This gate misses rather than accuses,
 * because a false accusation is how you teach people to ignore a gate. The
 * refusal is pinned below like any other behaviour.
 *
 * `title` and `label` are deliberately EXCLUDED from the field list even though
 * they are prose, because in this repo they are dominated by code-defined
 * rosters (`companyAgents`'s "Chief Technology Officer", `ONBOARDING_STEPS`) —
 * including them re-introduced exactly the noise the narrowing removed.
 *
 * This file pins the gate's WIRING and its BEHAVIOUR on fixtures. The
 * fixture cases matter more than the count: a detector nobody has exercised
 * against a known-bad and a known-good input is a detector that can silently
 * become `return []`. That was literally true of the hoisted path until the
 * fixtures below were written — it shipped protected only by the repo-wide
 * count, which is the one number that cannot tell "the code got wrapped" apart
 * from "the resolver stopped resolving".
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const GATE = path.join(ROOT, "scripts/lint-prompt-envelope.mjs");
const CONFIG = path.join(ROOT, "scripts/ratchets/prompt-envelope.json");

function run(...args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync("node", [GATE, ...args], { encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

/** A miniature tree with its own ratchet file. */
function fixture(dir: string) {
  const write = (rel: string, body: string) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  const ratchet = (baseline: number, allowlist: unknown[] = []) =>
    write(
      "scripts/ratchets/prompt-envelope.json",
      JSON.stringify({ name: "prompt-envelope", direction: "down", baseline, allowlist }),
    );
  return { write, ratchet, run: (...a: string[]) => run("--root", dir, ...a) };
}

/**
 * The gate prints what it SAW before it prints what it found. Reading that back
 * is how a fixture tells "the resolver looked and found nothing wrong" apart
 * from "the resolver never resolved anything" — the two produce an identical
 * zero, and this whole family of gates dies on that ambiguity. Throwing when
 * the line is absent is deliberate: a population assertion that silently skips
 * is worse than none.
 */
function population(out: string): { files: number; templates: number } {
  const m = out.match(/scanned (\d+) server files, (\d+) LLM message templates/);
  if (!m) throw new Error(`the gate printed no population line; cannot judge the count:\n${out}`);
  return { files: Number(m[1]), templates: Number(m[2]) };
}

describe("the gate is wired", () => {
  it("runs as part of npm run check", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["lint:prompt-envelope"]).toBe("node scripts/lint-prompt-envelope.mjs");
    expect(
      pkg.scripts.check,
      "the prompt-envelope gate is not in `npm run check`, so it protects nothing. " +
        "That is precisely the failure this unit exists to fix — a rule that is " +
        "written down and unenforced.",
    ).toContain("npm run lint:prompt-envelope");
  });

  it("has a baseline and may only shrink", () => {
    const cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8")) as {
      baseline: number;
      direction: string;
      allowlist: Array<{ file: string; expr: string; reason: string }>;
    };
    expect(cfg.direction).toBe("down");
    expect(cfg.baseline).toBeGreaterThanOrEqual(0);
    for (const a of cfg.allowlist) {
      expect(a.reason.length, `allowlist entry ${a.file} has a token reason`).toBeGreaterThan(20);
    }
  });

  it("passes against the real repo at its committed baseline", () => {
    const { code, out } = run();
    expect(out).toContain("PASS");
    expect(code).toBe(0);
  });
});

describe("it catches the defect it was built for", () => {
  it("flags DB free text interpolated into a message, and not a guarded one", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "envelope-"));
    try {
      const f = fixture(dir);
      // The unit-111 shape: a document's rawText straight into a message.
      f.write(
        "server/services/bad.ts",
        "export async function analyze(doc: { rawText: string }) {\n" +
          "  return openai.chat.completions.create({ messages: [\n" +
          '    { role: "system", content: `You are an analyst.` },\n' +
          "    { role: \"user\", content: `Analyze:\\n\\n${doc.rawText}` },\n" +
          "  ] });\n" +
          "}\n",
      );
      // The fixed shape: same field, wrapped.
      f.write(
        "server/services/good.ts",
        "export async function analyze(doc: { rawText: string }) {\n" +
          "  return openai.chat.completions.create({ messages: [\n" +
          "    { role: \"user\", content: `Analyze:\\n\\n${wrapUntrusted(doc.rawText, \"doc\")}` },\n" +
          "  ] });\n" +
          "}\n",
      );
      f.ratchet(0);

      const { code, out } = f.run("--report");
      expect(code).toBe(1);
      expect(out).toContain("server/services/bad.ts");
      expect(out).toContain("${doc.rawText}");
      // The guarded one must NOT be accused — a false accusation trains people
      // to ignore the gate.
      expect(out, "the wrapped site was flagged anyway").not.toContain("good.ts");
      expect(out).toContain("Do NOT raise the baseline");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores a template that is not an LLM message", () => {
    // The narrowing that took 237 to 10. Without the `role:` requirement this
    // logging call — same field, same template shape — would be counted, and the
    // gate's number would be mostly things like it.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "envelope-nonmsg-"));
    try {
      const f = fixture(dir);
      f.write(
        "server/services/logsite.ts",
        "export function log(lead: { notes: string }) {\n" +
          "  logger.info({ content: `lead notes: ${lead.notes}` });\n" +
          "}\n",
      );
      f.ratchet(0);
      const { code, out } = f.run();
      expect(out).toContain("PASS");
      expect(code).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores counts and ids inside a real message", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "envelope-safe-"));
    try {
      const f = fixture(dir);
      f.write(
        "server/services/counts.ts",
        "export async function brief(orgs: unknown[], deal: { id: number }) {\n" +
          "  return ai({ messages: [{ role: \"user\", content: `Orgs: ${orgs.length}, deal ${deal.id}` }] });\n" +
          "}\n",
      );
      f.ratchet(0);
      const { code, out } = f.run();
      expect(out).toContain("PASS");
      expect(code).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("FAILs stale-high so a fix is locked in by the commit that earned it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "envelope-stale-"));
    try {
      const f = fixture(dir);
      f.write(
        "server/services/clean.ts",
        "export async function x() { return ai({ messages: [{ role: \"user\", content: `hi` }] }); }\n",
      );
      f.ratchet(3);
      const { code, out } = f.run();
      expect(code).toBe(1);
      expect(out).toContain("stale-high");
      expect(out).toContain('set "baseline": 0');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses an allowlist entry with no real reason", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "envelope-allow-"));
    try {
      const f = fixture(dir);
      f.write(
        "server/services/bad.ts",
        "export async function a(doc: { rawText: string }) {\n" +
          "  return ai({ messages: [{ role: \"user\", content: `${doc.rawText}` }] });\n" +
          "}\n",
      );
      f.ratchet(0, [{ file: "server/services/bad.ts", expr: "${doc.rawText}", reason: "wip" }]);
      const { code, out } = f.run();
      expect(code).toBe(1);
      expect(out).toContain('no real "reason"');
      expect(out).toContain("WRAP IT, not allowlist");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports the line number of the real file, not the comment-stripped one", () => {
    // Comments are BLANKED rather than removed so byte offsets survive. The
    // first version removed them and pointed at documentIntelligence.ts:380 for
    // a site living at 411. A gate that names the wrong line is worse than one
    // that names none: the reader looks, sees nothing, and stops trusting it.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "envelope-lines-"));
    try {
      const f = fixture(dir);
      const filler = "/**\n" + " * padding\n".repeat(20) + " */\n";
      f.write(
        "server/services/offset.ts",
        filler +
          "export async function a(doc: { rawText: string }) {\n" +
          "  return ai({ messages: [{ role: \"user\", content: `${doc.rawText}` }] });\n" +
          "}\n",
      );
      f.ratchet(0);
      const { out } = f.run("--report");
      const m = out.match(/offset\.ts:(\d+)/);
      expect(m, "no line number reported").not.toBeNull();
      const reported = Number(m![1]);
      const actual =
        fs.readFileSync(path.join(dir, "server/services/offset.ts"), "utf8")
          .split("\n")
          .findIndex((l) => l.includes("doc.rawText")) + 1;
      expect(reported, `reported line ${reported}, real line ${actual}`).toBe(actual);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the hoisted shape — the bypass the first cut could not see", () => {
  // Rule 1 is REACHES, not SITS-IN. Before unit 112's second pass it was
  // SITS-IN, and `executive.ts`'s `const systemPrompt = …` / `content:
  // systemPrompt` scored zero — the gate blind to its own motivating defect.
  // The widening shipped protected ONLY by the repo-wide count, and a count
  // cannot distinguish "the code got wrapped" from "the resolver stopped
  // resolving". These fixtures make that distinction, which is the whole job.

  it("flags a hoisted prompt const that reaches a message slot", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "envelope-hoisted-"));
    try {
      const f = fixture(dir);
      // KNOWN-BAD: the unit-111 shape exactly — the template is written one
      // line above the message, and the slot holds a bare identifier.
      f.write(
        "server/services/hoistedBad.ts",
        "export async function analyze(doc: { rawText: string }) {\n" +
          "  const p = `Analyze this document:\\n\\n${doc.rawText}`;\n" +
          '  return ai({ messages: [{ role: "user", content: p }] });\n' +
          "}\n",
      );
      // KNOWN-GOOD: byte-for-byte the same hoisted shape, field wrapped. Without
      // this counterpart the test above could be satisfied by a gate that flags
      // everything, which is the other way a detector goes useless.
      f.write(
        "server/services/hoistedGood.ts",
        "export async function analyze(doc: { rawText: string }) {\n" +
          '  const p = `Analyze this document:\\n\\n${wrapUntrusted(doc.rawText, "document")}`;\n' +
          '  return ai({ messages: [{ role: "user", content: p }] });\n' +
          "}\n",
      );
      f.ratchet(0);

      const { code, out } = f.run("--report");
      // Both consts must have RESOLVED. If the resolver regressed to `return []`
      // this reads 0 and every assertion below would pass vacuously against an
      // empty scan — the exact shape of failure this file is written against.
      expect(
        population(out).templates,
        "the hoisted resolver reached neither const; the assertions below would be vacuous",
      ).toBe(2);
      expect(code).toBe(1);
      expect(out).toContain("server/services/hoistedBad.ts");
      expect(out).toContain("${doc.rawText}");
      // The finding must SAY it came through an identifier, so a reader landing
      // on the const line knows why that line is named and where to look next.
      expect(
        out,
        "the finding does not name the identifier it resolved through",
      ).toMatch(/\[hoisted: p → content: at line \d+\]/);
      expect(out, "the wrapped hoisted site was accused anyway").not.toContain("hoistedGood.ts");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses, rather than guesses, when the declaring block closed before the use", () => {
    // The scope guard is a deliberate REFUSAL: `scopeStillOpen()` walks the span
    // between the const and the use and bails the moment brace depth goes
    // negative, because the `const` it resolved is then a DIFFERENT binding in a
    // block that already closed. Flagging it would be an accusation about code
    // the gate cannot actually read, and this gate misses rather than accuses.
    //
    // A lone "not reported" assertion would also pass against a gate whose
    // hoisted resolver returned `[]`, so it proves nothing on its own. The
    // CONTROL below is the mutation control, run through the same binary: the
    // identical file minus the block that closes MUST be flagged. Subject and
    // control differ only in the wrapping block.
    const ctrlDir = fs.mkdtempSync(path.join(os.tmpdir(), "envelope-scope-ctrl-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "envelope-scope-"));
    try {
      const ctrl = fixture(ctrlDir);
      ctrl.write(
        "server/services/outOfScope.ts",
        "export async function analyze(doc: { rawText: string }, q: string) {\n" +
          "  const p = `Draft a note about:\\n\\n${doc.rawText}`;\n" +
          "  void p;\n" +
          '  return ai({ messages: [{ role: "user", content: p }] });\n' +
          "}\n",
      );
      ctrl.ratchet(0);
      const control = ctrl.run("--report");
      expect(
        population(control.out).templates,
        "the CONTROL resolved nothing, so the resolver is dead and the subject below proves nothing",
      ).toBe(1);
      expect(control.code, "the control shape must be flagged").toBe(1);
      expect(control.out).toContain("server/services/outOfScope.ts");

      // SUBJECT: same const, same field, same slot — but the block declaring it
      // closes first, so the binding reaching `content:` is the parameter.
      const f = fixture(dir);
      f.write(
        "server/services/outOfScope.ts",
        "export async function analyze(doc: { rawText: string }, p: string) {\n" +
          "  if (doc.rawText) {\n" +
          "    const p = `Draft a note about:\\n\\n${doc.rawText}`;\n" +
          "    void p;\n" +
          "  }\n" +
          '  return ai({ messages: [{ role: "user", content: p }] });\n' +
          "}\n",
      );
      f.ratchet(0);
      const { code, out } = f.run("--report");
      // ZERO templates, not zero findings: the refusal happens at RESOLUTION,
      // before the field predicate ever runs. Same file count as the control,
      // one fewer template — that differential is the assertion.
      expect(population(out).files).toBe(population(control.out).files);
      expect(
        population(out).templates,
        "the gate resolved the out-of-scope const anyway — it is guessing about a binding it cannot see",
      ).toBe(0);
      expect(out, "an out-of-scope const was accused").not.toContain("outOfScope.ts:");
      expect(out).toContain("PASS");
      expect(code).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(ctrlDir, { recursive: true, force: true });
    }
  });
});

describe("the real-tree scan is not allowed to go quiet", () => {
  it("carries explicit population floors, comfortably below the live numbers", () => {
    // The defect class this file guards against: a count that drops because the
    // SCAN broke, reported as good news. The gate's own vacuity floors are the
    // answer, so pin that they are WRITTEN DOWN rather than defaulted — a
    // MISSING floor must fail as loudly as a breached one (the pattern in
    // scripts/ratchets/reachability.json's `minima` block).
    //
    // MEASURED 2026-08-16 on this tree, via
    //   node scripts/lint-prompt-envelope.mjs --measure
    // → "scanned 1370 server files, 174 LLM message templates".
    // The committed floors (1000 / 100) sit below those on purpose: they exist
    // to catch a scan that stopped seeing, not to forbid deleting a prompt.
    // Re-measure with the command above before changing any number here.
    const cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8")) as {
      minScannedFiles?: number;
      minMessageTemplates?: number;
    };
    expect(
      typeof cfg.minScannedFiles,
      "minScannedFiles is missing; the gate would fall back to a default nobody measured",
    ).toBe("number");
    expect(
      typeof cfg.minMessageTemplates,
      "minMessageTemplates is missing; the gate would fall back to a default nobody measured",
    ).toBe("number");

    const { out } = run("--measure");
    const live = population(out);
    expect(
      live.files,
      `scanned ${live.files} server files, floor ${cfg.minScannedFiles} — the scan lost sight of the tree`,
    ).toBeGreaterThanOrEqual(cfg.minScannedFiles!);
    expect(
      live.templates,
      `resolved ${live.templates} message templates, floor ${cfg.minMessageTemplates} — a reader broke`,
    ).toBeGreaterThanOrEqual(cfg.minMessageTemplates!);

    // THE AGGREGATE FLOOR IS NOT ENOUGH, and that was MEASURED, not assumed.
    // Stubbing `hoistedMessageTemplates()` to `return []` on a scratch copy of
    // the gate and running it against this tree on 2026-08-16 gave:
    //
    //     scanned 1370 server files, 117 LLM message templates
    //     unenveloped free-text interpolations: 0 (baseline 1)
    //
    // 117 clears the committed floor of 100, so the gate would NOT have cried
    // vacuous — it would have printed its stale-high branch: "Good news: 1
    // site(s) were wrapped. Lock it in — set baseline: 0." A register telling
    // the operator to lock in a number that was never true is the single most
    // dangerous thing a counting gate can emit, and the aggregate floor sails
    // straight past it, because ONE of two readers dying still leaves the other
    // one's population standing.
    //
    // So the floor is tightened to sit between the two: live 174, dead-reader
    // 117, floor 140. It keeps 34 templates of headroom for prompts that are
    // legitimately deleted, and inlining a hoisted prompt (or hoisting an inline
    // one) does not move this total at all — only deletion does. The fixtures in
    // "the hoisted shape" above are the primary guard on that reader; this is
    // the backstop for the case where nobody re-runs them.
    const READER_FLOOR = 140; // 2026-08-16: live 174, hoisted-reader-dead 117.
    expect(
      live.templates,
      `resolved ${live.templates} message templates, floor ${READER_FLOOR}. Measured 2026-08-16: ` +
        `174 live, 117 with the hoisted reader dead. A drop toward that second number means a ` +
        `READER BROKE, and any count below is fiction — do NOT lower this floor or the baseline ` +
        `until --measure shows the templates are genuinely gone from server/.`,
    ).toBeGreaterThanOrEqual(READER_FLOOR);
  });
});

describe("the sites unit 112 wrapped stay wrapped", () => {
  // The gate's count already protects these, but a count says "zero" without
  // saying WHICH. If someone unwraps one and allowlists it, the count still
  // reads zero — these name the surfaces so that trade has to be made in the open.
  const cases: Array<[string, RegExp]> = [
    ["server/services/documentIntelligence.ts", /wrapUntrusted\(\s*(?:doc\.)?rawText/],
    ["server/services/portfolioSentinel.ts", /sanitizePromptInline\(\s*property\?\.address/],
    ["server/services/buyerMatchingAI.ts", /sanitizePromptInline\(\s*property\.description/],
    ["server/routes-admin.ts", /sanitizePromptInline\(\s*ticket\.subject/],
    ["server/services/founderTwin.ts", /wrapUntrusted\(\s*input\.content/],
    ["server/services/evolutionPipeline.ts", /sanitizePromptInline\(\s*proposal\.description/],
    // Found by the indirection probe, not by the gate: `sampleTexts` is built
    // from `profile.sampleMessages` a few lines earlier, so the field name is
    // gone by the time it reaches the template. The customer's own typed
    // messages, which is P0-14's exact category.
    ["server/services/writingStyle.ts", /wrapUntrusted\(\s*sampleTexts/],
  ];

  it.each(cases)("%s still guards its free-text field", (file, rx) => {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    expect(rx.test(src), `${file} no longer guards the field unit 112 wrapped`).toBe(true);
  });

  it("document analysis carries the untrusted-data clause in its system prompt", () => {
    // Wrapping without the clause is half a fix: the markers arrive and the
    // model was never told what they mean.
    const src = fs.readFileSync(
      path.join(ROOT, "server/services/documentIntelligence.ts"),
      "utf8",
    );
    const occurrences = src.split("USER_DATA_SYSTEM_CLAUSE").length - 1;
    expect(
      occurrences,
      "the three enveloped document surfaces should each carry the clause, plus its import",
    ).toBeGreaterThanOrEqual(4);
  });
});
