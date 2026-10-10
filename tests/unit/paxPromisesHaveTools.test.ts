/**
 * Pax may not promise an action it has no tool for.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * The executive system prompt told Pax: if a question needs a human, say
 * "I'll flag this for the team" and stop. No tool flagged anything. The oracle
 * pass caught Pax making that promise three times (H8, H9, I4) — a small
 * fabricated capability, told to paying customers. The support chat's empty-
 * reply fallback did the same ("Let me escalate this to our support team")
 * without escalating.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * Over every file that holds text a Pax model is instructed with, or text a
 * customer reads from Pax (PROMPT_POPULATION — prompts, tool descriptions, tool
 * results, fallbacks, refusal wording):
 *
 *   1. A first-person promise of a hand-off or a later action ("I'll flag",
 *      "let me escalate", "I'll remind you", "we'll notify you") is allowed
 *      ONLY when the same passage names a tool that does it, and that tool is
 *      defined AND dispatched (a `case "<tool>":` in a dispatch switch). A
 *      bare promise — tool or no tool elsewhere — is an offender.
 *   2. Every tool a Pax prompt tells the model to use is both DEFINED (offered
 *      to the model) and DISPATCHED (a case in a switch). A prompt that says "call escalate_to_support" after the tool is
 *      removed is a promise with nothing behind it.
 *
 * Comments are stripped first (a real scan, scripts/lib/strip-comments.mjs),
 * so the record of what was removed does not read as the defect.
 *
 * ── FALSIFIED ───────────────────────────────────────────────────────────────
 * The block at the bottom runs the rule over mutated text and asserts it
 * fires. Recorded in-file mutations (reverted after each red run):
 *   - executive.ts: restore `say "I'll flag this for the team" and stop`: red.
 *   - tools.ts: delete the escalate_to_support definition AND case: red
 *     (rule 2 — the executive prompt still tells the model to call it).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripCommentsPreservingLines } from "../../scripts/lib/strip-comments.mjs";

const ROOT = path.resolve(__dirname, "../..");
const code = (rel: string) => stripCommentsPreservingLines(fs.readFileSync(path.join(ROOT, rel), "utf8")) as string;

/** Every file whose text instructs a Pax model or is read by a customer as Pax. */
const PROMPT_POPULATION = [
  "server/ai/executive.ts",
  // The executive system prompt moved here on 2026-10-09 so the eval can
  // compose the served prompt without loading executive.ts's providers.
  "server/ai/paxExecutivePrompt.ts",
  "server/ai/paxPromptVersions.ts",
  "server/ai/paxTurnNotes.ts",
  "server/ai/tools.ts",
  "server/ai/supportAgent.ts",
  "server/ai/paxSupportResolver.ts",
  "server/services/paxRefusalCopy.ts",
  "server/services/paxProductFacts.ts",
  "server/services/paxAccountReads.ts",
  "server/services/sendPricing.ts",
] as const;

/** Every dispatch switch a Pax model's tool call lands in. */
const TOOL_SWITCHES = ["server/ai/tools.ts", "server/ai/supportAgent.ts"] as const;

/** Files whose Pax prompts name tools for the model to call. */
const PROMPTS_NAMING_TOOLS: Array<{ file: string; from: string; to: string }> = [
  // executive.ts's agentProfiles now IMPORT the executive prompt (below) and
  // name only a couple of tools themselves; the prompt text is read where it lives.
  { file: "server/ai/paxExecutivePrompt.ts", from: "export const PAX_EXECUTIVE_SYSTEM_PROMPT = `", to: "`;" },
  { file: "server/ai/supportAgent.ts", from: "export const PAX_SYSTEM_PROMPT = `", to: "`;" },
];

interface PromiseClass {
  name: string;
  pattern: RegExp;
  /** Tools that can make this promise true. Empty = no Pax tool can. */
  backedBy: string[];
}

