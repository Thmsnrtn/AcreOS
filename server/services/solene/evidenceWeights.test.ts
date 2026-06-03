/**
 * Tests for L6.30 — reasoning over evidence weights.
 *
 * Three surfaces under test:
 *   1. computeWeights  — pure scorer, no DB, no IO
 *   2. pickConclusion  — pure winner-picker
 *   3. computeConfidence — pure entropy-based confidence
 *   4. assessEvidence / listAssessmentsByTopic — against a mocked db
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
// MOCK DB
// ============================================================================

interface AssessmentRow {
  id: number;
  assessedAt: Date;
  agentRole: string;
  topic: string;
  decisionId: number | null;
  evidenceItems: unknown;
  chosenSourceId: string | null;
  weightAssignments: Record<string, number>;
  aggregateConclusion: string;
  rationale: string;
  confidence: string | null;
}

const ROWS: AssessmentRow[] = [];
let nextRowId = 1;
let throwOnInsert = false;

function buildDbMock() {
  let pendingTopicEq: string | undefined;
  let pendingOrderDesc = false;
  let pendingLimit: number | undefined;

  const resetPending = () => {
    pendingTopicEq = undefined;
    pendingOrderDesc = false;
    pendingLimit = undefined;
  };

  const selectChain: any = {
    from() {
      return selectChain;
    },
    where(pred: any) {
      if (
        pred &&
        typeof pred === "object" &&
        pred.op === "eq" &&
        pred.col === "topic"
      ) {
        pendingTopicEq = pred.val;
      }
      return selectChain;
    },
    orderBy() {
      pendingOrderDesc = true;
      return selectChain;
    },
    limit(n: number) {
      pendingLimit = n;
      return selectChain;
    },
    then(onFulfilled: any, onRejected: any) {
      let out = [...ROWS];
      if (pendingTopicEq) out = out.filter((r) => r.topic === pendingTopicEq);
      if (pendingOrderDesc) {
        out.sort((a, b) => b.assessedAt.getTime() - a.assessedAt.getTime());
      }
      if (pendingLimit !== undefined) out = out.slice(0, pendingLimit);
      resetPending();
      return Promise.resolve(out).then(onFulfilled, onRejected);
    },
  };

  return {
    insert: () => ({
      values: (row: any) => ({
        returning: async () => {
          if (throwOnInsert) {
            throw new Error("simulated db failure");
          }
          const created: AssessmentRow = {
            id: nextRowId++,
            assessedAt: new Date(),
            agentRole: row.agentRole,
            topic: row.topic,
            decisionId: row.decisionId ?? null,
            evidenceItems: row.evidenceItems,
            chosenSourceId: row.chosenSourceId ?? null,
            weightAssignments: row.weightAssignments,
            aggregateConclusion: row.aggregateConclusion,
            rationale: row.rationale,
            confidence: row.confidence ?? null,
          };
          ROWS.push(created);
          return [{ id: created.id }];
        },
      }),
    }),
    select: () => selectChain,
  };
}

vi.mock("../../db", () => ({ db: buildDbMock() }));

vi.mock("drizzle-orm", async () => {
  const actual =
    await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    and: (...preds: unknown[]) => ({ preds }),
    eq: (col: any, val: unknown) => {
      const name =
        typeof col === "object" && col !== null && "name" in col
          ? (col as any).name
          : "unknown";
      return { op: "eq", col: name, val };
    },
    desc: (col: unknown) => ({ op: "desc", col }),
  };
});

// ============================================================================
// SHARED FIXTURES
// ============================================================================

import type { EvidenceItem } from "./evidenceWeights";

const NOW = new Date("2026-06-03T00:00:00Z");

function isoDaysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

beforeEach(() => {
  ROWS.length = 0;
  nextRowId = 1;
  throwOnInsert = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// computeWeights
// ============================================================================

describe("computeWeights", () => {
  it("returns {} for empty input", async () => {
    const { computeWeights } = await import("./evidenceWeights");
    expect(computeWeights([])).toEqual({});
  });

  it("regulation tier 1 recent → highest pre-normalization score", async () => {
    const { computeWeights } = await import("./evidenceWeights");
    const items: EvidenceItem[] = [
      {
        id: "reg",
        sourceKind: "regulation",
        sourceRef: "12 CFR 1026.41",
        claim: "Escrow rules apply.",
        recency: isoDaysAgo(30),
        authorityTier: 1,
      },
      {
        id: "blog",
        sourceKind: "expert_opinion",
        sourceRef: "https://example.com/blog",
        claim: "Escrow rules don't apply.",
        recency: isoDaysAgo(30),
        authorityTier: 5,
      },
    ];
    const weights = computeWeights(items, NOW);
    // Pre-norm: reg = 1.0 * 1.0 * 1.0 = 1.0
    //           blog = 0.4 * (1 - 4*0.15) * 1.0 = 0.4 * 0.4 = 0.16
    // total = 1.16 → reg = 1/1.16 ≈ 0.8621, blog ≈ 0.1379
    expect(weights.reg).toBeCloseTo(1 / 1.16, 3);
    expect(weights.blog).toBeCloseTo(0.16 / 1.16, 3);
  });

  it("normalizes weights to sum=1.0", async () => {
    const { computeWeights } = await import("./evidenceWeights");
    const items: EvidenceItem[] = [
      {
        id: "a",
        sourceKind: "case_law",
        sourceRef: "Court v. State",
        claim: "x",
        recency: isoDaysAgo(100),
        authorityTier: 2,
      },
      {
        id: "b",
        sourceKind: "secondary",
        sourceRef: "treatise",
        claim: "y",
        recency: isoDaysAgo(500),
        authorityTier: 3,
      },
      {
        id: "c",
        sourceKind: "internal_doc",
        sourceRef: "doc.md",
        claim: "z",
        recency: "unknown",
        authorityTier: 4,
      },
    ];
    const weights = computeWeights(items, NOW);
    const total = Object.values(weights).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1.0, 6);
  });

  it("recency factor: <365d → 1.0, 1-3y → 0.7, >3y → 0.4, unknown → 0.3", async () => {
    const { computeWeights } = await import("./evidenceWeights");
    // Use four identical-kind+tier items differing only by recency. The
    // ratio of weights mirrors the ratio of recency factors.
    const mk = (id: string, recency: string): EvidenceItem => ({
      id,
      sourceKind: "regulation",
      sourceRef: "x",
      claim: id,
      recency,
      authorityTier: 1,
    });
    const items = [
      mk("recent", isoDaysAgo(30)),
      mk("mid", isoDaysAgo(2 * 365)),
      mk("old", isoDaysAgo(5 * 365)),
      mk("unknown", "unknown"),
    ];
    const w = computeWeights(items, NOW);
    // Pre-norm: 1.0, 0.7, 0.4, 0.3 → total 2.4
    expect(w.recent).toBeCloseTo(1.0 / 2.4, 4);
    expect(w.mid).toBeCloseTo(0.7 / 2.4, 4);
    expect(w.old).toBeCloseTo(0.4 / 2.4, 4);
    expect(w.unknown).toBeCloseTo(0.3 / 2.4, 4);
  });

  it("authority tier penalty: linear 0.15 per step", async () => {
    const { computeWeights } = await import("./evidenceWeights");
    const mk = (id: string, tier: 1 | 2 | 3 | 4 | 5): EvidenceItem => ({
      id,
      sourceKind: "regulation",
      sourceRef: "x",
      claim: id,
      recency: isoDaysAgo(10),
      authorityTier: tier,
    });
    const items = [mk("t1", 1), mk("t3", 3), mk("t5", 5)];
    const w = computeWeights(items, NOW);
    // Pre-norm: 1.0, 1.0 - 2*0.15 = 0.7, 1.0 - 4*0.15 = 0.4 → total 2.1
    expect(w.t1).toBeCloseTo(1.0 / 2.1, 4);
    expect(w.t3).toBeCloseTo(0.7 / 2.1, 4);
    expect(w.t5).toBeCloseTo(0.4 / 2.1, 4);
  });

  it("single item → weight=1.0", async () => {
    const { computeWeights } = await import("./evidenceWeights");
    const w = computeWeights(
      [
        {
          id: "only",
          sourceKind: "regulation",
          sourceRef: "x",
          claim: "y",
          recency: isoDaysAgo(5),
          authorityTier: 1,
        },
      ],
      NOW,
    );
    expect(w.only).toBeCloseTo(1.0, 6);
  });
});

// ============================================================================
// pickConclusion
// ============================================================================

describe("pickConclusion", () => {
  it("returns null + conflict message for empty input", async () => {
    const { pickConclusion } = await import("./evidenceWeights");
    const r = pickConclusion([], {});
    expect(r.chosenSourceId).toBeNull();
    expect(r.aggregateConclusion).toMatch(/conflict/i);
  });

  it("single item → that item wins", async () => {
    const { pickConclusion } = await import("./evidenceWeights");
    const items: EvidenceItem[] = [
      {
        id: "only",
        sourceKind: "regulation",
        sourceRef: "x",
        claim: "Escrow applies.",
        authorityTier: 1,
      },
    ];
    const r = pickConclusion(items, { only: 1.0 });
    expect(r.chosenSourceId).toBe("only");
    expect(r.aggregateConclusion).toBe("Escrow applies.");
  });

  it("clear winner (gap > 0.15) → returns top item claim verbatim", async () => {
    const { pickConclusion } = await import("./evidenceWeights");
    const items: EvidenceItem[] = [
      {
        id: "a",
        sourceKind: "regulation",
        sourceRef: "x",
        claim: "A is correct.",
        authorityTier: 1,
      },
      {
        id: "b",
        sourceKind: "expert_opinion",
        sourceRef: "y",
        claim: "B is correct.",
        authorityTier: 5,
      },
    ];
    const r = pickConclusion(items, { a: 0.7, b: 0.3 });
    expect(r.chosenSourceId).toBe("a");
    expect(r.aggregateConclusion).toBe("A is correct.");
  });

  it("gap <=0.15 → null + conflict message", async () => {
    const { pickConclusion } = await import("./evidenceWeights");
    const items: EvidenceItem[] = [
      {
        id: "a",
        sourceKind: "regulation",
        sourceRef: "x",
        claim: "A.",
        authorityTier: 1,
      },
      {
        id: "b",
        sourceKind: "case_law",
        sourceRef: "y",
        claim: "B.",
        authorityTier: 1,
      },
    ];
    // gap = 0.10 — exactly under the threshold
    const r = pickConclusion(items, { a: 0.55, b: 0.45 });
    expect(r.chosenSourceId).toBeNull();
    expect(r.aggregateConclusion).toMatch(/conflict/i);
  });

  it("gap EXACTLY 0.15 → treated as conflict (boundary)", async () => {
    const { pickConclusion } = await import("./evidenceWeights");
    const items: EvidenceItem[] = [
      {
        id: "a",
        sourceKind: "regulation",
        sourceRef: "x",
        claim: "A.",
        authorityTier: 1,
      },
      {
        id: "b",
        sourceKind: "case_law",
        sourceRef: "y",
        claim: "B.",
        authorityTier: 1,
      },
    ];
    const r = pickConclusion(items, { a: 0.575, b: 0.425 });
    expect(r.chosenSourceId).toBeNull();
  });

  it("gap just over 0.15 → clear winner", async () => {
    const { pickConclusion } = await import("./evidenceWeights");
    const items: EvidenceItem[] = [
      {
        id: "a",
        sourceKind: "regulation",
        sourceRef: "x",
        claim: "A.",
        authorityTier: 1,
      },
      {
        id: "b",
        sourceKind: "case_law",
        sourceRef: "y",
        claim: "B.",
        authorityTier: 1,
      },
    ];
    const r = pickConclusion(items, { a: 0.58, b: 0.42 });
    expect(r.chosenSourceId).toBe("a");
  });
});

// ============================================================================
// computeConfidence
// ============================================================================

describe("computeConfidence", () => {
  it("single source w=1.0 → confidence 1.0", async () => {
    const { computeConfidence } = await import("./evidenceWeights");
    expect(computeConfidence({ a: 1.0 })).toBe(1.0);
  });

  it("uniform 2-source distribution → confidence ~0", async () => {
    const { computeConfidence } = await import("./evidenceWeights");
    const c = computeConfidence({ a: 0.5, b: 0.5 });
    expect(c).toBeCloseTo(0, 4);
  });

  it("uniform 4-source distribution → confidence ~0", async () => {
    const { computeConfidence } = await import("./evidenceWeights");
    const c = computeConfidence({ a: 0.25, b: 0.25, c: 0.25, d: 0.25 });
    expect(c).toBeCloseTo(0, 4);
  });

  it("dominant source → high confidence", async () => {
    const { computeConfidence } = await import("./evidenceWeights");
    const c = computeConfidence({ a: 0.9, b: 0.1 });
    // entropy = -(0.9 log2 0.9 + 0.1 log2 0.1) ≈ 0.469
    // normalized = 0.469 / 1.0 ≈ 0.469
    // confidence ≈ 0.531
    expect(c).toBeGreaterThan(0.5);
    expect(c).toBeLessThan(0.6);
  });

  it("empty weights → 0", async () => {
    const { computeConfidence } = await import("./evidenceWeights");
    expect(computeConfidence({})).toBe(0);
  });
});

// ============================================================================
// assessEvidence
// ============================================================================

describe("assessEvidence", () => {
  it("happy path with clear winner → chosen source set", async () => {
    const { assessEvidence } = await import("./evidenceWeights");
    const items: EvidenceItem[] = [
      {
        id: "reg",
        sourceKind: "regulation",
        sourceRef: "12 CFR 1026.41",
        claim: "Escrow applies to closed-end consumer credit.",
        recency: isoDaysAgo(30),
        authorityTier: 1,
      },
      {
        id: "blog",
        sourceKind: "expert_opinion",
        sourceRef: "https://blog.example/post",
        claim: "Escrow does not apply.",
        recency: isoDaysAgo(900),
        authorityTier: 5,
      },
    ];

    const r = await assessEvidence({
      agentRole: "beatrice",
      topic: "reg-z §1026.41 escrow scope",
      evidenceItems: items,
    });

    expect(r.assessmentId).toBeGreaterThan(0);
    expect(r.chosenSourceId).toBe("reg");
    expect(r.aggregateConclusion).toBe(
      "Escrow applies to closed-end consumer credit.",
    );
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.rationale).toContain("[reg]");
    expect(r.rationale).toContain("[blog]");
    expect(r.weightAssignments.reg).toBeGreaterThan(r.weightAssignments.blog);

    expect(ROWS).toHaveLength(1);
    expect(ROWS[0].topic).toBe("reg-z §1026.41 escrow scope");
    expect(ROWS[0].agentRole).toBe("beatrice");
    expect(ROWS[0].chosenSourceId).toBe("reg");
  });

  it("conflict → no chosen source, conflict message persisted", async () => {
    const { assessEvidence } = await import("./evidenceWeights");
    const items: EvidenceItem[] = [
      {
        id: "a",
        sourceKind: "regulation",
        sourceRef: "stat",
        claim: "A.",
        recency: isoDaysAgo(30),
        authorityTier: 1,
      },
      {
        id: "b",
        sourceKind: "regulation",
        sourceRef: "stat",
        claim: "B.",
        recency: isoDaysAgo(30),
        authorityTier: 1,
      },
    ];

    const r = await assessEvidence({
      agentRole: "iris",
      topic: "ambiguous-thing",
      evidenceItems: items,
    });

    expect(r.chosenSourceId).toBeNull();
    expect(r.aggregateConclusion).toMatch(/conflict/i);
    expect(ROWS[0].chosenSourceId).toBeNull();
    expect(ROWS[0].aggregateConclusion).toMatch(/conflict/i);
  });

  it("customWeights override skips the default scorer", async () => {
    const { assessEvidence } = await import("./evidenceWeights");
    const items: EvidenceItem[] = [
      {
        id: "a",
        sourceKind: "expert_opinion",
        sourceRef: "blog",
        claim: "A.",
        recency: "unknown",
        authorityTier: 5,
      },
      {
        id: "b",
        sourceKind: "regulation",
        sourceRef: "stat",
        claim: "B.",
        recency: isoDaysAgo(30),
        authorityTier: 1,
      },
    ];

    // Caller forcibly elevates the blog over the regulation.
    const r = await assessEvidence({
      agentRole: "iris",
      topic: "override-test",
      evidenceItems: items,
      customWeights: { a: 0.9, b: 0.1 },
    });

    expect(r.chosenSourceId).toBe("a");
    expect(r.weightAssignments.a).toBeCloseTo(0.9, 4);
    expect(r.weightAssignments.b).toBeCloseTo(0.1, 4);
    expect(r.rationale).toMatch(/Weights provided by caller/i);
  });

  it("persists decisionId when provided", async () => {
    const { assessEvidence } = await import("./evidenceWeights");
    const items: EvidenceItem[] = [
      {
        id: "only",
        sourceKind: "regulation",
        sourceRef: "x",
        claim: "y",
        recency: isoDaysAgo(10),
        authorityTier: 1,
      },
    ];
    await assessEvidence({
      agentRole: "beatrice",
      topic: "supports-decision",
      decisionId: 12345,
      evidenceItems: items,
    });
    expect(ROWS[0].decisionId).toBe(12345);
  });

  it("does not throw when DB insert fails — returns assessmentId=-1", async () => {
    const { assessEvidence } = await import("./evidenceWeights");
    throwOnInsert = true;
    const items: EvidenceItem[] = [
      {
        id: "only",
        sourceKind: "regulation",
        sourceRef: "x",
        claim: "y",
        recency: isoDaysAgo(10),
        authorityTier: 1,
      },
    ];
    const r = await assessEvidence({
      agentRole: "iris",
      topic: "db-down",
      evidenceItems: items,
    });
    expect(r.assessmentId).toBe(-1);
    // Pure computation still returned a useful result.
    expect(r.chosenSourceId).toBe("only");
    expect(r.confidence).toBe(1.0);
  });
});

// ============================================================================
// listAssessmentsByTopic
// ============================================================================

describe("listAssessmentsByTopic", () => {
  it("filters by topic + applies limit + newest-first", async () => {
    const { assessEvidence, listAssessmentsByTopic } = await import(
      "./evidenceWeights"
    );
    const mk = (id: string): EvidenceItem => ({
      id,
      sourceKind: "regulation",
      sourceRef: "x",
      claim: id,
      recency: isoDaysAgo(10),
      authorityTier: 1,
    });

    await assessEvidence({
      agentRole: "iris",
      topic: "topic-A",
      evidenceItems: [mk("a")],
    });
    await assessEvidence({
      agentRole: "iris",
      topic: "topic-B",
      evidenceItems: [mk("b")],
    });
    await assessEvidence({
      agentRole: "iris",
      topic: "topic-A",
      evidenceItems: [mk("c")],
    });

    // Force one row to look older so we can verify ordering.
    ROWS[0].assessedAt = new Date(NOW.getTime() - 10 * 60 * 1000);
    ROWS[2].assessedAt = new Date(NOW.getTime() - 1 * 60 * 1000);

    const all = await listAssessmentsByTopic("topic-A");
    expect(all).toHaveLength(2);
    expect(all[0].assessedAt.getTime()).toBeGreaterThan(
      all[1].assessedAt.getTime(),
    );

    const limited = await listAssessmentsByTopic("topic-A", 1);
    expect(limited).toHaveLength(1);
  });

  it("returns empty array when topic has no rows", async () => {
    const { listAssessmentsByTopic } = await import("./evidenceWeights");
    const r = await listAssessmentsByTopic("nonexistent");
    expect(r).toEqual([]);
  });
});
