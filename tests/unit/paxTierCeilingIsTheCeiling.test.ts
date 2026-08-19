/**
 * The paid-tier ceiling is the ceiling: nothing the REQUEST carries may pick
 * Pax's model.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `ai/executive.ts` resolved the model as
 *
 *     model = options.modelOverride || visionFallback || costRoutedCeiling || result.model
 *
 * under a comment saying `modelOverride` was for the "founder dashboard, eval
 * harness". Grep found exactly one setter: the customer-facing
 * `POST /api/ai/chat/stream`, whose zod enum any authenticated member could
 * populate. So a request field sat AHEAD of `pickPaxModelForOrg`'s tier ceiling
 * and its monthly soft-cap downgrade — the margin guard the same codebase built
 * deliberately (`campaignOptimizer.ts:186`, "Margin guard (S3 follow-up)").
 *
 * It was invisible because it was also broken in the other direction: the rail
 * sent `fast|balanced|powerful|reasoning|claude` and the enum accepted raw model
 * ids, the two sets did not intersect, and every selection except "Auto"
 * returned a 422. Six of the seven enum ids were names no provider in this
 * system serves. Nobody could reach the path that would have exceeded the
 * ceiling, so nobody noticed that it could.
 *
 * Owner decision OD-7 (2026-08-19): remove the picker from the customer rail
 * and the field from the customer schema.
 *
 * ── WHAT THIS FILE GOVERNS ──────────────────────────────────────────────────
 * Not the identifier `modelOverride`. Renaming it would satisfy a gate that
 * only looked for that word while reintroducing the defect exactly. What is
 * pinned is the SHAPE: every expression that can become Pax's chosen model must
 * come from the server's own routing, and the request-body schemas must carry
 * no model-selection key at all.
 *
 * Every predicate below is applied twice — once to the real source, and once to
 * a MUTATED copy that reintroduces the defect. A predicate that passes both is
 * decoration, and the mutation cases are here so that cannot go unnoticed.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripCommentsPreservingLines } from "../../scripts/lib/strip-comments.mjs";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => stripCommentsPreservingLines(fs.readFileSync(path.join(ROOT, p), "utf8"));

const EXECUTIVE = "server/ai/executive.ts";
const ROUTES_AI = "server/routes-ai.ts";

/**
 * The only expressions allowed to become the chosen model. Each is computed by
 * the server from the org's tier, the turn's content, or the router — never
 * from the request body.
 */
const SERVER_SOURCED = new Set(["visionFallback", "costRoutedCeiling", "result.model"]);

/** Every `model = <expr> || <expr> …;` assignment, as its list of operands. */
function modelAssignmentOperands(src: string): string[][] {
  const out: string[][] = [];
  // `model =` at statement position (not `const model =`, not `.model =`),
  // through the terminating semicolon, across newlines.
  const re = /(?<![.\w])model\s*=\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const operands = m[1]
      .split("||")
      .map((o) => o.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    // Only the multi-operand resolution chains; single assignments elsewhere in
    // the file (`model = shadow.model` in a log line, say) are not this rule.
    if (operands.length > 1) out.push(operands);
  }
  return out;
}

/** Operands in a resolution chain that are NOT server-sourced. */
function foreignOperands(src: string): string[] {
  return modelAssignmentOperands(src)
    .flat()
    .filter((o) => !SERVER_SOURCED.has(o));
}

/** Keys inside the request-body zod schemas that mention a model. */
function modelKeysInChatSchemas(src: string): string[] {
  const found: string[] = [];
  for (const name of ["aiChatSchema", "aiChatStreamSchema"]) {
    const start = src.indexOf(`const ${name} = z.object({`);
    if (start === -1) continue;
    // Balanced-ish: read to the first `});` at the schema's indentation.
    const end = src.indexOf("\n  });", start);
    const body = src.slice(start, end === -1 ? src.length : end);
    for (const km of body.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)) {
      if (/model/i.test(km[1])) found.push(`${name}.${km[1]}`);
    }
  }
  return found;
}

/** Fields on the ChatOptions contract that mention a model. */
function modelKeysInChatOptions(src: string): string[] {
  const start = src.indexOf("interface ChatOptions {");
  if (start === -1) return ["<ChatOptions not found>"];
  const body = src.slice(start, src.indexOf("\n}", start));
  return [...body.matchAll(/^\s*([A-Za-z_$][\w$]*)\??\s*:/gm)]
    .map((m) => m[1])
    .filter((k) => /model/i.test(k));
}

