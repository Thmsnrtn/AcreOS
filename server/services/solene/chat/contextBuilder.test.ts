/**
 * Tests for contextBuilder — budget enforcement + static/dynamic split
 * + cache-boundary correctness.
 *
 * memoryFileStore + memoryRetrieval are stubbed so no DB is required.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// In-memory stubs the tests can prime.
const MEMORY_FILES = new Map<string, { body: string; description: string | null }>();
let FEEDBACK_INDEX: Array<{ slug: string; description: string | null }> = [];
let RETRIEVAL_RESULTS: Array<{ sourceRef: string; contentSnippet: string; similarityScore: number }> = [];

vi.mock("../memoryFileStore", () => ({
  async getMemoryFile(slug: string) {
    const row = MEMORY_FILES.get(slug);
    if (!row) return null;
    return {
      id: 1,
      slug,
      fileBasename: `${slug}.md`,
      type: "feedback",
      description: row.description,
      body: row.body,
      bodySha256: "x",
      updatedAt: new Date(),
      lastSyncedFromLocalAt: new Date(),
      metadata: {},
    };
  },
  async listMemoryFiles() {
    return FEEDBACK_INDEX.map((f) => ({
      id: 1,
      slug: f.slug,
      fileBasename: `${f.slug}.md`,
      type: "feedback",
      description: f.description,
      body: "",
      bodySha256: "x",
      updatedAt: new Date(),
      lastSyncedFromLocalAt: new Date(),
      metadata: {},
    }));
  },
}));

vi.mock("../learningLoop", () => ({
  async retrieveRelevantMemories() {
    return {
      retrievalEventId: 1,
      retrieved: RETRIEVAL_RESULTS,
      latencyMs: 5,
    };
  },
}));

import {
  buildChatContext,
  estimateTokens,
  trimToBudget,
  type ContextBlock,
} from "./contextBuilder";

beforeEach(() => {
  MEMORY_FILES.clear();
  FEEDBACK_INDEX = [];
  RETRIEVAL_RESULTS = [];
});

// ============================================================================
// estimateTokens
// ============================================================================

describe("estimateTokens", () => {
  it("approximates chars/4, rounded up", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(100))).toBe(25);
    expect(estimateTokens("")).toBe(0);
  });
});

// ============================================================================
// trimToBudget
// ============================================================================

describe("trimToBudget", () => {
  function block(
    label: string,
    priority: number,
    tokens: number,
    isStatic = false,
  ): ContextBlock {
    return {
      source: isStatic ? "constitution" : "retrieval",
      label,
      content: "x".repeat(tokens * 4),
      tokens,
      priority,
      isStatic,
    };
  }

  it("keeps everything when under budget", () => {
    const { kept, dropped, totalTokens } = trimToBudget(
      [block("a", 50, 100), block("b", 40, 100)],
      1000,
    );
    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(0);
    expect(totalTokens).toBe(200);
  });

  it("drops lowest-priority dynamic blocks when over budget", () => {
    const blocks = [
      block("constitution", 100, 500, true),
      block("high-priority", 80, 400),
      block("low-priority", 10, 400),
    ];
    const { kept, dropped } = trimToBudget(blocks, 1000);
    const keptLabels = kept.map((b) => b.label).sort();
    expect(keptLabels).toContain("constitution");
    expect(keptLabels).toContain("high-priority");
    expect(dropped.map((b) => b.label)).toEqual(["low-priority"]);
  });

  it("preserves static blocks over dynamic regardless of priority", () => {
    const blocks = [
      block("dyn-high", 99, 500, false), // dynamic high prio
      block("static-low", 10, 500, true), // static low prio
    ];
    const { kept } = trimToBudget(blocks, 600);
    // Static comes first, takes the 500 tokens; dynamic 99 dropped.
    expect(kept.map((b) => b.label)).toEqual(["static-low"]);
  });
});

// ============================================================================
// buildChatContext
// ============================================================================

describe("buildChatContext", () => {
  it("loads the always-load briefs into the static prefix", async () => {
    MEMORY_FILES.set("acreos_constitution", {
      body: "## constitution body",
      description: "the constitution",
    });
    MEMORY_FILES.set("acreos_company_charter", {
      body: "## charter body",
      description: "the charter",
    });
    MEMORY_FILES.set("team_solene", {
      body: "## solene brief",
      description: "Solene COO brief",
    });

    const out = await buildChatContext({
      userMessage: "hi",
      conversationId: 1,
      tier: "conversational",
    });

    expect(out.staticPrefix).toContain("constitution body");
    expect(out.staticPrefix).toContain("charter body");
    expect(out.staticPrefix).toContain("solene brief");
    expect(out.staticPrefix).toContain("You are Solene");
    expect(out.dynamicSuffix).toBe("");
  });

  it("puts retrieved memories into the dynamic suffix only", async () => {
    MEMORY_FILES.set("acreos_constitution", { body: "C", description: null });
    RETRIEVAL_RESULTS = [
      {
        sourceRef: "feedback-coo-authority",
        contentSnippet: "coo body",
        similarityScore: 0.84,
      },
    ];
    const out = await buildChatContext({
      userMessage: "what's COO authority",
      conversationId: 1,
      tier: "conversational",
    });
    expect(out.dynamicSuffix).toContain("feedback-coo-authority");
    expect(out.dynamicSuffix).toContain("coo body");
    expect(out.staticPrefix).not.toContain("coo body");
  });

  it("respects token budget by trimming retrieval first", async () => {
    MEMORY_FILES.set("acreos_constitution", {
      body: "C".repeat(4000),
      description: null,
    });
    RETRIEVAL_RESULTS = [
      {
        sourceRef: "low-priority",
        contentSnippet: "x".repeat(8000),
        similarityScore: 0.5,
      },
    ];
    const out = await buildChatContext({
      userMessage: "anything",
      conversationId: 1,
      tier: "conversational",
      tokenBudget: 1500, // small enough that retrieval gets dropped
    });
    expect(out.staticPrefix).toContain("CCCC");
    expect(out.dynamicSuffix).toBe("");
    expect(out.totalTokens).toBeLessThanOrEqual(1500);
  });

  it("returns clean empty halves when nothing loads", async () => {
    const out = await buildChatContext({
      userMessage: "hi",
      conversationId: 1,
      tier: "conversational",
    });
    // No memory files were primed → only the role preamble in static prefix.
    expect(out.staticPrefix).toContain("You are Solene");
    expect(out.dynamicSuffix).toBe("");
    expect(out.blocks).toEqual([]);
  });
});
