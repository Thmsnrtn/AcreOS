/**
 * Tests for the Solene learning-loop service (Layer 3 L3.10).
 *
 * Coverage:
 *  - cosineSimilarity: identical → 1.0, orthogonal → 0.0, opposite → -1.0
 *  - cosineSimilarity: zero-norm input → 0 (no NaN)
 *  - cosineSimilarity: length mismatch → 0
 *  - buildRetrievedMemoriesPromptBlock: empty → ""
 *  - buildRetrievedMemoriesPromptBlock: 3 memories → header + all sourceRefs + scores
 *  - retrieveRelevantMemories happy path → persists event + returns matches
 *  - retrieveRelevantMemories zero results → empty + warn + still persists event
 *  - retrieveRelevantMemories minSimilarity filter → drops below-threshold
 *  - retrieveRelevantMemories topK clamp → never exceeds RETRIEVAL_TOP_K_MAX
 *  - retrieveRelevantMemories query truncation → audit row truncated to ≤2000 chars
 *  - retrieveRelevantMemories DB throws on retrieve → empty + warn + retrievalEventId=-1
 *  - retrieveRelevantMemories DB throws on persist → returns matches + retrievalEventId=-1
 *  - getRetrievalStats math: averages + zero-result count + byAgent breakdown
 *  - getRetrievalStats empty window → all-zeros result
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ============================================================================
// In-memory DB
// ============================================================================

interface EmbeddingRow {
  source_ref: string;
  content_snippet: string;
  // The vector itself isn't actually consulted by the mock — we drive
  // similarity via a side-channel map.
  similarity: number;
}

interface RetrievalEventRow {
  id: number;
  queriedAt: Date;
  queryingAgentRole: string;
  queryDispatchId: number | null;
  queryText: string;
  queryNamespace: string;
  topK: number;
  retrievedCount: number;
  retrievedSourceRefs: string[];
  similarityScores: string[];
  latencyMs: number;
}

// Mock corpus + retrieval-event state.
const CORPUS: EmbeddingRow[] = [];
const RETRIEVAL_EVENTS: RetrievalEventRow[] = [];
let nextEventId = 1;
let throwOnSelect = false;
let throwOnInsert = false;
let throwOnStatsSelect = false;
// When set, getRetrievalStats reads from this list instead of RETRIEVAL_EVENTS.
let statsOverride: RetrievalEventRow[] | null = null;

// Tests set this to "stats" or "select" before calling so the mock knows
// which branch to take. retrieveRelevantMemories tests leave it at "select".
let executeMode: "select" | "stats" = "select";

vi.mock("../../db", () => {
  const db = {
    execute: async (_query: unknown) => {
      if (executeMode === "stats") {
        if (throwOnStatsSelect) throw new Error("simulated stats select fail");
        const source = statsOverride ?? RETRIEVAL_EVENTS;
        return source.map((e) => ({
          querying_agent_role: e.queryingAgentRole,
          retrieved_count: e.retrievedCount,
          similarity_scores: e.similarityScores,
          latency_ms: e.latencyMs,
        })) as any;
      }
      // select branch — solene_embedded_records cosine query.
      if (throwOnSelect) throw new Error("simulated select fail");
      const sorted = [...CORPUS].sort((a, b) => b.similarity - a.similarity);
      return sorted.map((r) => ({
        source_ref: r.source_ref,
        content_snippet: r.content_snippet,
        similarity: r.similarity,
      })) as any;
    },
    insert: (_table: any) => ({
      values: (row: any) => ({
        returning: async () => {
          if (throwOnInsert) throw new Error("simulated insert fail");
          const created: RetrievalEventRow = {
            id: nextEventId++,
            queriedAt: new Date(),
            queryingAgentRole: row.queryingAgentRole,
            queryDispatchId: row.queryDispatchId,
            queryText: row.queryText,
            queryNamespace: row.queryNamespace,
            topK: row.topK,
            retrievedCount: row.retrievedCount,
            retrievedSourceRefs: row.retrievedSourceRefs,
            similarityScores: row.similarityScores,
            latencyMs: row.latencyMs,
          };
          RETRIEVAL_EVENTS.push(created);
          return [{ id: created.id }];
        },
      }),
    }),
  };
  return { db };
});

beforeEach(() => {
  CORPUS.length = 0;
  RETRIEVAL_EVENTS.length = 0;
  nextEventId = 1;
  throwOnSelect = false;
  throwOnInsert = false;
  throwOnStatsSelect = false;
  statsOverride = null;
  executeMode = "select";
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// cosineSimilarity
// ============================================================================

describe("cosineSimilarity", () => {
  it("returns 1.0 for identical vectors", async () => {
    const { cosineSimilarity } = await import("./learningLoop");
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0, 6);
    expect(cosineSimilarity([3, 4], [3, 4])).toBeCloseTo(1.0, 6);
  });

  it("returns 0.0 for orthogonal vectors", async () => {
    const { cosineSimilarity } = await import("./learningLoop");
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0, 6);
    expect(cosineSimilarity([1, 0, 0], [0, 0, 1])).toBeCloseTo(0.0, 6);
  });

  it("returns -1.0 for opposite vectors", async () => {
    const { cosineSimilarity } = await import("./learningLoop");
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0, 6);
    expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1.0, 6);
  });

  it("returns 0 for zero-norm input without NaN", async () => {
    const { cosineSimilarity } = await import("./learningLoop");
    const out = cosineSimilarity([0, 0, 0], [1, 1, 1]);
    expect(Number.isNaN(out)).toBe(false);
    expect(out).toBe(0);
    const out2 = cosineSimilarity([1, 2], [0, 0]);
    expect(Number.isNaN(out2)).toBe(false);
    expect(out2).toBe(0);
  });

  it("returns 0 for length mismatch", async () => {
    const { cosineSimilarity } = await import("./learningLoop");
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([], [1])).toBe(0);
  });
});

// ============================================================================
// buildRetrievedMemoriesPromptBlock
// ============================================================================

describe("buildRetrievedMemoriesPromptBlock", () => {
  it("returns empty string when input is empty", async () => {
    const { buildRetrievedMemoriesPromptBlock } = await import("./learningLoop");
    expect(buildRetrievedMemoriesPromptBlock([])).toBe("");
  });

  it("renders header + each sourceRef + each score for 3 memories", async () => {
    const { buildRetrievedMemoriesPromptBlock } = await import("./learningLoop");
    const block = buildRetrievedMemoriesPromptBlock([
      { sourceRef: "feedback-a", contentSnippet: "lesson A body", similarityScore: 0.8421 },
      { sourceRef: "feedback-b", contentSnippet: "lesson B body", similarityScore: 0.7611 },
      { sourceRef: "feedback-c", contentSnippet: "lesson C body", similarityScore: 0.6502 },
    ]);
    expect(block).toContain("Relevant past corrections (n=3)");
    expect(block).toContain("feedback-a");
    expect(block).toContain("feedback-b");
    expect(block).toContain("feedback-c");
    expect(block).toContain("0.8421");
    expect(block).toContain("0.7611");
    expect(block).toContain("0.6502");
    expect(block).toContain("lesson A body");
    expect(block).toContain("lesson C body");
  });
});

// ============================================================================
// retrieveRelevantMemories
// ============================================================================

describe("retrieveRelevantMemories", () => {
  it("returns matches + persists an audit row on happy path", async () => {
    CORPUS.push(
      { source_ref: "feedback-a", content_snippet: "snippet A", similarity: 0.82 },
      { source_ref: "feedback-b", content_snippet: "snippet B", similarity: 0.71 },
      { source_ref: "feedback-c", content_snippet: "snippet C", similarity: 0.55 },
    );
    const { retrieveRelevantMemories } = await import("./learningLoop");
    const out = await retrieveRelevantMemories({
      queryText: "how should I dispatch this audit work safely?",
      topK: 3,
      queryingAgentRole: "iris",
      queryDispatchId: 42,
    });
    expect(out.retrieved.length).toBe(3);
    expect(out.retrieved[0].sourceRef).toBe("feedback-a");
    expect(out.retrieved[0].similarityScore).toBeCloseTo(0.82, 4);
    expect(out.retrievalEventId).toBe(1);
    expect(RETRIEVAL_EVENTS.length).toBe(1);
    expect(RETRIEVAL_EVENTS[0].queryingAgentRole).toBe("iris");
    expect(RETRIEVAL_EVENTS[0].queryDispatchId).toBe(42);
    expect(RETRIEVAL_EVENTS[0].retrievedCount).toBe(3);
    expect(RETRIEVAL_EVENTS[0].retrievedSourceRefs).toEqual([
      "feedback-a",
      "feedback-b",
      "feedback-c",
    ]);
  });

  it("returns empty + warn + still persists an audit row on zero results", async () => {
    // Empty corpus.
    const { retrieveRelevantMemories } = await import("./learningLoop");
    const { logger } = await import("../../utils/logger");
    const out = await retrieveRelevantMemories({
      queryText: "anything",
      queryingAgentRole: "iris",
    });
    expect(out.retrieved).toEqual([]);
    expect(out.retrievalEventId).toBe(1);
    expect(RETRIEVAL_EVENTS.length).toBe(1);
    expect(RETRIEVAL_EVENTS[0].retrievedCount).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      "learningLoop.retrieve.zero_results",
      expect.any(Object),
    );
  });

  it("filters out matches below minSimilarity", async () => {
    CORPUS.push(
      { source_ref: "feedback-a", content_snippet: "A", similarity: 0.9 },
      { source_ref: "feedback-b", content_snippet: "B", similarity: 0.4 },
      { source_ref: "feedback-c", content_snippet: "C", similarity: 0.1 },
    );
    const { retrieveRelevantMemories } = await import("./learningLoop");
    const out = await retrieveRelevantMemories({
      queryText: "anything",
      topK: 5,
      minSimilarity: 0.5,
    });
    expect(out.retrieved.map((m) => m.sourceRef)).toEqual(["feedback-a"]);
  });

  it("returns empty + retrievalEventId=-1 when the DB select throws", async () => {
    throwOnSelect = true;
    const { retrieveRelevantMemories } = await import("./learningLoop");
    const { logger } = await import("../../utils/logger");
    const out = await retrieveRelevantMemories({ queryText: "x" });
    expect(out.retrieved).toEqual([]);
    expect(out.retrievalEventId).toBe(-1);
    expect(logger.warn).toHaveBeenCalledWith(
      "learningLoop.retrieve.db_error",
      expect.any(Object),
    );
    // No event persisted on retrieve-failure path.
    expect(RETRIEVAL_EVENTS.length).toBe(0);
  });

  it("returns matches with retrievalEventId=-1 when persist throws", async () => {
    CORPUS.push({ source_ref: "feedback-a", content_snippet: "A", similarity: 0.8 });
    throwOnInsert = true;
    const { retrieveRelevantMemories } = await import("./learningLoop");
    const { logger } = await import("../../utils/logger");
    const out = await retrieveRelevantMemories({ queryText: "x" });
    expect(out.retrieved.length).toBe(1);
    expect(out.retrievalEventId).toBe(-1);
    expect(logger.warn).toHaveBeenCalledWith(
      "learningLoop.retrieve.audit_persist_failed",
      expect.any(Object),
    );
  });

  it("truncates query_text to RETRIEVAL_QUERY_TEXT_MAX_CHARS in the audit row", async () => {
    const { retrieveRelevantMemories } = await import("./learningLoop");
    const { RETRIEVAL_QUERY_TEXT_MAX_CHARS, RETRIEVAL_QUERY_TRUNCATION_SUFFIX } =
      await import("@shared/schema/solene-learning-loop");
    const big = "a".repeat(RETRIEVAL_QUERY_TEXT_MAX_CHARS + 500);
    await retrieveRelevantMemories({ queryText: big });
    expect(RETRIEVAL_EVENTS[0].queryText.length).toBe(
      RETRIEVAL_QUERY_TEXT_MAX_CHARS + RETRIEVAL_QUERY_TRUNCATION_SUFFIX.length,
    );
    expect(RETRIEVAL_EVENTS[0].queryText.endsWith(RETRIEVAL_QUERY_TRUNCATION_SUFFIX)).toBe(
      true,
    );
  });

  it("clamps topK above RETRIEVAL_TOP_K_MAX in the audit row", async () => {
    const { retrieveRelevantMemories } = await import("./learningLoop");
    const { RETRIEVAL_TOP_K_MAX } = await import("@shared/schema/solene-learning-loop");
    await retrieveRelevantMemories({ queryText: "x", topK: 9999 });
    expect(RETRIEVAL_EVENTS[0].topK).toBe(RETRIEVAL_TOP_K_MAX);
  });

  it("defaults queryingAgentRole to 'system' when not provided", async () => {
    const { retrieveRelevantMemories } = await import("./learningLoop");
    await retrieveRelevantMemories({ queryText: "x" });
    expect(RETRIEVAL_EVENTS[0].queryingAgentRole).toBe("system");
  });
});

// ============================================================================
// getRetrievalStats
// ============================================================================

describe("getRetrievalStats", () => {
  it("returns all-zeros for an empty window", async () => {
    executeMode = "stats";
    statsOverride = [];
    const { getRetrievalStats } = await import("./learningLoop");
    const out = await getRetrievalStats(24);
    expect(out).toEqual({
      totalQueries: 0,
      averageLatencyMs: 0,
      averageTopSimilarity: 0,
      zeroResultQueries: 0,
      byAgent: {},
    });
  });

  it("computes averages + zero-result counts + per-agent breakdown", async () => {
    executeMode = "stats";
    statsOverride = [
      mkEvent({ agent: "iris", count: 3, scores: ["0.9000", "0.6", "0.5"], latency: 100 }),
      mkEvent({ agent: "iris", count: 0, scores: [], latency: 50 }),
      mkEvent({ agent: "soren", count: 2, scores: ["0.7000", "0.4"], latency: 300 }),
      mkEvent({ agent: "soren", count: 1, scores: ["0.5000"], latency: 200 }),
    ];
    const { getRetrievalStats } = await import("./learningLoop");
    const out = await getRetrievalStats(24);
    expect(out.totalQueries).toBe(4);
    // (100 + 50 + 300 + 200) / 4 = 162.5
    expect(out.averageLatencyMs).toBeCloseTo(162.5, 4);
    // Top-similarities are 0.9, 0.7, 0.5 (the zero-result row is excluded).
    // Average = (0.9 + 0.7 + 0.5) / 3 = 0.7
    expect(out.averageTopSimilarity).toBeCloseTo(0.7, 4);
    expect(out.zeroResultQueries).toBe(1);
    expect(out.byAgent).toEqual({ iris: 2, soren: 2 });
  });

  it("returns all-zeros on DB error without throwing", async () => {
    executeMode = "stats";
    throwOnStatsSelect = true;
    const { getRetrievalStats } = await import("./learningLoop");
    const { logger } = await import("../../utils/logger");
    const out = await getRetrievalStats(24);
    expect(out.totalQueries).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      "learningLoop.getStats.db_error",
      expect.any(Object),
    );
  });
});

// Helper to build RETRIEVAL_EVENTS-shaped rows for getRetrievalStats tests.
function mkEvent(opts: {
  agent: string;
  count: number;
  scores: string[];
  latency: number;
}): RetrievalEventRow {
  return {
    id: 0,
    queriedAt: new Date(),
    queryingAgentRole: opts.agent,
    queryDispatchId: null,
    queryText: "x",
    queryNamespace: "feedback_memory",
    topK: 5,
    retrievedCount: opts.count,
    retrievedSourceRefs: [],
    similarityScores: opts.scores,
    latencyMs: opts.latency,
  };
}
