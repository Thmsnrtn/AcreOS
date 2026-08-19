/**
 * The model-prefix gate, gated.
 *
 * ── WHY THIS GATE EXISTS ────────────────────────────────────────────────────
 * `server/utils/openaiClient.ts` is named `getOpenAIClient` and returns an
 * OPENROUTER client — its own docblock says "Platform AI is OpenRouter-only".
 * Sixty-odd call sites across thirty-one files believed the name and passed
 * OpenAI's bare ids to it. Measured against the live catalogue on 2026-08-19:
 * `gpt-4o` and `gpt-4o-mini` are absent from all 415 models AND 404 on
 * `/models/{id}/endpoints`, while `openai/gpt-4o` and `openai/gpt-4o-mini`
 * return 200.
 *
 * ── WHY THIS FILE ───────────────────────────────────────────────────────────
 * A gate is only worth its register if it demonstrably FIRES. Every case below
 * mutates the thing the gate GOVERNS — the shape of an id that reaches a
 * provider — rather than the strings it happens to mention today, and the
 * negative cases are here because a gate that fires on everything is disabled
 * within a week and then guards nothing.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(__dirname, "../..");
const GATE = path.join(ROOT, "scripts/check-model-prefix.mjs");

function run(): { out: string; ok: boolean } {
  try {
    return { out: execFileSync("node", [GATE], { cwd: ROOT, encoding: "utf8" }), ok: true };
  } catch (err) {
    const e = err as { stdout?: string | Buffer; stderr?: string | Buffer };
    return { out: String(e.stdout ?? "") + String(e.stderr ?? ""), ok: false };
  }
}

/** Writes a probe under server/services (inside the walk), runs, removes. */
function withProbe(source: string): { out: string; ok: boolean } {
  const file = path.join(ROOT, "server/services", "__model_prefix_probe__.ts");
  fs.writeFileSync(file, source);
  try {
    return run();
  } finally {
    fs.unlinkSync(file);
  }
}

describe("the gate is wired and sees a real population", () => {
  it("passes on the current tree", () => {
    const { out, ok } = run();
    expect(out, `the gate is not passing:\n${out}`).toContain("[model-prefix] PASS");
    expect(ok).toBe(true);
  }, 120_000);

  it("walks a real population and verifies its own stripper (vacuity)", () => {
    // A walk that sees nothing certifies every model id in the repo, and a
    // stripper that returned "" would produce exactly that.
    const { out } = run();
    const m =
      /walked (\d+) server files; (\d+) model literals considered; comment-stripper self-test: (\d+)\/(\d+) correct/.exec(
        out,
      );
    expect(m, `the coverage line is gone:\n${out}`).not.toBeNull();
    expect(Number(m![1]), "the server walk collapsed").toBeGreaterThan(900);
    expect(
      Number(m![2]),
      "the model-literal scan found almost nothing — the pattern or the walk broke",
    ).toBeGreaterThan(30);
    expect(Number(m![3]), "the comment stripper is failing its own cases").toBe(Number(m![4]));
  }, 120_000);
});

describe("it fires on the shape, not on a string it happens to name", () => {
  it("catches the exact defect — a bare gpt-4o on the platform client", () => {
    const { out, ok } = withProbe(
      'import { requireOpenAIClient } from "../utils/openaiClient";\n' +
        "export async function summarise(text: string) {\n" +
        "  return requireOpenAIClient().chat.completions.create({\n" +
        '    model: "gpt-4o",\n' +
        '    messages: [{ role: "user", content: text }],\n' +
        "  });\n}\n",
    );
    expect(out).toContain("__model_prefix_probe__.ts");
    expect(out).toMatch(/model: "gpt-4o"/);
    expect(ok, "the gate reported the finding and still exited zero").toBe(false);
  }, 120_000);

  it("catches an EQUIVALENT representation — different key, different id, single quotes", () => {
    // The rule is "an identifier reaching a provider must be one it serves",
    // not "the literal gpt-4o must not appear". A gate pinned to the strings
    // that were wrong when it was written is a gate the next model id walks
    // straight past.
    const { out, ok } = withProbe(
      "export const trace = {\n  aiModel: 'claude-3-haiku-20240307',\n};\n",
    );
    expect(out).toMatch(/aiModel: "claude-3-haiku-20240307"/);
    expect(ok).toBe(false);
  }, 120_000);

  it("catches a REGISTERED id used outside the file it was registered for", () => {
    // `gpt-4o` is registered bare — for server/services/models.ts only, where
    // OPENAI_DIRECT_MODELS holds the direct-OpenAI names on purpose. A register
    // whose entries apply everywhere is a hole with a comment on it.
    const { out, ok } = withProbe('export const M = { model: "gpt-4o" };\n');
    expect(out).toContain("registered, but not for this file");
    expect(ok).toBe(false);
  }, 120_000);

  it("does NOT fire on a prefixed id", () => {
    const { out, ok } = withProbe(
      'export const M = { model: "openai/gpt-4o", aiModel: "anthropic/claude-haiku-4.5" };\n',
    );
    expect(out, `a correct id was flagged:\n${out}`).toContain("[model-prefix] PASS");
    expect(ok).toBe(true);
  }, 120_000);

  it("does NOT fire on a bare id inside a COMMENT", () => {
    // The other half of the same lesson this repository learned the hard way:
    // a docblock showing a caller how to pass a model id is documentation, not
    // a request. A scanner that cannot tell the difference turns every example
    // into a defect — and, from the other side, lets a sentence satisfy a gate.
    const { out, ok } = withProbe(
      "/**\n * Usage:\n *   client.chat.completions.create({ model: \"gpt-4o\" })\n */\n" +
        'export const M = { model: "openai/gpt-4o" };\n',
    );
    expect(out, `a comment was read as code:\n${out}`).toContain("[model-prefix] PASS");
    expect(ok).toBe(true);
  }, 120_000);
});
