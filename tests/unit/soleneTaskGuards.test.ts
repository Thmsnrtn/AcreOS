/**
 * Stage 2 task 2 — an empty answer is a FAILURE, a repeated identical tool
 * call is a LOOP, and every task has a turn budget. These guards bind BOTH the
 * coding runner (dispatchRunner) and the business role workers; the second
 * half of this file drives the coding runner itself with a model that answers
 * "Nothing further to add." and one that repeats a tool call, and asserts the
 * queue row is FAILED with the reason (not "completed").
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isEmptyResult,
  ToolLoopDetector,
  toolCallSignature,
  turnBudgetFor,
  MAX_IDENTICAL_TOOL_CALLS,
} from "../../server/services/solene/taskGuards";
import { DISPATCH_MAX_TURNS } from "../../shared/schema/solene-dispatch";

describe("isEmptyResult", () => {
  it.each([
    "",
    "   ",
    "Nothing further to add.",
    "nothing to add",
    "Done.",
    "N/A",
    "No action needed.",
    "No changes required",
    "...",
    "stand-in",
  ])("%j is empty — no work product", (t) => {
    expect(isEmptyResult(t)).toBe(true);
  });

  it.each([
    "Published the Travis County guide (<<<PUBLISH block below).",
    "Replied to ticket #4 and escalated #2 ($80 refund is over the limit).",
    "Done — replied to 3 tickets.",
  ])("%j carries work product", (t) => {
    expect(isEmptyResult(t)).toBe(false);
  });
});

describe("ToolLoopDetector", () => {
  it("flags the Nth identical call, regardless of argument key order", () => {
    const d = new ToolLoopDetector();
    expect(d.record("reply_to_ticket", { a: 1, b: 2 }).looped).toBe(false);
    expect(d.record("reply_to_ticket", { b: 2, a: 1 }).looped).toBe(false);
    const v = d.record("reply_to_ticket", { a: 1, b: 2 });
    expect(v.looped).toBe(true);
    expect(v.count).toBe(MAX_IDENTICAL_TOOL_CALLS);
    expect(v.reason).toMatch(/loop detected: reply_to_ticket was requested 3 times/);
  });

  it("does not flag distinct calls", () => {
    const d = new ToolLoopDetector();
    for (let i = 0; i < 10; i++) expect(d.record("reply_to_ticket", { ticket_id: i }).looped).toBe(false);
  });

  it("signature is canonical", () => {
    expect(toolCallSignature("x", { b: [1, { d: 1, c: 2 }], a: null })).toBe(
      toolCallSignature("x", { a: null, b: [1, { c: 2, d: 1 }] }),
    );
  });
});

describe("turnBudgetFor", () => {
  it("role workers get a small budget; code work keeps the platform cap", () => {
    expect(turnBudgetFor("writer")).toBeLessThan(DISPATCH_MAX_TURNS);
    expect(turnBudgetFor("support")).toBeLessThan(DISPATCH_MAX_TURNS);
    expect(turnBudgetFor(null)).toBe(DISPATCH_MAX_TURNS);
  });
});

// ── the coding runner obeys the same guards ─────────────────────────────────
const state = vi.hoisted(() => ({
  responses: [] as any[],
  failed: [] as any[],
  completed: [] as any[],
  executed: [] as string[],
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async () => {
        const r = state.responses.shift() ?? state.responses.at(-1);
        return r;
      },
    };
    constructor(_: unknown) {}
  },
}));
vi.mock("../../server/services/solene/dispatchQueue", () => ({
  completeDispatch: async (_id: number, r: unknown) => void state.completed.push(r),
  failDispatch: async (_id: number, r: unknown, o: unknown) => void state.failed.push({ r, o }),
  isDispatchCancelled: async () => false,
}));
vi.mock("../../server/services/solene/dispatchToolExecutor", () => ({
  getDispatchToolSchemas: () => [{ name: "git_status", description: "", input_schema: { type: "object" } }],
  executeDispatchTool: async (name: string) => {
    state.executed.push(name);
    return { success: true, output: "clean", durationMs: 1 };
  },
}));
vi.mock("../../server/services/solene/capitalTracker", () => ({
  recordCapitalEvent: async () => {},
  assertWithinEnsembleCap: async () => {},
}));
vi.mock("../../server/services/aiCostCeiling", () => ({ assertWithinAiCostCeiling: async () => {} }));
vi.mock("../../server/services/solene/preCallConstitutionalChecker", () => ({
  checkPromptAgainstConstitution: async () => null,
}));
vi.mock("../../server/services/solene/agentClaims", () => ({ listActiveClaims: async () => [] }));
vi.mock("../../server/services/solene/agentIdentity", () => ({ loadAgentIdentityBlock: async () => "" }));
vi.mock("../../server/services/solene/failureModeLibrary", () => ({ loadFailureModePreambleFor: async () => "" }));
vi.mock("../../server/services/solene/memoryRetrieval", () => ({
  retrieveCrossNamespaceMemories: async () => ({ retrieved: [] }),
  buildMultiNamespacePromptBlock: () => "",
}));

function row(over: Record<string, unknown> = {}) {
  return {
    id: 7,
    sourceType: "founder_manual",
    sourceId: "code-task",
    agentRole: "iris",
    promptText: "fix the thing",
    maxCostUsd: "5",
    timeoutMs: 60_000,
    model: null,
    ...over,
  } as any;
}
const text = (t: string) => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } });
const tool = (name: string, input: unknown) => ({
  content: [{ type: "tool_use", id: `t${Math.random()}`, name, input }],
  stop_reason: "tool_use",
  usage: { input_tokens: 10, output_tokens: 5 },
});

describe("dispatchRunner (coding) — empty answers and loops fail", () => {
  beforeEach(() => {
    state.responses = [];
    state.failed = [];
    state.completed = [];
    state.executed = [];
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.SOLENE_DISPATCH_TRANSCRIPT_DIR = "/tmp/b2-taskguards-transcripts";
  });

  it("'Nothing further to add.' ends the dispatch FAILED (empty_result), never completed", async () => {
    state.responses = [text("Nothing further to add.")];
    const { runDispatch } = await import("../../server/services/solene/dispatchRunner");
    const r = await runDispatch(row());
    expect(r.success).toBe(false);
    expect(r.terminationReason).toBe("empty_result");
    expect(state.completed).toHaveLength(0);
    expect(state.failed).toHaveLength(1);
    expect(String(state.failed[0].r.errorMessage)).toMatch(/empty_result/);
  });

  it("a real answer still completes", async () => {
    state.responses = [text("Fixed the null check in foo.ts:12; commit abc123.")];
    const { runDispatch } = await import("../../server/services/solene/dispatchRunner");
    const r = await runDispatch(row());
    expect(r.success).toBe(true);
    expect(state.completed).toHaveLength(1);
  });

  it("the same tool call three times ends the dispatch FAILED (loop_detected) and the 3rd call never runs", async () => {
    state.responses = [tool("git_status", {}), tool("git_status", {}), tool("git_status", {}), text("all good")];
    const { runDispatch } = await import("../../server/services/solene/dispatchRunner");
    const r = await runDispatch(row());
    expect(r.success).toBe(false);
    expect(r.terminationReason).toBe("loop_detected");
    expect(state.executed).toEqual(["git_status", "git_status"]);
    expect(String(state.failed[0].r.errorMessage)).toMatch(/loop detected: git_status was requested 3 times/);
  });
});
