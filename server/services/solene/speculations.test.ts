/**
 * Tests for Solene speculative-execution service (Phase B L4.20).
 *
 * Coverage:
 *  - createSpeculation happy path with all fields
 *  - createSpeculation defaults expiresInDays to 30 → expires_at ≈ now+30d
 *  - createSpeculation sanitizes triggered_by_signal credentials before persist
 *  - createSpeculation sanitizes evidence_refs credentials
 *  - createSpeculation validates agentRole / outputKind / confidence range
 *  - findMatchingSpeculations Jaccard scoring + threshold ≥0.3 filter
 *  - findMatchingSpeculations honors outputKind + minConfidence filters
 *  - consumeSpeculation happy path → status='consumed', consumed_at set
 *  - consumeSpeculation on terminal row throws
 *  - supersedeSpeculation creates new row linked back + flips old
 *  - discardSpeculation sets status + reason
 *  - discardSpeculation on already-terminal row throws
 *  - expireStale flips only speculated rows past expires_at
 *  - listActive filter + limit
 *  - getStats math correctness (hit rate + averageTimeToConsumeMs)
 *  - tokenize + jaccardScore pure-function behavior
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

interface SpecRow {
  id: number;
  createdAt: Date;
  updatedAt: Date;
  createdByAgentRole: string;
  triggeredBySignal: string;
  predictedNeed: string;
  speculativeOutput: string;
  outputKind: string;
  confidence: string | null;
  status: string;
  consumedAt: Date | null;
  consumedByDispatchId: number | null;
  consumedByReason: string | null;
  expiresAt: Date | null;
  supersedesSpeculationId: number | null;
  evidenceRefs: string[];
}

const SPECS: SpecRow[] = [];
let nextId = 1;

type WhereTag =
  | { kind: "by-id"; id: number }
  | { kind: "status"; status: string }
  | { kind: "role"; agentRole: string }
  | { kind: "kind"; outputKind: string }
  | { kind: "created-gte"; cutoff: Date }
  | { kind: "expires-not-null" }
  | { kind: "expires-lte"; cutoff: Date }
  | { kind: "and"; parts: WhereTag[] };

function matches(row: SpecRow, clause: WhereTag): boolean {
  if (!clause) return true;
  switch (clause.kind) {
    case "by-id":
      return row.id === clause.id;
    case "status":
      return row.status === clause.status;
    case "role":
      return row.createdByAgentRole === clause.agentRole;
    case "kind":
      return row.outputKind === clause.outputKind;
    case "created-gte":
      return row.createdAt.getTime() >= clause.cutoff.getTime();
    case "expires-not-null":
      return row.expiresAt !== null;
    case "expires-lte":
      return row.expiresAt !== null && row.expiresAt.getTime() <= clause.cutoff.getTime();
    case "and":
      return clause.parts.every((p) => matches(row, p));
  }
}

vi.mock("../../db", () => {
  const db = {
    insert: (_table: unknown) => ({
      values: (row: any) => ({
        returning: async (_cols: any) => {
          const now = new Date();
          const created: SpecRow = {
            id: nextId++,
            createdAt: now,
            updatedAt: now,
            createdByAgentRole: row.createdByAgentRole,
            triggeredBySignal: row.triggeredBySignal,
            predictedNeed: row.predictedNeed,
            speculativeOutput: row.speculativeOutput,
            outputKind: row.outputKind,
            confidence: row.confidence ?? null,
            status: row.status ?? "speculated",
            consumedAt: null,
            consumedByDispatchId: null,
            consumedByReason: null,
            expiresAt: row.expiresAt ?? null,
            supersedesSpeculationId: row.supersedesSpeculationId ?? null,
            evidenceRefs: row.evidenceRefs ?? [],
          };
          SPECS.push(created);
          return [{ id: created.id }];
        },
      }),
    }),
    update: (_table: unknown) => ({
      set: (patch: any) => ({
        where: (clause: WhereTag) => {
          const apply = () => {
            const updated: { id: number }[] = [];
            for (const row of SPECS) {
              if (!matches(row, clause)) continue;
              if (patch.status !== undefined) row.status = patch.status;
              if (patch.consumedAt !== undefined) row.consumedAt = patch.consumedAt;
              if (patch.consumedByDispatchId !== undefined)
                row.consumedByDispatchId = patch.consumedByDispatchId;
              if (patch.consumedByReason !== undefined)
                row.consumedByReason = patch.consumedByReason;
              if (patch.updatedAt !== undefined) row.updatedAt = patch.updatedAt;
              updated.push({ id: row.id });
            }
            return updated;
          };
          const thenable: any = {
            then: (resolve: (v: any) => void) => resolve(apply()),
            returning: async (_cols: any) => apply(),
          };
          return thenable;
        },
      }),
    }),
    select: (_cols?: any) => ({
      from: (_t: unknown) => ({
        where: (clause: WhereTag) => {
          const matching = () => SPECS.filter((r) => matches(r, clause));
          return {
            orderBy: (_o: any) => ({
              limit: async (n: number) =>
                matching()
                  .slice()
                  .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                  .slice(0, n),
            }),
            limit: async (n: number) => matching().slice(0, n),
            then: (resolve: (v: any) => void) => resolve(matching()),
          };
        },
      }),
    }),
  };
  return { db };
});

vi.mock("drizzle-orm", async () => {
  const actual =
    await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (col: any, val: any): WhereTag => {
      const name = col?.name ?? "";
      if (name === "id") return { kind: "by-id", id: val };
      if (name === "status") return { kind: "status", status: val };
      if (name === "created_by_agent_role")
        return { kind: "role", agentRole: val };
      if (name === "output_kind") return { kind: "kind", outputKind: val };
      // Fallback — should not happen in this service.
      return { kind: "by-id", id: -1 };
    },
    and: (...parts: WhereTag[]): WhereTag => ({ kind: "and", parts }),
    desc: (col: any) => ({ __desc: col }),
    gte: (col: any, val: any): WhereTag => {
      const name = col?.name ?? "";
      if (name === "created_at") return { kind: "created-gte", cutoff: val };
      return { kind: "by-id", id: -1 };
    },
    lte: (col: any, val: any): WhereTag => {
      const name = col?.name ?? "";
      if (name === "expires_at") return { kind: "expires-lte", cutoff: val };
      return { kind: "by-id", id: -1 };
    },
    isNotNull: (col: any): WhereTag => {
      const name = col?.name ?? "";
      if (name === "expires_at") return { kind: "expires-not-null" };
      return { kind: "by-id", id: -1 };
    },
    sql: Object.assign((_strs: any) => ({}), { raw: (_s: string) => ({}) }),
  };
});

vi.mock("@shared/schema/solene-speculations", async () => {
  const actual = await vi.importActual<
    typeof import("@shared/schema/solene-speculations")
  >("@shared/schema/solene-speculations");
  return {
    ...actual,
    soleneSpeculations: {
      ...actual.soleneSpeculations,
      id: { name: "id" },
      status: { name: "status" },
      createdAt: { name: "created_at" },
      createdByAgentRole: { name: "created_by_agent_role" },
      outputKind: { name: "output_kind" },
      expiresAt: { name: "expires_at" },
    },
  };
});

beforeEach(() => {
  SPECS.length = 0;
  nextId = 1;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// createSpeculation
// ============================================================================

describe("speculations.createSpeculation", () => {
  it("happy path with all fields returns id + persists row", async () => {
    const { createSpeculation } = await import("./speculations");
    const { speculationId } = await createSpeculation({
      agentRole: "iris",
      triggeredBySignal: "pgvector flag flipped to ready",
      predictedNeed: "refresh embedding index for property descriptions",
      speculativeOutput: "#!/bin/bash\nnpm run refresh-embeddings",
      outputKind: "code_change_proposal",
      confidence: 0.85,
      expiresInDays: 7,
      evidenceRefs: ["feature_flags.pgvector=true"],
    });
    expect(speculationId).toBe(1);
    expect(SPECS).toHaveLength(1);
    expect(SPECS[0].status).toBe("speculated");
    expect(SPECS[0].outputKind).toBe("code_change_proposal");
    expect(SPECS[0].confidence).toBe("0.8500");
    expect(SPECS[0].expiresAt).not.toBeNull();
  });

  it("defaults expiresInDays to 30 → expires_at ≈ now+30d", async () => {
    const { createSpeculation } = await import("./speculations");
    const before = Date.now();
    await createSpeculation({
      agentRole: "iris",
      triggeredBySignal: "sig",
      predictedNeed: "need",
      speculativeOutput: "out",
      outputKind: "analysis",
    });
    const after = Date.now();
    const expiresAt = SPECS[0].expiresAt!.getTime();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(expiresAt).toBeGreaterThanOrEqual(before + thirtyDaysMs - 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + thirtyDaysMs + 1000);
  });

  it("sanitizes triggered_by_signal — sk_live_* → [REDACTED]", async () => {
    const { createSpeculation } = await import("./speculations");
    await createSpeculation({
      agentRole: "beatrice",
      triggeredBySignal:
        "leak detected in env: sk_live_ABCDEF1234567890 and ghp_AAAAAAAAAAAAAAAA",
      predictedNeed: "rotate stripe key",
      speculativeOutput: "rotate via dashboard",
      outputKind: "document_draft",
    });
    expect(SPECS[0].triggeredBySignal).not.toMatch(/sk_live_[A-Za-z0-9]/);
    expect(SPECS[0].triggeredBySignal).not.toMatch(/ghp_[A-Za-z0-9]/);
    expect(SPECS[0].triggeredBySignal).toMatch(/\[REDACTED\]/);
  });

  it("sanitizes evidence_refs entries", async () => {
    const { createSpeculation } = await import("./speculations");
    await createSpeculation({
      agentRole: "iris",
      triggeredBySignal: "ok",
      predictedNeed: "need",
      speculativeOutput: "out",
      outputKind: "analysis",
      evidenceRefs: [
        "config: Bearer eyJabcdef.xx.yy",
        "AKIAABCDEFGHIJKLMNOP found in log", // secret-scan:allow
      ],
    });
    for (const ref of SPECS[0].evidenceRefs) {
      expect(ref).toMatch(/\[REDACTED\]/);
      expect(ref).not.toMatch(/AKIA[A-Z0-9]{16}/);
    }
  });

  it("rejects invalid agentRole", async () => {
    const { createSpeculation } = await import("./speculations");
    await expect(
      createSpeculation({
        // @ts-expect-error — intentionally invalid
        agentRole: "ghost",
        triggeredBySignal: "x",
        predictedNeed: "x",
        speculativeOutput: "x",
        outputKind: "analysis",
      }),
    ).rejects.toThrow(/invalid agentRole/);
  });

  it("rejects invalid outputKind", async () => {
    const { createSpeculation } = await import("./speculations");
    await expect(
      createSpeculation({
        agentRole: "iris",
        triggeredBySignal: "x",
        predictedNeed: "x",
        speculativeOutput: "x",
        // @ts-expect-error — intentionally invalid
        outputKind: "blueprint",
      }),
    ).rejects.toThrow(/invalid outputKind/);
  });

  it("rejects confidence outside [0,1]", async () => {
    const { createSpeculation } = await import("./speculations");
    await expect(
      createSpeculation({
        agentRole: "iris",
        triggeredBySignal: "x",
        predictedNeed: "x",
        speculativeOutput: "x",
        outputKind: "analysis",
        confidence: 1.5,
      }),
    ).rejects.toThrow(/must be in \[0,1\]/);
  });
});

// ============================================================================
// findMatchingSpeculations
// ============================================================================

describe("speculations.findMatchingSpeculations", () => {
  it("returns matches ordered by score DESC then confidence DESC; filters <0.3", async () => {
    const { createSpeculation, findMatchingSpeculations } = await import(
      "./speculations"
    );
    await createSpeculation({
      agentRole: "iris",
      triggeredBySignal: "sig",
      predictedNeed: "refresh embedding index for property descriptions",
      speculativeOutput: "out",
      outputKind: "code_change_proposal",
      confidence: 0.6,
    });
    await createSpeculation({
      agentRole: "iris",
      triggeredBySignal: "sig",
      predictedNeed: "refresh embedding index for descriptions",
      speculativeOutput: "out",
      outputKind: "code_change_proposal",
      confidence: 0.9,
    });
    await createSpeculation({
      agentRole: "soren",
      triggeredBySignal: "sig",
      predictedNeed: "draft blog post about land surveys",
      speculativeOutput: "out",
      outputKind: "document_draft",
      confidence: 0.99,
    });

    const matches = await findMatchingSpeculations({
      predictedNeedQuery: "refresh embedding index property descriptions",
    });
    // Both Iris specs should match; Soren spec should NOT (Jaccard < 0.3).
    expect(matches.length).toBe(2);
    expect(matches[0].speculationId).toBeOneOf([1, 2]);
    // First match has higher matchScore OR equal score with higher confidence.
    expect(matches[0].matchScore).toBeGreaterThanOrEqual(matches[1].matchScore);
    if (matches[0].matchScore === matches[1].matchScore) {
      expect(matches[0].confidence).toBeGreaterThanOrEqual(matches[1].confidence);
    }
  });

  it("filters by outputKind and minConfidence", async () => {
    const { createSpeculation, findMatchingSpeculations } = await import(
      "./speculations"
    );
    await createSpeculation({
      agentRole: "iris",
      triggeredBySignal: "sig",
      predictedNeed: "deploy embedding worker",
      speculativeOutput: "out",
      outputKind: "code_change_proposal",
      confidence: 0.4,
    });
    await createSpeculation({
      agentRole: "iris",
      triggeredBySignal: "sig",
      predictedNeed: "deploy embedding worker",
      speculativeOutput: "out",
      outputKind: "document_draft",
      confidence: 0.9,
    });
    const matches = await findMatchingSpeculations({
      predictedNeedQuery: "deploy embedding worker",
      outputKind: "code_change_proposal",
      minConfidence: 0.5,
    });
    // Only spec #1 matches kind, but its confidence (0.4) < 0.5 → filtered.
    expect(matches).toHaveLength(0);

    const matches2 = await findMatchingSpeculations({
      predictedNeedQuery: "deploy embedding worker",
      outputKind: "document_draft",
      minConfidence: 0.5,
    });
    expect(matches2).toHaveLength(1);
    expect(matches2[0].speculationId).toBe(2);
  });
});

// ============================================================================
// consumeSpeculation
// ============================================================================

describe("speculations.consumeSpeculation", () => {
  it("happy path → status='consumed', consumed_at set, reason stored", async () => {
    const { createSpeculation, consumeSpeculation, getSpeculation } =
      await import("./speculations");
    const { speculationId } = await createSpeculation({
      agentRole: "iris",
      triggeredBySignal: "sig",
      predictedNeed: "need",
      speculativeOutput: "out",
      outputKind: "analysis",
    });
    await consumeSpeculation({
      speculationId,
      consumedByDispatchId: 42,
      reason: "matched incoming founder ask",
    });
    const row = await getSpeculation(speculationId);
    expect(row?.status).toBe("consumed");
    expect(row?.consumedAt).not.toBeNull();
    expect(row?.consumedByDispatchId).toBe(42);
    expect(row?.consumedByReason).toBe("matched incoming founder ask");
  });

  it("throws on already-terminal speculation", async () => {
    const { createSpeculation, consumeSpeculation } = await import(
      "./speculations"
    );
    const { speculationId } = await createSpeculation({
      agentRole: "iris",
      triggeredBySignal: "sig",
      predictedNeed: "need",
      speculativeOutput: "out",
      outputKind: "analysis",
    });
    await consumeSpeculation({ speculationId, reason: "first time" });
    await expect(
      consumeSpeculation({ speculationId, reason: "second" }),
    ).rejects.toThrow(/only 'speculated' can be consumed/);
  });
});

// ============================================================================
// supersedeSpeculation
// ============================================================================

describe("speculations.supersedeSpeculation", () => {
  it("creates new row linked back + flips old to 'superseded'", async () => {
    const { createSpeculation, supersedeSpeculation, getSpeculation } =
      await import("./speculations");
    const { speculationId: origId } = await createSpeculation({
      agentRole: "iris",
      triggeredBySignal: "sig-v1",
      predictedNeed: "need-v1",
      speculativeOutput: "out-v1",
      outputKind: "analysis",
      confidence: 0.5,
    });
    const { newSpeculationId } = await supersedeSpeculation(origId, {
      agentRole: "iris",
      triggeredBySignal: "sig-v2",
      predictedNeed: "need-v2",
      speculativeOutput: "out-v2",
      outputKind: "analysis",
      confidence: 0.8,
    });
    expect(newSpeculationId).toBe(2);
    const oldRow = await getSpeculation(origId);
    expect(oldRow?.status).toBe("superseded");
    const newRow = await getSpeculation(newSpeculationId);
    expect(newRow?.status).toBe("speculated");
    expect(newRow?.supersedesSpeculationId).toBe(origId);
  });
});

// ============================================================================
// discardSpeculation
// ============================================================================

describe("speculations.discardSpeculation", () => {
  it("sets status='discarded' + persists reason", async () => {
    const { createSpeculation, discardSpeculation, getSpeculation } =
      await import("./speculations");
    const { speculationId } = await createSpeculation({
      agentRole: "iris",
      triggeredBySignal: "sig",
      predictedNeed: "need",
      speculativeOutput: "out",
      outputKind: "analysis",
    });
    await discardSpeculation(speculationId, "ruled out by founder");
    const row = await getSpeculation(speculationId);
    expect(row?.status).toBe("discarded");
    expect(row?.consumedByReason).toBe("ruled out by founder");
  });

  it("throws when speculation already terminal", async () => {
    const { createSpeculation, consumeSpeculation, discardSpeculation } =
      await import("./speculations");
    const { speculationId } = await createSpeculation({
      agentRole: "iris",
      triggeredBySignal: "sig",
      predictedNeed: "need",
      speculativeOutput: "out",
      outputKind: "analysis",
    });
    await consumeSpeculation({ speculationId, reason: "used" });
    await expect(
      discardSpeculation(speculationId, "too late"),
    ).rejects.toThrow(/already terminal/);
  });
});

// ============================================================================
// expireStale
// ============================================================================

describe("speculations.expireStale", () => {
  it("flips overdue speculated rows only", async () => {
    const { createSpeculation, expireStale, getSpeculation } = await import(
      "./speculations"
    );
    const { speculationId: stillFresh } = await createSpeculation({
      agentRole: "iris",
      triggeredBySignal: "sig",
      predictedNeed: "need-fresh",
      speculativeOutput: "out",
      outputKind: "analysis",
    });
    const { speculationId: willExpire } = await createSpeculation({
      agentRole: "iris",
      triggeredBySignal: "sig",
      predictedNeed: "need-stale",
      speculativeOutput: "out",
      outputKind: "analysis",
    });
    // Reach into mock storage to backdate one row's expires_at.
    SPECS.find((r) => r.id === willExpire)!.expiresAt = new Date(
      Date.now() - 1000,
    );

    const result = await expireStale();
    expect(result.expired).toBe(1);
    expect((await getSpeculation(willExpire))?.status).toBe("expired");
    expect((await getSpeculation(stillFresh))?.status).toBe("speculated");
  });
});

// ============================================================================
// listActive
// ============================================================================

describe("speculations.listActive", () => {
  it("filters by agentRole + outputKind and respects limit", async () => {
    const { createSpeculation, listActive } = await import("./speculations");
    await createSpeculation({
      agentRole: "iris",
      triggeredBySignal: "s",
      predictedNeed: "n1",
      speculativeOutput: "o",
      outputKind: "analysis",
    });
    await createSpeculation({
      agentRole: "iris",
      triggeredBySignal: "s",
      predictedNeed: "n2",
      speculativeOutput: "o",
      outputKind: "code_change_proposal",
    });
    await createSpeculation({
      agentRole: "soren",
      triggeredBySignal: "s",
      predictedNeed: "n3",
      speculativeOutput: "o",
      outputKind: "analysis",
    });

    const irisRows = await listActive({ agentRole: "iris" });
    expect(irisRows).toHaveLength(2);

    const irisCode = await listActive({
      agentRole: "iris",
      outputKind: "code_change_proposal",
    });
    expect(irisCode).toHaveLength(1);
    expect(irisCode[0].predictedNeed).toBe("n2");

    const limited = await listActive({ agentRole: "iris", limit: 1 });
    expect(limited).toHaveLength(1);
  });
});

// ============================================================================
// getStats
// ============================================================================

describe("speculations.getStats", () => {
  it("computes hit rate + average time to consume", async () => {
    const { createSpeculation, consumeSpeculation, getStats } = await import(
      "./speculations"
    );
    const { speculationId: a } = await createSpeculation({
      agentRole: "iris",
      triggeredBySignal: "s",
      predictedNeed: "n1",
      speculativeOutput: "o",
      outputKind: "analysis",
    });
    const { speculationId: b } = await createSpeculation({
      agentRole: "iris",
      triggeredBySignal: "s",
      predictedNeed: "n2",
      speculativeOutput: "o",
      outputKind: "analysis",
    });
    await createSpeculation({
      agentRole: "iris",
      triggeredBySignal: "s",
      predictedNeed: "n3",
      speculativeOutput: "o",
      outputKind: "analysis",
    });
    // Backdate createdAt so consumed timestamps differ.
    const rowA = SPECS.find((r) => r.id === a)!;
    rowA.createdAt = new Date(Date.now() - 60_000);
    const rowB = SPECS.find((r) => r.id === b)!;
    rowB.createdAt = new Date(Date.now() - 120_000);

    await consumeSpeculation({ speculationId: a, reason: "match" });
    await consumeSpeculation({ speculationId: b, reason: "match" });

    const stats = await getStats(7);
    expect(stats.totalCreated).toBe(3);
    expect(stats.consumed).toBe(2);
    expect(stats.expired).toBe(0);
    expect(stats.hitRate).toBeCloseTo(2 / 3, 5);
    expect(stats.averageTimeToConsumeMs).not.toBeNull();
    // Average of ~60s and ~120s consumed-after-created = ~90s.
    expect(stats.averageTimeToConsumeMs!).toBeGreaterThan(60_000);
    expect(stats.averageTimeToConsumeMs!).toBeLessThan(120_000);
  });

  it("returns hitRate=0 + averageTimeToConsumeMs=null on empty window", async () => {
    const { getStats } = await import("./speculations");
    const stats = await getStats(1);
    expect(stats.totalCreated).toBe(0);
    expect(stats.hitRate).toBe(0);
    expect(stats.averageTimeToConsumeMs).toBeNull();
  });
});

// ============================================================================
// pure helpers
// ============================================================================

describe("speculations pure helpers", () => {
  it("tokenize drops stopwords + punctuation, lowercases", async () => {
    const { tokenize } = await import("./speculations");
    expect(tokenize("The Quick brown FOX is jumping!")).toEqual([
      "quick",
      "brown",
      "fox",
      "jumping",
    ]);
  });

  it("jaccardScore — identical → 1, disjoint → 0, partial → in range", async () => {
    const { jaccardScore } = await import("./speculations");
    expect(jaccardScore("alpha beta gamma", "alpha beta gamma")).toBe(1);
    expect(jaccardScore("alpha", "delta")).toBe(0);
    const s = jaccardScore("alpha beta gamma", "beta gamma delta");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
    // intersection={beta,gamma}=2, union={alpha,beta,gamma,delta}=4 → 0.5
    expect(s).toBeCloseTo(0.5, 5);
  });

  it("sanitizeText redacts known credential prefixes", async () => {
    const { sanitizeText } = await import("./speculations");
    expect(sanitizeText("key=sk_test_ABCDEFGH12345")).toMatch(/\[REDACTED\]/);
    expect(sanitizeText("AWS=AKIAABCDEFGHIJKLMNOP")).toMatch(/\[REDACTED\]/); // secret-scan:allow
    const bearerSanitized = sanitizeText("auth: Bearer abcdefgh1234");
    expect(bearerSanitized).toMatch(/\[REDACTED\]/);
    expect(bearerSanitized).not.toMatch(/abcdefgh1234/);
  });
});
