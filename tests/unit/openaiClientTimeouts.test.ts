/**
 * P1-16 D1 pin: every OpenAI-client construction in server/ is bounded.
 *
 * The OpenAI SDK defaults (10-minute timeout / 2 retries) hold a Node
 * socket for up to 30 minutes per request under a provider stall,
 * exhausting the connection pool — the hazard aiRouter's construction
 * comment names and bounds at 30s / 1 retry. Five constructions
 * (utils/openaiClient, ai/vaService, services/supportBrain,
 * services/modelIntelligence, routes-founder-chat) carried no bound
 * until D1. This test walks every non-test source file under server/,
 * finds each `new OpenAI(` construction, and asserts its options carry
 * `timeout: 30_000` and `maxRetries: 1` — inline, or via an identifier
 * (spread or passed whole, the aiByok `common` shape) whose in-file
 * declaration carries both.
 *
 * Comment mentions are not constructions: a match whose line is a
 * `//` or block-comment line is skipped (two files quote the old
 * module-level construction in prose explaining why it was removed).
 */
import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

// The sweep reads every server source file; under the coverage run on a
// shared CI runner that can exceed the default 30s test timeout.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.join(__dirname, "..", "..");
const SERVER_DIR = path.join(ROOT, "server");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** Extract the balanced-paren argument text starting at the `(` index. */
function extractArgs(src: string, openParenIdx: number): string {
  let depth = 0;
  for (let i = openParenIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return src.slice(openParenIdx + 1, i);
    }
  }
  return src.slice(openParenIdx + 1);
}

function isCommentLine(src: string, idx: number): boolean {
  const lineStart = src.lastIndexOf("\n", idx) + 1;
  const before = src.slice(lineStart, idx).trim();
  return before.startsWith("//") || before.startsWith("*") || before.startsWith("/*");
}

/** Does this construction's options text carry both bounds? */
function optionsAreBounded(src: string, args: string): boolean {
  if (/timeout\s*:\s*30_000/.test(args) && /maxRetries\s*:\s*1\b/.test(args)) return true;
  // Identifier shape: `new OpenAI(common)` or `{ ...common, ... }` where
  // the in-file declaration of that identifier carries both bounds.
  const identifiers = new Set<string>();
  const bare = args.trim().match(/^([A-Za-z_$][\w$]*)$/);
  if (bare) identifiers.add(bare[1]);
  for (const m of args.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)) identifiers.add(m[1]);
  for (const id of identifiers) {
    const decl = new RegExp(`(?:const|let|var)\\s+${id}\\s*(?::[^=]+)?=\\s*\\{([\\s\\S]*?)\\}`);
    const dm = src.match(decl);
    if (dm && /timeout\s*:\s*30_000/.test(dm[1]) && /maxRetries\s*:\s*1\b/.test(dm[1])) return true;
  }
  return false;
}

type Construction = { file: string; args: string; bounded: boolean };

function findConstructions(): Construction[] {
  const found: Construction[] = [];
  for (const file of walk(SERVER_DIR)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/new OpenAI\s*\(/g)) {
      if (isCommentLine(src, m.index)) continue;
      const args = extractArgs(src, m.index + m[0].length - 1);
      found.push({
        file: path.relative(ROOT, file),
        args,
        bounded: optionsAreBounded(src, args),
      });
    }
  }
  return found;
}

describe("OpenAI client constructions are timeout-bounded (P1-16 D1)", () => {
  const constructions = findConstructions();

  it("finds the known construction population", () => {
    const files = [...new Set(constructions.map((c) => c.file))].sort();
    expect(files).toEqual(
      [
        "server/ai/supportAgent.ts",
        "server/ai/vaService.ts",
        "server/routes-founder-chat.ts",
        "server/services/aiRouter.ts",
        "server/services/byok/aiByok.ts",
        "server/services/modelIntelligence.ts",
        "server/services/supportBrain.ts",
        "server/utils/openaiClient.ts",
      ].sort(),
    );
    expect(constructions.length).toBeGreaterThanOrEqual(10);
  });

  it("every construction carries timeout: 30_000 and maxRetries: 1", () => {
    const unbounded = constructions.filter((c) => !c.bounded).map((c) => c.file);
    expect(unbounded).toEqual([]);
  });
});