const FIRST_PERSON = String.raw`\b(?:I['’]ll|I will|I can|I['’]m going to|let me|we['’]ll|we will|I['’]ve)\s+(?:\w+\s+){0,2}?`;
const PROMISES: PromiseClass[] = [
  {
    name: "hand-off to a person",
    pattern: new RegExp(
      FIRST_PERSON + String.raw`(?:flag|flagged|escalate|escalated|pass|passed|forward|hand|report|raise)\b[^.\n"]{0,60}\b(?:team|support|human|person|someone|staff|founder)`,
      "gi",
    ),
    backedBy: ["escalate_to_support", "escalate_to_human"],
  },
  {
    name: "a later reminder or follow-up",
    pattern: new RegExp(FIRST_PERSON + String.raw`(?:remind|follow up|check back|get back to)\b`, "gi"),
    backedBy: ["schedule_follow_up", "schedule_followup", "create_task"],
  },
  {
    // M8 ("Am I profitable this year?"): Pax answered from the dashboard and
    // offered "I can total what you've logged in Finance" — no tool totalled
    // Finance. An offer to compute is a promise of a capability; it is allowed
    // only beside the tool that computes it. (This reads the text Pax is
    // GIVEN; what the model freely writes is steered by the prompt rule
    // asserted below and graded by the oracle pass, not provable here.)
    name: "an offer to compute or total data",
    pattern: new RegExp(FIRST_PERSON + String.raw`(?:total|sum up|add up|tally|compute|calculate|crunch|chart|graph|forecast)\b`, "gi"),
    backedBy: ["get_finance_summary", "get_cashflow_summary", "calculate_amortization", "calculate_roi", "calculate_payment_schedule"],
  },
  {
    name: "contacting the customer later",
    pattern: new RegExp(FIRST_PERSON + String.raw`(?:notify you|email you|text you|call you|let you know when)\b`, "gi"),
    backedBy: [],
  },
];

function dispatchedTools(): Set<string> {
  const out = new Set<string>();
  for (const f of TOOL_SWITCHES) {
    for (const m of code(f).matchAll(/\bcase "([a-z_0-9]+)":/g)) out.add(m[1]);
  }
  return out;
}

