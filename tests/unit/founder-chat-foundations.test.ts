/**
 * Phase A foundation tests for the Founder Chat (Atlas) infrastructure.
 * Covers tool registry, model selector, context resolver path resolution
 * + mention mining, and agentic-loop budget tracking.
 *
 * The executor + background-tasks tests touch the DB and live in their
 * own files so they can mock @shared/schema cleanly.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";

import {
  registerTool,
  getTool,
  getToolBySlashAlias,
  listTools,
  __resetRegistryForTests,
  type FounderTool,
} from "../../server/services/founder-chat/tool-registry";
import {
  selectModelForTurn,
  parseOverrideFromMessage,
  shortLabelForModel,
} from "../../server/services/founder-chat/model-selector";
import {
  TurnState,
  buildRetryGuidanceBlock,
  DEFAULT_MAX_TOOL_CALLS_PER_TURN,
  DEFAULT_RETRY_GUIDANCE_THRESHOLD,
} from "../../server/services/founder-chat/agentic-loop";

function fakeTool(overrides: Partial<FounderTool> = {}): FounderTool {
  return {
    name: overrides.name ?? "get_buckets",
    description: overrides.description ?? "Fetch bucket balances",
    category: overrides.category ?? "inquiry",
    destructive: overrides.destructive ?? false,
    tier: overrides.tier ?? 1,
    schema: overrides.schema ?? z.object({}),
    slashAliases: overrides.slashAliases,
    artifactType: overrides.artifactType,
    handler: overrides.handler ?? (async () => ({ artifact: { type: "text", markdown: "ok" } })),
  } as FounderTool;
}

describe("founder-chat tool-registry", () => {
  beforeEach(() => {
    __resetRegistryForTests();
  });

  it("registers and looks up a tool by name", () => {
    registerTool(fakeTool({ name: "get_buckets" }));
    const t = getTool("get_buckets");
    expect(t?.name).toBe("get_buckets");
  });

  it("registers slash aliases case-insensitively", () => {
    registerTool(fakeTool({ name: "get_buckets", slashAliases: ["buckets", "B"] }));
    expect(getToolBySlashAlias("buckets")?.name).toBe("get_buckets");
    expect(getToolBySlashAlias("BUCKETS")?.name).toBe("get_buckets");
    expect(getToolBySlashAlias("b")?.name).toBe("get_buckets");
    expect(getToolBySlashAlias("nope")).toBeUndefined();
  });

  it("rejects duplicate tool names", () => {
    registerTool(fakeTool({ name: "get_buckets" }));
    expect(() => registerTool(fakeTool({ name: "get_buckets" }))).toThrow(/duplicate/i);
  });

  it("filters list by category + tier", () => {
    registerTool(fakeTool({ name: "a", category: "inquiry", tier: 1 }));
    registerTool(fakeTool({ name: "b", category: "action", tier: 2, destructive: true }));
    registerTool(fakeTool({ name: "c", category: "action", tier: 3, destructive: true }));

    expect(listTools({ category: "action" }).map((t) => t.name).sort()).toEqual(["b", "c"]);
    expect(listTools({ tier: 1 }).map((t) => t.name)).toEqual(["a"]);
    expect(listTools({ category: "action", tier: 3 }).map((t) => t.name)).toEqual(["c"]);
    expect(listTools().length).toBe(3);
  });
});

describe("founder-chat model-selector", () => {
  it("defaults reasoning + code_generation + morning_brief to Opus", () => {
    expect(selectModelForTurn({ intent: "reasoning" }).model).toContain("opus");
    expect(selectModelForTurn({ intent: "code_generation" }).model).toContain("opus");
    expect(selectModelForTurn({ intent: "morning_brief" }).model).toContain("opus");
    expect(selectModelForTurn({ intent: "default" }).model).toContain("opus");
  });

  it("downgrades slot-filling to Haiku and formatting to Sonnet", () => {
    expect(selectModelForTurn({ intent: "tool_arg_extraction" }).model).toContain("haiku");
    expect(selectModelForTurn({ intent: "format_tool_result" }).model).toContain("sonnet");
  });

  it("override beats intent default", () => {
    expect(selectModelForTurn({ intent: "reasoning", override: "haiku" }).model).toContain("haiku");
    expect(selectModelForTurn({ intent: "tool_arg_extraction", override: "opus" }).model).toContain("opus");
  });

  it("threadDefault is honored when no per-turn override", () => {
    expect(selectModelForTurn({ intent: "reasoning", threadDefault: "sonnet" }).model).toContain("sonnet");
  });

  it("parses /opus /sonnet /haiku /fast /cheap prefixes", () => {
    expect(parseOverrideFromMessage("/opus debug this")).toEqual({ override: "opus", cleanedMessage: "debug this" });
    expect(parseOverrideFromMessage("/fast show me buckets")).toEqual({ override: "fast", cleanedMessage: "show me buckets" });
    expect(parseOverrideFromMessage("show me buckets")).toEqual({ override: null, cleanedMessage: "show me buckets" });
  });

  it("shortLabelForModel maps known models", () => {
    expect(shortLabelForModel("anthropic/claude-opus-4-7")).toBe("Opus 4.7");
    expect(shortLabelForModel("anthropic/claude-sonnet-4-6")).toBe("Sonnet 4.6");
    expect(shortLabelForModel("anthropic/claude-haiku-4-5")).toBe("Haiku 4.5");
    expect(shortLabelForModel("some/other-model")).toBe("some/other-model");
  });
});

describe("founder-chat agentic-loop TurnState", () => {
  it("respects maxToolCalls budget", () => {
    const state = new TurnState({ maxToolCalls: 3, retryGuidanceThreshold: 99 });
    expect(state.canCallMoreTools()).toBe(true);
    state.recordToolRun({ toolName: "a", success: true });
    state.recordToolRun({ toolName: "b", success: true });
    expect(state.canCallMoreTools()).toBe(true);
    state.recordToolRun({ toolName: "c", success: true });
    expect(state.canCallMoreTools()).toBe(false);
  });

  it("counts consecutive same-error failures and triggers retry guidance", () => {
    const state = new TurnState({ maxToolCalls: 99, retryGuidanceThreshold: 3 });
    state.recordToolRun({ toolName: "propose_edit", success: false, errorClass: "test_fail" });
    state.recordToolRun({ toolName: "propose_edit", success: false, errorClass: "test_fail" });
    expect(state.shouldInjectRetryGuidance()).toBeNull();
    state.recordToolRun({ toolName: "propose_edit", success: false, errorClass: "test_fail" });
    expect(state.shouldInjectRetryGuidance()).toEqual({
      toolName: "propose_edit",
      errorClass: "test_fail",
    });
  });

  it("success resets the consecutive failure counter for that tool", () => {
    const state = new TurnState({ maxToolCalls: 99, retryGuidanceThreshold: 2 });
    state.recordToolRun({ toolName: "x", success: false, errorClass: "e" });
    state.recordToolRun({ toolName: "x", success: false, errorClass: "e" });
    expect(state.shouldInjectRetryGuidance()).toEqual({ toolName: "x", errorClass: "e" });

    state.recordToolRun({ toolName: "x", success: true });
    expect(state.shouldInjectRetryGuidance()).toBeNull();
  });

  it("different error class resets the counter (we want SAME-error streaks only)", () => {
    const state = new TurnState({ maxToolCalls: 99, retryGuidanceThreshold: 3 });
    state.recordToolRun({ toolName: "x", success: false, errorClass: "a" });
    state.recordToolRun({ toolName: "x", success: false, errorClass: "a" });
    state.recordToolRun({ toolName: "x", success: false, errorClass: "b" });  // different class
    expect(state.shouldInjectRetryGuidance()).toBeNull();
  });

  it("escalates to founder when total failures >= 5", () => {
    const state = new TurnState({ maxToolCalls: 99, retryGuidanceThreshold: 99 });
    for (let i = 0; i < 4; i++) {
      state.recordToolRun({ toolName: `t${i}`, success: false, errorClass: `e${i}` });
    }
    expect(state.shouldEscalateToFounder()).toBe(false);
    state.recordToolRun({ toolName: "t5", success: false, errorClass: "e5" });
    expect(state.shouldEscalateToFounder()).toBe(true);
  });

  it("buildRetryGuidanceBlock includes tool name + error class", () => {
    const block = buildRetryGuidanceBlock({ toolName: "propose_edit", errorClass: "ci_fail" });
    expect(block).toContain("`propose_edit`");
    expect(block).toContain("`ci_fail`");
    expect(block).toContain("Step back");
  });

  it("default thresholds match exported constants", () => {
    expect(DEFAULT_MAX_TOOL_CALLS_PER_TURN).toBe(10);
    expect(DEFAULT_RETRY_GUIDANCE_THRESHOLD).toBe(3);
  });
});
