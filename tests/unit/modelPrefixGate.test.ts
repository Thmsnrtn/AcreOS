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
import os from "node:os";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(__dirname, "../..");
const GATE = path.join(ROOT, "scripts/check-model-prefix.mjs");

function run(...args: string[]): { out: string; ok: boolean } {
  try {
    return { out: execFileSync("node", [GATE, ...args], { cwd: ROOT, encoding: "utf8" }), ok: true };
  } catch (err) {
    const e = err as { stdout?: string | Buffer; stderr?: string | Buffer };
    return { out: String(e.stdout ?? "") + String(e.stderr ?? ""), ok: false };
  }
}

/**
 * Runs the REAL gate over a throwaway tree containing one file.
 *
 * See the same helper in measurementDefaultsGate.test.ts for why this no longer
 * writes into the live `server/services`: vitest runs test files in parallel,
 * ~69 suites walk `server/**`, and a probe that appears and vanishes mid-walk
 * makes an unrelated test red with an fs stack trace instead of an assertion.
 */
function withProbe(source: string): { out: string; ok: boolean } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "model-prefix-probe-"));
  const services = path.join(dir, "server", "services");
  fs.mkdirSync(services, { recursive: true });
  fs.writeFileSync(path.join(services, "probe.ts"), source);
  try {
    return run("--root", dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
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
    // The `(N vanished mid-scan)` clause is optional and expected to be 0 or 1:
    // sibling gate self-tests write probe files into server/services and delete
    // them again while vitest runs in parallel, so the walk can list a path that
    // is gone by the time it is read. The gate tolerates and COUNTS that; this
    // asserts the count stays in the "a concurrent probe" range rather than the
    // "the tree moved underneath us" range.
    const m =
      /walked (\d+) server files(?: \((\d+) vanished mid-scan\))?; (\d+) model literals considered; comment-stripper self-test: (\d+)\/(\d+) correct/.exec(
        out,
      );
    expect(m, `the coverage line is gone:\n${out}`).not.toBeNull();
    expect(Number(m![1]), "the server walk collapsed").toBeGreaterThan(900);
    expect(
      Number(m![2] ?? 0),
      "too many files vanished mid-scan for this to be a concurrent probe",
    ).toBeLessThanOrEqual(3);
    expect(
      Number(m![3]),
      "the model-literal scan found almost nothing — the pattern or the walk broke",
    ).toBeGreaterThan(30);
    expect(Number(m![4]), "the comment stripper is failing its own cases").toBe(Number(m![5]));
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
    expect(out).toContain("probe.ts");
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