describe("the resolution chain draws only from server-computed sources", () => {
  it("vacuity: the chains are still there and still have alternatives", () => {
    // If the regex stops matching, every assertion below passes over an empty
    // list — which is the shape of a gate certifying a file it never read.
    const chains = modelAssignmentOperands(read(EXECUTIVE));
    expect(
      chains.length,
      "no multi-operand `model = …` chain found in executive.ts — the scan broke, " +
        "or the resolution moved and this gate now guards nothing",
    ).toBeGreaterThanOrEqual(2);
    for (const c of chains) expect(c.length).toBeGreaterThanOrEqual(3);
  });

  it("no request-derived operand can become the model", () => {
    expect(
      foreignOperands(read(EXECUTIVE)),
      "an operand outside the server-sourced set can win the model resolution. " +
        "If it is legitimately server-computed, add it to SERVER_SOURCED with a " +
        "reason; if it comes from the request, it must not outrank the tier ceiling.",
    ).toEqual([]);
  });

  it("FIRES when the defect is reintroduced under a different name", () => {
    // The mutation is the point: `options.tierBoost` is not the identifier this
    // gate was written about, and it is exactly the same defect.
    const mutated = read(EXECUTIVE).replace(
      "    model = visionFallback",
      "    model = options.tierBoost\n      || visionFallback",
    );
    expect(mutated, "the mutation did not apply — re-anchor it").not.toBe(read(EXECUTIVE));
    expect(foreignOperands(mutated)).toContain("options.tierBoost");
  });

  it("does NOT fire on a rearrangement of the legitimate operands", () => {
    // The negative control. A gate that fails on any edit to this line gets
    // deleted the first time someone reorders it for a good reason.
    const rearranged = read(EXECUTIVE).replace(
      "    model = visionFallback\n      || costRoutedCeiling\n      || result.model;",
      "    model = costRoutedCeiling\n      || visionFallback\n      || result.model;",
    );
    expect(rearranged).not.toBe(read(EXECUTIVE));
    expect(foreignOperands(rearranged)).toEqual([]);
  });
});

describe("the chat request schemas carry no model-selection key", () => {
  it("vacuity: both schemas were found and parsed", () => {
    const src = read(ROUTES_AI);
    expect(src).toContain("const aiChatSchema = z.object({");
    expect(src).toContain("const aiChatStreamSchema = z.object({");
    // A schema body that parsed to nothing would make the key check trivially
    // pass, so assert the parser sees the fields that ARE there.
    const start = src.indexOf("const aiChatStreamSchema = z.object({");
    const body = src.slice(start, src.indexOf("\n  });", start));
    const keys = [...body.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)].map((m) => m[1]);
    expect(keys, `the stream schema parsed to ${keys.length} keys`).toContain("message");
    expect(keys.length).toBeGreaterThanOrEqual(4);
  });

  it("neither chat schema accepts a model key", () => {
    expect(
      modelKeysInChatSchemas(read(ROUTES_AI)),
      "a customer-supplied model selector is back on a chat route. Pax's model " +
        "is the server's decision, bounded by the org's paid tier.",
    ).toEqual([]);
  });

  it("FIRES when a model key is added back to a chat schema", () => {
    const mutated = read(ROUTES_AI).replace(
      "    activeProjectId: z.number().int().optional(),",
      "    activeProjectId: z.number().int().optional(),\n    preferredModel: z.string().optional(),",
    );
    expect(mutated).not.toBe(read(ROUTES_AI));
    expect(modelKeysInChatSchemas(mutated)).toContain("aiChatStreamSchema.preferredModel");
  });

  it("ChatOptions itself carries no model-override field", () => {
    // The type is the other door into the same chain: `processChat` has four
    // callers, and a field on the options object is reachable from any of them.
    const keys = modelKeysInChatOptions(read(EXECUTIVE));
    expect(keys, `ChatOptions exposes model-selection field(s): ${keys.join(", ")}`).toEqual([]);
  });

  it("FIRES when ChatOptions grows one back", () => {
    const mutated = read(EXECUTIVE).replace(
      "interface ChatOptions {",
      "interface ChatOptions {\n  pinnedModel?: string;",
    );
    expect(mutated).not.toBe(read(EXECUTIVE));
    expect(modelKeysInChatOptions(mutated)).toContain("pinnedModel");
  });
});

describe("the client no longer offers a model picker", () => {
  const RAIL = "client/src/components/pax-copilot-rail.tsx";

  it("sends no model field and keeps no model preference", () => {
    const src = read(RAIL);
    expect(src, "the rail is posting a model selection again").not.toMatch(
      /body\.[A-Za-z_$][\w$]*[Mm]odel/,
    );
    expect(src, "the stale localStorage preference is back").not.toContain(
      "pax_model_override",
    );
  });

  it("vacuity: the file is the rail, and it does build a request body", () => {
    // Both assertions above are absence checks, and absence over the wrong file
    // is free. This says the scan is looking at the thing it claims to.
    const src = read(RAIL);
    expect(src).toContain("/api/ai/chat/stream");
    expect(src).toMatch(/const body: Record<string, any> = \{/);
  });
});
