/**
 * Tests for the Solene memory-retrieval service (Layer 3 L3.14).
 *
 * Coverage:
 *  - mergeAndCap: 3 namespaces × 3 items each, sorted desc by similarity, capped at globalTopK=5
 *  - mergeAndCap: globalTopK ≥ total → returns all
 *  - dedupBySource: removes duplicates by (namespace, sourceRef), keeps highest score
 *  - buildMultiNamespacePromptBlock empty → ""
 *  - buildMultiNamespacePromptBlock 3 namespaces → 3 sections
 *  - buildMultiNamespacePromptBlock skips empty-section namespaces
 *  - retrieveCrossNamespaceMemories happy path → merged + audit persisted
 *  - retrieveCrossNamespaceMemories per-namespace empty contributes 0
 *  - retrieveCrossNamespaceMemories one namespace throws → others still return + warn
 *  - retrieveCrossNamespaceMemories all namespaces throw → empty + warn logs + event persisted
 *  - getCorpusStatus returns expected shape
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

// Mock Voyage so retrieval is deterministic; fallback path is tested
// explicitly below by toggling `voyageShouldThrow`.
let voyageShouldThrow = false;
let voyageCallCount = 0;
vi.mock("../embeddings/voyageClient", () => ({
  embedTexts: vi.fn(async (input: { texts: string[]; inputType?: string }) => {
    voyageCallCount += 1;
    if (voyageShouldThrow) {
      throw new Error("simulated voyage failure");
    }
    const vec = new Array(1024).fill(0).map((_, i) => (i % 11) / 100);
    return {
      embeddings: input.texts.map(() => vec),
      model: "voyage-3-large",
      dim: 1024,
      inputTokens: 1,
      totalCostUsd: 0.0000018,
    };
  }),
}));

// ============================================================================
// In-memory DB
// ============================================================================

// Per-namespace synthetic corpus: each entry is what the cosine query
// "would" have returned (we don't actually score vectors in the test).
const CORPUS_BY_NS: Record<
  string,
  Array<{ source_ref: string; content_snippet: string; similarity: number }>
> = {};

const RETRIEVAL_EVENTS: Array<{
  id: number;
  queryingAgentRole: string;
  queryDispatchId: number | null;
  queryText: string;
  queryNamespace: string;
  topK: number;
  retrievedCount: number;
  retrievedSourceRefs: string[];
  similarityScores: string[];
  latencyMs: number;
}> = [];
let nextEventId = 1;

// Set of namespaces whose pgvector sub-query should throw.
const THROW_NS = new Set<string>();
let throwOnInsert = false;
let throwOnStatusSelect = false;
let throwOnTotalSelect = false;

// Status table contents.
const STATUS_ROWS: Array<{
  namespace: string;
  rows_ingested: number;
  last_ingested_at: Date | null;
  rows_failed: number;
}> = [];

let totalEmbeddingsRow = 0;

function flattenSql(query: any): string {
  const chunks: any[] = query?.queryChunks ?? [];
  const parts: string[] = [];
  for (const c of chunks) {
    if (typeof c === "string") {
      parts.push(c);
    } else if (c && typeof c === "object") {
      if (Array.isArray(c.value)) {
        parts.push(c.value.join(" "));
      } else if (typeof c.value === "string") {
        parts.push(c.value);
      }
    }
  }
  return parts.join(" ").toLowerCase();
}

vi.mock("../../db", () => {
  const db = {
    execute: async (query: any) => {
      const text = flattenSql(query);

      if (text.includes("solene_memory_corpus_status")) {
        if (throwOnStatusSelect) throw new Error("simulated status select fail");
        return STATUS_ROWS as any;
      }
      if (text.includes("solene_embedded_records") && text.includes("count(")) {
        if (throwOnTotalSelect) throw new Error("simulated total select fail");
        return [{ count: totalEmbeddingsRow }] as any;
      }
      if (text.includes("solene_embedded_records")) {
        const ns = inferNamespace(query);
        if (ns && THROW_NS.has(ns)) {
          throw new Error(`simulated namespace ${ns} db fail`);
        }
        const rows = ns ? (CORPUS_BY_NS[ns] ?? []) : [];
        return rows.map((r) => ({
          source_ref: r.source_ref,
          content_snippet: r.content_snippet,
          similarity: r.similarity,
        })) as any;
      }
      return [] as any;
    },
    insert: (_table: any) => ({
      values: (row: any) => ({
        returning: async () => {
          if (throwOnInsert) throw new Error("simulated insert fail");
          const created = {
            id: nextEventId++,
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

// Heuristic: walk the drizzle sql object's queryChunks looking for one of
// our known namespace strings.
const KNOWN_NS = [
  "feedback_memory",
  "dispatch_summary",
  "agent_decision",
  "decision_trace_step",
  "audit_finding",
];
function inferNamespace(query: any): string | null {
  try {
    const chunks: any[] = query?.queryChunks ?? [];
    for (const c of chunks) {
      if (typeof c === "string" && KNOWN_NS.includes(c)) return c;
      if (c && typeof c === "object") {
        const v = (c as any).value;
        if (typeof v === "string" && KNOWN_NS.includes(v)) return v;
        if (Array.isArray(v)) {
          for (const inner of v) {
            if (typeof inner === "string" && KNOWN_NS.includes(inner)) return inner;
          }
        }
      }
    }
  } catch {
    // fall through
  }
  return null;
}

beforeEach(() => {
  for (const k of Object.keys(CORPUS_BY_NS)) delete CORPUS_BY_NS[k];
  RETRIEVAL_EVENTS.length = 0;
  STATUS_ROWS.length = 0;
  nextEventId = 1;
  THROW_NS.clear();
  throwOnInsert = false;
  throwOnStatusSelect = false;
  throwOnTotalSelect = false;
  totalEmbeddingsRow = 0;
  voyageShouldThrow = false;
  voyageCallCount = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// mergeAndCap
// ============================================================================

describe("mergeAndCap", () => {
  it("merges per-namespace results, sorts desc by similarity, caps at globalTopK=5", async () => {
    const { mergeAndCap } = await import("./memoryRetrieval");
    const m = new Map<any, any>();
    m.set("feedback_memory", [
      { namespace: "feedback_memory", sourceRef: "fm-1", contentSnippet: "x", similarityScore: 0.9 },
      { namespace: "feedback_memory", sourceRef: "fm-2", contentSnippet: "x", similarityScore: 0.5 },
      { namespace: "feedback_memory", sourceRef: "fm-3", contentSnippet: "x", similarityScore: 0.2 },
    ]);
    m.set("dispatch_summary", [
      { namespace: "dispatch_summary", sourceRef: "ds-1", contentSnippet: "x", similarityScore: 0.85 },
      { namespace: "dispatch_summary", sourceRef: "ds-2", contentSnippet: "x", similarityScore: 0.6 },
      { namespace: "dispatch_summary", sourceRef: "ds-3", contentSnippet: "x", similarityScore: 0.4 },
    ]);
    m.set("agent_decision", [
      { namespace: "agent_decision", sourceRef: "ad-1", contentSnippet: "x", similarityScore: 0.75 },
      { namespace: "agent_decision", sourceRef: "ad-2", contentSnippet: "x", similarityScore: 0.55 },
      { namespace: "agent_decision", sourceRef: "ad-3", contentSnippet: "x", similarityScore: 0.35 },
    ]);
    const out = mergeAndCap(m, 5);
    expect(out.length).toBe(5);
    expect(out.map((x) => x.similarityScore)).toEqual([0.9, 0.85, 0.75, 0.6, 0.55]);
    expect(out[0].sourceRef).toBe("fm-1");
    expect(out[1].sourceRef).toBe("ds-1");
    expect(out[2].sourceRef).toBe("ad-1");
  });

  it("returns all items when globalTopK ≥ total", async () => {
    const { mergeAndCap } = await import("./memoryRetrieval");
    const m = new Map<any, any>();
    m.set("feedback_memory", [
      { namespace: "feedback_memory", sourceRef: "a", contentSnippet: "x", similarityScore: 0.5 },
    ]);
    m.set("audit_finding", [
      { namespace: "audit_finding", sourceRef: "b", contentSnippet: "x", similarityScore: 0.4 },
    ]);
    const out = mergeAndCap(m, 50);
    expect(out.length).toBe(2);
  });
});

// ============================================================================
// dedupBySource
// ============================================================================

describe("dedupBySource", () => {
  it("removes duplicates by (namespace, sourceRef), keeps highest score", async () => {
    const { dedupBySource } = await import("./memoryRetrieval");
    const out = dedupBySource([
      { namespace: "feedback_memory", sourceRef: "dup", contentSnippet: "x", similarityScore: 0.3 },
      { namespace: "feedback_memory", sourceRef: "dup", contentSnippet: "x", similarityScore: 0.9 },
      { namespace: "feedback_memory", sourceRef: "dup", contentSnippet: "x", similarityScore: 0.5 },
      { namespace: "dispatch_summary", sourceRef: "dup", contentSnippet: "x", similarityScore: 0.7 },
    ]);
    expect(out.length).toBe(2);
    const fmRow = out.find((r) => r.namespace === "feedback_memory");
    expect(fmRow?.similarityScore).toBe(0.9);
    const dsRow = out.find((r) => r.namespace === "dispatch_summary");
    expect(dsRow?.similarityScore).toBe(0.7);
  });

  it("preserves singletons", async () => {
    const { dedupBySource } = await import("./memoryRetrieval");
    const out = dedupBySource([
      { namespace: "feedback_memory", sourceRef: "a", contentSnippet: "x", similarityScore: 0.5 },
      { namespace: "audit_finding", sourceRef: "b", contentSnippet: "x", similarityScore: 0.4 },
    ]);
    expect(out.length).toBe(2);
  });
});

// ============================================================================
// buildMultiNamespacePromptBlock
// ============================================================================

describe("buildMultiNamespacePromptBlock", () => {
  it("returns empty string when input is empty", async () => {
    const { buildMultiNamespacePromptBlock } = await import("./memoryRetrieval");
    expect(buildMultiNamespacePromptBlock([])).toBe("");
  });

  it("renders 3 sections when items span 3 namespaces", async () => {
    const { buildMultiNamespacePromptBlock } = await import("./memoryRetrieval");
    const block = buildMultiNamespacePromptBlock([
      { namespace: "feedback_memory", sourceRef: "fm-a", contentSnippet: "feedback body", similarityScore: 0.8 },
      { namespace: "dispatch_summary", sourceRef: "dispatch:42", contentSnippet: "dispatch body", similarityScore: 0.7 },
      { namespace: "agent_decision", sourceRef: "decision:7", contentSnippet: "decision body", similarityScore: 0.6 },
    ]);
    expect(block).toContain("Relevant historical context (n=3)");
    expect(block).toContain("Past feedback memories (1)");
    expect(block).toContain("Past dispatches (1)");
    expect(block).toContain("Past decisions (1)");
    expect(block).toContain("fm-a");
    expect(block).toContain("dispatch:42");
    expect(block).toContain("decision:7");
    // Empty sections must not render.
    expect(block).not.toContain("Past decision traces");
    expect(block).not.toContain("Past audit findings");
  });

  it("skips empty-section namespaces", async () => {
    const { buildMultiNamespacePromptBlock } = await import("./memoryRetrieval");
    const block = buildMultiNamespacePromptBlock([
      { namespace: "audit_finding", sourceRef: "audit:9", contentSnippet: "x", similarityScore: 0.9 },
    ]);
    expect(block).toContain("Past audit findings (1)");
    expect(block).not.toContain("Past feedback memories");
    expect(block).not.toContain("Past dispatches");
    expect(block).not.toContain("Past decisions");
    expect(block).not.toContain("Past decision traces");
  });

  it("truncates long content snippets in the rendered block", async () => {
    const { buildMultiNamespacePromptBlock } = await import("./memoryRetrieval");
    const big = "x".repeat(500);
    const block = buildMultiNamespacePromptBlock([
      { namespace: "feedback_memory", sourceRef: "fm-big", contentSnippet: big, similarityScore: 0.9 },
    ]);
    // Hard cap at 200 + ellipsis.
    expect(block).toContain("…");
    expect(block.length).toBeLessThan(big.length);
  });
});

// ============================================================================
// retrieveCrossNamespaceMemories
// ============================================================================

describe("retrieveCrossNamespaceMemories", () => {
  it("happy path: queries all 5 namespaces, merges, persists one audit row", async () => {
    CORPUS_BY_NS.feedback_memory = [
      { source_ref: "fm-a", content_snippet: "fm A", similarity: 0.9 },
      { source_ref: "fm-b", content_snippet: "fm B", similarity: 0.8 },
    ];
    CORPUS_BY_NS.dispatch_summary = [
      { source_ref: "dispatch:1", content_snippet: "d1", similarity: 0.85 },
    ];
    CORPUS_BY_NS.agent_decision = [
      { source_ref: "decision:1", content_snippet: "ad1", similarity: 0.75 },
    ];
    CORPUS_BY_NS.decision_trace_step = [
      { source_ref: "trace:1:1", content_snippet: "ts1", similarity: 0.65 },
    ];
    CORPUS_BY_NS.audit_finding = [
      { source_ref: "audit:1", content_snippet: "af1", similarity: 0.55 },
    ];
    const { retrieveCrossNamespaceMemories } = await import("./memoryRetrieval");
    const out = await retrieveCrossNamespaceMemories({
      queryText: "how do I dispatch safely?",
      queryingAgentRole: "iris",
      queryDispatchId: 99,
    });
    expect(out.retrieved.length).toBe(6);
    expect(out.retrieved[0].similarityScore).toBeCloseTo(0.9, 4);
    expect(out.byNamespace.feedback_memory).toBe(2);
    expect(out.byNamespace.dispatch_summary).toBe(1);
    expect(out.byNamespace.agent_decision).toBe(1);
    expect(out.byNamespace.decision_trace_step).toBe(1);
    expect(out.byNamespace.audit_finding).toBe(1);
    expect(out.retrievalEventId).toBe(1);
    expect(RETRIEVAL_EVENTS.length).toBe(1);
    expect(RETRIEVAL_EVENTS[0].queryingAgentRole).toBe("iris");
    expect(RETRIEVAL_EVENTS[0].queryDispatchId).toBe(99);
    expect(RETRIEVAL_EVENTS[0].queryNamespace).toContain("cross:");
    expect(RETRIEVAL_EVENTS[0].retrievedCount).toBe(6);
  });

  it("per-namespace empty contributes 0 to merged result", async () => {
    CORPUS_BY_NS.feedback_memory = [
      { source_ref: "fm-a", content_snippet: "x", similarity: 0.9 },
    ];
    // Other namespaces left empty.
    const { retrieveCrossNamespaceMemories } = await import("./memoryRetrieval");
    const out = await retrieveCrossNamespaceMemories({ queryText: "x" });
    expect(out.retrieved.length).toBe(1);
    expect(out.byNamespace.feedback_memory).toBe(1);
    expect(out.byNamespace.dispatch_summary).toBe(0);
    expect(out.byNamespace.audit_finding).toBe(0);
  });

  it("one namespace throws → others still return + warn log + event persisted", async () => {
    CORPUS_BY_NS.feedback_memory = [
      { source_ref: "fm-a", content_snippet: "x", similarity: 0.9 },
    ];
    CORPUS_BY_NS.dispatch_summary = [
      { source_ref: "d1", content_snippet: "x", similarity: 0.8 },
    ];
    THROW_NS.add("agent_decision");
    const { retrieveCrossNamespaceMemories } = await import("./memoryRetrieval");
    const { logger } = await import("../../utils/logger");
    const out = await retrieveCrossNamespaceMemories({ queryText: "x" });
    expect(out.retrieved.length).toBe(2);
    expect(out.byNamespace.feedback_memory).toBe(1);
    expect(out.byNamespace.dispatch_summary).toBe(1);
    expect(out.byNamespace.agent_decision).toBe(0);
    expect(out.retrievalEventId).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "memoryRetrieval.cross.namespace_db_error",
      expect.objectContaining({ namespace: "agent_decision" }),
    );
  });

  it("ALL namespaces throw → empty result + warn logs + audit event persisted with count=0", async () => {
    for (const ns of KNOWN_NS) THROW_NS.add(ns);
    const { retrieveCrossNamespaceMemories } = await import("./memoryRetrieval");
    const { logger } = await import("../../utils/logger");
    const out = await retrieveCrossNamespaceMemories({ queryText: "x" });
    expect(out.retrieved).toEqual([]);
    expect(out.retrievalEventId).toBe(1);
    expect(RETRIEVAL_EVENTS.length).toBe(1);
    expect(RETRIEVAL_EVENTS[0].retrievedCount).toBe(0);
    // Each of 5 namespaces logged.
    const warnCalls = (logger.warn as any).mock.calls.filter(
      (c: any[]) => c[0] === "memoryRetrieval.cross.namespace_db_error",
    );
    expect(warnCalls.length).toBe(5);
  });

  it("filters out matches below minSimilarity", async () => {
    CORPUS_BY_NS.feedback_memory = [
      { source_ref: "fm-high", content_snippet: "x", similarity: 0.8 },
      { source_ref: "fm-low", content_snippet: "x", similarity: 0.1 },
    ];
    const { retrieveCrossNamespaceMemories } = await import("./memoryRetrieval");
    const out = await retrieveCrossNamespaceMemories({
      queryText: "x",
      minSimilarity: 0.5,
      namespaces: ["feedback_memory"],
    });
    expect(out.retrieved.map((r) => r.sourceRef)).toEqual(["fm-high"]);
  });

  it("respects explicit namespaces[] subset", async () => {
    CORPUS_BY_NS.feedback_memory = [
      { source_ref: "fm-a", content_snippet: "x", similarity: 0.9 },
    ];
    CORPUS_BY_NS.audit_finding = [
      { source_ref: "audit:1", content_snippet: "x", similarity: 0.8 },
    ];
    const { retrieveCrossNamespaceMemories } = await import("./memoryRetrieval");
    const out = await retrieveCrossNamespaceMemories({
      queryText: "x",
      namespaces: ["feedback_memory"],
    });
    expect(out.retrieved.length).toBe(1);
    expect(out.retrieved[0].namespace).toBe("feedback_memory");
  });

  it("returns matches with retrievalEventId=-1 when audit insert throws", async () => {
    CORPUS_BY_NS.feedback_memory = [
      { source_ref: "fm-a", content_snippet: "x", similarity: 0.8 },
    ];
    throwOnInsert = true;
    const { retrieveCrossNamespaceMemories } = await import("./memoryRetrieval");
    const { logger } = await import("../../utils/logger");
    const out = await retrieveCrossNamespaceMemories({ queryText: "x" });
    expect(out.retrieved.length).toBe(1);
    expect(out.retrievalEventId).toBe(-1);
    expect(logger.warn).toHaveBeenCalledWith(
      "memoryRetrieval.cross.audit_persist_failed",
      expect.any(Object),
    );
  });

  it("defaults queryingAgentRole to 'system'", async () => {
    const { retrieveCrossNamespaceMemories } = await import("./memoryRetrieval");
    await retrieveCrossNamespaceMemories({ queryText: "x" });
    expect(RETRIEVAL_EVENTS[0].queryingAgentRole).toBe("system");
  });

  it("routes the query through Voyage by default (production embedding path)", async () => {
    voyageCallCount = 0;
    CORPUS_BY_NS.feedback_memory = [
      { source_ref: "fm-a", content_snippet: "x", similarity: 0.9 },
    ];
    const { retrieveCrossNamespaceMemories } = await import("./memoryRetrieval");
    const out = await retrieveCrossNamespaceMemories({ queryText: "x" });
    expect(voyageCallCount).toBe(1);
    expect(out.retrieved.length).toBeGreaterThan(0);
  });

  it("falls back to placeholderEmbedding + warn log when Voyage throws", async () => {
    voyageShouldThrow = true;
    CORPUS_BY_NS.feedback_memory = [
      { source_ref: "fm-a", content_snippet: "x", similarity: 0.9 },
    ];
    const { retrieveCrossNamespaceMemories } = await import("./memoryRetrieval");
    const { logger } = await import("../../utils/logger");
    const out = await retrieveCrossNamespaceMemories({ queryText: "x" });
    // Retrieval still ran because placeholder is the fail-open fallback.
    expect(out.retrieved.length).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "memoryRetrieval.cross.voyage_fallback",
      expect.any(Object),
    );
  });
});

// ============================================================================
// getCorpusStatus
// ============================================================================

describe("getCorpusStatus", () => {
  it("returns the expected shape with all namespaces zero-initialized", async () => {
    const { getCorpusStatus } = await import("./memoryRetrieval");
    const out = await getCorpusStatus();
    expect(out.totalEmbeddings).toBe(0);
    expect(out.perNamespace.feedback_memory).toEqual({
      rowsIngested: 0,
      lastIngestedAt: null,
      rowsFailed: 0,
    });
    expect(out.perNamespace.dispatch_summary).toBeDefined();
    expect(out.perNamespace.agent_decision).toBeDefined();
    expect(out.perNamespace.decision_trace_step).toBeDefined();
    expect(out.perNamespace.audit_finding).toBeDefined();
  });

  it("hydrates per-namespace counts from solene_memory_corpus_status", async () => {
    const now = new Date("2026-06-01T12:00:00Z");
    STATUS_ROWS.push(
      {
        namespace: "dispatch_summary",
        rows_ingested: 42,
        last_ingested_at: now,
        rows_failed: 1,
      },
      {
        namespace: "audit_finding",
        rows_ingested: 7,
        last_ingested_at: null,
        rows_failed: 0,
      },
    );
    totalEmbeddingsRow = 123;
    const { getCorpusStatus } = await import("./memoryRetrieval");
    const out = await getCorpusStatus();
    expect(out.totalEmbeddings).toBe(123);
    expect(out.perNamespace.dispatch_summary.rowsIngested).toBe(42);
    expect(out.perNamespace.dispatch_summary.rowsFailed).toBe(1);
    expect(out.perNamespace.dispatch_summary.lastIngestedAt).toEqual(now);
    expect(out.perNamespace.audit_finding.rowsIngested).toBe(7);
    expect(out.perNamespace.feedback_memory.rowsIngested).toBe(0);
  });

  it("returns zeroed shape on DB error without throwing", async () => {
    throwOnStatusSelect = true;
    throwOnTotalSelect = true;
    const { getCorpusStatus } = await import("./memoryRetrieval");
    const { logger } = await import("../../utils/logger");
    const out = await getCorpusStatus();
    expect(out.totalEmbeddings).toBe(0);
    expect(out.perNamespace.feedback_memory.rowsIngested).toBe(0);
    expect(logger.warn).toHaveBeenCalled();
  });
});
