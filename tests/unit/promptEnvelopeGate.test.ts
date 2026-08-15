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
 * every hit was real: the template must sit in a `content:` slot on an object
 * that also carries `role:` (that shape IS an LLM message), and the interpolated
 * expression must touch a free-text field from P0-14's own list. That took 237
 * to 10, and all ten were genuine.
 *
 * `title` and `label` are deliberately EXCLUDED from the field list even though
 * they are prose, because in this repo they are dominated by code-defined
 * rosters (`companyAgents`'s "Chief Technology Officer", `ONBOARDING_STEPS`) —
 * including them re-introduced exactly the noise the narrowing removed.
 *
 * This file pins the gate's WIRING and its BEHAVIOUR on fixtures. The
 * fixture cases matter more than the count: a detector nobody has exercised
 * against a known-bad and a known-good input is a detector that can silently
 * become `return []`.
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