function definedTools(): Set<string> {
  const out = new Set<string>();
  for (const f of TOOL_SWITCHES) {
    for (const m of code(f).matchAll(/\n {2}([a-z_0-9]+): \{\n {4}name: "\1"/g)) out.add(m[1]);
  }
  return out;
}

/** Rule 1 over one text. */
function unbackedPromises(source: string, text: string, live: Set<string>): string[] {
  const out: string[] = [];
  for (const cls of PROMISES) {
    cls.pattern.lastIndex = 0;
    for (const m of text.matchAll(cls.pattern)) {
      const at = m.index ?? 0;
      const passage = text.slice(Math.max(0, at - 200), at + m[0].length + 200);
      const backed = cls.backedBy.some((t) => live.has(t) && new RegExp(`\\b${t}\\b`).test(passage));
      if (!backed) out.push(`${source}: "${m[0]}" (${cls.name}) — no tool named with it that does it`);
    }
  }
  return out;
}

const TOOL_TOKEN =
  /\b(?:get|send|create|update|complete|escalate|quote|calculate|run|research|generate|schedule|draft|browse|recall|remember|spawn|retrieve|extract|search|list|trigger|log|save|check|apply|fix|resolve|lookup|analyze|estimate)_[a-z_]+\b/g;

/** Rule 2 over one prompt block. */
function undefinedToolsNamed(source: string, text: string, live: Set<string>): string[] {
  return [...new Set(text.match(TOOL_TOKEN) ?? [])].filter((t) => !live.has(t)).map((t) => `${source}: names ${t}, which no switch dispatches`);
}

function promptBlock(spec: { file: string; from: string; to: string }): string {
  const src = code(spec.file);
  const i = src.indexOf(spec.from);
  const j = src.indexOf(spec.to, i + spec.from.length);
  return i >= 0 && j > i ? src.slice(i, j) : "";
}

describe("population", () => {
  it("every population file exists and is non-trivial (vacuity)", () => {
    for (const f of PROMPT_POPULATION) expect(code(f).length, f).toBeGreaterThan(1000);
  });

  it("both switches parse: definitions and cases found, and the hand-off tools are live", () => {
    const d = dispatchedTools();
    const def = definedTools();
    expect(d.size).toBeGreaterThan(120);
    expect(def.size).toBeGreaterThan(120);
    expect(d.has("escalate_to_support") && def.has("escalate_to_support")).toBe(true);
    expect(d.has("escalate_to_human") && def.has("escalate_to_human")).toBe(true);
  });

  it("each prompt block is found and names tools (vacuity)", () => {
    for (const spec of PROMPTS_NAMING_TOOLS) {
      const block = promptBlock(spec);
      expect(block.length, `${spec.file} prompt block not found`).toBeGreaterThan(2000);
      expect((block.match(TOOL_TOKEN) ?? []).length, `${spec.file} names no tools — parse broke`).toBeGreaterThan(5);
    }
  });
});

describe("rule 1 — no first-person promise without the tool that keeps it", () => {
  it("the population is clean", () => {
    const live = new Set([...dispatchedTools()].filter((t) => definedTools().has(t)));
    const offenders = PROMPT_POPULATION.flatMap((f) => unbackedPromises(f, code(f), live));
    expect(offenders).toEqual([]);
  });
});

describe("rule 2 — every tool a Pax prompt names is dispatched", () => {
  it("the prompts are clean", () => {
    // Offered (defined) AND dispatched: a definition with no case is a tool the
    // model can call that does nothing; a case with no definition is one it
    // cannot call at all.
    const def = definedTools();
    const live = new Set([...dispatchedTools()].filter((t) => def.has(t)));
    const offenders = PROMPTS_NAMING_TOOLS.flatMap((spec) => undefinedToolsNamed(spec.file, promptBlock(spec), live));
    expect(offenders).toEqual([]);
  });
});

describe("rule 3 — the executive prompt tells Pax to offer only what a tool can do", () => {
  it("states the limit, and names the tool that totals Finance", () => {
    const src = code("server/ai/paxExecutivePrompt.ts");
    expect(src).toMatch(/Offer only computations a tool can do/);
    expect(src).toMatch(/get_finance_summary/);
  });
});

describe("falsification — the rules fire on the defect's real shapes", () => {
  const live = new Set(["escalate_to_support", "escalate_to_human", "schedule_follow_up"]);

  it("the original sentence is an offender even with the hand-off tool live", () => {
    const old = `If a question truly requires a human (chargeback dispute, fraud claim), say "I'll flag this for the team" and stop.`;
    expect(unbackedPromises("mutant", old, live)).toHaveLength(1);
  });

  it("the support fallback's old wording is an offender", () => {
    expect(unbackedPromises("mutant", "I'm having trouble processing your request. Let me escalate this to our support team.", live)).toHaveLength(1);
  });

  it("a promise to contact the customer later has no tool that can keep it", () => {
    expect(unbackedPromises("mutant", "Done — I'll notify you when the export is ready.", live)).toHaveLength(1);
  });

  it("the M8 offer to total Finance is an offender, and is allowed beside the tool that does it", () => {
    const m8 = "No income recorded this year. I can total what you've logged in Finance if you like.";
    expect(unbackedPromises("mutant", m8, live)).toHaveLength(1);
    const live2 = new Set([...live, "get_finance_summary"]);
    expect(unbackedPromises("ok", "Call get_finance_summary, then I can total what it returns.", live2)).toEqual([]);
  });

  it("a promise conditioned on the tool that keeps it is allowed", () => {
    expect(unbackedPromises("ok", "If they want a person, call escalate_to_support; once it succeeds I can pass the ticket number on to the team.", live)).toEqual([]);
  });

  it("a prompt naming a removed tool is an offender", () => {
    const withoutTool = new Set([...live].filter((t) => t !== "escalate_to_support"));
    expect(undefinedToolsNamed("mutant", "call escalate_to_support", withoutTool)).toHaveLength(1);
  });
});
