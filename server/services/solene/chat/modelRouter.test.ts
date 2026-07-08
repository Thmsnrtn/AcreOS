/**
 * Tests for modelRouter — shortcut rules + tier selection + cost estimation.
 *
 * The classifier-fallback path is exercised by stubbing streamChatCompletion
 * to yield a synthetic completion that returns a tier token.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mutable stub array — tests can swap the events the classifier sees.
let CLASSIFIER_EVENTS: any[] = [];

vi.mock("./openRouterClient", async () => {
  const actual: any = await vi.importActual("./openRouterClient");
  return {
    ...actual,
    async *streamChatCompletion() {
      for (const e of CLASSIFIER_EVENTS) yield e;
    },
  };
});

import {
  applyShortcutRules,
  classifyWithFastModel,
  estimateCost,
  routeQuery,
  tierFromModelName,
} from "./modelRouter";
import { CHAT_MODELS } from "@shared/schema/solene-chat-config";

// ============================================================================
// applyShortcutRules — pure
// ============================================================================

describe("applyShortcutRules", () => {
  it("routes to strategic when 'deploy' appears", () => {
    const r = applyShortcutRules("Please fly deploy now", []);
    expect(r?.tier).toBe("strategic");
  });

  it("routes to code when a .ts extension is in the message", () => {
    const r = applyShortcutRules("review server/foo.ts please", []);
    expect(r?.tier).toBe("code");
  });

  it("routes to code on fenced code blocks", () => {
    const r = applyShortcutRules(
      "Here is the function:\n```\nfunction x() {}\n```",
      [],
    );
    expect(r?.tier).toBe("code");
  });

  it("routes to fast on a short imperative without ?", () => {
    const r = applyShortcutRules("list active claims", []);
    expect(r?.tier).toBe("fast");
  });

  it("returns null for a regular question to fall through to classifier", () => {
    const r = applyShortcutRules(
      "What did Soren accomplish on the v605 landing redesign last week, and how does it compare to v604?",
      [],
    );
    expect(r).toBeNull();
  });

  it("sticky-routes to prior assistant's tier on long convos", () => {
    const history = [
      { role: "user" as const, textContent: "hi", modelUsed: null },
      { role: "assistant" as const, textContent: "ok", modelUsed: CHAT_MODELS.STRATEGIC },
      { role: "user" as const, textContent: "more", modelUsed: null },
      { role: "assistant" as const, textContent: "ok", modelUsed: CHAT_MODELS.STRATEGIC },
      { role: "user" as const, textContent: "again", modelUsed: null },
      { role: "assistant" as const, textContent: "ok", modelUsed: CHAT_MODELS.STRATEGIC },
    ];
    const r = applyShortcutRules(
      "Continuing the strategic line of reasoning we had going on this",
      history,
    );
    expect(r?.tier).toBe("strategic");
  });
});

// ============================================================================
// tierFromModelName
// ============================================================================

describe("tierFromModelName", () => {
  it("maps STRATEGIC + FAST model ids back to their tiers", () => {
    expect(tierFromModelName(CHAT_MODELS.STRATEGIC)).toBe("strategic");
    expect(tierFromModelName(CHAT_MODELS.FAST)).toBe("fast");
  });
  it("CONVERSATIONAL + CODE may share a model id; tier resolves to one of them deterministically", () => {
    // By default CONVERSATIONAL + CODE point at the same Sonnet build; the
    // lookup walks STRATEGIC → CONVERSATIONAL → FAST → CODE so it returns
    // 'conversational' when both share the same id. (When env overrides
    // split them, both will resolve cleanly.)
    const t1 = tierFromModelName(CHAT_MODELS.CONVERSATIONAL);
    const t2 = tierFromModelName(CHAT_MODELS.CODE);
    expect(["conversational", "code"]).toContain(t1);
    expect(["conversational", "code"]).toContain(t2);
  });
  it("returns null on unknown model ids", () => {
    expect(tierFromModelName("openai/gpt-9-turbo")).toBeNull();
  });
});

// ============================================================================
// estimateCost
// ============================================================================

describe("estimateCost", () => {
  it("scales linearly with input + output tokens", () => {
    const c1 = estimateCost({
      tier: "strategic",
      estimatedInputTokens: 1_000_000,
      estimatedOutputTokens: 0,
    });
    // strategic input = $5 / M (Opus 4.8 — corrected 2026-07-08 from the
    // stale $15/$75 pre-4.6 Opus price the table used to carry)
    expect(c1).toBeCloseTo(5, 4);
    const c2 = estimateCost({
      tier: "strategic",
      estimatedInputTokens: 0,
      estimatedOutputTokens: 1_000_000,
    });
    expect(c2).toBeCloseTo(25, 4);
  });

  it("applies cachedInputTokens at the discounted rate", () => {
    const c = estimateCost({
      tier: "conversational",
      estimatedInputTokens: 1_000_000,
      estimatedOutputTokens: 0,
      cachedInputTokens: 1_000_000,
    });
    // conversational cachedInput = $0.30 / M
    expect(c).toBeCloseTo(0.3, 4);
  });

  it("fast tier is meaningfully cheaper than conversational for the same query", () => {
    const fast = estimateCost({
      tier: "fast",
      estimatedInputTokens: 5000,
      estimatedOutputTokens: 500,
    });
    const conv = estimateCost({
      tier: "conversational",
      estimatedInputTokens: 5000,
      estimatedOutputTokens: 500,
    });
    expect(fast).toBeLessThan(conv);
    // Haiku 4.5 is $1/$5 vs Sonnet's $3/$15 — a real 3x, not the 12x the
    // old Haiku-3.5-era ($0.25/$1.25) row fabricated (corrected 2026-07-08).
    expect(conv / fast).toBeCloseTo(3, 1);
  });
});

// ============================================================================
// classifyWithFastModel — uses the stubbed streamChatCompletion
// ============================================================================

describe("classifyWithFastModel", () => {
  beforeEach(() => {
    CLASSIFIER_EVENTS = [];
  });

  it("returns the tier matching the classifier token", async () => {
    CLASSIFIER_EVENTS = [
      { type: "text_delta", delta: "CONVERSATIONAL" },
      { type: "message_done", stopReason: "end_turn", usage: { inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, cacheCreationTokens: 0 } },
    ];
    const t = await classifyWithFastModel("describe rosy river");
    expect(t).toBe("conversational");
  });

  it("recognizes STRATEGIC + CODE + FAST tokens", async () => {
    for (const [token, expected] of [
      ["STRATEGIC", "strategic"],
      ["CODE", "code"],
      ["FAST", "fast"],
    ] as const) {
      CLASSIFIER_EVENTS = [
        { type: "text_delta", delta: token },
        { type: "message_done", stopReason: "end_turn", usage: { inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, cacheCreationTokens: 0 } },
      ];
      const t = await classifyWithFastModel("anything");
      expect(t).toBe(expected);
    }
  });

  it("returns null on unrecognized token", async () => {
    CLASSIFIER_EVENTS = [
      { type: "text_delta", delta: "NONSENSE" },
      { type: "message_done", stopReason: "end_turn", usage: { inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, cacheCreationTokens: 0 } },
    ];
    const t = await classifyWithFastModel("anything");
    expect(t).toBeNull();
  });

  it("returns null when stream errors", async () => {
    CLASSIFIER_EVENTS = [{ type: "error", message: "boom" }];
    const t = await classifyWithFastModel("anything");
    expect(t).toBeNull();
  });
});

// ============================================================================
// routeQuery — end-to-end
// ============================================================================

describe("routeQuery", () => {
  beforeEach(() => {
    CLASSIFIER_EVENTS = [];
  });

  it("honors a caller-provided hint without invoking classifier", async () => {
    const r = await routeQuery({
      userMessage: "anything",
      conversationHistory: [],
      hint: "strategic",
    });
    expect(r.tier).toBe("strategic");
    expect(r.model).toBe(CHAT_MODELS.STRATEGIC);
    expect(r.fastClassificationLatencyMs).toBe(0);
  });

  it("uses shortcut rule before the classifier", async () => {
    const r = await routeQuery({
      userMessage: "Please fly deploy production",
      conversationHistory: [],
    });
    expect(r.tier).toBe("strategic");
    expect(r.rationale).toMatch(/Strategic/);
  });

  it("falls through to classifier when no rule matches", async () => {
    CLASSIFIER_EVENTS = [
      { type: "text_delta", delta: "CONVERSATIONAL" },
      { type: "message_done", stopReason: "end_turn", usage: { inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, cacheCreationTokens: 0 } },
    ];
    const r = await routeQuery({
      userMessage:
        "Could you summarize Soren's launch campaign results from last week and compare them to the prior wave?",
      conversationHistory: [],
    });
    expect(r.tier).toBe("conversational");
    expect(r.rationale).toMatch(/Classifier/);
  });

  it("defaults to conversational when classifier returns null", async () => {
    CLASSIFIER_EVENTS = [
      { type: "text_delta", delta: "GIBBERISH" },
      { type: "message_done", stopReason: "end_turn", usage: { inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, cacheCreationTokens: 0 } },
    ];
    const r = await routeQuery({
      userMessage:
        "What might be a reasonable approach to Q3 narrative positioning for the land-investor segment?",
      conversationHistory: [],
    });
    expect(r.tier).toBe("conversational");
  });
});

afterEach(() => {
  CLASSIFIER_EVENTS = [];
});
